enum ExternalStatusPageProviderType {
  AtlassianStatuspage = "Atlassian Statuspage",
  IncidentIo = "incident.io",
  /*
   * A status page made with OneUptime, read through its public summary
   * (/status-page-api/summary/<page>): each resource's status as the page
   * shows it, and whether a scheduled maintenance event in progress affects
   * it (Types/StatusPage/StatusPageSummary).
   */
  OneUptime = "OneUptime Status Page",
  RSS = "RSS",
  Atom = "Atom",
  Auto = "Auto",
}

export default ExternalStatusPageProviderType;
