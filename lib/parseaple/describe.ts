import type { ParsedBase, ParsedDescription, ParsedMessage } from "./types";

const BASE_KEYS = new Set<string>([
    "type",
    "guid",
    "chatGuid",
    "from",
    "isFromMe",
    "timestamp",
    "replyToGuid",
    "threadGuid",
    "effect",
]);

function extractData(parsed: ParsedMessage): Record<string, any> {
    const data: Record<string, any> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (!BASE_KEYS.has(key) && value !== undefined) data[key] = value;
    }
    return data;
}

function bytes(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1048576) return `${(n / 1024).toFixed(0)}KB`;
    return `${(n / 1048576).toFixed(1)}MB`;
}

function truncate(text: string, max = 80): string {
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function dims(d?: { width: number; height: number }): string {
    return d ? ` (${d.width}x${d.height})` : "";
}

function replyPrefix(parsed: ParsedMessage): string {
    if (!("replyToGuid" in parsed) || !parsed.replyToGuid) return "";
    return `[reply to ${parsed.replyToGuid}] `;
}

function summarize(parsed: ParsedMessage): string {
    const rp = replyPrefix(parsed);
    switch (parsed.type) {
        case "text": {
            const fx = parsed.effect ? ` with ${parsed.effect} effect` : "";
            const styled = parsed.styles?.length ? " (styled)" : "";
            return `${rp}Sent a text${fx}${styled}: "${truncate(parsed.text)}"`;
        }
        case "rich-link":
            return parsed.title ? `Shared a link: "${parsed.title}" (${parsed.url})` : `Shared a link: ${parsed.url}`;

        case "collaboration":
            return `Shared ${parsed.app.name} "${parsed.title}" for collaboration`;

        case "location-share": {
            if (parsed.kind === "request") return "Requested location";
            const loc = `${parsed.coordinates.lat.toFixed(4)}, ${parsed.coordinates.lng.toFixed(4)}`;
            const dur = parsed.duration
                ? ` for ${parsed.duration === "oneHour" ? "1 hour" : parsed.duration === "untilEndOfDay" ? "end of day" : parsed.duration}`
                : "";
            return parsed.address?.short
                ? `${parsed.action}${dur} in ${parsed.address.short} (${loc})`
                : `${parsed.action}${dur} (${loc})`;
        }
        case "contact":
            return parsed.fullName ? `Shared a contact: ${parsed.fullName}` : "Shared a contact card";

        case "sticker":
            return "Sent a sticker";
        case "audio":
            return `Sent a voice message (${bytes(parsed.attachment.sizeBytes)})`;
        case "image":
            return `Sent a photo${dims(parsed.dimensions)}`;
        case "gif":
            return `Sent a GIF${dims(parsed.dimensions)}`;
        case "video":
            return `Sent a video (${bytes(parsed.attachment.sizeBytes)})`;
        case "file":
            return `Sent a file: ${parsed.attachment.fileName} (${bytes(parsed.attachment.sizeBytes)})`;
        case "digital-touch":
            return `Sent a Digital Touch${parsed.expired ? " (expired)" : ""}`;

        case "reaction": {
            const e = parsed.emoji ? ` ${parsed.emoji}` : "";
            return `${parsed.isRemoval ? "Removed" : "Reacted with"} ${parsed.reaction}${e} on ${parsed.targetMessageGuid}`;
        }
        case "edit": {
            const from = parsed.originalText ? `from "${truncate(parsed.originalText)}" ` : "";
            return `Edited a message ${from}to: "${truncate(parsed.newText)}"`;
        }
        case "unsend":
            return "Unsent a message";

        case "poll":
            return parsed.isPollVote
                ? "Voted on a poll"
                : parsed.title
                  ? `Created a poll: "${parsed.title}"`
                  : "Created a poll";

        case "checkin": {
            const mode = parsed.mode !== "unknown" ? ` (${parsed.mode})` : "";
            const dest = parsed.destinationName ? ` → ${parsed.destinationName}` : "";
            return `Check In${mode}: ${parsed.status}${dest}`;
        }
        case "system":
            return parsed.groupTitle
                ? `System: ${parsed.systemType} — "${parsed.groupTitle}"`
                : `System: ${parsed.systemType}`;
        case "unknown":
            return "Sent an unrecognized message type";
    }
}

export function describe(parsed: ParsedMessage): ParsedDescription {
    return {
        summary: summarize(parsed),
        type: parsed.type,
        data: extractData(parsed),
    };
}
