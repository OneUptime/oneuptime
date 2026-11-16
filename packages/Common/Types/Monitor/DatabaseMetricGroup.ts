/*
 * A Database Health monitor's collection groups, in a module that imports
 * nothing. A step's configuration names its groups with them
 * (MonitorStepDatabaseMonitor), and every frontend loads it before its first
 * page draws (MonitorStep, through SerializableObjectDictionary, which
 * reading JSON loads). Read from DatabaseMetricCatalog, they brought along
 * the whole catalog - every metric with its name and description, built as
 * the module loads - which no sign-in page or status page draws
 * (packages/Common/Scripts/first-load-budgets.js). DatabaseMetricCatalog
 * exports them as before.
 */

/*
 * Collection groups map one-to-one onto the queries the probe runs. They are
 * the unit of graceful degradation: if the login lacks the grant a group
 * needs, that group alone is skipped and reported, and every other group is
 * still collected.
 */
export enum DatabaseMetricGroup {
  Connections = "Connections",
  Activity = "Activity",
  Throughput = "Throughput",
  Locks = "Locks",
  Storage = "Storage",
  Replication = "Replication",
  Maintenance = "Maintenance",
}
