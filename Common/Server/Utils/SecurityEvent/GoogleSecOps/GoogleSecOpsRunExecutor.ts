import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionRun from "../../../../Models/DatabaseModels/GoogleSecOpsConnectionRun";
import Project from "../../../../Models/DatabaseModels/Project";
import Reseller from "../../../../Models/DatabaseModels/Reseller";
import Includes from "../../../../Types/BaseDatabase/Includes";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  GoogleSecOpsRunOptions,
  GoogleSecOpsRunResult,
} from "../../../../Types/SecurityEvent/GoogleSecOpsDiagnostics";
import Queue, { QueueName } from "../../../Infrastructure/Queue";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../Infrastructure/Semaphore";
import GoogleSecOpsConnectionRunService from "../../../Services/GoogleSecOpsConnectionRunService";
import GoogleSecOpsConnectionService from "../../../Services/GoogleSecOpsConnectionService";
import ProjectService from "../../../Services/ProjectService";
import ResellerService from "../../../Services/ResellerService";
import logger from "../../Logger";
import { redactLogString } from "../../LogRedaction";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import GoogleSecOpsPoller from "./GoogleSecOpsPoller";

export const GOOGLE_SECOPS_RUN_JOB: string =
  "SecurityEvents:RunGoogleSecOpsConnection";
export const GOOGLE_SECOPS_RUN_TIMEOUT_MS: number = 10 * 60 * 1000;
const STALE_RUN_MS: number = 20 * 60 * 1000;
const MAX_RANGE_MS: number = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES: Array<string> = ["queued", "running"];

export interface EnqueueGoogleSecOpsRun {
  projectId: ObjectID;
  connectionId: ObjectID;
  options: GoogleSecOpsRunOptions;
  requestedByUserId?: ObjectID | undefined;
  scheduled?: boolean | undefined;
}

export default class GoogleSecOpsRunExecutor {
  public static validateOptions(value: unknown): GoogleSecOpsRunOptions {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException("A connection operation is required.");
    }
    const body: JSONObject = value as JSONObject;
    const type: unknown = body["type"];
    if (
      type !== "test" &&
      type !== "poll" &&
      type !== "preview" &&
      type !== "backfill"
    ) {
      throw new BadDataException("Choose test, poll, preview, or backfill.");
    }
    if (type === "test" || type === "poll") {
      if (body["startTime"] !== undefined || body["endTime"] !== undefined) {
        throw new BadDataException(
          "Use preview or backfill to select a historical period.",
        );
      }
      return { type };
    }
    const start: unknown = body["startTime"];
    const end: unknown = body["endTime"];
    const timestampPattern: RegExp =
      /^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/;
    const isTimestamp: (value: unknown) => value is string = (
      input: unknown,
    ): input is string => {
      return (
        typeof input === "string" &&
        timestampPattern.test(input) &&
        Number.isFinite(Date.parse(input))
      );
    };
    if (!isTimestamp(start) || !isTimestamp(end)) {
      throw new BadDataException(
        "Valid startTime and endTime timestamps with timezones are required.",
      );
    }
    const duration: number = Date.parse(end) - Date.parse(start);
    if (
      duration <= 0 ||
      duration > MAX_RANGE_MS ||
      Date.parse(end) > Date.now()
    ) {
      throw new BadDataException(
        "Choose a past time range of up to seven days, with start before end.",
      );
    }
    return {
      type,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
    };
  }

  public static async assertTelemetryEnabled(
    projectId: ObjectID,
  ): Promise<void> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { _id: true, resellerId: true },
      props: { isRoot: true },
    });
    if (!project) {
      throw new BadDataException("The connection's project no longer exists.");
    }
    if (project.resellerId) {
      const reseller: Reseller | null = await ResellerService.findOneById({
        id: project.resellerId,
        select: { _id: true, enableTelemetryFeatures: true },
        props: { isRoot: true },
      });
      if (!reseller?.enableTelemetryFeatures) {
        throw new BadDataException(
          "Security events are unavailable for this project's reseller plan.",
        );
      }
    }
  }

  public static async enqueue(data: EnqueueGoogleSecOpsRun): Promise<ObjectID> {
    const options: GoogleSecOpsRunOptions = this.validateOptions(data.options);
    await this.assertTelemetryEnabled(data.projectId);
    const lock: SemaphoreMutex = await Semaphore.lock({
      namespace: "GoogleSecOpsRunAdmission",
      key: data.connectionId.toString(),
      lockTimeout: 30_000,
      acquireTimeout: 5_000,
    });
    try {
      const active: GoogleSecOpsConnectionRun | null =
        await GoogleSecOpsConnectionRunService.findOneBy({
          query: {
            projectId: data.projectId,
            googleSecOpsConnectionId: data.connectionId,
            status: new Includes(ACTIVE_STATUSES),
          },
          select: { _id: true, createdAt: true, updatedAt: true },
          props: { isRoot: true },
        });
      if (active && !(await this.expireStaleRun(active))) {
        throw new BadDataException(
          "This connection already has a queued or running operation. Open run history for its progress.",
        );
      }
      const run: GoogleSecOpsConnectionRun = new GoogleSecOpsConnectionRun();
      run.projectId = data.projectId;
      run.googleSecOpsConnectionId = data.connectionId;
      run.type = options.type;
      run.status = "queued";
      if (data.requestedByUserId) {
        run.requestedByUserId = data.requestedByUserId;
      }
      run.request = { ...options, scheduled: data.scheduled === true };
      const created: GoogleSecOpsConnectionRun =
        await GoogleSecOpsConnectionRunService.create({
          data: run,
          props: { isRoot: true },
        });
      const runId: ObjectID = created.id!;
      try {
        // The payload deliberately contains no connection settings or credentials.
        await Queue.addJob(
          QueueName.Worker,
          runId.toString(),
          GOOGLE_SECOPS_RUN_JOB,
          { runId: runId.toString() },
          { attempts: 3, backoffDelayInMs: 5000 },
        );
      } catch {
        await this.failRun(
          runId,
          "The operation could not be queued. Please try again.",
        );
        throw new BadDataException(
          "The operation could not be queued. Please try again.",
        );
      }
      return runId;
    } finally {
      await this.release(lock);
    }
  }

  public static async executeRun(runId: ObjectID): Promise<void> {
    const lock: SemaphoreMutex = await Semaphore.lock({
      namespace: "GoogleSecOpsRun",
      key: runId.toString(),
      lockTimeout: 30_000,
      acquireTimeout: 1000,
    });
    try {
      const run: GoogleSecOpsConnectionRun | null =
        await GoogleSecOpsConnectionRunService.findOneById({
          id: runId,
          select: {
            _id: true,
            projectId: true,
            googleSecOpsConnectionId: true,
            status: true,
            type: true,
            request: true,
          },
          props: { isRoot: true },
        });
      if (!run || !ACTIVE_STATUSES.includes(run.status || "")) {
        return;
      }
      if (!run.projectId || !run.googleSecOpsConnectionId) {
        await this.failRun(runId, "The connection is no longer available.");
        return;
      }
      let result: GoogleSecOpsRunResult;
      try {
        const options: GoogleSecOpsRunOptions = {
          ...this.validateOptions(run.request),
          runId: runId.toString(),
        };
        await this.assertTelemetryEnabled(run.projectId);
        const connection: GoogleSecOpsConnection | null =
          await GoogleSecOpsConnectionService.findOneBy({
            query: {
              _id: run.googleSecOpsConnectionId.toString(),
              projectId: run.projectId,
            },
            select: {
              _id: true,
              projectId: true,
              name: true,
              region: true,
              instanceResourceName: true,
              serviceAccountJson: true,
              pollIntervalInMinutes: true,
              lastPolledAt: true,
              lastPollResult: true,
              cursor: true,
              isEnabled: true,
              includeNonAlertingDetections: true,
            },
            props: { isRoot: true },
          });
        if (
          !connection ||
          (run.request?.["scheduled"] === true && !connection.isEnabled)
        ) {
          throw new BadDataException(
            "The connection was deleted or scheduled polling was disabled before this operation started.",
          );
        }
        const recordedResult: GoogleSecOpsRunResult | null =
          this.getRecordedPollResult(run, connection);
        if (recordedResult) {
          /*
           * The poll's cursor and diagnostics were committed together. A
           * retry after the run-history write failed must preserve those
           * counts instead of polling the newly advanced cursor again.
           */
          result = recordedResult;
        } else {
          await GoogleSecOpsConnectionRunService.updateOneById({
            id: runId,
            data: { status: "running", startedAt: new Date(), error: "" },
            props: { isRoot: true },
          });
          result = await GoogleSecOpsPoller.executeConnection(
            connection,
            options,
          );
        }
      } catch (error) {
        await this.failRun(
          runId,
          redactLogString(ConnectorErrorMessage.toMessage(error)),
        );
        return;
      }
      /*
       * Leave persistence errors retryable: query-before-insert deduplication
       * makes re-running an interrupted import safe, including after a crash.
       */
      await GoogleSecOpsConnectionRunService.updateOneById({
        id: runId,
        data: {
          status: result.status,
          completedAt: new Date(result.completedAt),
          /*
           * The result is a complete JSON document; expanding the database
           * helper's recursive partial type for JSON exceeds TypeScript's depth.
           */
          result: result as never,
          error: result.error || "",
        },
        props: { isRoot: true },
      });
    } finally {
      await this.release(lock);
    }
  }

  private static getRecordedPollResult(
    run: GoogleSecOpsConnectionRun,
    connection: GoogleSecOpsConnection,
  ): GoogleSecOpsRunResult | null {
    const stored: JSONObject | undefined = connection.lastPollResult;
    if (
      run.status !== "running" ||
      run.type !== "poll" ||
      !stored ||
      stored["runId"] !== run.id?.toString() ||
      stored["type"] !== "poll" ||
      typeof stored["status"] !== "string" ||
      !["success", "empty", "partial", "failed"].includes(stored["status"]) ||
      typeof stored["completedAt"] !== "string" ||
      !Number.isFinite(Date.parse(stored["completedAt"]))
    ) {
      return null;
    }
    /*
     * The worker supplies runId after validating the stored request; callers
     * cannot forge a checkpoint by passing a runId in an API request.
     */
    return stored as unknown as GoogleSecOpsRunResult;
  }

  private static async failRun(runId: ObjectID, error: string): Promise<void> {
    await GoogleSecOpsConnectionRunService.updateOneById({
      id: runId,
      data: { status: "failed", completedAt: new Date(), error },
      props: { isRoot: true },
    });
  }

  public static async expireStaleRun(
    run: GoogleSecOpsConnectionRun,
  ): Promise<boolean> {
    const updatedAt: Date | undefined = run.updatedAt || run.createdAt;
    if (
      !run.id ||
      !updatedAt ||
      updatedAt.getTime() > Date.now() - STALE_RUN_MS
    ) {
      return false;
    }
    let lock: SemaphoreMutex;
    try {
      lock = await Semaphore.lock({
        namespace: "GoogleSecOpsRun",
        key: run.id.toString(),
        lockTimeout: 30_000,
        acquireTimeout: 100,
        acquireAttemptsLimit: 1,
      });
    } catch (error) {
      if (error instanceof SemaphoreLockTimeoutError) {
        return false;
      }
      throw error;
    }
    try {
      // Conditional update cannot overwrite a completed run read before the lock.
      const updated: number =
        await GoogleSecOpsConnectionRunService.updateOneBy({
          query: {
            _id: run.id.toString(),
            status: new Includes(ACTIVE_STATUSES),
            updatedAt: new LessThan(new Date(Date.now() - STALE_RUN_MS)),
          },
          data: {
            status: "failed",
            completedAt: new Date(),
            error:
              "The worker did not finish this operation within twenty minutes. Check worker health and run it again.",
          },
          props: { isRoot: true },
        });
      if (updated > 0) {
        return true;
      }
      const current: GoogleSecOpsConnectionRun | null =
        await GoogleSecOpsConnectionRunService.findOneById({
          id: run.id,
          select: { _id: true, status: true },
          props: { isRoot: true },
        });
      return !current || !ACTIVE_STATUSES.includes(current.status || "");
    } finally {
      await this.release(lock);
    }
  }

  public static async enqueueDueConnections(): Promise<void> {
    const staleRuns: Array<GoogleSecOpsConnectionRun> =
      await GoogleSecOpsConnectionRunService.findBy({
        query: {
          status: new Includes(ACTIVE_STATUSES),
          updatedAt: new LessThan(new Date(Date.now() - STALE_RUN_MS)),
        },
        select: { _id: true, createdAt: true, updatedAt: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    for (const run of staleRuns) {
      try {
        await this.expireStaleRun(run);
      } catch {
        logger.error(
          "Google SecOps: could not recover an interrupted operation.",
        );
      }
    }
    const connections: Array<GoogleSecOpsConnection> =
      await GoogleSecOpsConnectionService.findBy({
        query: { isEnabled: true },
        select: {
          _id: true,
          projectId: true,
          pollIntervalInMinutes: true,
          lastPolledAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    for (const connection of connections) {
      if (
        !connection.id ||
        !connection.projectId ||
        (connection.lastPolledAt &&
          connection.lastPolledAt.getTime() +
            Math.max(1, connection.pollIntervalInMinutes || 5) * 60_000 >
            Date.now())
      ) {
        continue;
      }
      try {
        await this.enqueue({
          projectId: connection.projectId,
          connectionId: connection.id,
          options: { type: "poll" },
          scheduled: true,
        });
      } catch (error) {
        logger.debug(
          `Google SecOps: skipped scheduled operation: ${redactLogString(ConnectorErrorMessage.toMessage(error))}`,
        );
      }
    }
  }

  private static async release(lock: SemaphoreMutex): Promise<void> {
    try {
      await Semaphore.release(lock);
    } catch {
      logger.error(
        "Google SecOps: a run lock could not be released and will expire automatically.",
      );
    }
  }
}
