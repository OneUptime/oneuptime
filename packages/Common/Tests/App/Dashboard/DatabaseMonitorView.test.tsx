import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult, within } from "@testing-library/react";
import * as React from "react";
import DatabaseMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DatabaseMonitorView";
import {
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getDatabaseMetricByMetricType,
} from "../../../Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import {
  AZURE_SQL_DATABASE_MONITORING_GRANT,
  AZURE_SQL_DATABASE_MONITORING_REMEDIATION,
  AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT,
  SQL_SERVER_MONITORING_REMEDIATION,
} from "../../../Types/Monitor/DatabaseMonitor/SqlServerPlatform";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ValueFormatter from "../../../Utils/ValueFormatter";

/*
 * https://github.com/OneUptime/oneuptime/issues/3913
 *
 * The Monitor Test Result for a SQL Server login with read access only. The
 * reporter's panel listed five groups, each reading "The user does not have
 * permission to perform this action." and nothing else - because the probe
 * classified the failure as a generic Error, and the view only shows a GRANT
 * for a missing permission.
 *
 * These render the payload the fixed probe produces for that same login
 * (built from the live SQL Server runs) and pin what the operator sees: the
 * permission that was refused, the one GRANT that fixes all of it, the size
 * that WAS collected, and a way to the setup guide.
 */

const SERVER_STATE_MESSAGE: string =
  "VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.";

/*
 * Azure SQL Database refuses its DMVs with the same Msg 300 then 297 as
 * SQL Server, naming VIEW SERVER PERFORMANCE STATE (as users report it).
 */
const AZURE_SERVER_STATE_MESSAGE: string =
  "VIEW SERVER PERFORMANCE STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.";

const DMV_GROUPS: Array<DatabaseMetricGroup> = [
  DatabaseMetricGroup.Connections,
  DatabaseMetricGroup.Activity,
  DatabaseMetricGroup.Throughput,
  DatabaseMetricGroup.Locks,
  DatabaseMetricGroup.Storage,
];

const DATABASE_SIZE_BYTES: number = 16777216;

const missingGrant: (
  group: DatabaseMetricGroup,
  message: string,
  remediation: string,
) => DatabaseMetricGroupStatus = (
  group: DatabaseMetricGroup,
  message: string,
  remediation: string,
): DatabaseMetricGroupStatus => {
  return {
    group,
    reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
    message,
    remediation,
  };
};

const buildProbeResponse: (
  databaseMonitorResponse: DatabaseMonitorResponse,
) => ProbeMonitorResponse = (
  databaseMonitorResponse: DatabaseMonitorResponse,
): ProbeMonitorResponse => {
  return {
    projectId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    isOnline: true,
    failureCause: "",
    monitoredAt: new Date("2026-09-18T13:26:00.000Z"),
    databaseMonitorResponse,
  } as ProbeMonitorResponse;
};

const readOnlySqlServer: DatabaseMonitorResponse = {
  isOnline: true,
  responseTimeInMs: 42,
  failureCause: "",
  metrics: {
    [MonitorMetricType.DatabaseSizeBytes]: DATABASE_SIZE_BYTES,
    [MonitorMetricType.DatabaseMetricGroupsFailed]: 6,
  },
  collectedGroups: [DatabaseMetricGroup.Storage],
  unavailableGroups: [
    ...DMV_GROUPS.map((group: DatabaseMetricGroup) => {
      return missingGrant(
        group,
        SERVER_STATE_MESSAGE,
        SQL_SERVER_MONITORING_REMEDIATION,
      );
    }),
    missingGrant(
      DatabaseMetricGroup.Replication,
      "VIEW DATABASE STATE permission denied in database '***'. The user does not have permission to perform this action.",
      SQL_SERVER_MONITORING_REMEDIATION,
    ),
  ],
  engineVersion: "15.0.4490.9",
  enginePlatform: "SQL Server",
  connectionError: null,
};

const readOnlyAzureSqlDatabase: DatabaseMonitorResponse = {
  isOnline: true,
  responseTimeInMs: 1678,
  failureCause: "",
  metrics: {
    [MonitorMetricType.DatabaseSizeBytes]: DATABASE_SIZE_BYTES,
    [MonitorMetricType.DatabaseMetricGroupsFailed]: 5,
  },
  collectedGroups: [DatabaseMetricGroup.Storage],
  unavailableGroups: DMV_GROUPS.map((group: DatabaseMetricGroup) => {
    return missingGrant(
      group,
      AZURE_SERVER_STATE_MESSAGE,
      AZURE_SQL_DATABASE_MONITORING_REMEDIATION,
    );
  }),
  engineVersion: "12.0.2000.8",
  enginePlatform: "Azure SQL Database",
  connectionError: null,
};

const renderView: (response: DatabaseMonitorResponse) => RenderResult = (
  response: DatabaseMonitorResponse,
): RenderResult => {
  return render(
    <DatabaseMonitorView
      probeMonitorResponse={buildProbeResponse(response)}
      probeName="Probe 1"
    />,
  );
};

// The copyable statements: each remediation statement is its own <code>.
const remediationBlocks: (view: RenderResult) => Array<HTMLElement> = (
  view: RenderResult,
): Array<HTMLElement> => {
  return Array.from(
    view.container.querySelectorAll("code"),
  ) as Array<HTMLElement>;
};

const collectionPanel: (view: RenderResult) => HTMLElement = (
  view: RenderResult,
): HTMLElement => {
  return view.getByText("Some metrics were not collected")
    .parentElement as HTMLElement;
};

const metricValueCell: (view: RenderResult, friendlyName: string) => string = (
  view: RenderResult,
  friendlyName: string,
): string => {
  const row: HTMLElement | null = view.getByText(friendlyName).closest("tr");
  expect(row).not.toBeNull();
  const cells: NodeListOf<HTMLTableCellElement> = (
    row as HTMLElement
  ).querySelectorAll("td");
  return cells[1]?.textContent || "";
};

afterEach(() => {
  cleanup();
});

describe("DatabaseMonitorView - a SQL Server login with read access only (issue #3913)", () => {
  test("shows the GRANT that fixes it, once, for all six groups", () => {
    const view: RenderResult = renderView(readOnlySqlServer);

    const blocks: Array<HTMLElement> = remediationBlocks(view);

    // One grant fixes every group, so it is shown once rather than six times.
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveTextContent(SQL_SERVER_MONITORING_REMEDIATION);

    for (const group of [...DMV_GROUPS, DatabaseMetricGroup.Replication]) {
      expect(
        within(collectionPanel(view)).getByText(group),
      ).toBeInTheDocument();
    }
  });

  test("names the refused permission, not only 'The user does not have permission'", () => {
    const view: RenderResult = renderView(readOnlySqlServer);

    expect(view.getAllByText(SERVER_STATE_MESSAGE)).toHaveLength(
      DMV_GROUPS.length,
    );
  });

  test("lists nothing under 'Not available on this engine' - a grant can fix all of it", () => {
    const view: RenderResult = renderView(readOnlySqlServer);

    expect(view.queryByText("Not available on this engine")).toBeNull();
  });

  test("shows the database size that was collected, and the log space that was not", () => {
    const view: RenderResult = renderView(readOnlySqlServer);

    const sizeDefinition: DatabaseMetricDefinition =
      getDatabaseMetricByMetricType(
        MonitorMetricType.DatabaseSizeBytes,
      ) as DatabaseMetricDefinition;
    const logDefinition: DatabaseMetricDefinition =
      getDatabaseMetricByMetricType(
        MonitorMetricType.DatabaseLogSpaceUsedPercent,
      ) as DatabaseMetricDefinition;

    expect(metricValueCell(view, sizeDefinition.friendlyName)).toBe(
      ValueFormatter.formatValue(DATABASE_SIZE_BYTES, sizeDefinition.unit),
    );
    expect(metricValueCell(view, logDefinition.friendlyName)).toBe(
      "Not collected",
    );

    // Storage is collected AND unavailable.
    const collectedCard: HTMLElement | null = view
      .getByText("Metric Groups Collected")
      .closest(".rounded-xl");
    expect(collectedCard).toHaveTextContent(
      /Metric Groups Collected\s*Storage$/,
    );
    expect(view.getByText("6 groups unavailable")).toBeInTheDocument();
  });

  test("links to the setup guide's grants section", () => {
    const view: RenderResult = renderView(readOnlySqlServer);

    const link: HTMLElement = view.getByText(
      "Which grants each metric group needs, for every platform",
    );
    const anchor: HTMLAnchorElement | null = link.closest("a");

    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toContain(
      "/monitor/database-health-monitor#create-a-monitoring-user",
    );
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });

  test("names the platform beside the version in the Engine card", () => {
    const view: RenderResult = renderView(readOnlySqlServer);

    expect(view.getByText("SQL Server 15.0.4490.9")).toBeInTheDocument();
  });

  test("shows a bare version from a probe that reports no platform, as before", () => {
    const view: RenderResult = renderView({
      ...readOnlySqlServer,
      enginePlatform: undefined,
      engineVersion: "16.0.4295.3",
    });

    expect(view.getByText("16.0.4295.3")).toBeInTheDocument();
  });
});

describe("DatabaseMonitorView - Azure SQL Database", () => {
  test("shows each Azure statement as its own copyable block, under where it runs", () => {
    const view: RenderResult = renderView(readOnlyAzureSqlDatabase);

    const blocks: Array<HTMLElement> = remediationBlocks(view);

    /*
     * Two statements for two databases. They used to be one line with the
     * fallback trailing in a `--` comment, so copying it ran only the first.
     */
    expect(
      blocks.map((block: HTMLElement) => {
        return block.textContent;
      }),
    ).toEqual([
      AZURE_SQL_DATABASE_MONITORING_GRANT,
      AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT,
    ]);

    // The comment lines are labels, not code.
    const panel: HTMLElement = collectionPanel(view);
    for (const label of [
      "In the monitored database:",
      "Basic, S0, S1, elastic pools, or if that is not enough: in master, for the login:",
    ]) {
      expect(within(panel).getByText(label).tagName).not.toBe("CODE");
    }
  });

  test("never offers VIEW SERVER STATE as the fix, which does not exist there", () => {
    const view: RenderResult = renderView(readOnlyAzureSqlDatabase);

    /*
     * The refused-permission message may name a server-level permission -
     * that is what Azure reports - but no statement offered may grant one.
     */
    for (const block of remediationBlocks(view)) {
      expect(block.textContent).not.toContain("VIEW SERVER STATE");
    }
  });

  test("names the platform in the Engine card", () => {
    const view: RenderResult = renderView(readOnlyAzureSqlDatabase);

    expect(
      view.getByText("Azure SQL Database 12.0.2000.8"),
    ).toBeInTheDocument();
  });

  test("does not report Replication at all - it is not collected on Azure SQL Database", () => {
    const view: RenderResult = renderView(readOnlyAzureSqlDatabase);

    expect(view.queryByText("Not available on this engine")).toBeNull();
    expect(view.getByText("5 groups unavailable")).toBeInTheDocument();
  });
});

describe("DatabaseMonitorView - failures a grant cannot fix", () => {
  test("does not offer the grants guide when nothing is a missing grant", () => {
    const view: RenderResult = renderView({
      ...readOnlySqlServer,
      metrics: { [MonitorMetricType.DatabaseMetricGroupsFailed]: 2 },
      collectedGroups: [],
      unavailableGroups: [
        {
          group: DatabaseMetricGroup.Replication,
          reason: DatabaseMetricGroupUnavailableReason.NotSupportedByEngine,
          message: "Invalid object name 'sys.dm_hadr_database_replica_states'.",
        },
        {
          group: DatabaseMetricGroup.Locks,
          reason: DatabaseMetricGroupUnavailableReason.Timeout,
          message: "Timeout: Request failed to complete in 10000ms",
        },
      ],
    });

    expect(
      view.queryByText(
        "Which grants each metric group needs, for every platform",
      ),
    ).toBeNull();
    expect(remediationBlocks(view)).toHaveLength(0);
    expect(view.getByText("Not available on this engine")).toBeInTheDocument();
  });

  test("a clean check shows no collection panel at all", () => {
    const view: RenderResult = renderView({
      ...readOnlySqlServer,
      metrics: { [MonitorMetricType.DatabaseMetricGroupsFailed]: 0 },
      collectedGroups: [...DMV_GROUPS, DatabaseMetricGroup.Replication],
      unavailableGroups: [],
    });

    expect(view.queryByText("Some metrics were not collected")).toBeNull();
    expect(view.getByText("Healthy")).toBeInTheDocument();
  });
});
