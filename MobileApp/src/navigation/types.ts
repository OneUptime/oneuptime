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
};

export type OnCallStackParamList = {
  OnCallList: undefined;
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
