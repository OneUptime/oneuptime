import {
  SetupChecklist,
  SetupHeadlineStatus,
} from "../../UserSettings/SetupChecklist/ChecklistModel";
import { READINESS_METHOD_TYPE_PUSH } from "../../OnCallPolicy/Readiness/ReadinessTypes";
import { UpcomingShiftSpan } from "../../OnCallPolicy/CalendarFeed/UpcomingShiftSpans";
import {
  formatShiftDateTime,
  formatShiftEnd,
  formatShiftTime,
  getShiftDayLabel,
} from "../../OnCallPolicy/CalendarFeed/UpcomingShiftTime";
import PageMap from "../../../Utils/PageMap";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { FeedClock } from "Common/UI/Components/Feed/FeedTime";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * AN INVITED MEMBER'S FIRST STEPS ON HOME (issue #6807), as rules.
 *
 * Most people in a project did not create it. They were invited, and their
 * first questions are not the owner's checklist: can OneUptime reach me,
 * when am I on call, and what happens when it pages me. Home answers them
 * in one card (MemberFirstSteps), in the Welcome card's place
 * (GettingStarted's WelcomeCardView.InvitedMember):
 *
 *   - "When you are on call": on call now, or the next shift, from the
 *     person's own shifts (/on-call-calendar/my-shifts, the list User
 *     Settings > On-Call Calendar draws) - or on a policy with no shift,
 *     or not on call at all. Information, not a task.
 *   - "Make sure OneUptime can reach you": the personal setup checklist's
 *     headline and how many of its essential steps are left, one click to
 *     it. Done when nothing essential is left - and not while only email
 *     reaches somebody who is on call (#1809), or while the server cannot
 *     send the only kind of message that reaches them.
 *   - "Get the mobile app": done once a push device is registered.
 *   - "Send yourself a test page": the step every flow ends on - see a page
 *     arrive and acknowledge it (#6811). Done when this person acknowledged
 *     a test page in the project, as the server noted it.
 *
 * The card is done, and gone, when the person can be reached and a test
 * page has reached them: an outcome, not a record. Hide hides it for this
 * person, as the owner's card does.
 *
 * Pure and React-free: the card and its tests share it. Every claim is made
 * on what was read, never on a read that failed: an unknown checklist asks
 * the person to open it, and unknown shifts draw no on-call row.
 */

export enum MemberStep {
  OnCall = "on_call",
  Reach = "reach",
  MobileApp = "mobile_app",
  TestPage = "test_page",
}

// The method kinds the rules below name, as readiness lists them.
export const EMAIL_METHOD_TYPE: string = "Email";
export const PUSH_METHOD_TYPE: string = READINESS_METHOD_TYPE_PUSH;

// Within this long, a shift's day is named ("Tuesday"); later, its date.
export const NAMED_DAY_WINDOW_IN_MS: number = 6 * 24 * 60 * 60 * 1000;

export const MEMBER_FIRST_STEPS_COPY: {
  title: string;
  description: string;
  hiddenLine: string;
  onCallNow: string;
  onCallUntil: string;
  onCallUntilAtLeast: string;
  nextShiftDay: string;
  nextShiftDate: string;
  onPolicy: string;
  onPolicyDescription: string;
  notOnCall: string;
  notOnCallDescription: string;
  reachTitle: string;
  reachUnknown: string;
  stepsLeft: PluralTemplate;
  emailCannotReachTitle: string;
  emailCannotReachDescription: string;
  onlyEmailTitle: string;
  onlyEmailDescription: string;
  reachedTitle: string;
  reachedWithoutEmail: string;
  mobileAppTitle: string;
  mobileAppDescription: string;
  mobileAppInstall: string;
  testPageTitle: string;
  testPageDescription: string;
} = {
  title: translationKey("Your first steps here"),
  description: translationKey(
    "Make sure OneUptime can reach you, and know when you are on call.",
  ),
  hiddenLine: translationKey("You hid your first steps."),
  onCallNow: translationKey("You are on call now"),
  onCallUntil: translationKey("{{schedule}}, until {{time}}"),
  onCallUntilAtLeast: translationKey("{{schedule}}, until at least {{time}}"),
  nextShiftDay: translationKey("Your next shift: {{day}}, {{time}}"),
  nextShiftDate: translationKey("Your next shift: {{dateTime}}"),
  onPolicy: translationKey("You are on an on-call policy"),
  onPolicyDescription: translationKey(
    "You have no shifts in the next 30 days. Pages that go to you or your team can reach you at any time.",
  ),
  notOnCall: translationKey("You are not on call"),
  notOnCallDescription: translationKey(
    "Nobody has added you to an on-call schedule or policy in this project yet.",
  ),
  reachTitle: translationKey("Make sure OneUptime can reach you"),
  reachUnknown: translationKey(
    "Open your setup checklist to see what is left.",
  ),
  stepsLeft: {
    one: translationKey("{{count}} step left in your setup checklist"),
    other: translationKey("{{count}} steps left in your setup checklist"),
  },
  emailCannotReachTitle: translationKey("Email cannot reach you here"),
  emailCannotReachDescription: translationKey(
    "This server cannot send email yet, and email is the only way you can be reached. Add a phone number or the mobile app.",
  ),
  onlyEmailTitle: translationKey("Add a faster way to reach you"),
  onlyEmailDescription: translationKey(
    "You are on call, and only email can reach you. Email is easy to miss at night: add a phone number or the mobile app.",
  ),
  reachedTitle: translationKey("OneUptime can reach you"),
  reachedWithoutEmail: translationKey(
    "This server cannot send email yet, so only your other methods can reach you.",
  ),
  mobileAppTitle: translationKey("Get the mobile app"),
  mobileAppDescription: translationKey(
    "Pages arrive as push notifications, and critical alerts ring even on Do Not Disturb.",
  ),
  mobileAppInstall: translationKey(
    "Scan a code with your phone to install the app, sign in to {{serverUrl}}, and allow notifications and critical alerts when it asks.",
  ),
  testPageTitle: translationKey("Send yourself a test page"),
  testPageDescription: translationKey(
    "See a page arrive the way a real one would, and acknowledge it.",
  ),
};

/*
 * Where the person stands on "can OneUptime reach me".
 *
 *   Loading           the checklist is on its way.
 *   Unknown           it could not be read: no claim, only the way to it.
 *   EmailCannotReach  the server cannot send email, and email is all the
 *                     person has verified - nothing can reach them.
 *   OpenSteps         the checklist has essential steps left, or says the
 *                     person cannot be fully reached.
 *   OnlyEmail         nothing is left, but the person is on call and only
 *                     email reaches them (#1809).
 *   Ready             nothing is left: done.
 */
export enum ReachState {
  Loading = "loading",
  Unknown = "unknown",
  EmailCannotReach = "email_cannot_reach",
  OpenSteps = "open_steps",
  OnlyEmail = "only_email",
  Ready = "ready",
}

export const getOpenStepCount: (checklist: SetupChecklist) => number = (
  checklist: SetupChecklist,
): number => {
  return Math.max(checklist.totalCount - checklist.completedCount, 0);
};

// Whether email is the only kind of method the person has verified.
export const isOnlyEmail: (verifiedMethodTypes: Array<string>) => boolean = (
  verifiedMethodTypes: Array<string>,
): boolean => {
  return (
    verifiedMethodTypes.length > 0 &&
    verifiedMethodTypes.every((methodType: string): boolean => {
      return methodType === EMAIL_METHOD_TYPE;
    })
  );
};

export const getReachState: (data: {
  checklist: SetupChecklist | null;
  isChecklistLoading: boolean;
  // False only on a server known not to send email.
  canSendEmail: boolean;
  // The person has a shift now or in the next 30 days.
  hasShifts: boolean;
}) => ReachState = (data: {
  checklist: SetupChecklist | null;
  isChecklistLoading: boolean;
  canSendEmail: boolean;
  hasShifts: boolean;
}): ReachState => {
  const checklist: SetupChecklist | null = data.checklist;

  if (!checklist) {
    return data.isChecklistLoading ? ReachState.Loading : ReachState.Unknown;
  }

  const onlyEmail: boolean = isOnlyEmail(checklist.verifiedMethodTypes);

  if (!data.canSendEmail && onlyEmail) {
    return ReachState.EmailCannotReach;
  }

  if (
    getOpenStepCount(checklist) > 0 ||
    checklist.headlineStatus === SetupHeadlineStatus.NotReachable ||
    checklist.headlineStatus === SetupHeadlineStatus.NeedsSetup
  ) {
    return ReachState.OpenSteps;
  }

  if (onlyEmail && (checklist.isOnCallResponder || data.hasShifts)) {
    return ReachState.OnlyEmail;
  }

  return ReachState.Ready;
};

/*
 * Where the person stands on "when am I on call".
 *
 *   Loading     the shifts are on their way.
 *   Unknown     they could not be read, and nothing else says the person
 *               is on call: no row.
 *   OnCallNow   a shift has started and not ended.
 *   NextShift   the first shift that has not started.
 *   OnPolicy    no shift in the window, but a policy reaches the person -
 *               directly, through a team, or through a schedule whose
 *               shifts are further out.
 *   NotOnCall   no shift, and no policy reaches the person.
 */
export enum OnCallState {
  Loading = "loading",
  Unknown = "unknown",
  OnCallNow = "on_call_now",
  NextShift = "next_shift",
  OnPolicy = "on_policy",
  NotOnCall = "not_on_call",
}

export interface OnCallAnswer {
  state: OnCallState;
  span: UpcomingShiftSpan | null;
}

export const getOnCallAnswer: (data: {
  // Null until read, and when the read failed.
  spans: Array<UpcomingShiftSpan> | null;
  isShiftsLoading: boolean;
  // Null while the checklist is unknown.
  isOnCallResponder: boolean | null;
}) => OnCallAnswer = (data: {
  spans: Array<UpcomingShiftSpan> | null;
  isShiftsLoading: boolean;
  isOnCallResponder: boolean | null;
}): OnCallAnswer => {
  if (data.spans) {
    const now: UpcomingShiftSpan | undefined = data.spans.find(
      (span: UpcomingShiftSpan): boolean => {
        return span.isOnCallNow;
      },
    );

    if (now) {
      return { state: OnCallState.OnCallNow, span: now };
    }

    if (data.spans.length > 0) {
      return { state: OnCallState.NextShift, span: data.spans[0] || null };
    }
  } else if (data.isShiftsLoading) {
    return { state: OnCallState.Loading, span: null };
  }

  if (data.isOnCallResponder === true) {
    return { state: OnCallState.OnPolicy, span: null };
  }

  /*
   * "Not on call" is a claim: only when the shifts were read and found
   * none, and the checklist says no policy reaches the person.
   */
  if (data.spans && data.isOnCallResponder === false) {
    return { state: OnCallState.NotOnCall, span: null };
  }

  return { state: OnCallState.Unknown, span: null };
};

// One tile of the card, in English keys: the card translates them.
export interface MemberStepTile {
  step: MemberStep;
  title: string;
  titleValues?: Dictionary<string> | undefined;
  description: string;
  descriptionValues?: Dictionary<string> | undefined;
  // A count line under the description: "2 steps left in your setup checklist".
  countLine?: { template: PluralTemplate; count: number } | undefined;
  icon: IconProp;
  iconBackgroundClassName: string;
  // Done: drawn as a record, not a way anywhere.
  isDone: boolean;
  // The one step to do next.
  isNext: boolean;
  // Drawn as grey placeholder lines while its read is on its way.
  isLoading: boolean;
  // Where a click goes; undefined when the card handles it, or it is a record.
  pageMap?: PageMap | undefined;
  // A tile that is information, not a task: never done, never next.
  isInformation: boolean;
}

export interface MemberFirstStepsInput {
  checklist: SetupChecklist | null;
  isChecklistLoading: boolean;
  spans: Array<UpcomingShiftSpan> | null;
  isShiftsLoading: boolean;
  canSendEmail: boolean;
  // The server noted a test page this person acknowledged, or one was seen here.
  hasAcknowledgedTestPage: boolean;
  clock: FeedClock;
}

export interface MemberFirstSteps {
  tiles: Array<MemberStepTile>;
  reachState: ReachState;
  onCall: OnCallAnswer;
  // Essential steps left: reaching the person, and a test page reaching them.
  openCount: number;
  // Both are done: the card has nothing left to ask.
  isFinished: boolean;
  // Not enough is read yet to say whether it is finished.
  isSettling: boolean;
}

const getOnCallTile: (
  answer: OnCallAnswer,
  clock: FeedClock,
) => MemberStepTile | null = (
  answer: OnCallAnswer,
  clock: FeedClock,
): MemberStepTile | null => {
  const base: Omit<MemberStepTile, "title" | "description"> = {
    step: MemberStep.OnCall,
    icon: IconProp.Calendar,
    iconBackgroundClassName: "bg-sky-500",
    isDone: false,
    isNext: false,
    isLoading: false,
    pageMap: PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED,
    isInformation: true,
  };

  const span: UpcomingShiftSpan | null = answer.span;

  switch (answer.state) {
    case OnCallState.Loading:
      return {
        ...base,
        title: MEMBER_FIRST_STEPS_COPY.onCallNow,
        description: "",
        isLoading: true,
        pageMap: undefined,
      };
    case OnCallState.OnCallNow:
      return {
        ...base,
        iconBackgroundClassName: "bg-emerald-500",
        title: MEMBER_FIRST_STEPS_COPY.onCallNow,
        description: span?.mayContinue
          ? MEMBER_FIRST_STEPS_COPY.onCallUntilAtLeast
          : MEMBER_FIRST_STEPS_COPY.onCallUntil,
        descriptionValues: span
          ? {
              schedule: span.scheduleName,
              time: formatShiftEnd({
                start: clock.now,
                end: span.end,
                clock: clock,
              }),
            }
          : undefined,
      };
    case OnCallState.NextShift: {
      if (!span) {
        return null;
      }

      const isWithinNamedDays: boolean =
        span.start.getTime() - clock.now.getTime() < NAMED_DAY_WINDOW_IN_MS;

      return {
        ...base,
        title: isWithinNamedDays
          ? MEMBER_FIRST_STEPS_COPY.nextShiftDay
          : MEMBER_FIRST_STEPS_COPY.nextShiftDate,
        titleValues: isWithinNamedDays
          ? {
              day: getShiftDayLabel(span.start, clock),
              time: formatShiftTime(span.start, clock),
            }
          : { dateTime: formatShiftDateTime(span.start, clock) },
        description: span.mayContinue
          ? MEMBER_FIRST_STEPS_COPY.onCallUntilAtLeast
          : MEMBER_FIRST_STEPS_COPY.onCallUntil,
        descriptionValues: {
          schedule: span.scheduleName,
          time: formatShiftEnd({
            start: span.start,
            end: span.end,
            clock: clock,
          }),
        },
      };
    }
    case OnCallState.OnPolicy:
      return {
        ...base,
        title: MEMBER_FIRST_STEPS_COPY.onPolicy,
        description: MEMBER_FIRST_STEPS_COPY.onPolicyDescription,
      };
    case OnCallState.NotOnCall:
      return {
        ...base,
        icon: IconProp.Calendar,
        iconBackgroundClassName: "bg-gray-400",
        title: MEMBER_FIRST_STEPS_COPY.notOnCall,
        description: MEMBER_FIRST_STEPS_COPY.notOnCallDescription,
        // Nothing to see there yet: a record, not a way anywhere.
        pageMap: undefined,
      };
    default:
      return null;
  }
};

const getReachTile: (data: {
  state: ReachState;
  checklist: SetupChecklist | null;
  canSendEmail: boolean;
}) => MemberStepTile = (data: {
  state: ReachState;
  checklist: SetupChecklist | null;
  canSendEmail: boolean;
}): MemberStepTile => {
  const base: Omit<MemberStepTile, "title" | "description"> = {
    step: MemberStep.Reach,
    icon: IconProp.Bell,
    iconBackgroundClassName: "bg-indigo-500",
    isDone: false,
    isNext: false,
    isLoading: false,
    pageMap: PageMap.USER_SETTINGS_SETUP,
    isInformation: false,
  };

  switch (data.state) {
    case ReachState.Loading:
      return {
        ...base,
        title: MEMBER_FIRST_STEPS_COPY.reachTitle,
        description: "",
        isLoading: true,
      };
    case ReachState.Unknown:
      return {
        ...base,
        title: MEMBER_FIRST_STEPS_COPY.reachTitle,
        description: MEMBER_FIRST_STEPS_COPY.reachUnknown,
      };
    case ReachState.EmailCannotReach:
      return {
        ...base,
        iconBackgroundClassName: "bg-red-500",
        title: MEMBER_FIRST_STEPS_COPY.emailCannotReachTitle,
        description: MEMBER_FIRST_STEPS_COPY.emailCannotReachDescription,
        pageMap: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      };
    case ReachState.OnlyEmail:
      return {
        ...base,
        iconBackgroundClassName: "bg-amber-500",
        title: MEMBER_FIRST_STEPS_COPY.onlyEmailTitle,
        description: MEMBER_FIRST_STEPS_COPY.onlyEmailDescription,
        pageMap: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      };
    case ReachState.Ready: {
      const hasEmail: boolean = Boolean(
        data.checklist?.verifiedMethodTypes.includes(EMAIL_METHOD_TYPE),
      );

      return {
        ...base,
        title: MEMBER_FIRST_STEPS_COPY.reachedTitle,
        description:
          !data.canSendEmail && hasEmail
            ? MEMBER_FIRST_STEPS_COPY.reachedWithoutEmail
            : data.checklist?.headline || "",
        isDone: true,
      };
    }
    default: {
      const openCount: number = data.checklist
        ? getOpenStepCount(data.checklist)
        : 0;

      return {
        ...base,
        title: MEMBER_FIRST_STEPS_COPY.reachTitle,
        description: data.checklist?.headline || "",
        countLine:
          openCount > 0
            ? { template: MEMBER_FIRST_STEPS_COPY.stepsLeft, count: openCount }
            : undefined,
      };
    }
  }
};

export const buildMemberFirstSteps: (
  input: MemberFirstStepsInput,
) => MemberFirstSteps = (input: MemberFirstStepsInput): MemberFirstSteps => {
  const hasShifts: boolean = Boolean(input.spans && input.spans.length > 0);

  const reachState: ReachState = getReachState({
    checklist: input.checklist,
    isChecklistLoading: input.isChecklistLoading,
    canSendEmail: input.canSendEmail,
    hasShifts: hasShifts,
  });

  const onCall: OnCallAnswer = getOnCallAnswer({
    spans: input.spans,
    isShiftsLoading: input.isShiftsLoading,
    isOnCallResponder: input.checklist
      ? input.checklist.isOnCallResponder
      : null,
  });

  const reachTile: MemberStepTile = getReachTile({
    state: reachState,
    checklist: input.checklist,
    canSendEmail: input.canSendEmail,
  });

  const hasPush: boolean = Boolean(
    input.checklist?.verifiedMethodTypes.includes(PUSH_METHOD_TYPE),
  );

  const mobileAppTile: MemberStepTile = {
    step: MemberStep.MobileApp,
    title: MEMBER_FIRST_STEPS_COPY.mobileAppTitle,
    description: MEMBER_FIRST_STEPS_COPY.mobileAppDescription,
    icon: IconProp.DevicePhoneMobile,
    iconBackgroundClassName: "bg-violet-500",
    isDone: hasPush,
    isNext: false,
    isLoading: false,
    isInformation: false,
  };

  const testPageTile: MemberStepTile = {
    step: MemberStep.TestPage,
    title: MEMBER_FIRST_STEPS_COPY.testPageTitle,
    description: MEMBER_FIRST_STEPS_COPY.testPageDescription,
    icon: IconProp.Beaker,
    iconBackgroundClassName: "bg-emerald-500",
    isDone: input.hasAcknowledgedTestPage,
    isNext: false,
    isLoading: false,
    isInformation: false,
  };

  /*
   * One step is next: reaching the person while it is not done, then the
   * test page. The mobile app is an offer, never the one thing to do.
   */
  if (!reachTile.isDone && !reachTile.isLoading) {
    reachTile.isNext = true;
  } else if (reachTile.isDone && !testPageTile.isDone) {
    testPageTile.isNext = true;
  }

  const tiles: Array<MemberStepTile> = [];
  const onCallTile: MemberStepTile | null = getOnCallTile(onCall, input.clock);

  if (onCallTile) {
    tiles.push(onCallTile);
  }

  tiles.push(reachTile, mobileAppTile, testPageTile);

  const openCount: number =
    (reachTile.isDone ? 0 : 1) + (testPageTile.isDone ? 0 : 1);

  return {
    tiles: tiles,
    reachState: reachState,
    onCall: onCall,
    openCount: openCount,
    isFinished: reachTile.isDone && testPageTile.isDone,
    isSettling: reachState === ReachState.Loading,
  };
};
