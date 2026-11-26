import { getDateLocale, getNumberLocale, formatReaderFigure } from "../DateLanguage";
import { PluralTemplate, Translator, translationKey } from "../Translator";
import { CLOUD_COST_BASIS_LABELS, isCloudCostBasis } from "./CloudCostBasis";
import { getCloudCostAllocationChange } from "./CloudCostAllocation";
import {
  CLOUD_COST_REPORT_PREVIOUS_LABELS,
  CloudCostReportBudgetLine,
  CloudCostReportContent,
  CloudCostReportLine,
  CloudCostReportSaving,
  CloudCostReportSection,
  CloudCostReportUnusualDay,
} from "./CloudCostReport";
import { fromCloudCostDay } from "./CloudCost";

/*
 * A CLOUD COST REPORT IN ITS READER'S WORDS (#11009).
 *
 * What a report says (CloudCostReportContent) written for one reader: its
 * sentences in their language - the Dashboard's wording of them, which the
 * server's locale files copy (Common/Server/Locales, DASHBOARD_SHARED_TEXT
 * _SOURCES), so the Reports page's preview and the email read the same -
 * its money as their language writes money ("$4,120", "4.120 €"), its
 * dates and percents too. What the clouds and the team wrote - services,
 * accounts, groups, the report's name - reads as written.
 *
 * The email (CloudCostReport.hbs), the Slack and Microsoft Teams message
 * and the short text a phone shows are all made from it. React-free and
 * server-safe.
 */

export const REPORT_LEAD_ALL: string = translationKey(
  "What every account cost from {{start}} to {{end}}.",
);
export const REPORT_LEAD_ONE: string = translationKey(
  "What {{name}} cost from {{start}} to {{end}}.",
);
export const REPORT_TOTAL: string = translationKey("Total");
export const REPORT_CHANGE_UP: string = translationKey(
  "{{percent}} more than {{previous}}",
);
export const REPORT_CHANGE_DOWN: string = translationKey(
  "{{percent}} less than {{previous}}",
);
export const REPORT_CHANGE_SAME: string = translationKey(
  "The same as {{previous}}",
);
export const REPORT_PREVIOUS_AMOUNT: string = translationKey(
  "{{amount}} {{previous}}",
);
export const REPORT_BUDGET: string = translationKey("Budget");
export const REPORT_BUDGET_LINE: string = translationKey(
  "{{spent}} of {{amount}} in {{month}}",
);
export const REPORT_SAVINGS: string = translationKey("Savings waiting");
export const REPORT_SAVINGS_PER_MONTH: string = translationKey(
  "{{amount}} a month",
);
export const REPORT_SAVINGS_COUNT: PluralTemplate = {
  one: "{{count}} saving",
  other: "{{count}} savings",
};
export const REPORT_COMMITMENTS: string = translationKey("Commitments cover");
export const REPORT_COMMITMENTS_USED: string = translationKey(
  "{{percent}} of them used",
);
export const REPORT_NO_COMMITMENTS: string = translationKey("None");
export const REPORT_RISES: string = translationKey("Rose the most");
export const REPORT_FALLS: string = translationKey("Fell the most");
export const REPORT_BY_GROUP: string = translationKey("By cost group");
export const REPORT_UNALLOCATED: string = translationKey("Unallocated");
export const REPORT_UNUSUAL_DAYS: string = translationKey("Unusual days");
export const REPORT_UNUSUAL_DAY_VALUE: string = translationKey(
  "{{amount}}, usually {{usual}}",
);
export const REPORT_WHOLE_ACCOUNT: string = translationKey("The whole account");
export const REPORT_LARGEST_SAVINGS: string = translationKey(
  "Largest savings waiting",
);
export const REPORT_NOTHING_COST: string = translationKey(
  "Nothing cost anything in this period.",
);
export const REPORT_OPEN_COSTS: string = translationKey("Open Costs");
export const REPORT_BASIS_NOTE: string = translationKey(
  "Cost basis: {{basis}}. Currency: {{currency}}. A cloud reports the last day or two late, and in part.",
);
export const REPORT_OTHER_CURRENCIES: string = translationKey(
  "Left out, as billed in another currency: {{accounts}}.",
);
export const REPORT_CSV_ATTACHED: string = translationKey(
  "The figures are attached as a CSV.",
);
export const REPORT_GROUP_SECTION: string = translationKey(
  "Your team's cost group, {{name}}, in the report {{report}}.",
);
export const REPORT_WHY_MEMBER: string = translationKey(
  "You get this report because it is sent to you, or to a team you are on, in {{project}}. Turn cloud cost reports off in your notification settings.",
);
export const REPORT_WHY_GROUP: string = translationKey(
  "You get this section because your team owns the {{name}} cost group in {{project}}. Turn cloud cost reports off in your notification settings.",
);
export const REPORT_WHY_ADDRESS: string = translationKey(
  "This report is sent to this address from {{project}} on OneUptime. Ask the person who sends it to take the address off.",
);

// What a row's figure did against the period before.
export type CloudCostReportTone = "up" | "down" | "flat";

export interface CloudCostReportTextRow {
  name: string;
  value: string;
  hint?: string | undefined;
  tone?: CloudCostReportTone | undefined;
}

export interface CloudCostReportTextSection {
  title: string;
  rows: Array<CloudCostReportTextRow>;
}

export interface CloudCostReportStat {
  label: string;
  value: string;
  hint?: string | undefined;
}

export interface CloudCostReportText {
  subject: string;
  title: string;
  lead: string;
  totalLabel: string;
  total: string;
  // "12% more than the week before", or nothing to compare with.
  change: string | null;
  changeTone: CloudCostReportTone;
  previous: string;
  stats: Array<CloudCostReportStat>;
  sections: Array<CloudCostReportTextSection>;
  notes: Array<string>;
  buttonText: string;
  costsUrl: string;
  // The same, for a Slack or Microsoft Teams message: Markdown lines.
  chatLines: Array<string>;
  // One line, for a text message or a phone's notification.
  shortText: string;
}

/*
 * An amount of money as the reader writes money: whole from a thousand
 * ("$4,120"), two decimals below it ("$12.40") - as the Cloud pages write
 * it (CloudCostWords.formatCloudMoney).
 */
export function formatCloudCostMoney(data: {
  amount: number;
  currency: string;
  language: string | undefined;
  whole?: boolean | undefined;
}): string {
  const amount: number = Number.isFinite(data.amount) ? data.amount : 0;
  const isWhole: boolean = data.whole === true || Math.abs(amount) >= 1000;

  try {
    return new Intl.NumberFormat(getNumberLocale(data.language || "en"), {
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
 * A day, or two, as the reader writes dates: "16 Nov 2026", "16 – 22 Nov
 * 2026" - the clouds' UTC days, in every reader's zone.
 */
export function formatCloudCostDays(data: {
  start: string;
  lastDay?: string | undefined;
  language: string | undefined;
}): string {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  };
  const start: Date = fromCloudCostDay(data.start);

  try {
    const format: Intl.DateTimeFormat = new Intl.DateTimeFormat(
      getDateLocale(data.language || "en"),
      options,
    );

    if (!data.lastDay || data.lastDay === data.start) {
      return format.format(start);
    }

    // formatRange writes "16 – 22 Nov 2026" each language's own way.
    return (
      format as unknown as {
        formatRange: (rangeStart: Date, rangeEnd: Date) => string;
      }
    ).formatRange(start, fromCloudCostDay(data.lastDay));
  } catch {
    return data.lastDay && data.lastDay !== data.start
      ? `${data.start} – ${data.lastDay}`
      : data.start;
  }
}

// A month, "2026-11", as the reader writes it: "November 2026".
export function formatCloudCostMonth(data: {
  month: string;
  language: string | undefined;
}): string {
  try {
    return new Intl.DateTimeFormat(getDateLocale(data.language || "en"), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(fromCloudCostDay(`${data.month}-01`));
  } catch {
    return data.month;
  }
}

function formatPercent(value: number, language: string | undefined): string {
  return formatReaderFigure(Math.abs(value), {
    decimals: 0,
    isPercent: true,
    language: language || "en",
  });
}

// A change in the reader's words, its tone, or nothing to compare with.
export function getCloudCostReportChange(data: {
  current: number;
  previous: number;
  previousLabel: string;
  translator: Translator;
}): { text: string; tone: CloudCostReportTone } | null {
  const change: number | null = getCloudCostAllocationChange({
    current: data.current,
    previous: data.previous,
  });

  if (change === null) {
    return null;
  }

  if (Math.abs(change) < 0.5) {
    return {
      text: data.translator.translateTemplate(REPORT_CHANGE_SAME, {
        previous: data.previousLabel,
      }),
      tone: "flat",
    };
  }

  return {
    text: data.translator.translateTemplate(
      change > 0 ? REPORT_CHANGE_UP : REPORT_CHANGE_DOWN,
      {
        percent: formatPercent(change, data.translator.language),
        previous: data.previousLabel,
      },
    ),
    tone: change > 0 ? "up" : "down",
  };
}

// A line's change as a signed amount: "+$1,200", "−$80".
function formatDelta(data: {
  line: CloudCostReportLine;
  currency: string;
  language: string | undefined;
}): string {
  const delta: number = data.line.amount - data.line.previousAmount;
  const money: string = formatCloudCostMoney({
    amount: Math.abs(delta),
    currency: data.currency,
    language: data.language,
  });

  return delta >= 0 ? `+${money}` : `−${money}`;
}

function toneOf(line: CloudCostReportLine): CloudCostReportTone {
  const delta: number = line.amount - line.previousAmount;
  return Math.abs(delta) < 0.005 ? "flat" : delta > 0 ? "up" : "down";
}

/*
 * Everything a report says, in the reader's words: what the email, the
 * chat message and a phone's line are made of.
 */
export function writeCloudCostReport(data: {
  content: CloudCostReportContent;
  translator: Translator;
}): CloudCostReportText {
  const content: CloudCostReportContent = data.content;
  const translator: Translator = data.translator;
  const language: string = translator.language;
  const section: CloudCostReportSection = content.section;
  const currency: string = content.currency;
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudCostMoney({ amount, currency, language });
  };
  const days: (start: string, end: string) => string = (
    start: string,
    end: string,
  ): string => {
    return formatCloudCostDays({ start, lastDay: end, language });
  };
  const startText: string = formatCloudCostDays({
    start: content.start,
    language,
  });
  const endText: string = formatCloudCostDays({
    start: content.lastDay,
    language,
  });
  const previousLabel: string =
    translator.translateText(
      CLOUD_COST_REPORT_PREVIOUS_LABELS[content.period],
    ) || CLOUD_COST_REPORT_PREVIOUS_LABELS[content.period];

  const lead: string = section.name
    ? translator.translateTemplate(REPORT_LEAD_ONE, {
        name: section.name,
        start: startText,
        end: endText,
      })
    : translator.translateTemplate(REPORT_LEAD_ALL, {
        start: startText,
        end: endText,
      });

  const change: { text: string; tone: CloudCostReportTone } | null =
    getCloudCostReportChange({
      current: section.total,
      previous: section.previousTotal,
      previousLabel,
      translator,
    });

  const previous: string = translator.translateTemplate(
    REPORT_PREVIOUS_AMOUNT,
    {
      amount: money(section.previousTotal),
      previous: previousLabel,
    },
  );

  // The strip under the total: budget, savings, commitments.
  const stats: Array<CloudCostReportStat> = [];
  const budget: CloudCostReportBudgetLine | undefined = section.budgets[0];

  if (budget) {
    stats.push({
      label: translator.translateText(REPORT_BUDGET) || REPORT_BUDGET,
      value:
        budget.amount > 0
          ? formatPercent((budget.spent / budget.amount) * 100, language)
          : money(budget.spent),
      hint: translator.translateTemplate(REPORT_BUDGET_LINE, {
        spent: money(budget.spent),
        amount: formatCloudCostMoney({
          amount: budget.amount,
          currency,
          language,
          whole: Number.isInteger(budget.amount),
        }),
        month: formatCloudCostMonth({ month: budget.month, language }),
      }),
    });
  }

  if (section.savings && section.savings.count > 0) {
    stats.push({
      label: translator.translateText(REPORT_SAVINGS) || REPORT_SAVINGS,
      value: translator.translateTemplate(REPORT_SAVINGS_PER_MONTH, {
        amount: money(section.savings.monthlySavings),
      }),
      hint: translator.translatePlural(
        REPORT_SAVINGS_COUNT,
        section.savings.count,
      ),
    });
  }

  if (section.commitments) {
    stats.push({
      label: translator.translateText(REPORT_COMMITMENTS) || REPORT_COMMITMENTS,
      value:
        section.commitments.hasCommitments &&
        section.commitments.coveredPercent !== null
          ? formatPercent(section.commitments.coveredPercent, language)
          : translator.translateText(REPORT_NO_COMMITMENTS) ||
            REPORT_NO_COMMITMENTS,
      hint:
        section.commitments.hasCommitments &&
        section.commitments.usedPercent !== null
          ? translator.translateTemplate(REPORT_COMMITMENTS_USED, {
              percent: formatPercent(section.commitments.usedPercent, language),
            })
          : undefined,
    });
  }

  const sections: Array<CloudCostReportTextSection> = [];
  const lineRow: (line: CloudCostReportLine) => CloudCostReportTextRow = (
    line: CloudCostReportLine,
  ): CloudCostReportTextRow => {
    return {
      name: line.name,
      value: money(line.amount),
      hint: formatDelta({ line, currency, language }),
      tone: toneOf(line),
    };
  };

  if (section.groups && section.groups.length > 0) {
    const rows: Array<CloudCostReportTextRow> = section.groups.map(lineRow);

    if (section.unallocated) {
      rows.push(
        lineRow({
          key: "",
          name:
            translator.translateText(REPORT_UNALLOCATED) || REPORT_UNALLOCATED,
          amount: section.unallocated.amount,
          previousAmount: section.unallocated.previousAmount,
        }),
      );
    }

    sections.push({
      title: translator.translateText(REPORT_BY_GROUP) || REPORT_BY_GROUP,
      rows,
    });
  }

  if (section.rises.length > 0) {
    sections.push({
      title: translator.translateText(REPORT_RISES) || REPORT_RISES,
      rows: section.rises.map(lineRow),
    });
  }

  if (section.falls.length > 0) {
    sections.push({
      title: translator.translateText(REPORT_FALLS) || REPORT_FALLS,
      rows: section.falls.map(lineRow),
    });
  }

  if (section.budgets.length > 1) {
    sections.push({
      title: translator.translateText(REPORT_BUDGET) || REPORT_BUDGET,
      rows: section.budgets.map(
        (line: CloudCostReportBudgetLine): CloudCostReportTextRow => {
          return {
            name: line.name,
            value:
              line.amount > 0
                ? formatPercent((line.spent / line.amount) * 100, language)
                : money(line.spent),
            hint: translator.translateTemplate(REPORT_BUDGET_LINE, {
              spent: money(line.spent),
              amount: money(line.amount),
              month: formatCloudCostMonth({ month: line.month, language }),
            }),
          };
        },
      ),
    });
  }

  if (section.unusualDays.length > 0) {
    sections.push({
      title: translator.translateText(REPORT_UNUSUAL_DAYS) || REPORT_UNUSUAL_DAYS,
      rows: section.unusualDays.map(
        (day: CloudCostReportUnusualDay): CloudCostReportTextRow => {
          const what: string =
            day.service ||
            translator.translateText(REPORT_WHOLE_ACCOUNT) ||
            REPORT_WHOLE_ACCOUNT;

          return {
            name: `${formatCloudCostDays({ start: day.day, language })} · ${what}`,
            value: translator.translateTemplate(REPORT_UNUSUAL_DAY_VALUE, {
              amount: money(day.amount),
              usual: money(day.usual),
            }),
            hint: day.accountName || undefined,
            tone: "up",
          };
        },
      ),
    });
  }

  if (section.savings && section.savings.top.length > 0) {
    sections.push({
      title:
        translator.translateText(REPORT_LARGEST_SAVINGS) ||
        REPORT_LARGEST_SAVINGS,
      rows: section.savings.top.map(
        (saving: CloudCostReportSaving): CloudCostReportTextRow => {
          return {
            name: saving.action,
            value: translator.translateTemplate(REPORT_SAVINGS_PER_MONTH, {
              amount: money(saving.monthlySavings),
            }),
            hint:
              [saving.resourceName, saving.accountName]
                .filter((part: string): boolean => {
                  return Boolean(part);
                })
                .join(" · ") || undefined,
          };
        },
      ),
    });
  }

  const basisLabel: string = isCloudCostBasis(content.basis)
    ? translator.translateText(CLOUD_COST_BASIS_LABELS[content.basis]) ||
      CLOUD_COST_BASIS_LABELS[content.basis]
    : content.basis;
  const notes: Array<string> = [];

  if (section.total === 0 && section.previousTotal === 0) {
    notes.push(
      translator.translateText(REPORT_NOTHING_COST) || REPORT_NOTHING_COST,
    );
  }

  notes.push(
    translator.translateTemplate(REPORT_BASIS_NOTE, {
      basis: basisLabel,
      currency,
    }),
  );

  if (content.otherCurrencies.length > 0) {
    notes.push(
      translator.translateTemplate(REPORT_OTHER_CURRENCIES, {
        accounts: content.otherCurrencies
          .map((account: { name: string; currency: string }): string => {
            return `${account.name} (${account.currency})`;
          })
          .join(", "),
      }),
    );
  }

  const totalText: string = money(section.total);
  const chatLines: Array<string> = [
    `**${lead}**`,
    `${translator.translateText(REPORT_TOTAL) || REPORT_TOTAL}: **${totalText}**${
      change ? ` (${change.text})` : ""
    }`,
  ];

  for (const stat of stats) {
    chatLines.push(
      `${stat.label}: ${stat.value}${stat.hint ? ` (${stat.hint})` : ""}`,
    );
  }

  for (const textSection of sections.slice(0, 2)) {
    chatLines.push("");
    chatLines.push(`**${textSection.title}**`);

    for (const row of textSection.rows.slice(0, 5)) {
      chatLines.push(
        `- ${row.name}: ${row.value}${row.hint ? ` (${row.hint})` : ""}`,
      );
    }
  }

  return {
    subject: `${content.reportName}: ${days(content.start, content.lastDay)}`,
    title: content.reportName,
    lead,
    totalLabel: translator.translateText(REPORT_TOTAL) || REPORT_TOTAL,
    total: totalText,
    change: change?.text || null,
    changeTone: change?.tone || "flat",
    previous,
    stats,
    sections,
    notes,
    buttonText: translator.translateText(REPORT_OPEN_COSTS) || REPORT_OPEN_COSTS,
    costsUrl: content.costsUrl,
    chatLines,
    shortText: `${content.reportName}: ${totalText}, ${days(
      content.start,
      content.lastDay,
    )}${change ? ` (${change.text})` : ""}`,
  };
}
