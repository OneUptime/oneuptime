/*
 * HOW LONG A NETWORK FLOW IS KEPT.
 *
 * Every flow a project's devices report is kept this many days after it
 * arrived, whatever the project's telemetry retention says: the table's own
 * TTL (Models/AnalyticsModels/NetworkFlow, on ingestedAt). Here so the
 * record of processing says the same number the table drops flows by
 * (Types/DataSecurity/DeclaredDataStore, #10398).
 */
export const NETWORK_FLOW_RETENTION_IN_DAYS: number = 30;
