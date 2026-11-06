import { DataProductStatus } from "./DataProductFreshness";

/*
 * A DATA PRODUCT'S BADGE: "DATA AS OF ...", FOR A BI DASHBOARD OR A WIKI.
 *
 * The people looking at a dashboard want to know whether its numbers are
 * today's without asking anyone. The badge says what the data is as of
 * (the oldest last change among the product's tables), in UTC, green while
 * the product is on time and amber, with "late", once it is not - the word
 * as well as the colour, for a reader who cannot tell them apart. It is
 * hand-built SVG, so every value in it is escaped.
 */

const MONTHS: ReadonlyArray<string> = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const LABEL: string = "data as of";
const FONT_WIDTH: number = 6.6;
const PADDING: number = 12;

const COLORS: Record<DataProductStatus, string> = {
  [DataProductStatus.OnTime]: "#16a34a",
  [DataProductStatus.Late]: "#d97706",
  [DataProductStatus.Unknown]: "#6b7280",
};

export function escapeBadgeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// "Nov 3, 07:12 UTC": the day and the time, in UTC, as a badge has room for.
export function formatDataAsOf(dataAsOf: Date): string {
  const hours: string = String(dataAsOf.getUTCHours()).padStart(2, "0");
  const minutes: string = String(dataAsOf.getUTCMinutes()).padStart(2, "0");

  return `${MONTHS[dataAsOf.getUTCMonth()]} ${dataAsOf.getUTCDate()}, ${hours}:${minutes} UTC`;
}

export function getDataProductBadgeText(data: {
  status: DataProductStatus;
  dataAsOf: Date | null;
}): string {
  if (!data.dataAsOf) {
    return "unknown";
  }

  const asOf: string = formatDataAsOf(data.dataAsOf);

  return data.status === DataProductStatus.Late ? `${asOf} - late` : asOf;
}

function textWidth(text: string): number {
  return Math.round(text.length * FONT_WIDTH + PADDING);
}

export function renderDataProductBadge(data: {
  status: DataProductStatus;
  dataAsOf: Date | null;
}): string {
  const value: string = getDataProductBadgeText(data);
  const labelWidth: number = textWidth(LABEL);
  const valueWidth: number = textWidth(value);
  const width: number = labelWidth + valueWidth;
  const color: string =
    COLORS[data.status] || COLORS[DataProductStatus.Unknown];
  const label: string = escapeBadgeText(LABEL);
  const text: string = escapeBadgeText(value);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${text}">
  <title>${label}: ${text}</title>
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="${width}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
    <path fill="${color}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
    <path fill="url(#b)" d="M0 0h${width}v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${text}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${text}</text>
  </g>
</svg>`;
}
