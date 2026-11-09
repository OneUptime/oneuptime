import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import NetworkEndpointService, {
  EDIT_KEEPING_COLUMNS,
  isEditThatKeepsTheDevice,
} from "../../../Server/Services/NetworkEndpointService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A discovered device a person added or changed stays on the Discovered
 * Devices list however long nothing sees it (issue #6389): its editedAt
 * says so. Pinned here: the server stamps it on every create and every
 * change of vendor, address or site made by a person, an API key or a
 * workflow - never on its own (root) writes, never for a classification
 * alone (a classification keeps a device only while it has one) - and no
 * caller may write it themselves.
 */

type HookCaller = {
  onCreatePermitted: (onCreate: OnCreate<NetworkEndpoint>) => Promise<void>;
  onUpdatePermitted: (updateBy: UpdateBy<NetworkEndpoint>) => Promise<void>;
};

const service: HookCaller = NetworkEndpointService as unknown as HookCaller;

const PROJECT_ID: ObjectID = new ObjectID(
  "d4000000-0000-4000-8000-000000000001",
);
const PERSON_ID: ObjectID = new ObjectID(
  "d4000000-0000-4000-8000-000000000002",
);
const ROW_ID: ObjectID = new ObjectID("d4000000-0000-4000-8000-000000000003");
const SITE_ID: ObjectID = new ObjectID("d4000000-0000-4000-8000-000000000004");
const NOW: Date = new Date("2026-11-09T12:00:00.000Z");

const AS_PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: PERSON_ID,
};
const AS_API_KEY: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  isMasterAdmin: false,
};
const AS_SERVER: DatabaseCommonInteractionProps = { isRoot: true };

function onCreateOf(
  data: NetworkEndpoint,
  props: DatabaseCommonInteractionProps,
): OnCreate<NetworkEndpoint> {
  return { createBy: { data: data, props: props }, carryForward: null };
}

function updateByOf(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<NetworkEndpoint> {
  return {
    query: { _id: ROW_ID },
    data: data,
    props: props,
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<NetworkEndpoint>;
}

async function updated(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = AS_PERSON,
): Promise<Record<string, unknown>> {
  const updateBy: UpdateBy<NetworkEndpoint> = updateByOf(data, props);

  await service.onUpdatePermitted(updateBy);

  return updateBy.data as unknown as Record<string, unknown>;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what keeps a device", () => {
  test("a change of its vendor, address or site does; nothing else", () => {
    expect([...EDIT_KEEPING_COLUMNS]).toEqual([
      "vendor",
      "ipAddress",
      "siteId",
      "site",
    ]);
  });

  test.each([
    [{ vendor: "Zebra" }],
    [{ ipAddress: "10.0.0.5" }],
    [{ siteId: SITE_ID }],
    [{ site: { _id: SITE_ID.toString() } }],
    // Cleared is changed too: a person decided it.
    [{ vendor: null }],
    [{ ipAddress: "" }],
    [{ classification: "Printer", vendor: "HP" }],
  ])("%p is an edit that keeps the device", (data: Record<string, unknown>) => {
    expect(isEditThatKeepsTheDevice(data)).toBe(true);
  });

  test.each([
    [{}],
    [{ classification: "Printer" }],
    [{ classification: null }],
    [{ vendor: undefined }],
    [null],
    [undefined],
    ["vendor"],
  ])("%p is not", (data: unknown) => {
    expect(isEditThatKeepsTheDevice(data)).toBe(false);
  });
});

describe("a device a person adds", () => {
  test("is stamped edited as it is written", async () => {
    const endpoint: NetworkEndpoint = new NetworkEndpoint();
    endpoint.macAddress = "00:11:22:33:44:55";
    const onCreate: OnCreate<NetworkEndpoint> = onCreateOf(
      endpoint,
      AS_PERSON,
    );

    await service.onCreatePermitted(onCreate);

    expect(onCreate.createBy.data.editedAt).toEqual(NOW);
  });

  test("so is one an API key or a workflow adds", async () => {
    const onCreate: OnCreate<NetworkEndpoint> = onCreateOf(
      new NetworkEndpoint(),
      AS_API_KEY,
    );

    await service.onCreatePermitted(onCreate);

    expect(onCreate.createBy.data.editedAt).toEqual(NOW);
  });

  test("the server's own writes are not a person's: nothing is stamped", async () => {
    const onCreate: OnCreate<NetworkEndpoint> = onCreateOf(
      new NetworkEndpoint(),
      AS_SERVER,
    );

    await service.onCreatePermitted(onCreate);

    expect(onCreate.createBy.data.editedAt).toBeUndefined();
  });
});

describe("a device a person changes", () => {
  test.each([
    [{ vendor: "Zebra" }],
    [{ ipAddress: "10.0.0.5" }],
    [{ siteId: SITE_ID }],
  ])("%p stamps it edited", async (data: Record<string, unknown>) => {
    expect(await updated(data)).toEqual({ ...data, editedAt: NOW });
  });

  test("an API key's change stamps it too", async () => {
    expect(await updated({ vendor: "Zebra" }, AS_API_KEY)).toEqual({
      vendor: "Zebra",
      editedAt: NOW,
    });
  });

  test("a classification alone stamps nothing: it keeps the device only while it has one", async () => {
    expect(await updated({ classification: "Printer" })).toEqual({
      classification: "Printer",
    });
    expect(await updated({ classification: null })).toEqual({
      classification: null,
    });
  });

  test("the server's own changes stamp nothing", async () => {
    expect(await updated({ vendor: "Zebra" }, AS_SERVER)).toEqual({
      vendor: "Zebra",
    });
  });
});

describe("the column", () => {
  test("no caller may write it: the server does", () => {
    const access: ColumnAccessControl =
      new NetworkEndpoint().getColumnAccessControlFor("editedAt")!;

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect(access.read.length).toBeGreaterThan(0);
  });

  test("is an optional date, said to be the server's", () => {
    const endpoint: NetworkEndpoint = new NetworkEndpoint();

    expect(endpoint.getTableColumnMetadata("editedAt")).toMatchObject({
      required: false,
      title: "Edited At",
      description:
        "When a person last added this endpoint or changed its vendor, IP address or site. Managed by the server.",
    });
  });
});
