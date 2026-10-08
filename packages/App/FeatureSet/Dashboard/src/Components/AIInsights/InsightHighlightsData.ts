import {
  AIInsightHighlightFinding,
  AIInsightHighlightService,
  AIInsightHighlights,
} from "Common/Types/AI/AIInsightHighlights";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  translatePlural,
  translateTemplate,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure half of the AI Insights inbox's lead (InsightHighlights): how it
 * reads POST /ai-insight/highlights and the words for each highlight. The
 * server sends titles, names and numbers, and the triage's own words; every
 * sentence is built here, in the reader's language. Import-clean (Common
 * types and the translation helpers only) so the suites read it without a
 * browser.
 */

export const INSIGHT_HIGHLIGHTS_TITLE: string = translationKey(
  "What to look at first",
);

export const INSIGHT_HIGHLIGHTS_DESCRIPTION: string = translationKey(
  "The open finding that matters most right now, where most of them are, and what is new.",
);

// The small line over each highlight's heading.
export const INSIGHT_HIGHLIGHT_LABELS: {
  topFinding: string;
  topService: string;
  newest: string;
} = {
  topFinding: translationKey("Look at this first"),
  topService: translationKey("Where most of them are"),
  newest: translationKey("New this week"),
};

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readFinding(value: unknown): AIInsightHighlightFinding | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);
  const title: string | null = readString(value["title"]);

  if (!id || !title) {
    return null;
  }

  const serviceName: string | null = readString(value["serviceName"]);
  const firstSeenAt: string | null = readString(value["firstSeenAt"]);
  const lastSeenAt: string | null = readString(value["lastSeenAt"]);
  const triageSummary: string | null = readString(value["triageSummary"]);
  const occurrenceCount: unknown = value["occurrenceCount"];

  return {
    id,
    title,
    insightType: readString(value["insightType"]) || "",
    severity: readString(value["severity"]) || "",
    ...(serviceName ? { serviceName } : {}),
    ...(typeof occurrenceCount === "number" &&
    Number.isFinite(occurrenceCount) &&
    occurrenceCount >= 0
      ? { occurrenceCount: Math.floor(occurrenceCount) }
      : {}),
    ...(firstSeenAt ? { firstSeenAt } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(triageSummary ? { triageSummary } : {}),
  };
}

function readService(value: unknown): AIInsightHighlightService | null {
  if (!isObject(value)) {
    return null;
  }

  const name: string | null = readString(value["name"]);
  const id: string | null = readString(value["id"]);
  const count: number = readCount(value["count"]);

  return name && count > 0 ? { name, count, ...(id ? { id } : {}) } : null;
}

/*
 * The highlights as the route returns them, or null when the body is not
 * that shape at all.
 */
export function parseAIInsightHighlights(
  value: unknown,
): AIInsightHighlights | null {
  if (!isObject(value) || typeof value["openCount"] !== "number") {
    return null;
  }

  const topFinding: AIInsightHighlightFinding | null = readFinding(
    value["topFinding"],
  );
  const topService: AIInsightHighlightService | null = readService(
    value["topService"],
  );
  const newest: AIInsightHighlightFinding | null = readFinding(value["newest"]);

  return {
    openCount: readCount(value["openCount"]),
    ...(topFinding ? { topFinding } : {}),
    ...(topService ? { topService } : {}),
    newCount: readCount(value["newCount"]),
    ...(newest ? { newest } : {}),
    isPartial: value["isPartial"] === true,
  };
}

// Whether there is anything to lead with.
export function hasHighlights(highlights: AIInsightHighlights | null): boolean {
  return Boolean(highlights && highlights.topFinding);
}

function describeWhen(at: string | undefined): string | null {
  if (!at) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(at);

  return Number.isNaN(date.getTime()) ? null : OneUptimeDate.fromNow(date);
}

/*
 * A finding's line: what kind it is, the service, how often it was seen and
 * when last — separate phrases, joined like a list. `typeLabel` is the
 * detector's label (English key), translated here.
 */
export function describeHighlightFinding(
  finding: AIInsightHighlightFinding,
  typeLabel: string,
): string {
  const parts: Array<string> = [];

  if (typeLabel) {
    parts.push(translateText(typeLabel) || typeLabel);
  }

  if (finding.serviceName) {
    parts.push(
      translateTemplate("in {{service}}", { service: finding.serviceName }),
    );
  }

  if (finding.occurrenceCount !== undefined) {
    parts.push(
      translatePlural(
        { one: "seen {{count}} time", other: "seen {{count}} times" },
        finding.occurrenceCount,
      ),
    );
  }

  const lastSeen: string | null = describeWhen(finding.lastSeenAt);

  if (lastSeen) {
    parts.push(translateTemplate("last seen {{when}}", { when: lastSeen }));
  }

  return parts.join(" · ");
}

// "The checkout service has 5 of the 12 open findings."
export function describeServiceHighlight(
  service: AIInsightHighlightService,
  openCount: number,
): string {
  return translatePlural(
    {
      one: "The {{name}} service has {{shown}} of the {{count}} open finding",
      other:
        "The {{name}} service has {{shown}} of the {{count}} open findings",
    },
    Math.max(openCount, service.count),
    { name: service.name, shown: service.count },
  );
}

// The sentence under the service's: what to do with it.
export const INSIGHT_SERVICE_HIGHLIGHT_ADVICE: string = translationKey(
  "Findings that share a service often share a cause: start there.",
);

// "3 new findings in the last 7 days."
export function describeNewHighlight(newCount: number): string {
  return translatePlural(
    {
      one: "{{count}} new finding in the last 7 days",
      other: "{{count}} new findings in the last 7 days",
    },
    newCount,
  );
}

// "The newest: Error logs from checkout spiked 6x, first seen 2 hours ago."
export function describeNewestFinding(
  newest: AIInsightHighlightFinding,
): string {
  const firstSeen: string | null = describeWhen(newest.firstSeenAt);

  return firstSeen
    ? translateTemplate("The newest: {{title}}, first seen {{when}}.", {
        title: newest.title,
        when: firstSeen,
      })
    : translateTemplate("The newest: {{title}}.", { title: newest.title });
}
