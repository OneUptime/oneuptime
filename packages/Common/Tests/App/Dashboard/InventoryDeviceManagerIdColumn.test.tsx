import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";

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
  INVENTORY_DEVICE_MANAGER_ID_COLUMN_ID,
  getInventoryAgentPermissionsColumn,
  getInventoryDeviceManagerIdColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable";
import { DEVICE_MANAGER_ID_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/DeviceManagerIds";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import EntityType from "../../../Types/Telemetry/EntityType";
import Columns from "../../../UI/Components/ModelTable/Columns";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import {
  ESPER_DEVICE_ID_ATTRIBUTE,
  getManagedDeviceServiceAttributeKeys,
} from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";

/*
 * Inventory > All Items' Device Manager ID column (#10097): the ID each
 * device manager that imports a device knows it by - Esper's, which
 * `espercli secureadb connect --device` takes to grant the Android agent's
 * permissions - beside the Agent Permissions column, so the devices that
 * still lack a grant are found, and exported, with the ID each command
 * takes. Drawn here as the list draws each cell, for devices whose agent
 * lacks grants and devices it has them all, with a copy button per ID.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

const ESPER_ID: string = "7e5c1d6a-3f2b-4c8e-9a1d-2b3c4d5e6f70";
const INTUNE_ID: string = "1d7f0c92-6a3b-4f1e-8c55-0b9a2e4d6f13";
const WORKSPACE_ONE_ID: string = "21503";
const SOTI_ID: string = "35F1A9C7B2E04D6A8F3C1B7E9D2A4C6F";

const idColumn: Columns<InventoryItem>[number] =
  getInventoryDeviceManagerIdColumn();
const permissionsColumn: Columns<InventoryItem>[number] =
  getInventoryAgentPermissionsColumn();

function host(descriptive: Record<string, unknown> | undefined): InventoryItem {
  const row: InventoryItem = new InventoryItem();
  row.entityType = EntityType.Host;
  row.identifyingAttributes = { "host.name": "esp-id-aaaaw" };
  if (descriptive) {
    row.descriptiveAttributes = descriptive as never;
  }
  return row;
}

// An Esper device the Android agent reports, with what it still lacks.
function esperDevice(missing: string | undefined): InventoryItem {
  return host({
    [ESPER_DEVICE_ID_ATTRIBUTE]: ESPER_ID,
    "esper.device.name": "ESP-ID-AAAAW",
    "host.serial_number": "R9KT30ABC12",
    ...(missing === undefined
      ? {}
      : { "oneuptime.agent.permissions.missing": missing }),
  });
}

// Both cells of a row, as the list draws them side by side.
function drawRow(row: InventoryItem): HTMLElement {
  const { container } = render(
    <div>
      <div data-testid="permissions-cell">
        {permissionsColumn.getElement!(row) as ReactElement}
      </div>
      <div data-testid="device-manager-id-cell">
        {idColumn.getElement!(row) as ReactElement}
      </div>
    </div>,
  );

  return container;
}

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

function installClipboard(writeText: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
      ja: { translation: readLocale("ja") },
      fa: { translation: readLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  installClipboard(undefined);
  jest.useRealTimers();
});

describe("the Device Manager ID column", () => {
  test("is hidden until turned on, never sorted, left out of phone cards, and reads the attributes", () => {
    expect(idColumn.id).toBe(INVENTORY_DEVICE_MANAGER_ID_COLUMN_ID);
    expect(idColumn.title).toBe("Device Manager ID");
    expect(idColumn.title).toBe(DEVICE_MANAGER_ID_TITLE);
    expect(idColumn.isHiddenByDefault).toBe(true);
    expect(idColumn.disableSort).toBe(true);
    expect(idColumn.hideOnMobile).toBe(true);
    expect(idColumn.field).toEqual({
      entityType: true,
      descriptiveAttributes: true,
    });
    // Beside Agent Permissions, as its own column.
    expect(idColumn.id).not.toBe(INVENTORY_AGENT_PERMISSIONS_COLUMN_ID);
  });

  test("sits right after Agent Permissions in All Items' columns, the last two the column picker lists", () => {
    const source: string = fs
      .readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable.tsx",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(source).toContain(
      "getInventorySecurityPatchColumn(now), getInventoryAgentPermissionsColumn(), getInventoryDeviceManagerIdColumn(), ]}",
    );
  });

  test("a device still missing grants shows its Esper ID beside them, with Esper under it", () => {
    drawRow(esperDevice("READ_LOGS GET_USAGE_STATS"));

    const permissions: HTMLElement = screen.getByTestId("permissions-cell");
    const ids: HTMLElement = screen.getByTestId("device-manager-id-cell");

    expect(within(permissions).getByText("Missing")).toBeInTheDocument();
    expect(within(permissions).getByText("READ_LOGS")).toBeInTheDocument();
    expect(within(ids).getByText(ESPER_ID)).toBeInTheDocument();
    expect(within(ids).getByText("Esper")).toBeInTheDocument();
    expect(
      within(ids).getByTitle("Copy Device Manager ID"),
    ).toBeInTheDocument();
  });

  test("a device with every grant shows its ID all the same", () => {
    drawRow(esperDevice("none"));

    expect(
      within(screen.getByTestId("permissions-cell")).getByText("All Granted"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("device-manager-id-cell")).getByText(ESPER_ID),
    ).toBeInTheDocument();
  });

  test("a device the agent does not run on shows its ID, and its permissions the quiet dash", () => {
    drawRow(esperDevice(undefined));

    expect(
      within(screen.getByTestId("permissions-cell")).getByTestId(
        TABLE_EMPTY_VALUE_TEST_ID,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("device-manager-id-cell")).getByText(ESPER_ID),
    ).toBeInTheDocument();
  });

  test("pressing copy puts the ID, and only the ID, on the clipboard, and says Copied", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    drawRow(esperDevice("READ_LOGS"));

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy Device Manager ID"));
    });

    expect(writeText).toHaveBeenCalledWith(ESPER_ID);
    expect(
      screen.getByTitle("Copy Device Manager ID").closest("button"),
    ).toHaveAttribute("data-copy-state", "copied");
  });

  test("Intune's, Workspace ONE's and SOTI's IDs read the same way, each under its service's name", () => {
    const cases: Array<[DeviceManagementProvider, string, string]> = [
      [DeviceManagementProvider.Intune, INTUNE_ID, "Microsoft Intune"],
      [
        DeviceManagementProvider.WorkspaceOne,
        WORKSPACE_ONE_ID,
        "Workspace ONE UEM",
      ],
      [DeviceManagementProvider.Soti, SOTI_ID, "SOTI MobiControl"],
    ];

    for (const [provider, id, title] of cases) {
      const row: InventoryItem = host({
        [getManagedDeviceServiceAttributeKeys(provider).deviceId]: id,
        "oneuptime.agent.permissions.missing": "READ_LOGS",
      });

      render(idColumn.getElement!(row) as ReactElement);

      const cell: HTMLElement = screen.getByTestId(
        `device-manager-id-${provider}`,
      );
      expect(within(cell).getByText(id)).toBeInTheDocument();
      expect(within(cell).getByText(title)).toBeInTheDocument();
      expect(idColumn.getExportValue!(row)).toBe(id);
      cleanup();
    }
  });

  test("a device two device managers enroll - moved from one to the other - shows both, in the services' order", () => {
    const row: InventoryItem = host({
      "soti.device.id": SOTI_ID,
      [ESPER_DEVICE_ID_ATTRIBUTE]: ESPER_ID,
    });

    render(idColumn.getElement!(row) as ReactElement);

    const providers: Array<string> = screen
      .getAllByTestId(/^device-manager-id-/)
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      });

    expect(providers).toEqual([
      "device-manager-id-esper",
      "device-manager-id-soti",
    ]);
    expect(screen.getAllByTitle("Copy Device Manager ID")).toHaveLength(2);
    expect(idColumn.getExportValue!(row)).toBe(`${ESPER_ID}, ${SOTI_ID}`);
  });

  test("anything no device manager imports reads the quiet dash, and exports an empty cell", () => {
    for (const row of [
      host({ "os.type": "linux" }),
      host({ "oneuptime.agent.permissions.missing": "READ_LOGS" }),
      host({ [ESPER_DEVICE_ID_ATTRIBUTE]: "   " }),
      host({ [ESPER_DEVICE_ID_ATTRIBUTE]: 42 }),
      host(undefined),
    ]) {
      render(idColumn.getElement!(row) as ReactElement);

      expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeInTheDocument();
      expect(screen.queryByTitle("Copy Device Manager ID")).toBeNull();
      expect(idColumn.getExportValue!(row)).toBe("");
      cleanup();
    }
  });

  test("exported, the devices still missing grants carry the IDs the command takes, trimmed, alone", () => {
    const rows: Array<InventoryItem> = [
      esperDevice("READ_LOGS"),
      host({
        [ESPER_DEVICE_ID_ATTRIBUTE]: ` ${ESPER_ID.replace("7e5c", "8f6d")} `,
        "oneuptime.agent.permissions.missing": "READ_DROPBOX_DATA",
      }),
    ];

    expect(
      rows.map((row: InventoryItem): [string, string] => {
        return [
          permissionsColumn.getExportValue!(row),
          idColumn.getExportValue!(row),
        ];
      }),
    ).toEqual([
      ["READ_LOGS", ESPER_ID],
      ["READ_DROPBOX_DATA", ESPER_ID.replace("7e5c", "8f6d")],
    ]);
  });
});

describe("the column in the reader's language", () => {
  test.each([["de"], ["ja"], ["fa"]])(
    "%s: the copy button is named in the reader's words; the ID and the service's name as written",
    async (language: string) => {
      await i18next.changeLanguage(language);
      const locale: Record<string, string> = readLocale(language);
      const title: string = locale["Device Manager ID"]!;

      expect(title).toBeTruthy();
      expect(title).not.toBe("Device Manager ID");

      render(idColumn.getElement!(esperDevice("READ_LOGS")) as ReactElement);

      // "Copy {{name}}", worded by the locale around its own name for the column.
      const copy: string = locale["Copy {{name}}"]!.replace("{{name}}", title);
      expect(screen.getByTitle(copy)).toBeInTheDocument();
      expect(screen.getByText(ESPER_ID)).toBeInTheDocument();
      expect(screen.getByText("Esper")).toBeInTheDocument();
    },
  );
});
