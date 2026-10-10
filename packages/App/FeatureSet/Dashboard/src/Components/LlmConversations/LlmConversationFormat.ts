/*
 * How the AI pages write numbers: a latency, a cost, a token count. Pure, so
 * the rules are pinned by tests and every surface (the list, the replay, the
 * alert cards) writes "2.3 s" and "$0.0012" the same way.
 *
 * Units and symbols read the same in every language the Dashboard ships, so
 * they are not routed through translation.
 */

// "850 ms", "2.3 s", "42 s", "4m 05s", "1h 02m".
export function formatLlmDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0 ms";
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  if (ms < 10_000) {
    return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
  }

  if (ms < 60_000) {
    return `${Math.round(ms / 1000)} s`;
  }

  const totalSeconds: number = Math.round(ms / 1000);

  if (totalSeconds < 3600) {
    const minutes: number = Math.floor(totalSeconds / 60);
    const seconds: number = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  const totalMinutes: number = Math.round(totalSeconds / 60);
  const hours: number = Math.floor(totalMinutes / 60);
  const minutes: number = totalMinutes % 60;

  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/*
 * "$0", "<$0.0001", "$0.0012", "$0.042", "$12.40", "$1,204.00". A single
 * call costs fractions of a cent, so small amounts keep their digits; a
 * total reads like money.
 */
export function formatLlmCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) {
    return "$0";
  }

  if (usd < 0.0001) {
    return "<$0.0001";
  }

  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }

  if (usd < 1) {
    return `$${usd.toFixed(3)}`;
  }

  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// "850", "12.3k", "4.5M".
export function formatLlmTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "0";
  }

  if (count < 1000) {
    return String(Math.round(count));
  }

  if (count < 1_000_000) {
    const thousands: number = Math.round(count / 100) / 10;
    return `${thousands >= 100 ? Math.round(thousands) : thousands}k`;
  }

  const millions: number = Math.round(count / 100_000) / 10;
  return `${millions >= 100 ? Math.round(millions) : millions}M`;
}

// "1,204".
export function formatLlmCount(count: number): string {
  if (!Number.isFinite(count)) {
    return "0";
  }

  return Math.round(count).toLocaleString("en-US");
}

// "3.1%" of a whole; "0%" when there is no whole.
export function formatLlmShare(part: number, whole: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return "0%";
  }

  const percent: number = (part / whole) * 100;

  if (percent > 0 && percent < 0.1) {
    return "<0.1%";
  }

  return `${percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10}%`;
}

// The replay clock: "0:07", "1:05", "1:02:09".
export function formatLlmClock(ms: number): string {
  const totalSeconds: number = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours: number = Math.floor(totalSeconds / 3600);
  const minutes: number = Math.floor((totalSeconds % 3600) / 60);
  const seconds: number = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/*
 * Text cut for a one-line preview, on a character boundary, with an
 * ellipsis when it was cut. Never splits a surrogate pair.
 */
export function truncateLlmText(text: string, length: number): string {
  const characters: Array<string> = Array.from(text || "");

  if (characters.length <= length) {
    return characters.join("");
  }

  return `${characters.slice(0, Math.max(0, length - 1)).join("").trimEnd()}…`;
}

/*
 * Whitespace runs read as one space, for a one-line preview. A loop over at
 * most `limit` characters - never a regular expression over a value that can
 * be megabytes long (a tool's result, a pasted document).
 */
export function collapseLlmWhitespace(text: string, limit: number): string {
  let collapsed: string = "";
  let lastWasSpace: boolean = true;
  let read: number = 0;

  for (const character of text || "") {
    if (read >= limit) {
      break;
    }

    read++;

    const isSpace: boolean =
      character === " " ||
      character === "\n" ||
      character === "\t" ||
      character === "\r";

    if (isSpace) {
      if (!lastWasSpace) {
        collapsed += " ";
      }
      lastWasSpace = true;
      continue;
    }

    collapsed += character;
    lastWasSpace = false;
  }

  return collapsed.trimEnd();
}

/*
 * A tool call's arguments for one line: JSON written compactly
 * ({"city":"Paris"}), anything else as it is.
 */
export function compactLlmArguments(value: string): string {
  const trimmed: string = (value || "").trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.length > 20_000) {
    return trimmed;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return trimmed;
  }
}

/*
 * Arguments or a result for a code block: JSON pretty-printed, anything
 * else as it is.
 */
export function prettyLlmJson(value: string): string {
  const trimmed: string = (value || "").trim();

  if (!trimmed || trimmed.length > 200_000) {
    return trimmed;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}
