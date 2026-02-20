export type AuthStackParamList = {
  ServerUrl: undefined;
  Login: undefined;
  SSOLogin: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Incidents: undefined;
  Alerts: undefined;
  OnCall: undefined;
  Settings: undefined;
};

export type SettingsStackParamList = {
  SettingsList: undefined;
  ProjectsList: undefined;
  SSOProviderSelect: {
    projectId: string;
    projectName: string;
    providers: Array<{ _id: string; name: string; description?: string }>;
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
