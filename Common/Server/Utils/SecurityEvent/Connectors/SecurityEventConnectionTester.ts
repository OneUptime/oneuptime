import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../../Models/DatabaseModels/SecurityEventConnectionRun";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
  SecurityConnectorTestReport,
  summarizeCheckStatuses,
} from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectionRunService from "../../../Services/SecurityEventConnectionRunService";
import logger from "../../Logger";
import { redactLogString } from "../../LogRedaction";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import SecurityEventDedupe from "../SecurityEventDedupe";
import ConnectorPlatformHealth from "./ConnectorPlatformHealth";
import SecurityEventConnectorRegistry from "./SecurityEventConnectorRegistry";
import {
  ConnectorTestResult,
  SecurityConnectorSettings,
  SecurityEventConnector,
  makeCheck,
  toConnectorTestResult,
} from "./Types";

export const CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS: number = 20 * 1000;

/*
 * The synchronous "Test connection" for a Security Event Connection.
 *
 * Runs in whichever process serves the API, deliberately NOT through the
 * Worker queue: the most common reason a connection never ingests is that
 * no worker consumes the queue, and a test that itself needs a worker
 * hangs in exactly that situation. Running here lets the report SAY "no
 * worker is consuming the queue" instead of spinning.
 *
 * Provider checks come from the connector; platform and schedule checks
 * are shared. A saved connection also gets a run-history row so the test
 * shows up next to polls and imports.
 */
export default class SecurityEventConnectionTester {
  public static async test(data: {
    settings: SecurityConnectorSettings;
    connection?: SecurityEventConnection | undefined;
    connectorOverride?: SecurityEventConnector | undefined;
    platformOverride?: ConnectorPlatformStatus | undefined;
    requestTimeoutInMs?: number | undefined;
  }): Promise<SecurityConnectorTestReport> {
    const startedMs: number = Date.now();
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(data.settings.provider);
    const title: string = definition?.title || String(data.settings.provider);
    const checks: Array<SecurityConnectorCheck> = [];

    let connector: SecurityEventConnector | null = null;
    const configurationStartedMs: number = Date.now();

    try {
      connector =
        data.connectorOverride ||
        SecurityEventConnectorRegistry.getConnector(data.settings.provider);
      connector.validateSettings(data.settings);
      checks.push(
        makeCheck({
          key: "configuration",
          name: "Configuration",
          status: "pass",
          startedAtMs: configurationStartedMs,
          message: `The ${title} configuration and credentials are present and well formed.`,
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "configuration",
          name: "Configuration",
          status: "fail",
          startedAtMs: configurationStartedMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
    }

    if (connector && checks[0]?.status === "pass") {
      try {
        const providerResult: ConnectorTestResult = toConnectorTestResult(
          await connector.testConnection(data.settings, {
            requestTimeoutInMs:
              data.requestTimeoutInMs || CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS,
          }),
        );
        checks.push(...providerResult.checks);
      } catch (error) {
        /*
         * Connectors are asked never to throw here, but a bug in one must
         * still produce a readable report rather than a 500.
         */
        checks.push(
          makeCheck({
            key: "provider-error",
            name: `Check access to ${title}`,
            status: "fail",
            startedAtMs: configurationStartedMs,
            message: redactLogString(
              ConnectorErrorMessage.toMessage(error, { truncate: false }),
            ),
          }),
        );
      }
    } else {
      checks.push(
        makeCheck({
          key: "authentication",
          name: `Check access to ${title}`,
          status: "skip",
          startedAtMs: configurationStartedMs,
          message: "Skipped because the configuration check failed.",
        }),
      );
    }

    /*
     * The storage probe runs the same duplicate lookup the poller runs before
     * every insert (clusterAllReplicas over the security event table), so a
     * cluster-name or replica problem that would fail every poll fails the
     * test here, with a name, instead of surfacing as lastError an hour later.
     */
    const platform: ConnectorPlatformStatus =
      data.platformOverride ||
      (await ConnectorPlatformHealth.getPlatformStatus({
        storageProbeOverride: async (): Promise<boolean> => {
          await SecurityEventDedupe.findExistingEventUids({
            projectId:
              data.connection?.projectId ||
              new ObjectID(ObjectID.generate().toString()),
            vendorName: definition?.vendorName || "probe",
            productName: definition?.productName || "probe",
            ids: ["oneuptime-connection-test-probe"],
          });

          return true;
        },
      }));
    checks.push(...ConnectorPlatformHealth.toPlatformChecks(platform));

    if (data.connection?.id) {
      checks.push(await this.scheduleCheck(data.connection));
    }

    const status: SecurityConnectorTestReport["status"] =
      summarizeCheckStatuses(checks);
    const completedMs: number = Date.now();

    const report: SecurityConnectorTestReport = {
      provider: data.settings.provider,
      status,
      startedAt: new Date(startedMs).toISOString(),
      completedAt: new Date(completedMs).toISOString(),
      durationMs: Math.max(0, completedMs - startedMs),
      checks,
      summary: this.summarize(title, status, checks),
      platform,
    };

    if (data.connection?.id && data.connection.projectId) {
      await this.recordRun(data.connection, report);
    }

    return report;
  }

  private static async scheduleCheck(
    connection: SecurityEventConnection,
  ): Promise<SecurityConnectorCheck> {
    let pendingRunCreatedAt: Date | undefined = undefined;

    try {
      const pending: SecurityEventConnectionRun | null =
        await SecurityEventConnectionRunService.findOneBy({
          query: {
            securityEventConnectionId: connection.id!,
            status: new Includes(["queued", "running"]),
          },
          select: { _id: true, createdAt: true },
          sort: { createdAt: SortOrder.Ascending },
          props: { isRoot: true },
        });
      pendingRunCreatedAt = pending?.createdAt;
    } catch (error) {
      logger.error(
        "SecurityEventConnectionTester: could not read pending runs.",
      );
      logger.error(error);
    }

    return ConnectorPlatformHealth.toScheduleCheck({
      isEnabled: connection.isEnabled !== false,
      pollIntervalInMinutes: connection.pollIntervalInMinutes || 5,
      createdAt: connection.createdAt,
      lastPolledAt: connection.lastPolledAt,
      lastSuccessfulPollAt: connection.lastSuccessfulPollAt,
      lastEventIngestedAt: connection.lastEventIngestedAt,
      lastError: connection.lastError,
      pendingRunCreatedAt,
    });
  }

  private static summarize(
    title: string,
    status: SecurityConnectorTestReport["status"],
    checks: Array<SecurityConnectorCheck>,
  ): string {
    const failed: Array<SecurityConnectorCheck> = checks.filter(
      (check: SecurityConnectorCheck): boolean => {
        return check.status === "fail";
      },
    );
    const warned: Array<SecurityConnectorCheck> = checks.filter(
      (check: SecurityConnectorCheck): boolean => {
        return check.status === "warn";
      },
    );

    if (status === "fail") {
      return `${failed.length} check${failed.length === 1 ? "" : "s"} failed: ${failed
        .map((check: SecurityConnectorCheck): string => {
          return check.name;
        })
        .join(", ")}. Follow the remediation under each failed check.`;
    }

    if (status === "warn") {
      return `${title} is reachable and readable. ${warned.length} check${warned.length === 1 ? " needs" : "s need"} attention: ${warned
        .map((check: SecurityConnectorCheck): string => {
          return check.name;
        })
        .join(", ")}.`;
    }

    return `${title} is reachable, credentials are accepted, records can be read, and OneUptime's workers and scheduler are running.`;
  }

  private static async recordRun(
    connection: SecurityEventConnection,
    report: SecurityConnectorTestReport,
  ): Promise<void> {
    try {
      const run: SecurityEventConnectionRun = new SecurityEventConnectionRun();
      run.projectId = connection.projectId as ObjectID;
      run.securityEventConnectionId = connection.id as ObjectID;
      run.type = "test";
      run.status = report.status === "fail" ? "failed" : "success";
      run.startedAt = new Date(report.startedAt);
      run.completedAt = new Date(report.completedAt);
      run.request = { type: "test", synchronous: true };
      run.result = report as never;
      run.error = report.status === "fail" ? report.summary : "";

      await SecurityEventConnectionRunService.create({
        data: run,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `SecurityEventConnectionTester: could not record the test run for ${connection.id?.toString()} at ${OneUptimeDate.getCurrentDate().toISOString()}.`,
      );
      logger.error(error);
    }
  }
}
