import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { CheckOn, FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import { DatabaseMetricGroup } from "../../../../Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupUnavailableReason,
} from "../../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import {
  AZURE_SQL_DATABASE_MONITORING_GRANT,
  AZURE_SQL_DATABASE_MONITORING_REMEDIATION,
  AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT,
  SQL_SERVER_MONITORING_REMEDIATION,
} from "../../../../Types/Monitor/DatabaseMonitor/SqlServerPlatform";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3913
 *
 * A Database Metric criterion whose metric was not collected says why, and
 * appends the grant in parentheses. Azure SQL Database's grant spans lines
 * - two statements for two databases, so each can be copied on its own
 * from the monitor summary - but an observation is one sentence.
 */

const observe: (remediation: string | undefined) => string | null = (
  remediation: string | undefined,
): string | null => {
  const databaseMonitorResponse: DatabaseMonitorResponse = {
    isOnline: true,
    responseTimeInMs: 12,
    failureCause: "",
    metrics: {},
    collectedGroups: [],
    unavailableGroups: [
      {
        group: DatabaseMetricGroup.Connections,
        reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
        message:
          "VIEW SERVER PERFORMANCE STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.",
        remediation,
      },
    ],
    connectionError: null,
  };

  const dataToProcess: ProbeMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: true,
    monitoredAt: new Date(),
    databaseMonitorResponse,
  };

  return MonitorCriteriaObservationBuilder.describeFilterObservation({
    monitor: new Monitor(),
    monitorStep: new MonitorStep(),
    criteriaFilter: {
      checkOn: CheckOn.DatabaseMetric,
      filterType: FilterType.GreaterThan,
      value: 100,
      databaseMonitorOptions: {
        metricType: MonitorMetricType.DatabaseConnectionsTotal,
      },
    },
    dataToProcess,
  });
};

describe("Database Metric observation for a metric a missing grant kept out", () => {
  test("names the reason and appends the SQL Server grant", () => {
    expect(observe(SQL_SERVER_MONITORING_REMEDIATION)).toBe(
      `Connections was not collected on this check: the monitoring login is missing a grant (${SQL_SERVER_MONITORING_REMEDIATION}).`,
    );
  });

  test("folds the multi-line Azure grant into one sentence, keeping both statements", () => {
    const observation: string = observe(
      AZURE_SQL_DATABASE_MONITORING_REMEDIATION,
    ) as string;

    expect(AZURE_SQL_DATABASE_MONITORING_REMEDIATION).toContain("\n");
    expect(observation).not.toMatch(/[\r\n]/);
    expect(observation).toContain(AZURE_SQL_DATABASE_MONITORING_GRANT);
    expect(observation).toContain(AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT);
    expect(observation).toContain(
      `${AZURE_SQL_DATABASE_MONITORING_GRANT} -- Basic, S0, S1, elastic pools`,
    );
  });

  test("says only the reason when there is no grant to give", () => {
    expect(observe(undefined)).toBe(
      "Connections was not collected on this check: the monitoring login is missing a grant.",
    );
  });
});
