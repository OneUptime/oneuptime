import ProductKey from "../../../../Types/Product/ProductKey";

/*
 * THE PRODUCT EACH ASK AI TOOL BELONGS TO (#6815).
 *
 * While a product is switched off on the server, Ask AI does not read or
 * change it: a tool of that product is refused before it runs - and a setup
 * action before its approval card is shown (AIToolbox.checkBeforeApproval) -
 * with a sentence that says the product is off and who can switch it on
 * (Types/Product/ServerProducts.getProductOffMessage). Every product a tool
 * names must be on.
 *
 * Every tool of the toolbox is in one of the two lists below, so a new tool
 * is placed on purpose (Tests/Server/Utils/AI/Toolbox/ToolProducts).
 */
export const TOOL_PRODUCTS: Readonly<
  Record<string, ReadonlyArray<ProductKey>>
> = {
  // Monitors.
  query_monitors: [ProductKey.Monitors],
  // "Who is told when this monitor goes down?" starts at a monitor.
  who_is_told: [ProductKey.Monitors],
  set_up_website_monitoring: [ProductKey.Monitors],

  // Incidents.
  query_incidents: [ProductKey.Incidents],
  search_incidents: [ProductKey.Incidents],
  get_incident_timeline: [ProductKey.Incidents],
  create_incident: [ProductKey.Incidents],
  acknowledge_incident: [ProductKey.Incidents],
  resolve_incident: [ProductKey.Incidents],
  add_incident_affected_resources: [ProductKey.Incidents],
  post_incident_status_update: [ProductKey.Incidents],
  change_incident_severity: [ProductKey.Incidents],
  create_incident_note: [ProductKey.Incidents],

  // Alerts.
  query_alerts: [ProductKey.Alerts],
  get_alert_timeline: [ProductKey.Alerts],
  create_alert: [ProductKey.Alerts],
  acknowledge_alert: [ProductKey.Alerts],
  resolve_alert: [ProductKey.Alerts],
  add_alert_affected_resources: [ProductKey.Alerts],
  create_alert_note: [ProductKey.Alerts],

  // On-Call Duty.
  query_on_call_policies: [ProductKey.OnCall],
  get_on_call_status: [ProductKey.OnCall],
  query_on_call_pages: [ProductKey.OnCall],
  page_on_call_policy: [ProductKey.OnCall],
  set_up_paging: [ProductKey.OnCall],

  // Status Pages: the monitors on one are read, never changed.
  query_status_pages: [ProductKey.StatusPages],
  query_status_page_announcements: [ProductKey.StatusPages],
  publish_status_page: [ProductKey.StatusPages],
  add_monitors_to_status_page: [ProductKey.StatusPages],

  // Scheduled Maintenance.
  query_scheduled_maintenance: [ProductKey.ScheduledMaintenance],

  // SLOs.
  query_slos: [ProductKey.Slos],

  // Telemetry.
  search_logs: [ProductKey.Logs],
  log_histogram: [ProductKey.Logs],
  query_metrics: [ProductKey.Metrics],
  baseline_anomaly: [ProductKey.Metrics],
  query_traces: [ProductKey.Traces],
  get_trace: [ProductKey.Traces],
  get_profile_hotspots: [ProductKey.Profiles],
  compare_profiles: [ProductKey.Profiles],
  get_profile_function: [ProductKey.Profiles],
  top_exceptions: [ProductKey.Exceptions],

  // Data Observability.
  get_data_table_freshness: [ProductKey.DataObservability],
  get_data_table_lineage: [ProductKey.DataObservability],

  // Security Events.
  search_security_events: [ProductKey.SecurityEvents],
  security_event_summary: [ProductKey.SecurityEvents],
  query_security_cases: [ProductKey.SecurityEvents],
  lookup_threat_intel: [ProductKey.SecurityEvents],
  security_entity_activity: [ProductKey.SecurityEvents],
  query_security_playbooks: [ProductKey.SecurityEvents],
  add_security_case_note: [ProductKey.SecurityEvents],
  run_security_playbook: [ProductKey.SecurityEvents],

  // Data Security.
  query_data_stores: [ProductKey.DataSecurity],
  query_data_security_issues: [ProductKey.DataSecurity],
  query_data_store_access: [ProductKey.DataSecurity],

  // Insights.
  query_ai_insights: [ProductKey.AIInsights],

  // Code.
  list_code_repositories: [ProductKey.Code],
  find_code_for_exception: [ProductKey.Code],
  search_code: [ProductKey.Code],
  read_code_file: [ProductKey.Code],
  open_code_pull_request: [ProductKey.Code],
  commit_code_to_branch: [ProductKey.Code],

  // Real User Monitoring.
  query_rum_applications: [ProductKey.Rum],
  query_rum_web_vitals: [ProductKey.Rum],

  // Network.
  query_network_transceivers: [ProductKey.Network],

  // Cloud.
  query_cloud_resource: [ProductKey.Cloud],
  query_cloud_accounts: [ProductKey.Cloud],

  // Workflows.
  query_workflows: [ProductKey.Workflows],
  find_workflow_components: [ProductKey.Workflows],
  check_workflow_draft: [ProductKey.Workflows],
  create_workflow: [ProductKey.Workflows],
  update_workflow: [ProductKey.Workflows],

  // Runbooks.
  query_runbooks: [ProductKey.Runbooks],
  run_runbook: [ProductKey.Runbooks],
};

/*
 * The tools of no one product: they read across products, or OneUptime
 * itself (the docs, the project's teams and probes, its setup health).
 */
export const TOOLS_OF_NO_PRODUCT: ReadonlyArray<string> = [
  "lookup_context",
  "query_telemetry_resources",
  "query_resource_telemetry",
  "query_containers",
  "query_probes",
  "query_teams",
  "get_setup_health",
  "search_docs",
  "read_docs",
  "find_dashboard_page",
  "get_ai_investigation",
  "start_investigation",
  "recent_changes",
  "get_change_details",
];

// The products a tool needs on, by its name (none for a tool of no product).
export const getToolProducts: (
  toolName: string,
) => ReadonlyArray<ProductKey> = (
  toolName: string,
): ReadonlyArray<ProductKey> => {
  return Object.prototype.hasOwnProperty.call(TOOL_PRODUCTS, toolName)
    ? TOOL_PRODUCTS[toolName]!
    : [];
};
