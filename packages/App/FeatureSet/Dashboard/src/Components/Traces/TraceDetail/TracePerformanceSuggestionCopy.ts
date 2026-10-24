import {
  PerformanceFinding,
  PerformanceFindingType,
} from "Common/Types/AI/CodeFixTaskContext";
import {
  getFindingOperationName,
  isDatabaseFinding,
} from "Common/Utils/Suggestions/TracePerformanceFixSuggestion";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The plain words the trace page uses for a finding worth "Fix performance
 * with AI": what was found ("The same database query ran 14 times in POST
 * /checkout"), what it costs ("Together they take 840 ms of this 1.6 s
 * request."), and - for database work - the query itself on a line of its
 * own. Which findings are offered at all is not decided here: that is
 * Common/Utils/Suggestions/TracePerformanceFixSuggestion, which the server
 * applies before the page ever sees a finding.
 *
 * English keys only (translationKey / PluralTemplate literals, so the i18n
 * extractor finds them); TracePerformanceSuggestion looks them up where it
 * draws them. React-free, so the rules here are tested without rendering.
 */

/*
 * {{count}} is the number of calls, {{operation}} the call's name and
 * {{parent}} the span they ran under.
 */
const REPEATED_QUERY: PluralTemplate = {
  one: "The same database query ran {{count}} time in {{parent}}",
  other: "The same database query ran {{count}} times in {{parent}}",
};

const REPEATED_QUERY_NO_PARENT: PluralTemplate = {
  one: "The same database query ran {{count}} time",
  other: "The same database query ran {{count}} times",
};

const REPEATED_CALL: PluralTemplate = {
  one: "{{operation}} ran {{count}} time in {{parent}}",
  other: "{{operation}} ran {{count}} times in {{parent}}",
};

const REPEATED_CALL_NO_PARENT: PluralTemplate = {
  one: "{{operation}} ran {{count}} time",
  other: "{{operation}} ran {{count}} times",
};

const QUERIES_ONE_AFTER_ANOTHER: PluralTemplate = {
  one: "{{count}} database call ran one after another in {{parent}}",
  other: "{{count}} database calls ran one after another in {{parent}}",
};

const CALLS_ONE_AFTER_ANOTHER: PluralTemplate = {
  one: "{{count}} call to {{operation}} ran one after another in {{parent}}",
  other: "{{count}} calls to {{operation}} ran one after another in {{parent}}",
};

// {{duration}} is the finding's time, {{total}} the whole request's.
const TOGETHER_THEY_TAKE: string = translationKey(
  "Together they take {{duration}} of this {{total}} request.",
);

const TOGETHER_THEY_COULD_RUN_AT_ONCE: string = translationKey(
  "Together they take {{duration}} of this {{total}} request, and they could run at the same time.",
);

const IT_TAKES_ON_ITS_OWN: string = translationKey(
  "It takes {{duration}} of this {{total}} request on its own.",
);

const SLOW_QUERY: string = translationKey(
  "One database query took most of this request",
);

const SLOW_CALL: string = translationKey(
  "{{operation}} took most of this request",
);

export interface PerformanceFindingWords {
  /*
   * What was found. A PluralTemplate is filled with the finding's call
   * count; both kinds take {{operation}} and {{parent}} where they appear.
   */
  headline: string | PluralTemplate;
  // The calls the headline counts (the PluralTemplate's {{count}}).
  count: number;
  // The call's name, for {{operation}}.
  operation: string;
  // The span the calls ran under, for {{parent}}; empty when unknown.
  parent: string;
  // What it costs: {{duration}} of this {{total}} request.
  detail: string;
  /*
   * The database query, drawn on its own line under the headline (the
   * headline says "the same database query" and does not repeat it).
   * Empty for other calls, whose name is in the headline.
   */
  query: string;
}

export function getPerformanceFindingWords(
  finding: PerformanceFinding,
): PerformanceFindingWords {
  const isDatabase: boolean = isDatabaseFinding(finding);
  const operation: string = getFindingOperationName(finding);
  const parent: string = finding.parentSpanName || "";
  const query: string = isDatabase
    ? finding.normalizedDbStatement || operation
    : "";

  switch (finding.findingType) {
    case PerformanceFindingType.SequentialSiblings:
      return {
        headline: isDatabase
          ? QUERIES_ONE_AFTER_ANOTHER
          : CALLS_ONE_AFTER_ANOTHER,
        count: finding.spanCount,
        operation,
        parent,
        detail: TOGETHER_THEY_COULD_RUN_AT_ONCE,
        query,
      };
    case PerformanceFindingType.DominantSpan:
      return {
        headline: isDatabase ? SLOW_QUERY : SLOW_CALL,
        count: 1,
        operation,
        parent,
        detail: IT_TAKES_ON_ITS_OWN,
        query,
      };
    case PerformanceFindingType.NPlusOneQuery:
    default:
      return {
        headline: isDatabase
          ? parent
            ? REPEATED_QUERY
            : REPEATED_QUERY_NO_PARENT
          : parent
            ? REPEATED_CALL
            : REPEATED_CALL_NO_PARENT,
        count: finding.spanCount,
        operation,
        parent,
        detail: TOGETHER_THEY_TAKE,
        query,
      };
  }
}

/*
 * The spans "Show them" reveals: the implicated spans that are in the
 * loaded tree, in the order the analysis listed them.
 */
export function getShownSpanIds(
  finding: PerformanceFinding,
  isLoaded: (spanId: string) => boolean,
): Array<string> {
  return finding.implicatedSpans
    .map((span: { spanId: string }): string => {
      return span.spanId;
    })
    .filter((spanId: string): boolean => {
      return Boolean(spanId) && isLoaded(spanId);
    });
}

/*
 * The span search that keeps every implicated span in view: their shared
 * name, when they all carry the same one. Calls whose names differ by an id
 * have no search that matches them all and nothing else, so none is set.
 */
export function getShownSpanSearch(finding: PerformanceFinding): string {
  if (finding.findingType === PerformanceFindingType.DominantSpan) {
    return "";
  }

  const names: Array<string> = finding.implicatedSpans.map(
    (span: { name: string }): string => {
      return span.name;
    },
  );

  if (
    names.length > 0 &&
    names[0] &&
    names.every((name: string): boolean => {
      return name === names[0];
    })
  ) {
    return names[0];
  }

  return "";
}

// The button, the links and the states around them.
export const FIX_PERFORMANCE_BUTTON_TITLE: string = translationKey(
  "Fix performance with AI",
);

export const FIX_PERFORMANCE_BUTTON_TOOLTIP: string = translationKey(
  "OneUptime AI opens a pull request that fixes this, for you to review.",
);

/*
 * Where a project has no repository AI can work in: a repository on any
 * host Code connects (GitHub, GitLab, Forgejo or Gitea, any Git server).
 */
export const CONNECT_REPOSITORY_TO_FIX: string = translationKey(
  "Connect a repository to fix this with AI",
);

export const AI_IS_WORKING_ON_A_FIX: string = translationKey(
  "OneUptime AI is working on a fix.",
);

export const VIEW_TASK_PROGRESS: string = translationKey("View task progress");

export const SHOW_THEM: string = translationKey("Show them");

export const SHOW_IT: string = translationKey("Show it");

export const COULD_NOT_START_THE_FIX: string = translationKey(
  "Could not start the fix: {{reason}}",
);
