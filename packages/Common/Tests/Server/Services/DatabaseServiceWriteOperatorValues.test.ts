import ProbeService from "../../../Server/Services/ProbeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "../../../Models/DatabaseModels/Probe";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Query operators belong in the `query` of a read/update, never in the `data`
 * of a write. A request value shaped like a serialized operator, e.g.
 * {"_type":"StartsWith","value":"a"} or {"_type":"NotNull"}, becomes a real
 * operator instance: JSONFunctions.deserialize runs on every request body while
 * DatabaseBaseModel._fromJSON builds the model, and the operator is assigned to
 * the column unchanged.
 *
 * An operator is never a valid stored value, and one left on a write payload is
 * also fed to the lookups built from that data (the uniqueness check, service
 * hooks), where it turns an intended exact comparison into a pattern match.
 * DatabaseService rejects such a write up front, before any hook or query runs.
 * JSON columns are exempt - they legitimately hold arbitrary objects.
 *
 * The first two tests document the deserialization behaviour, which is
 * unchanged; the last two pin the rejection and that ordinary writes still pass.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000000a",
);

const memberProps: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: new ObjectID("00000000-0000-4000-8000-000000000003"),
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Query operators supplied as write values", () => {
  test("request body value {_type:StartsWith} deserializes into a StartsWith on a text column", () => {
    const body: JSONObject = {
      key: { _type: "StartsWith", value: "a" } as unknown as JSONObject,
      name: "a probe",
    };

    const probe: Probe = BaseModel.fromJSON<Probe>(body, Probe) as Probe;

    expect(probe.key).toBeInstanceOf(StartsWith);
    expect((probe.key as unknown as StartsWith<string>).toString()).toBe("a");
  });

  test("request body value {_type:NotNull} deserializes into a NotNull operator", () => {
    const body: JSONObject = {
      key: { _type: "NotNull" } as unknown as JSONObject,
    };

    const probe: Probe = BaseModel.fromJSON<Probe>(body, Probe) as Probe;
    expect(probe.key).toBeInstanceOf(NotNull);
  });

  test("DatabaseService.create rejects an operator in write data before any lookup", async () => {
    /*
     * If the check regresses, the uniqueness check would run its countBy with
     * the operator in the query; make that fail loudly instead.
     */
    const countSpy: jest.SpyInstance = jest
      .spyOn(ProbeService, "countBy")
      .mockImplementation((() => {
        throw new Error("countBy must not run for an operator-carrying create");
      }) as never) as unknown as jest.SpyInstance;
    const hookSpy: jest.SpyInstance = jest.spyOn(
      ProbeService,
      "onBeforeCreate" as never,
    ) as unknown as jest.SpyInstance;

    const probe: Probe = new Probe();
    (probe as unknown as { key: unknown }).key = new StartsWith("a");
    probe.name = "a probe";

    const createBy: CreateBy<Probe> = {
      data: probe,
      props: memberProps([Permission.CreateProjectProbe]),
    };

    await expect(ProbeService.create(createBy)).rejects.toBeInstanceOf(
      BadDataException,
    );
    expect(hookSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
  });

  test("the operator check leaves an ordinary create untouched", () => {
    /*
     * The check must refuse operators without touching plain values. Call it
     * directly - it is the choke point create()/update() run - and assert a
     * normal payload passes while an operator is refused.
     */
    const legit: Probe = new Probe();
    legit.key = "a-real-plaintext-key";
    legit.name = "a probe";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: any = ProbeService as any;
    expect(() => {
      service.rejectQueryOperatorsInData(legit);
    }).not.toThrow();

    const withOperator: Probe = new Probe();
    (withOperator as unknown as { key: unknown }).key = new StartsWith("a");
    expect(() => {
      service.rejectQueryOperatorsInData(withOperator);
    }).toThrow(BadDataException);
  });
});
