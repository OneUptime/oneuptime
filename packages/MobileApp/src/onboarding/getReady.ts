/*
 * GET READY FOR ON-CALL: THE APP'S FIRST STEPS (#7041), as rules.
 *
 * What makes a page reach this phone, in the order it matters, each one
 * tap away on one screen (screens/GetReadyScreen.tsx):
 *
 *   1. Allow notifications. A page arrives as a notification: without
 *      them nothing reaches the phone at all.
 *   2. Ring through silent mode. An on-call page plays its sound when the
 *      phone is on silent or in Do Not Disturb: Critical Alerts on an
 *      iPhone, Do Not Disturb access on Android - the switch Settings >
 *      Critical On-Call Alerts holds (useCriticalAlerts).
 *   3. Send yourself a test page, see it arrive and acknowledge it: the
 *      step every first hour ends on (#6807), as the Dashboard's member
 *      card ends on it.
 *
 * The app opens the screen by itself once, on a new install's first
 * launch (onboarding/firstRun.ts), and never again: Not Now puts it away,
 * and Settings > Get Ready for On-Call opens it whenever the person wants.
 * Nothing nags.
 *
 * A step this phone cannot do - a simulator, the browser preview - is
 * said so, and not counted. A step turned off in the phone's own settings
 * says where to turn it on, and its button opens them.
 */

export enum GetReadyStep {
  Notifications = "notifications",
  CriticalAlerts = "critical_alerts",
  TestPage = "test_page",
}

export enum GetReadyStepState {
  // Being read.
  Checking = "checking",
  // Done: drawn as a record.
  Done = "done",
  // The person can do it here, now.
  ToDo = "todo",
  // Turned off in the phone's settings: the button opens them.
  OffInPhoneSettings = "off_in_phone_settings",
  // This phone cannot do it: not counted.
  Unavailable = "unavailable",
}

// Where notifications stand for this app, as the OS says.
export enum NotificationPermissionState {
  Checking = "checking",
  Granted = "granted",
  // Asked before and refused: only the phone's settings can turn them on.
  Denied = "denied",
  // Not asked yet: the button asks.
  NotAsked = "not_asked",
  // A simulator or the browser: nothing to allow.
  Unavailable = "unavailable",
}

export type GetReadyPlatform = "ios" | "android" | "other";

export interface GetReadyInput {
  platform: GetReadyPlatform;
  notifications: NotificationPermissionState;
  criticalAlerts: {
    isChecking: boolean;
    isSupported: boolean;
    // On: chosen, and the phone lets it through.
    isEnabled: boolean;
    // Chosen, and the phone's settings turn it off.
    isOffInPhoneSettings: boolean;
  };
  testPage: {
    isAcknowledged: boolean;
  };
}

export interface GetReadyStepView {
  step: GetReadyStep;
  state: GetReadyStepState;
  title: string;
  description: string;
  // The one step to do next.
  isNext: boolean;
}

export interface GetReadySteps {
  steps: Array<GetReadyStepView>;
  // Steps this phone can do.
  totalCount: number;
  doneCount: number;
  // Every step this phone can do is done.
  isFinished: boolean;
}

export const GET_READY_TEXT: {
  screenTitle: string;
  heading: string;
  intro: string;
  notificationsTitle: string;
  notificationsDescription: string;
  allowNotifications: string;
  notificationsOff: string;
  openSettings: string;
  criticalTitleIos: string;
  criticalDescriptionIos: string;
  criticalTitleAndroid: string;
  criticalDescriptionAndroid: string;
  turnOnCriticalAlerts: string;
  criticalNeedsNotifications: string;
  testPageTitle: string;
  testPageDescription: string;
  sendTestPage: string;
  sendAnother: string;
  sending: string;
  waiting: string;
  acknowledgedBefore: string;
  noSeverity: string;
  noProject: string;
  unavailable: string;
  done: string;
  notNow: string;
  readyTitle: string;
  readyMessage: string;
  settingsRowTitle: string;
} = {
  screenTitle: "Get Ready for On-Call",
  heading: "Get ready for on-call",
  intro: "Three steps so a page reaches this phone, even at night on silent.",
  notificationsTitle: "Allow notifications",
  notificationsDescription:
    "Pages arrive as notifications. Without them, nothing reaches this phone.",
  allowNotifications: "Allow Notifications",
  notificationsOff:
    "Notifications are off for OneUptime On-Call in your phone's settings.",
  openSettings: "Open Settings",
  criticalTitleIos: "Allow critical alerts",
  criticalDescriptionIos:
    "On-call pages play their sound even when this iPhone is on silent or in a Focus.",
  criticalTitleAndroid: "Ring through Do Not Disturb",
  criticalDescriptionAndroid:
    "On-call pages play their sound even when Do Not Disturb is on.",
  turnOnCriticalAlerts: "Turn On Critical Alerts",
  criticalNeedsNotifications: "Allow notifications first.",
  testPageTitle: "Send yourself a test page",
  testPageDescription:
    "See a page arrive the way a real one would, and acknowledge it.",
  sendTestPage: "Send Test Page",
  sendAnother: "Send Another",
  sending: "Sending the test page...",
  waiting:
    "Sent. It says TEST, and nothing is wrong: acknowledge it from its notification.",
  acknowledgedBefore: "You acknowledged a test page sent from this app.",
  noSeverity:
    "This project has no incident or alert severities yet, so there is nothing to test.",
  noProject: "Choose a project to send the test page in.",
  unavailable: "Not available on this device.",
  done: "Done",
  notNow: "Not Now",
  readyTitle: "You are ready",
  readyMessage:
    "Pages reach this phone, ring through silent mode, and you know how to acknowledge one.",
  settingsRowTitle: "Get Ready for On-Call",
};

const notificationsState: (
  notifications: NotificationPermissionState,
) => GetReadyStepState = (
  notifications: NotificationPermissionState,
): GetReadyStepState => {
  switch (notifications) {
    case NotificationPermissionState.Granted:
      return GetReadyStepState.Done;
    case NotificationPermissionState.Denied:
      return GetReadyStepState.OffInPhoneSettings;
    case NotificationPermissionState.NotAsked:
      return GetReadyStepState.ToDo;
    case NotificationPermissionState.Unavailable:
      return GetReadyStepState.Unavailable;
    default:
      return GetReadyStepState.Checking;
  }
};

const criticalAlertsState: (input: GetReadyInput) => GetReadyStepState = (
  input: GetReadyInput,
): GetReadyStepState => {
  if (input.criticalAlerts.isChecking) {
    return GetReadyStepState.Checking;
  }

  if (!input.criticalAlerts.isSupported) {
    return GetReadyStepState.Unavailable;
  }

  if (input.criticalAlerts.isEnabled) {
    return GetReadyStepState.Done;
  }

  return input.criticalAlerts.isOffInPhoneSettings
    ? GetReadyStepState.OffInPhoneSettings
    : GetReadyStepState.ToDo;
};

const isCounted: (state: GetReadyStepState) => boolean = (
  state: GetReadyStepState,
): boolean => {
  return state !== GetReadyStepState.Unavailable;
};

export function buildGetReadySteps(input: GetReadyInput): GetReadySteps {
  const isAndroid: boolean = input.platform === "android";

  const steps: Array<GetReadyStepView> = [
    {
      step: GetReadyStep.Notifications,
      state: notificationsState(input.notifications),
      title: GET_READY_TEXT.notificationsTitle,
      description: GET_READY_TEXT.notificationsDescription,
      isNext: false,
    },
    {
      step: GetReadyStep.CriticalAlerts,
      state: criticalAlertsState(input),
      title: isAndroid
        ? GET_READY_TEXT.criticalTitleAndroid
        : GET_READY_TEXT.criticalTitleIos,
      description: isAndroid
        ? GET_READY_TEXT.criticalDescriptionAndroid
        : GET_READY_TEXT.criticalDescriptionIos,
      isNext: false,
    },
    {
      step: GetReadyStep.TestPage,
      state: input.testPage.isAcknowledged
        ? GetReadyStepState.Done
        : GetReadyStepState.ToDo,
      title: GET_READY_TEXT.testPageTitle,
      description: GET_READY_TEXT.testPageDescription,
      isNext: false,
    },
  ];

  /*
   * One step is next: the first that is not done and the person can act
   * on - here, or in the phone's settings. Nothing is next while the step
   * before it is still being read.
   */
  for (const view of steps) {
    if (view.state === GetReadyStepState.Checking) {
      break;
    }

    if (
      view.state === GetReadyStepState.ToDo ||
      view.state === GetReadyStepState.OffInPhoneSettings
    ) {
      view.isNext = true;
      break;
    }
  }

  const counted: Array<GetReadyStepView> = steps.filter(
    (view: GetReadyStepView): boolean => {
      return isCounted(view.state);
    },
  );
  const doneCount: number = counted.filter(
    (view: GetReadyStepView): boolean => {
      return view.state === GetReadyStepState.Done;
    },
  ).length;

  return {
    steps: steps,
    totalCount: counted.length,
    doneCount: doneCount,
    isFinished: counted.length > 0 && doneCount === counted.length,
  };
}
