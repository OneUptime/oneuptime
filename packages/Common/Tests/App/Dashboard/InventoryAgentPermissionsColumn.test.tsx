import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactElement } from "react";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/ResolveTypedRowLink",
  () => {
    return {
      __esModule: true,
      resolveTypedRowLink: () => {
        return Promise.resolve(null);
      },
    };
  },
);

import {
  INVENTORY_AGENT_PERMISSIONS_COLUMN_ID,
  getInventoryAgentPermissionsColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import EntityType from "../../../Types/Telemetry/EntityType";
import Columns from "../../../UI/Components/ModelTable/Columns";

/*
 * Inventory > All Items' Agent Permissions column (#9967): on an Android
 * device, whether the OneUptime Android agent still lacks READ_LOGS,
 * READ_DROPBOX_DATA or usage access, and which - so the devices that still
 * need adb are found, and exported, from one list.
 */

const column: Columns<InventoryItem>[number] =
  getInventoryAgentPermissionsColumn();

function device(value: unknown): InventoryItem {
  const row: InventoryItem = new InventoryItem();
  row.entityType = EntityType.Host;
  row.descriptiveAttributes = (
    value === undefined
      ? { "os.type": "linux" }
      : { "oneuptime.agent.permissions.missing": value }
  ) as never;
  return row;
}

afterEach(() => {
  cleanup();
});

describe("the Agent Permissions column", () => {
  test("starts hidden, is never sorted, and phone cards leave it out", () => {
    expect(column.id).toBe(INVENTORY_AGENT_PERMISSIONS_COLUMN_ID);
    expect(column.title).toBe("Agent Permissions");
    expect(column.isHiddenByDefault).toBe(true);
    expect(column.disableSort).toBe(true);
    expect(column.hideOnMobile).toBe(true);
  });

  test("a device still missing grants says Missing, and names each as its adb command does", () => {
    render(
      column.getElement!(device("READ_LOGS GET_USAGE_STATS")) as ReactElement,
    );

    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("READ_LOGS")).toBeInTheDocument();
    expect(screen.getByText("GET_USAGE_STATS")).toBeInTheDocument();
    expect(screen.queryByText("READ_DROPBOX_DATA")).not.toBeInTheDocument();
  });

  test("a device with every grant says All Granted", () => {
    render(column.getElement!(device("none")) as ReactElement);

    expect(screen.getByText("All Granted")).toBeInTheDocument();
  });

  test("a host the agent does not run on, or a value it never sends, reads the quiet dash", () => {
    for (const row of [device(undefined), device("READ_CONTACTS")]) {
      const { container } = render(column.getElement!(row) as ReactElement);

      expect(container.textContent).not.toContain("Missing");
      expect(container.textContent).not.toContain("All Granted");
      cleanup();
    }
  });

  test("the CSV export writes what the agent sends, and nothing for anything else", () => {
    expect(column.getExportValue!(device("READ_LOGS GET_USAGE_STATS"))).toBe(
      "READ_LOGS GET_USAGE_STATS",
    );
    expect(column.getExportValue!(device("none"))).toBe("none");
    expect(column.getExportValue!(device(undefined))).toBe("");
    expect(column.getExportValue!(device("READ_CONTACTS"))).toBe("");
  });
});
