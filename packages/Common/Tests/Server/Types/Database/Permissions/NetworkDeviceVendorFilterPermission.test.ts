import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EndsWith from "../../../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../../../Types/BaseDatabase/EqualTo";
import IsNull from "../../../../../Types/BaseDatabase/IsNull";
import NotContains from "../../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import StartsWith from "../../../../../Types/BaseDatabase/StartsWith";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS } from "../../../../../Utils/NetworkDevice/NetworkDeviceStoredManufacturer";
import {
  getLabelsKeptTo,
  withLabelJoinTables,
} from "../../../TestingUtils/LabelJoinTables";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * THE VENDOR FILTER AND SORT READ ONLY WHAT THEIR READER MAY READ (OneUptime
 * issue #9363).
 *
 * The Devices, Archived and site lists filter and sort devices by the maker
 * their Vendor column shows, which the server keeps in
 * NetworkDevice.manufacturer, worked out from the device's vendor, SNMP
 * identity and discovered details. Which devices a filter matches, and
 * where each falls in an order, says what that maker is - one guess at a
 * time - so both are held to the read of the column, as every filter and
 * sort is (QueryPermission, SortValidator.checkSortPermission). Through the
 * read check every list read goes through, with no database:
 *
 *   - every reader of a device may filter and sort by it, with each text
 *     operator the chip offers;
 *   - a caller who may not read devices cannot - a filter or an order of a
 *     list they may not read is refused, never answered with no rows;
 *   - a reader whose read is blocked cannot either;
 *   - a reader limited to some labels has the filter answered over the
 *     devices with those labels only;
 *   - nobody may read the maker who may not read every column it is worked
 *     out from, so the filter tells no reader more than the device does.
 */

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const CUSTOMER_A: ObjectID = ObjectID.generate();

function rowOf(
  permission: Permission,
  data: { labelIds?: Array<ObjectID>; isBlock?: boolean } = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: Boolean(data.isBlock),
  };
}

// A signed-in person holding exactly `rows` in the project.
function personWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  };
}

// What the Vendor chip sends, one operator each.
const VENDOR_FILTERS: Array<[string, unknown]> = [
  ["contains", new Search("sunnovo")],
  ["does not contain", new NotContains("sunnovo")],
  ["is", new EqualTo("Sunnovo International")],
  ["is not", new NotEqual("Sunnovo International")],
  ["starts with", new StartsWith("sun")],
  ["ends with", new EndsWith("national")],
  ["is empty", new IsNull()],
  ["is not empty", new NotNull()],
];

async function readCheck(data: {
  props: DatabaseCommonInteractionProps;
  query?: Record<string, unknown> | undefined;
  sort?: unknown;
}): Promise<CheckReadPermissionType<BaseModel>> {
  return await ModelPermission.checkReadQueryPermission<BaseModel>(
    NetworkDevice as unknown as { new (): BaseModel },
    { projectId: PROJECT_ID, ...(data.query || {}) } as Query<BaseModel>,
    { _id: true, name: true } as Select<BaseModel>,
    data.props,
    data.sort,
  );
}

async function refusalOf(data: {
  props: DatabaseCommonInteractionProps;
  query?: Record<string, unknown> | undefined;
  sort?: unknown;
}): Promise<Error | null> {
  try {
    await readCheck(data);
    return null;
  } catch (error) {
    return error as Error;
  }
}

/*
 * The Vendor filter as the read hands it to the database: the ILIKE the
 * text filters all write, on the maker's column, with what was typed.
 */
function vendorConditionOf(query: unknown): {
  sql: string;
  parameters: Array<unknown>;
} {
  const condition: unknown = (query as Record<string, unknown>)["manufacturer"];

  expect(condition).toBeInstanceOf(FindOperator);

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return {
    sql: operator.getSql
      ? operator.getSql('"NetworkDevice"."manufacturer"')
      : "",
    parameters: Object.values(operator.objectLiteralParameters || {}),
  };
}

const TABLE_READERS: Array<Permission> =
  new NetworkDevice().getReadPermissions() || [];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every reader of a device may filter and sort by the maker it is listed under", () => {
  test("the table's readers are the ones the lists are shown to", () => {
    expect(TABLE_READERS).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadNetworkDevice,
      ]),
    );
  });

  for (const permission of TABLE_READERS) {
    test.each(VENDOR_FILTERS)(
      `${permission}: the Vendor filter "%s"`,
      async (_operator: string, filter: unknown) => {
        expect(
          await refusalOf({
            props: personWith([rowOf(permission)]),
            query: { manufacturer: filter },
          }),
        ).toBeNull();
      },
    );

    test(`${permission}: the Vendor / Model column's sort, both ways`, async () => {
      for (const order of [SortOrder.Ascending, SortOrder.Descending]) {
        expect(
          await refusalOf({
            props: personWith([rowOf(permission)]),
            sort: { manufacturer: order },
          }),
        ).toBeNull();
      }
    });
  }

  test("the filter reaches the database as it was given, beside the project", async () => {
    const result: CheckReadPermissionType<BaseModel> = await readCheck({
      props: personWith([rowOf(Permission.ReadNetworkDevice)]),
      query: { manufacturer: new Search("sunnovo") },
    });

    const condition: { sql: string; parameters: Array<unknown> } =
      vendorConditionOf(result.query);

    expect(condition.sql).toContain(
      'CAST("NetworkDevice"."manufacturer" AS TEXT) ILIKE :',
    );
    expect(condition.parameters).toEqual(["%sunnovo%"]);
  });
});

describe("a caller who may not read devices learns nothing from the filter", () => {
  const NOT_READERS: Array<[string, Array<UserPermission>]> = [
    ["a member with no permission at all", []],
    [
      "a member who may read incidents only",
      [rowOf(Permission.ReadProjectIncident)],
    ],
    [
      "a member who may create devices but not read them",
      [rowOf(Permission.CreateNetworkDevice)],
    ],
  ];

  test.each(NOT_READERS)(
    "%s: the Vendor filter is refused",
    async (_name: string, rows: Array<UserPermission>) => {
      for (const [, filter] of VENDOR_FILTERS) {
        expect(
          await refusalOf({
            props: personWith(rows),
            query: { manufacturer: filter },
          }),
        ).toBeInstanceOf(NotAuthorizedException);
      }
    },
  );

  test.each(NOT_READERS)(
    "%s: the sort by it is refused",
    async (_name: string, rows: Array<UserPermission>) => {
      expect(
        await refusalOf({
          props: personWith(rows),
          sort: { manufacturer: SortOrder.Ascending },
        }),
      ).toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("a reader whose read of devices is blocked is refused it too", async () => {
    expect(
      await refusalOf({
        props: personWith([
          rowOf(Permission.ReadNetworkDevice),
          rowOf(Permission.ReadNetworkDevice, { isBlock: true }),
        ]),
        query: { manufacturer: new Search("sunnovo") },
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("an anonymous caller is refused", async () => {
    expect(
      await refusalOf({
        props: {},
        query: { manufacturer: new Search("sunnovo") },
      }),
    ).toBeInstanceOf(Error);
  });
});

describe("a reader limited to some labels", () => {
  test("has the filter answered over the devices with those labels only", async () => {
    withLabelJoinTables();

    const result: CheckReadPermissionType<BaseModel> = await readCheck({
      props: personWith([
        rowOf(Permission.ReadNetworkDevice, { labelIds: [CUSTOMER_A] }),
      ]),
      query: { manufacturer: new Search("sunnovo") },
      sort: { manufacturer: SortOrder.Ascending },
    });

    expect(vendorConditionOf(result.query).parameters).toEqual(["%sunnovo%"]);
    expect(
      getLabelsKeptTo(
        NetworkDevice as unknown as { new (): BaseModel },
        result.query,
      ),
    ).toEqual([CUSTOMER_A.toString()]);
  });
});

describe("the maker tells no reader more than the device does", () => {
  test("whoever may read it may read every column it is worked out from", () => {
    const model: NetworkDevice = new NetworkDevice();
    const readers: Array<Permission> =
      model.getColumnAccessControlFor("manufacturer")?.read || [];

    expect(readers.length).toBeGreaterThan(0);

    for (const column of NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS) {
      const columnReaders: Array<Permission> =
        model.getColumnAccessControlFor(column)?.read ||
        model.getReadPermissions() ||
        [];

      for (const reader of readers) {
        expect([column, reader, columnReaders.includes(reader)]).toEqual([
          column,
          reader,
          true,
        ]);
      }
    }
  });
});
