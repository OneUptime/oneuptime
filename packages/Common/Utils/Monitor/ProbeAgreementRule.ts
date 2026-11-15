import { Translator } from "../../Types/Translator";

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
  const activeCount: number = data.activeProbeCount;
  const requiredCount: number = getProbeAgreementRequiredCount({
    minimumProbeAgreement: data.minimumProbeAgreement,
    activeProbeCount: activeCount,
  });

  if (activeCount < 2 || requiredCount < 2) {
    return null;
  }

  if (requiredCount < activeCount) {
    return translator.translateTemplate(
      "A status change needs {{required}} of {{count}} connected probes to agree.",
      {
        required: translator.formatNumber(requiredCount),
        count: translator.formatNumber(activeCount),
      },
    );
  }

  return activeCount === 2
    ? translator.translateTemplate(
        "A status change needs both connected probes to agree.",
      )
    : translator.translateTemplate(
        "A status change needs all {{count}} connected probes to agree.",
        { count: translator.formatNumber(activeCount) },
      );
};
