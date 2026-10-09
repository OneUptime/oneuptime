import WorkflowService, {
  Service as WorkflowServiceClass,
} from "../../../Server/Services/WorkflowService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import UserAttribution from "../../../Types/Database/UserAttribution";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import API from "../../../Utils/API";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";

/*
 * WHO LAST SAVED A WORKFLOW (Workflow.lastSavedByUserId).
 *
 * A workflow's steps are held to the read of runbook credentials of the
 * person who last saved the workflow (RunbookCredentialReaders), so OneUptime
 * records that person on every save made in a project - and nobody when the
 * save had no person:
 *
 *   - a person's create or change, whatever it changes, names them;
 *   - an API key's names nobody;
 *   - OneUptime's own writes (the trigger it reads off the graph, the webhook
 *     key, the labels its rules add) keep who saved it;
 *   - no request chooses it: a value one sends is not what is stored
 *     (UserAttribution), and it is stamped after the save's permission
 *     check, so nobody is asked for access to a column they did not send.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c3000000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: string = "c3000000-0000-4000-8000-000000000002";
const FIRST_SAVER: ObjectID = new ObjectID(
  "c3000000-0000-4000-8000-000000000003",
);

interface WorkflowHookAccess {
  onCreatePermitted(onCreate: OnCreate<Workflow>): Promise<void>;
  onUpdatePermitted(updateBy: UpdateBy<Workflow>): Promise<void>;
}

const hooks: WorkflowHookAccess =
  WorkflowService as unknown as WorkflowHookAccess;

function workflowAdmin(
  userId: ObjectID = ObjectID.generate(),
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          Permission.ProjectUser,
          Permission.WorkflowAdmin,
        ].map((permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
          };
        }),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function apiKey(): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = workflowAdmin();
  delete props.userId;
  props.userType = UserType.API;
  return props;
}

describe("Workflow.lastSavedByUserId", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is a column OneUptime decides: no request writes it, and it is offered for reading only", () => {
    expect(UserAttribution.isDecidedByServer("lastSavedByUserId")).toBe(true);
    expect(UserAttribution.isDecidedByServer("lastSavedByUser")).toBe(true);

    const workflow: Workflow = new Workflow();
    const columns: Array<string> = UserAttribution.getColumns(workflow);

    expect(columns).toContain("lastSavedByUserId");
    expect(columns).toContain("lastSavedByUser");
    expect(workflow.getColumnAccessControlFor("lastSavedByUserId")).toEqual(
      expect.objectContaining({ create: [], update: [] }),
    );
    expect(
      workflow.getColumnAccessControlFor("lastSavedByUserId")?.read,
    ).toContain(Permission.WorkflowAdmin);
  });

  describe("stamping it", () => {
    it("names the person who saves", () => {
      const person: DatabaseCommonInteractionProps = workflowAdmin();
      const data: Record<string, unknown> = { name: "Renamed" };

      WorkflowServiceClass.stampLastSavedBy(data, person);

      expect(data["lastSavedByUserId"]).toBe(person.userId);
    });

    it("names nobody for a save with no person - an API key", () => {
      const data: Record<string, unknown> = {
        name: "Renamed",
        lastSavedByUserId: FIRST_SAVER,
      };

      WorkflowServiceClass.stampLastSavedBy(data, apiKey());

      expect(data["lastSavedByUserId"]).toBeNull();
    });

    it("names the server admin who saves", () => {
      const adminId: ObjectID = ObjectID.generate();
      const data: Record<string, unknown> = {};

      WorkflowServiceClass.stampLastSavedBy(data, {
        isMasterAdmin: true,
        userId: adminId,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps);

      expect(data["lastSavedByUserId"]).toBe(adminId);
    });

    it("leaves OneUptime's own writes alone, whatever they name", () => {
      const data: Record<string, unknown> = { triggerId: "Schedule" };

      WorkflowServiceClass.stampLastSavedBy(data, {
        isRoot: true,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps);

      expect("lastSavedByUserId" in data).toBe(false);
    });

    it("drops a relation sent beside it, so the ID column is what is stored", () => {
      const person: DatabaseCommonInteractionProps = workflowAdmin();
      const data: Record<string, unknown> = {
        lastSavedByUser: { _id: FIRST_SAVER.toString() },
      };

      WorkflowServiceClass.stampLastSavedBy(data, person);

      expect("lastSavedByUser" in data).toBe(false);
      expect(data["lastSavedByUserId"]).toBe(person.userId);
    });

    it("is what the create's last hook writes", async () => {
      const person: DatabaseCommonInteractionProps = workflowAdmin();
      const workflow: Workflow = new Workflow();
      workflow.name = "Close stale incidents";

      await hooks.onCreatePermitted({
        createBy: {
          data: workflow,
          props: person,
        } as CreateBy<Workflow>,
        carryForward: null,
      });

      expect(workflow.lastSavedByUserId).toBe(person.userId);
    });

    it("is what the update's last hook writes", async () => {
      const person: DatabaseCommonInteractionProps = workflowAdmin();
      const updateBy: UpdateBy<Workflow> = {
        query: { _id: WORKFLOW_ID },
        data: { isEnabled: true } as unknown as Workflow,
        props: person,
      } as unknown as UpdateBy<Workflow>;

      await hooks.onUpdatePermitted(updateBy);

      expect(
        (updateBy.data as unknown as Record<string, unknown>)[
          "lastSavedByUserId"
        ],
      ).toBe(person.userId);
    });
  });

  describe("through the update path", () => {
    let workflows: InMemoryTable;

    beforeEach(() => {
      for (const silenced of ["debug", "info", "warn", "error"]) {
        getJestSpyOn(logger, silenced).mockImplementation((): void => {
          return undefined;
        });
      }

      // The workflow service is told about every saved workflow.
      getJestSpyOn(API, "post").mockResolvedValue({} as never);

      workflows = useInMemoryTable(WorkflowService, [
        {
          _id: WORKFLOW_ID,
          projectId: PROJECT_ID.toString(),
          name: "Close stale incidents",
          isEnabled: false,
          isArchived: false,
          lastSavedByUserId: FIRST_SAVER.toString(),
          version: 1,
        },
      ]);
    });

    function savedBy(): unknown {
      const row: StoredRow | undefined = workflows.get(WORKFLOW_ID);
      const value: unknown = row?.["lastSavedByUserId"];
      return value ? String(value).toLowerCase() : value;
    }

    it("records the Workflow Admin who changes anything on it - turning it on included", async () => {
      const editorId: ObjectID = ObjectID.generate();

      await WorkflowService.updateOneById({
        id: new ObjectID(WORKFLOW_ID),
        data: { isEnabled: true } as never,
        props: workflowAdmin(editorId),
      });

      expect(workflows.get(WORKFLOW_ID)?.["isEnabled"]).toBe(true);
      expect(savedBy()).toBe(editorId.toString().toLowerCase());
    });

    it("stores the person who saves, not someone a request names", async () => {
      const editorId: ObjectID = ObjectID.generate();

      await WorkflowService.updateOneById({
        id: new ObjectID(WORKFLOW_ID),
        data: {
          name: "Close very stale incidents",
          lastSavedByUserId: FIRST_SAVER,
        } as never,
        props: workflowAdmin(editorId),
      });

      expect(savedBy()).toBe(editorId.toString().toLowerCase());
    });

    it("records nobody when an API key saves it", async () => {
      await WorkflowService.updateOneById({
        id: new ObjectID(WORKFLOW_ID),
        data: { name: "Close very stale incidents" } as never,
        props: apiKey(),
      });

      expect(savedBy()).toBeFalsy();
    });

    it("keeps who saved it through OneUptime's own writes", async () => {
      await WorkflowService.updateOneById({
        id: new ObjectID(WORKFLOW_ID),
        data: { triggerId: "Schedule" } as never,
        props: { isRoot: true, ignoreHooks: true },
      });

      await WorkflowService.updateOneById({
        id: new ObjectID(WORKFLOW_ID),
        data: { name: "Renamed by OneUptime" } as never,
        props: { isRoot: true, tenantId: PROJECT_ID },
      });

      expect(savedBy()).toBe(FIRST_SAVER.toString().toLowerCase());
    });
  });
});
