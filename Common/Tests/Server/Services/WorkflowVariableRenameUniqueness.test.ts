import WorkflowVariableService from "../../../Server/Services/WorkflowVariableService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Workflow variables became editable from the dashboard, which made renaming a
 * variable possible for the first time. Renaming is the one write that can put
 * two rows with the same name in the same scope:
 *
 *   - @UniqueColumnBy(["workflowId", "projectId"]) on `name` is enforced by
 *     DatabaseService.checkUniqueColumnBy, and _updateBy never calls it;
 *   - there is no unique index on WorkflowVariable to catch what it misses
 *     (the initial migration creates plain indexes on projectId and workflowId
 *     and nothing else).
 *
 * The damage is silent. RunWorkflow.getVariables builds
 * `storageMap.local.variables[variable.name] = variable.content`, a plain
 * dictionary, so a duplicate does not error - the second row overwrites the
 * first and {{local.variables.X}} resolves to whichever row the query happened
 * to return last. Nothing looks broken; the workflow just runs on the wrong
 * value, possibly the wrong credential.
 *
 * These drive the hook directly. It is protected, and an ordinary prototype
 * method at runtime, so it is reached through a structural cast - going through
 * updateBy() instead would drag in the entire ORM to prove one comparison.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaa1111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbb1111-1111-4111-8111-111111111111",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "aaaa2222-2222-4222-8222-222222222222",
);
const VARIABLE_ID: ObjectID = new ObjectID(
  "aaaa3333-3333-4333-8333-333333333333",
);
const OTHER_VARIABLE_ID: ObjectID = new ObjectID(
  "aaaa4444-4444-4444-8444-444444444444",
);

interface ServiceInternals {
  onBeforeUpdate: (
    updateBy: UpdateBy<WorkflowVariable>,
  ) => Promise<OnUpdate<WorkflowVariable>>;
}

function hook(): ServiceInternals["onBeforeUpdate"] {
  const internals: ServiceInternals =
    WorkflowVariableService as unknown as ServiceInternals;

  return internals.onBeforeUpdate.bind(WorkflowVariableService);
}

type MakeVariableOptions = {
  id?: ObjectID | undefined;
  name: string;
  workflowId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
};

function makeVariable(options: MakeVariableOptions): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  variable._id = (options.id || VARIABLE_ID).toString();
  variable.name = options.name;
  variable.projectId = options.projectId || PROJECT_ID;

  if (options.workflowId) {
    variable.workflowId = options.workflowId;
  }

  return variable;
}

/*
 * Built structurally and cast through unknown. UpdateBy's `data` is a
 * PartialEntity, whose conditional mapped type over a model with relation
 * columns is deep enough that naming it here trips TS2589.
 */
function makeUpdateBy(
  data: Partial<WorkflowVariable>,
): UpdateBy<WorkflowVariable> {
  return {
    query: { _id: VARIABLE_ID.toString() },
    data: data,
    limit: 1,
    skip: 0,
    props: { isRoot: true },
  } as unknown as UpdateBy<WorkflowVariable>;
}

/*
 * Stub the two reads the hook makes. findBy answers "which rows does this
 * update touch"; countBy answers "does the new name already exist in that row's
 * scope". Returning the countBy query as well lets the scoping assertions below
 * inspect what was actually asked for, which is the part that is easy to get
 * wrong and impossible to see from a pass/fail alone.
 */
type CountByCall = { query: Record<string, unknown> };

function stubReads(options: {
  itemsBeingUpdated: Array<WorkflowVariable>;
  conflictCount: number;
}): { countByCalls: Array<CountByCall> } {
  const countByCalls: Array<CountByCall> = [];

  jest
    .spyOn(WorkflowVariableService, "findBy")
    .mockImplementation(async (): Promise<Array<WorkflowVariable>> => {
      return options.itemsBeingUpdated;
    });

  jest
    .spyOn(WorkflowVariableService, "countBy")
    .mockImplementation(async (countBy: unknown): Promise<PositiveNumber> => {
      countByCalls.push({
        query: (countBy as { query: Record<string, unknown> }).query,
      });

      return new PositiveNumber(options.conflictCount);
    });

  return { countByCalls };
}

describe("WorkflowVariableService rename uniqueness", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("updates that are not renames", () => {
    /*
     * The overwhelmingly common update from the dashboard edit form carries no
     * name at all, or carries only content through the "Update Content" modal.
     * Neither should cost a round trip.
     */
    test("a content-only update reads nothing and is allowed through", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [],
        conflictCount: 99,
      });

      const result: OnUpdate<WorkflowVariable> = await hook()(
        makeUpdateBy({ content: "rotated-token" }),
      );

      expect(
        (result.updateBy.data as unknown as Partial<WorkflowVariable>).content,
      ).toBe("rotated-token");
      expect(countByCalls).toHaveLength(0);
      expect(WorkflowVariableService.findBy).not.toHaveBeenCalled();
    });

    test("a description-and-secret update is allowed through", async () => {
      stubReads({ itemsBeingUpdated: [], conflictCount: 99 });

      await expect(
        hook()(
          makeUpdateBy({
            description: "Token for the nightly Airflow sync",
            isSecret: "true",
          } as Partial<WorkflowVariable>),
        ),
      ).resolves.toBeDefined();

      expect(WorkflowVariableService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("renames", () => {
    test("allows a rename when nothing else holds the new name", async () => {
      stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 0,
      });

      const result: OnUpdate<WorkflowVariable> = await hook()(
        makeUpdateBy({ name: "NewName" }),
      );

      expect(
        (result.updateBy.data as unknown as Partial<WorkflowVariable>).name,
      ).toBe("NewName");
    });

    test("refuses a rename onto a name that already exists on the same workflow", async () => {
      stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 1,
      });

      await expect(hook()(makeUpdateBy({ name: "Taken" }))).rejects.toThrow(
        BadDataException,
      );

      await expect(hook()(makeUpdateBy({ name: "Taken" }))).rejects.toThrow(
        /already exists on this workflow/,
      );
    });

    /*
     * The two namespaces get different wording because they are reached from
     * different pages. A global-variable collision that says "on this workflow"
     * sends the reader looking at a workflow they never opened.
     */
    test("names the global namespace when the row is a global variable", async () => {
      stubReads({
        itemsBeingUpdated: [makeVariable({ name: "OldName" })],
        conflictCount: 1,
      });

      await expect(hook()(makeUpdateBy({ name: "Taken" }))).rejects.toThrow(
        /global variable named "Taken" already exists in this project/,
      );
    });
  });

  describe("the scope the conflict is looked up in", () => {
    test("a workflow-local rename is checked against that workflow only", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 0,
      });

      await hook()(makeUpdateBy({ name: "NewName" }));

      expect(countByCalls).toHaveLength(1);

      const query: Record<string, unknown> = countByCalls[0]!.query;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["workflowId"]).toBe(WORKFLOW_ID);
      // The row must not collide with itself.
      expect(query["_id"]).toBeDefined();
      // Case-insensitive: a Raw() expression, not the bare string.
      expect(query["name"]).not.toBe("NewName");
    });

    /*
     * Global variables are the rows whose workflowId is null, and they share a
     * namespace of their own. Passing `workflowId: undefined` would drop the
     * clause altogether and compare a global variable against every
     * workflow-local variable in the project - which would reject renames that
     * are perfectly legal, and is exactly the shape of bug that makes people
     * give up and go back to delete-and-recreate.
     */
    test("a global rename is checked against the project's global variables, not every workflow's", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [makeVariable({ name: "OldName" })],
        conflictCount: 0,
      });

      await hook()(makeUpdateBy({ name: "NewName" }));

      expect(countByCalls).toHaveLength(1);

      const query: Record<string, unknown> = countByCalls[0]!.query;

      expect(query["projectId"]).toBe(PROJECT_ID);
      // An IS NULL expression, not undefined and not a workflow id.
      expect(query["workflowId"]).toBeDefined();
      expect(query["workflowId"]).not.toBe(WORKFLOW_ID);
    });

    test("the row's own project scopes the lookup, not the caller's", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", projectId: OTHER_PROJECT_ID }),
        ],
        conflictCount: 0,
      });

      await hook()(makeUpdateBy({ name: "NewName" }));

      expect(countByCalls[0]!.query["projectId"]).toBe(OTHER_PROJECT_ID);
    });
  });

  describe("renames that are not really renames", () => {
    /*
     * Saving the edit form without touching the name resubmits the name it
     * already has. That must not be reported as a collision with itself - and
     * it does not even need the lookup.
     */
    test("re-submitting the same name costs nothing and is allowed", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "SameName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 1,
      });

      await expect(
        hook()(makeUpdateBy({ name: "SameName" })),
      ).resolves.toBeDefined();

      expect(countByCalls).toHaveLength(0);
    });

    test("changing only the casing of the row's own name is allowed", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "apitoken", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 1,
      });

      /*
       * The uniqueness lookup is case-insensitive (QueryHelper.findWithSameText
       * lowercases both sides), so "apitoken" -> "APIToken" is the same row
       * changing how it is spelled, not a collision. Without the guard this
       * would count itself and refuse.
       */
      await expect(
        hook()(makeUpdateBy({ name: "APIToken" })),
      ).resolves.toBeDefined();

      expect(countByCalls).toHaveLength(0);
    });
  });

  describe("multi-row updates", () => {
    /*
     * The dashboard always sends a single _id, but the CRUD API accepts a
     * broader query. Renaming two rows to one name is a collision the database
     * lookup cannot see: neither row conflicts with anything that exists yet,
     * they conflict with each other once both are written.
     */
    test("refuses to rename more than one variable to the same name at once", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({
            id: VARIABLE_ID,
            name: "First",
            workflowId: WORKFLOW_ID,
          }),
          makeVariable({
            id: OTHER_VARIABLE_ID,
            name: "Second",
            workflowId: WORKFLOW_ID,
          }),
        ],
        conflictCount: 0,
      });

      await expect(hook()(makeUpdateBy({ name: "Merged" }))).rejects.toThrow(
        BadDataException,
      );

      await expect(hook()(makeUpdateBy({ name: "Merged" }))).rejects.toThrow(
        /Cannot rename 2 workflow variables/,
      );

      expect(countByCalls).toHaveLength(0);
    });

    /*
     * A rename whose query matches nothing is a no-op update, not a conflict.
     * Throwing here would turn "the row was already deleted" into a confusing
     * uniqueness error.
     */
    test("allows a rename whose query matches no rows", async () => {
      stubReads({ itemsBeingUpdated: [], conflictCount: 0 });

      await expect(
        hook()(makeUpdateBy({ name: "NewName" })),
      ).resolves.toBeDefined();
    });
  });
});
