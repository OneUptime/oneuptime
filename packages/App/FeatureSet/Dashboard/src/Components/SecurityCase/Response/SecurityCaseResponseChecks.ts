import {
  getResponseLinkRoute,
  getResponseLinkUrl,
} from "./SecurityCaseResponseLinks";
import { ResponseStep } from "./SecurityCaseResponseTypes";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ResponseLink,
  ResponseLinkKind,
} from "Common/Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityCaseStepCheckSentence,
  StepCheckFactMark,
} from "Common/Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "Common/Types/SecurityCase/SecurityCaseStepCheckState";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { wordStepCheckSentence } from "Common/Utils/SecurityCase/ResponsePlan/StepCheckSentences";
import { WrittenMoment, writeReaderMoment } from "Common/Utils/MomentPhrases";
import {
  CHECK_ACCOUNT_CHANGES_EDIT_CONNECTION,
  CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS,
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
 * and how to let it check - since that is what the person acts on, and so
 * does one that looks done but leaves something for the person to confirm,
 * named one by one: the account changes OneUptime cannot read back
 * (#10603). So does one that names what is still to undo: the changes an
 * attack made that are still there, each the person's to undo (#10900).
 * Every other check folds what else it saw under How We Know.
 */
export function isCheckExplainedInline(check: {
  state: SecurityCaseStepCheckState;
  evidence: { data: Record<string, unknown> };
}): boolean {
  if (check.state === SecurityCaseStepCheckState.CannotTell) {
    return true;
  }

  const counted: (key: string) => boolean = (key: string): boolean => {
    const count: unknown = check.evidence.data[key];

    return typeof count === "number" && count > 0;
  };

  if (check.state === SecurityCaseStepCheckState.LooksDone) {
    return counted("toConfirm");
  }

  return (
    (check.state === SecurityCaseStepCheckState.NotDone ||
      check.state === SecurityCaseStepCheckState.Regressed) &&
    counted("stillThere")
  );
}

/*
 * How the card marks a fact (StepCheckFactMark): an icon and its colour,
 * one each, so a list of what OneUptime read back reads at a glance - done,
 * still to do, a person's to confirm, how to let OneUptime read the rest.
 * The sentence says it too: the mark is never all a reader has.
 */
export interface StepCheckFactMarkStyle {
  icon: IconProp;
  className: string;
}

export const STEP_CHECK_FACT_MARK_STYLES: Record<
  StepCheckFactMark,
  StepCheckFactMarkStyle
> = {
  [StepCheckFactMark.Done]: {
    icon: IconProp.CheckCircle,
    className: "text-emerald-600",
  },
  [StepCheckFactMark.NotDone]: {
    icon: IconProp.XCircle,
    className: "text-red-600",
  },
  [StepCheckFactMark.Confirm]: {
    icon: IconProp.QuestionMarkCircle,
    className: "text-amber-600",
  },
  [StepCheckFactMark.HowToCheck]: {
    icon: IconProp.InformationCircle,
    className: "text-indigo-600",
  },
};

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

/*
 * A moment of OneUptime's evidence on the reader's clock: the time alone
 * today, the day and the time on another day - each a sentence's moment
 * brings its own words to, "at 14:25", "on 27 Nov at 14:25" (#10622).
 */
export function writeCheckMoment(
  time: Date,
  now: Date = new Date(),
): WrittenMoment {
  return writeReaderMoment(time, now);
}

// A sentence of the evidence in the reader's words, its moments on their clock.
export function readCheckSentence(
  sentence: SecurityCaseStepCheckSentence,
  translator: Translator,
  now: Date = new Date(),
): string {
  return wordStepCheckSentence({
    sentence,
    translator,
    writeMoment: (time: Date): WrittenMoment => {
      return writeCheckMoment(time, now);
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

/*
 * What the reader may do on Cloud > Connect (#11039): see the page - it
 * lists the connections, which the cloud connections' read permission
 * reads - and change a connection there, which only a project's owners and
 * admins may.
 */
export interface CloudConnectionsAccess {
  mayRead: boolean;
  mayUpdate: boolean;
}

export const NO_CLOUD_CONNECTIONS_ACCESS: CloudConnectionsAccess = {
  mayRead: false,
  mayUpdate: false,
};

/*
 * Where a link of the evidence - the step's, or a fact's own - opens, and
 * its words. Cloud > Connect (#11039) only for a reader who may see the
 * page: on the connection's form, "Edit Connection", for one who may
 * change it; the page itself, "Open Cloud Connections", for one who may
 * only see it. A reader who may not see it gets no link: the line names
 * the menu path, for someone who may.
 */
export function getStepCheckLinkTarget(
  link: ResponseLink,
  access: CloudConnectionsAccess = NO_CLOUD_CONNECTIONS_ACCESS,
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

    case ResponseLinkKind.OpenCloudConnection: {
      if (!access.mayRead) {
        return null;
      }

      const canEdit: boolean = Boolean(link.connectionId) && access.mayUpdate;
      const route: Route | null = getResponseLinkRoute(
        canEdit ? link : { kind: ResponseLinkKind.OpenCloudConnection },
      );

      return route
        ? {
            route,
            title: canEdit
              ? CHECK_ACCOUNT_CHANGES_EDIT_CONNECTION
              : CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS,
            values: {},
          }
        : null;
    }

    default:
      return null;
  }
}
