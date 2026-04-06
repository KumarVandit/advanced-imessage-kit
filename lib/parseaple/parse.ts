import { inflateRawSync } from "node:zlib";
import type { AttachmentResponse } from "../../types/attachment";
import type { MessageResponse } from "../../types/message";
import { isPollVote, POLL_BALLOON_BUNDLE_ID, parsePollDefinition } from "../poll-utils";
import type {
    AttachmentMeta,
    AudioMessage,
    CheckInMessage,
    CollaborationMessage,
    ContactMessage,
    DigitalTouchMessage,
    EditMessage,
    FileMessage,
    GifMessage,
    ImageMessage,
    LocationShareMessage,
    ParsedBase,
    ParsedMessage,
    PollMessage,
    ReactionMessage,
    RichLinkMessage,
    StickerMessage,
    SystemMessage,
    TextMessage,
    TextStyleRange,
    UnknownMessage,
    UnsendMessage,
    VideoMessage,
} from "./types";
import { parseVCard } from "./vcard";

// --- Effects ---

const EFFECT_ID_TO_NAME: Record<string, string> = {
    "com.apple.messages.effect.CKConfettiEffect": "confetti",
    "com.apple.messages.effect.CKFireworksEffect": "fireworks",
    "com.apple.messages.effect.CKBalloonEffect": "balloons",
    "com.apple.messages.effect.CKHeartEffect": "hearts",
    "com.apple.messages.effect.CKHappyBirthdayEffect": "happyBirthday",
    "com.apple.messages.effect.CKLasersEffect": "lasers",
    "com.apple.messages.effect.CKShootingStarEffect": "shootingStar",
    "com.apple.messages.effect.CKSparklesEffect": "sparkles",
    "com.apple.messages.effect.CKCelebrationEffect": "celebration",
    "com.apple.messages.effect.CKEchoEffect": "echo",
    "com.apple.messages.effect.CKSpotlightEffect": "spotlight",
    "com.apple.MobileSMS.expressivesend.gentle": "gentle",
    "com.apple.MobileSMS.expressivesend.loud": "loud",
    "com.apple.MobileSMS.expressivesend.impact": "slam",
    "com.apple.MobileSMS.expressivesend.invisibleink": "invisibleInk",
};

function resolveEffect(id: string | null | undefined): string | undefined {
    if (!id) return undefined;
    return EFFECT_ID_TO_NAME[id] ?? id;
}

// --- Classification ---

export type MessageType =
    | "unsend"
    | "edit"
    | "reaction"
    | "location-share"
    | "collaboration"
    | "rich-link"
    | "digital-touch"
    | "checkin"
    | "poll"
    | "audio"
    | "sticker"
    | "contact"
    | "gif"
    | "image"
    | "video"
    | "file"
    | "system"
    | "text"
    | "unknown";

export function classify(msg: MessageResponse): MessageType {
    if (msg.dateRetracted) return "unsend";
    if (msg.dateEdited) return "edit";

    const bid = msg.balloonBundleId;
    if (bid) {
        if (bid.includes("findmy.FindMyMessagesApp")) return "location-share";
        if (bid === "com.apple.messages.URLBalloonProvider") return classifyUrlBalloon(msg);
        if (bid === "com.apple.DigitalTouchBalloonProvider") return "digital-touch";

        if (bid.includes("CheckIn") || bid.includes("GSCheckInMessageExtension") || bid.includes("SafetyMonitorApp"))
            return "checkin";
        if (bid === POLL_BALLOON_BUNDLE_ID) return "poll";
    }

    if (msg.associatedMessageGuid) return "reaction";

    if (msg.isPoll) return "poll";
    if (msg.isAudioMessage) return "audio";

    const att = msg.attachments?.[0];
    if (att) {
        if (att.isSticker) return "sticker";
        const mime = att.mimeType?.toLowerCase() ?? "";
        const uti = att.uti?.toLowerCase() ?? "";
        if (mime === "text/vcard" || mime === "text/x-vcard" || uti === "public.vcard") return "contact";
        if (mime === "image/gif" || uti === "com.compuserve.gif") return "gif";
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("video/") || uti.includes("movie") || uti.includes("video")) return "video";
        return "file";
    }

    if (msg.itemType > 0) return "system";
    if (msg.text) return "text";
    return "unknown";
}

function classifyUrlBalloon(msg: MessageResponse): "collaboration" | "rich-link" {
    const objects = msg.payloadData?.[0]?.$objects;
    if (Array.isArray(objects)) {
        for (const obj of objects) {
            if (typeof obj === "object" && obj !== null) {
                if ("collaborationMetadata" in obj) return "collaboration";
                if ("isCollaboration" in obj) return "collaboration";
            }
        }
    }
    const text = msg.text ?? "";
    if (
        text.includes("icloud.com/notes/") ||
        text.includes("icloud.com/reminders/") ||
        text.includes("icloud.com/pages/") ||
        text.includes("icloud.com/numbers/") ||
        text.includes("icloud.com/keynote/")
    ) {
        return "collaboration";
    }
    return "rich-link";
}

// --- Reactions ---

const CLASSIC_TAPBACKS: Record<string, string> = {
    love: "love",
    like: "like",
    dislike: "dislike",
    laugh: "laugh",
    emphasize: "emphasize",
    question: "question",
};

// 2000-2005 = add classic tapback, 3000-3005 = remove classic tapback
// 2006+ = add emoji reaction, 3006+ = remove emoji reaction
const NUMERIC_CLASSIC: Record<number, string> = {
    2000: "love",
    2001: "like",
    2002: "dislike",
    2003: "laugh",
    2004: "emphasize",
    2005: "question",
};

/** Server often sets replyToGuid to the previous bubble for ordering; only threadOriginator* marks a real inline reply. */
function resolveInlineReplyTarget(msg: MessageResponse): string | undefined {
    const hasInlineReplyThread =
        (msg.threadOriginatorGuid != null && msg.threadOriginatorGuid !== "") ||
        (msg.threadOriginatorPart != null && msg.threadOriginatorPart !== "");
    if (!hasInlineReplyThread) return undefined;
    const g = msg.replyToGuid;
    return g != null && g !== "" ? g : undefined;
}

const MAX_CHAT_GUID_CACHE = 4096;
const messageGuidToChatGuid = new Map<string, string>();

/** chats[] is sometimes omitted on updated-message; cache by message guid when we have seen it. */
function resolveChatGuid(msg: MessageResponse): string {
    const fromChat = msg.chats?.[0]?.guid;
    if (fromChat) {
        if (messageGuidToChatGuid.size >= MAX_CHAT_GUID_CACHE) {
            const first = messageGuidToChatGuid.keys().next().value;
            if (first !== undefined) messageGuidToChatGuid.delete(first);
        }
        messageGuidToChatGuid.set(msg.guid, fromChat);
        return fromChat;
    }
    return messageGuidToChatGuid.get(msg.guid) ?? "";
}

function buildBase(msg: MessageResponse): ParsedBase {
    return {
        type: "unknown",
        guid: msg.guid,
        chatGuid: resolveChatGuid(msg),
        from: msg.handle?.address ?? (msg.isFromMe ? "me" : "unknown"),
        isFromMe: msg.isFromMe,
        timestamp: new Date(msg.dateCreated),
        replyToGuid: resolveInlineReplyTarget(msg),
        threadGuid: msg.threadOriginatorGuid ?? undefined,
        effect: resolveEffect(msg.expressiveSendStyleId),
    };
}

function toAttachment(att: AttachmentResponse): AttachmentMeta {
    return {
        guid: att.guid,
        mimeType: att.mimeType ?? "application/octet-stream",
        fileName: att.transferName ?? "unknown",
        sizeBytes: att.totalBytes ?? 0,
        uti: att.uti,
    };
}

function getDimensions(att: AttachmentResponse): { width: number; height: number } | undefined {
    if (att.width && att.height) return { width: att.width, height: att.height };
    if (att.metadata?.width && att.metadata?.height) {
        return { width: Number(att.metadata.width), height: Number(att.metadata.height) };
    }
    return undefined;
}

function resolveUid(objects: any[], uid: any): any {
    if (typeof uid === "object" && uid !== null && "UID" in uid) return objects[uid.UID];
    return uid;
}

function resolveString(objects: any[], uid: any): string | undefined {
    const val = resolveUid(objects, uid);
    return typeof val === "string" ? val : undefined;
}

function parseReactionTarget(raw: string): {
    targetMessageGuid: string;
    targetPart: number;
    targetType: "part" | "balloon";
} {
    if (raw.startsWith("p:")) {
        const match = raw.match(/^p:(\d+)\/(.*)/);
        if (match)
            return { targetMessageGuid: match[2]!, targetPart: Number.parseInt(match[1]!, 10), targetType: "part" };
    }
    if (raw.startsWith("bp:")) return { targetMessageGuid: raw.slice(3), targetPart: 0, targetType: "balloon" };
    return { targetMessageGuid: raw, targetPart: 0, targetType: "part" };
}

function parseReactionType(
    type: string,
    text: string | null,
): { reaction: string; emoji?: string; isRemoval: boolean } {
    if (CLASSIC_TAPBACKS[type]) return { reaction: type, isRemoval: false };
    if (type.startsWith("-") && CLASSIC_TAPBACKS[type.slice(1)]) return { reaction: type.slice(1), isRemoval: true };

    const code = Number.parseInt(type, 10);
    if (Number.isNaN(code)) return { reaction: type, isRemoval: false };
    if (NUMERIC_CLASSIC[code]) return { reaction: NUMERIC_CLASSIC[code]!, isRemoval: false };
    if (code >= 3000 && code < 3006) return { reaction: NUMERIC_CLASSIC[code - 1000] ?? "unknown", isRemoval: true };

    if (code === 2007) {
        return { reaction: "sticker", isRemoval: false };
    }
    if (code === 3007) {
        return { reaction: "sticker", isRemoval: true };
    }

    if (code >= 2006 && code < 3000) {
        const emoji = text?.match(/^Reacted\s+(.+?)\s+to\s+["\u201c]/)?.[1];
        return { reaction: "emoji", emoji, isRemoval: false };
    }
    if (code >= 3006) {
        const emoji = text?.match(/^Removed\s+(.+?)\s+from\s+["\u201c]/)?.[1];
        return { reaction: "emoji", emoji, isRemoval: true };
    }

    return { reaction: type, isRemoval: false };
}

const SYSTEM_TYPES: Record<number, string> = {
    1: "participant-change",
    2: "group-name-change",
    3: "group-icon-change",
    4: "location-sharing-update",
    6: "group-photo-change",
};

const ICLOUD_SERVICES: Record<string, string> = {
    notes: "notes",
    Notes: "notes",
    reminders: "reminders",
    pages: "pages",
    numbers: "numbers",
    keynote: "keynote",
    mobilenotes: "notes",
};

const TEXT_EFFECT_NAMES: Record<number, string> = {
    1: "big",
    2: "small",
    3: "shake",
    4: "nod",
    5: "explode",
    6: "ripple",
    7: "bloom",
    8: "jitter",
    9: "pen",
    10: "crystallize",
    11: "haze",
    12: "emerge",
};

function extractTextStyles(msg: MessageResponse): TextStyleRange[] | undefined {
    const body = msg.attributedBody?.[0];
    if (!body?.runs) return undefined;

    const styles: TextStyleRange[] = [];
    for (const run of body.runs) {
        const attrs = run.attributes;
        if (!attrs) continue;
        const [start, length] = run.range ?? [0, 0];
        const bold = !!(attrs.__kIMBoldAttributeName || attrs.__kIMTextBoldAttributeName);
        const italic = !!(attrs.__kIMItalicAttributeName || attrs.__kIMTextItalicAttributeName);
        const underline = !!(attrs.__kIMUnderlineAttributeName || attrs.__kIMTextUnderlineAttributeName);
        const strikethrough = !!(attrs.__kIMStrikethroughAttributeName || attrs.__kIMTextStrikethroughAttributeName);
        const effectId = attrs.__kIMTextEffectAttributeName;
        const animation = typeof effectId === "number" ? TEXT_EFFECT_NAMES[effectId] : undefined;

        if (bold || italic || underline || strikethrough || animation) {
            styles.push({
                start,
                end: start + length,
                ...(bold && { bold }),
                ...(italic && { italic }),
                ...(underline && { underline }),
                ...(strikethrough && { strikethrough }),
                ...(animation && { animation }),
            });
        }
    }
    return styles.length > 0 ? styles : undefined;
}

function handleText(msg: MessageResponse, base: ParsedBase): TextMessage {
    const styles = extractTextStyles(msg);
    return { ...base, type: "text", text: msg.text ?? "", ...(styles && { styles }) };
}

function handleImage(msg: MessageResponse, base: ParsedBase): ImageMessage {
    const att = msg.attachments![0]!;
    return {
        ...base,
        type: "image",
        subtype: (att.mimeType ?? "").replace("image/", "") || "unknown",
        attachment: toAttachment(att),
        dimensions: getDimensions(att),
    };
}

function handleGif(msg: MessageResponse, base: ParsedBase): GifMessage {
    const att = msg.attachments![0]!;
    return { ...base, type: "gif", attachment: toAttachment(att), dimensions: getDimensions(att) };
}

function handleVideo(msg: MessageResponse, base: ParsedBase): VideoMessage {
    const att = msg.attachments![0]!;
    return {
        ...base,
        type: "video",
        attachment: toAttachment(att),
        dimensions: att.width && att.height ? { width: att.width, height: att.height } : undefined,
    };
}

function handleFile(msg: MessageResponse, base: ParsedBase): FileMessage {
    return { ...base, type: "file", attachment: toAttachment(msg.attachments![0]!) };
}

function handleSticker(msg: MessageResponse, base: ParsedBase): StickerMessage {
    return {
        ...base,
        type: "sticker",
        attachment: toAttachment(msg.attachments![0]!),
        isReplySticker: !!base.replyToGuid,
    };
}

function handleAudio(msg: MessageResponse, base: ParsedBase): AudioMessage {
    const att = msg.attachments?.[0];
    return {
        ...base,
        type: "audio",
        attachment: att
            ? toAttachment(att)
            : { guid: "", mimeType: "audio/unknown", fileName: "unknown", sizeBytes: 0 },
        expirable: msg.isExpired ?? true,
    };
}

function handleDigitalTouch(msg: MessageResponse, base: ParsedBase): DigitalTouchMessage {
    return { ...base, type: "digital-touch", expired: msg.isExpired ?? false };
}

function handleReaction(msg: MessageResponse, base: ParsedBase): ReactionMessage {
    const target = parseReactionTarget(msg.associatedMessageGuid!);
    const { reaction, emoji, isRemoval } = parseReactionType(msg.associatedMessageType!, msg.text);
    return { ...base, type: "reaction", reaction, emoji, isRemoval, ...target };
}

function extractOriginalText(msg: MessageResponse): string | undefined {
    const msi = msg.messageSummaryInfo?.[0] as Record<string, any> | undefined;
    const editedContent = msi?.editedContent as Array<{ text?: { values?: Array<{ string?: string }> } }> | undefined;
    if (!editedContent?.length) return undefined;
    return editedContent[0]?.text?.values?.[0]?.string ?? undefined;
}

function handleEdit(msg: MessageResponse, base: ParsedBase): EditMessage {
    return {
        ...base,
        type: "edit",
        originalText: extractOriginalText(msg),
        newText: msg.text ?? "",
        editedAt: new Date(msg.dateEdited!),
    };
}

function handleUnsend(msg: MessageResponse, base: ParsedBase): UnsendMessage {
    return { ...base, type: "unsend", retractedAt: new Date(msg.dateRetracted!) };
}

function handlePoll(msg: MessageResponse, base: ParsedBase): PollMessage {
    const isVote = isPollVote(msg);
    const pollData = !isVote ? parsePollDefinition(msg) : null;
    return {
        ...base,
        type: "poll",
        title: pollData?.title,
        options: pollData?.options.map((o) => o.text),
        isPollVote: isVote,
    };
}

function handleSystem(msg: MessageResponse, base: ParsedBase): SystemMessage {
    return {
        ...base,
        type: "system",
        systemType: SYSTEM_TYPES[msg.itemType] ?? "unknown",
        groupTitle: msg.groupTitle ?? undefined,
        direction: msg.shareDirection === 1 ? "incoming" : msg.shareDirection === 0 ? "outgoing" : undefined,
    };
}

function handleRichLink(msg: MessageResponse, base: ParsedBase): RichLinkMessage {
    const url = msg.text ?? "";
    const result: RichLinkMessage = { ...base, type: "rich-link", url };

    const objects = msg.payloadData?.[0]?.$objects;
    if (!Array.isArray(objects)) return result;

    for (const obj of objects) {
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) continue;

        if ("title" in obj && "originalURL" in obj) {
            result.title = resolveString(objects, obj.title);
            result.summary = resolveString(objects, obj.summary);
            result.siteName = resolveString(objects, obj.itemType);
            result.twitterCard = resolveString(objects, obj.twitterCard);
        }

        if ("NS.relative" in obj && "$class" in obj) {
            const resolved = resolveString(objects, obj["NS.relative"]);
            if (resolved?.startsWith("http") && !result.canonicalUrl) result.canonicalUrl = resolved;
        }

        if ("version" in obj && "URL" in obj && "$class" in obj) {
            const nsurl = resolveUid(objects, obj.URL);
            if (typeof nsurl === "object" && nsurl !== null && "NS.relative" in nsurl) {
                const imgUrl = resolveString(objects, nsurl["NS.relative"]);
                if (imgUrl?.startsWith("http")) {
                    const className = resolveUid(objects, obj.$class)?.$classname;
                    if (className === "LPIconMetadata" && !result.icon) result.icon = { url: imgUrl };
                    else if (className === "LPImageMetadata" && !result.image) result.image = { url: imgUrl };
                }
            }
        }
    }

    return result;
}

function handleCollaboration(msg: MessageResponse, base: ParsedBase): CollaborationMessage {
    const url = msg.text ?? "";
    const result: CollaborationMessage = {
        ...base,
        type: "collaboration",
        service: "unknown",
        title: "",
        url,
        isCollaboration: true,
        app: { name: "Unknown", bundleIds: [] },
    };

    const objects = msg.payloadData?.[0]?.$objects;
    if (!Array.isArray(objects)) return result;

    for (const obj of objects) {
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) continue;

        if ("collaborationMetadata" in obj && "originalURL" in obj) {
            const collab = resolveUid(objects, obj.collaborationMetadata);
            if (typeof collab === "object" && collab !== null) {
                result.title = resolveString(objects, collab.title) ?? result.title;
                result.collaborationUrl = resolveString(objects, collab.collaborationIdentifier);

                const bundleArr = resolveUid(objects, collab.ckAppBundleIDs);
                if (bundleArr?.["NS.objects"]) {
                    result.app.bundleIds = (bundleArr["NS.objects"] as any[])
                        .map((ref: any) => resolveString(objects, ref))
                        .filter((s): s is string => !!s);
                }
            }
        }

        if ("isCollaboration" in obj && "specialization" in obj) {
            const spec = resolveUid(objects, obj.specialization);
            if (typeof spec === "object" && spec !== null) {
                result.app.name = resolveString(objects, spec.application) ?? result.app.name;
                result.title = result.title || resolveString(objects, spec.title) || "";
            }
        }
    }

    for (const id of result.app.bundleIds) {
        for (const [key, service] of Object.entries(ICLOUD_SERVICES)) {
            if (id.includes(key)) {
                result.service = service;
                break;
            }
        }
        if (result.service !== "unknown") break;
    }
    if (result.service === "unknown" && url.includes("icloud.com/notes")) result.service = "notes";

    return result;
}

function handleLocationShare(msg: MessageResponse, base: ParsedBase): LocationShareMessage {
    const result: LocationShareMessage = {
        ...base,
        type: "location-share",
        action: "Shared Location",
        kind: "unknown",
        coordinates: { lat: 0, lng: 0 },
        mapsUrl: "",
    };

    const runs = msg.attributedBody?.[0]?.runs;
    if (Array.isArray(runs)) {
        for (const run of runs) {
            const breadcrumb = run?.attributes?.__kIMBreadcrumbTextMarkerAttributeName;
            if (typeof breadcrumb === "string") {
                result.action = breadcrumb;
                break;
            }
        }
    }

    const objects = msg.payloadData?.[0]?.$objects;
    if (Array.isArray(objects)) {
        for (const obj of objects) {
            if (typeof obj !== "string" || !obj.includes("FindMyMessagePayloadZippedDataKey")) continue;
            try {
                const query = obj.startsWith("?") ? obj.slice(1) : obj;
                let zipped = "";
                for (const part of query.split("&")) {
                    const eq = part.indexOf("=");
                    if (eq !== -1 && part.slice(0, eq) === "FindMyMessagePayloadZippedDataKey") {
                        zipped = decodeURIComponent(part.slice(eq + 1));
                        break;
                    }
                }
                if (!zipped) continue;

                const decoded = Buffer.from(zipped, "base64");
                const json = JSON.parse(inflateRawSync(decoded).toString("utf-8"));
                if (json.kind?.share) {
                    result.kind = "share";
                    const dur = json.kind.share.duration;
                    if (dur) result.duration = Object.keys(dur)[0];
                } else if (json.kind?.request !== undefined) {
                    result.kind = "request";
                }

                if (json.kind?.share?.isFromRequest !== undefined) {
                    result.isFromRequest = json.kind.share.isFromRequest;
                }

                const loc = json.initialLocation ?? json.location;
                if (loc?.latitude && loc?.longitude) {
                    result.coordinates = { lat: loc.latitude, lng: loc.longitude };
                    result.mapsUrl = `https://maps.apple.com/?ll=${loc.latitude},${loc.longitude}`;
                    if (typeof loc.altitude === "number") result.altitude = loc.altitude;
                    if (typeof loc.horizontalAccuracy === "number") result.horizontalAccuracy = loc.horizontalAccuracy;
                    if (typeof loc.speed === "number" && loc.speed >= 0) result.speed = loc.speed;
                }
            } catch {
                // Decompression or parsing failed
            }
            break;
        }
    }

    return result;
}

function tryParseVCardFromAttachment(att: AttachmentResponse): {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    nickname?: string;
    org?: string;
    title?: string;
    phones: string[];
    emails: string[];
    urls: string[];
    addresses: string[];
    birthday?: string;
    note?: string;
} | null {
    const raw = att.data;
    if (!raw || typeof raw !== "string") return null;

    let text = raw.trim();
    if (!text.includes("BEGIN:VCARD")) {
        try {
            const decoded = Buffer.from(text, "base64").toString("utf-8");
            if (decoded.includes("BEGIN:VCARD")) text = decoded;
        } catch {
            return null;
        }
    }
    if (!text.includes("BEGIN:VCARD")) return null;

    const v = parseVCard(text);
    return {
        fullName: v.fullName,
        firstName: v.firstName,
        lastName: v.lastName,
        nickname: v.nickname,
        org: v.org,
        title: v.title,
        phones: v.phones,
        emails: v.emails,
        urls: v.urls,
        addresses: v.addresses,
        birthday: v.birthday,
        note: v.note,
    };
}

/**
 * Socket events typically don't include attachment.data (only metadata),
 * so phones/emails will be empty. To get full contact info, download the
 * attachment via REST using attachmentGuid and run parseVCard() on the file.
 */
function handleContact(msg: MessageResponse, base: ParsedBase): ContactMessage {
    const att = msg.attachments![0]!;
    const nameFromFile = att.transferName?.replace(/\.vcf$/i, "").trim() || undefined;
    const fromVcf = tryParseVCardFromAttachment(att);

    return {
        ...base,
        type: "contact",
        fullName: fromVcf?.fullName ?? nameFromFile,
        firstName: fromVcf?.firstName,
        lastName: fromVcf?.lastName,
        nickname: fromVcf?.nickname,
        org: fromVcf?.org,
        title: fromVcf?.title,
        phones: fromVcf?.phones ?? [],
        emails: fromVcf?.emails ?? [],
        urls: fromVcf?.urls ?? [],
        addresses: fromVcf?.addresses ?? [],
        birthday: fromVcf?.birthday,
        note: fromVcf?.note,
        attachmentGuid: att.guid,
    };
}

const CHECKIN_SESSION_TYPES: Record<string, CheckInMessage["mode"]> = {
    "0": "destination",
    "1": "timer",
    "2": "workout",
};

const CHECKIN_DEST_TYPES: Record<string, string> = { "0": "none", "1": "destination" };

const CHECKIN_END_REASONS: Record<string, CheckInMessage["status"]> = {
    "1": "ended",
    "2": "cancelled",
};

function parseUnixSeconds(val: string | undefined): Date | undefined {
    if (!val) return undefined;
    const ts = Number.parseFloat(val);
    return Number.isNaN(ts) ? undefined : new Date(ts * 1000);
}

function handleCheckIn(msg: MessageResponse, base: ParsedBase): CheckInMessage {
    const result: CheckInMessage = {
        ...base,
        type: "checkin",
        mode: "unknown",
        status: "started",
        lowPowerMode: false,
    };

    const objects = msg.payloadData?.[0]?.$objects;
    if (!Array.isArray(objects)) return result;

    for (const obj of objects) {
        if (typeof obj !== "string" || !obj.includes("messageType=")) continue;
        const query = obj.startsWith("?") ? obj.slice(1) : obj;
        const params: Record<string, string> = {};
        for (const part of query.split("&")) {
            const eq = part.indexOf("=");
            if (eq !== -1) params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
        }

        result.mode = CHECKIN_SESSION_TYPES[params.sessionType ?? ""] ?? "unknown";
        result.sessionId = params.sessionID;
        result.shareUrl = params.shareURL;
        result.startedAt = parseUnixSeconds(params.sendDate);
        result.estimatedEndTime = parseUnixSeconds(params.estimatedEndTime);
        result.destinationType =
            CHECKIN_DEST_TYPES[params.sessionDestinationType ?? ""] ?? params.sessionDestinationType;
        result.lowPowerMode = params.lowPowerModeWarningState === "1";

        if (params.messageType === "2" && params.sessionEndReason) {
            result.status = CHECKIN_END_REASONS[params.sessionEndReason] ?? "ended";
        }
        break;
    }

    for (const obj of objects) {
        if (typeof obj !== "string" || !obj.startsWith("Check In: ")) continue;
        const caption = obj.slice("Check In: ".length).trim();
        if (caption.toLowerCase() === "ended" || caption.toLowerCase() === "cancelled") continue;
        if (caption) result.destinationName = caption;
        break;
    }

    return result;
}

function handleUnknown(msg: MessageResponse, base: ParsedBase): UnknownMessage {
    return { ...base, type: "unknown", balloonBundleId: msg.balloonBundleId ?? undefined, raw: msg.payloadData };
}

export function parse(msg: MessageResponse): ParsedMessage {
    const base = buildBase(msg);
    const type = classify(msg);

    switch (type) {
        case "text":
            return handleText(msg, base);
        case "image":
            return handleImage(msg, base);
        case "gif":
            return handleGif(msg, base);
        case "video":
            return handleVideo(msg, base);
        case "file":
            return handleFile(msg, base);
        case "sticker":
            return handleSticker(msg, base);
        case "audio":
            return handleAudio(msg, base);
        case "digital-touch":
            return handleDigitalTouch(msg, base);
        case "reaction":
            return handleReaction(msg, base);
        case "edit":
            return handleEdit(msg, base);
        case "unsend":
            return handleUnsend(msg, base);
        case "poll":
            return handlePoll(msg, base);
        case "system":
            return handleSystem(msg, base);
        case "rich-link":
            return handleRichLink(msg, base);
        case "collaboration":
            return handleCollaboration(msg, base);
        case "location-share":
            return handleLocationShare(msg, base);
        case "contact":
            return handleContact(msg, base);
        case "checkin":
            return handleCheckIn(msg, base);
        case "unknown":
            return handleUnknown(msg, base);
    }
}
