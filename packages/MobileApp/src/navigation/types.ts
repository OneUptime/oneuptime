import type { NavigatorScreenParams } from "@react-navigation/native";
import type { PushPageActionRequest } from "../oncall/pushPageAction";
import type { OnCallOverrideItem } from "../api/types";

/*
 * A page's push opens its record with the action tapped under it -
 * Acknowledge or Escalate (oncall/pushPageAction.ts) - which the record's
 * screen does once, then takes out of its params.
 */
export interface PushPageActionParams {
  pushAction?: PushPageActionRequest | undefined;
}

export type AuthStackParamList = {
  ServerUrl: undefined;
  Login: undefined;
  SSOLogin: undefined;

  /*
   * The web sign-in has had "Forgot password?" since the beginning; the app
   * had no route at all. The reset itself is finished in a browser from the
   * emailed link, so there is nothing to carry here.
   */
  ForgotPassword: undefined;

  /*
   * The two factor challenge and the mandated setup. Neither takes params:
   * everything they need -- including the password each verify route
   * re-submits, because there is no session until one of them succeeds --
   * lives on the auth context. Navigation params are serialized into
   * navigation state that tooling reads and persists, which is not somewhere
   * a plaintext password belongs.
   */
  TwoFactor: undefined;
  TwoFactorEnrolment: undefined;

  /*
   * `mode` says which half of the screen to open on: a set of codes to save,
   * or the offer to create one. The CODES are not a param, for the same
   * reason the password is not.
   */
  BackupCodes: { mode: "show" | "offer" };
};

export type MainTabParamList = {
  Home: undefined;
  Monitors: NavigatorScreenParams<MonitorsStackParamList> | undefined;
  Inbox: NavigatorScreenParams<InboxStackParamList> | undefined;
  OnCall: NavigatorScreenParams<OnCallStackParamList> | undefined;
  Settings: NavigatorScreenParams<SettingsStackParamList> | undefined;
};

/*
 * A provider offered on the re-authentication sheet. `kind` decides which
 * server route starts the login and which token comes back, so it has to
 * survive the trip through navigation params - a global provider routed as a
 * project one produces a 400 from the server.
 */
export interface SelectableSsoProvider {
  _id: string;
  name: string;
  description?: string;
  kind: "project" | "project-oidc" | "global-sso" | "global-oidc";
}

export type SettingsStackParamList = {
  SettingsList: undefined;
  ProjectsList: undefined;
  SSOProviderSelect: {
    projectId: string;
    projectName: string;
    providers: Array<SelectableSsoProvider>;
  };

  /*
   * The same screen the on-call tab opens from its "More" list. Registered on
   * both stacks so the Settings row is a plain push rather than a cross-tab
   * jump that lands the user somewhere they did not tap.
   */
  OnCallCalendarFeed: undefined;

  // The alarm critical pages play on this phone, and on an iPhone how loud.
  CriticalAlertSound: undefined;

  /*
   * The app's first steps (#7041): allow notifications, ring through
   * silent mode, send yourself a test page. The same screen the on-call
   * stack opens on a new install's first launch, pushed here from its row.
   */
  GetReady: undefined;
};

/**
 * What "Get cover" on a shift card hands to the override sheet: the project
 * and schedule the shift is on, its window as ISO strings (navigation params
 * are serialized, so no Dates), and - for a shift that only exists inside one
 * escalation policy - that policy, so the cover is scoped the same way.
 * `policies` are the policies that page through the shift: for someone
 * whose permission covers only some policies, the sheet offers those of
 * them they may cover, one override on each.
 */
export interface CreateOnCallOverrideParams {
  projectId: string;
  scheduleId: string;
  scheduleName?: string;
  startsAt: string;
  endsAt: string;
  policyId?: string;
  policies?: Array<{ policyId: string; policyName: string }>;
}

/*
 * The override the edit sheet opens on (#7897), as it was read: who is
 * away, who covers, its policy and its times.
 */
export interface EditOnCallOverrideParams {
  override: OnCallOverrideItem;
}

/*
 * The on-call stack starts on an OVERVIEW, not on the policy list. The list
 * answers "which escalation rules name me", which is a configuration question;
 * the overview answers "am I on call and until when", which is why anybody
 * opens this tab. `OnCallList` is still here - it is one row down.
 */
export type OnCallStackParamList = {
  OnCallOverview: undefined;
  OnCallList: undefined;
  WhoIsOnCall: undefined;
  OnCallOverrides: undefined;

  /*
   * Undefined when opened from "Cover for me" (start now, pick a duration);
   * prefilled when opened from a shift's "Get cover" (that shift's window).
   */
  CreateOnCallOverride: CreateOnCallOverrideParams | undefined;

  /*
   * Editing one override (#7897): the override as the list, or the refusal
   * that offered it, read it - plain strings, so it travels as params.
   */
  EditOnCallOverride: EditOnCallOverrideParams;
  MyOnCallPages: undefined;
  OnCallCalendarFeed: undefined;

  /*
   * A test page (oncall/testPage.ts), opened from its push: the message's
   * own row of the person's on-call timeline, its project - and, when the
   * push was answered with "Acknowledge test page", an id of that tap, so
   * the screen acknowledges it once.
   */
  TestPage: {
    messageId: string;
    projectId: string;
    acknowledgeRequestId?: string | undefined;
  };

  /*
   * The app's first steps (#7041), opened by itself on a new install's
   * first launch (GetReadyFirstRun): a sheet over the on-call overview, so
   * a test page's push opens its own sheet over it, and closing both comes
   * back to the steps.
   */
  GetReady: undefined;
};

export type IncidentsStackParamList = {
  IncidentsList:
    | {
        initialSegment?: "incidents" | "episodes";
        initialFilter?: "all" | "active" | "resolved";
      }
    | undefined;
  IncidentDetail: {
    incidentId: string;
    projectId: string;
  } & PushPageActionParams;
  IncidentEpisodeDetail: {
    episodeId: string;
    projectId: string;
  } & PushPageActionParams;
};

export type AlertsStackParamList = {
  AlertsList:
    | {
        initialSegment?: "alerts" | "episodes";
        initialFilter?: "all" | "active" | "resolved";
      }
    | undefined;
  AlertDetail: { alertId: string; projectId: string } & PushPageActionParams;
  AlertEpisodeDetail: {
    episodeId: string;
    projectId: string;
  } & PushPageActionParams;
};

/*
 * The Inbox's three categories. Security - the project's security cases - is
 * shown only to the people who can read them, in a project that has had one
 * (hooks/useSecurityCases).
 */
export type InboxView = "incidents" | "alerts" | "security";

/** One response workspace, with incident, alert and case details sharing a Back path. */
export type InboxStackParamList = {
  InboxList:
    | {
        initialView?: InboxView;
        initialSegment?: "incidents" | "alerts" | "episodes";
        initialFilter?: "all" | "active" | "resolved";
        // The security case list's filter a Home shortcut opens it on.
        initialCaseFilter?: "open" | "mine" | "unassigned";
      }
    | undefined;
  /*
   * One security case: where a security-case push lands, and what the
   * Security list, a link in an incident or alert, and Home open.
   */
  SecurityCaseDetail: { caseId: string; projectId: string };
} & Pick<IncidentsStackParamList, "IncidentDetail" | "IncidentEpisodeDetail"> &
  Pick<AlertsStackParamList, "AlertDetail" | "AlertEpisodeDetail">;

export type MonitorsStackParamList = {
  MonitorsList:
    | { initialFilter?: "all" | "issues" | "operational" | "disabled" }
    | undefined;
  MonitorDetail: { monitorId: string; projectId: string };
};
