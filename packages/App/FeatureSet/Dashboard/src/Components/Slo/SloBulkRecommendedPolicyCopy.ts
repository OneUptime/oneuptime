import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What Use the recommended policy says on the SLO list (#6358), in English:
 * the keys the Dashboard's locales translate
 * (useSloRecommendedPolicyBulkAction draws them). The action's name is the
 * Error Budget Policy page's own button (USE_RECOMMENDED_POLICY_TITLE), and
 * the docs quote it; SloDocsFacts holds the two together.
 */

export const SLO_BULK_RECOMMENDED_POLICY_TITLE: PluralTemplate = {
  one: "Use the recommended policy on {{count}} SLO",
  other: "Use the recommended policy on {{count}} SLOs",
};

export const SLO_BULK_RECOMMENDED_POLICY_QUESTION: string = translationKey(
  "An SLO with no error budget policy gets the recommended one, and an SLO with part of it gets the tiers it is missing. An SLO with a policy of its own is left as it is. The tiers raise no alerts or incidents until you switch that on.",
);

// While the confirmation asks the server what each SLO would get.
export const SLO_BULK_RECOMMENDED_POLICY_CHECKING: string = translationKey(
  "Checking which SLOs have an error budget policy…",
);

export const SLO_BULK_RECOMMENDED_POLICY_HEADLINE: PluralTemplate = {
  one: "{{count}} SLO gets the recommended tiers it is missing:",
  other: "{{count}} SLOs get the recommended tiers they are missing:",
};

export const SLO_BULK_RECOMMENDED_POLICY_COMPLETE: PluralTemplate = {
  one: "{{count}} SLO already has the recommended policy and is left as it is.",
  other:
    "{{count}} SLOs already have the recommended policy and are left as they are.",
};

export const SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY: PluralTemplate = {
  one: "{{count}} SLO has an error budget policy of its own and is left as it is.",
  other:
    "{{count}} SLOs have an error budget policy of their own and are left as they are.",
};

export const SLO_BULK_RECOMMENDED_POLICY_CHECK_FAILED: string = translationKey(
  "Could not check which of these SLOs have an error budget policy, so nothing can be added yet.",
);

// The result's counts.
export const SLO_BULK_RECOMMENDED_POLICY_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
  unchanged: PluralTemplate;
} = {
  succeeded: {
    one: "Tiers added to {{count}} SLO",
    other: "Tiers added to {{count}} SLOs",
  },
  failed: {
    one: "Tiers not added to {{count}} SLO",
    other: "Tiers not added to {{count}} SLOs",
  },
  unchanged: {
    one: "{{count}} SLO left as it was",
    other: "{{count}} SLOs left as they were",
  },
};

// Why an SLO was left alone.
export const SLO_BULK_RECOMMENDED_POLICY_ALREADY_THERE: string = translationKey(
  "Already has the recommended policy.",
);
export const SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY_REASON: string =
  translationKey("Has an error budget policy of its own.");

// An SLO the server's answer left out: nothing says it was added to.
export const SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER: string = translationKey(
  "The server did not say what happened to this SLO. Its Error Budget Policy page shows what it is missing.",
);

/*
 * The server's reasons, as keys the Dashboard translates where the result
 * lists them (BulkUpdateForm translates a reason it has words for). A test
 * pins them to the server's own sentences.
 */
export const SLO_BULK_RECOMMENDED_POLICY_SERVER_REASON_KEYS: Array<string> = [
  translationKey("Service Level Objective not found."),
  translationKey(
    "The recommended policy could not be added to this SLO, so nothing was added. Adding it again adds what is missing.",
  ),
  translationKey(
    "Using the recommended error budget policy takes a role that can create SLO error budget policy tiers.",
  ),
  translationKey(
    "Seeing which recommended error budget policy tiers an SLO is missing takes a role that can read SLO error budget policy tiers.",
  ),
];
