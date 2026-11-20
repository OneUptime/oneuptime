import GoalQuestion from "./WelcomeChecklist/GoalQuestion";
import { HOW_IT_WORKS_TITLE } from "./HowOneUptimeWorks";
import {
  HOW_ONEUPTIME_WORKS_DESCRIPTION,
  HowOneUptimeWorksOpenedFrom,
  openHowOneUptimeWorks,
} from "./HowOneUptimeWorksDialog";
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
  WELCOME_MORE_COPY,
  WELCOME_PLAN_PAGE,
  WelcomeStepEntry,
  getPagedByPhoneRoute,
  getWelcomeGoalEntry,
  getWelcomeStepEntry,
  getWelcomeStepRoute,
  mayUseOnCallGuidedSetup,
} from "./WelcomeChecklist/WelcomeChecklistCatalog";
import WelcomeGreeting, {
  getGreetingFirstName,
} from "./WelcomeChecklist/WelcomeGreeting";
import WelcomeMoreSteps from "./WelcomeChecklist/WelcomeMoreSteps";
import WelcomePlanStep from "./WelcomeChecklist/WelcomePlanStep";
import {
  WelcomeStepGapSentence,
  getWelcomeStepGapFix,
  getWelcomeStepGapRoute,
} from "./WelcomeChecklist/WelcomeStepGap";
import { rememberWelcomeStepStarted } from "./WelcomeChecklist/WelcomeStepInProgress";
import AppLink from "../AppLink/AppLink";
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
  ReactNode,
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
 *   - under the steps, one line opens "How OneUptime works" (#8995);
 *   - a step whose record exists but does not work yet says why, and opens
 *     the page that fixes it (#6938);
 *   - once "who is told" is done, while only email can page the person, it
 *     keeps a way to the on-call guided setup: "Get paged by SMS or phone
 *     call" (#9442);
 *   - Hide hides the card for this person only, on every device, and leaves
 *     a line to show it again and to "How OneUptime works";
 *   - "Just looking around" keeps that goal and hides the card the same way;
 *   - once every step is done the checklist is gone, for everyone, and the
 *     card offers what else to set up - the core steps no goal brought,
 *     each until it works (WelcomeMoreSteps, #7986) - until this person
 *     hides it.
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
   * is read (or while a new project's is), then the view - and whether it
   * is a new project's quickstart, which is then the whole of Home
   * (isQuickstartTakingHome), and whether it offers to create the first
   * monitor (offersFirstMonitor). Home draws the rest of the page by them.
   */
  onViewChange?:
    | ((
        view: WelcomeCardView | null,
        isTakingHome: boolean,
        offersFirstMonitor: boolean,
      ) => void)
    | undefined;
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
  /*
   * The checklist is finished, and core steps no goal brought are left, or
   * only email pages the person: what else to set up (#7986, #9442).
   */
  More = "more",
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

/*
 * Whether the quickstart is the whole of Home (#8897): a new project's -
 * the question, and the steps its goals bring once someone chose them (or
 * skipped choosing). The question is only ever asked of a project that is
 * new and not in use yet, so an answer to it is what makes a project's
 * checklist a quickstart. A project that never answered it - in use before
 * it would have been asked, or from before there was one - keeps the whole
 * of Home, with the checklist as a card in it, as it always had: its
 * people come to Home for what is open, and an unfinished checklist (no
 * status page yet, say) must never stand in the way.
 */
export const isQuickstartTakingHome: (data: {
  view: WelcomeCardView | null;
  answer: WelcomeChecklistAnswer | null;
}) => boolean = (data: {
  view: WelcomeCardView | null;
  answer: WelcomeChecklistAnswer | null;
}): boolean => {
  if (data.view === WelcomeCardView.Question) {
    return true;
  }

  return (
    data.view === WelcomeCardView.Checklist &&
    data.answer !== null &&
    data.answer.goals !== null
  );
};

/*
 * What else to set up, as the answer holds it: none from an answer that
 * says nothing of it (one a server from before #7986 sent, or one made by
 * hand), never a page that cannot draw.
 */
export const getMoreSteps: (
  answer: WelcomeChecklistAnswer,
) => ReadonlyArray<WelcomeChecklistStepState> = (
  answer: WelcomeChecklistAnswer,
): ReadonlyArray<WelcomeChecklistStepState> => {
  return Array.isArray(answer.moreSteps) ? answer.moreSteps : [];
};

/*
 * Whether the card offers "Get paged by SMS or phone call" (#9442): the
 * server read that no verified phone number or push device pages this
 * person - it reads it only once "who is told" is done - and they may use
 * the on-call guided setup.
 */
export const isPhoneOffered: (data: {
  answer: WelcomeChecklistAnswer | null;
  mayUseOnCallSetup: boolean;
}) => boolean = (data: {
  answer: WelcomeChecklistAnswer | null;
  mayUseOnCallSetup: boolean;
}): boolean => {
  return Boolean(
    data.answer &&
      data.answer.audience === WelcomeAudience.SetUp &&
      data.answer.canBePagedByPhoneOrApp === false &&
      data.mayUseOnCallSetup,
  );
};

// What the card draws for an answer.
export const getWelcomeCardView: (data: {
  answer: WelcomeChecklistAnswer | null;
  isChangingGoals: boolean;
  // The card offers the person's phone and the app (isPhoneOffered).
  offersPhone?: boolean | undefined;
}) => WelcomeCardView = (data: {
  answer: WelcomeChecklistAnswer | null;
  isChangingGoals: boolean;
  offersPhone?: boolean | undefined;
}): WelcomeCardView => {
  const answer: WelcomeChecklistAnswer | null = data.answer;

  if (!answer) {
    return WelcomeCardView.None;
  }

  if (answer.audience === WelcomeAudience.InvitedMember) {
    return WelcomeCardView.InvitedMember;
  }

  /*
   * Finished: what else to set up, while there is any and this person has
   * not hidden the card (#7986). Hidden, nothing is left behind: the line
   * that shows the checklist again is the checklist's.
   */
  if (answer.isFinished) {
    return !answer.isHiddenForMe &&
      (getMoreSteps(answer).length > 0 || Boolean(data.offersPhone))
      ? WelcomeCardView.More
      : WelcomeCardView.None;
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
 * Whether the card it draws offers to create the first monitor (#7759): the
 * monitor step is left to do, on the checklist or among what else to set
 * up. Home's headline then leaves its own "Create your first monitor" out,
 * so a page offers one start for that job, not two.
 */
export const offersFirstMonitor: (data: {
  view: WelcomeCardView | null;
  answer: WelcomeChecklistAnswer | null;
}) => boolean = (data: {
  view: WelcomeCardView | null;
  answer: WelcomeChecklistAnswer | null;
}): boolean => {
  if (!data.answer) {
    return false;
  }

  const isMonitorLeft: (
    steps: ReadonlyArray<WelcomeChecklistStepState>,
  ) => boolean = (steps: ReadonlyArray<WelcomeChecklistStepState>): boolean => {
    return steps.some((state: WelcomeChecklistStepState): boolean => {
      return (
        state.step === WelcomeStep.Monitor &&
        !state.isDone &&
        state.needsPlan === null
      );
    });
  };

  if (data.view === WelcomeCardView.Checklist) {
    return isMonitorLeft(data.answer.steps);
  }

  if (data.view === WelcomeCardView.More) {
    return isMonitorLeft(getMoreSteps(data.answer));
  }

  return false;
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

// How wide the quickstart is while it is the whole of Home.
export const QUICKSTART_MAX_WIDTH_CLASS_NAME: string = "max-w-7xl";

/*
 * THE CHECKLIST'S LAYOUT (#10276). Under the greeting, from lg up, the
 * steps take the room there is and a column beside them holds how far the
 * person is, about how long is left, and the goals with Change - the
 * guided setups' shape, steps beside a panel, so a wide screen frames the
 * job instead of stretching each step across it. Below lg the same parts
 * stack: how far and the goals, then the steps. How OneUptime works is the
 * last line either way, under both.
 */
export const GETTING_STARTED_TEST_IDS: {
  body: string;
  summary: string;
} = {
  body: "getting-started-body",
  summary: "getting-started-summary",
};

export const GETTING_STARTED_BODY_CLASS_NAME: string =
  "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]";

/*
 * How far and the goals: over the steps on a phone, the column beside them
 * from lg up, as tall as they are.
 */
export const GETTING_STARTED_SUMMARY_CLASS_NAME: string =
  "space-y-5 border-b border-gray-200 bg-gray-50 px-5 py-5 sm:px-8 lg:col-start-2 lg:row-start-1 lg:border-b-0 lg:border-s lg:px-6";

export const GETTING_STARTED_STEPS_CLASS_NAME: string =
  "space-y-1 px-3 py-4 sm:px-5 lg:col-start-1 lg:row-start-1";

export const GETTING_STARTED_LAST_LINE_CLASS_NAME: string =
  "border-t border-gray-200 px-3 py-3 sm:px-5";

/*
 * A goal the project picked, under "Your goals:". Its corners are a
 * card's, not a pill's: in the column beside the steps a long goal takes
 * two lines, and a pill drawn around two lines reads as a mistake.
 */
export const GOAL_CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-700";

export const HOW_ONEUPTIME_WORKS_LINE_TEST_ID: string =
  "getting-started-how-it-works";

/*
 * The line under the steps that opens How OneUptime works: a row as wide as
 * a step's, its icon and words in line with theirs, quieter than they are.
 */
export const HOW_ONEUPTIME_WORKS_LINE_CLASS_NAME: string =
  "group flex w-full items-center gap-4 rounded-xl border border-transparent px-3 py-3 text-start transition hover:border-gray-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const GettingStarted: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectIdString: string = props.projectId.toString();
  const headingId: string = `getting-started-title-${useId()}`;
  const howItWorksId: string = `getting-started-how-it-works-${useId()}`;

  const [answer, setAnswer] = useState<WelcomeChecklistAnswer | null>(null);
  // The answer for this project was read, or could not be.
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [isChangingGoals, setIsChangingGoals] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

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
        return state.needsPlan === null;
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

  /*
   * Read at each draw, not once: the permission snapshot that says whether
   * this person may use the on-call guided setup can arrive after the card.
   */
  const offersPhone: boolean = isPhoneOffered({
    answer: answer,
    mayUseOnCallSetup: mayUseOnCallGuidedSetup(),
  });

  const view: WelcomeCardView = getWelcomeCardView({
    answer: answer,
    isChangingGoals: isChangingGoals,
    offersPhone: offersPhone,
  });

  const isTakingHome: boolean = isQuickstartTakingHome({
    view: view,
    answer: answer,
  });

  const isOfferingFirstMonitor: boolean = offersFirstMonitor({
    view: view,
    answer: answer,
  });

  // Home draws the rest of the page by these.
  useEffect(() => {
    props.onViewChange?.(
      isLoaded ? view : null,
      isLoaded && isTakingHome,
      isLoaded && isOfferingFirstMonitor,
    );
  }, [isLoaded, view, isTakingHome, isOfferingFirstMonitor]);

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

  /*
   * While it is the whole of Home, the quickstart keeps to a width the eye
   * can take in, under the page's title, so Continue and Start sit near
   * what they act on; as a card among others it is as wide as they are.
   */
  const quickstartClassName: string = `${props.className || ""} ${
    isTakingHome ? QUICKSTART_MAX_WIDTH_CLASS_NAME : ""
  }`.trim();

  if (view === WelcomeCardView.Question) {
    return (
      <GoalQuestion
        key={isChangingGoals ? "change" : "first"}
        className={quickstartClassName}
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

  /*
   * How OneUptime works, in the dialog Help, Search and Explore OneUptime
   * open too (HowOneUptimeWorksDialog): the four steps a problem moves
   * through, then every product. The checklist used to draw a shorter strip
   * of its own, so a newcomer met two shapes of one story; now it opens the
   * one (#8995).
   */
  const openHowItWorks: () => void = (): void => {
    openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.WelcomeChecklist);
  };

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
            ariaHaspopup="dialog"
            onClick={openHowItWorks}
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

    /*
     * A step whose record exists but does not work yet opens the page that
     * fixes it (#6938): that is all that is left of it.
     */
    const fixRoute: Route | null = getWelcomeStepGapRoute({
      gap: state.gap,
      translator: translator,
    });

    if (fixRoute) {
      Navigation.navigate(fixRoute);
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

  // Why a step is not done although its record exists, as one line (#6938).
  const gapOf: (state: WelcomeChecklistStepState) => ReactNode = (
    state: WelcomeChecklistStepState,
  ): ReactNode => {
    return state.gap ? <WelcomeStepGapSentence gap={state.gap} /> : null;
  };

  /*
   * The person's phone and the app (#9442): the on-call guided setup,
   * opened from Home.
   */
  const pagedByPhoneLink: ReactElement = (
    <AppLink
      to={getPagedByPhoneRoute()}
      dataTestId="welcome-paged-by-phone"
      className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <span>{translator.translateText(WELCOME_MORE_COPY.phoneTitle)}</span>
      <Icon icon={IconProp.ArrowRight} className="h-4 w-4 flex-none" />
    </AppLink>
  );

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

  /*
   * What else to set up (#7986): a card among Home's others, never the
   * whole of Home. Its Hide is this person's, as the checklist's is.
   */
  if (view === WelcomeCardView.More) {
    return (
      <WelcomeMoreSteps
        moreSteps={getMoreSteps(answer)}
        offersPhone={offersPhone}
        className={props.className}
        isSaving={isSaving}
        error={error}
        describe={describe}
        gapOf={gapOf}
        onOpenStep={openStep}
        onOpenPhone={() => {
          Navigation.navigate(getPagedByPhoneRoute());
        }}
        onHide={() => {
          change(WELCOME_CHECKLIST_HIDE_ROUTE, {}).catch(() => {
            // change() says so.
          });
        }}
      />
    );
  }

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
                className={GOAL_CHIP_CLASS_NAME}
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
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${quickstartClassName}`}
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
      </div>
      {error ? (
        <p role="alert" className="px-5 pt-4 text-sm text-red-600 sm:px-8">
          {translator.translateText(error)}
        </p>
      ) : (
        <></>
      )}
      <div
        data-testid={GETTING_STARTED_TEST_IDS.body}
        className={GETTING_STARTED_BODY_CLASS_NAME}
      >
        <div
          data-testid={GETTING_STARTED_TEST_IDS.summary}
          className={GETTING_STARTED_SUMMARY_CLASS_NAME}
        >
          <div data-testid="getting-started-progress" className="w-full">
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
            {/* A div, not a p: an Icon draws a div around its svg. */}
            {minutesLeft > 0 ? (
              <div
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
              </div>
            ) : (
              <></>
            )}
          </div>
          {goalsRow}
        </div>
        <ol
          data-testid="getting-started-steps"
          className={GETTING_STARTED_STEPS_CLASS_NAME}
        >
          {answer.steps.map(
            (state: WelcomeChecklistStepState, index: number): ReactElement => {
              return (
                <WelcomePlanStep
                  key={state.step}
                  state={state}
                  entry={getWelcomeStepEntry(state.step)}
                  description={describe(state)}
                  gap={gapOf(state)}
                  startTitle={
                    getWelcomeStepGapFix({
                      gap: state.gap,
                      translator: translator,
                    })?.text
                  }
                  /*
                   * Who is told is done, but only email pages the person: a
                   * way to their phone and the app stays (#9442).
                   */
                  doneFooter={
                    state.step === WelcomeStep.OnCall && offersPhone
                      ? pagedByPhoneLink
                      : undefined
                  }
                  isLast={index === answer.steps.length - 1}
                  onOpen={() => {
                    openStep(state);
                  }}
                />
              );
            },
          )}
        </ol>
      </div>
      {/*
       * The checklist says what to do; How OneUptime works says how the
       * pieces connect. One line opens it, named as the dialog is and
       * saying what the dialog says it holds, so the path stays about what
       * to do first. Hiding the card keeps it one click away, on the line
       * left behind.
       */}
      <div className={GETTING_STARTED_LAST_LINE_CLASS_NAME}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-labelledby={`${howItWorksId}-title`}
          aria-describedby={`${howItWorksId}-description`}
          onClick={openHowItWorks}
          data-testid={HOW_ONEUPTIME_WORKS_LINE_TEST_ID}
          className={HOW_ONEUPTIME_WORKS_LINE_CLASS_NAME}
        >
          <span
            aria-hidden="true"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-gray-100"
          >
            <Icon icon={IconProp.Map} className="h-5 w-5 text-gray-500" />
          </span>
          <span className="min-w-0 flex-1">
            <span
              id={`${howItWorksId}-title`}
              className="block text-sm font-semibold text-gray-900"
            >
              {translator.translateText(HOW_IT_WORKS_TITLE)}
            </span>
            <span
              id={`${howItWorksId}-description`}
              className="mt-0.5 block text-sm text-gray-600"
            >
              {translator.translateText(HOW_ONEUPTIME_WORKS_DESCRIPTION)}
            </span>
          </span>
          {/*
           * Grey at rest, indigo on hover - on two elements, as a step's
           * chevron is (WelcomePlanStep).
           */}
          <span className="flex-none text-gray-400">
            <Icon
              icon={IconProp.ChevronRight}
              className="h-5 w-5 transition group-hover:text-indigo-500"
            />
          </span>
        </button>
      </div>
    </section>
  );
};

export default GettingStarted;
