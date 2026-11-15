import { translationKey, Translator } from "../../Types/Translator";

/*
 * THE PROBE AGREEMENT RULE, ONE COPY FOR THE SERVER AND THE PAGES.
 *
 * A probe-based monitor changes status only when its probes agree
 * (MonitorResourceUtil.checkProbeAgreement): each enabled, connected probe
 * judges its latest answer against the criteria, the verdict most of them
 * reached wins, and it counts only when at least the required number of
 * them reached it. The required number is the monitor's
 * minimumProbeAgreement - all of them when it is not set - and never more
 * than the probes that take part, so 3 required with one of three probes
 * disconnected is 2 of 2.
 *
 * The server decides with getProbeAgreementRequiredCount; the monitor's
 * probes card and the website-down guided setup say what it decides with
 * the same function, so a page never promises an incident the server
 * would not open (#7410).
 */

export const getProbeAgreementRequiredCount: (data: {
  minimumProbeAgreement: number | null | undefined;
  // The enabled, connected probes: the ones whose answers are counted.
  activeProbeCount: number;
}) => number = (data: {
  minimumProbeAgreement: number | null | undefined;
  activeProbeCount: number;
}): number => {
  /*
   * A number read back as text ("3") is that number, as Math.min took it
   * when the server wrote `minimumProbeAgreement ?? activeProbes.length`.
   */
  const minimum: number = Number(data.minimumProbeAgreement);
  const isSet: boolean =
    data.minimumProbeAgreement !== null &&
    data.minimumProbeAgreement !== undefined &&
    Number.isFinite(minimum);

  return Math.min(
    isSet ? minimum : data.activeProbeCount,
    data.activeProbeCount,
  );
};

/*
 * The rule's sentences, one copy: the probes card and the website-down
 * guided setup say them through getProbeAgreementSentence, and Ask AI's
 * set_up_website_monitoring card says them as sentences of
 * Types/AI/AIActionWords (AI_ACTION_LINES), worded by the same keys (#8245).
 */
export const PROBE_AGREEMENT_SENTENCES: {
  some: string;
  both: string;
  all: string;
} = {
  some: translationKey(
    "A status change needs {{required}} of {{count}} connected probes to agree.",
  ),
  both: translationKey("A status change needs both connected probes to agree."),
  all: translationKey(
    "A status change needs all {{count}} connected probes to agree.",
  ),
};

/*
 * Which of the rule's sentences says it, and the counts it is said with:
 * null when no agreement is needed - one probe, or a minimum of one.
 */
export interface ProbeAgreementWords {
  template: string;
  // Only the counts the template names: {{required}} and {{count}}.
  values: { required?: number; count?: number };
}

export const getProbeAgreementWords: (data: {
  minimumProbeAgreement: number | null | undefined;
  activeProbeCount: number;
}) => ProbeAgreementWords | null = (data: {
  minimumProbeAgreement: number | null | undefined;
  activeProbeCount: number;
}): ProbeAgreementWords | null => {
  const activeCount: number = data.activeProbeCount;
  const requiredCount: number = getProbeAgreementRequiredCount({
    minimumProbeAgreement: data.minimumProbeAgreement,
    activeProbeCount: activeCount,
  });

  if (activeCount < 2 || requiredCount < 2) {
    return null;
  }

  if (requiredCount < activeCount) {
    return {
      template: PROBE_AGREEMENT_SENTENCES.some,
      values: { required: requiredCount, count: activeCount },
    };
  }

  return activeCount === 2
    ? { template: PROBE_AGREEMENT_SENTENCES.both, values: {} }
    : {
        template: PROBE_AGREEMENT_SENTENCES.all,
        values: { count: activeCount },
      };
};

/*
 * The rule in a sentence: "A status change needs both connected probes to
 * agree." Null when no agreement is needed - one probe, or a minimum of
 * one. Its counts are written in the reader's digits ("۲ از ۳ پراب متصل").
 */
export const getProbeAgreementSentence: (data: {
  minimumProbeAgreement: number | null | undefined;
  activeProbeCount: number;
  translator: Translator;
}) => string | null = (data: {
  minimumProbeAgreement: number | null | undefined;
  activeProbeCount: number;
  translator: Translator;
}): string | null => {
  const translator: Translator = data.translator;
  const words: ProbeAgreementWords | null = getProbeAgreementWords({
    minimumProbeAgreement: data.minimumProbeAgreement,
    activeProbeCount: data.activeProbeCount,
  });

  if (!words) {
    return null;
  }

  const values: Record<string, string> = {};

  for (const name of Object.keys(words.values) as Array<
    keyof ProbeAgreementWords["values"]
  >) {
    values[name] = translator.formatNumber(words.values[name]!);
  }

  return translator.translateTemplate(words.template, values);
};
