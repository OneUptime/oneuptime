import { WELCOME_NEXT_STEP_COPY } from "./WelcomeChecklistCatalog";
import {
  WelcomeNextStepLine,
  WelcomeStepInProgress,
  forgetWelcomeStepInProgress,
  getWelcomeNextStepLine,
  readWelcomeStepInProgress,
} from "./WelcomeStepInProgress";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * THE NEXT STEP, ON THE PAGE A STEP'S RECORD LANDS ON (issue #6803).
 *
 * After a monitor, a status page or an on-call policy is created from the
 * Welcome checklist, the page the person lands on says, in one quiet line,
 * what was done, what is next, and the way back to the setup
 * (WelcomeStepInProgress decides when). Drawn above every page of the
 * project by the Dashboard's MasterPage, and nowhere else: it reads only
 * this tab's session storage and the address, so it costs no request.
 *
 * A guided setup (#6804-#6806) says what is next by itself, and a step
 * that opens one carries no line.
 */

const WelcomeNextStep: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * The step this line was closed for. The shell stays mounted while the
   * person goes on, so a step started later still gets its line.
   */
  const [closedFor, setClosedFor] = useState<number | null>(null);

  const inProgress: WelcomeStepInProgress | null = readWelcomeStepInProgress();

  let line: WelcomeNextStepLine | null = null;

  try {
    line = inProgress
      ? getWelcomeNextStepLine({
          inProgress: inProgress,
          path: Navigation.getCurrentPath().toString(),
          projectId: ProjectUtil.getCurrentProjectId()?.toString() || null,
        })
      : null;
  } catch {
    // The line only ever helps: without an address or a project, none.
    line = null;
  }

  if (
    !line ||
    !inProgress ||
    closedFor === inProgress.startedAt ||
    !line.step.landing
  ) {
    return <></>;
  }

  const close: () => void = (): void => {
    forgetWelcomeStepInProgress();
    setClosedFor(inProgress.startedAt);
  };

  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-8">
      <div
        data-testid="welcome-next-step"
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-900"
      >
        <Icon
          icon={IconProp.CheckCircle}
          className="h-4 w-4 flex-none text-indigo-500"
        />
        <span data-testid="welcome-next-step-done">
          {translator.translateText(line.step.landing.doneText)}
        </span>
        <span data-testid="welcome-next-step-next" className="font-medium">
          {line.nextStep
            ? translator.translateTemplate(WELCOME_NEXT_STEP_COPY.next, {
                step: translator.translateText(line.nextStep.title) || "",
              })
            : translator.translateText(WELCOME_NEXT_STEP_COPY.lastStep)}
        </span>
        <span className="flex flex-1 items-center justify-end gap-3">
          <AppLink
            to={RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route)}
            onNavigateComplete={close}
            className="font-medium text-indigo-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span data-testid="welcome-next-step-back">
              {translator.translateText(WELCOME_NEXT_STEP_COPY.backToSetup)}
            </span>
          </AppLink>
          <button
            type="button"
            onClick={close}
            data-testid="welcome-next-step-close"
            aria-label={
              translator.translateText(WELCOME_NEXT_STEP_COPY.dismiss) ||
              WELCOME_NEXT_STEP_COPY.dismiss
            }
            className="rounded p-0.5 text-indigo-400 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        </span>
      </div>
    </div>
  );
};

export default WelcomeNextStep;
