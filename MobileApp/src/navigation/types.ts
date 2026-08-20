export type AuthStackParamList = {
  ServerUrl: undefined;
  Login: undefined;
  SSOLogin: undefined;
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
  kind: "project" | "global-sso" | "global-oidc";
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
