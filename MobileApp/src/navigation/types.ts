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
  Monitors: undefined;
  Incidents: undefined;
  Alerts: undefined;
  OnCall: undefined;
  Settings: undefined;
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
};

/**
 * What "Get cover" on a shift card hands to the override sheet: the project
 * and schedule the shift is on, its window as ISO strings (navigation params
 * are serialized, so no Dates), and - for a shift that only exists inside one
 * escalation policy - that policy, so the cover is scoped the same way.
 */
export interface CreateOnCallOverrideParams {
  projectId: string;
  scheduleId: string;
  scheduleName?: string;
  startsAt: string;
  endsAt: string;
  policyId?: string;
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
  MyOnCallPages: undefined;
  OnCallCalendarFeed: undefined;
};

export type IncidentsStackParamList = {
  IncidentsList: undefined;
  IncidentDetail: { incidentId: string; projectId: string };
  IncidentEpisodeDetail: { episodeId: string; projectId: string };
};

export type AlertsStackParamList = {
  AlertsList: undefined;
  AlertDetail: { alertId: string; projectId: string };
  AlertEpisodeDetail: { episodeId: string; projectId: string };
};

export type MonitorsStackParamList = {
  MonitorsList: undefined;
  MonitorDetail: { monitorId: string; projectId: string };
};
