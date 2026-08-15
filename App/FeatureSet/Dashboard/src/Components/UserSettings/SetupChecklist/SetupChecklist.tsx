import {
  SetupChecklist as SetupChecklistData,
  SetupHeadlineStatus,
  SetupSection,
  SetupStep,
  SetupStepStatus,
} from "./ChecklistModel";
import SetupChecklistTile from "./SetupChecklistTile";
import useSetupChecklist, { SetupChecklistState } from "./useSetupChecklist";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "What do I still have to do here?", answered on one page.
 *
 * User Settings is eleven destinations, and the two that sound most alike -
 * Notification Methods and Notification Settings - do completely different
 * jobs, while the four that decide whether you get woken up are split across
 * three side-menu sections. Nothing in that navigation says which of them you
 * have finished, which of them apply to you, or which order to do them in. This
 * card is the answer to all three, and every row on it links to the page that
 * resolves it.
 *
 * THREE RULES IT KEEPS, each of which is a way this could have been worse:
 *
 *   1. NEVER CLAIM THE ALL-CLEAR ON PARTIAL EVIDENCE. If readiness cannot be
 *      read, this renders the error and no list at all. A checklist that drew
 *      whatever it managed to load would show a short, green, wrong page at
 *      exactly the moment something is broken.
 *
 *   2. KEEP THE SHAPE WHILE LOADING. Skeleton rows rather than a spinner or a
 *      blank card, because a card that empties itself reads as broken and this
 *      one waits on several requests.
 *
 *   3. A ROW THE READER CANNOT ACT ON IS NOT A TASK. Blocked and NotApplicable
 *      rows are drawn differently, are not clickable, and do not count towards
 *      progress. The tile owns that; this file owns not counting them.
 */

export interface ComponentProps {
  userId: ObjectID | null;
  projectId: ObjectID | null;
}

interface HeadlinePresentation {
  icon: IconProp;
  iconWrapperClassName: string;
  iconClassName: string;
  containerClassName: string;
  titleClassName: string;
}

type GetHeadlinePresentationFunction = (
  status: SetupHeadlineStatus,
) => HeadlinePresentation;

/*
 * The three-state colour vocabulary the readiness surfaces already use, so a
 * responder who has seen the admin's view of themselves reads the same colours
 * here: red is the state that is losing pages, amber is degraded, emerald is
 * fine.
 */
const getHeadlinePresentation: GetHeadlinePresentationFunction = (
  status: SetupHeadlineStatus,
): HeadlinePresentation => {
  if (status === SetupHeadlineStatus.NotReachable) {
    return {
      icon: IconProp.ExclaimationCircle,
      iconWrapperClassName: "bg-red-100",
      iconClassName: "text-red-600",
      containerClassName: "border-red-200 bg-red-50",
      titleClassName: "text-red-800",
    };
  }

  if (status === SetupHeadlineStatus.NeedsSetup) {
    return {
      icon: IconProp.ExclaimationCircle,
      iconWrapperClassName: "bg-amber-100",
      iconClassName: "text-amber-600",
      containerClassName: "border-amber-200 bg-amber-50",
      titleClassName: "text-amber-800",
    };
  }

  return {
    icon: IconProp.CheckCircle,
    iconWrapperClassName: "bg-emerald-100",
    iconClassName: "text-emerald-600",
    containerClassName: "border-emerald-200 bg-emerald-50",
    titleClassName: "text-emerald-800",
  };
};

const SkeletonRows: FunctionComponent = (): ReactElement => {
  return (
    <div data-testid="setup-checklist-loading" className="space-y-6">
      <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
      <div className="h-2 max-w-md animate-pulse rounded bg-gray-100" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3].map((row: number): ReactElement => {
          return (
            <div
              key={row}
              className="h-24 animate-pulse rounded-lg bg-gray-100"
            />
          );
        })}
      </div>
    </div>
  );
};

const SetupChecklist: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const state: SetupChecklistState = useSetupChecklist({
    userId: props.userId,
    projectId: props.projectId,
  });

  const reload: () => void = (): void => {
    state.reload().catch(() => {
      // reload() routes every failure it cares about into state.
    });
  };

  /*
   * Skeletons only when there is nothing to show yet. A Recheck press must not
   * replace the list with grey blocks and take the button that was just pressed
   * off screen - the reader loses their place, and a card that empties itself on
   * every refresh reads as broken rather than busy.
   */
  if (state.isLoading && !state.checklist) {
    return (
      <Card
        title="Your setup checklist"
        description="Everything you need for OneUptime to reach you, in the order it matters."
      >
        <SkeletonRows />
      </Card>
    );
  }

  if (state.error || !state.checklist) {
    return (
      <Card
        title="Your setup checklist"
        description="Everything you need for OneUptime to reach you, in the order it matters."
      >
        <ErrorMessage
          message={
            state.error ||
            "We could not check your notification setup right now."
          }
          onRefreshClick={reload}
        />
      </Card>
    );
  }

  const checklist: SetupChecklistData = state.checklist;
  const headline: HeadlinePresentation = getHeadlinePresentation(
    checklist.headlineStatus,
  );

  return (
    <Card
      title="Your setup checklist"
      description="Everything you need for OneUptime to reach you, in the order it matters."
      rightElement={
        <Button
          title="Recheck"
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          onClick={reload}
          dataTestId="setup-checklist-recheck"
        />
      }
    >
      <div data-testid="setup-checklist">
        <div
          data-testid="setup-checklist-headline"
          data-headline-status={checklist.headlineStatus}
          className={`flex items-start gap-3 rounded-lg border p-4 ${headline.containerClassName}`}
        >
          <div
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${headline.iconWrapperClassName}`}
          >
            <Icon
              icon={headline.icon}
              className={`h-5 w-5 ${headline.iconClassName}`}
            />
          </div>
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${headline.titleClassName}`}>
              {checklist.headline}
            </div>
            {checklist.headlineConsequence ? (
              <div
                data-testid="setup-checklist-consequence"
                className="mt-1 text-sm text-gray-700"
              >
                {checklist.headlineConsequence}
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>

        {checklist.totalCount > 0 ? (
          <div className="mb-6 mt-6 max-w-md">
            <ProgressBar
              count={checklist.completedCount}
              totalCount={checklist.totalCount}
              suffix="essential steps done"
              size={ProgressBarSize.Small}
            />
            {/*
             * Reconciles a full bar with a red headline. Blocked steps are real
             * problems that are not the reader's to fix, so they are not in the
             * bar - which means that without this line somebody can read "4 of 4
             * steps done" directly under "Nothing can reach you yet" and have no
             * idea which of those two to believe.
             */}
            {checklist.blockedCount > 0 ? (
              <div
                data-testid="setup-checklist-blocked-note"
                className="mt-2 text-xs font-medium text-amber-700"
              >
                {checklist.blockedCount === 1
                  ? "1 more step needs a project admin, so it is not counted here."
                  : `${checklist.blockedCount} more steps need a project admin, so they are not counted here.`}
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <div className="mb-6" />
        )}

        <div className="space-y-8">
          {checklist.sections.map((section: SetupSection): ReactElement => {
            return (
              <div
                key={section.key}
                data-testid={`setup-checklist-section-${section.key}`}
              >
                <div className="text-sm font-semibold text-gray-900">
                  {section.title}
                </div>
                <div className="mb-3 mt-1 text-sm text-gray-500">
                  {section.description}
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {section.steps.map((step: SetupStep): ReactElement => {
                    return <SetupChecklistTile key={step.key} step={step} />;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

export default SetupChecklist;

/*
 * Re-exported so a caller can ask "is there anything outstanding?" without
 * reaching into the model module. Used by nothing today; kept out of the
 * component so a future banner elsewhere in the product cannot end up with its
 * own definition of "outstanding".
 */
export type HasOutstandingStepsFunction = (
  checklist: SetupChecklistData,
) => boolean;

export const hasOutstandingSteps: HasOutstandingStepsFunction = (
  checklist: SetupChecklistData,
): boolean => {
  return checklist.sections.some((section: SetupSection): boolean => {
    return section.steps.some((step: SetupStep): boolean => {
      return step.status === SetupStepStatus.Incomplete;
    });
  });
};
