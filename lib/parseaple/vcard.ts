export interface VCardSocialProfile {
    type: string;
    username?: string;
    url: string;
}

export interface VCardBinaryData {
    base64: string;
    mimeType: string;
}

export interface VCardGeo {
    lat: number;
    lng: number;
}

export interface VCardData {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    nickname?: string;
    phones: string[];
    emails: string[];
    org?: string;
    title?: string;
    role?: string;
    note?: string;
    urls: string[];
    birthday?: string;
    altBirthday?: string;
    categories: string[];
    addresses: string[];
    socialProfiles: VCardSocialProfile[];
    relatedNames: { name: string; label?: string }[];
    dates: { value: string; label?: string }[];
    photo?: VCardBinaryData;
    logo?: VCardBinaryData;
    sound?: VCardBinaryData | string;
    geo?: VCardGeo;
    tz?: string;
    key?: VCardBinaryData;
    phoneticFirstName?: string;
    phoneticMiddleName?: string;
    phoneticLastName?: string;
    uid?: string;
    rev?: string;
}

export function parseVCard(text: string): VCardData {
    const result: VCardData = {
        phones: [],
        emails: [],
        urls: [],
        categories: [],
        addresses: [],
        socialProfiles: [],
        relatedNames: [],
        dates: [],
    };
    const lines = unfoldLines(text);
    let pendingLabel: string | undefined;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const [field, value] = splitField(line);
        if (!value && !field.toUpperCase().includes("X-ABLABEL")) continue;

        const stripped = field.replace(/^item\d+\./i, "");
        const key = stripped.split(";")[0]!.toUpperCase();
        const params = stripped.toUpperCase();

        switch (key) {
            case "FN":
                result.fullName = value;
                break;
            case "N": {
                const parts = value.split(";");
                result.lastName = parts[0] || undefined;
                result.firstName = parts[1] || undefined;
                break;
            }
            case "NICKNAME":
                result.nickname = value;
                break;
            case "TEL":
                result.phones.push(value);
                break;
            case "EMAIL":
                result.emails.push(value);
                break;
            case "ORG":
                result.org = value.replace(/;/g, " ").trim() || undefined;
                break;
            case "TITLE":
                result.title = value;
                break;
            case "NOTE":
                result.note = value.replace(/\\,/g, ",").replace(/\\n/g, "\n");
                break;
            case "URL":
                result.urls.push(value);
                break;
            case "BDAY":
                result.birthday = value.replace("value=date:", "");
                break;
            case "ADR": {
                const addr = value
                    .split(";")
                    .filter(Boolean)
                    .map((s) => s.replace(/\\n/g, ", "))
                    .join(", ");
                if (addr) result.addresses.push(addr);
                break;
            }
            case "X-SOCIALPROFILE": {
                const typeMatch = stripped.match(/type=([^;]+)/i);
                const userMatch = stripped.match(/x-user=([^;:]+)/i);
                result.socialProfiles.push({
                    type: typeMatch?.[1]?.toLowerCase() ?? "unknown",
                    username: userMatch?.[1] ? decodeURIComponent(userMatch[1]) : undefined,
                    url: value,
                });
                break;
            }
            case "IMPP": {
                const serviceMatch = params.match(/X-SERVICE-TYPE=([^;]+)/i);
                result.socialProfiles.push({
                    type: (serviceMatch?.[1] ?? "im").toLowerCase(),
                    url: value,
                });
                break;
            }
            case "PHOTO":
                result.photo = { base64: value, mimeType: resolveImageType(stripped, value) };
                break;
            case "LOGO":
                result.logo = { base64: value, mimeType: resolveImageType(stripped, value) };
                break;
            case "SOUND":
                if (stripped.toUpperCase().includes("ENCODING=B")) {
                    const sndType = stripped.match(/TYPE=([^;]+)/i)?.[1]?.toLowerCase();
                    result.sound = { base64: value, mimeType: sndType ? `audio/${sndType}` : "audio/unknown" };
                } else {
                    result.sound = value;
                }
                break;
            case "GEO": {
                const parts = value.split(";").map(Number);
                if (!Number.isNaN(parts[0]!) && !Number.isNaN(parts[1]!))
                    result.geo = { lat: parts[0]!, lng: parts[1]! };
                break;
            }
            case "TZ":
                result.tz = value;
                break;
            case "KEY": {
                const keyType = stripped.match(/TYPE=([^;]+)/i)?.[1]?.toLowerCase();
                result.key = { base64: value, mimeType: keyType ?? "application/x-unknown-key" };
                break;
            }
            case "ROLE":
                result.role = value;
                break;
            case "CATEGORIES":
                result.categories.push(
                    ...value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                );
                break;
            case "X-PHONETIC-FIRST-NAME":
                result.phoneticFirstName = value;
                break;
            case "X-PHONETIC-MIDDLE-NAME":
                result.phoneticMiddleName = value;
                break;
            case "X-PHONETIC-LAST-NAME":
                result.phoneticLastName = value;
                break;
            case "X-ALTBDAY":
                result.altBirthday = value;
                break;
            case "UID":
                result.uid = value;
                break;
            case "REV":
                result.rev = value;
                break;
            case "X-ABRELATEDNAMES":
                result.relatedNames.push({ name: value });
                break;
            case "X-ABDATE":
                result.dates.push({ value });
                break;
            case "X-ABLABEL": {
                const label = cleanLabel(value);
                if (label) {
                    applyLabelToLast(result, label);
                }
                break;
            }
        }
    }

    if (!result.fullName && (result.firstName || result.lastName)) {
        result.fullName = [result.firstName, result.lastName].filter(Boolean).join(" ");
    }

    return result;
}

function cleanLabel(raw: string): string | undefined {
    const cleaned = raw.replace(/_\$!<(.+?)>!\$_/g, "$1").trim();
    return cleaned || undefined;
}

function applyLabelToLast(result: VCardData, label: string): void {
    const rn = result.relatedNames[result.relatedNames.length - 1];
    if (rn && !rn.label) {
        rn.label = label;
        return;
    }

    const d = result.dates[result.dates.length - 1];
    if (d && !d.label) {
        d.label = label;
        return;
    }
}

function unfoldLines(text: string): string[] {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\n[ \t]/g, "")
        .split("\n");
}

function splitField(line: string): [string, string] {
    const idx = line.indexOf(":");
    if (idx === -1) return [line, ""];
    return [line.slice(0, idx), line.slice(idx + 1)];
}

function resolveImageType(field: string, base64: string): string {
    const typeParam = field.match(/TYPE=([^;]+)/i)?.[1]?.toLowerCase();
    if (typeParam === "jpeg" || typeParam === "jpg") return "image/jpeg";
    if (typeParam === "png") return "image/png";
    if (typeParam === "gif") return "image/gif";
    if (typeParam === "bmp") return "image/bmp";
    if (typeParam === "tiff") return "image/tiff";
    return detectImageMime(base64);
}

function detectImageMime(base64: string): string {
    try {
        const head = Buffer.from(base64.slice(0, 40), "base64");
        if (head[0] === 0x89 && head[1] === 0x50) return "image/png";
        if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
        if (head[0] === 0x47 && head[1] === 0x49) return "image/gif";
        if (head.slice(4, 8).toString() === "ftyp") return "image/heic";
        if (head.slice(0, 4).toString() === "RIFF" && head.slice(8, 12).toString() === "WEBP") return "image/webp";
    } catch {}
    return "image/unknown";
}
