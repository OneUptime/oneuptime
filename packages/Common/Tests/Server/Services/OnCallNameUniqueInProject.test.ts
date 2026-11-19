import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import { NAME_WHITE_SPACE_RUN_PATTERN } from "../../../Types/Database/UniqueName";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * TWO ON-CALL POLICIES, OR TWO ON-CALL SCHEDULES, OF A PROJECT NEVER SHARE
 * A NAME (#9742), as two teams never do (#9674).
 *
 * Each is picked by its name alone - an escalation rule's schedules, an
 * incident or alert on-call rule's policies, a monitor criteria's
 * policies, a workflow that pages a policy, Readiness, the Schedule
 * Timeline, the Slack and Microsoft Teams commands - so two schedules
 * called "Primary" could not be told apart in any of them. Both services
 * now refuse, from their unique-check hooks, once the caller may make the
 * write, through the helper teams and labels use (UniqueNameInProject):
 *
 *   - a new one named as another of its project is named, however either
 *     is written (case, spaces, the kind of space);
 *   - a rename onto such a name;
 *   - one update that would give several of them one name;
 *   - for a policy, a name an archived policy has, with where to unarchive
 *     it - and a policy in service is named first when both have it.
 *
 * And let through what must keep working:
 *   - a write that gives one its own name again (an edit of its description
 *     sends the name it has), or its name in another case, so twins that
 *     already exist can still be edited and renamed apart;
 *   - an update that does not write the name;
 *   - OneUptime's own writes.
 *
 * The other record is looked for as OneUptime: one the caller may not read
 * holds its name all the same. The hooks are reached through a structural
 * cast; the reads they make are stubbed and recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RECORD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SECOND_RECORD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CLASHING_RECORD_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const MEMBER_PROPS: Record<string, unknown> = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

interface Hooks<TBaseModel extends BaseModel> {
  onBeforeCreateUniqueCheck: (createBy: CreateBy<TBaseModel>) => Promise<void>;
  onBeforeUpdateUniqueCheck: (updateBy: UpdateBy<TBaseModel>) => Promise<void>;
}

interface RawOperator {
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
}

interface RecordedFind {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort?: Record<string, unknown>;
  props: Record<string, unknown>;
}

// One kind held to the rule: its service, its model and its words.
interface Kind {
  title: string;
  table: string;
  service: Record<string, unknown>;
  makeModel: () => BaseModel;
  takenRefusal: (name: string) => string;
  renamedTogetherRefusal: string;
}

const POLICY: Kind = {
  title: "an on-call policy",
  table: "OnCallDutyPolicy",
  service: OnCallDutyPolicyService as unknown as Record<string, unknown>,
  makeModel: (): BaseModel => {
    return new OnCallDutyPolicy();
  },
  takenRefusal: (name: string): string => {
    return `There is already an on-call policy called ${name} in this project. Pick another name.`;
  },
  renamedTogetherRefusal:
    "Several on-call policies cannot be given one name. Rename one policy at a time.",
};

const SCHEDULE: Kind = {
  title: "an on-call schedule",
  table: "OnCallDutyPolicySchedule",
  service: OnCallDutyPolicyScheduleService as unknown as Record<
    string,
    unknown
  >,
  makeModel: (): BaseModel => {
    return new OnCallDutyPolicySchedule();
  },
  takenRefusal: (name: string): string => {
    return `There is already an on-call schedule called ${name} in this project. Pick another name.`;
  },
  renamedTogetherRefusal:
    "Several on-call schedules cannot be given one name. Rename one schedule at a time.",
};

function hooksOf(kind: Kind): Hooks<BaseModel> {
  return kind.service as unknown as Hooks<BaseModel>;
}

function record(
  kind: Kind,
  data: { id: ObjectID; name: string; isArchived?: boolean },
): BaseModel {
  const model: BaseModel = kind.makeModel();
  const fields: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  model._id = data.id.toString();
  fields["name"] = data.name;
  fields["projectId"] = PROJECT_ID;

  if (data.isArchived !== undefined) {
    fields["isArchived"] = data.isArchived;
  }

  return model;
}

/*
 * The other record the clash check finds - or none - and every find it
 * made, whole: what was asked is what these assert.
 */
function stubClash(kind: Kind, clash: BaseModel | null): Array<RecordedFind> {
  const finds: Array<RecordedFind> = [];

  getJestSpyOn(kind.service, "findOneBy").mockImplementation(
    async (findOneBy: RecordedFind): Promise<BaseModel | null> => {
      finds.push(findOneBy);
      return clash;
    },
  );

  return finds;
}

// The records the update writes, as the update path reads them.
function stubRowsWritten(
  kind: Kind,
  rows: Array<BaseModel>,
): ReturnType<typeof getJestSpyOn> {
  return getJestSpyOn(
    kind.service,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue(rows);
}

function create(
  kind: Kind,
  data: Record<string, unknown>,
  props?: Record<string, unknown>,
): Promise<void> {
  const model: BaseModel = kind.makeModel();
  Object.assign(model, data);

  return hooksOf(kind).onBeforeCreateUniqueCheck({
    data: model,
    props: props || MEMBER_PROPS,
  } as unknown as CreateBy<BaseModel>);
}

function update(
  kind: Kind,
  data: Record<string, unknown>,
  props?: Record<string, unknown>,
): Promise<void> {
  return hooksOf(kind).onBeforeUpdateUniqueCheck({
    query: { _id: RECORD_ID.toString() },
    data: data,
    props: props || MEMBER_PROPS,
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<BaseModel>);
}

async function refusal(write: Promise<void>): Promise<string> {
  try {
    await write;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the write to be refused.");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([POLICY, SCHEDULE])("$title", (kind: Kind) => {
  describe("created", () => {
    test("with another one's name is refused, with the name it was given", async () => {
      const finds: Array<RecordedFind> = stubClash(
        kind,
        record(kind, { id: CLASHING_RECORD_ID, name: "Primary" }),
      );

      expect(
        await refusal(
          create(kind, { name: "  primary ", projectId: PROJECT_ID }),
        ),
      ).toBe(kind.takenRefusal("primary"));
      expect(finds).toHaveLength(1);
    });

    test("is compared in its own project, as it reads, as OneUptime", async () => {
      const finds: Array<RecordedFind> = stubClash(kind, null);

      await create(kind, { name: "Platform  Primary", projectId: PROJECT_ID });

      expect(finds).toHaveLength(1);
      const find: RecordedFind = finds[0]!;

      expect(find.query["projectId"]).toEqual(PROJECT_ID);
      expect(find.query["_id"]).toBeUndefined();
      expect(find.props).toEqual({ isRoot: true });

      const operator: RawOperator = find.query["name"] as RawOperator;

      expect(operator.getSql(`"${kind.table}"."name"`)).toContain(
        `LOWER(BTRIM(REGEXP_REPLACE("${kind.table}"."name"`,
      );
      expect(Object.values(operator.objectLiteralParameters)).toEqual([
        "Platform  Primary",
        NAME_WHITE_SPACE_RUN_PATTERN,
      ]);
    });

    test("with a name nothing else has is let through", async () => {
      stubClash(kind, null);

      await expect(
        create(kind, { name: "Primary", projectId: PROJECT_ID }),
      ).resolves.toBeUndefined();
    });

    test("named only by the request's project is compared there", async () => {
      const finds: Array<RecordedFind> = stubClash(kind, null);

      await create(kind, { name: "Primary" });

      expect(finds[0]!.query["projectId"]).toEqual(PROJECT_ID);
    });

    test("with no name leaves it to the required check, and reads nothing", async () => {
      const finds: Array<RecordedFind> = stubClash(
        kind,
        record(kind, { id: CLASHING_RECORD_ID, name: "Primary" }),
      );

      await create(kind, { name: "   ", projectId: PROJECT_ID });
      await create(kind, { projectId: PROJECT_ID });

      expect(finds).toHaveLength(0);
    });

    test("by OneUptime itself is trusted", async () => {
      const finds: Array<RecordedFind> = stubClash(
        kind,
        record(kind, { id: CLASHING_RECORD_ID, name: "Primary" }),
      );

      await create(
        kind,
        { name: "Primary", projectId: PROJECT_ID },
        { isRoot: true },
      );

      expect(finds).toHaveLength(0);
    });

    test("by a master admin is held to the rule like anyone's", async () => {
      stubClash(
        kind,
        record(kind, { id: CLASHING_RECORD_ID, name: "Primary" }),
      );

      expect(
        await refusal(
          create(
            kind,
            { name: "Primary", projectId: PROJECT_ID },
            { isMasterAdmin: true, userId: USER_ID },
          ),
        ),
      ).toBe(kind.takenRefusal("Primary"));
    });
  });

  describe("renamed", () => {
    test("onto another one's name is refused, compared with every other of the project", async () => {
      stubRowsWritten(kind, [
        record(kind, { id: RECORD_ID, name: "Secondary" }),
      ]);
      const finds: Array<RecordedFind> = stubClash(
        kind,
        record(kind, { id: CLASHING_RECORD_ID, name: "Primary" }),
      );

      expect(await refusal(update(kind, { name: "PRIMARY" }))).toBe(
        kind.takenRefusal("PRIMARY"),
      );

      const find: RecordedFind = finds[0]!;
      const notItself: RawOperator = find.query["_id"] as RawOperator;

      expect(find.query["projectId"]).toEqual(PROJECT_ID);
      expect(notItself.getSql(`"${kind.table}"."_id"`)).toContain("!=");
      expect(Object.values(notItself.objectLiteralParameters)).toEqual([
        RECORD_ID.toString(),
      ]);
      expect(find.props).toEqual({ isRoot: true });
    });

    test("to a name nothing else has is let through", async () => {
      stubRowsWritten(kind, [
        record(kind, { id: RECORD_ID, name: "Secondary" }),
      ]);
      stubClash(kind, null);

      await expect(
        update(kind, { name: "Secondary Weekend" }),
      ).resolves.toBeUndefined();
    });

    test.each([
      ["the same name", "Primary"],
      ["its name in another case", "PRIMARY"],
      ["its name with other spaces", " Primary  "],
    ])(
      "with %s is no rename: never refused, though another shares the name",
      async (_label: string, name: string) => {
        stubRowsWritten(kind, [
          record(kind, { id: RECORD_ID, name: "Primary" }),
        ]);
        const finds: Array<RecordedFind> = stubClash(
          kind,
          record(kind, { id: CLASHING_RECORD_ID, name: "Primary" }),
        );

        await expect(
          update(kind, { name: name, description: "Weekdays." }),
        ).resolves.toBeUndefined();
        expect(finds).toHaveLength(0);
      },
    );

    test("an edit that does not write the name reads nothing", async () => {
      const rows: ReturnType<typeof getJestSpyOn> = stubRowsWritten(kind, [
        record(kind, { id: RECORD_ID, name: "Primary" }),
      ]);
      const finds: Array<RecordedFind> = stubClash(kind, null);

      await update(kind, { description: "Weekdays." });

      expect(rows).not.toHaveBeenCalled();
      expect(finds).toHaveLength(0);
    });

    test("one update giving several one name is refused", async () => {
      stubRowsWritten(kind, [
        record(kind, { id: RECORD_ID, name: "Primary" }),
        record(kind, { id: SECOND_RECORD_ID, name: "Secondary" }),
      ]);
      const finds: Array<RecordedFind> = stubClash(kind, null);

      expect(await refusal(update(kind, { name: "Shared" }))).toBe(
        kind.renamedTogetherRefusal,
      );
      expect(finds).toHaveLength(0);
    });

    test("by OneUptime itself is trusted", async () => {
      const rows: ReturnType<typeof getJestSpyOn> = stubRowsWritten(kind, [
        record(kind, { id: RECORD_ID, name: "Secondary" }),
      ]);
      const finds: Array<RecordedFind> = stubClash(
        kind,
        record(kind, { id: CLASHING_RECORD_ID, name: "Primary" }),
      );

      await update(kind, { name: "Primary" }, { isRoot: true });

      expect(rows).not.toHaveBeenCalled();
      expect(finds).toHaveLength(0);
    });

    test("of a record the caller may not write reads no clash: the update writes nothing", async () => {
      stubRowsWritten(kind, []);
      const finds: Array<RecordedFind> = stubClash(
        kind,
        record(kind, { id: CLASHING_RECORD_ID, name: "Primary" }),
      );

      await update(kind, { name: "Primary" });

      expect(finds).toHaveLength(0);
    });
  });
});

describe("an archived on-call policy keeps its name", () => {
  const ARCHIVED_REFUSAL: string =
    "There is already an archived on-call policy called Primary in this project. Unarchive it from On-Call > Advanced > Archived Policies, or pick another name.";

  test("a new policy named as an archived one is told where to unarchive it", async () => {
    stubClash(
      POLICY,
      record(POLICY, {
        id: CLASHING_RECORD_ID,
        name: "Primary",
        isArchived: true,
      }),
    );

    expect(
      await refusal(
        create(POLICY, { name: " Primary ", projectId: PROJECT_ID }),
      ),
    ).toBe(ARCHIVED_REFUSAL);
  });

  test("so is a policy renamed onto an archived one's name", async () => {
    stubRowsWritten(POLICY, [
      record(POLICY, { id: RECORD_ID, name: "Secondary" }),
    ]);
    stubClash(
      POLICY,
      record(POLICY, {
        id: CLASHING_RECORD_ID,
        name: "Primary",
        isArchived: true,
      }),
    );

    expect(await refusal(update(POLICY, { name: "Primary" }))).toBe(
      ARCHIVED_REFUSAL,
    );
  });

  test("a policy in service with the name is the one the refusal speaks of", async () => {
    const finds: Array<RecordedFind> = stubClash(
      POLICY,
      record(POLICY, {
        id: CLASHING_RECORD_ID,
        name: "Primary",
        isArchived: false,
      }),
    );

    expect(
      await refusal(create(POLICY, { name: "Primary", projectId: PROJECT_ID })),
    ).toBe(POLICY.takenRefusal("Primary"));

    // Read with whether it is archived, a policy in service first.
    expect(finds[0]!.select).toEqual({ isArchived: true, _id: true });
    expect(finds[0]!.sort).toEqual({ isArchived: SortOrder.Ascending });
  });

  test("a schedule has no archive: its clash is read by id alone, in no order", async () => {
    const finds: Array<RecordedFind> = stubClash(SCHEDULE, null);

    await create(SCHEDULE, { name: "Primary", projectId: PROJECT_ID });

    expect(finds[0]!.select).toEqual({ _id: true });
    expect(finds[0]!.sort).toBeUndefined();
  });
});
