import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import Metric from "../../../Models/AnalyticsModels/Metric";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CloudSavingKind } from "../../../Types/Cloud/CloudCost";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import {
  CLOUD_DAYS_IN_AVERAGE_MONTH,
  CloudRightSizing,
  CloudRightSizingProfile,
  CloudRightSizingVerdict,
  CloudUsageObservation,
  MEMORY_NEEDS_CLOUDWATCH_AGENT,
  buildCloudRightSizing,
  getCloudRightSizingProfile,
  getCloudRightSizingRecommendationId,
} from "../../../Types/Cloud/CloudRightSizing";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import { CloudResourceCost } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceCostCard";
import CloudResourceRightSizingCard from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceRightSizingCard";
import CloudResourceSpendCards, {
  CloudResourceSpendCardsShown,
  decideCloudResourceSpendCards,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceSpendCards";
import {
  fetchCloudResourceDailyCost,
  fetchCloudResourceUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudRightSizingReads";
import {
  CloudRightSizingText,
  getCloudRightSizingEvidenceLine,
  getCloudRightSizingText,
  isCloudSavingAmountKnown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudRightSizingText";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A cloud resource's right-sizing on its Overview, from OneUptime's own
 * readings of its CPU and memory: what the card says for each verdict -
 * the change, the saving once its cost is known, the readings (its
 * figures, said once) and what they would be at the new size - in English
 * and German; when it is drawn beside "What it costs" and when a
 * recommender of its cloud speaks for the resource instead; and the reads
 * it makes.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const RESOURCE_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000c1",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const ARN: string = "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1";

const EC2: CloudRightSizingProfile = getCloudRightSizingProfile(
  "aws",
  "AWS::EC2::Instance",
)!;
const RDS: CloudRightSizingProfile = getCloudRightSizingProfile(
  "aws",
  "AWS::RDS::DBInstance",
)!;
const CACHE: CloudRightSizingProfile = getCloudRightSizingProfile(
  "aws",
  "AWS::ElastiCache::CacheCluster",
)!;

const english: Translator = createTranslator(
  (text: string): string | undefined => {
    return (englishLocale as unknown as Record<string, string>)[text];
  },
  "en",
);
const german: Translator = createTranslator(
  (text: string): string | undefined => {
    return (germanLocale as unknown as Record<string, string>)[text];
  },
  "de",
);

function observation(
  fields: Partial<CloudUsageObservation>,
): CloudUsageObservation {
  return {
    cpuP95Percent: 24,
    cpuMaxPercent: 41,
    memoryPeakPercent: null,
    samples: 4032,
    observedHours: 14 * 24,
    ...fields,
  };
}

function sizingOf(data: {
  profile?: CloudRightSizingProfile;
  size?: string;
  fields?: Partial<CloudUsageObservation>;
  dailyCost?: number | null;
}): CloudRightSizing {
  return buildCloudRightSizing({
    profile: data.profile || EC2,
    size: data.size || "m5.2xlarge",
    observation: observation(data.fields || {}),
    dailyCost:
      data.dailyCost === null || data.dailyCost === undefined
        ? null
        : { amount: data.dailyCost, currency: "USD", days: 30 },
  });
}

function textOf(
  sizing: CloudRightSizing,
  translator: Translator = english,
): CloudRightSizingText {
  return getCloudRightSizingText({ sizing, translator });
}

describe("what the card says", () => {
  test("over-provisioned with its cost known: the change, what it saves, the readings, its readings at the new size and what to check first", () => {
    const sizing: CloudRightSizing = sizingOf({ dailyCost: 9.2 });
    const text: CloudRightSizingText = textOf(sizing);
    const saving: number =
      Math.round(
        (Math.round(9.2 * CLOUD_DAYS_IN_AVERAGE_MONTH * 100) / 100 / 2) * 100,
      ) / 100;

    expect(text.verdict).toBe("Over-provisioned");
    expect(text.tone).toBe("warning");
    expect(text.change).toEqual({ from: "m5.2xlarge", to: "m5.xlarge" });
    expect(text.headline).toBe("A size half as big would do.");
    expect(text.isSavingKnown).toBe(true);
    expect(text.saving).toBe(
      `Saves about $${saving.toFixed(2)} a month, at its cost over the last 30 days.`,
    );
    // Money back: its amount apart, so the card draws it in green.
    expect(text.savingTone).toBe("positive");
    expect(text.savingSentence).toEqual({
      template:
        "Saves about {{amount}} a month, at its cost over the last 30 days.",
      amount: `$${saving.toFixed(2)}`,
    });
    expect(
      text.facts.map((fact: { label: string; value: string }) => {
        return [fact.label, fact.value];
      }),
    ).toEqual([
      ["CPU (95th percentile)", "24%"],
      ["CPU (highest)", "41%"],
      ["Memory (highest)", "Not read"],
      ["Days read", "14"],
    ]);
    /*
     * Why the change works: its readings at the new size. Its readings now
     * are its figures above, not said a second time in words.
     */
    expect(text.why).toEqual([
      "At m5.xlarge, 95% of the time its CPU would be at or under 48%.",
    ]);
    // Sized by CPU only: check its memory before a smaller size.
    expect(text.caveat).toBe(MEMORY_NEEDS_CLOUDWATCH_AGENT);
  });

  test("a database's saving is 'up to', its bill holding its storage", () => {
    expect(
      textOf(sizingOf({ profile: RDS, size: "db.r6g.2xlarge", dailyCost: 20 }))
        .saving,
    ).toMatch(/^Saves up to \$/);
    expect(
      textOf(sizingOf({ profile: RDS, size: "db.r6g.2xlarge", dailyCost: 20 }))
        .saving,
    ).toContain("its bill also holds its storage, which stays the same.");
  });

  test("a quarter of its size, said so", () => {
    expect(
      textOf(
        sizingOf({
          size: "m5.8xlarge",
          fields: { cpuP95Percent: 4, cpuMaxPercent: 9 },
        }),
      ),
    ).toMatchObject({
      headline: "A size a quarter as big would do.",
      change: { from: "m5.8xlarge", to: "m5.2xlarge" },
    });
  });

  test("its cost not known: the change, and that its saving is not known yet, and why", () => {
    const text: CloudRightSizingText = textOf(sizingOf({}));
    expect(text.isSavingKnown).toBe(false);
    expect(text.saving).toBe(
      "What it would save is not known yet: its cloud's bill does not name it.",
    );
    expect(text.savingTone).toBe("neutral");
    expect(text.savingSentence).toBeNull();
  });

  test("under-provisioned: the size twice as big, and what it adds a month", () => {
    const text: CloudRightSizingText = textOf(
      sizingOf({
        profile: RDS,
        size: "db.r6g.xlarge",
        fields: { cpuP95Percent: 92, cpuMaxPercent: 100 },
        dailyCost: 10,
      }),
    );
    expect(text).toMatchObject({
      verdict: "Under-provisioned",
      tone: "danger",
      headline: "A size twice as big would keep up.",
      change: { from: "db.r6g.xlarge", to: "db.r6g.2xlarge" },
      isSavingKnown: true,
      caveat: null,
    });
    expect(text.saving).toMatch(/^Costs about \$304\.38 a month more/);
    // A larger size costs more: money out, never toned as a saving.
    expect(text.savingTone).toBe("warning");
    expect(text.savingSentence).toEqual({
      template:
        "Costs about {{amount}} a month more, at its cost over the last 30 days.",
      amount: "$304.38",
    });
    // Its readings at the size twice as big: half what they are now.
    expect(text.why).toEqual([
      "At db.r6g.2xlarge, 95% of the time its CPU would be at or under 46%.",
    ]);
  });

  test("right-sized: it fits, no change, no saving and nothing to check", () => {
    const text: CloudRightSizingText = textOf(
      sizingOf({ fields: { cpuP95Percent: 55, cpuMaxPercent: 80 } }),
    );
    expect(text).toMatchObject({
      verdict: "Right-sized",
      tone: "positive",
      headline: "Its size fits what it uses.",
      change: null,
      saving: null,
      caveat: null,
    });
    // No change, so nothing to say of a new size: its figures say the rest.
    expect(text.why).toEqual([]);
    expect(text.facts).toHaveLength(4);
  });

  test("not enough readings yet: how many days it needs and has, nothing else", () => {
    const text: CloudRightSizingText = textOf(
      sizingOf({ fields: { observedHours: 50, samples: 600 } }),
    );
    expect(text).toMatchObject({
      verdict: "Not enough readings yet",
      tone: "neutral",
      headline:
        "Right-sizing needs 6 days of its CPU readings. It has 2 so far.",
      facts: [],
      why: [],
      saving: null,
    });
  });

  test("room to spare at its family's smallest size: said, with no change and no saving", () => {
    const text: CloudRightSizingText = textOf(
      sizingOf({
        size: "m5.large",
        fields: { cpuP95Percent: 3, cpuMaxPercent: 6 },
        dailyCost: 3,
      }),
    );
    expect(text).toMatchObject({
      verdict: "Over-provisioned",
      change: null,
      saving: null,
      why: [],
      headline:
        "It has room to spare, and already has the smallest size of its family.",
    });
  });

  test("a memory it reads: its peak, and both at the smaller size", () => {
    const text: CloudRightSizingText = textOf(
      sizingOf({
        profile: CACHE,
        size: "cache.r6g.xlarge",
        fields: { cpuP95Percent: 10, cpuMaxPercent: 20, memoryPeakPercent: 28 },
      }),
    );
    expect(text.facts[2]).toMatchObject({ value: "28%" });
    expect(text.why).toEqual([
      "At cache.r6g.large, 95% of the time its CPU would be at or under 20%, and its memory would peak at 56%.",
    ]);
    expect(text.caveat).toBeNull();
  });

  test("in German: the Dashboard's own German sentences, numbers German's way", () => {
    const text: CloudRightSizingText = textOf(
      sizingOf({ dailyCost: 9.2 }),
      german,
    );
    expect(text.headline).toBe(germanLocale["A size half as big would do."]);
    expect(withoutIsolateMarks(text.why[0]!)).toBe(
      "Mit m5.xlarge läge die CPU zu 95 % der Zeit bei höchstens 48%.",
    );
    expect(withoutIsolateMarks(text.saving!)).toMatch(
      /^Spart etwa 140,\d\d\s\$ pro Monat/,
    );
    expect(withoutIsolateMarks(textOf(sizingOf({}), german).saving || "")).toBe(
      "Die Einsparung ist noch nicht bekannt: Die Rechnung der Cloud weist diese Ressource nicht einzeln aus.",
    );
    expect(text.caveat).toBe(
      (germanLocale as unknown as Record<string, string>)[
        MEMORY_NEEDS_CLOUDWATCH_AGENT
      ],
    );
  });
});

describe("what Savings says under OneUptime's own right-sizing", () => {
  test("its readings, with memory when it was read, and nothing for a cloud's own", () => {
    expect(
      getCloudRightSizingEvidenceLine({
        evidence: {
          cpuP95Percent: 11.2,
          cpuMaxPercent: 30,
          memoryPeakPercent: null,
          observedDays: 14,
          factor: 2,
          isSavingUpperBound: false,
        },
        translator: english,
      }),
    ).toBe(
      "OneUptime's readings: 95% of the time its CPU was at or under 11%, and never above 30%.",
    );
    expect(
      getCloudRightSizingEvidenceLine({
        evidence: {
          cpuP95Percent: 8,
          cpuMaxPercent: 12,
          memoryPeakPercent: 31,
          observedDays: 9,
          factor: 2,
          isSavingUpperBound: false,
        },
        translator: english,
      }),
    ).toBe(
      "OneUptime's readings: 95% of the time its CPU was at or under 8%, and never above 12%; its memory peaked at 31%.",
    );
    expect(
      getCloudRightSizingEvidenceLine({ evidence: null, translator: english }),
    ).toBeNull();
  });

  test("an amount is known when there is one: OneUptime's of a resource not billed by name is not", () => {
    expect(isCloudSavingAmountKnown({ monthlySavings: 12.5 })).toBe(true);
    expect(isCloudSavingAmountKnown({ monthlySavings: 0 })).toBe(false);
    expect(isCloudSavingAmountKnown({ monthlySavings: null })).toBe(false);
    expect(isCloudSavingAmountKnown({})).toBe(false);
  });
});

describe("the card, drawn", () => {
  let instance: i18n;

  beforeAll(async () => {
    instance = createInstance();
    await instance.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        de: { translation: germanLocale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("its verdict, change, saving, figures, its readings at the new size and caveat", async () => {
    const consoleErrors: Array<string> = [];
    const consoleError: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      console,
      "error",
    ).mockImplementation((...args: Array<unknown>): void => {
      consoleErrors.push(args.map(String).join(" "));
    });

    await act(async () => {
      render(
        <CloudResourceRightSizingCard sizing={sizingOf({ dailyCost: 9.2 })} />,
      );
    });
    consoleError.mockRestore();

    /*
     * Nothing nested where HTML does not allow it: the caveat's icon is a
     * div, which a paragraph may not hold - a p there made React say so in
     * the console and the browser close the paragraph before it.
     */
    expect(
      consoleErrors.filter((message: string): boolean => {
        return message.includes("validateDOMNesting");
      }),
    ).toEqual([]);

    const card: HTMLElement = screen.getByTestId("cloud-right-sizing");
    expect(card).toHaveAttribute(
      "data-verdict",
      CloudRightSizingVerdict.Overprovisioned,
    );
    expect(screen.getByText("Right-sizing")).toBeInTheDocument();
    expect(
      within(card).getByTestId("cloud-right-sizing-verdict"),
    ).toHaveTextContent("Over-provisioned");
    expect(
      within(card).getByTestId("cloud-right-sizing-verdict"),
    ).toHaveAttribute("data-tone", "warning");
    const change: HTMLElement = within(card).getByTestId(
      "cloud-right-sizing-change",
    );
    /*
     * Each of the cloud's size names set apart in its own direction (bdi),
     * and the arrow between them the page's (DirectionArrow, #7666).
     */
    expect(
      Array.from(change.querySelectorAll("bdi")).map(
        (name: Element): string => {
          return name.textContent || "";
        },
      ),
    ).toEqual(["m5.2xlarge", "m5.xlarge"]);
    expect(change).toHaveTextContent("m5.2xlarge → m5.xlarge");
    expect(change.className).toContain("font-mono");
    const savingLine: HTMLElement = within(card).getByTestId(
      "cloud-right-sizing-saving",
    );
    expect(savingLine).toHaveAttribute("data-known", "true");
    expect(savingLine).toHaveAttribute("data-tone", "positive");
    expect(savingLine).toHaveTextContent(
      "Saves about $140.01 a month, at its cost over the last 30 days.",
    );
    // The amount stands out in green; the words around it are quieter.
    const amount: HTMLElement = within(savingLine).getByTestId(
      "cloud-right-sizing-saving-amount",
    );
    expect(amount).toHaveTextContent("$140.01");
    expect(amount.className.split(" ")).toEqual(
      expect.arrayContaining(["font-semibold", "text-emerald-700"]),
    );
    expect(savingLine.className).not.toContain("font-semibold");
    expect(
      within(card).getByTestId("cloud-right-sizing-cpu-p95"),
    ).toHaveTextContent("24%");
    expect(
      within(card).getByTestId("cloud-right-sizing-memory"),
    ).toHaveTextContent("Not read");
    // One line: its readings at the new size, under its figures.
    const why: HTMLElement = within(card).getByTestId("cloud-right-sizing-why");
    expect(why.querySelectorAll("p")).toHaveLength(1);
    expect(why).toHaveTextContent(
      "At m5.xlarge, 95% of the time its CPU would be at or under 48%.",
    );
    expect(card.textContent || "").not.toContain("never above");
    const caveat: HTMLElement = within(card).getByTestId(
      "cloud-right-sizing-caveat",
    );
    expect(caveat).toHaveTextContent(MEMORY_NEEDS_CLOUDWATCH_AGENT);
    expect(caveat.tagName).toBe("DIV");
    expect(caveat.closest("p")).toBeNull();
  });

  test("in German, every word the Dashboard's German", async () => {
    await act(async () => {
      render(
        <I18nextProvider i18n={instance}>
          <CloudResourceRightSizingCard sizing={sizingOf({ dailyCost: 9.2 })} />
        </I18nextProvider>,
      );
    });

    const card: HTMLElement = screen.getByTestId("cloud-right-sizing");
    expect(
      screen.getByText(
        (germanLocale as unknown as Record<string, string>)["Right-sizing"]!,
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("cloud-right-sizing-verdict"),
    ).toHaveTextContent(
      (germanLocale as unknown as Record<string, string>)["Over-provisioned"]!,
    );
    expect(
      within(card).getByTestId("cloud-right-sizing-cpu-p95"),
    ).toHaveTextContent(
      (germanLocale as unknown as Record<string, string>)[
        "CPU (95th percentile)"
      ]!,
    );
    expect(
      within(card).getByTestId("cloud-right-sizing-memory"),
    ).toHaveTextContent(
      (germanLocale as unknown as Record<string, string>)["Not read"]!,
    );
    expect(card.textContent || "").not.toContain("Over-provisioned");
  });

  test("under-provisioned: what the larger size adds a month, in amber - never a saving's green", async () => {
    await act(async () => {
      render(
        <CloudResourceRightSizingCard
          sizing={sizingOf({
            profile: RDS,
            size: "db.r6g.xlarge",
            fields: { cpuP95Percent: 92, cpuMaxPercent: 100 },
            dailyCost: 10,
          })}
        />,
      );
    });

    const savingLine: HTMLElement = screen.getByTestId(
      "cloud-right-sizing-saving",
    );
    expect(savingLine).toHaveAttribute("data-tone", "warning");
    expect(savingLine).toHaveTextContent(
      "Costs about $304.38 a month more, at its cost over the last 30 days.",
    );
    const amount: HTMLElement = within(savingLine).getByTestId(
      "cloud-right-sizing-saving-amount",
    );
    expect(amount.className).toContain("text-amber-700");
    expect(savingLine.innerHTML).not.toContain("emerald");
    expect(screen.getByTestId("cloud-right-sizing-verdict")).toHaveAttribute(
      "data-tone",
      "danger",
    );
  });

  test("its saving not known yet: said quietly, with no amount drawn", async () => {
    await act(async () => {
      render(<CloudResourceRightSizingCard sizing={sizingOf({})} />);
    });

    const savingLine: HTMLElement = screen.getByTestId(
      "cloud-right-sizing-saving",
    );
    expect(savingLine).toHaveAttribute("data-known", "false");
    expect(savingLine).toHaveAttribute("data-tone", "neutral");
    expect(savingLine.className).toContain("text-gray-500");
    expect(screen.queryByTestId("cloud-right-sizing-saving-amount")).toBeNull();
  });

  test("not enough readings: the pill and how far it has come, no figures", async () => {
    await act(async () => {
      render(
        <CloudResourceRightSizingCard
          sizing={sizingOf({ fields: { observedHours: 80, samples: 900 } })}
        />,
      );
    });
    expect(screen.getByTestId("cloud-right-sizing-headline")).toHaveTextContent(
      "It has 3 so far.",
    );
    expect(screen.queryByTestId("cloud-right-sizing-cpu-p95")).toBeNull();
    expect(screen.queryByTestId("cloud-right-sizing-why")).toBeNull();
  });
});

describe("which cards a resource's Overview shows", () => {
  function cost(
    recommendations: Array<Partial<CloudCostRecommendation>>,
    hasCosts: boolean = true,
  ): CloudResourceCost {
    return {
      currency: "USD",
      monthToDate: 200,
      last30Days: 276,
      hasCosts,
      recommendations: recommendations.map(
        (fields: Partial<CloudCostRecommendation>) => {
          return Object.assign(new CloudCostRecommendation(), fields);
        },
      ),
    };
  }

  const usage: CloudUsageObservation = observation({});
  const sizing: CloudRightSizing = sizingOf({ dailyCost: 9.2 });
  const oneUptimeRow: Partial<CloudCostRecommendation> = {
    recommendationId: getCloudRightSizingRecommendationId(
      RESOURCE_ROW.toString(),
    ),
    kind: CloudSavingKind.Rightsize,
  };

  test("its cost and its right-sizing, OneUptime's own row said once - on the right-sizing card", () => {
    const shown: CloudResourceSpendCardsShown = decideCloudResourceSpendCards({
      cost: cost([
        oneUptimeRow,
        { recommendationId: "rec-1", kind: CloudSavingKind.Commitment },
      ]),
      sizing,
      usage,
    });
    expect(shown.sizing).toBe(sizing);
    expect(shown.cost).not.toBeNull();
    expect(
      shown.costRows.map((row: CloudCostRecommendation) => {
        return row.recommendationId;
      }),
    ).toEqual(["rec-1"]);
  });

  test("a recommender of its cloud speaks for it: its word, and no right-sizing of OneUptime's", () => {
    const shown: CloudResourceSpendCardsShown = decideCloudResourceSpendCards({
      cost: cost([
        { recommendationId: "rec-1", kind: CloudSavingKind.Rightsize },
      ]),
      sizing,
      usage,
    });
    expect(shown.sizing).toBeNull();
    expect(shown.costRows).toHaveLength(1);
  });

  test("no cost and only OneUptime's row: the right-sizing card alone", () => {
    const shown: CloudResourceSpendCardsShown = decideCloudResourceSpendCards({
      cost: cost([oneUptimeRow], false),
      sizing,
      usage,
    });
    expect(shown.cost).toBeNull();
    expect(shown.sizing).toBe(sizing);
  });

  test("no readings, or a size not sized: the cost card alone, OneUptime's stored row on it", () => {
    for (const data of [
      { sizing: null, usage: null },
      {
        sizing: sizingOf({ size: "t3.large" }),
        usage,
      },
      { sizing, usage: observation({ samples: 0 }) },
    ]) {
      const shown: CloudResourceSpendCardsShown = decideCloudResourceSpendCards(
        {
          cost: cost([oneUptimeRow], false),
          ...data,
        },
      );
      expect(shown.sizing).toBeNull();
      expect(shown.costRows).toHaveLength(1);
      expect(shown.cost).not.toBeNull();
    }
  });

  test("neither: nothing", () => {
    expect(
      decideCloudResourceSpendCards({ cost: null, sizing: null, usage: null }),
    ).toEqual({ cost: null, costRows: [], sizing: null });
  });
});

describe("the reads", () => {
  let aggregates: Array<{ modelType: unknown; aggregateBy: AggregateBy<any> }> =
    [];
  let metricRows: Map<
    AggregationType,
    Array<Record<string, unknown>>
  > = new Map();
  let costDays: Array<Record<string, unknown>> = [];
  let recommendations: Array<CloudCostRecommendation> = [];
  let failMetrics: boolean = false;

  beforeEach(() => {
    aggregates = [];
    failMetrics = false;
    costDays = Array.from({ length: 14 }, (_value: unknown, index: number) => {
      return {
        timestamp: new Date(NOW.getTime() - index * 24 * HOUR),
        value: 9.2,
      };
    });
    metricRows = new Map([
      [
        AggregationType.P95,
        [{ value: 24, timestamp: new Date(NOW.getTime() - 14 * 24 * HOUR) }],
      ],
      [AggregationType.Max, [{ value: 41, timestamp: NOW }]],
      [AggregationType.Count, [{ value: 4032, timestamp: NOW }]],
    ]);
    recommendations = [];

    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    getJestSpyOn(AnalyticsModelAPI, "aggregate").mockImplementation(
      async (request: {
        modelType: unknown;
        aggregateBy: AggregateBy<any>;
      }): Promise<unknown> => {
        aggregates.push(request);

        if (request.modelType === Metric) {
          if (failMetrics) {
            throw new Error("The server took too long to answer.");
          }
          return {
            data: metricRows.get(request.aggregateBy.aggregationType) || [],
          };
        }

        if (
          request.aggregateBy.aggregationInterval === AggregationInterval.Day
        ) {
          return { data: costDays };
        }

        // The month and the last 30 days, by currency.
        return { data: [{ currency: "USD", value: 276 }] };
      },
    );
    getJestSpyOn(ModelAPI, "getList").mockImplementation(
      async (): Promise<unknown> => {
        return {
          data: recommendations,
          count: recommendations.length,
          skip: 0,
          limit: 5,
        };
      },
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  function resource(fields: Partial<CloudResource> = {}): CloudResource {
    return Object.assign(new CloudResource(), {
      _id: RESOURCE_ROW.toString(),
      id: RESOURCE_ROW,
      cloudProvider: "aws",
      cloudResourceType: "AWS::EC2::Instance",
      cloudResourceKind: CloudResourceKind.Resource,
      cloudProperties: { InstanceType: "m5.2xlarge" },
      providerResourceId: ARN,
      telemetryAttributes: {
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": "i-0web1",
      },
      ...fields,
    });
  }

  function metricReads(): Array<AggregateBy<any>> {
    return aggregates
      .filter((request: { modelType: unknown }) => {
        return request.modelType === Metric;
      })
      .map((request: { aggregateBy: AggregateBy<any> }) => {
        return request.aggregateBy;
      });
  }

  test("its usage: the CPU's 95th percentile, its highest and its count, over 14 days, by its own attributes", async () => {
    const usage: CloudUsageObservation | null = await fetchCloudResourceUsage({
      projectId: PROJECT,
      profile: EC2,
      attributeFilters: {
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": "i-0web1",
      },
      now: NOW,
    });

    expect(usage).toEqual({
      cpuP95Percent: 24,
      cpuMaxPercent: 41,
      memoryPeakPercent: null,
      samples: 4032,
      observedHours: 14 * 24,
    });
    const reads: Array<AggregateBy<any>> = metricReads();
    expect(
      reads.map((read: AggregateBy<any>) => {
        return read.aggregationType;
      }),
    ).toEqual([
      AggregationType.P95,
      AggregationType.Max,
      AggregationType.Count,
    ]);
    for (const read of reads) {
      expect(read.aggregationInterval).toBe(AggregationInterval.Total);
      expect(read.query["name"]).toBe("amazonaws.com/aws/ec2/cpuutilization");
      expect(read.query["attributes"]).toEqual({
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": "i-0web1",
      });
      expect(read.startTimestamp).toEqual(
        new Date(NOW.getTime() - 14 * 24 * HOUR),
      );
    }
  });

  test("a memory it reads is read too, under every name its cloud may store it", async () => {
    const azure: CloudRightSizingProfile = getCloudRightSizingProfile(
      "azure",
      "Microsoft.Web/serverfarms",
    )!;
    metricRows.set(AggregationType.Max, [{ value: 33, timestamp: NOW }]);

    const usage: CloudUsageObservation | null = await fetchCloudResourceUsage({
      projectId: PROJECT,
      profile: azure,
      attributeFilters: { "azuremonitor.resource_id": "/subscriptions/s/plan" },
      now: NOW,
    });

    expect(usage?.memoryPeakPercent).toBe(33);
    const reads: Array<AggregateBy<any>> = metricReads();
    expect(reads).toHaveLength(4);
    expect(reads[3]!.query["name"]).toBeInstanceOf(Includes);
    expect((reads[3]!.query["name"] as Includes).values).toContain(
      "azure_memorypercentage_average",
    );
  });

  test("no CPU read, or no attributes to read it by: no usage", async () => {
    metricRows.set(AggregationType.P95, []);
    expect(
      await fetchCloudResourceUsage({
        projectId: PROJECT,
        profile: EC2,
        attributeFilters: { Namespace: "AWS/EC2" },
        now: NOW,
      }),
    ).toBeNull();

    aggregates = [];
    expect(
      await fetchCloudResourceUsage({
        projectId: PROJECT,
        profile: EC2,
        attributeFilters: {},
        now: NOW,
      }),
    ).toBeNull();
    expect(aggregates).toHaveLength(0);
  });

  test("its daily cost: its own cost key, in its currency, by day over the last 30, averaged over the days billed", async () => {
    costDays = [
      { timestamp: NOW, value: 10 },
      { timestamp: NOW, value: 0 },
      { timestamp: NOW, value: 14 },
    ];
    expect(
      await fetchCloudResourceDailyCost({
        projectId: PROJECT,
        provider: "aws",
        providerResourceId: ARN,
        currency: "USD",
        now: NOW,
      }),
    ).toEqual({ amount: 12, currency: "USD", days: 2 });

    const read: AggregateBy<CloudCost> = aggregates[0]!.aggregateBy;
    expect(aggregates[0]!.modelType).toBe(CloudCost);
    expect(read.aggregationInterval).toBe(AggregationInterval.Day);
    expect(read.query["resourceId" as keyof CloudCost] as unknown).toBe(ARN);
    expect(read.query["currency" as keyof CloudCost] as unknown).toBe("USD");
    expect(read.startTimestamp).toEqual(new Date("2026-10-22T00:00:00.000Z"));

    costDays = [];
    expect(
      await fetchCloudResourceDailyCost({
        projectId: PROJECT,
        provider: "aws",
        providerResourceId: ARN,
        currency: "USD",
        now: NOW,
      }),
    ).toBeNull();
  });

  async function draw(given: CloudResource): Promise<void> {
    await act(async () => {
      render(<CloudResourceSpendCards projectId={PROJECT} resource={given} />);
    });
  }

  test("the Overview: what it costs beside its right-sizing, which says what the change saves from that cost", async () => {
    recommendations = [
      Object.assign(new CloudCostRecommendation(), {
        _id: "10000000-0000-4000-8000-0000000000f1",
        recommendationId: getCloudRightSizingRecommendationId(
          RESOURCE_ROW.toString(),
        ),
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        currentConfiguration: "m5.2xlarge",
        recommendedConfiguration: "m5.xlarge",
        monthlySavings: 140,
        currency: "USD",
      }),
    ];
    await draw(resource());

    const grid: HTMLElement = screen.getByTestId("cloud-resource-spend-cards");
    expect(within(grid).getByTestId("cloud-resource-cost")).toBeInTheDocument();
    expect(within(grid).getByTestId("cloud-right-sizing")).toBeInTheDocument();
    // OneUptime's own row is said by the right-sizing card, not again.
    expect(within(grid).queryByTestId("cloud-resource-savings")).toBeNull();
    const saving: number =
      Math.round(Math.round(9.2 * CLOUD_DAYS_IN_AVERAGE_MONTH * 100) / 2) / 100;
    expect(screen.getByTestId("cloud-right-sizing-saving")).toHaveTextContent(
      `Saves about $${saving.toFixed(2)} a month`,
    );
    // The cost a day was read, by day.
    expect(
      aggregates.some((request: { aggregateBy: AggregateBy<any> }) => {
        return (
          request.aggregateBy.aggregationInterval === AggregationInterval.Day
        );
      }),
    ).toBe(true);
  });

  test("a recommender of its cloud speaks for it: its word on the cost card, no right-sizing of OneUptime's", async () => {
    recommendations = [
      Object.assign(new CloudCostRecommendation(), {
        _id: "10000000-0000-4000-8000-0000000000f2",
        recommendationId: "rec-hub-1",
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        monthlySavings: 210,
        currency: "USD",
      }),
    ];
    await draw(resource());

    expect(screen.getByTestId("cloud-resource-savings")).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-right-sizing")).toBeNull();
    // Its readings are never read: its card would not be drawn.
    expect(metricReads()).toHaveLength(0);
    // No saving to work out: its cost a day is never read.
    expect(
      aggregates.some((request: { aggregateBy: AggregateBy<any> }) => {
        return (
          request.aggregateBy.aggregationInterval === AggregationInterval.Day
        );
      }),
    ).toBe(false);
  });

  test("not billed by name: its right-sizing alone, its saving not known yet", async () => {
    await draw(resource({ providerResourceId: "" }));

    expect(screen.queryByTestId("cloud-resource-cost")).toBeNull();
    expect(screen.getByTestId("cloud-right-sizing-saving")).toHaveAttribute(
      "data-known",
      "false",
    );
  });

  test("a burstable size is never read for its usage", async () => {
    await draw(resource({ cloudProperties: { InstanceType: "t3.large" } }));

    expect(metricReads()).toHaveLength(0);
    expect(screen.queryByTestId("cloud-right-sizing")).toBeNull();
    // Its cost is still said.
    expect(screen.getByTestId("cloud-resource-cost")).toBeInTheDocument();
  });

  test("reads that fail draw nothing of theirs, and never an error", async () => {
    failMetrics = true;
    await draw(resource());

    expect(screen.queryByTestId("cloud-right-sizing")).toBeNull();
    expect(screen.getByTestId("cloud-resource-cost")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
