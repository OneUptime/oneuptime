import {
  CloudAccountCostSummary,
  CloudCostState,
  CloudCostTotals,
  getCloudCostChangePercent,
} from "Common/Types/Cloud/CloudCost";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW THE CLOUD PAGES SAY WHAT THE CLOUDS COST.
 *
 * Money in the reader's own way of writing it - "$4,120", "4.120 €",
 * "۴٬۱۲۰ US$" - whole above a thousand, with cents below; how this month
 * compares with last month at the same point; and why an account's costs
 * could not be read, with what to do about it in each cloud's own words.
 * React-free: App tests and the pages both read it.
 */

export const SPEND_THIS_MONTH: string = translationKey("Spend this month");
export const PROJECTED_MONTH: string = translationKey("On course for");
export const LAST_MONTH: string = translationKey("Last month");
export const LAST_30_DAYS: string = translationKey("Last 30 days");
export const SAVINGS_AVAILABLE: string = translationKey("Savings available");

export const SO_FAR_THIS_MONTH: string = translationKey("So far this month");
export const AT_THIS_WEEKS_PACE: string = translationKey(
  "At the last week's pace",
);
export const MORE_THAN_LAST_MONTH: string = translationKey(
  "{{percent}} more than last month by now",
);
export const LESS_THAN_LAST_MONTH: string = translationKey(
  "{{percent}} less than last month by now",
);
export const SAME_AS_LAST_MONTH: string = translationKey(
  "The same as last month by now",
);
export const PER_MONTH: string = translationKey("a month");

// Why an account's costs could not be read, as its status says it.
export const COST_STATE_LABELS: Readonly<Record<CloudCostState, string>> = {
  [CloudCostState.Reading]: translationKey("Reading"),
  [CloudCostState.NotAllowed]: translationKey("Needs permission"),
  [CloudCostState.NotSetUp]: translationKey("Not set up"),
  [CloudCostState.Failed]: translationKey("Could not read"),
};

/*
 * What to do so an account's costs are read, by cloud: the guide's section
 * a Costs page links to.
 */
export const COST_SETUP_DOCS_PATHS: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: "/docs/telemetry/cloud-costs#amazon-web-services",
  [CloudProvider.Azure]: "/docs/telemetry/cloud-costs#microsoft-azure",
  [CloudProvider.GCP]: "/docs/telemetry/cloud-costs#google-cloud",
};

/*
 * What each cloud needs before its costs are read, in a sentence: what the
 * pages show before an account's costs come in, and beside an account
 * whose could not be read. A connection made before costs were read needs
 * its setup command run again - it is what gives the access.
 */
export const COST_SETUP_STEPS: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: translationKey(
    "Turn on Cost Explorer once, in the account's Billing and Cost Management console - its first figures come within a day - and run the connection's setup command again so it may read them.",
  ),
  [CloudProvider.Azure]: translationKey(
    "Run the connection's setup command again: it gives the connection the Cost Management Reader role.",
  ),
  [CloudProvider.GCP]: translationKey(
    "Export your billing to BigQuery, then name the export's table in the connection's settings, under Billing export table.",
  ),
};

// The same for the ways to spend less, each from its cloud's recommender.
export const SAVINGS_SETUP_STEPS: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: translationKey(
    "Opt in to Cost Optimization Hub once, in the Billing and Cost Management console, and run the connection's setup command again so it may read it.",
  ),
  [CloudProvider.Azure]: translationKey(
    "Nothing to turn on: Azure Advisor's cost recommendations are read with the connection's Reader role.",
  ),
  [CloudProvider.GCP]: translationKey(
    "Run the connection's setup command again: it turns on the Recommender API and lets the connection read it.",
  ),
};

// Where each cloud's ways to spend less are explained.
export const SAVINGS_SETUP_DOCS_PATHS: Readonly<Record<CloudProvider, string>> =
  {
    [CloudProvider.AWS]: "/docs/telemetry/cloud-costs#ways-to-spend-less",
    [CloudProvider.Azure]: "/docs/telemetry/cloud-costs#ways-to-spend-less",
    [CloudProvider.GCP]: "/docs/telemetry/cloud-costs#ways-to-spend-less",
  };

/*
 * An amount of money as the reader writes money: whole from a thousand
 * ("$4,120"), two decimals below it ("$12.40"), and under a cent as "<$0.01"
 * would mislead - a cent and more is what any bill says.
 */
export function formatCloudMoney(data: {
  amount: number;
  currency: string;
  translator: Translator;
  // Always whole: a tile with room for few characters.
  whole?: boolean | undefined;
}): string {
  const amount: number = Number.isFinite(data.amount) ? data.amount : 0;
  const isWhole: boolean = data.whole === true || Math.abs(amount) >= 1000;

  try {
    return new Intl.NumberFormat(data.translator.language || "en", {
      style: "currency",
      currency: (data.currency || "USD").toUpperCase(),
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: isWhole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${(data.currency || "USD").toUpperCase()} ${amount.toFixed(isWhole ? 0 : 2)}`;
  }
}

/*
 * How this month compares with last month by the same day, as one line
 * under a tile, or null with nothing to compare with.
 */
export function getCloudSpendChangeLine(data: {
  current: number;
  previous: number;
  translator: Translator;
}): { text: string; tone: "up" | "down" | "flat" } | null {
  const percent: number | null = getCloudCostChangePercent({
    current: data.current,
    previous: data.previous,
  });

  if (percent === null) {
    return null;
  }

  const rounded: number = Math.round(Math.abs(percent));

  if (rounded === 0) {
    return {
      text:
        data.translator.translateText(SAME_AS_LAST_MONTH) || SAME_AS_LAST_MONTH,
      tone: "flat",
    };
  }

  return {
    text: data.translator.translateTemplate(
      percent > 0 ? MORE_THAN_LAST_MONTH : LESS_THAN_LAST_MONTH,
      { percent: `${data.translator.formatNumber(rounded)}%` },
    ),
    tone: percent > 0 ? "up" : "down",
  };
}

// Whether any account's costs are read: the pages show figures, or the way to set them up.
export function hasCloudCosts(totals: CloudCostTotals): boolean {
  return totals.accountsRead > 0;
}

/*
 * The accounts whose costs are not read, with why: what the Costs pages
 * list under their figures, so a missing account is never read as costing
 * nothing.
 */
export interface CloudCostGap {
  accountName: string;
  provider: string;
  state: CloudCostState;
  message: string;
}

export function getCloudCostGaps(
  accounts: Array<{
    name: string;
    provider: string;
    summary: CloudAccountCostSummary | null;
  }>,
): Array<CloudCostGap> {
  const gaps: Array<CloudCostGap> = [];

  for (const account of accounts) {
    if (!account.summary || account.summary.state === CloudCostState.Reading) {
      continue;
    }

    gaps.push({
      accountName: account.name,
      provider: account.provider,
      state: account.summary.state,
      message: account.summary.message || "",
    });
  }

  return gaps;
}
