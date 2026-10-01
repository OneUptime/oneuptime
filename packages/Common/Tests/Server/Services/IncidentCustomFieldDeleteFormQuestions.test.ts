jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentFormService from "../../../Server/Services/IncidentFormService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A public incident form asks custom fields by template key, and a field
 * created later with the same name - or any name that gives the same key -
 * gets that key back. Left on the form, a deleted field's key would put the
 * new field, with its own description and dropdown options, straight onto
 * the public form, which no admin chose. So deleting an incident custom
 * field takes its key off every form of its project - one raw statement per
 * field, so no form's "On Update" workflow runs - and leaves incident
 * templates alone: a template keeps its setting for a field created again.
 *
 * The hooks are driven directly; the statement itself is pinned against a
 * fake repository, and against a real Postgres in IncidentFormPostgres.test.ts.
 */

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000f301",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000f302",
);
const CUSTOMER_ID: string = "0194d4ba-0000-4000-8000-00000000f303";
const REGION_ID: string = "0194d4ba-0000-4000-8000-00000000f304";

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("0194d4ba-0000-4000-8000-00000000f305"),
};

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function callHook<T>(name: string, ...args: Array<unknown>): Promise<T> {
  const hooks: Record<string, HookFunction> =
    IncidentCustomFieldService as unknown as Record<string, HookFunction>;
  return hooks[name]!.apply(IncidentCustomFieldService, args) as Promise<T>;
}

function field(data: {
  id: string;
  projectId: ObjectID;
  variableKey: string;
}): IncidentCustomField {
  const row: IncidentCustomField = new IncidentCustomField();
  row._id = data.id;
  row.projectId = data.projectId;
  row.variableKey = data.variableKey;
  return row;
}

let fieldFindBy: MockedFn;
let removeFromForms: MockedFn;

beforeEach(() => {
  fieldFindBy = jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([
      field({
        id: CUSTOMER_ID,
        projectId: PROJECT_ID,
        variableKey: "customer",
      }),
      field({
        id: REGION_ID,
        projectId: OTHER_PROJECT_ID,
        variableKey: "region",
      }),
    ] as never) as unknown as MockedFn;

  removeFromForms = jest
    .spyOn(IncidentFormService, "removeCustomFieldFromQuestions")
    .mockResolvedValue(1 as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function deleteFields(
  deletedIds: Array<string>,
  props: DatabaseCommonInteractionProps = ADMIN_PROPS,
): Promise<OnDelete<IncidentCustomField>> {
  const deleteBy: DeleteBy<IncidentCustomField> = {
    query: { _id: CUSTOMER_ID },
    props: props,
    limit: 1,
    skip: 0,
  };

  const onDelete: OnDelete<IncidentCustomField> = await callHook<
    OnDelete<IncidentCustomField>
  >("onBeforeDelete", deleteBy);

  return await callHook<OnDelete<IncidentCustomField>>(
    "onDeleteSuccess",
    onDelete,
    deletedIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

describe("deleting an incident custom field takes it off the incident forms", () => {
  test("reads the fields about to go before they are gone, as root, limited to the caller's project", async () => {
    await deleteFields([CUSTOMER_ID]);

    expect(fieldFindBy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = fieldFindBy.mock.calls[0]![0] as never;

    expect(findBy.query).toEqual({ _id: CUSTOMER_ID, projectId: PROJECT_ID });
    expect(findBy.select).toEqual({
      _id: true,
      projectId: true,
      variableKey: true,
    });
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("a root delete reads by the delete's own query", async () => {
    await deleteFields([CUSTOMER_ID], { isRoot: true });

    expect(
      (fieldFindBy.mock.calls[0]![0] as { query: Record<string, unknown> })
        .query,
    ).toEqual({ _id: CUSTOMER_ID });
  });

  test("removes each deleted field's key from the forms of its own project, once", async () => {
    await deleteFields([CUSTOMER_ID, REGION_ID]);

    expect(removeFromForms).toHaveBeenCalledTimes(2);
    expect(
      removeFromForms.mock.calls.map((call: Array<unknown>): string => {
        const removed: { projectId: ObjectID; variableKey: string } =
          call[0] as { projectId: ObjectID; variableKey: string };
        return `${removed.projectId.toString()}:${removed.variableKey}`;
      }),
    ).toEqual([
      `${PROJECT_ID.toString()}:customer`,
      `${OTHER_PROJECT_ID.toString()}:region`,
    ]);
  });

  test("leaves the forms alone for a field the delete did not remove", async () => {
    await deleteFields([CUSTOMER_ID]);

    expect(removeFromForms).toHaveBeenCalledTimes(1);
    expect(
      (removeFromForms.mock.calls[0]![0] as { variableKey: string })
        .variableKey,
    ).toBe("customer");

    removeFromForms.mockClear();

    await deleteFields([]);

    expect(removeFromForms).not.toHaveBeenCalled();
  });

  test("never touches an incident template: a template keeps its setting for a field created again", async () => {
    const templateWrites: Array<MockedFn> = [
      "updateBy",
      "updateOneById",
      "updateOneBy",
      "getRepository",
    ].map((method: string): MockedFn => {
      return jest
        .spyOn(
          IncidentTemplateService as unknown as Record<
            string,
            (...args: Array<unknown>) => unknown
          >,
          method,
        )
        .mockImplementation((() => {
          throw new Error(`IncidentTemplateService.${method} was called`);
        }) as never) as unknown as MockedFn;
    });

    await deleteFields([CUSTOMER_ID, REGION_ID]);

    for (const write of templateWrites) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  test("a failure is logged, the next field is still handled, and the delete stands", async () => {
    removeFromForms.mockRejectedValueOnce(new Error("connection reset"));

    await expect(deleteFields([CUSTOMER_ID, REGION_ID])).resolves.toBeDefined();

    expect(removeFromForms).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'could not take the deleted incident custom field "customer" off the incident forms',
      ),
      expect.objectContaining({ projectId: PROJECT_ID.toString() }),
    );
  });
});

describe("IncidentFormService.removeCustomFieldFromQuestions", () => {
  let query: MockedFn;

  beforeEach(() => {
    removeFromForms.mockRestore();

    query = jest.fn(async (): Promise<unknown> => {
      return [{ count: 3 }];
    }) as unknown as MockedFn;

    jest.spyOn(IncidentFormService, "getRepository").mockReturnValue({
      metadata: {
        tableName: "IncidentForm",
        findColumnWithPropertyName: (
          propertyName: string,
        ): { databaseName: string } => {
          return { databaseName: propertyName };
        },
      },
      manager: { query: query },
    } as never);
  });

  test("removes the key with one statement on the project's forms, bound, answering with how many asked it", async () => {
    expect(
      await IncidentFormService.removeCustomFieldFromQuestions({
        projectId: PROJECT_ID,
        variableKey: "customer",
      }),
    ).toBe(3);

    expect(query).toHaveBeenCalledTimes(1);

    const [sql, parameters] = query.mock.calls[0] as [string, Array<unknown>];

    expect(parameters).toEqual([PROJECT_ID.toString(), "customer"]);
    expect(sql.replace(/\s+/g, " ")).toContain(
      'UPDATE "IncidentForm" SET "customFieldSettings" = "customFieldSettings" - $2::text WHERE "projectId" = $1 AND jsonb_typeof("customFieldSettings") = \'object\' AND jsonb_exists("customFieldSettings", $2::text)',
    );
    // No version bump and no updatedAt: nobody changed the form.
    expect(sql).not.toContain("version");
    expect(sql).not.toContain("updatedAt");
    // The key is a bound value, never part of the statement.
    expect(sql).not.toContain("customer");
  });

  test("starts no form's workflow", async () => {
    const workflow: MockedFn = jest
      .spyOn(IncidentFormService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never) as unknown as MockedFn;

    await IncidentFormService.removeCustomFieldFromQuestions({
      projectId: PROJECT_ID,
      variableKey: "customer",
    });

    expect(workflow).not.toHaveBeenCalled();
  });
});
