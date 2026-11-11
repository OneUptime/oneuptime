import { UserFlowScope } from "./UserFlowScope";
import { translationKey, Translator } from "Common/Types/Translator";

/*
 * Number formatting for the User Flows page. Pure, so the copy the page
 * prints is pinned by node tests. Given the reader's Translator, a count and
 * a sentence read in the reader's language; without one they read in
 * English, as the tests pin them.
 */

/*
 * The map's own name for the pages it folds together at a step: Common's
 * OTHER_PAGES_LABEL, which the map, its tooltips and the detail panel look
 * up by its English. Named here, where the Dashboard's locales are drawn
 * from, so each language words it (a test pins the two equal); before, no
 * locale held it and every reader saw "Other pages".
 */
export const USER_FLOW_OTHER_PAGES_NAME: string = translationKey("Other pages");

export function formatUserFlowCount(
  value: number,
  translator?: Translator | undefined,
): string {
  if (!Number.isFinite(value)) {
    return translator ? translator.formatNumber(0) : "0";
  }

  if (translator) {
    return translator.formatNumber(Math.round(value));
  }

  return Math.round(value).toLocaleString("en-US");
}

/* 0.4567 -> "46%", 0.004 -> "<1%", 0 -> "0%". */
export function formatUserFlowShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) {
    return "0%";
  }

  const percent: number = share * 100;

  if (percent < 1) {
    return "<1%";
  }

  if (percent < 10 && Math.round(percent) !== percent) {
    return `${percent.toFixed(1)}%`;
  }

  return `${Math.round(percent)}%`;
}

export function formatUserFlowDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }

  const seconds: number = Math.round(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes: number = Math.floor(seconds / 60);
  const rest: number = seconds % 60;

  if (minutes < 60) {
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  const hours: number = Math.floor(minutes / 60);
  const restMinutes: number = minutes % 60;

  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

/*
 * A label that fits a node box: keep the END of a path, which is the part
 * that names the page ("…/orders/:id/refund"), not the start.
 */
export function truncateUserFlowLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) {
    return label;
  }

  if (maxChars <= 1) {
    return "…";
  }

  return `…${label.slice(label.length - (maxChars - 1))}`;
}

export function pluralizeSessions(
  count: number,
  translator?: Translator | undefined,
): string {
  if (translator) {
    return translator.translatePlural(
      { one: "{{count}} session", other: "{{count}} sessions" },
      Number.isFinite(count) ? Math.round(count) : 0,
    );
  }

  return `${formatUserFlowCount(count)} session${count === 1 ? "" : "s"}`;
}

/*
 * The line under "Sessions analysed". It says whose sessions they are, so a
 * person's numbers never read as everyone's, wherever the banner that names
 * them has scrolled to. A read the server cut to the newest sessions says so
 * instead, for anyone: how many it read of how many there were. That is the
 * read, before the page's filters, which the number above already applies.
 */
export function formatUserFlowSessionsHint(
  input: {
    /* Sessions the read answered with. */
    sessionsRead: number;
    sessionsInWindow: number;
    isSampled: boolean;
    /* Null or absent for everyone. */
    scopeKind?: UserFlowScope["kind"] | null | undefined;
  },
  translator?: Translator | undefined,
): string {
  const say: (text: string) => string = (text: string): string => {
    return translator?.translateText(text) || text;
  };

  if (input.isSampled) {
    if (translator) {
      return translator.translateTemplate(
        "newest {{read}} of {{total}} recorded",
        {
          read: formatUserFlowCount(input.sessionsRead, translator),
          total: formatUserFlowCount(input.sessionsInWindow, translator),
        },
      );
    }

    return `newest ${formatUserFlowCount(
      input.sessionsRead,
    )} of ${formatUserFlowCount(input.sessionsInWindow)} recorded`;
  }

  if (!input.scopeKind) {
    return say(translationKey("recorded sessions in range"));
  }

  switch (input.scopeKind) {
    case "user":
      return say(translationKey("this user's sessions in range"));
    case "visitor":
      return say(translationKey("this visitor's sessions in range"));
    case "session":
      return say(translationKey("this session only"));
  }
}
