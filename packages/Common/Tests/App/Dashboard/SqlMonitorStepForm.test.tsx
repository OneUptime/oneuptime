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
import SqlMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SqlMonitor/SqlMonitorStepForm";
import MonitorStepSqlMonitor, {
  MonitorStepSqlMonitorUtil,
} from "../../../Types/Monitor/MonitorStepSqlMonitor";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";

/*
 * The SQL Query monitor's form signs in to SQL Server the way the Database
 * Health form does: an Authentication choice - Username and password, or
 * Windows Integrated Authentication - in place of a switch whose help
 * explained both modes. It writes the step's
 * useWindowsIntegratedAuthentication boolean, as the switch did.
 */

const renderForm: (
  config: Partial<MonitorStepSqlMonitor>,
  onChange?: (value: MonitorStepSqlMonitor) => void,
) => RenderResult = (
  config: Partial<MonitorStepSqlMonitor>,
  onChange?: (value: MonitorStepSqlMonitor) => void,
): RenderResult => {
  return render(
    <MemoryRouter>
      <SqlMonitorStepForm
        monitorStepSqlMonitor={{
          ...MonitorStepSqlMonitorUtil.getDefault(),
          ...config,
        }}
        onChange={onChange || (() => {})}
      />
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
});

describe("SqlMonitorStepForm - how it signs in", () => {
  test("SQL Server offers the choice, a username and a password picked for a new monitor", () => {
    const view: RenderResult = renderForm({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
    });

    expect(view.getByTestId("database-authentication")).toBeInTheDocument();
    expect(
      view.getByRole("radio", { name: "Username and password" }),
    ).toBeChecked();
    expect(view.getByPlaceholderText("readonly_user")).toBeInTheDocument();
    expect(
      view.getByPlaceholderText("{{monitorSecrets.dbPassword}}"),
    ).toBeInTheDocument();
    expect(
      view.queryByRole("switch", {
        name: "Use Windows Integrated Authentication",
      }),
    ).toBeNull();
  });

  test("picking Windows Integrated Authentication writes the boolean on", () => {
    const changes: Array<MonitorStepSqlMonitor> = [];
    const view: RenderResult = renderForm(
      { databaseType: SqlDatabaseType.MicrosoftSqlServer },
      (value: MonitorStepSqlMonitor) => {
        changes.push(value);
      },
    );

    fireEvent.click(
      view.getByRole("radio", { name: "Windows Integrated Authentication" }),
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.useWindowsIntegratedAuthentication).toBe(true);
  });

  test("with Windows Integrated Authentication, the credentials are not asked for", () => {
    const view: RenderResult = renderForm({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
      useWindowsIntegratedAuthentication: true,
    });

    expect(
      view.getByRole("radio", { name: "Windows Integrated Authentication" }),
    ).toBeChecked();
    expect(view.queryByPlaceholderText("readonly_user")).toBeNull();
    expect(
      view.queryByPlaceholderText("{{monitorSecrets.dbPassword}}"),
    ).toBeNull();
    // What the query runs against is still asked for.
    expect(view.getByPlaceholderText("orders")).toBeInTheDocument();
  });

  test.each([SqlDatabaseType.PostgreSQL, SqlDatabaseType.MySQL])(
    "%s offers no choice, and asks for the credentials",
    (databaseType: SqlDatabaseType) => {
      const view: RenderResult = renderForm({
        databaseType: databaseType,
        useWindowsIntegratedAuthentication: true,
      });

      expect(view.queryByTestId("database-authentication")).toBeNull();
      expect(view.getByPlaceholderText("readonly_user")).toBeInTheDocument();
    },
  );

  test("the choice follows the credentials it decides about: after the database, before the username", () => {
    const view: RenderResult = renderForm({
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
    });

    const databaseName: HTMLElement = view.getByPlaceholderText("orders");
    const choice: HTMLElement = view.getByTestId("database-authentication");
    const username: HTMLElement = view.getByPlaceholderText("readonly_user");

    expect(
      databaseName.compareDocumentPosition(choice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      choice.compareDocumentPosition(username) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("SqlMonitorStepForm - on a phone", () => {
  test("Host and Port sit side by side only from the sm width", () => {
    const view: RenderResult = renderForm({
      databaseType: SqlDatabaseType.PostgreSQL,
    });

    const host: HTMLElement = view.getByPlaceholderText("db.internal");
    const row: HTMLElement | null = host.closest(".grid");

    expect(row).toHaveClass("grid-cols-1", "sm:grid-cols-2");
  });
});
