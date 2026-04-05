export interface ParsedBase {
    type: string;
    guid: string;
    chatGuid: string;
    from: string;
    isFromMe: boolean;
    timestamp: Date;
    replyToGuid?: string;
    threadGuid?: string;
    effect?: string;
}

export interface AttachmentMeta {
    guid: string;
    mimeType: string;
    fileName: string;
    sizeBytes: number;
    uti?: string;
}

export interface TextStyleRange {
    start: number;
    end: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    animation?: string;
}

export interface TextMessage extends ParsedBase {
    type: "text";
    text: string;
    styles?: TextStyleRange[];
}

export interface ImageMessage extends ParsedBase {
    type: "image";
    subtype: string;
    attachment: AttachmentMeta;
    dimensions?: { width: number; height: number };
}

export interface GifMessage extends ParsedBase {
    type: "gif";
    attachment: AttachmentMeta;
    dimensions?: { width: number; height: number };
}

export interface VideoMessage extends ParsedBase {
    type: "video";
    attachment: AttachmentMeta;
    dimensions?: { width: number; height: number };
}

export interface FileMessage extends ParsedBase {
    type: "file";
    attachment: AttachmentMeta;
}

export interface StickerMessage extends ParsedBase {
    type: "sticker";
    attachment: AttachmentMeta;
    isReplySticker: boolean;
}

export interface AudioMessage extends ParsedBase {
    type: "audio";
    attachment: AttachmentMeta;
    expirable: boolean;
}

export interface DigitalTouchMessage extends ParsedBase {
    type: "digital-touch";
    expired: boolean;
}

export interface ReactionMessage extends ParsedBase {
    type: "reaction";
    reaction: string;
    emoji?: string;
    targetMessageGuid: string;
    targetPart: number;
    targetType: "part" | "balloon";
    isRemoval: boolean;
}

export interface EditMessage extends ParsedBase {
    type: "edit";
    newText: string;
    editedAt: Date;
}

export interface UnsendMessage extends ParsedBase {
    type: "unsend";
    retractedAt: Date;
}

export interface PollMessage extends ParsedBase {
    type: "poll";
    title?: string;
    options?: string[];
    isPollVote: boolean;
}

export interface SystemMessage extends ParsedBase {
    type: "system";
    systemType: string;
    groupTitle?: string;
    direction?: "incoming" | "outgoing";
}

export interface RichLinkMessage extends ParsedBase {
    type: "rich-link";
    url: string;
    canonicalUrl?: string;
    title?: string;
    summary?: string;
    siteName?: string;
    twitterCard?: string;
    icon?: { url: string; mimeType?: string };
    image?: { url: string; mimeType?: string };
}

export interface CollaborationMessage extends ParsedBase {
    type: "collaboration";
    service: string;
    title: string;
    url: string;
    collaborationUrl?: string;
    isCollaboration: boolean;
    app: { name: string; bundleIds: string[]; icon?: { mimeType?: string } };
}

export interface LocationShareMessage extends ParsedBase {
    type: "location-share";
    action: string;
    kind: "share" | "request" | "unknown";
    duration?: "oneHour" | "indefinitely" | "untilEndOfDay" | string;
    isFromRequest?: boolean;
    coordinates: { lat: number; lng: number };
    altitude?: number;
    horizontalAccuracy?: number;
    speed?: number;
    address?: { short?: string; long?: string; subtitle?: string };
    mapsUrl: string;
}

export interface ContactMessage extends ParsedBase {
    type: "contact";
    firstName?: string;
    lastName?: string;
    fullName?: string;
    phones: string[];
    emails: string[];
    org?: string;
    attachmentGuid: string;
}

export interface CheckInMessage extends ParsedBase {
    type: "checkin";
    mode: "timer" | "destination" | "workout" | "unknown";
    status: "started" | "ended" | "cancelled" | string;
    sessionId?: string;
    startedAt?: Date;
    estimatedEndTime?: Date;
    shareUrl?: string;
    destinationName?: string;
    destinationType?: "none" | "destination" | string;
    lowPowerMode: boolean;
}

export interface UnknownMessage extends ParsedBase {
    type: "unknown";
    balloonBundleId?: string;
    raw?: any;
}

export type ParsedMessage =
    | TextMessage
    | ImageMessage
    | GifMessage
    | VideoMessage
    | FileMessage
    | StickerMessage
    | AudioMessage
    | DigitalTouchMessage
    | ReactionMessage
    | EditMessage
    | UnsendMessage
    | PollMessage
    | SystemMessage
    | RichLinkMessage
    | CollaborationMessage
    | LocationShareMessage
    | ContactMessage
    | CheckInMessage
    | UnknownMessage;

export interface ParsedDescription {
    summary: string;
    type: ParsedMessage["type"];
    data: Record<string, any>;
}
