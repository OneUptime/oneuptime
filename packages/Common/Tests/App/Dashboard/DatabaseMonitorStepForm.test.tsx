import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import DatabaseMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DatabaseMonitor/DatabaseMonitorStepForm";
import {
  AZURE_SQL_DATABASE_MONITORING_GRANT,
  AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT,
  SQL_SERVER_MONITORING_GRANT,
} from "../../../Types/Monitor/DatabaseMonitor/SqlServerPlatform";
import MonitorStepDatabaseMonitor, {
  MonitorStepDatabaseMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDatabaseMonitor";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";

/*
 * https://github.com/OneUptime/oneuptime/issues/3913
 *
 * The privileges box on the Database Health form is where an operator
 * learns what to grant BEFORE a week of blank charts. For SQL Server it
 * printed only `GRANT VIEW SERVER STATE`, which fails on Azure SQL Database,
 * and it called Storage "readable by any login that can connect" - true of
 * database size alone. These pin the grants it now prints and what each
 * group's toggle says it needs.
 */

const buildConfig: (
  databaseType: SqlDatabaseType,
) => MonitorStepDatabaseMonitor = (
  databaseType: SqlDatabaseType,
): MonitorStepDatabaseMonitor => {
  return {
    ...MonitorStepDatabaseMonitorUtil.getDefault(),
    databaseType,
  };
};

const renderForm: (databaseType: SqlDatabaseType) => RenderResult = (
  databaseType: SqlDatabaseType,
): RenderResult => {
  return render(
    <MemoryRouter>
      <DatabaseMonitorStepForm
        monitorStepDatabaseMonitor={buildConfig(databaseType)}
        onChange={() => {}}
      />
    </MemoryRouter>,
  );
};

const grantBlock: (view: RenderResult) => HTMLElement = (
  view: RenderResult,
): HTMLElement => {
  const block: HTMLElement | null = view.container.querySelector("pre");
  expect(block).not.toBeNull();
  return block as HTMLElement;
};

afterEach(() => {
  cleanup();
});

describe("DatabaseMonitorStepForm - Microsoft SQL Server privileges (issue #3913)", () => {
  test("prints the SQL Server grant AND both Azure SQL Database grants", () => {
    const text: string = grantBlock(
      renderForm(SqlDatabaseType.MicrosoftSqlServer),
    ).textContent as string;

    expect(text).toContain(SQL_SERVER_MONITORING_GRANT);
    expect(text).toContain(AZURE_SQL_DATABASE_MONITORING_GRANT);
    expect(text).toContain(AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT);
  });

  test("labels which platform each grant is for, and where to run it", () => {
    const lines: Array<string> = (
      grantBlock(renderForm(SqlDatabaseType.MicrosoftSqlServer))
        .textContent as string
    ).split("\n");

    const indexOf: (needle: string) => number = (needle: string): number => {
      return lines.findIndex((line: string) => {
        return line.includes(needle);
      });
    };

    // Each statement sits under the comment that names its platform.
    expect(
      indexOf("-- SQL Server and Azure SQL Managed Instance, run in master"),
    ).toBe(indexOf(SQL_SERVER_MONITORING_GRANT) - 1);
    expect(
      indexOf("-- Azure SQL Database, run in the monitored database"),
    ).toBe(indexOf(AZURE_SQL_DATABASE_MONITORING_GRANT) - 1);
    expect(indexOf("run in master instead")).toBe(
      indexOf(AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT) - 1,
    );
  });

  test("warns that read access to tables is not enough", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.MicrosoftSqlServer);

    expect(
      view.getByText(/Read access to your tables is not enough/),
    ).toBeInTheDocument();
    expect(
      view.getByText(
        /The user does not have permission to perform this action/,
      ),
    ).toBeInTheDocument();
  });

  test("tells the truth about Storage: only database size needs no grant", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.MicrosoftSqlServer);

    expect(
      view.getByText(
        /Database size is readable by any login that can connect; log space and tempdb free space need VIEW SERVER STATE/,
      ),
    ).toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(
      /tempdb[^.]*\.\s*Readable by any login that can connect\./,
    );
  });

  test("points every per-group hint at the Azure grants above, not at one grant that some tiers refuse", () => {
    /*
     * VIEW DATABASE STATE is not enough on Basic, S0, S1 or an elastic
     * pool, so a hint naming it as THE Azure grant would be wrong for them.
     */
    const view: RenderResult = renderForm(SqlDatabaseType.MicrosoftSqlServer);

    expect(
      view.getAllByText(/\(on Azure SQL Database, the Azure grants above\)/)
        .length,
    ).toBeGreaterThanOrEqual(4);
    expect(view.container.textContent).not.toContain(
      "(VIEW DATABASE STATE on Azure SQL Database)",
    );
  });

  test("says Replication is not collected on Azure SQL Database", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.MicrosoftSqlServer);

    expect(
      view.getByText(
        /Needs VIEW SERVER STATE\. Not collected on Azure SQL Database/,
      ),
    ).toBeInTheDocument();
  });

  test("links to the setup guide's grants section", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.MicrosoftSqlServer);

    const anchor: HTMLAnchorElement | null = view
      .getByText(/Read the setup guide/)
      .closest("a");

    expect(anchor?.getAttribute("href")).toContain(
      "/monitor/database-health-monitor#create-a-monitoring-user",
    );
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });
});

describe("DatabaseMonitorStepForm - the other engines are unchanged", () => {
  test("PostgreSQL prints pg_monitor and no SQL Server text", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.PostgreSQL);
    const text: string = grantBlock(view).textContent as string;

    expect(text).toContain("GRANT pg_monitor TO <monitoring_user>;");
    expect(text).not.toContain("VIEW SERVER STATE");
    expect(view.queryByText(/Read access to your tables/)).toBeNull();
    // The guide link is offered for every engine.
    expect(view.getByText(/Read the setup guide/)).toBeInTheDocument();
  });

  test("MySQL prints PROCESS and performance_schema and no SQL Server text", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.MySQL);
    const text: string = grantBlock(view).textContent as string;

    /*
     * REPLICATION CLIENT too: without it SHOW REPLICA STATUS fails with
     * 1227 on every check (verified on 8.4), and the form used to print
     * PROCESS alone.
     */
    expect(text).toContain(
      "GRANT PROCESS, REPLICATION CLIENT ON *.* TO '<monitoring_user>'@'%';",
    );
    expect(text).toContain(
      "GRANT SELECT ON performance_schema.* TO '<monitoring_user>'@'%';",
    );
    expect(text).not.toContain("VIEW SERVER STATE");
    expect(
      view.getByText(/Needs the REPLICATION CLIENT privilege\./),
    ).toBeInTheDocument();
  });
});
