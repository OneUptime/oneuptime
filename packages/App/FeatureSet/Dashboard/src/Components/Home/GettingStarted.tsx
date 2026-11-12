import GoalQuestion from "./WelcomeChecklist/GoalQuestion";
import HowOneUptimeWorks from "./HowOneUptimeWorks";
import MemberFirstSteps from "./MemberFirstSteps/MemberFirstSteps";
import ExploreSampleProject from "../SampleProject/ExploreSampleProject";
import {
  fetchWelcomeChecklist,
  postWelcomeChecklist,
  sendLegacyBrowserState,
} from "./WelcomeChecklist/WelcomeChecklistApi";
import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_PLAN_PAGE,
  WelcomeStepEntry,
  getWelcomeGoalEntry,
  getWelcomeStepEntry,
  getWelcomeStepRoute,
} from "./WelcomeChecklist/WelcomeChecklistCatalog";
import { rememberWelcomeStepStarted } from "./WelcomeChecklist/WelcomeStepInProgress";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { ServerEmail, cannotSendEmail } from "../../Utils/ServerEmail";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import Route from "Common/Types/API/Route";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SampleProjectEntryPoint } from "Common/Types/SampleProject/SampleProject";
import ProjectGoal, {
  toGoalsEventValue,
} from "Common/Types/WelcomeChecklist/ProjectGoal";
import {
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import {
  WELCOME_CHECKLIST_GOALS_ROUTE,
  WELCOME_CHECKLIST_HIDE_ROUTE,
  WELCOME_CHECKLIST_SHOW_ROUTE,
  WelcomeChecklistAnswer,
} from "Common/Types/WelcomeChecklist/WelcomeChecklistAnswer";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import UiAnalytics from "Common/UI/Utils/Analytics";
import ChecklistEvents from "Common/UI/Utils/ChecklistEvents";
import Navigation from "Common/UI/Utils/Navigation";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE WELCOME CARD ON HOME (issue #6803).
 *
 * It starts from what the person came to do: a new project's owner is asked
 * once, "What do you want to do first?" (GoalQuestion), and the checklist
 * that follows has the steps of those goals, in the order of "How OneUptime
 * works". Everything is the server's - one answer for the project and the
 * person (WelcomeChecklistApi, Common/Types/WelcomeChecklist) - so a second
 * member and another browser see the same progress:
 *
 *   - a step ticks when the thing works, not when a record exists (a monitor
 *     that reported, a status page that shows a monitor);
 *   - a step the plan cannot finish says which plan it needs before the click;
 *   - one step is marked next;
 *   - Hide hides the card for this person only, on every device, and leaves
 *     a line to show it again and to "How OneUptime works";
 *   - once every step is done the card is gone, for everyone.
 *
 * Invited members are not shown the owner's checklist: the server answers
 * with the invited-member audience, and the card draws their own first
 * steps instead (MemberFirstSteps, #6807) - can OneUptime reach me, when am
 * I on call, the mobile app, and a test page to myself - with the same Hide.
 */

export interface ComponentProps {
  projectId: ObjectID;
  // Passed to the card, e.g. to drop its margin inside a spaced layout.
  className?: string | undefined;
}

/*
 * What a step says: its description, or - while the server cannot send
 * email and the description promises one - the truth, with the fix.
 */
export const getGettingStartedTaskDescription: (
  task: Pick<WelcomeStepEntry, "description" | "descriptionWithoutEmail">,
  serverEmail: ServerEmail,
) => string = (
  task: Pick<WelcomeStepEntry, "description" | "descriptionWithoutEmail">,
  serverEmail: ServerEmail,
): string => {
  if (!task.descriptionWithoutEmail || !cannotSendEmail(serverEmail)) {
    return task.description;
  }

  return serverEmail.isMasterAdmin
    ? task.descriptionWithoutEmail.forAdmin
    : task.descriptionWithoutEmail.forOthers;
};

/*
 * Where Home's Welcome card offers the sample project (issue #6808): to
 * someone "Just looking around", right under their goals, and to a
 * project with nothing in it yet, at the foot of the card. Never once a
 * step is done: the project is being set up for real.
 */
export enum SampleProjectOffer {
  None = "none",
  // "Just looking around": offered first, under the goals.
  Goals = "goals",
  // Nothing in the project yet: offered at the foot of the card.
  Home = "home",
}

export const getSampleProjectOffer: (data: {
  goals: ReadonlyArray<ProjectGoal>;
  doneCount: number;
}) => SampleProjectOffer = (data: {
  goals: ReadonlyArray<ProjectGoal>;
  doneCount: number;
}): SampleProjectOffer => {
  if (data.doneCount > 0) {
    return SampleProjectOffer.None;
  }

  return data.goals.includes(ProjectGoal.Explore)
    ? SampleProjectOffer.Goals
    : SampleProjectOffer.Home;
};

export enum WelcomeCardView {
  // Nothing: not read yet, could not be read, finished, or nothing to do.
  None = "none",
  Question = "question",
  Checklist = "checklist",
  // The person hid it: a line to show it again.
  Hidden = "hidden",
  // An invited member: their own first steps (MemberFirstSteps, #6807).
  InvitedMember = "invited_member",
}

// What the card draws for an answer.
export const getWelcomeCardView: (data: {
  answer: WelcomeChecklistAnswer | null;
  isChangingGoals: boolean;
}) => WelcomeCardView = (data: {
  answer: WelcomeChecklistAnswer | null;
  isChangingGoals: boolean;
}): WelcomeCardView => {
  const answer: WelcomeChecklistAnswer | null = data.answer;

  if (!answer) {
    return WelcomeCardView.None;
  }

  if (answer.audience === WelcomeAudience.InvitedMember) {
    return WelcomeCardView.InvitedMember;
  }

  if (answer.isFinished) {
    return WelcomeCardView.None;
  }

  if (
    answer.canChooseGoals &&
    (data.isChangingGoals || answer.shouldAskForGoals)
  ) {
    return WelcomeCardView.Question;
  }

  if (answer.steps.length === 0) {
    return WelcomeCardView.None;
  }

  if (answer.isHiddenForMe) {
    return WelcomeCardView.Hidden;
  }

  return WelcomeCardView.Checklist;
};

/*
 * The step after `step` that is left to do and the plan allows - what the
 * page a step's record lands on names as next (WelcomeNextStep).
 */
export const getStepAfter: (
  steps: ReadonlyArray<WelcomeChecklistStepState>,
  step: WelcomeStep,
) => WelcomeStep | null = (
  steps: ReadonlyArray<WelcomeChecklistStepState>,
  step: WelcomeStep,
): WelcomeStep | null => {
  const index: number = steps.findIndex(
    (state: WelcomeChecklistStepState): boolean => {
      return state.step === step;
    },
  );

  const after: WelcomeChecklistStepState | undefined = steps
    .slice(index + 1)
    .concat(steps.slice(0, Math.max(index, 0)))
    .find((state: WelcomeChecklistStepState): boolean => {
      return !state.isDone && state.needsPlan === null && state.step !== step;
    });

  return after ? after.step : null;
};

// The plan a project is on, as a step held back by its plan names it.
const CURRENT_PLAN_HELD_BACK: PlanType = PlanType.Free;

const GettingStarted: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectIdString: string = props.projectId.toString();

  const [answer, setAnswer] = useState<WelcomeChecklistAnswer | null>(null);
  const [isChangingGoals, setIsChangingGoals] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showHowItWorks, setShowHowItWorks] = useState<boolean>(false);

  /*
   * One read per project: what this browser remembered of the checklist
   * before this one goes to the server first, once, and its answer is the
   * card; otherwise the card is read. Keyed on the id's VALUE, not the
   * ObjectID instance: callers that rebuild the id each render must not
   * read again.
   */
  useEffect(() => {
    let isCurrent: boolean = true;

    setAnswer(null);
    setIsChangingGoals(false);
    setError("");

    const load: () => Promise<void> = async (): Promise<void> => {
      const fromLegacy: WelcomeChecklistAnswer | null =
        await sendLegacyBrowserState(projectIdString);
      const loaded: WelcomeChecklistAnswer | null =
        fromLegacy || (await fetchWelcomeChecklist());

      if (isCurrent) {
        setAnswer(loaded);
      }
    };

    load().catch(() => {
      // Each read answers null on a failure: the card is left out.
    });

    return () => {
      isCurrent = false;
    };
  }, [projectIdString]);

  const goals: Array<ProjectGoal> = answer?.goals || [];
  const goalsEventValue: string = toGoalsEventValue(goals);

  /*
   * The steps this browser saw go from not done to done, and the whole
   * checklist when it finishes (issue #6830), with the project's goals.
   */
  useEffect(() => {
    if (
      !answer ||
      answer.audience !== WelcomeAudience.SetUp ||
      answer.steps.length === 0
    ) {
      return;
    }

    const counted: Array<WelcomeChecklistStepState> = answer.steps.filter(
      (state: WelcomeChecklistStepState): boolean => {
        return (
          state.needsPlan === null && state.step !== WelcomeStep.ServerEmail
        );
      },
    );
    const current: Dictionary<boolean> = {};

    for (const state of counted) {
      current[state.step] = state.isDone;
    }

    ChecklistEvents.noteProgress({
      projectId: projectIdString,
      current: current,
      stepKeys: counted.map((state: WelcomeChecklistStepState): string => {
        return state.step;
      }),
      goals: goalsEventValue,
    });
  }, [answer]);

  const view: WelcomeCardView = getWelcomeCardView({
    answer: answer,
    isChangingGoals: isChangingGoals,
  });

  if (!answer || view === WelcomeCardView.None) {
    return <></>;
  }

  // Sends a change, and draws the card the server answers with.
  const change: (
    route: string,
    data: Dictionary<unknown>,
    onSaved?: (saved: WelcomeChecklistAnswer) => void,
  ) => Promise<boolean> = async (
    route: string,
    data: Dictionary<unknown>,
    onSaved?: (saved: WelcomeChecklistAnswer) => void,
  ): Promise<boolean> => {
    setIsSaving(true);
    setError("");

    const saved: WelcomeChecklistAnswer | null = await postWelcomeChecklist(
      route,
      data as never,
    );

    setIsSaving(false);

    if (!saved) {
      setError(WELCOME_CHECKLIST_COPY.couldNotSave);
      return false;
    }

    setAnswer(saved);
    onSaved?.(saved);
    return true;
  };

  const chooseGoals: (chosen: Array<ProjectGoal>) => void = (
    chosen: Array<ProjectGoal>,
  ): void => {
    const isChange: boolean = answer.goals !== null;

    change(WELCOME_CHECKLIST_GOALS_ROUTE, { goals: chosen }, () => {
      setIsChangingGoals(false);
      ProductEvents.send(ProductEventName.GoalsChosen, {
        goals: toGoalsEventValue(chosen),
        goal_count: chosen.length,
        is_change: isChange,
      });
    }).catch(() => {
      // change() answers false on a failure, and says so.
    });
  };

  const skipOrCancel: () => void = (): void => {
    if (isChangingGoals) {
      setIsChangingGoals(false);
      setError("");
      return;
    }

    chooseGoals([]);
  };

  /*
   * An invited member's own first steps: the same Hide and Show, kept for
   * this person on the server, as the owner's card's.
   */
  if (view === WelcomeCardView.InvitedMember) {
    return (
      <MemberFirstSteps
        answer={answer}
        projectId={props.projectId}
        className={props.className}
        isSaving={isSaving}
        error={error}
        onHide={() => {
          change(WELCOME_CHECKLIST_HIDE_ROUTE, {}).catch(() => {
            // change() says so.
          });
        }}
        onShow={() => {
          change(WELCOME_CHECKLIST_SHOW_ROUTE, {}).catch(() => {
            // change() says so.
          });
        }}
      />
    );
  }

  if (view === WelcomeCardView.Question) {
    return (
      <GoalQuestion
        key={isChangingGoals ? "change" : "first"}
        className={props.className}
        initialGoals={isChangingGoals ? goals : []}
        isChange={isChangingGoals}
        isSaving={isSaving}
        error={error || undefined}
        onSubmit={chooseGoals}
        onSkip={skipOrCancel}
      />
    );
  }

  const howItWorks: ReactElement = (
    <HowOneUptimeWorks projectId={projectIdString} />
  );

  if (view === WelcomeCardView.Hidden) {
    return (
      <div className={props.className} data-testid="welcome-checklist-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
          <span>
            {translator.translateText(WELCOME_CHECKLIST_COPY.hiddenLine)}
          </span>
          <Button
            title={WELCOME_CHECKLIST_COPY.showButton}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            buttonSize={ButtonSize.Small}
            disabled={isSaving}
            onClick={() => {
              change(WELCOME_CHECKLIST_SHOW_ROUTE, {}).catch(() => {
                // change() says so.
              });
            }}
            dataTestId="welcome-checklist-show"
          />
          <Button
            title={WELCOME_CHECKLIST_COPY.howItWorksButton}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            buttonSize={ButtonSize.Small}
            ariaExpanded={showHowItWorks}
            onClick={() => {
              setShowHowItWorks(!showHowItWorks);
            }}
            dataTestId="welcome-checklist-how-it-works"
          />
          {error ? (
            <span role="alert" className="text-red-600">
              {translator.translateText(error)}
            </span>
          ) : (
            <></>
          )}
        </div>
        {showHowItWorks ? <div className="mt-3">{howItWorks}</div> : <></>}
      </div>
    );
  }

  const serverEmail: ServerEmail = {
    canSendEmail: answer.canSendEmail,
    isMasterAdmin: Boolean(UserUtil.isMasterAdmin()),
  };

  const sampleProjectOffer: SampleProjectOffer = getSampleProjectOffer({
    goals: goals,
    doneCount: answer.doneCount,
  });

  const hide: () => void = (): void => {
    ProductEvents.send(ProductEventName.ChecklistDismissed, {
      done_count: answer.doneCount,
      step_count: answer.totalCount,
      goals: goalsEventValue,
    });
    // Sent before the rule, and dashboards are built on it.
    UiAnalytics.capture("dashboard/home/getting-started-dismissed", {
      projectId: projectIdString,
    });

    change(WELCOME_CHECKLIST_HIDE_ROUTE, {}).catch(() => {
      // change() says so.
    });
  };

  const openStep: (state: WelcomeChecklistStepState) => void = (
    state: WelcomeChecklistStepState,
  ): void => {
    const entry: WelcomeStepEntry = getWelcomeStepEntry(state.step);

    ProductEvents.send(ProductEventName.ChecklistStepStarted, {
      step: state.step,
      goals: goalsEventValue,
      ...(state.needsPlan ? { needs_plan: state.needsPlan } : {}),
    });
    // Sent before the rule, and dashboards are built on it.
    UiAnalytics.capture("dashboard/home/getting-started-task", {
      projectId: projectIdString,
      task: state.step,
    });

    if (state.needsPlan) {
      Navigation.navigate(
        RouteUtil.populateRouteParams(RouteMap[WELCOME_PLAN_PAGE] as Route),
      );
      return;
    }

    if (entry.externalUrl) {
      Navigation.navigate(entry.externalUrl(), { openInNewTab: true });
      return;
    }

    const route: Route | null = getWelcomeStepRoute(entry);

    if (!route) {
      return;
    }

    rememberWelcomeStepStarted({
      projectId: projectIdString,
      step: state.step,
      nextStep: getStepAfter(answer.steps, state.step),
    });

    Navigation.navigate(route);
  };

  const describe: (state: WelcomeChecklistStepState) => string = (
    state: WelcomeChecklistStepState,
  ): string => {
    const entry: WelcomeStepEntry = getWelcomeStepEntry(state.step);

    if (state.needsPlan) {
      return translator.translateTemplate(
        WELCOME_CHECKLIST_COPY.needsPlanDescription,
        {
          plan: state.needsPlan,
          currentPlan: CURRENT_PLAN_HELD_BACK,
        },
      );
    }

    return (
      translator.translateText(
        getGettingStartedTaskDescription(entry, serverEmail),
      ) || ""
    );
  };

  const goalsRow: ReactElement = answer.canChooseGoals ? (
    <div
      data-testid="welcome-checklist-goals"
      className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-500"
    >
      {goals.length > 0 ? (
        <>
          <span>
            {translator.translateText(WELCOME_CHECKLIST_COPY.goalsLabel)}
          </span>
          {goals.map((goal: ProjectGoal): ReactElement => {
            return (
              <span
                key={goal}
                data-testid={`welcome-checklist-goal-${goal}`}
                className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700"
              >
                {translator.translateText(getWelcomeGoalEntry(goal).title)}
              </span>
            );
          })}
        </>
      ) : (
        <></>
      )}
      <Button
        title={
          goals.length > 0
            ? WELCOME_CHECKLIST_COPY.changeGoals
            : WELCOME_CHECKLIST_COPY.chooseGoals
        }
        buttonStyle={ButtonStyleType.SECONDARY_LINK}
        buttonSize={ButtonSize.Small}
        onClick={() => {
          setError("");
          setIsChangingGoals(true);
        }}
        dataTestId="welcome-checklist-change-goals"
      />
    </div>
  ) : (
    <></>
  );

  return (
    <Card
      className={props.className}
      title={WELCOME_CHECKLIST_COPY.title}
      description={WELCOME_CHECKLIST_COPY.description}
      rightElement={
        <Button
          title={WELCOME_CHECKLIST_COPY.hideButton}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          disabled={isSaving}
          onClick={hide}
          dataTestId="getting-started-dismiss"
        />
      }
    >
      <div data-testid="getting-started">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="w-full max-w-md">
            <ProgressBar
              count={answer.doneCount}
              totalCount={answer.totalCount}
              suffix={
                translator.translateText(
                  WELCOME_CHECKLIST_COPY.progressSuffix,
                ) || ""
              }
              size={ProgressBarSize.Small}
            />
          </div>
          {goalsRow}
        </div>
        {error ? (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {translator.translateText(error)}
          </p>
        ) : (
          <></>
        )}
        {sampleProjectOffer === SampleProjectOffer.Goals ? (
          <ExploreSampleProject
            className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4"
            from={SampleProjectEntryPoint.Goals}
            isOffered={answer.canExploreSampleProject}
            buttonStyle={ButtonStyleType.PRIMARY}
          />
        ) : (
          <></>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {answer.steps.map((state: WelcomeChecklistStepState) => {
            const entry: WelcomeStepEntry = getWelcomeStepEntry(state.step);
            const isComplete: boolean = state.isDone;

            // Spans, not divs: a button may only hold phrasing content.
            const tileContent: ReactElement = (
              <>
                <span
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                    isComplete
                      ? "bg-emerald-100"
                      : entry.iconBackgroundClassName
                  }`}
                >
                  <Icon
                    icon={isComplete ? IconProp.Check : entry.icon}
                    className={`h-5 w-5 ${
                      isComplete ? "text-emerald-600" : "text-white"
                    }`}
                  />
                </span>
                <span className="block min-w-0 flex-1">
                  <span
                    className={`flex flex-wrap items-center gap-2 text-sm font-medium ${
                      isComplete ? "text-gray-500" : "text-gray-900"
                    }`}
                  >
                    {translator.translateText(entry.title)}
                    {state.isNext ? (
                      <span
                        data-testid="getting-started-next"
                        className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700"
                      >
                        {translator.translateText(
                          WELCOME_CHECKLIST_COPY.nextBadge,
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                  <span className="mt-1 block text-sm text-gray-500">
                    {describe(state)}
                  </span>
                </span>
                {isComplete ? (
                  <span className="mt-0.5 flex-shrink-0 text-xs font-medium text-emerald-600">
                    {translator.translateText(WELCOME_CHECKLIST_COPY.done)}
                  </span>
                ) : state.needsPlan ? (
                  <span
                    data-testid={`getting-started-task-${state.step}-needs-plan`}
                    className="mt-0.5 flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                  >
                    {translator.translateTemplate(
                      WELCOME_CHECKLIST_COPY.needsPlan,
                      {
                        plan: state.needsPlan,
                      },
                    )}
                  </span>
                ) : (
                  /*
                   * Grey at rest, indigo on hover - on two elements: the dark
                   * theme paints any hovered group child that carries a
                   * text-gray-* class near-white, which would outrank the
                   * indigo on one element.
                   */
                  <span className="mt-0.5 flex-shrink-0 text-gray-400">
                    <Icon
                      icon={
                        entry.externalUrl
                          ? IconProp.ExternalLink
                          : IconProp.ChevronRight
                      }
                      className="h-5 w-5 transition group-hover:text-indigo-500"
                    />
                  </span>
                )}
              </>
            );

            // A done step is a record, not a way anywhere.
            if (isComplete) {
              return (
                <div
                  key={state.step}
                  data-testid={`getting-started-task-${state.step}`}
                  data-done="true"
                  className="group flex items-start gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 transition"
                >
                  {tileContent}
                </div>
              );
            }

            /*
             * A step to do is a button: Tab reaches it, and Enter or Space
             * opens it.
             */
            return (
              <button
                key={state.step}
                type="button"
                onClick={() => {
                  openStep(state);
                }}
                data-testid={`getting-started-task-${state.step}`}
                data-done="false"
                data-next={state.isNext ? "true" : "false"}
                className={`group flex w-full items-start gap-4 rounded-lg border bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  state.isNext
                    ? "border-indigo-300 ring-1 ring-indigo-200"
                    : "border-gray-200"
                }`}
              >
                {tileContent}
              </button>
            );
          })}
        </div>
        {/*
         * The checklist says what to do; this says how the pieces connect.
         * Hiding the card keeps it one click away, on the line left behind.
         * Help and Home's Explore OneUptime open it in a dialog
         * (HowOneUptimeWorksDialog) at any time too, however old the project.
         */}
        <div className="mt-6">{howItWorks}</div>
        {sampleProjectOffer === SampleProjectOffer.Home ? (
          <ExploreSampleProject
            className="mt-6 border-t border-gray-100 pt-4"
            from={SampleProjectEntryPoint.Home}
            isOffered={answer.canExploreSampleProject}
            buttonSize={ButtonSize.Small}
          />
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default GettingStarted;
