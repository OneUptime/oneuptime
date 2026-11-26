import {
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupJSON,
  ISSUE_GROUP_HEADLINE,
  getIssueGroupCauseWords,
} from "Common/Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupLeftOutReason,
} from "Common/Types/DataSecurity/DataSecurityIssueGroupFix";
import {
  PluralTemplate,
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF THE ISSUES ONE MISTAKE MADE (#10370): GROUP BY CAUSE ON THE
 * ISSUES LIST, AND THE ONE FIX OF A GROUP.
 *
 * Kept free of React, so a test can read every word and every rule without
 * drawing the list: IssueGroups and IssueGroupFixModal draw them.
 */

// The Issues list's switch, and what it does.
export const GROUP_BY_CAUSE: string = translationKey("Group by cause");
export const GROUP_BY_CAUSE_TOOLTIP: string = translationKey(
  "Puts together the issues one mistake made: a module, a stack, a tag, a creator or a naming pattern their stores share.",
);

// The groups' region, for a screen reader.
export const GROUPS_LABEL: string = translationKey("Issues grouped by cause");

// The heading over the issues in no group, under the groups.
export const OTHER_ISSUES: string = translationKey("Other Issues");

// Where a group stands: how many are fixed, how many are left.
export const GROUP_PROGRESS: PluralTemplate = {
  one: "{{fixed}} fixed, {{count}} left",
  other: "{{fixed}} fixed, {{count}} left",
};
export const GROUP_ALL_FIXED: PluralTemplate = {
  one: "All {{count}} fixed",
  other: "All {{count}} fixed",
};

// The group's stores, folded under it.
export const SHOW_GROUP_STORES: PluralTemplate = {
  one: "Show its {{count}} store",
  other: "Show its {{count}} stores",
};
export const HIDE_GROUP_STORES: string = translationKey("Hide its stores");
export const GROUP_STORES_FILTERED: PluralTemplate = {
  one: "{{count}} of them matches the filters",
  other: "{{count}} of them match the filters",
};
export const GROUP_MEMBERS_CUT: PluralTemplate = {
  one: "Showing the riskiest {{count}} issue of the groups.",
  other: "Showing the riskiest {{count}} issues of the groups.",
};

// The one action.
export const FIX_THE_CAUSE: string = translationKey("Fix the Cause");

// Grouped, every issue the filters match is in a group above the rows.
export const NO_OTHER_ISSUES: string = translationKey(
  "No other issues. Every issue that matches is in a group above.",
);

/*
 * ---------------------------------------------------------------------------
 * The dialog: one fix for the group
 * ---------------------------------------------------------------------------
 */

export const FIX_DIALOG_DESCRIPTION: string = translationKey(
  "One change fixes every store below. Each issue resolves on its own once its check passes.",
);

export const FIX_PLAN_NOT_LOADED: string = translationKey(
  "What this fix would change could not be loaded.",
);

// The pull request's part.
export const PULL_REQUEST_PART_TITLE: string =
  translationKey("One Pull Request");
export const PULL_REQUEST_PART_SENTENCE: PluralTemplate = {
  one: "OneUptime AI opens one pull request to the {{code}} code that declares {{count}} store, changing the setting it takes.",
  other:
    "OneUptime AI opens one pull request to the {{code}} code that declares these {{count}} stores, changing the setting they all take.",
};
export const PULL_REQUEST_CODE_FOUND: string = translationKey(
  "The grouping found it in {{paths}}.",
);
export const PULL_REQUEST_REPOSITORY: string = translationKey("Repository");
export const PULL_REQUEST_PICK_REPOSITORY: string = translationKey(
  "Choose a repository",
);
export const PULL_REQUEST_ON_ITS_WAY: string = translationKey(
  "Its pull request is on its way, so no second one is opened.",
);
// The part's code, when its stores' tags name none.
export const INFRASTRUCTURE_CODE: string = translationKey("infrastructure");

// A part's stores past the first few it names.
export const MORE_STORES: PluralTemplate = {
  one: "and {{count}} more",
  other: "and {{count}} more",
};

/*
 * The one approval's part: each kind of store's own action, listed with
 * what it does (#10742) - one kind, or several.
 */
export const CLOUD_PART_TITLE: string = translationKey("One Approval");
export const CLOUD_PART_ONE_KIND_SENTENCE: PluralTemplate = {
  one: "The store made in the console takes the change below, through its cloud connection.",
  other:
    "Each of the {{count}} stores made in the console takes the change below, through its cloud connection.",
};
export const CLOUD_PART_KINDS_SENTENCE: PluralTemplate = {
  one: "The store made in the console takes the change its kind needs, through its cloud connection.",
  other:
    "Each of the {{count}} stores made in the console takes the change its kind needs, through its cloud connection. One approval makes them all.",
};
// How many stores one kind's action runs on.
export const CLOUD_ACTION_STORES: PluralTemplate = {
  one: "{{count}} store",
  other: "{{count}} stores",
};
export const CLOUD_PART_NOTE: string = translationKey(
  "This changes your cloud. Each store's timeline says what was changed, so it can be set back in its console.",
);

// Whether a part is made, when the group's fix has both.
export const INCLUDE_PART: string = translationKey("Include this part");

// What each part leaves out, and why.
export const LEFT_OUT_TITLE: string = translationKey("Left Out");
export const LEFT_OUT_SENTENCE: PluralTemplate = {
  one: "{{count}} store stays as it is:",
  other: "{{count}} stores stay as they are:",
};
export const LEFT_OUT_REASONS: Readonly<
  Record<DataSecurityIssueGroupLeftOutReason, string>
> = {
  [DataSecurityIssueGroupLeftOutReason.PublicByDesign]: translationKey(
    "Marked Public By Design, so its access is never closed.",
  ),
  [DataSecurityIssueGroupLeftOutReason.FixWouldBreak]: translationKey(
    "OneUptime AI's analysis says the fix would take away access {{who}} still uses. Tick it to fix it anyway.",
  ),
  [DataSecurityIssueGroupLeftOutReason.NothingToRun]: translationKey(
    "Data Security cannot change this on it: fix it in its console.",
  ),
  [DataSecurityIssueGroupLeftOutReason.NotThroughACloud]: translationKey(
    "Not found through a cloud connection: fix it in its console.",
  ),
  [DataSecurityIssueGroupLeftOutReason.ConnectionGone]: translationKey(
    "Its cloud connection is gone or turned off.",
  ),
  [DataSecurityIssueGroupLeftOutReason.ResponseOff]: translationKey(
    "Its cloud connection's Data security response is off.",
  ),
};
export const FIX_IT_ANYWAY: string = translationKey("Fix it anyway");

// Nothing the reader may do: every part is refused, or leaves every store out.
export const NOTHING_TO_FIX_HERE: string = translationKey(
  "Nothing in this group can be fixed from here.",
);

/*
 * What the server answers a press with, worded here so the reader reads it
 * in their language: the Dashboard looks a message up by its English, so
 * each key is the server's sentence as it writes it (DataSecurityCodeTask,
 * DataSecurityIssueGroupFix).
 */
export const PULL_REQUEST_STARTED: string = translationKey(
  "OneUptime AI is working on one pull request for the cause. It will appear under Code, and on each of the group's issues.",
);
export const GROUP_FIX_SERVER_SENTENCES: ReadonlyArray<string> = [
  translationKey(
    "Asking OneUptime AI for this pull request takes permission to change Data Security issues.",
  ),
  translationKey(
    "Changing these stores through their cloud connections takes permission to edit data stores.",
  ),
  translationKey(
    "This group changed since its fix was shown to you - issues resolved, or stores left it - so nothing was done. Look at what it fixes now.",
  ),
  translationKey(
    "Nothing in this group can be fixed from here: every store is left out of its fix.",
  ),
  translationKey(
    "This group of issues could not be found. Its issues may have resolved, or no longer share a cause.",
  ),
  // A reader held to labels reads the group, and asks for no fix (#10739).
  translationKey(
    "Asking for a group's fix takes permission to read Data Security issues across the whole project.",
  ),
];

// What one press did.
export const CLOUD_PART_DONE: PluralTemplate = {
  one: "{{action}}: {{count}} store changed.",
  other: "{{action}}: {{count}} stores changed.",
};
export const CLOUD_PART_FAILED: PluralTemplate = {
  one: "{{count}} store could not be changed: {{reason}}",
  other: "{{count}} stores could not be changed. The first said: {{reason}}",
};

/*
 * ---------------------------------------------------------------------------
 * The issue's own page: its analysis points at its group
 * ---------------------------------------------------------------------------
 */

export const PART_OF_A_GROUP: string = translationKey(
  "This issue is one of a group. Fixing their cause fixes them all at once.",
);

/*
 * ---------------------------------------------------------------------------
 * Rules
 * ---------------------------------------------------------------------------
 */

// The group's cause in the reader's words: OneUptime AI's name while AI is on, else its facts'.
export function getGroupCause(
  group: Pick<DataSecurityIssueGroupJSON, "facts" | "name">,
  translator: Translator,
): string {
  if (group.name) {
    return group.name;
  }

  const words: { key: string; values: Record<string, string> } =
    getIssueGroupCauseWords(group.facts as DataSecurityIssueGroupFacts);

  return translator.translateTemplate(words.key, words.values, {
    setsValuesApart: true,
  });
}

// "40 issues, one cause: the static-site module", in the reader's words.
export function getGroupHeadline(
  group: Pick<DataSecurityIssueGroupJSON, "facts" | "name" | "issueCount">,
  translator: Translator,
): string {
  return translator.translatePlural(ISSUE_GROUP_HEADLINE, group.issueCount, {
    cause: composedValue((sentence: Translator): string => {
      return getGroupCause(group, sentence);
    }),
  });
}

// "12 fixed, 28 left", or "All 40 fixed".
export function getGroupProgress(
  group: Pick<
    DataSecurityIssueGroupJSON,
    "issueCount" | "openIssueCount" | "fixedIssueCount"
  >,
  translator: Translator,
): string {
  if (group.openIssueCount === 0) {
    return translator.translatePlural(GROUP_ALL_FIXED, group.issueCount);
  }

  return translator.translatePlural(GROUP_PROGRESS, group.openIssueCount, {
    fixed: translator.formatNumber(group.fixedIssueCount),
  });
}

/*
 * Which of the issues the Issues list draws as its rows, grouped by cause
 * (#10370): those in no group the reader sees as a group. Most readers see
 * every group an issue they may read is in, so that is the issues in no
 * group at all. A reader held to labels (#10739) is not shown a group of
 * which they may read only one issue - a group of one would say there are
 * others - so its issue is listed with the rest: the rows are then the
 * issues in none of the groups drawn. Until the groups' issues are read,
 * the issues in no group.
 */
export type IssueRowsGroupFilter =
  | { kind: "inNoGroup" }
  | { kind: "inNoneOf"; groupIds: Array<string> }
  | { kind: "all" };

export function getIssueRowsGroupFilter(data: {
  isGroupedByCause: boolean;
  // The groups' issues the list's filters match have been read.
  isMembersRead: boolean;
  // The groups drawn above the rows.
  drawnGroupIds: ReadonlyArray<string>;
  // The groups of the grouped issues the filters match.
  memberGroupIds: ReadonlyArray<string>;
}): IssueRowsGroupFilter {
  if (!data.isGroupedByCause) {
    return { kind: "all" };
  }

  const drawn: Set<string> = new Set(
    data.drawnGroupIds.map((id: string): string => {
      return id.toLowerCase();
    }),
  );
  const isAnyGroupNotDrawn: boolean = data.memberGroupIds.some(
    (id: string): boolean => {
      return !drawn.has(id.toLowerCase());
    },
  );

  if (!data.isMembersRead || !isAnyGroupNotDrawn) {
    return { kind: "inNoGroup" };
  }

  return drawn.size > 0
    ? { kind: "inNoneOf", groupIds: Array.from(drawn).sort() }
    : { kind: "all" };
}

// The parts a press makes by default: each the plan offers and the reader may make.
export function getOfferedParts(
  plan: Pick<DataSecurityIssueGroupFixPlanJSON, "pullRequest" | "cloud">,
): Array<DataSecurityIssueGroupFixPart> {
  const parts: Array<DataSecurityIssueGroupFixPart> = [];

  if (
    plan.pullRequest &&
    plan.pullRequest.stores.length > 0 &&
    !plan.pullRequest.refusal
  ) {
    parts.push(DataSecurityIssueGroupFixPart.PullRequest);
  }

  if (plan.cloud && plan.cloud.stores.length > 0 && !plan.cloud.refusal) {
    parts.push(DataSecurityIssueGroupFixPart.Cloud);
  }

  return parts;
}
