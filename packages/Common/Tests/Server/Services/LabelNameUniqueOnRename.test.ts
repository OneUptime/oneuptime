import LabelService from "../../../Server/Services/LabelService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ArchivableValueGuard from "../../../Server/Utils/Database/ArchivableValueGuard";
import Label from "../../../Models/DatabaseModels/Label";
import BadDataException from "../../../Types/Exception/BadDataException";
import { NAME_WHITE_SPACE_RUN_PATTERN } from "../../../Types/Database/UniqueName";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A LABEL'S NAME IS ONE LABEL'S, ON A RENAME TOO (#9674).
 *
 * A new label was refused a name another label of the project had, and a
 * renamed one was not: two labels could both read "Production" in every
 * label picker, filter and permission, each with records of its own. A
 * rename is now held to the rule a create is, once the caller may make it
 * (LabelService.onBeforeUpdateUniqueCheck, UniqueNameInProject):
 *
 *   - onto another label's name, however either is written, refused with
 *     the name and what to do next;
 *   - onto an archived label's name, refused with where to unarchive that
 *     one, as a new label named so is;
 *   - a label written with its own name again - its colour changed, its
 *     name in another case - is no rename.
 *
 * And a create says the same words, comparing names the same way.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LABEL_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_LABEL_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

// A spy, as getJestSpyOn hands it back.
type Spy = ReturnType<typeof getJestSpyOn>;

interface Hooks {
  onBeforeUpdateUniqueCheck: (updateBy: UpdateBy<Label>) => Promise<void>;
  onBeforeCreate: (createBy: CreateBy<Label>) => Promise<OnCreate<Label>>;
}

const hooks: Hooks = LabelService as unknown as Hooks;

interface RawOperator {
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
}

interface RecordedRead {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
  props: Record<string, unknown>;
}

function label(data: {
  id: ObjectID;
  name: string;
  isArchived?: boolean;
}): Label {
  const model: Label = new Label();
  model._id = data.id.toString();
  model.name = data.name;
  model.projectId = PROJECT_ID;

  if (data.isArchived !== undefined) {
    (model as unknown as { isArchived: boolean }).isArchived = data.isArchived;
  }

  return model;
}

function stubRowsWritten(rows: Array<Label>): Spy {
  return getJestSpyOn(
    LabelService,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue(rows);
}

function stubClash(clash: Label | null): Array<RecordedRead> {
  const reads: Array<RecordedRead> = [];

  getJestSpyOn(LabelService, "findOneBy").mockImplementation(
    async (findOneBy: RecordedRead): Promise<Label | null> => {
      reads.push(findOneBy);
      return clash;
    },
  );

  return reads;
}

function rename(
  data: Record<string, unknown>,
  props?: Record<string, unknown>,
): Promise<void> {
  return hooks.onBeforeUpdateUniqueCheck({
    query: { _id: LABEL_ID.toString() },
    data: data,
    props: props || { userId: USER_ID, tenantId: PROJECT_ID },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<Label>);
}

async function refusal(write: Promise<unknown>): Promise<string> {
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

describe("renaming a label", () => {
  test("onto another label's name is refused, with the name and what to do next", async () => {
    stubRowsWritten([label({ id: LABEL_ID, name: "Staging" })]);
    const reads: Array<RecordedRead> = stubClash(
      label({ id: OTHER_LABEL_ID, name: "Production", isArchived: false }),
    );

    expect(await refusal(rename({ name: "production " }))).toBe(
      "There is already a label called production in this project. Pick another name.",
    );

    const read: RecordedRead = reads[0]!;

    expect(read.query["projectId"]).toEqual(PROJECT_ID);
    expect(read.props).toEqual({ isRoot: true });
    expect(read.select).toEqual({ isArchived: true, _id: true });
    expect(
      Object.values((read.query["_id"] as RawOperator).objectLiteralParameters),
    ).toEqual([LABEL_ID.toString()]);
    expect(
      Object.values(
        (read.query["name"] as RawOperator).objectLiteralParameters,
      ),
    ).toEqual(["production ", NAME_WHITE_SPACE_RUN_PATTERN]);
  });

  test("onto an archived label's name says where to unarchive that one", async () => {
    stubRowsWritten([label({ id: LABEL_ID, name: "Staging" })]);
    stubClash(
      label({ id: OTHER_LABEL_ID, name: "Production", isArchived: true }),
    );

    expect(await refusal(rename({ name: "Production" }))).toBe(
      'An archived label is already called "Production". Unarchive it in Project Settings > Labels, or choose another name.',
    );
  });

  test("to a name no other label has is let through", async () => {
    stubRowsWritten([label({ id: LABEL_ID, name: "Staging" })]);
    stubClash(null);

    await expect(rename({ name: "QA" })).resolves.toBeUndefined();
  });

  test.each([["Staging"], ["STAGING"], ["  staging "]])(
    "written with its own name again (%j) is no rename",
    async (name: string) => {
      stubRowsWritten([label({ id: LABEL_ID, name: "Staging" })]);
      const reads: Array<RecordedRead> = stubClash(
        label({ id: OTHER_LABEL_ID, name: "Staging" }),
      );

      await rename({ name: name, color: "#ff0000" });

      expect(reads).toHaveLength(0);
    },
  );

  test("an edit of its colour alone reads nothing", async () => {
    const rows: Spy = stubRowsWritten([
      label({ id: LABEL_ID, name: "Staging" }),
    ]);

    await rename({ color: "#ff0000" });

    expect(rows).not.toHaveBeenCalled();
  });

  test("one update giving several labels one name is refused", async () => {
    stubRowsWritten([
      label({ id: LABEL_ID, name: "Staging" }),
      label({ id: OTHER_LABEL_ID, name: "QA" }),
    ]);
    stubClash(null);

    expect(await refusal(rename({ name: "Shared" }))).toBe(
      "Several labels cannot be given one name. Rename one label at a time.",
    );
  });
});

describe("creating a label", () => {
  function create(name: string): Promise<OnCreate<Label>> {
    const model: Label = new Label();
    model.name = name;
    model.projectId = PROJECT_ID;

    return hooks.onBeforeCreate({
      data: model,
      props: { userId: USER_ID, tenantId: PROJECT_ID },
    } as unknown as CreateBy<Label>);
  }

  test("named as another label is refused in the same words a rename is", async () => {
    getJestSpyOn(ArchivableValueGuard, "beforeCreate").mockResolvedValue(
      undefined,
    );
    const count: Spy = getJestSpyOn(LabelService, "countBy").mockResolvedValue(
      new PositiveNumber(1),
    );

    expect(await refusal(create("Production  "))).toBe(
      "There is already a label called Production in this project. Pick another name.",
    );

    // Compared as it reads: whatever its case and spacing.
    const asked: RecordedRead = count.mock.calls[0]![0] as RecordedRead;

    expect(asked.query["projectId"]).toEqual(PROJECT_ID);
    expect(
      Object.values(
        (asked.query["name"] as RawOperator).objectLiteralParameters,
      ),
    ).toEqual(["Production  ", NAME_WHITE_SPACE_RUN_PATTERN]);
    expect(asked.props).toEqual({ isRoot: true });
  });

  test("with a name no label has is let through", async () => {
    getJestSpyOn(ArchivableValueGuard, "beforeCreate").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(LabelService, "countBy").mockResolvedValue(
      new PositiveNumber(0),
    );

    await expect(create("Production")).resolves.toBeDefined();
  });
});

describe("a label telemetry names", () => {
  test("is looked up as a create compares names, so a label spelled another way is the one used", async () => {
    const reads: Array<RecordedRead> = [];

    getJestSpyOn(LabelService, "findOneBy").mockImplementation(
      async (findOneBy: RecordedRead): Promise<Label | null> => {
        reads.push(findOneBy);
        return label({ id: OTHER_LABEL_ID, name: "Production" });
      },
    );

    const internals: {
      findOrCreateLabelByName: (
        projectId: ObjectID,
        name: string,
      ) => Promise<ObjectID | null>;
    } = LabelService as unknown as {
      findOrCreateLabelByName: (
        projectId: ObjectID,
        name: string,
      ) => Promise<ObjectID | null>;
    };

    const id: ObjectID | null = await internals.findOrCreateLabelByName.call(
      LabelService,
      PROJECT_ID,
      "production",
    );

    expect(id?.toString()).toBe(OTHER_LABEL_ID.toString());
    expect(
      Object.values(
        (reads[0]!.query["name"] as RawOperator).objectLiteralParameters,
      ),
    ).toEqual(["production", NAME_WHITE_SPACE_RUN_PATTERN]);
  });
});
