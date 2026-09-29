import {
  SetupStep,
  SetupStepImportance,
  SetupStepStatus,
} from "./ChecklistModel";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One row of the checklist.
 *
 * The markup is the tile already used by Home > Getting Started and by the AI
 * code-fix readiness card, kept deliberately identical so that a reader who has
 * met one has met all three. What it adds is the two states those two do not
 * have: Blocked, which is broken but not the reader's to fix, and
 * NotApplicable, which is neither done nor outstanding.
 *
 * Those two states are why this is not a boolean tile. A Blocked row rendered
 * as an outstanding task asks somebody to do something they will be refused
 * from doing; rendered as done, it hides a live problem. A NotApplicable row
 * counted as done credits work that does not exist, and would flip to a
 * surprise gap the day an admin adds the first alert severity.
 */

export interface ComponentProps {
  step: SetupStep;
}

interface StepPresentation {
  /** The colour block behind the icon when the step is not complete. */
  iconBackgroundClassName: string;
  icon: IconProp;
  iconClassName: string;
  containerClassName: string;
  titleClassName: string;
  /** Right-hand label; null means render the chevron affordance instead. */
  rightLabel: string | null;
  rightLabelClassName: string;
}

type GetPresentationFunction = (step: SetupStep) => StepPresentation;

const getPresentation: GetPresentationFunction = (
  step: SetupStep,
): StepPresentation => {
  if (step.status === SetupStepStatus.Complete) {
    return {
      iconBackgroundClassName: "bg-emerald-100",
      icon: IconProp.Check,
      iconClassName: "text-emerald-600",
      containerClassName: "border-gray-200 bg-gray-50",
      titleClassName: "text-gray-500",
      rightLabel: "Done",
      rightLabelClassName: "text-emerald-600",
    };
  }

  if (step.status === SetupStepStatus.Blocked) {
    /*
     * Amber rather than red, and labelled by WHO is blocked rather than by
     * what is wrong. Red is reserved across these surfaces for the state that
     * is losing pages right now; this row is a real problem whose next action
     * is a conversation, and dressing it as an emergency the reader cannot end
     * is how a status colour stops being believed.
     */
    return {
      iconBackgroundClassName: "bg-amber-100",
      icon: IconProp.ExclaimationCircle,
      iconClassName: "text-amber-600",
      containerClassName: "border-amber-200 bg-amber-50",
      titleClassName: "text-gray-900",
      rightLabel: "Needs an admin",
      rightLabelClassName: "text-amber-700",
    };
  }

  if (step.status === SetupStepStatus.NotApplicable) {
    /*
     * Muted, but still legible. gray-400 on gray-50 is roughly 2.5:1, which
     * fails WCAG AA for body text - and this row's job is to EXPLAIN why a step
     * the reader might expect is absent, so it is the last text that should be
     * hard to read.
     */
    return {
      iconBackgroundClassName: "bg-gray-100",
      icon: IconProp.Info,
      iconClassName: "text-gray-500",
      containerClassName: "border-gray-200 bg-gray-50",
      titleClassName: "text-gray-600",
      rightLabel: "Not needed",
      rightLabelClassName: "text-gray-600",
    };
  }

  return {
    iconBackgroundClassName: step.iconBackgroundClassName,
    icon: step.icon,
    iconClassName: "text-white",
    containerClassName:
      "cursor-pointer border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
    titleClassName: "text-gray-900",
    rightLabel: null,
    rightLabelClassName: "",
  };
};

const SetupChecklistTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const step: SetupStep = props.step;

  /*
   * Only an outstanding step the reader can actually act on is clickable. A
   * completed row has nowhere useful to go, and a Blocked row deliberately
   * carries no page - its fix is on an admin screen that would refuse this
   * reader, and a link that 403s is worse than a sentence naming who to ask.
   */
  const isActionable: boolean =
    step.status === SetupStepStatus.Incomplete && Boolean(step.pageMap);

  const goToStep: () => void = (): void => {
    if (!isActionable || !step.pageMap) {
      return;
    }

    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[step.pageMap] as Route),
    );
  };

  const presentation: StepPresentation = getPresentation(step);

  return (
    <div
      onClick={goToStep}
      role={isActionable ? "button" : undefined}
      // A div carrying role="button" is only a button if it also behaves like one.
      tabIndex={isActionable ? 0 : undefined}
      onKeyDown={
        isActionable
          ? (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                goToStep();
              }
            }
          : undefined
      }
      data-testid={`setup-checklist-step-${step.key}`}
      data-status={step.status}
      className={`group flex items-start gap-4 rounded-lg border p-4 transition ${presentation.containerClassName}`}
    >
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${presentation.iconBackgroundClassName}`}
      >
        <Icon
          icon={presentation.icon}
          className={`h-5 w-5 ${presentation.iconClassName}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`flex items-center gap-2 text-sm font-medium ${presentation.titleClassName}`}
        >
          <span>{step.title}</span>
          {step.importance === SetupStepImportance.Optional && (
            <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
              Optional
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-gray-500">{step.description}</div>
        {step.detail ? (
          <div
            data-testid={`setup-checklist-detail-${step.key}`}
            className={`mt-1 text-sm font-medium ${
              step.status === SetupStepStatus.Blocked
                ? "text-amber-700"
                : step.status === SetupStepStatus.NotApplicable
                  ? "text-gray-600"
                  : "text-gray-700"
            }`}
          >
            {step.detail}
          </div>
        ) : (
          <></>
        )}
        {isActionable ? (
          <div className="mt-2 text-sm font-medium text-indigo-600 transition group-hover:text-indigo-700">
            {step.actionTitle} →
          </div>
        ) : (
          <></>
        )}
      </div>
      {presentation.rightLabel ? (
        <span
          className={`mt-0.5 flex-shrink-0 text-xs font-medium ${presentation.rightLabelClassName}`}
        >
          {presentation.rightLabel}
        </span>
      ) : (
        <Icon
          icon={IconProp.ChevronRight}
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400 transition group-hover:text-indigo-500"
        />
      )}
    </div>
  );
};

export default SetupChecklistTile;
