import Label from "../../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import RuleRecordScope from "../../../../Server/Utils/Rules/RuleRecordScope";
import ObjectID from "../../../../Types/ObjectID";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * RuleRecordScope is what an engine copies a rule's records through - a
 * grouping rule's on-call policies and episode labels onto each episode it
 * opens: only the project's own, read pinned to the project, the others
 * logged by id, and nothing at all when the read fails.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OWN_POLICY: string = "0000000c-0000-4000-8000-000000000001";
const SECOND_OWN_POLICY: string = "0000000c-0000-4000-8000-000000000002";
const FOREIGN_POLICY: string = "0000000c-0000-4000-8000-0000000000ff";

function policy(id: string): OnCallDutyPolicy {
  const item: OnCallDutyPolicy = new OnCallDutyPolicy();
  item._id = id;
  return item;
}

function idsOf(records: Array<OnCallDutyPolicy>): Array<string> {
  return records.map((record: OnCallDutyPolicy): string => {
    return record._id!.toString();
  });
}

describe("RuleRecordScope.keepRecordsInProject", () => {
  let directory: ProjectDirectoryStub;
  let warnings: Array<string>;
  let errors: Array<string>;

  beforeEach(() => {
    directory = stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { OnCallDutyPolicy: [OWN_POLICY, SECOND_OWN_POLICY] },
    });

    warnings = [];
    errors = [];

    jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
      warnings.push(String(message));
    }) as never);
    jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
      errors.push(String(message));
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function keep(
    records: Array<OnCallDutyPolicy> | undefined,
  ): Promise<Array<OnCallDutyPolicy>> {
    return RuleRecordScope.keepRecordsInProject({
      projectId: PROJECT_ID,
      records: records,
      modelType: OnCallDutyPolicy,
      description: "on-call policies of grouping rule Payments storms",
      logAttributes: { projectId: PROJECT_ID.toString() },
    });
  }

  test("keeps the project's own records in the order given, read once pinned to the project", async () => {
    const kept: Array<OnCallDutyPolicy> = await keep([
      policy(SECOND_OWN_POLICY),
      policy(FOREIGN_POLICY),
      policy(OWN_POLICY),
    ]);

    expect(idsOf(kept)).toEqual([SECOND_OWN_POLICY, OWN_POLICY]);
    expect(directory.recordLookups).toEqual([
      {
        model: "OnCallDutyPolicy",
        projectId: PROJECT_ID.toString(),
        ids: [SECOND_OWN_POLICY, FOREIGN_POLICY, OWN_POLICY],
      },
    ]);
  });

  test("says which records it left out, by id", async () => {
    await keep([policy(OWN_POLICY), policy(FOREIGN_POLICY)]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`"${FOREIGN_POLICY}"`);
    expect(warnings[0]).toContain("Payments storms");
    expect(warnings[0]).not.toContain(`"${OWN_POLICY}"`);
  });

  test("keeps the record objects as they were handed over", async () => {
    const own: OnCallDutyPolicy = policy(OWN_POLICY);

    const kept: Array<OnCallDutyPolicy> = await keep([own]);

    expect(kept[0]).toBe(own);
    expect(warnings).toEqual([]);
  });

  test("copies nothing when the read fails, and says so instead of throwing", async () => {
    jest
      .spyOn(ProjectScopedReferenceValidator, "findIdsInProject")
      .mockRejectedValue(new Error("Database is down") as never);

    await expect(keep([policy(OWN_POLICY)])).resolves.toEqual([]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("none were copied");
  });

  test("asks nothing for an empty or missing list", async () => {
    await expect(keep(undefined)).resolves.toEqual([]);
    await expect(keep([])).resolves.toEqual([]);

    expect(directory.recordLookups).toEqual([]);
  });

  test("works for any project-scoped model the rule names", async () => {
    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { Label: [OWN_POLICY] },
    });

    const own: Label = new Label();
    own._id = OWN_POLICY;
    const foreign: Label = new Label();
    foreign._id = FOREIGN_POLICY;

    const kept: Array<Label> = await RuleRecordScope.keepRecordsInProject({
      projectId: PROJECT_ID,
      records: [foreign, own],
      modelType: Label,
      description: "episode labels of grouping rule Payments storms",
      logAttributes: { projectId: PROJECT_ID.toString() },
    });

    expect(kept).toEqual([own]);
  });
});

/*
 * keepIdsInProject is the same for engines that hold plain ids - a label
 * rule's labels - except that a read that fails is passed on: the engine
 * reports it as the failure it is, never as a rule with nothing to add.
 */
describe("RuleRecordScope.keepIdsInProject", () => {
  let warnings: Array<string>;

  beforeEach(() => {
    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { Label: [OWN_POLICY, SECOND_OWN_POLICY] },
    });

    warnings = [];

    jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
      warnings.push(String(message));
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function keepIds(ids: Array<string>): Promise<Array<string>> {
    return RuleRecordScope.keepIdsInProject({
      projectId: PROJECT_ID,
      ids: ids,
      modelType: Label,
      description: "labels of host label rules",
      logAttributes: { projectId: PROJECT_ID.toString() },
    });
  }

  test("keeps the project's own ids in the order given, and names the others", async () => {
    expect(
      await keepIds([SECOND_OWN_POLICY, FOREIGN_POLICY, OWN_POLICY]),
    ).toEqual([SECOND_OWN_POLICY, OWN_POLICY]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`"${FOREIGN_POLICY}"`);
    expect(warnings[0]).toContain("labels of host label rules");
  });

  test("passes a failed read on instead of keeping nothing", async () => {
    jest
      .spyOn(ProjectScopedReferenceValidator, "findIdsInProject")
      .mockRejectedValue(new Error("Database is down") as never);

    await expect(keepIds([OWN_POLICY])).rejects.toThrow("Database is down");
  });

  test("asks nothing for no ids", async () => {
    const lookups: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ProjectScopedReferenceValidator,
      "findIdsInProject",
    );

    await expect(keepIds([])).resolves.toEqual([]);
    expect(lookups).not.toHaveBeenCalled();
  });
});
