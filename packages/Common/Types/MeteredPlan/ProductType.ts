enum ProductType {
  Logs = "Logs",
  Traces = "Traces",
  Metrics = "Metrics",
  Profiles = "Profiles",
  SessionReplay = "Session Replay",
  SecurityEvents = "Security Events",
  ActiveMonitoring = "Active Monitoring",
  // Data Observability's watched tables. Nothing is charged until the install names their Stripe price.
  WatchedTables = "Watched Tables",
}

export default ProductType;
