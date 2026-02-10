export type AuthStackParamList = {
  ServerUrl: undefined;
  Login: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Incidents: undefined;
  Alerts: undefined;
  Settings: undefined;
};

export type IncidentsStackParamList = {
  IncidentsList: undefined;
  IncidentDetail: { incidentId: string };
};

export type AlertsStackParamList = {
  AlertsList: undefined;
  AlertDetail: { alertId: string };
};
