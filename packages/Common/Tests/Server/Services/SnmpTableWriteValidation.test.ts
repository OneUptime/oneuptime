import { Service as NetworkDeviceOidTemplateServiceType } from "../../../Server/Services/NetworkDeviceOidTemplateService";
import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import BadDataException from "../../../Types/Exception/BadDataException";
import { SnmpTableDefinition } from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import {
  MAX_DEVICE_SPECIFIC_TABLES,
  MAX_TABLES_PER_TEMPLATE,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * Both write paths refuse a malformed SNMP table at save time and store the
 * normalized form, because one bad table on a template would otherwise break
 * the walk of every device linked to it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

beforeEach(() => {
  jest.restoreAllMocks();
  stubProjectDirectory({});
});

function table(
  overrides: Partial<SnmpTableDefinition> = {},
): SnmpTableDefinition {
  return {
    key: "",
    name: "IPsec Tunnels",
    rowLabelColumnOids: [".1.3.6.1.4.1.2604.5.1.6.1.1.1.1.2"],
    columns: [
      { oid: ".1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9", name: " Status " },
      { oid: "", name: "" },
    ],
    ...overrides,
  };
}

function tables(count: number): Array<SnmpTableDefinition> {
  return Array.from({ length: count }, (_: unknown, i: number) => {
    return table({ key: `t${i}`, name: `Table ${i}` });
  });
}

type TemplateInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDeviceOidTemplate>,
  ) => Promise<OnCreate<NetworkDeviceOidTemplate>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDeviceOidTemplate>,
  ) => Promise<OnUpdate<NetworkDeviceOidTemplate>>;
};

type DeviceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDevice>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

function templateService(): TemplateInternals {
  return new NetworkDeviceOidTemplateServiceType() as unknown as TemplateInternals;
}

describe("OID Collection Template tables are validated on save", () => {
  test("normalizes a table on create", async () => {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate();
    template.tables = [table()];

    const result: OnCreate<NetworkDeviceOidTemplate> =
      await templateService().onBeforeCreate({
        data: template,
        props: { isRoot: true },
      } as unknown as CreateBy<NetworkDeviceOidTemplate>);

    expect(result.createBy.data.tables).toEqual([
      {
        key: "ipsec_tunnels",
        name: "IPsec Tunnels",
        kind: "Generic",
        rowLabelColumnOids: ["1.3.6.1.4.1.2604.5.1.6.1.1.1.1.2"],
        columns: [{ oid: "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9", name: "Status" }],
      },
    ]);
  });

  test("refuses a malformed table on create", async () => {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate();
    template.tables = [table({ columns: [{ oid: "ifName", name: "x" }] })];

    await expect(
      templateService().onBeforeCreate({
        data: template,
        props: { isRoot: true },
      } as unknown as CreateBy<NetworkDeviceOidTemplate>),
    ).rejects.toThrow(BadDataException);
  });

  test("refuses more tables than a template may hold", async () => {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate();
    template.tables = tables(MAX_TABLES_PER_TEMPLATE + 1);

    await expect(
      templateService().onBeforeCreate({
        data: template,
        props: { isRoot: true },
      } as unknown as CreateBy<NetworkDeviceOidTemplate>),
    ).rejects.toThrow(/more than the limit/);
  });

  test("validates tables on update and accepts an explicit empty list", async () => {
    await expect(
      templateService().onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: { tables: [table({ columns: [] })] },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDeviceOidTemplate>),
    ).rejects.toThrow(/needs at least one column/);

    const cleared: OnUpdate<NetworkDeviceOidTemplate> =
      await templateService().onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: { tables: [] },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDeviceOidTemplate>);

    expect(cleared.updateBy.data.tables).toEqual([]);
  });

  test("leaves an update that does not touch tables alone", async () => {
    const result: OnUpdate<NetworkDeviceOidTemplate> =
      await templateService().onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: { name: "Renamed" },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDeviceOidTemplate>);

    expect("tables" in result.updateBy.data).toBe(false);
  });
});

describe("device-specific tables are validated on save", () => {
  function deviceService(): {
    service: NetworkDeviceServiceType;
    internals: DeviceInternals;
  } {
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    return {
      service,
      internals: service as unknown as DeviceInternals,
    };
  }

  /*
   * The update hook returns early for writes that change neither site nor
   * identity - and a tables-only write is exactly that shape. The check has
   * to run anyway, so this asserts the REJECTION on such a payload.
   */
  test("refuses a malformed table on a tables-only update", async () => {
    const { service, internals } = deviceService();
    const findSpy: SpyInstance<NetworkDeviceServiceType["findBy"]> = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([] as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: {
          snmpTables: [table({ columns: [{ oid: "1.3.x", name: "bad" }] })],
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(/is not a numeric OID/);

    // Validation needs no read, so the early return still saves the query.
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("normalizes a valid tables-only update", async () => {
    const { service, internals } = deviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { snmpTables: [table()] },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(
      (result.updateBy.data.snmpTables as Array<SnmpTableDefinition>)[0]!.key,
    ).toBe("ipsec_tunnels");
  });

  test("refuses more device-specific tables than allowed", async () => {
    const { service, internals } = deviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { snmpTables: tables(MAX_DEVICE_SPECIFIC_TABLES + 1) },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(/more than the limit/);
  });

  test("validates tables on create", async () => {
    const { internals } = deviceService();
    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;
    device.name = "hq-firewall";
    device.hostname = "10.0.0.1";
    device.snmpTables = [table({ name: "" })];

    await expect(
      internals.onBeforeCreate({
        data: device,
        props: { isRoot: true },
      } as unknown as CreateBy<NetworkDevice>),
    ).rejects.toThrow(/every table needs a name/);
  });
});
