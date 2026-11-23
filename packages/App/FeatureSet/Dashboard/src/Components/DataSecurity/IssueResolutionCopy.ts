import DataSecurityIssueResolution, {
  ALL_DATA_SECURITY_ISSUE_RESOLUTIONS,
  DataSecurityIssueResolutionDetails,
  DataSecurityIssueResolutionFix,
  isFixedAtSource,
} from "Common/Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { PluralTemplate, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF HOW AN ISSUE WAS RESOLVED (#10368): its page's resolution
 * line, the Issues list's pill and filter, and what contains a leak at
 * ingest.
 *
 * "Resolved" alone could not tell a leak fixed in the code from one a scrub
 * rule only hides. Each resolution reads plainly: "Fixed in pull request
 * #482, deployed in version 2.4.1, verified Nov 21, 2026, 2:10 PM". And a
 * leak contained at ingest never reads as fixed: amber, "not fixed", with
 * what fixes it.
 *
 * Kept free of React, so a test reads every word and rule without drawing
 * the page: IssueResolution draws them.
 */

// What a resolution is called in a pill, a filter and the list.
export const RESOLUTION_LABELS: Record<DataSecurityIssueResolution, string> = {
  [DataSecurityIssueResolution.FixedInCode]: translationKey("Fixed in code"),
  [DataSecurityIssueResolution.FixedInInfrastructureCode]: translationKey(
    "Fixed in infrastructure code",
  ),
  [DataSecurityIssueResolution.FixedFromHere]: translationKey("Fixed from here"),
  [DataSecurityIssueResolution.ContainedAtIngest]: translationKey(
    "Contained at ingest",
  ),
  [DataSecurityIssueResolution.CheckPassed]: translationKey("Check passed"),
  [DataSecurityIssueResolution.ResolvedByPerson]:
    translationKey("Resolved by a person"),
  [DataSecurityIssueResolution.NoLongerChecked]:
    translationKey("No longer checked"),
  [DataSecurityIssueResolution.StoreArchived]: translationKey("Store archived"),
};

// What each says when hovered: what it means for the data.
export const RESOLUTION_TOOLTIPS: Record<DataSecurityIssueResolution, string> =
  {
    [DataSecurityIssueResolution.FixedInCode]: translationKey(
      "A code fix shipped, and production showed its new version no longer writes the data.",
    ),
    [DataSecurityIssueResolution.FixedInInfrastructureCode]: translationKey(
      "A change to the code that declares the store merged, and the store has passed its check since it was applied.",
    ),
    [DataSecurityIssueResolution.FixedFromHere]: translationKey(
      "A response action changed the store through its cloud connection, and its check has passed since.",
    ),
    [DataSecurityIssueResolution.ContainedAtIngest]: translationKey(
      "A scrub rule hides the data before it is stored, but the code still writes it: not fixed.",
    ),
    [DataSecurityIssueResolution.CheckPassed]: translationKey(
      "Its check passes, for no change OneUptime made.",
    ),
    [DataSecurityIssueResolution.ResolvedByPerson]: translationKey(
      "A person marked it resolved. It opens again if its check still fails.",
    ),
    [DataSecurityIssueResolution.NoLongerChecked]: translationKey(
      "Its check was turned off, or no longer applies to the store.",
    ),
    [DataSecurityIssueResolution.StoreArchived]: translationKey(
      "Its store is gone from its source.",
    ),
  };

// The Issues list's filter: every resolution, the fixed ones first.
export const RESOLUTION_FILTER_TITLE: string = translationKey("Resolution");

export function getResolutionOptions(): Array<DropdownOption> {
  return ALL_DATA_SECURITY_ISSUE_RESOLUTIONS.map(
    (resolution: DataSecurityIssueResolution): DropdownOption => {
      return { value: resolution, label: RESOLUTION_LABELS[resolution] };
    },
  );
}

// How a resolution looks: fixed, only contained, or closed another way.
export enum ResolutionTone {
  Fixed = "Fixed",
  Contained = "Contained",
  Closed = "Closed",
  // A leak that came back after its verified fix.
  CameBack = "CameBack",
}

export function getResolutionTone(
  resolution: DataSecurityIssueResolution | string | null | undefined,
): ResolutionTone {
  if (resolution === DataSecurityIssueResolution.ContainedAtIngest) {
    return ResolutionTone.Contained;
  }

  return isFixedAtSource(resolution)
    ? ResolutionTone.Fixed
    : ResolutionTone.Closed;
}

/*
 * ---------------------------------------------------------------------------
 * The issue's resolution line
 * ---------------------------------------------------------------------------
 */

// A code fix production proved: the pull request, the version, when.
export const FIXED_IN_CODE_IN_VERSION: string = translationKey(
  "Fixed in pull request {{pullRequest}}, deployed in version {{version}}, verified {{time}}.",
);
export const FIXED_IN_CODE_IN_COMMIT: string = translationKey(
  "Fixed in pull request {{pullRequest}}, deployed in commit {{commit}}, verified {{time}}.",
);
export const FIXED_IN_CODE: string = translationKey(
  "Fixed in pull request {{pullRequest}}, deployed, verified {{time}}.",
);

// A fix in infrastructure code: applied, its check passing.
export const FIXED_IN_INFRASTRUCTURE_CODE: string = translationKey(
  "Fixed in pull request {{pullRequest}}, applied, verified {{time}}.",
);

// A pull request with no number: what the slot says instead.
export const A_PULL_REQUEST: string = translationKey("a pull request");

export const FIXED_FROM_HERE_WITH: string = translationKey(
  "Fixed from here with {{action}}, {{time}}. Its check has passed since.",
);
export const FIXED_FROM_HERE: string = translationKey(
  "Fixed from here, {{time}}. Its check has passed since.",
);
export const CHECK_PASSED_AT: string = translationKey(
  "Resolved {{time}}: its check passes.",
);
export const RESOLVED_BY_PERSON_AT: string = translationKey(
  "Marked resolved {{time}}. It opens again if its check still fails.",
);
export const NO_LONGER_CHECKED_AT: string = translationKey(
  "Resolved {{time}}: its check no longer runs on this store. It was turned off, or no longer applies.",
);
export const STORE_ARCHIVED_AT: string = translationKey(
  "Resolved {{time}}: its store was archived, as its source no longer lists it.",
);

// Contained at ingest: never fixed.
export const CONTAINED_TITLE: string = translationKey(
  "Contained at ingest, not fixed",
);
export const CONTAINED_BODY: string = translationKey(
  "A scrub rule hides this data before OneUptime stores it, but the code still writes it: to stdout, and to every other place the service sends its telemetry. Fix the code to stop it where it starts.",
);
export const FIX_THE_CODE: string = translationKey("Fix the Code");

// The leak came back after its verified fix.
export const CAME_BACK_IN_VERSION: string = translationKey(
  "The leak came back in version {{version}}, after pull request {{pullRequest}} fixed it in version {{fixedVersion}}.",
);
export const CAME_BACK_AFTER_PULL_REQUEST: string = translationKey(
  "The leak came back after pull request {{pullRequest}} fixed it.",
);
export const CAME_BACK_IN_VERSION_AFTER_FIX: string = translationKey(
  "The leak came back in version {{version}}, after its fix was verified.",
);
export const CAME_BACK_STAYS_OPEN: string = translationKey(
  "It stays open until it is fixed again, even while a scrub rule hides it at ingest.",
);

/*
 * ---------------------------------------------------------------------------
 * What contains it at ingest, and the rule kept after a verified fix
 * ---------------------------------------------------------------------------
 */

// The rule that hides it, and what it changed lately: whether the code still writes it.
export const RULE_CHANGED_LATELY: PluralTemplate = {
  one: "{{rule}} changed {{count}} value in this service in the last {{days}} days, the latest in version {{version}}.",
  other:
    "{{rule}} changed {{count}} values in this service in the last {{days}} days, the latest in version {{version}}.",
};
export const RULE_CHANGED_LATELY_NO_VERSION: PluralTemplate = {
  one: "{{rule}} changed {{count}} value in this service in the last {{days}} days.",
  other:
    "{{rule}} changed {{count}} values in this service in the last {{days}} days.",
};
export const RULE_CHANGED_NOTHING_LATELY: string = translationKey(
  "{{rule}} changed no value in this service in the last {{days}} days.",
);
export const RULE_NOT_COUNTED: string = translationKey(
  "{{rule}} hides it. What a metric pipeline rule changes is not counted.",
);

// After a verified code fix: the rules that contained it are kept.
export const KEPT_RULE_TITLE: string = translationKey(
  "Kept as defence in depth",
);
export const KEPT_RULE_UNCHANGED: string = translationKey(
  "{{rule}} contained this leak, and is kept, so a regression is hidden on arrival. It has changed no value since the fix.",
);
export const KEPT_RULE_CHANGED: PluralTemplate = {
  one: "{{rule}} contained this leak, and is kept. It has changed {{count}} value since the fix: the code writes the data again.",
  other:
    "{{rule}} contained this leak, and is kept. It has changed {{count}} values since the fix: the code writes the data again.",
};
export const REMOVE_RULE: string = translationKey("Remove Rule");
export const REMOVE_RULE_TITLE: string = translationKey("Remove Scrub Rule");
export const REMOVE_RULE_QUESTION: string = translationKey(
  "Are you sure you want to delete {{rule}}?",
);
export const REMOVE_RULE_WHAT_CHANGES: string = translationKey(
  "It stops hiding this data at ingest. If the code writes it again, it is stored as it arrives - and OneUptime still watches for it, and opens the issue again.",
);
export const RULE_REMOVED: string = translationKey("Scrub rule removed.");

// The containment could not be read.
export const CONTAINMENT_NOT_LOADED: string = translationKey(
  "Could not read what hides this data at ingest.",
);

/*
 * The template of a verified fix's line, by what its deploy is known by,
 * or null for a resolution that is not one.
 */
export function getFixedLineTemplate(data: {
  resolution: DataSecurityIssueResolution | string | null | undefined;
  fix: DataSecurityIssueResolutionFix | undefined;
}): string | null {
  if (data.resolution === DataSecurityIssueResolution.FixedInInfrastructureCode) {
    return FIXED_IN_INFRASTRUCTURE_CODE;
  }

  if (data.resolution !== DataSecurityIssueResolution.FixedInCode) {
    return null;
  }

  if (data.fix?.version) {
    return FIXED_IN_CODE_IN_VERSION;
  }

  return data.fix?.commitSha ? FIXED_IN_CODE_IN_COMMIT : FIXED_IN_CODE;
}

// The template of a resolution with no pull request, by its kind.
export function getClosedLineTemplate(data: {
  resolution: DataSecurityIssueResolution | string | null | undefined;
  details: DataSecurityIssueResolutionDetails;
}): string | null {
  switch (data.resolution) {
    case DataSecurityIssueResolution.FixedFromHere:
      return data.details.responseAction
        ? FIXED_FROM_HERE_WITH
        : FIXED_FROM_HERE;
    case DataSecurityIssueResolution.CheckPassed:
      return CHECK_PASSED_AT;
    case DataSecurityIssueResolution.ResolvedByPerson:
      return RESOLVED_BY_PERSON_AT;
    case DataSecurityIssueResolution.NoLongerChecked:
      return NO_LONGER_CHECKED_AT;
    case DataSecurityIssueResolution.StoreArchived:
      return STORE_ARCHIVED_AT;
    default:
      return null;
  }
}

/*
 * Whether the issue's page says how it resolved: a resolved issue with a
 * resolution recorded, or an open one whose leak came back after its fix.
 */
export function isResolutionShown(data: {
  status: DataSecurityIssueStatus | string | null | undefined;
  resolution: DataSecurityIssueResolution | string | null | undefined;
  details: DataSecurityIssueResolutionDetails;
}): boolean {
  if (data.status === DataSecurityIssueStatus.Resolved) {
    return Boolean(data.resolution);
  }

  return (
    data.status === DataSecurityIssueStatus.Open &&
    Boolean(data.details.regression)
  );
}

// The template of a leak that came back, by what is known of it.
export function getCameBackTemplate(
  details: DataSecurityIssueResolutionDetails,
): string {
  const regression: DataSecurityIssueResolutionDetails["regression"] =
    details.regression;

  if (regression?.version && regression.fix?.version) {
    return CAME_BACK_IN_VERSION;
  }

  if (regression?.version) {
    return CAME_BACK_IN_VERSION_AFTER_FIX;
  }

  return CAME_BACK_AFTER_PULL_REQUEST;
}
