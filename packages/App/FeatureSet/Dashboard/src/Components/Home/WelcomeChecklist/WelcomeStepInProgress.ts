import {
  getWelcomeStepEntry,
  WelcomeStepEntry,
} from "./WelcomeChecklistCatalog";
import RouteMap from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  WelcomeStep,
  isWelcomeStep,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import SessionStorage from "Common/UI/Utils/SessionStorage";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * CARRYING THE NEXT STEP WITH THE PERSON (issue #6803).
 *
 * A step that opens a plain page - Create Monitor, Status Pages, On-Call
 * Duty - leaves the person on the record they made, with nothing there to
 * say what comes next. So when a step is started from Home, this tab
 * remembers it, with the step that follows; and when the tab lands on the
 * page that step's record opens on (the step's `landing`), that page shows
 * one quiet line: what was done, what is next, and the way back to Home
 * (WelcomeNextStep). The line goes once it is closed, Back to setup is
 * pressed, or after STEP_IN_PROGRESS_TTL_MS.
 *
 * Kept in this tab's session storage: it is about what this person is
 * doing now, not about the project.
 */

export const STEP_IN_PROGRESS_KEY: string =
  "welcome-checklist-step-in-progress";

// How long a started step is carried: an hour is long enough to make the record.
export const STEP_IN_PROGRESS_TTL_MS: number = 60 * 60 * 1000;

export interface WelcomeStepInProgress {
  projectId: string;
  step: WelcomeStep;
  // The step after it, when there is one left to do.
  nextStep: WelcomeStep | null;
  startedAt: number;
}

export const rememberWelcomeStepStarted: (data: {
  projectId: string;
  step: WelcomeStep;
  nextStep: WelcomeStep | null;
  now?: number | undefined;
}) => void = (data: {
  projectId: string;
  step: WelcomeStep;
  nextStep: WelcomeStep | null;
  now?: number | undefined;
}): void => {
  // Only a step with a page to land on has a line to show.
  if (!getWelcomeStepEntry(data.step).landing) {
    forgetWelcomeStepInProgress();
    return;
  }

  try {
    SessionStorage.setItem(STEP_IN_PROGRESS_KEY, {
      projectId: data.projectId,
      step: data.step,
      nextStep: data.nextStep,
      startedAt: data.now ?? Date.now(),
    });
  } catch {
    // Nothing is carried: the page shows no line.
  }
};

export const forgetWelcomeStepInProgress: () => void = (): void => {
  try {
    SessionStorage.removeItem(STEP_IN_PROGRESS_KEY);
  } catch {
    // Nothing to forget.
  }
};

export const readWelcomeStepInProgress: (
  now?: number | undefined,
) => WelcomeStepInProgress | null = (
  now?: number | undefined,
): WelcomeStepInProgress | null => {
  let value: unknown;

  try {
    value = SessionStorage.getItem(STEP_IN_PROGRESS_KEY);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (
    typeof raw["projectId"] !== "string" ||
    !isWelcomeStep(raw["step"]) ||
    typeof raw["startedAt"] !== "number"
  ) {
    return null;
  }

  if ((now ?? Date.now()) - raw["startedAt"] > STEP_IN_PROGRESS_TTL_MS) {
    return null;
  }

  return {
    projectId: raw["projectId"],
    step: raw["step"],
    nextStep: isWelcomeStep(raw["nextStep"]) ? raw["nextStep"] : null,
    startedAt: raw["startedAt"],
  };
};

// A record's id in an address: an ObjectID, which is a UUID.
const RECORD_ID_PATTERN: string =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/*
 * Whether a path is the page a route names, for one project: the route's
 * ":projectId" is the project, every other parameter a record's id - so
 * "/monitors/create" is never taken for a monitor's page.
 */
export const isPathOnRoute: (data: {
  path: string;
  route: Route;
  projectId: string;
}) => boolean = (data: {
  path: string;
  route: Route;
  projectId: string;
}): boolean => {
  const template: string = data.route.toString().replace(/\/+$/, "");

  const pattern: string = template
    .split("/")
    .map((segment: string): string => {
      if (segment === ":projectId") {
        return escapeRegExp(data.projectId);
      }

      if (segment.startsWith(":")) {
        return RECORD_ID_PATTERN;
      }

      return escapeRegExp(segment);
    })
    .join("/");

  return new RegExp(`^${pattern}/?$`).test(data.path.split("?")[0] || "");
};

export interface WelcomeNextStepLine {
  step: WelcomeStepEntry;
  nextStep: WelcomeStepEntry | null;
}

/*
 * The line a page shows: the step started from Home, when this page is the
 * one its record opens on, in the same project. Null everywhere else.
 */
export const getWelcomeNextStepLine: (data: {
  inProgress: WelcomeStepInProgress | null;
  path: string;
  projectId: string | null;
}) => WelcomeNextStepLine | null = (data: {
  inProgress: WelcomeStepInProgress | null;
  path: string;
  projectId: string | null;
}): WelcomeNextStepLine | null => {
  if (
    !data.inProgress ||
    !data.projectId ||
    data.inProgress.projectId !== data.projectId
  ) {
    return null;
  }

  const entry: WelcomeStepEntry = getWelcomeStepEntry(data.inProgress.step);

  if (!entry.landing) {
    return null;
  }

  const route: Route | undefined = RouteMap[entry.landing.pageMap] as
    | Route
    | undefined;

  if (
    !route ||
    !isPathOnRoute({
      path: data.path,
      route: route,
      projectId: data.projectId,
    })
  ) {
    return null;
  }

  return {
    step: entry,
    nextStep: data.inProgress.nextStep
      ? getWelcomeStepEntry(data.inProgress.nextStep)
      : null,
  };
};
