import IncomingCallLog from "../../../Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "../../../Models/DatabaseModels/IncomingCallLogItem";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallLogItemService from "../../../Server/Services/IncomingCallLogItemService";
import IncomingCallLogService from "../../../Server/Services/IncomingCallLogService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import ReadPermission from "../../../Server/Types/Database/Permissions/ReadPermission";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * EACH ATTEMPT OF A CALL NAMES THE POLICY ITS CALL NAMES.
 *
 * An attempt to reach someone during a call to a policy's number
 * (IncomingCallLogItem) is read with that policy, as the call is
 * (@OwnedThrough("incomingCallPolicyId", IncomingCallPolicy)): a permission
 * scoped to Owned reads the attempts of the calls to the policies its holder
 * or their teams own. So the policy an attempt names is the one its call
 * names, read by OneUptime from the call the attempt is written for - not
 * what the write itself sent: an attempt that named another policy would be
 * read by that policy's owners. Pinned here on the service's own create
 * hook; OwnedRecordsDeletePostgres writes attempts through the real service
 * on Postgres, and reads them through the routes as a member scoped to
 * Owned.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
);
const CALL_ID: ObjectID = new ObjectID("1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f");
const CALLS_POLICY_ID: ObjectID = new ObjectID(
  "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
);
const OTHER_POLICY_ID: ObjectID = new ObjectID(
  "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b",
);

// The service's create hook, as DatabaseService.create calls it.
const onBeforeCreate: (
  createBy: CreateBy<IncomingCallLogItem>,
) => Promise<OnCreate<IncomingCallLogItem>> = (
  createBy: CreateBy<IncomingCallLogItem>,
): Promise<OnCreate<IncomingCallLogItem>> => {
  return (
    IncomingCallLogItemService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<IncomingCallLogItem>,
      ) => Promise<OnCreate<IncomingCallLogItem>>;
    }
  ).onBeforeCreate(createBy);
};

// OneUptime's own write, as a call that rings someone makes it.
const AS_ONEUPTIME: DatabaseCommonInteractionProps = { isRoot: true };

// An attempt of the call `CALL_ID`, as OneUptime writes one.
function attempt(): IncomingCallLogItem {
  const item: IncomingCallLogItem = new IncomingCallLogItem();
  item.projectId = PROJECT_ID;
  item.incomingCallLogId = CALL_ID;

  return item;
}

// The call's read answers with a call to `policyId`, or with none.
function callIsTo(
  policyId: ObjectID | null,
): SpyInstance<typeof IncomingCallLogService.findOneById> {
  return jest
    .spyOn(IncomingCallLogService, "findOneById")
    .mockImplementation((async () => {
      if (!policyId) {
        return null;
      }

      const call: IncomingCallLog = new IncomingCallLog();
      call._id = CALL_ID.toString();
      call.incomingCallPolicyId = policyId;

      return call;
    }) as never);
}

// The policy the attempt names, under each of its names.
function policyNamedBy(item: IncomingCallLogItem): {
  id: string | undefined;
  relation: unknown;
} {
  return {
    id: item.incomingCallPolicyId?.toString(),
    relation: (item as unknown as Record<string, unknown>)[
      "incomingCallPolicy"
    ],
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncomingCallLogItemService: an attempt names its call's policy", () => {
  test("is read with the policy, by the policy it names", () => {
    expect(
      OwnedScopePermission.getOwnedThrough(IncomingCallLogItem),
    ).toMatchObject({
      fkColumn: "incomingCallPolicyId",
      parentModels: [IncomingCallPolicy],
      includeUnattributed: false,
      includeProjectScope: false,
    });
  });

  test("is read by the labels of its call's policy too, as the call is", () => {
    const labelledKeysOf: (modelType: {
      new (): IncomingCallLog | IncomingCallLogItem;
    }) => Array<[string, Array<string>]> = (modelType: {
      new (): IncomingCallLog | IncomingCallLogItem;
    }): Array<[string, Array<string>]> => {
      return ReadPermission.getLabelledReferences(modelType).keys.map(
        (key: {
          column: string;
          modelTypes: Array<{ new (): unknown }>;
        }): [string, Array<string>] => {
          return [
            key.column,
            key.modelTypes.map((labelled: { new (): unknown }): string => {
              return labelled.name;
            }),
          ];
        },
      );
    };

    expect(labelledKeysOf(IncomingCallLogItem)).toContainEqual([
      "incomingCallPolicyId",
      ["IncomingCallPolicy"],
    ]);
    expect(labelledKeysOf(IncomingCallLog)).toContainEqual([
      "incomingCallPolicyId",
      ["IncomingCallPolicy"],
    ]);
  });

  test("an attempt OneUptime writes names the policy its call names, read as OneUptime from that call alone", async () => {
    const read: SpyInstance<typeof IncomingCallLogService.findOneById> =
      callIsTo(CALLS_POLICY_ID);
    const item: IncomingCallLogItem = attempt();

    const onCreate: OnCreate<IncomingCallLogItem> = await onBeforeCreate({
      data: item,
      props: AS_ONEUPTIME,
    });

    expect(policyNamedBy(onCreate.createBy.data)).toEqual({
      id: CALLS_POLICY_ID.toString(),
      relation: undefined,
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({
      id: CALL_ID,
      select: { incomingCallPolicyId: true },
      props: { isRoot: true },
    });
  });

  test("a write naming another policy, by its id or by the relation, names the call's policy instead", async () => {
    for (const named of ["id", "relation", "both"]) {
      callIsTo(CALLS_POLICY_ID);

      const item: IncomingCallLogItem = attempt();

      if (named !== "relation") {
        item.incomingCallPolicyId = OTHER_POLICY_ID;
      }

      if (named !== "id") {
        const policy: IncomingCallPolicy = new IncomingCallPolicy();
        policy._id = OTHER_POLICY_ID.toString();
        item.incomingCallPolicy = policy;
      }

      const onCreate: OnCreate<IncomingCallLogItem> = await onBeforeCreate({
        data: item,
        props: AS_ONEUPTIME,
      });

      expect([named, policyNamedBy(onCreate.createBy.data)]).toEqual([
        named,
        { id: CALLS_POLICY_ID.toString(), relation: undefined },
      ]);

      jest.restoreAllMocks();
    }
  });

  test("the call named by its relation is the call read", async () => {
    const read: SpyInstance<typeof IncomingCallLogService.findOneById> =
      callIsTo(CALLS_POLICY_ID);
    const item: IncomingCallLogItem = new IncomingCallLogItem();
    item.projectId = PROJECT_ID;

    const call: IncomingCallLog = new IncomingCallLog();
    call._id = CALL_ID.toString();
    item.incomingCallLog = call;

    const onCreate: OnCreate<IncomingCallLogItem> = await onBeforeCreate({
      data: item,
      props: AS_ONEUPTIME,
    });

    expect(policyNamedBy(onCreate.createBy.data).id).toBe(
      CALLS_POLICY_ID.toString(),
    );
    expect((read.mock.calls[0]![0] as { id: ObjectID }).id.toString()).toBe(
      CALL_ID.toString(),
    );
  });

  test("an attempt of a call that is not there names no policy, whatever the write sent", async () => {
    callIsTo(null);

    const item: IncomingCallLogItem = attempt();
    item.incomingCallPolicyId = OTHER_POLICY_ID;

    const onCreate: OnCreate<IncomingCallLogItem> = await onBeforeCreate({
      data: item,
      props: AS_ONEUPTIME,
    });

    expect(policyNamedBy(onCreate.createBy.data)).toEqual({
      id: undefined,
      relation: undefined,
    });
  });

  test("a write naming no call names no policy, and reads nothing", async () => {
    const read: SpyInstance<typeof IncomingCallLogService.findOneById> =
      callIsTo(CALLS_POLICY_ID);

    const item: IncomingCallLogItem = new IncomingCallLogItem();
    item.projectId = PROJECT_ID;
    item.incomingCallPolicyId = OTHER_POLICY_ID;

    const onCreate: OnCreate<IncomingCallLogItem> = await onBeforeCreate({
      data: item,
      props: AS_ONEUPTIME,
    });

    expect(policyNamedBy(onCreate.createBy.data).id).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  test("a write naming two different calls is refused before anything is read", async () => {
    const read: SpyInstance<typeof IncomingCallLogService.findOneById> =
      callIsTo(CALLS_POLICY_ID);

    const item: IncomingCallLogItem = attempt();
    const otherCall: IncomingCallLog = new IncomingCallLog();
    otherCall._id = ObjectID.generate().toString();
    item.incomingCallLog = otherCall;

    await expect(
      onBeforeCreate({ data: item, props: AS_ONEUPTIME }),
    ).rejects.toThrow(BadDataException);
    expect(read).not.toHaveBeenCalled();
  });

  test("a write a person makes has its references checked against the project first, then takes its call's policy", async () => {
    const order: Array<string> = [];

    jest
      .spyOn(ProjectReferenceCheck, "validateCreate")
      .mockImplementation((async () => {
        order.push("references checked");
      }) as never);
    jest
      .spyOn(IncomingCallLogService, "findOneById")
      .mockImplementation((async () => {
        order.push("call read");

        const call: IncomingCallLog = new IncomingCallLog();
        call.incomingCallPolicyId = CALLS_POLICY_ID;

        return call;
      }) as never);

    const item: IncomingCallLogItem = attempt();
    item.incomingCallPolicyId = OTHER_POLICY_ID;

    const onCreate: OnCreate<IncomingCallLogItem> = await onBeforeCreate({
      data: item,
      props: {
        userId: ObjectID.generate(),
        tenantId: PROJECT_ID,
      },
    });

    expect(order).toEqual(["references checked", "call read"]);
    expect(policyNamedBy(onCreate.createBy.data).id).toBe(
      CALLS_POLICY_ID.toString(),
    );
  });
});
