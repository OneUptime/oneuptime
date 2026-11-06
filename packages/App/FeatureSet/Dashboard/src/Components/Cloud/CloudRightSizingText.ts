import {
  CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS,
  CLOUD_RIGHT_SIZING_VERDICT_LABELS,
  CloudRightSizing,
  CloudRightSizingEvidence,
  CloudRightSizingVerdict,
  RIGHT_SIZING_AT_NEW_SIZE,
  RIGHT_SIZING_AT_NEW_SIZE_WITH_MEMORY,
  RIGHT_SIZING_COSTS_MORE,
  RIGHT_SIZING_CPU_MAX_LABEL,
  RIGHT_SIZING_CPU_P95_LABEL,
  RIGHT_SIZING_DAYS_READ_LABEL,
  RIGHT_SIZING_FITS,
  RIGHT_SIZING_HALF_SIZE,
  RIGHT_SIZING_LEARNING,
  RIGHT_SIZING_MEMORY_PEAK_LABEL,
  RIGHT_SIZING_NOT_READ,
  RIGHT_SIZING_NO_LARGER_SIZE,
  RIGHT_SIZING_NO_SMALLER_SIZE,
  RIGHT_SIZING_QUARTER_SIZE,
  RIGHT_SIZING_SAVES,
  RIGHT_SIZING_SAVES_UP_TO,
  RIGHT_SIZING_SAVING_NOT_KNOWN,
  RIGHT_SIZING_TWICE_SIZE,
} from "Common/Types/Cloud/CloudRightSizing";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { formatCloudMoney } from "./CloudCostWords";

/*
 * WHAT A RESOURCE'S RIGHT-SIZING SAYS, IN THE READER'S LANGUAGE.
 *
 * Its verdict, the change to make ("m5.2xlarge → m5.xlarge") and by how
 * much, what that saves or costs a month once its cost is known, the
 * readings it was judged from (its figures), what they would be at the new
 * size, and - sized by CPU only - what to check first. React-free: the card
 * draws it, App tests read it.
 */

export type CloudRightSizingTone =
  | "warning"
  | "danger"
  | "positive"
  | "neutral";

export const CLOUD_RIGHT_SIZING_TONES: Readonly<
  Record<CloudRightSizingVerdict, CloudRightSizingTone>
> = {
  [CloudRightSizingVerdict.Overprovisioned]: "warning",
  [CloudRightSizingVerdict.Underprovisioned]: "danger",
  [CloudRightSizingVerdict.RightSized]: "positive",
  [CloudRightSizingVerdict.NotEnoughHistory]: "neutral",
  [CloudRightSizingVerdict.NotSized]: "neutral",
};

export const RIGHT_SIZING_DESCRIPTION: string = translationKey(
  "From OneUptime's own readings of its CPU and memory over the last two weeks.",
);

// A saving a page cannot say: its cloud does not bill the resource by name.
export const SAVING_NOT_KNOWN_YET: string = translationKey("Not known yet");

/*
 * A right-sizing OneUptime kept among the ways to spend less, said in one
 * line under its change on Savings: what its readings were.
 */
export const RIGHT_SIZING_EVIDENCE_LINE: string = translationKey(
  "OneUptime's readings: 95% of the time its CPU was at or under {{p95}}, and never above {{max}}.",
);
export const RIGHT_SIZING_EVIDENCE_LINE_WITH_MEMORY: string = translationKey(
  "OneUptime's readings: 95% of the time its CPU was at or under {{p95}}, and never above {{max}}; its memory peaked at {{memory}}.",
);

export interface CloudRightSizingFact {
  // Its English label, translated where it is drawn (CloudCostFigure).
  label: string;
  value: string;
  testId: string;
}

/*
 * How a saving line reads: money back (positive), money out - a larger
 * size costs more - (warning), or not known yet (neutral).
 */
export type CloudRightSizingSavingTone = "positive" | "warning" | "neutral";

/*
 * The saving line's sentence and its amount apart, so the card draws the
 * amount on its own (TranslatedSentence) and the words around it quieter.
 */
export interface CloudRightSizingSavingSentence {
  template: string;
  amount: string;
}

export interface CloudRightSizingText {
  // Its English label, translated by the pill it is drawn in.
  verdict: string;
  tone: CloudRightSizingTone;
  // The size now and the one to change to, when there is one.
  change: { from: string; to: string } | null;
  // What the change is, or why there is none.
  headline: string;
  // What it saves or costs a month, or that it is not known yet.
  saving: string | null;
  isSavingKnown: boolean;
  savingTone: CloudRightSizingSavingTone | null;
  // The saving's sentence with its amount apart, when it has one.
  savingSentence: CloudRightSizingSavingSentence | null;
  facts: Array<CloudRightSizingFact>;
  /*
   * Why the change works: its readings at the new size, when there is a
   * change. Its readings now are its facts, not said a second time.
   */
  why: Array<string>;
  // What to check first, when it was sized by CPU only.
  caveat: string | null;
}

// A percent as the tiles write one: whole, in the reader's digits.
export function formatRightSizingPercent(
  percent: number | null,
  translator: Translator,
): string {
  if (percent === null || !Number.isFinite(percent)) {
    return (
      translator.translateText(RIGHT_SIZING_NOT_READ) || RIGHT_SIZING_NOT_READ
    );
  }

  return `${translator.formatNumber(Math.round(Math.max(0, percent)))}%`;
}

function headlineOf(sizing: CloudRightSizing): string {
  switch (sizing.verdict) {
    case CloudRightSizingVerdict.Overprovisioned:
      if (!sizing.recommendedSize) {
        return RIGHT_SIZING_NO_SMALLER_SIZE;
      }
      return sizing.factor >= 4
        ? RIGHT_SIZING_QUARTER_SIZE
        : RIGHT_SIZING_HALF_SIZE;
    case CloudRightSizingVerdict.Underprovisioned:
      return sizing.recommendedSize
        ? RIGHT_SIZING_TWICE_SIZE
        : RIGHT_SIZING_NO_LARGER_SIZE;
    case CloudRightSizingVerdict.RightSized:
      return RIGHT_SIZING_FITS;
    default:
      return RIGHT_SIZING_LEARNING;
  }
}

export function getCloudRightSizingText(data: {
  sizing: CloudRightSizing;
  translator: Translator;
}): CloudRightSizingText {
  const { sizing, translator } = data;
  const percent: (value: number | null) => string = (
    value: number | null,
  ): string => {
    return formatRightSizingPercent(value, translator);
  };
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: sizing.currency || "USD",
      translator,
    });
  };

  // In English: the pill it is drawn in says it in the reader's language.
  const verdict: string = CLOUD_RIGHT_SIZING_VERDICT_LABELS[sizing.verdict];
  const tone: CloudRightSizingTone = CLOUD_RIGHT_SIZING_TONES[sizing.verdict];

  if (sizing.verdict === CloudRightSizingVerdict.NotEnoughHistory) {
    return {
      verdict,
      tone,
      change: null,
      headline: translator.translateTemplate(RIGHT_SIZING_LEARNING, {
        needed: translator.formatNumber(
          Math.round(CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS / 24),
        ),
        read: translator.formatNumber(sizing.observedDays),
      }),
      saving: null,
      isSavingKnown: false,
      savingTone: null,
      savingSentence: null,
      facts: [],
      why: [],
      caveat: null,
    };
  }

  const headlineKey: string = headlineOf(sizing);
  const change: { from: string; to: string } | null =
    sizing.currentSize && sizing.recommendedSize
      ? { from: sizing.currentSize, to: sizing.recommendedSize }
      : null;

  // What the change saves or costs, said only when there is a change.
  let savingSentence: CloudRightSizingSavingSentence | null = null;
  let savingTone: CloudRightSizingSavingTone | null = null;
  let saving: string | null = null;

  if (change && sizing.verdict === CloudRightSizingVerdict.Overprovisioned) {
    if (sizing.monthlySavings > 0) {
      savingTone = "positive";
      savingSentence = {
        template: sizing.isSavingUpperBound
          ? RIGHT_SIZING_SAVES_UP_TO
          : RIGHT_SIZING_SAVES,
        amount: money(sizing.monthlySavings),
      };
    } else {
      savingTone = "neutral";
      saving =
        translator.translateText(RIGHT_SIZING_SAVING_NOT_KNOWN) ||
        RIGHT_SIZING_SAVING_NOT_KNOWN;
    }
  } else if (
    change &&
    sizing.verdict === CloudRightSizingVerdict.Underprovisioned &&
    sizing.monthlyIncrease > 0
  ) {
    // A larger size costs more: said as money out, never as a saving.
    savingTone = "warning";
    savingSentence = {
      template: RIGHT_SIZING_COSTS_MORE,
      amount: money(sizing.monthlyIncrease),
    };
  }

  if (savingSentence) {
    saving = translator.translateTemplate(savingSentence.template, {
      amount: savingSentence.amount,
    });
  }

  const isSavingKnown: boolean = savingSentence !== null;

  const facts: Array<CloudRightSizingFact> = [
    {
      label: RIGHT_SIZING_CPU_P95_LABEL,
      value: percent(sizing.cpuP95Percent),
      testId: "cloud-right-sizing-cpu-p95",
    },
    {
      label: RIGHT_SIZING_CPU_MAX_LABEL,
      value: percent(sizing.cpuMaxPercent),
      testId: "cloud-right-sizing-cpu-max",
    },
    {
      label: RIGHT_SIZING_MEMORY_PEAK_LABEL,
      value: percent(sizing.isMemoryRead ? sizing.memoryPeakPercent : null),
      testId: "cloud-right-sizing-memory",
    },
    {
      label: RIGHT_SIZING_DAYS_READ_LABEL,
      value: translator.formatNumber(sizing.observedDays),
      testId: "cloud-right-sizing-days",
    },
  ];

  const why: Array<string> = [];

  if (change && sizing.projectedCpuP95Percent !== null) {
    why.push(
      sizing.isMemoryRead && sizing.projectedMemoryPeakPercent !== null
        ? translator.translateTemplate(RIGHT_SIZING_AT_NEW_SIZE_WITH_MEMORY, {
            size: change.to,
            p95: percent(sizing.projectedCpuP95Percent),
            memory: percent(sizing.projectedMemoryPeakPercent),
          })
        : translator.translateTemplate(RIGHT_SIZING_AT_NEW_SIZE, {
            size: change.to,
            p95: percent(sizing.projectedCpuP95Percent),
          }),
    );
  }

  // Sized by CPU only: before a smaller size, check its memory.
  const caveat: string | null =
    sizing.verdict === CloudRightSizingVerdict.Overprovisioned &&
    !sizing.isMemoryRead &&
    sizing.memoryNotRead
      ? translator.translateText(sizing.memoryNotRead) || sizing.memoryNotRead
      : null;

  return {
    verdict,
    tone,
    change,
    headline: translator.translateText(headlineKey) || headlineKey,
    saving,
    isSavingKnown,
    savingTone,
    savingSentence,
    facts,
    why,
    caveat,
  };
}

/*
 * A right-sizing kept among the ways to spend less, said under its change
 * on Savings: its readings, from its evidence. Nothing for a cloud's own.
 */
export function getCloudRightSizingEvidenceLine(data: {
  evidence: CloudRightSizingEvidence | null;
  translator: Translator;
}): string | null {
  if (!data.evidence) {
    return null;
  }

  const percent: (value: number | null) => string = (
    value: number | null,
  ): string => {
    return formatRightSizingPercent(value, data.translator);
  };
  const values: Record<string, string> = {
    p95: percent(data.evidence.cpuP95Percent),
    max: percent(data.evidence.cpuMaxPercent ?? data.evidence.cpuP95Percent),
  };

  if (data.evidence.memoryPeakPercent !== null) {
    return data.translator.translateTemplate(
      RIGHT_SIZING_EVIDENCE_LINE_WITH_MEMORY,
      { ...values, memory: percent(data.evidence.memoryPeakPercent) },
    );
  }

  return data.translator.translateTemplate(RIGHT_SIZING_EVIDENCE_LINE, values);
}

/*
 * Whether a way to spend less says what it saves: OneUptime's own
 * right-sizing of a resource its cloud does not bill by name does not yet.
 */
export function isCloudSavingAmountKnown(recommendation: {
  monthlySavings?: number | null | undefined;
}): boolean {
  return (Number(recommendation.monthlySavings) || 0) > 0;
}
