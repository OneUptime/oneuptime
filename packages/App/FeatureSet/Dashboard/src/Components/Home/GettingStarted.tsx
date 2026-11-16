import GoalQuestion from "./WelcomeChecklist/GoalQuestion";
import HowOneUptimeWorks from "./HowOneUptimeWorks";
import MemberFirstSteps from "./MemberFirstSteps/MemberFirstSteps";
import {
  fetchWelcomeChecklist,
  postWelcomeChecklist,
  sendLegacyBrowserState,
} from "./WelcomeChecklist/WelcomeChecklistApi";
import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_JUST_LOOKING_GOAL,
  WELCOME_MINUTES_COPY,
  WELCOME_PLAN_PAGE,
  WelcomeStepEntry,
  getWelcomeGoalEntry,
  getWelcomeStepEntry,
  getWelcomeStepRoute,
} from "./WelcomeChecklist/WelcomeChecklistCatalog";
import WelcomeGreeting, {
  getGreetingFirstName,
} from "./WelcomeChecklist/WelcomeGreeting";
import WelcomePlanStep from "./WelcomeChecklist/WelcomePlanStep";
import { rememberWelcomeStepStarted } from "./WelcomeChecklist/WelcomeStepInProgress";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { ServerEmail, cannotSendEmail } from "../../Utils/ServerEmail";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import Route from "Common/Types/API/Route";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ProjectGoal, {
  toGoalsEventValue,
} from "Common/Types/WelcomeChecklist/ProjectGoal";
import {
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
  getWelcomeMinutesLeft,
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
  useId,
  useState,
} from "react";

/*
 * THE QUICKSTART ON HOME (issue #6803, redrawn for #8897).
 *
 * It starts from what the person came to do: a new project's owner is asked
 * once, "What do you want to do first?" (GoalQuestion), and the checklist
 * that follows has the steps of those goals, in the order of "How OneUptime
 * works". While either is shown, it is the whole of Home (Pages/Home/Home):
 * this card says which view it draws (onViewChange), and Home draws nothing
 * else but what cannot wait.
 *
 * Everything is the server's - one answer for the project and the person
 * (WelcomeChecklistApi, Common/Types/WelcomeChecklist) - so a second member
 * and another browser see the same progress:
 *
 *   - a step ticks when the thing works, not when a record exists (a monitor
 *     that reported, a status page that shows a monitor);
 *   - each step says about how long it takes, and the card how long is left;
 *   - a step the plan cannot finish says which plan it needs before the click;
 *   - one step is marked next, with its own Start;
 *   - Hide hides the card for this person only, on every device, and leaves
 *     a line to show it again and to "How OneUptime works";
 *   - "Just looking around" keeps that goal and hides the card the same way;
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
  /*
   * Which view the card draws, each time it changes: null until the answer
   * is read (or while a new project's is), then the view. Home draws the
   * rest of the page by it.
   */
  onViewChange?: ((view: WelcomeCardView | null) => void) | undefined;
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

/*
 * The views that are the quickstart: while one of them is drawn, it is the
 * whole of Home (#8897).
 */
export const QUICKSTART_VIEWS: ReadonlyArray<WelcomeCardView> = [
  WelcomeCardView.Question,
  WelcomeCardView.Checklist,
];

export const isQuickstartView: (view: WelcomeCardView | null) => boolean = (
  view: WelcomeCardView | null,
): boolean => {
  return view !== null && QUICKSTART_VIEWS.includes(view);
};

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
  const headingId: string = `getting-started-title-${useId()}`;

  const [answer, setAnswer] = useState<WelcomeChecklistAnswer | null>(null);
  // The answer for this project was read, or could not be.
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
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
    setIsLoaded(false);
    setIsChangingGoals(false);
    setError("");

    const load: () => Promise<void> = async (): Promise<void> => {
      const fromLegacy: WelcomeChecklistAnswer | null =
        await sendLegacyBrowserState(projectIdString);
      const loaded: WelcomeChecklistAnswer | null =
        fromLegacy || (await fetchWelcomeChecklist());

      if (isCurrent) {
        setAnswer(loaded);
        setIsLoaded(true);
      }
    };

    load().catch(() => {
      // Each read answers null on a failure: the card is left out.
      if (isCurrent) {
        setIsLoaded(true);
      }
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

  // Home draws the rest of the page by this.
  useEffect(() => {
    props.onViewChange?.(isLoaded ? view : null);
  }, [isLoaded, view]);

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

  const cancelChange: () => void = (): void => {
    setIsChangingGoals(false);
    setError("");
  };

  /*
   * "Just looking around": the project's goal is Explore, and the card is
   * hidden for this person, so they land on the rest of Home at once. The
   * card in between is never drawn: both answers come first. Should the
   * hide not save, the checklist Explore brings shows, with its Hide.
   */
  const justLookAround: () => Promise<void> = async (): Promise<void> => {
    const chosen: Array<ProjectGoal> = [WELCOME_JUST_LOOKING_GOAL];

    setIsSaving(true);
    setError("");

    const saved: WelcomeChecklistAnswer | null = await postWelcomeChecklist(
      WELCOME_CHECKLIST_GOALS_ROUTE,
      { goals: chosen } as never,
    );

    if (!saved) {
      setIsSaving(false);
      setError(WELCOME_CHECKLIST_COPY.couldNotSave);
      return;
    }

    ProductEvents.send(ProductEventName.GoalsChosen, {
      goals: toGoalsEventValue(chosen),
      goal_count: chosen.length,
      is_change: false,
    });

    const hidden: WelcomeChecklistAnswer | null = await postWelcomeChecklist(
      WELCOME_CHECKLIST_HIDE_ROUTE,
      {},
    );

    setIsSaving(false);
    setAnswer(hidden || saved);
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

  const firstName: string = getGreetingFirstName();

  if (view === WelcomeCardView.Question) {
    return (
      <GoalQuestion
        key={isChangingGoals ? "change" : "first"}
        className={props.className}
        initialGoals={isChangingGoals ? goals : []}
        isChange={isChangingGoals}
        isSaving={isSaving}
        error={error || undefined}
        firstName={firstName}
        onSubmit={chooseGoals}
        onCancel={cancelChange}
        onJustLooking={() => {
          justLookAround().catch(() => {
            // justLookAround() says so.
          });
        }}
      />
    );
  }

  const howItWorks: ReactElement = (
    <HowOneUptimeWorks projectId={projectIdString} />
  );

  if (view === WelcomeCardView.Hidden) {
    return (
      <div className={props.className} data-testid="welcome-checklist-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Icon
              icon={IconProp.RocketLaunch}
              className="h-4 w-4 flex-none text-indigo-500"
            />
            <span>
              {translator.translateText(WELCOME_CHECKLIST_COPY.hiddenLine)}
            </span>
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
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-700"
              >
                <Icon
                  icon={getWelcomeGoalEntry(goal).icon}
                  className="h-3.5 w-3.5 flex-none text-indigo-500"
                />
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

  const minutesLeft: number = getWelcomeMinutesLeft(answer.steps);

  return (
    <section
      data-testid="getting-started"
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${
        props.className || ""
      }`}
    >
      <div className="bg-gradient-to-br from-indigo-50 via-white to-white px-5 pb-6 pt-6 sm:px-8 sm:pt-8">
        <WelcomeGreeting
          firstName={firstName}
          headingId={headingId}
          dataTestId="getting-started-greeting"
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
        />
        <p className="mt-2 max-w-2xl text-sm text-gray-600">
          {translator.translateText(WELCOME_CHECKLIST_COPY.description)}
        </p>
        <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 lg:flex-1">{goalsRow}</div>
          <div
            data-testid="getting-started-progress"
            className="w-full flex-none lg:w-80"
          >
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
            {minutesLeft > 0 ? (
              <p
                data-testid="getting-started-minutes-left"
                className="mt-2 flex items-center gap-1.5 text-xs text-gray-500"
              >
                <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 flex-none" />
                <span>
                  {translator.translatePlural(
                    WELCOME_MINUTES_COPY.left,
                    minutesLeft,
                  )}
                </span>
              </p>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="px-5 pt-4 text-sm text-red-600 sm:px-8">
          {translator.translateText(error)}
        </p>
      ) : (
        <></>
      )}
      <ol
        data-testid="getting-started-steps"
        className="space-y-1 px-3 py-4 sm:px-5"
      >
        {answer.steps.map(
          (state: WelcomeChecklistStepState, index: number): ReactElement => {
            return (
              <WelcomePlanStep
                key={state.step}
                state={state}
                entry={getWelcomeStepEntry(state.step)}
                description={describe(state)}
                isLast={index === answer.steps.length - 1}
                onOpen={() => {
                  openStep(state);
                }}
              />
            );
          },
        )}
      </ol>
      {/*
       * The checklist says what to do; this says how the pieces connect.
       * Hiding the card keeps it one click away, on the line left behind.
       * Help and Home's Explore OneUptime open it in a dialog
       * (HowOneUptimeWorksDialog) at any time too, however old the project.
       */}
      <div className="border-t border-gray-200 px-5 py-6 sm:px-8">
        {howItWorks}
      </div>
    </section>
  );
};

export default GettingStarted;
