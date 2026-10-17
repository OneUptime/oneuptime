import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
} from "@testing-library/react";
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

/*
 * The simplicity audit of the monitor forms. SQL Server's sign-in was a
 * switch, "Use Windows Integrated Authentication", whose help explained the
 * other mode too; it is an Authentication choice now, with the simpler
 * answer - a username and a password - first. The seven Metric Groups
 * (all on, rarely changed) wait under More fields.
 */
describe("DatabaseMonitorStepForm - how it signs in to SQL Server", () => {
  const renderWith: (
    config: Partial<MonitorStepDatabaseMonitor>,
    onChange?: (value: MonitorStepDatabaseMonitor) => void,
  ) => RenderResult = (
    config: Partial<MonitorStepDatabaseMonitor>,
    onChange?: (value: MonitorStepDatabaseMonitor) => void,
  ): RenderResult => {
    return render(
      <MemoryRouter>
        <DatabaseMonitorStepForm
          monitorStepDatabaseMonitor={{
            ...MonitorStepDatabaseMonitorUtil.getDefault(),
            ...config,
          }}
          onChange={onChange || (() => {})}
        />
      </MemoryRouter>,
    );
  };

  test("offers two plain choices, a username and a password picked for a new monitor", () => {
    const view: RenderResult = renderWith({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
    });

    const group: HTMLElement = view.getByTestId("database-authentication");
    expect(group).toHaveAttribute("role", "radiogroup");

    expect(
      view.getByRole("radio", { name: "Username and password" }),
    ).toBeChecked();
    expect(
      view.getByRole("radio", { name: "Windows Integrated Authentication" }),
    ).not.toBeChecked();
    expect(
      view.getByRole("radio", { name: "Username and password" }),
    ).toHaveAccessibleDescription("Sign in with a SQL Server login.");
    expect(
      view.getByRole("radio", { name: "Windows Integrated Authentication" }),
    ).toHaveAccessibleDescription(
      "Sign in as the account the probe runs as. No password needed.",
    );
  });

  test("the switch that explained both modes is gone", () => {
    const view: RenderResult = renderWith({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
    });

    expect(
      view.queryByRole("switch", {
        name: "Use Windows Integrated Authentication",
      }),
    ).toBeNull();
    expect(view.container.textContent).not.toContain(
      "Username and password are ignored.",
    );
  });

  test("picking Windows writes the stored boolean, and only that", () => {
    const changes: Array<MonitorStepDatabaseMonitor> = [];
    const view: RenderResult = renderWith(
      { databaseType: SqlDatabaseType.MicrosoftSqlServer, username: "keep" },
      (value: MonitorStepDatabaseMonitor) => {
        changes.push(value);
      },
    );

    fireEvent.click(
      view.getByRole("radio", { name: "Windows Integrated Authentication" }),
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.useWindowsIntegratedAuthentication).toBe(true);
    expect(changes[0]?.username).toBe("keep");
    expect(changes[0]?.databaseType).toBe(SqlDatabaseType.MicrosoftSqlServer);
  });

  test("a step stored with Windows authentication opens on that choice, without the credentials", () => {
    const view: RenderResult = renderWith({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
      useWindowsIntegratedAuthentication: true,
    });

    expect(
      view.getByRole("radio", { name: "Windows Integrated Authentication" }),
    ).toBeChecked();
    expect(view.queryByPlaceholderText("oneuptime_monitor")).toBeNull();
    expect(
      view.queryByPlaceholderText("{{monitorSecrets.dbPassword}}"),
    ).toBeNull();
  });

  test("a username and a password ask for both", () => {
    const view: RenderResult = renderWith({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
    });

    expect(view.getByPlaceholderText("oneuptime_monitor")).toBeInTheDocument();
    expect(
      view.getByPlaceholderText("{{monitorSecrets.dbPassword}}"),
    ).toBeInTheDocument();
  });

  test("going back to a username and a password turns the boolean off", () => {
    const changes: Array<MonitorStepDatabaseMonitor> = [];
    const view: RenderResult = renderWith(
      {
        databaseType: SqlDatabaseType.MicrosoftSqlServer,
        useWindowsIntegratedAuthentication: true,
      },
      (value: MonitorStepDatabaseMonitor) => {
        changes.push(value);
      },
    );

    fireEvent.click(view.getByRole("radio", { name: "Username and password" }));

    expect(changes[0]?.useWindowsIntegratedAuthentication).toBe(false);
  });

  test.each([SqlDatabaseType.PostgreSQL, SqlDatabaseType.MySQL])(
    "%s has no choice to make: it always signs in with a username and a password",
    (databaseType: SqlDatabaseType) => {
      const view: RenderResult = renderWith({
        databaseType: databaseType,
        // Even a stray boolean from an API call is not Windows sign-in here.
        useWindowsIntegratedAuthentication: true,
      });

      expect(view.queryByTestId("database-authentication")).toBeNull();
      expect(
        view.getByPlaceholderText("oneuptime_monitor"),
      ).toBeInTheDocument();
    },
  );

  test("the password's help is one line on keeping it encrypted", () => {
    const view: RenderResult = renderWith({
      databaseType: SqlDatabaseType.PostgreSQL,
    });

    expect(view.container.textContent).toContain(
      "Use a monitor secret, such as {{monitorSecrets.name}}, to keep it encrypted.",
    );
    expect(view.container.textContent).not.toContain(
      "We recommend referencing a monitor secret",
    );
  });
});

describe("DatabaseMonitorStepForm - Metric Groups wait under More fields", () => {
  test("the groups sit inside the folded More fields section, which starts closed", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.PostgreSQL);

    const section: HTMLElement = view.getByTestId(
      "database-monitor-more-fields",
    );
    const groups: HTMLElement = view.getByTestId(
      "database-monitor-metric-groups",
    );

    expect(section).toContainElement(groups);
    expect(view.getByRole("button", { name: /More fields/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("the folded header names the groups first", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.PostgreSQL);
    const header: HTMLElement = view.getByRole("button", {
      name: /More fields/,
    });

    expect(header.textContent).toContain("Metric Groups");
  });

  test("every group starts on, as before", () => {
    const view: RenderResult = renderForm(SqlDatabaseType.PostgreSQL);

    const switches: Array<HTMLElement> = Array.from(
      view
        .getByTestId("database-monitor-metric-groups")
        .querySelectorAll("[role='switch']"),
    );

    expect(switches).toHaveLength(7);
    for (const groupSwitch of switches) {
      expect(groupSwitch).toHaveAttribute("aria-checked", "true");
    }
  });

  test("the privileges box says in one line what goes wrong without the grant", () => {
    const postgres: RenderResult = renderForm(SqlDatabaseType.PostgreSQL);

    expect(
      postgres.getByText(
        "Without pg_monitor, PostgreSQL shows only the monitoring session, so the groups that need it are reported as missing.",
      ),
    ).toBeInTheDocument();
    expect(postgres.container.textContent).not.toContain(
      "would read as one and zero forever",
    );
  });
});
