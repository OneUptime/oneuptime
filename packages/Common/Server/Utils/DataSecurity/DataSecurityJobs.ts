import Queue, { QueueName } from "../../Infrastructure/Queue";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE QUEUE JOBS DATA SECURITY'S WORK IS SPLIT INTO.
 *
 * The Workers run them (Jobs/DataSecurity/*): discovering one project's
 * stores, scanning one project's telemetry, evaluating a project's stores
 * again after something that decides their checks changed, scanning one
 * store's content, and reading one cloud connection's configuration. The
 * schedules only queue them, one per project, store or connection, so a
 * large installation is spread over every worker instead of one loop.
 * Each is deduplicated by what it is about, keeping the latest asked for,
 * so a person saving five settings in a row queues one evaluation.
 * Queueing is best effort: the scheduled runs reach everything anyway.
 */

export const DATA_SECURITY_DISCOVER_PROJECT_JOB: string =
  "DataSecurity:DiscoverProject";
// Not the hourly cron's "DataSecurity:ScanTelemetry": a job's function is found by its name.
export const DATA_SECURITY_SCAN_TELEMETRY_JOB: string =
  "DataSecurity:ScanProjectTelemetry";
export const DATA_SECURITY_EVALUATE_PROJECT_JOB: string =
  "DataSecurity:EvaluateProject";
export const DATA_SECURITY_SCAN_STORE_JOB: string = "DataSecurity:ScanStore";
export const DATA_SECURITY_READ_CONNECTION_JOB: string =
  "DataSecurity:ReadConnection";

async function queue(data: {
  jobName: string;
  key: string;
  payload: Record<string, string>;
  description: string;
}): Promise<void> {
  try {
    await Queue.addJob(
      QueueName.Worker,
      `${data.key}-${ObjectID.generate().toString()}`,
      data.jobName,
      data.payload,
      {
        deduplication: {
          id: data.key,
          keepLastIfActive: true,
        },
        removeWhenDone: true,
      },
    );
  } catch (error) {
    logger.error(`DataSecurity: could not queue ${data.description}:`);
    logger.error(error);
  }
}

// Finds a project's stores in inventory, the Database product and the service map.
export async function queueDataSecurityDiscovery(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_DISCOVER_PROJECT_JOB,
    key: `data-security-discover-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `the discovery of project ${projectId.toString()}`,
  });
}

// Samples a project's recent logs, traces and exceptions for sensitive data.
export async function queueDataSecurityTelemetryScan(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_SCAN_TELEMETRY_JOB,
    key: `data-security-telemetry-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `the telemetry scan of project ${projectId.toString()}`,
  });
}

// Evaluates a project's stores again: sensitivity, checks, issues, risk.
export async function queueDataSecurityEvaluation(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
    key: `data-security-evaluate-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `the evaluation of project ${projectId.toString()}`,
  });
}

// Samples one store's content now, instead of at its next scheduled scan.
export async function queueDataStoreScan(data: {
  projectId: ObjectID;
  dataStoreId: ObjectID;
}): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_SCAN_STORE_JOB,
    key: `data-security-scan-${data.dataStoreId.toString()}`,
    payload: {
      projectId: data.projectId.toString(),
      dataStoreId: data.dataStoreId.toString(),
    },
    description: `the scan of store ${data.dataStoreId.toString()}`,
  });
}

// Reads one cloud connection's stores' configuration and access now.
export async function queueDataSecurityConnectionRead(data: {
  projectId: ObjectID;
  cloudConnectionId: ObjectID;
}): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_READ_CONNECTION_JOB,
    key: `data-security-read-${data.cloudConnectionId.toString()}`,
    payload: {
      projectId: data.projectId.toString(),
      cloudConnectionId: data.cloudConnectionId.toString(),
    },
    description: `the read of connection ${data.cloudConnectionId.toString()}`,
  });
}
