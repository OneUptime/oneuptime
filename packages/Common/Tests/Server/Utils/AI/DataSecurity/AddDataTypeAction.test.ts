import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityCustomDataType from "../../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import AddDataTypeAction, {
  ADD_DATA_TYPE_FROM_FORM_MESSAGE,
  ADD_DATA_TYPE_NOT_FOUND_MESSAGE,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/AddDataTypeAction";
import {
  DataSecurityAiChangeMade,
  DataSecurityAiPlanOutcome,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityAiActions from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiActions";
import * as Jobs from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiProposalKind,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Adding a data type OneUptime AI found (#10371): the person adds it from
 * the data type form, filled in with the draft, and saving it is the
 * approval - the change it takes is the type they saved, which must be the
 * project's. Undo deletes it with their own permission. The custom data
 * type service and the queue are stand-ins; the rules are the action's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10371000-0000-4000-8000-000000000001",
);
const SAVED_ID: string = "10371000-0000-4000-8000-0000000000c1";
const OTHER_PROJECTS_ID: string = "10371000-0000-4000-8000-0000000000c2";

let saved: Map<string, DataSecurityCustomDataType>;
let findProps: Array<DatabaseCommonInteractionProps>;
let deleted: Array<{ id: string; props: DatabaseCommonInteractionProps }>;
let queued: number;

function caller(permissions: Array<Permission>): DatabaseCommonInteractionProps {
  return customDomainCaller({ permissions, projectId: PROJECT_ID });
}

function proposal(result?: JSONObject): DataSecurityAiProposal {
  const row: DataSecurityAiProposal = new DataSecurityAiProposal(
    ObjectID.generate(),
  );

  row.projectId = PROJECT_ID;
  row.kind = DataSecurityAiProposalKind.AddDataType;

  if (result) {
    row.result = result;
  }

  return row;
}

beforeEach(() => {
  const type: DataSecurityCustomDataType = new DataSecurityCustomDataType(
    new ObjectID(SAVED_ID),
  );

  type.projectId = PROJECT_ID;
  type.name = "Insurance policy number";
  saved = new Map([[SAVED_ID, type]]);
  findProps = [];
  deleted = [];
  queued = 0;

  jest
    .spyOn(DataSecurityCustomDataTypeService, "findOneBy")
    .mockImplementation((async (find: {
      query: { _id: ObjectID; projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    }) => {
      findProps.push(find.props);
      const row: DataSecurityCustomDataType | undefined = saved.get(
        find.query._id.toString(),
      );

      return row && row.projectId!.toString() === find.query.projectId.toString()
        ? row
        : null;
    }) as never);
  jest
    .spyOn(DataSecurityCustomDataTypeService, "deleteBy")
    .mockImplementation((async (remove: {
      query: { _id: ObjectID };
      props: DatabaseCommonInteractionProps;
    }) => {
      deleted.push({ id: remove.query._id.toString(), props: remove.props });
      saved.delete(remove.query._id.toString());
      return 1;
    }) as never);
  jest
    .spyOn(Jobs, "queueDataSecurityEvaluation")
    .mockImplementation((async () => {
      queued++;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("adding a data type OneUptime AI found", () => {
  test("is one of the proposal kinds, with an action, and is planned for the project, never for an issue", async () => {
    expect(Object.keys(DATA_SECURITY_AI_PROPOSAL_KINDS)).toContain(
      DataSecurityAiProposalKind.AddDataType,
    );
    expect(
      DataSecurityAiActions.get(DataSecurityAiProposalKind.AddDataType),
    ).toBe(AddDataTypeAction);
    expect(AddDataTypeAction.appliesToCheck("any-check")).toBe(false);

    const outcome: DataSecurityAiPlanOutcome = await AddDataTypeAction.plan(
      {} as never,
    );

    expect(outcome.kind).toBe("nothing");
  });

  test.each([
    [[Permission.ProjectOwner], true],
    [[Permission.SecurityMember], true],
    [[Permission.CreateDataSecurityCustomDataType], true],
    [[Permission.SecurityViewer], false],
    [[Permission.EditDataSecurityCustomDataType], false],
  ])(
    "adding it with %j takes the permission to create a data type: %s",
    (permissions: Array<Permission>, may: boolean) => {
      const refusal: string | null = AddDataTypeAction.getApproveRefusal({
        props: caller(permissions),
        proposal: proposal(),
      });

      expect(refusal === null).toBe(may);

      if (refusal) {
        expect(refusal).toContain("Create Custom Data Type");
      }
    },
  );

  test("undoing it takes the permission to delete one", () => {
    expect(
      AddDataTypeAction.getUndoRefusal({
        props: caller([Permission.SecurityAdmin]),
        proposal: proposal(),
      }),
    ).toBeNull();
    expect(
      AddDataTypeAction.getUndoRefusal({
        props: caller([Permission.SecurityMember]),
        proposal: proposal(),
      }),
    ).toContain("Delete Custom Data Type");
  });

  test("the change it takes is the type saved from the form, the project's, and nothing else", async () => {
    await expect(
      AddDataTypeAction.readChanges!({
        projectId: PROJECT_ID,
        proposal: proposal(),
        changes: undefined,
      }),
    ).rejects.toThrow(ADD_DATA_TYPE_FROM_FORM_MESSAGE);
    await expect(
      AddDataTypeAction.readChanges!({
        projectId: PROJECT_ID,
        proposal: proposal(),
        changes: { customDataTypeId: "not-an-id" },
      }),
    ).rejects.toThrow(ADD_DATA_TYPE_FROM_FORM_MESSAGE);
    await expect(
      AddDataTypeAction.readChanges!({
        projectId: PROJECT_ID,
        proposal: proposal(),
        changes: { customDataTypeId: OTHER_PROJECTS_ID },
      }),
    ).rejects.toThrow(ADD_DATA_TYPE_NOT_FOUND_MESSAGE);

    expect(
      await AddDataTypeAction.readChanges!({
        projectId: PROJECT_ID,
        proposal: proposal(),
        changes: { customDataTypeId: SAVED_ID, pattern: "anything else" },
      }),
    ).toEqual({ customDataTypeId: SAVED_ID });
  });

  test("approving it records the saved type, read as the person, and says what changed", async () => {
    const person: DatabaseCommonInteractionProps = caller([
      Permission.SecurityMember,
    ]);
    const made: DataSecurityAiChangeMade = await AddDataTypeAction.apply({
      projectId: PROJECT_ID,
      proposal: proposal(),
      actor: { props: person },
      changes: { customDataTypeId: SAVED_ID },
    });

    expect(made.result).toEqual({
      customDataTypeId: SAVED_ID,
      name: "Insurance policy number",
    });
    expect(made.summaryMarkdown).toContain("**Insurance policy number**");
    expect(findProps).toEqual([person]);

    await expect(
      AddDataTypeAction.apply({
        projectId: PROJECT_ID,
        proposal: proposal(),
        actor: { props: person },
      }),
    ).rejects.toThrow(ADD_DATA_TYPE_FROM_FORM_MESSAGE);
  });

  test("undoing it deletes the type as the person, and evaluates the stores again", async () => {
    const person: DatabaseCommonInteractionProps = caller([
      Permission.SecurityAdmin,
    ]);

    await AddDataTypeAction.undo({
      projectId: PROJECT_ID,
      proposal: proposal({ customDataTypeId: SAVED_ID, name: "x" }),
      actor: { props: person },
    });

    expect(deleted).toEqual([{ id: SAVED_ID, props: person }]);
    expect(saved.has(SAVED_ID)).toBe(false);
    expect(queued).toBe(1);
  });
});
