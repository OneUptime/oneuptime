import Route from "Common/Types/API/Route";
import {
  CLOUD_SAVING_KIND_LABELS,
  CloudCostTotals,
  CloudSavingKind,
  CloudSavingsKindTotal,
  CloudSavingsTotals,
} from "Common/Types/Cloud/CloudCost";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { getCloudAccountStatus } from "./CloudAccountStatus";
import {
  AT_THIS_WEEKS_PACE,
  LAST_MONTH,
  PROJECTED_MONTH,
  SAVINGS_AVAILABLE,
  SO_FAR_THIS_MONTH,
  SPEND_THIS_MONTH,
  formatCloudMoney,
  getCloudSpendChangeLine,
  hasCloudCosts,
} from "./CloudCostWords";
import { CloudStatTile } from "./CloudStatStrip";

/*
 * THE NUMBERS ON TOP OF CLOUD'S OVERVIEW AND COSTS.
 *
 * The Overview's strip answers "is my cloud all right, and what is it
 * costing me?" in four numbers: the accounts and whether they are read,
 * the resources in them, how many need attention now, and the month's
 * spend against last month's. The Costs strip - on Cloud > Costs and an
 * account's Costs - says the month so far, where it is heading, last month
 * and what could be saved. React-free, so App tests read them as the pages
 * draw them.
 */

export const ACCOUNTS_TILE: string = translationKey("Accounts");
export const RESOURCES_TILE: string = translationKey("Resources");
export const NEEDS_ATTENTION_TILE: string = translationKey("Needs attention");

export const ACCOUNTS_TILE_DESCRIPTION: string = translationKey(
  "The AWS accounts, Azure subscriptions and Google Cloud projects your cloud connections read.",
);
export const RESOURCES_TILE_DESCRIPTION: string = translationKey(
  "Every resource in them that a connection lists or that their telemetry reports.",
);
export const NEEDS_ATTENTION_TILE_DESCRIPTION: string = translationKey(
  "Resources whose key metrics show something wrong now: failing status checks, failed requests, throttling, a disk filling up.",
);
export const SPEND_TILE_DESCRIPTION: string = translationKey(
  "What the accounts cost this month so far, from each cloud's own billing, before credits and refunds.",
);
export const PROJECTED_TILE_DESCRIPTION: string = translationKey(
  "This month's total if the days left cost what the last week's did.",
);
export const SAVINGS_TILE_DESCRIPTION: string = translationKey(
  "What your clouds' recommenders and OneUptime's own right-sizing say could be saved a month: smaller sizes, idle resources, commitments.",
);

export const ALL_ACCOUNTS_READING: string = translationKey("All reading");
export const ACCOUNTS_NOT_READ_LATELY: PluralTemplate = {
  one: "{{count}} not read lately",
  other: "{{count}} not read lately",
};
export const RESOURCES_UNHEALTHY: PluralTemplate = {
  one: "{{count}} unhealthy",
  other: "{{count}} unhealthy",
};
export const RESOURCES_DEGRADED: PluralTemplate = {
  one: "{{count}} degraded",
  other: "{{count}} degraded",
};
export const NOTHING_NEEDS_A_LOOK: string = translationKey(
  "Nothing needs a look",
);
export const COSTS_NOT_READ_YET: string = translationKey("Costs not read yet");
export const LAST_30_DAYS_AMOUNT: string = translationKey(
  "{{amount}} in the last 30 days",
);
export const SAVING_RECOMMENDATIONS: PluralTemplate = {
  one: "{{count}} recommendation",
  other: "{{count}} recommendations",
};
export const NO_RECOMMENDATIONS: string = translationKey("No recommendations");
// No account's recommendations read: not "nothing to save".
export const RECOMMENDATIONS_NOT_READ_YET: string =
  translationKey("Not read yet");

// What the Needs attention tile counts: null while the resources are read.
export interface CloudAttentionCounts {
  unhealthy: number;
  degraded: number;
  // More than the one read listed: the count is a floor ("100+").
  isMore: boolean;
}

export function getCloudOverviewTiles(data: {
  accounts: Array<{ lastSeenAt: Date | null; hasConnection: boolean }>;
  resources: number;
  costs: CloudCostTotals;
  // Null while the resources are read.
  attention: CloudAttentionCounts | null;
  // They could not be read: the count is not known.
  attentionFailed?: boolean | undefined;
  now: Date;
  translator: Translator;
  routes: { accounts: Route; resources: Route; costs: Route };
}): Array<CloudStatTile> {
  const translator: Translator = data.translator;
  const notReading: number = data.accounts.filter(
    (account: { lastSeenAt: Date | null; hasConnection: boolean }): boolean => {
      return (
        getCloudAccountStatus({
          lastSeenAt: account.lastSeenAt,
          hasConnection: account.hasConnection,
          now: data.now,
        }).tone !== "positive"
      );
    },
  ).length;

  const attention: CloudAttentionCounts | null = data.attention;
  const needingAttention: number = attention
    ? attention.unhealthy + attention.degraded
    : 0;

  const spend: CloudStatTile = hasCloudCosts(data.costs)
    ? (() => {
        const change: { text: string; tone: string } | null =
          getCloudSpendChangeLine({
            // Over the same full days: never the newest, half-reported day.
            current: data.costs.monthFullDays,
            previous: data.costs.lastMonthToDate,
            translator,
          });

        return {
          key: "spend",
          title: SPEND_THIS_MONTH,
          description: SPEND_TILE_DESCRIPTION,
          value: formatCloudMoney({
            amount: data.costs.monthToDate,
            currency: data.costs.currency,
            translator,
          }),
          sublabel: change
            ? change.text
            : translator.translateText(SO_FAR_THIS_MONTH) || SO_FAR_THIS_MONTH,
          sublabelIsTranslated: true,
          icon: IconProp.Billing,
          color: "indigo",
          to: data.routes.costs,
        } as CloudStatTile;
      })()
    : {
        key: "spend",
        title: SPEND_THIS_MONTH,
        description: SPEND_TILE_DESCRIPTION,
        value: "—",
        sublabel: COSTS_NOT_READ_YET,
        icon: IconProp.Billing,
        color: "indigo",
        to: data.routes.costs,
      };

  return [
    {
      key: "accounts",
      title: ACCOUNTS_TILE,
      description: ACCOUNTS_TILE_DESCRIPTION,
      value: translator.formatNumber(data.accounts.length),
      sublabel:
        notReading > 0
          ? translator.translatePlural(ACCOUNTS_NOT_READ_LATELY, notReading)
          : translator.translateText(ALL_ACCOUNTS_READING) ||
            ALL_ACCOUNTS_READING,
      sublabelIsTranslated: true,
      tone: notReading > 0 ? "warning" : "neutral",
      icon: IconProp.Cloud,
      color: "blue",
      to: data.routes.accounts,
    },
    {
      key: "resources",
      title: RESOURCES_TILE,
      description: RESOURCES_TILE_DESCRIPTION,
      value: translator.formatNumber(data.resources),
      icon: IconProp.SquareStack,
      color: "sky",
      to: data.routes.resources,
    },
    {
      key: "attention",
      title: NEEDS_ATTENTION_TILE,
      description: NEEDS_ATTENTION_TILE_DESCRIPTION,
      value: attention
        ? `${translator.formatNumber(needingAttention)}${attention.isMore ? "+" : ""}`
        : "—",
      loading: attention === null && !data.attentionFailed,
      sublabel: !attention
        ? undefined
        : attention.unhealthy > 0
          ? translator.translatePlural(RESOURCES_UNHEALTHY, attention.unhealthy)
          : attention.degraded > 0
            ? translator.translatePlural(RESOURCES_DEGRADED, attention.degraded)
            : translator.translateText(NOTHING_NEEDS_A_LOOK) ||
              NOTHING_NEEDS_A_LOOK,
      sublabelIsTranslated: true,
      tone: !attention
        ? "neutral"
        : attention.unhealthy > 0
          ? "danger"
          : attention.degraded > 0
            ? "warning"
            : "neutral",
      icon: IconProp.Alert,
      color: "rose",
    },
    spend,
  ];
}

/*
 * The Costs strip: the month so far against last month by now, where it is
 * heading, last month in full, and what could be saved - for every account
 * (Cloud > Costs) or one (its Costs tab).
 */
export function getCloudCostTiles(data: {
  costs: CloudCostTotals;
  savings: CloudSavingsTotals;
  translator: Translator;
  savingsRoute?: Route | undefined;
}): Array<CloudStatTile> {
  const translator: Translator = data.translator;
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: data.costs.currency,
      translator,
    });
  };
  const change: { text: string; tone: string } | null = getCloudSpendChangeLine(
    {
      // Over the same full days: never the newest, half-reported day.
      current: data.costs.monthFullDays,
      previous: data.costs.lastMonthToDate,
      translator,
    },
  );
  // Some account's recommendations read, or some found.
  const isSavingsRead: boolean =
    data.savings.accountsRead > 0 || data.savings.count > 0;

  return [
    {
      key: "spend",
      title: SPEND_THIS_MONTH,
      description: SPEND_TILE_DESCRIPTION,
      value: money(data.costs.monthToDate),
      sublabel: change
        ? change.text
        : translator.translateText(SO_FAR_THIS_MONTH) || SO_FAR_THIS_MONTH,
      sublabelIsTranslated: true,
      icon: IconProp.Billing,
      color: "indigo",
    },
    {
      key: "projected",
      title: PROJECTED_MONTH,
      description: PROJECTED_TILE_DESCRIPTION,
      value: money(data.costs.projectedMonth),
      sublabel: AT_THIS_WEEKS_PACE,
      icon: IconProp.ChartBar,
      color: "violet",
    },
    {
      key: "last-month",
      title: LAST_MONTH,
      value: money(data.costs.lastMonth),
      sublabel: translator.translateTemplate(LAST_30_DAYS_AMOUNT, {
        amount: money(data.costs.last30Days),
      }),
      sublabelIsTranslated: true,
      icon: IconProp.Calendar,
      color: "sky",
    },
    {
      key: "savings",
      title: SAVINGS_AVAILABLE,
      description: SAVINGS_TILE_DESCRIPTION,
      value: isSavingsRead
        ? formatCloudMoney({
            amount: data.savings.monthlySavings,
            currency: data.savings.currency,
            translator,
          })
        : "—",
      sublabel: !isSavingsRead
        ? translator.translateText(RECOMMENDATIONS_NOT_READ_YET) ||
          RECOMMENDATIONS_NOT_READ_YET
        : data.savings.count > 0
          ? translator.translatePlural(
              SAVING_RECOMMENDATIONS,
              data.savings.count,
            )
          : translator.translateText(NO_RECOMMENDATIONS) || NO_RECOMMENDATIONS,
      sublabelIsTranslated: true,
      tone: data.savings.monthlySavings > 0 ? "positive" : "neutral",
      icon: IconProp.ArrowTrendingDown,
      color: "emerald",
      to: data.savingsRoute,
    },
  ];
}

/*
 * The Savings strip: what could be saved a month in all, then by the three
 * ways most of it comes from - a smaller size, stopping what is idle, and
 * committing to use. Upgrades and the rest count in the total.
 */
export function getCloudSavingsTiles(data: {
  savings: CloudSavingsTotals;
  translator: Translator;
}): Array<CloudStatTile> {
  const translator: Translator = data.translator;
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: data.savings.currency,
      translator,
    });
  };
  const recommendations: (count: number) => string = (
    count: number,
  ): string => {
    return count > 0
      ? translator.translatePlural(SAVING_RECOMMENDATIONS, count)
      : translator.translateText(NO_RECOMMENDATIONS) || NO_RECOMMENDATIONS;
  };
  const kindTile: (data: {
    kind: CloudSavingKind;
    icon: IconProp;
    color: CloudStatTile["color"];
  }) => CloudStatTile = (tile: {
    kind: CloudSavingKind;
    icon: IconProp;
    color: CloudStatTile["color"];
  }): CloudStatTile => {
    const entry: CloudSavingsKindTotal = data.savings.byKind[tile.kind] || {
      count: 0,
      monthlySavings: 0,
    };

    return {
      key: tile.kind,
      title: CLOUD_SAVING_KIND_LABELS[tile.kind],
      value: money(entry.monthlySavings),
      sublabel: recommendations(entry.count),
      sublabelIsTranslated: true,
      tone: entry.monthlySavings > 0 ? "positive" : "neutral",
      icon: tile.icon,
      color: tile.color,
    };
  };

  return [
    {
      key: "savings",
      title: SAVINGS_AVAILABLE,
      description: SAVINGS_TILE_DESCRIPTION,
      value: money(data.savings.monthlySavings),
      sublabel: recommendations(data.savings.count),
      sublabelIsTranslated: true,
      tone: data.savings.monthlySavings > 0 ? "positive" : "neutral",
      icon: IconProp.ArrowTrendingDown,
      color: "emerald",
    },
    kindTile({
      kind: CloudSavingKind.Rightsize,
      icon: IconProp.Scale,
      color: "blue",
    }),
    kindTile({
      kind: CloudSavingKind.Idle,
      icon: IconProp.PauseCircle,
      color: "amber",
    }),
    kindTile({
      kind: CloudSavingKind.Commitment,
      icon: IconProp.Calendar,
      color: "violet",
    }),
  ];
}
