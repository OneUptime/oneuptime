import WorkflowVariableService from "../../../Server/Services/WorkflowVariableService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
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
const USER_ID: ObjectID = new ObjectID(
  "aaaa5555-5555-4555-8555-555555555555",
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
  isSecret?: boolean | string | undefined;
};

function makeVariable(options: MakeVariableOptions): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  variable._id = (options.id || VARIABLE_ID).toString();
  variable.name = options.name;
  variable.projectId = options.projectId || PROJECT_ID;

  if (options.workflowId) {
    variable.workflowId = options.workflowId;
  }

  if (options.isSecret !== undefined) {
    (variable as unknown as { isSecret?: unknown }).isSecret = options.isSecret;
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
  props?: Record<string, unknown> | undefined,
): UpdateBy<WorkflowVariable> {
  return {
    query: { _id: VARIABLE_ID.toString() },
    data: data,
    limit: 1,
    skip: 0,
    props: props || { isRoot: true },
  } as unknown as UpdateBy<WorkflowVariable>;
}

/*
 * Stub the two reads the hook makes. findBy answers "which rows does this
 * update touch"; countBy answers "does the new name already exist in that row's
 * scope". Both calls are recorded WHOLE - query, select and props - because
 * every assertion worth making here is about what was asked for rather than
 * about what a stub chose to answer.
 */
type RecordedCall = {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  props?: Record<string, unknown> | undefined;
  limit?: unknown;
};

function stubReads(options: {
  itemsBeingUpdated: Array<WorkflowVariable>;
  conflictCount: number;
}): { countByCalls: Array<RecordedCall>; findByCalls: Array<RecordedCall> } {
  const countByCalls: Array<RecordedCall> = [];
  const findByCalls: Array<RecordedCall> = [];

  function record(call: unknown): RecordedCall {
    const typed: RecordedCall = call as RecordedCall;

    return {
      query: typed.query,
      select: typed.select,
      props: typed.props,
      limit: typed.limit,
    };
  }

  jest
    .spyOn(WorkflowVariableService, "findBy")
    .mockImplementation(
      async (findBy: unknown): Promise<Array<WorkflowVariable>> => {
        findByCalls.push(record(findBy));
        return options.itemsBeingUpdated;
      },
    );

  jest
    .spyOn(WorkflowVariableService, "countBy")
    .mockImplementation(async (countBy: unknown): Promise<PositiveNumber> => {
      countByCalls.push(record(countBy));
      return new PositiveNumber(options.conflictCount);
    });

  return { countByCalls, findByCalls };
}

/*
 * QueryHelper builds TypeORM Raw() operators, so a query value is a
 * FindOperator carrying the SQL fragment it will emit and the parameter bound
 * into it. Asserting "it is defined" would accept the exact inversion of every
 * one of these predicates, so the tests below read the operator instead.
 */
type RawOperator = {
  type?: string | undefined;
  getSql?: ((alias: string) => string) | undefined;
  objectLiteralParameters?: Record<string, unknown> | undefined;
};

function sqlOf(value: unknown, alias: string): string {
  const operator: RawOperator = value as RawOperator;

  if (!operator || typeof operator.getSql !== "function") {
    throw new Error(
      `Expected a Raw() operator for "${alias}", got ${JSON.stringify(value)}`,
    );
  }

  return operator.getSql(alias).replace(/\s+/g, " ");
}

function paramsOf(value: unknown): Array<unknown> {
  const operator: RawOperator = value as RawOperator;

  return Object.values(operator?.objectLiteralParameters || {});
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

  describe("which rows the guard inspects", () => {
    /*
     * The hook resolves the update's own query to real rows before it can judge
     * anything, and every part of that read matters: the query decides which
     * rows, isRoot lets it see rows the caller cannot read, the select supplies
     * the scope the lookup is built from, and the limit is what lets the
     * multi-row guard below see all of them. A stub that answers regardless of
     * its arguments would hide all four.
     */
    test("reads exactly the rows this update targets, as root, with the scope columns", async () => {
      const { findByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 0,
      });

      await hook()(makeUpdateBy({ name: "NewName" }));

      expect(findByCalls).toHaveLength(1);

      const call: RecordedCall = findByCalls[0]!;

      expect(call.query).toEqual({ _id: VARIABLE_ID.toString() });
      expect(call.props).toEqual({ isRoot: true });
      expect(call.props).not.toHaveProperty("userId");
      expect(call.select).toEqual(
        expect.objectContaining({
          _id: true,
          name: true,
          projectId: true,
          workflowId: true,
        }),
      );
      expect(call.limit).toBe(LIMIT_PER_PROJECT);
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

      const call: RecordedCall = countByCalls[0]!;
      const query: Record<string, unknown> = call.query;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["workflowId"]).toBe(WORKFLOW_ID);

      /*
       * As root: the conflicting row can easily be one the caller cannot read -
       * read access is permission- and label-gated - and a count that cannot
       * see it reports zero and waves the duplicate through.
       */
      expect(call.props).toEqual({ isRoot: true });

      /*
       * The row must be excluded from its own lookup. Asserting the operator
       * rather than its presence, because `equalTo` would also be "defined" -
       * and would make the row collide with itself, refusing every rename.
       */
      expect(sqlOf(query["_id"], "_id")).toContain("!=");
      expect(paramsOf(query["_id"])).toContain(VARIABLE_ID.toString());

      /*
       * Case-insensitive, on the NEW name. A lookup built from the old name
       * asks "does anything else already have my current name", answers no, and
       * lets the rename land on top of an existing variable.
       */
      expect(sqlOf(query["name"], "name")).toContain("LOWER");
      expect(paramsOf(query["name"])).toContain("newname");
    });

    /*
     * Global variables are the rows whose workflowId is null, and they share a
     * namespace of their own. Passing `workflowId: undefined` would drop the
     * clause altogether and compare a global variable against every
     * workflow-local variable in the project - which would reject renames that
     * are perfectly legal, and is exactly the shape of bug that makes people
     * give up and go back to delete-and-recreate. IS NOT NULL would do the same
     * thing, which is why the SQL is read rather than merely required to exist.
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

      const workflowSql: string = sqlOf(query["workflowId"], "workflowId");

      expect(workflowSql).toContain("IS NULL");
      expect(workflowSql).not.toContain("IS NOT NULL");
    });

    /*
     * The count must run as root whoever is calling. Asserting that against a
     * root fixture proves nothing - `props: updateBy.props` is indistinguishable
     * from `props: { isRoot: true }` when the caller already is root - so this
     * one calls as an ordinary user and checks the lookup did NOT inherit those
     * props. It matters because the conflicting row can be one the caller
     * cannot read: read access is label-gated, and a count that cannot see the
     * duplicate reports zero and waves it through.
     */
    test("counts as root even when the caller is not", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 0,
      });

      await hook()(
        makeUpdateBy(
          { name: "NewName" },
          { userId: USER_ID, tenantId: PROJECT_ID },
        ),
      );

      expect(countByCalls).toHaveLength(1);
      expect(countByCalls[0]!.props).toEqual({ isRoot: true });
      expect(countByCalls[0]!.props).not.toHaveProperty("userId");
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

    /*
     * projectId is non-nullable on the table, so a row without one means the
     * select or the row is wrong. Dropping the clause would count the name
     * across every project on the instance and refuse legitimate renames, so
     * the guard refuses rather than answering the wrong question.
     */
    test("refuses rather than issuing an unscoped lookup when the row has no project", async () => {
      const orphan: WorkflowVariable = makeVariable({ name: "OldName" });
      delete orphan.projectId;

      const { countByCalls } = stubReads({
        itemsBeingUpdated: [orphan],
        conflictCount: 0,
      });

      await expect(hook()(makeUpdateBy({ name: "NewName" }))).rejects.toThrow(
        BadDataException,
      );

      expect(countByCalls).toHaveLength(0);
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

      /*
       * The zero above is only meaningful next to a one: a hook that had been
       * deleted outright would also never call countBy. A genuine rename
       * through the same stubs proves the short-circuit is a short-circuit
       * rather than an absence.
       */
      await expect(
        hook()(makeUpdateBy({ name: "GenuinelyDifferent" })),
      ).rejects.toThrow(BadDataException);

      expect(countByCalls).toHaveLength(1);
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

    /*
     * The other half of case-insensitivity, and the one that matters more: a
     * DIFFERENT row already holding the name in another case is a real
     * collision, because the lookup lowercases both sides. The short-circuit
     * above must not swallow it.
     */
    test("still refuses a rename that collides with another row only by casing", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 1,
      });

      await expect(hook()(makeUpdateBy({ name: "APIToken" }))).rejects.toThrow(
        /already exists on this workflow/,
      );

      expect(paramsOf(countByCalls[0]!.query["name"])).toContain("apitoken");
    });

    /*
     * A blank name is a write to the column, not the absence of one. Two rows
     * blanked in the same workflow would both become "" and collide like any
     * other duplicate, so the guard has to run rather than treat it as "no
     * rename".
     */
    test("treats a blanked name as a rename rather than skipping the guard", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 1,
      });

      await expect(hook()(makeUpdateBy({ name: "" }))).rejects.toThrow(
        BadDataException,
      );

      expect(countByCalls).toHaveLength(1);
    });

    /*
     * An update that does not carry the column at all IS exempt, and must stay
     * so - that is every content-only and description-only save.
     */
    test("an update carrying no name at all still skips the guard", async () => {
      const { findByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 1,
      });

      await expect(
        hook()(makeUpdateBy({ description: "Just a note" })),
      ).resolves.toBeDefined();

      expect(findByCalls).toHaveLength(0);
    });
  });

  /*
   * _updateBy calls this hook BEFORE ModelPermission.checkUpdateQueryPermissions,
   * which is the step that appends the project clause. A hook reading
   * unscoped-as-root would therefore answer questions about another project's
   * rows - and its refusal messages say whether a variable is global and
   * whether a name is taken there - before any authorization had run. So the
   * hook applies the tenant scope itself.
   */
  describe("tenant scoping, which the permission layer has not applied yet", () => {
    test("narrows the lookup to the calling project", async () => {
      const { findByCalls } = stubReads({
        itemsBeingUpdated: [],
        conflictCount: 0,
      });

      await hook()(
        makeUpdateBy(
          { name: "NewName" },
          { userId: USER_ID, tenantId: PROJECT_ID },
        ),
      );

      expect(findByCalls[0]!.query).toEqual({
        _id: VARIABLE_ID.toString(),
        projectId: PROJECT_ID,
      });
    });

    /*
     * The oracle this closes: a variable id belonging to a project the caller
     * cannot see resolves to no rows, so the hook says nothing at all and the
     * permission layer refuses the update on its own terms.
     */
    test("says nothing about a row outside the calling project", async () => {
      const { countByCalls } = stubReads({
        itemsBeingUpdated: [],
        conflictCount: 1,
      });

      await expect(
        hook()(
          makeUpdateBy(
            { name: "STRIPE_SECRET_KEY" },
            { userId: USER_ID, tenantId: OTHER_PROJECT_ID },
          ),
        ),
      ).resolves.toBeDefined();

      expect(countByCalls).toHaveLength(0);
    });

    /*
     * Internal callers run as root with no tenant. Scoping those to a tenant
     * they do not have would silently stop the guard from working at all.
     */
    test("leaves a root call with no tenant unscoped", async () => {
      const { findByCalls } = stubReads({
        itemsBeingUpdated: [],
        conflictCount: 0,
      });

      await hook()(makeUpdateBy({ name: "NewName" }));

      expect(findByCalls[0]!.query).toEqual({ _id: VARIABLE_ID.toString() });
    });
  });

  /*
   * isSecret is a one-way flag, and the service is the only place that can say
   * so - a ColumnAccessControl list cannot express "you may set this but not
   * clear it".
   *
   * Clearing it is the direction that exposes something. `content` is
   * unreadable through the API by anyone, and this flag is what keeps its value
   * out of the run logs - so a caller who may write a variable but not read it
   * could otherwise clear the flag, trigger a run, and read the value out of a
   * log it had been redacted from.
   */
  describe("the secret flag is a ratchet", () => {
    test("lets a variable be marked secret", async () => {
      stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "Token", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 0,
      });

      await expect(
        hook()(makeUpdateBy({ isSecret: "true" } as Partial<WorkflowVariable>)),
      ).resolves.toBeDefined();
    });

    test("refuses to un-mark a variable that is secret", async () => {
      stubReads({
        itemsBeingUpdated: [
          makeVariable({
            name: "Token",
            workflowId: WORKFLOW_ID,
            isSecret: true,
          }),
        ],
        conflictCount: 0,
      });

      await expect(
        hook()(
          makeUpdateBy({ isSecret: "false" } as Partial<WorkflowVariable>),
        ),
      ).rejects.toThrow(BadDataException);

      await expect(
        hook()(
          makeUpdateBy({
            isSecret: false,
          } as unknown as Partial<WorkflowVariable>),
        ),
      ).rejects.toThrow(/cannot be un-marked/);
    });

    /*
     * The flag comes back from Postgres as a real boolean and can arrive from a
     * request body as the string "true". RunWorkflow reads it exactly this way
     * (getSecretWorkflowVariableValues), and a guard that disagreed with the
     * redaction it protects would be worse than no guard.
     */
    test("reads the string form of the flag the way the run logs do", async () => {
      stubReads({
        itemsBeingUpdated: [
          makeVariable({
            name: "Token",
            workflowId: WORKFLOW_ID,
            isSecret: "true",
          }),
        ],
        conflictCount: 0,
      });

      await expect(
        hook()(
          makeUpdateBy({
            isSecret: false,
          } as unknown as Partial<WorkflowVariable>),
        ),
      ).rejects.toThrow(BadDataException);
    });

    test("leaves a variable that was never secret alone", async () => {
      stubReads({
        itemsBeingUpdated: [
          makeVariable({
            name: "Token",
            workflowId: WORKFLOW_ID,
            isSecret: false,
          }),
        ],
        conflictCount: 0,
      });

      await expect(
        hook()(
          makeUpdateBy({ isSecret: "false" } as Partial<WorkflowVariable>),
        ),
      ).resolves.toBeDefined();
    });

    test("an update that does not mention the flag reads nothing", async () => {
      const { findByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({
            name: "Token",
            workflowId: WORKFLOW_ID,
            isSecret: true,
          }),
        ],
        conflictCount: 0,
      });

      await expect(
        hook()(makeUpdateBy({ content: "rotated-token" })),
      ).resolves.toBeDefined();

      expect(findByCalls).toHaveLength(0);
    });
  });

  /*
   * sanitizeUpdateData passes plain objects straight through, so `name` is
   * whatever the request body said it was. Without the type check this reached
   * newName.toLowerCase() and became a 500 with a stack trace rather than a 400
   * naming the field.
   */
  describe("a name that is not text", () => {
    test("is refused as bad data rather than crashing the request", async () => {
      const { findByCalls } = stubReads({
        itemsBeingUpdated: [
          makeVariable({ name: "OldName", workflowId: WORKFLOW_ID }),
        ],
        conflictCount: 0,
      });

      await expect(
        hook()(
          makeUpdateBy({
            name: { $ne: null },
          } as unknown as Partial<WorkflowVariable>),
        ),
      ).rejects.toThrow(BadDataException);

      await expect(
        hook()(
          makeUpdateBy({ name: 42 } as unknown as Partial<WorkflowVariable>),
        ),
      ).rejects.toThrow(/must be text/);

      expect(findByCalls).toHaveLength(0);
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
