import {
  getResponseLinkRoute,
  getResponseLinkUrl,
} from "./SecurityCaseResponseLinks";
import { ResponseStep } from "./SecurityCaseResponseTypes";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import {
  ResponseLink,
  ResponseLinkKind,
} from "Common/Types/SecurityCase/SecurityCaseResponseLink";
import { SecurityCaseStepCheckSentence } from "Common/Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "Common/Types/SecurityCase/SecurityCaseStepCheckState";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { wordStepCheckSentence } from "Common/Utils/SecurityCase/ResponsePlan/StepCheckSentences";
import {
  STEP_CHECK_OPEN_BLOCKLIST,
  STEP_CHECK_OPEN_EVENTS,
  STEP_CHECK_OPEN_PROVIDER,
  STEP_CHECK_OPEN_TRACES,
} from "Common/Utils/SecurityCase/ResponsePlan/StepCheckWords";

/*
 * How a case's Response Plan card draws what OneUptime found when it
 * checked a step itself (#10340), React-free so a plain test pins each rule:
 * the chip's tone, the line's, which steps say why at once and which fold
 * it under How We Know, when Confirm is offered, and where each link opens.
 */

// The chip: what broke in red, what needs a person in amber, done in green.
export function getStepCheckTone(state: SecurityCaseStepCheckState): PillTone {
  switch (state) {
    case SecurityCaseStepCheckState.Verified:
      return PillTone.Success;
    case SecurityCaseStepCheckState.LooksDone:
      return PillTone.Info;
    case SecurityCaseStepCheckState.NotDone:
      return PillTone.Warning;
    case SecurityCaseStepCheckState.Regressed:
      return PillTone.Danger;
    default:
      return PillTone.Neutral;
  }
}

// The evidence line's colour, by the same rule as its chip.
export function getStepCheckLineClassName(
  state: SecurityCaseStepCheckState,
): string {
  switch (state) {
    case SecurityCaseStepCheckState.Regressed:
      return "text-red-700";
    case SecurityCaseStepCheckState.NotDone:
      return "text-amber-700";
    default:
      return "text-gray-600";
  }
}

/*
 * A step OneUptime cannot tell about says why at once - what it does know,
 * and how to let it check - since that is what the person acts on; every
 * other state folds what else it saw under How We Know.
 */
export function isCheckExplainedInline(
  state: SecurityCaseStepCheckState,
): boolean {
  return state === SecurityCaseStepCheckState.CannotTell;
}

// A step that looks done is a person's to confirm: it becomes their tick.
export function canConfirmStep(step: ResponseStep): boolean {
  return (
    step.check?.state === SecurityCaseStepCheckState.LooksDone && !step.isDone
  );
}

// Ticking a step OneUptime does not see done is the person's call: "done anyway".
export function isDoneAnyway(step: ResponseStep): boolean {
  const state: SecurityCaseStepCheckState | undefined = step.check?.state;

  return (
    !step.isDone &&
    (state === SecurityCaseStepCheckState.NotDone ||
      state === SecurityCaseStepCheckState.CannotTell ||
      state === SecurityCaseStepCheckState.Regressed)
  );
}

// Done by OneUptime's own check, with no tick of a person's to take back: nothing to tick.
export function isDoneByCheckOnly(step: ResponseStep): boolean {
  return step.isCheckedByOneUptime && !step.taskId;
}

// A time of OneUptime's evidence on the reader's clock: the time today, the day and time before.
export function writeCheckTime(time: Date, now: Date = new Date()): string {
  const use12HourFormat: boolean = OneUptimeDate.getUserPrefers12HourFormat();

  return OneUptimeDate.getDateAsLocalDayMonthString(time) ===
    OneUptimeDate.getDateAsLocalDayMonthString(now)
    ? OneUptimeDate.getLocalTimeString(time, { use12HourFormat })
    : OneUptimeDate.getDateAsLocalDayMonthTimeString(time, {
        use12HourFormat,
      });
}

// A sentence of the evidence in the reader's words, its times on their clock.
export function readCheckSentence(
  sentence: SecurityCaseStepCheckSentence,
  translator: Translator,
): string {
  return wordStepCheckSentence({
    sentence,
    translator,
    writeTime: (time: Date): string => {
      return writeCheckTime(time);
    },
  });
}

// The docs page that says how to let OneUptime check a step.
export function getStepCheckDocsUrl(docsPath: string | undefined): URL | null {
  if (!docsPath) {
    return null;
  }

  try {
    return URL.fromString(`${DOCS_URL.toString()}${docsPath}`);
  } catch {
    return null;
  }
}

// What one of the evidence's links opens, and the words on it.
export interface StepCheckLinkTarget {
  route?: Route | undefined;
  url?: URL | undefined;
  title: string;
  values: Record<string, string>;
}

export function getStepCheckLinkTarget(
  link: ResponseLink,
): StepCheckLinkTarget | null {
  switch (link.kind) {
    case ResponseLinkKind.OpenTraces:
    case ResponseLinkKind.OpenEvents: {
      const route: Route | null = getResponseLinkRoute(link);

      return route
        ? {
            route,
            title:
              link.kind === ResponseLinkKind.OpenTraces
                ? STEP_CHECK_OPEN_TRACES
                : STEP_CHECK_OPEN_EVENTS,
            values: {},
          }
        : null;
    }

    // The block on the Blocklist (#10562).
    case ResponseLinkKind.OpenBlocklist: {
      const route: Route | null = getResponseLinkRoute(link);

      return route
        ? { route, title: STEP_CHECK_OPEN_BLOCKLIST, values: {} }
        : null;
    }

    case ResponseLinkKind.OpenProvider: {
      const url: URL | null = getResponseLinkUrl(link);

      return url
        ? {
            url,
            title: STEP_CHECK_OPEN_PROVIDER,
            values: { provider: link.provider },
          }
        : null;
    }

    default:
      return null;
  }
}
