export type AuthStackParamList = {
  ServerUrl: undefined;
  Login: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Incidents: undefined;
  Alerts: undefined;
  IncidentEpisodes: undefined;
  AlertEpisodes: undefined;
  Settings: undefined;
};

export type SettingsStackParamList = {
  SettingsList: undefined;
};

export type IncidentsStackParamList = {
  IncidentsList: undefined;
  IncidentDetail: { incidentId: string };
};

export type AlertsStackParamList = {
  AlertsList: undefined;
  AlertDetail: { alertId: string };
};

export type IncidentEpisodesStackParamList = {
  IncidentEpisodesList: undefined;
  IncidentEpisodeDetail: { episodeId: string };
};

export type AlertEpisodesStackParamList = {
  AlertEpisodesList: undefined;
  AlertEpisodeDetail: { episodeId: string };
};
