import Route from "Common/Types/API/Route";
import {
  CloudTagCoverageCount,
  CloudTagProblem,
  CloudTagSuggestion,
  CloudTagSuggestionSource,
  getCloudTagCoveragePercent,
} from "Common/Types/Cloud/CloudRequiredTags";
import {
  CLOUD_TAG_COVERAGE_DAYS,
  CloudTagAccountCoverageJSON,
  CloudTagCoverageBreakdown,
  CloudTagCoverageJSON,
  CloudTagMissingJSON,
  CloudTagSpendState,
} from "Common/Types/Cloud/CloudTagCoverage";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { CloudStatTile, CloudStatTone } from "./CloudStatStrip";
import { formatCloudMoney } from "./CloudCostWords";

/*
 * WHAT CLOUD > TAGS AND AN ACCOUNT'S TAGS SAY (#11012), in the reader's
 * language: the strip's figures, a share as a percent, why a share is not
 * measured, what a resource lacks and where its suggestion comes from.
 * React-free: the view draws it, App tests read it.
 */

export const TAGS_TITLE: string = translationKey("Tags");

// The strip.
export const SPEND_TAGGED_TITLE: string = translationKey("Spend Tagged");
export const SPEND_TAGGED_DESCRIPTION: string = translationKey(
  "The share of the last 30 days' costs that carries every required tag, by the tags each cost was read with.",
);
export const SPEND_TAGGED_OF: string = translationKey(
  "{{covered}} of {{total}}",
);
export const SPEND_NOT_MEASURED: string = translationKey("Not measured");
export const RESOURCES_TAGGED_TITLE: string =
  translationKey("Resources Tagged");
export const RESOURCES_TAGGED_DESCRIPTION: string = translationKey(
  "The share of the resources the connections list that carry every required tag, as they are tagged now.",
);
export const RESOURCES_TAGGED_OF: string = translationKey(
  "{{covered}} of {{total}} resources",
);
export const MISSING_TAGS_TITLE: string = translationKey("Missing Tags");
export const MISSING_TAGS_DESCRIPTION: string = translationKey(
  "Resources that lack a required tag, or carry a value it does not allow.",
);
export const MISSING_TAGS_SUBLABEL: string = translationKey("Resources to tag");

// Why a share of spend is not measured.
export const SPEND_AWS_WITHOUT_RESOURCES: string = translationKey(
  "AWS costs carry tags once Costs per resource is turned on in their connection's settings.",
);
export const SPEND_NO_COSTS: string = translationKey(
  "No costs were read for it in the last 30 days.",
);

// The cards.
export const BY_TAG_TITLE: string = translationKey("By Tag");
export const BY_TAG_DESCRIPTION: string = translationKey(
  "How much of the spend and of the resources carry each required tag with a value it allows.",
);
export const TREND_TITLE: string = translationKey("Coverage Over Time");
export const TREND_DESCRIPTION: string = translationKey(
  "Each of the last 12 weeks: spend by the tags its costs were read with, resources as OneUptime counted them that week.",
);
export const TREND_SPEND_SERIES: string = translationKey("Spend");
export const TREND_RESOURCES_SERIES: string = translationKey("Resources");
export const TREND_EMPTY: string = translationKey(
  "The trend fills in as OneUptime counts the resources each day and reads the costs.",
);
export const ACCOUNTS_TITLE: string = translationKey("Accounts");
export const ACCOUNTS_DESCRIPTION: string = translationKey(
  "Each account by its own required tags: the share of its spend and of its resources that carry them.",
);
export const UNTAGGED_TITLE: string = translationKey(
  "Resources Missing Required Tags",
);
export const UNTAGGED_DESCRIPTION: string = translationKey(
  "The costliest first, each with the value OneUptime suggests and the command that applies it in its cloud.",
);
export const UNTAGGED_EMPTY: string = translationKey(
  "Every resource carries its required tags.",
);
export const UNTAGGED_MORE: string = translationKey(
  "The {{shown}} costliest of {{count}} resources missing required tags.",
);
export const UNTAGGED_DECLARED_IN_CODE: string = translationKey(
  "Declared by {{code}}: add the tags there, or the next deploy takes them off again.",
);
export const UNTAGGED_NO_SPEND: string = translationKey("No cost read");
export const COPY_COMMAND: string = translationKey("Copy Command");
export const COMMAND_COPIED: string = translationKey("Command copied.");

// What a resource lacks.
export const PROBLEM_MISSING: string = translationKey("Missing");
export const PROBLEM_NOT_ALLOWED: string = translationKey(
  "{{value}} is not allowed",
);
export const SUGGESTED_VALUE: string = translationKey("Suggested: {{value}}");

// Where a suggestion comes from.
export const SUGGESTION_SOURCES: Readonly<
  Record<CloudTagSuggestionSource, string>
> = {
  [CloudTagSuggestionSource.OwnerTeam]: translationKey(
    "From its owner team, {{detail}}.",
  ),
  [CloudTagSuggestionSource.Environment]: translationKey(
    "From its environment, {{detail}}.",
  ),
  [CloudTagSuggestionSource.Neighbours]: translationKey(
    "From the resources beside it, in {{detail}}.",
  ),
  [CloudTagSuggestionSource.OnlyAllowedValue]: translationKey(
    "The only value the tag allows.",
  ),
};

// A share as a percent in the reader's language; null when there is nothing to measure.
export function formatCoverage(
  count: CloudTagCoverageCount | null | undefined,
): string | null {
  const percent: number | null = getCloudTagCoveragePercent(count);

  return percent === null
    ? null
    : formatReaderFigure(percent, {
        decimals: percent > 0 && percent < 10 ? 1 : 0,
        isPercent: true,
        dropTrailingZeros: true,
      });
}

// How full a share is: amber below 80%, red below half, green above.
export function getCoverageTone(
  count: CloudTagCoverageCount | null | undefined,
): CloudStatTone {
  const percent: number | null = getCloudTagCoveragePercent(count);

  if (percent === null) {
    return "neutral";
  }

  if (percent < 50) {
    return "danger";
  }

  return percent < 80 ? "warning" : "positive";
}

// Why an account's spend share is not measured, or null when it is.
export function getSpendNotMeasuredReason(
  account: Pick<CloudTagAccountCoverageJSON, "spendState">,
): string | null {
  switch (account.spendState) {
    case CloudTagSpendState.AwsWithoutResources:
      return SPEND_AWS_WITHOUT_RESOURCES;
    case CloudTagSpendState.NoCosts:
      return SPEND_NO_COSTS;
    default:
      return null;
  }
}

/*
 * The strip: what share of the spend carries the required tags, what
 * share of the resources, and how many resources lack one.
 */
export function getCloudTagTiles(data: {
  coverage: CloudTagCoverageJSON;
  translator: Translator;
  untaggedRoute?: Route | undefined;
}): Array<CloudStatTile> {
  const { coverage, translator } = data;
  const spend: CloudTagCoverageBreakdown | null = coverage.total.spend;
  const resources: CloudTagCoverageBreakdown = coverage.total.resources;
  // In the reader's digits and currency, as every Cloud page writes money.
  const formatMoney: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: coverage.currency,
      translator,
      whole: true,
    });
  };
  const spendValue: string | null = formatCoverage(spend?.all);
  const resourcesValue: string | null = formatCoverage(resources.all);

  return [
    {
      key: "spend-tagged",
      title: SPEND_TAGGED_TITLE,
      description: SPEND_TAGGED_DESCRIPTION,
      value:
        spendValue ||
        translator.translateText(SPEND_NOT_MEASURED) ||
        SPEND_NOT_MEASURED,
      sublabel: spend
        ? translator.translateTemplate(SPEND_TAGGED_OF, {
            covered: formatMoney(spend.all.covered),
            total: formatMoney(spend.all.total),
          })
        : undefined,
      sublabelIsTranslated: true,
      icon: IconProp.Billing,
      color: "emerald",
      tone: spend ? getCoverageTone(spend.all) : "neutral",
    },
    {
      key: "resources-tagged",
      title: RESOURCES_TAGGED_TITLE,
      description: RESOURCES_TAGGED_DESCRIPTION,
      value: resourcesValue || undefined,
      sublabel: translator.translateTemplate(RESOURCES_TAGGED_OF, {
        covered: translator.formatNumber(resources.all.covered),
        total: translator.formatNumber(resources.all.total),
      }),
      sublabelIsTranslated: true,
      icon: IconProp.SquareStack,
      color: "indigo",
      tone: getCoverageTone(resources.all),
    },
    {
      key: "missing-tags",
      title: MISSING_TAGS_TITLE,
      description: MISSING_TAGS_DESCRIPTION,
      value: translator.formatNumber(coverage.untaggedCount),
      sublabel: MISSING_TAGS_SUBLABEL,
      icon: IconProp.Tag,
      color: "amber",
      tone: coverage.untaggedCount > 0 ? "warning" : "positive",
      to: data.untaggedRoute,
    },
  ];
}

// The period a share of spend is over, said once in the strip's (i).
export const COVERAGE_PERIOD_DAYS: number = CLOUD_TAG_COVERAGE_DAYS;

// What a missing tag says: missing, or its value not allowed.
export function getMissingProblemText(data: {
  missing: CloudTagMissingJSON;
  translator: Translator;
}): string {
  if (
    data.missing.problem === CloudTagProblem.NotAllowed &&
    data.missing.value
  ) {
    return data.translator.translateTemplate(PROBLEM_NOT_ALLOWED, {
      value: data.missing.value,
    });
  }

  return data.translator.translateText(PROBLEM_MISSING) || PROBLEM_MISSING;
}

// Where a suggestion comes from, in a sentence.
export function getSuggestionSourceText(data: {
  suggestion: CloudTagSuggestion;
  translator: Translator;
}): string {
  return data.translator.translateTemplate(
    SUGGESTION_SOURCES[data.suggestion.source],
    { detail: data.suggestion.detail || "" },
  );
}
