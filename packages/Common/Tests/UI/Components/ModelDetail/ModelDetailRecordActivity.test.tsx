import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import Permission, { UserPermission } from "../../../../Types/Permission";

const getItemMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock consts are still unassigned when the
 * factories run. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

// What the reader holds: changed per test.
let heldPermissions: Array<Permission> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return heldPermissions;
      },
      getProjectPermissions: () => {
        return {
          permissions: heldPermissions.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: heldPermissions };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import ApiKey from "../../../../Models/DatabaseModels/ApiKey";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import User from "../../../../Models/DatabaseModels/User";
import Route from "../../../../Types/API/Route";
import RecordActorType from "../../../../Types/Database/RecordActor";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import RecordHistoryContext, {
  GetRecordHistoryRoute,
} from "../../../../UI/Components/Detail/RecordHistoryContext";
import ModelDetail from "../../../../UI/Components/ModelDetail/ModelDetail";
import Field from "../../../../UI/Components/ModelDetail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";
import PermissionGate from "../../../../UI/Utils/PermissionGate";

/*
 * A DETAILS CARD THAT ENDS WITH ITS RECORD'S LINE SAYS WHO CREATED THE RECORD
 * AND WHO LAST MODIFIED IT (#10290), with nothing a page has to add: the
 * card's own read asks for those columns - only the ones its reader may
 * read - the line says them, an API key by its own name where the reader may
 * read the key, and the record's history is linked where the front end has a
 * page of it.
 */

const WAIT_TIMEOUT: number = 20000;

const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000001",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-0000000000a1",
);
const CREATED: Date = new Date("2026-09-30T13:25:13.000Z");
const MODIFIED: Date = new Date("2026-11-19T09:12:00.000Z");

const OWNER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

// Reads monitors, and neither users nor API keys.
const MONITOR_VIEWER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.MonitorViewer,
];

const ID_AND_NAME: Array<Field<Monitor>> = [
  {
    field: { _id: true },
    title: "Monitor ID",
    fieldType: FieldType.ObjectID,
  },
  {
    field: { name: true },
    title: "Name",
    fieldType: FieldType.Text,
  },
];

function theMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.name = "Checkout API";
  monitor.createdAt = CREATED;
  monitor.createdByActorType = RecordActorType.ApiKey;
  monitor.createdByActorId = API_KEY_ID;
  monitor.lastModifiedAt = MODIFIED;
  monitor.lastModifiedByActorType = RecordActorType.User;

  const person: User = new User();
  person.name = new Name("Simon Larsen");
  monitor.lastModifiedByUser = person;

  return monitor;
}

function theKey(): ApiKey {
  const key: ApiKey = new ApiKey();
  key._id = API_KEY_ID.toString();
  key.name = "Terraform";
  return key;
}

function answerReads(): void {
  getItemMock.mockImplementation(
    async (data: { modelType: unknown }): Promise<unknown> => {
      if (data.modelType === ApiKey) {
        return theKey();
      }

      return theMonitor();
    },
  );
}

function monitorReadSelect(): Record<string, unknown> {
  const call: Array<unknown> | undefined = getItemMock.mock.calls.find(
    (args: Array<unknown>): boolean => {
      return (args[0] as { modelType: unknown }).modelType === Monitor;
    },
  );

  return (call?.[0] as { select: Record<string, unknown> }).select;
}

function readsOf(modelType: unknown): number {
  return getItemMock.mock.calls.filter((args: Array<unknown>): boolean => {
    return (args[0] as { modelType: unknown }).modelType === modelType;
  }).length;
}

beforeEach(() => {
  getItemMock.mockReset();
  heldPermissions = OWNER;
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a details card that ends with its record's line", () => {
  test("asks, with the record, for who created it and who last modified it", async () => {
    answerReads();

    render(
      <ModelDetail<Monitor>
        modelType={Monitor}
        id="monitor-details"
        modelId={MONITOR_ID}
        fields={ID_AND_NAME}
      />,
    );

    await screen.findByTestId(
      "detail-record-line",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(monitorReadSelect()).toEqual(
      expect.objectContaining({
        _id: true,
        name: true,
        createdAt: true,
        createdByActorType: true,
        createdByActorId: true,
        createdByUser: { name: true, email: true },
        lastModifiedAt: true,
        lastModifiedByActorType: true,
        lastModifiedByActorId: true,
        lastModifiedByUser: { name: true, email: true },
      }),
    );
  });

  test("says them on its line: the API key by its own name, the person by theirs", async () => {
    answerReads();

    render(
      <ModelDetail<Monitor>
        modelType={Monitor}
        id="monitor-details"
        modelId={MONITOR_ID}
        fields={ID_AND_NAME}
      />,
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("detail-created-by-actor")).toHaveTextContent(
          "Terraform (API key)",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(
      screen.getByTestId("detail-last-modified-by-actor"),
    ).toHaveTextContent("Simon Larsen");
    // The key was read for its name, with the reader's own permissions.
    expect(readsOf(ApiKey)).toBe(1);
  });

  test("a reader who reads monitors and not API keys reads that a key created it, and not which", async () => {
    heldPermissions = MONITOR_VIEWER;
    answerReads();

    render(
      <ModelDetail<Monitor>
        modelType={Monitor}
        id="monitor-details"
        modelId={MONITOR_ID}
        fields={ID_AND_NAME}
      />,
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("detail-created-by-actor")).toHaveTextContent(
          /^API key$/,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );

    // Who last modified it, as they read who created it.
    expect(
      screen.getByTestId("detail-last-modified-by-actor"),
    ).toHaveTextContent("Simon Larsen");
    // No key is read for a reader who may not read keys.
    expect(readsOf(ApiKey)).toBe(0);
    expect(monitorReadSelect()["lastModifiedByUser"]).toEqual({
      name: true,
      email: true,
    });
  });

  test("a reader who may not read who created it is asked for none of it", async () => {
    // Reads incidents, not monitors: no column of a monitor is theirs.
    heldPermissions = [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.IncidentViewer,
    ];
    getItemMock.mockResolvedValue(null as never);

    render(
      <ModelDetail<Monitor>
        modelType={Monitor}
        id="monitor-details"
        modelId={MONITOR_ID}
        fields={ID_AND_NAME}
      />,
    );

    await waitFor(
      () => {
        expect(getItemMock).toHaveBeenCalled();
      },
      { timeout: WAIT_TIMEOUT },
    );

    const select: Record<string, unknown> = monitorReadSelect();

    for (const column of [
      "createdByActorType",
      "createdByActorId",
      "createdByUser",
      "lastModifiedAt",
      "lastModifiedByActorType",
      "lastModifiedByActorId",
      "lastModifiedByUser",
    ]) {
      expect({ column, asked: column in select }).toEqual({
        column,
        asked: false,
      });
    }
  });

  test("links to the record's history where the front end has it", async () => {
    answerReads();

    const getRoute: GetRecordHistoryRoute = (data: {
      modelId: ObjectID;
    }): Route => {
      return new Route(
        `/dashboard/p/monitors/${data.modelId.toString()}/audit-logs`,
      );
    };

    render(
      <RecordHistoryContext.Provider value={getRoute}>
        <ModelDetail<Monitor>
          modelType={Monitor}
          id="monitor-details"
          modelId={MONITOR_ID}
          fields={ID_AND_NAME}
        />
      </RecordHistoryContext.Provider>,
    );

    const link: HTMLElement = await screen.findByTestId(
      "detail-record-history",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/p/monitors/${MONITOR_ID.toString()}/audit-logs`,
    );
  });
});

describe("a details card without its record's line", () => {
  test("asks for none of it, and draws no line", async () => {
    answerReads();

    render(
      <ModelDetail<Monitor>
        modelType={Monitor}
        id="monitor-name"
        modelId={MONITOR_ID}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FieldType.Text,
          },
        ]}
      />,
    );

    await screen.findByText("Checkout API", {}, { timeout: WAIT_TIMEOUT });

    expect(monitorReadSelect()).toEqual({ _id: true, name: true });
    expect(screen.queryByTestId("detail-record-line")).toBeNull();
    expect(readsOf(ApiKey)).toBe(0);
  });
});
