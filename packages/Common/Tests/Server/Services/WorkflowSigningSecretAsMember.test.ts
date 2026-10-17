import Workflow from "../../../Models/DatabaseModels/Workflow";
import WorkflowLabelRuleEngineService from "../../../Server/Services/WorkflowLabelRuleEngineService";
import WorkflowOwnerRuleEngineService from "../../../Server/Services/WorkflowOwnerRuleEngineService";
import WorkflowService, {
  Service as WorkflowServiceClass,
} from "../../../Server/Services/WorkflowService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import API from "../../../Utils/API";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { getJestSpyOn } from "../../Spy";
import { drawHuntressSigningSecret } from "../../Types/Huntress/HuntressWebhookFixtures";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHETHER A WORKFLOW'S SIGNING SECRET IS SAVED, THROUGH THE WHOLE WRITE, AS
 * THE PEOPLE WHO SAVE ONE.
 *
 * The signing secret (the Huntress trigger's endpoint secret) is
 * write-only, so the dashboard reads isWebhookSigningSecretSet instead.
 * Only the server writes that flag - its create and update lists are
 * empty, as VMwareVCenter.isVCenterPasswordSet's are beside its password,
 * so the API reference, the MCP tools and the Terraform provider show it
 * read-only. DatabaseService holds what onBeforeCreate / onBeforeUpdate
 * leave to the CALLER's column permissions, so the flag is written in
 * onCreatePermitted / onUpdatePermitted, after those checks, in the same
 * write that saves the secret. WorkflowSigningSecret.test.ts calls the
 * hooks one at a time; this runs every create and update as the members
 * who make them, the way the Builder's trigger panel and Terraform do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
);
const WORKFLOW_ID: string = "6ba7b812-9dad-41d1-80b4-00c04fd430c8";

const LAST_REFUSAL: string =
  "No signing secret is saved for this workflow yet.";

const random: SeededRandom = seededRandom(4938);

// Who may create a workflow: the table's create list.
const CREATORS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a project member", [Permission.ProjectMember]],
  [
    "someone holding Create Workflow",
    [Permission.CreateWorkflow, Permission.ReadWorkflow],
  ],
  ["a workflow admin", [Permission.WorkflowAdmin]],
];

// Who may edit one: the table's update list.
const EDITORS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  [
    "someone holding Edit Workflow",
    [Permission.EditWorkflow, Permission.ReadWorkflow],
  ],
  ["a workflow admin", [Permission.WorkflowAdmin]],
];

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

describe("whether a workflow's signing secret is saved, as the members who save one", () => {
  let workflows: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});

    // The workflow service is told of every saved workflow: not here.
    getJestSpyOn(API, "post").mockResolvedValue({});
    getJestSpyOn(
      WorkflowLabelRuleEngineService,
      "applyRulesToWorkflow",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      WorkflowOwnerRuleEngineService,
      "applyRulesToWorkflow",
    ).mockResolvedValue(undefined);
    // Its creator becomes an owner in a table of its own: not this one.
    getJestSpyOn(WorkflowService, "insertCreatorAsOwner").mockResolvedValue(
      undefined,
    );

    /*
     * What the server writes without hooks - the refusal a new secret
     * clears - is a statement of its own, which the in-memory table cannot
     * read: written to the row here.
     */
    getJestSpyOn(
      WorkflowService,
      "updateColumnsByIdWithoutHooks",
    ).mockImplementation(
      async (write: { id: ObjectID; data: StoredRow }): Promise<void> => {
        Object.assign(workflows.get(write.id) || {}, write.data);
      },
    );

    workflows = useInMemoryTable(WorkflowService, [
      {
        _id: WORKFLOW_ID,
        projectId: PROJECT_ID.toString(),
        name: "Huntress incident reports",
        slug: "huntress-incident-reports",
        isEnabled: false,
        isArchived: false,
        webhookSecretKey: "huntress-key",
        isWebhookSigningSecretSet: false,
        lastWebhookError: LAST_REFUSAL,
        lastWebhookErrorAt: new Date("2026-10-17T08:00:00.000Z"),
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stored(column: string): unknown {
    return workflows.get(WORKFLOW_ID)?.[column];
  }

  async function create(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<{ created: Workflow; inserted: StoredRow }> {
    const workflow: Workflow = new Workflow();
    workflow.projectId = PROJECT_ID;
    workflow.name = "Another Huntress workflow";
    Object.assign(workflow, data);

    const created: Workflow = await WorkflowService.create({
      data: workflow,
      props: props,
    });

    const inserted: StoredRow | undefined = workflows.inserts.find(
      (row: StoredRow): boolean => {
        return String(row["_id"]) === created.id?.toString();
      },
    );

    if (!inserted) {
      throw new Error("The workflow was not inserted.");
    }

    return { created, inserted };
  }

  test.each(CREATORS)(
    "%s creates one with a secret: saved encrypted, and marked saved in the same insert",
    async (_who: string, permissions: Array<Permission>) => {
      const secret: string = drawHuntressSigningSecret(random);

      const { created, inserted } = await create(
        { webhookSigningSecret: ` ${secret} ` },
        member(permissions),
      );

      expect(inserted["isWebhookSigningSecretSet"]).toBe(true);
      expect(inserted["webhookSigningSecret"]).toBeTruthy();
      expect(String(inserted["webhookSigningSecret"])).not.toContain(
        secret.slice("whsec_".length),
      );
      expect(created.isWebhookSigningSecretSet).toBe(true);
    },
  );

  test.each(CREATORS)(
    "%s creates one without a secret, saying one is saved: it is marked not saved, and the create goes through",
    async (_who: string, permissions: Array<Permission>) => {
      const { created, inserted } = await create(
        { isWebhookSigningSecretSet: true },
        member(permissions),
      );

      expect(inserted["isWebhookSigningSecretSet"]).toBe(false);
      expect(inserted["webhookSigningSecret"]).toBeUndefined();
      expect(created.isWebhookSigningSecretSet).toBe(false);
    },
  );

  test.each(EDITORS)(
    "%s saves a new secret: marked saved in the same write, and the refusal it fixed is cleared",
    async (_who: string, permissions: Array<Permission>) => {
      const secret: string = drawHuntressSigningSecret(random);

      await WorkflowService.updateOneById({
        id: new ObjectID(WORKFLOW_ID),
        data: { webhookSigningSecret: secret },
        props: member(permissions),
      });

      expect(stored("isWebhookSigningSecretSet")).toBe(true);
      expect(stored("webhookSigningSecret")).toBeTruthy();
      expect(String(stored("webhookSigningSecret"))).not.toContain(
        secret.slice("whsec_".length),
      );
      expect(stored("lastWebhookError")).toBeNull();
      expect(stored("lastWebhookErrorAt")).toBeNull();

      // The write that saved the secret said so: never one without the other.
      const savedSecret: { id: string; set: StoredRow } | undefined =
        workflows.updates.find(
          (update: { id: string; set: StoredRow }): boolean => {
            return "webhookSigningSecret" in update.set;
          },
        );

      expect(savedSecret?.set["isWebhookSigningSecretSet"]).toBe(true);
    },
  );

  test.each(EDITORS)(
    "%s cannot say a secret is saved without one: the edit goes through without it",
    async (_who: string, permissions: Array<Permission>) => {
      await WorkflowService.updateOneById({
        id: new ObjectID(WORKFLOW_ID),
        data: { isWebhookSigningSecretSet: true, name: "Renamed" } as never,
        props: member(permissions),
      });

      expect(stored("name")).toBe("Renamed");
      expect(stored("isWebhookSigningSecretSet")).toBe(false);
      expect(stored("lastWebhookError")).toBe(LAST_REFUSAL);
    },
  );

  test("an edit that only says a secret is saved is refused, saying to save a secret instead", async () => {
    await expect(
      WorkflowService.updateOneById({
        id: new ObjectID(WORKFLOW_ID),
        data: { isWebhookSigningSecretSet: true } as never,
        props: member([Permission.ProjectOwner]),
      }),
    ).rejects.toThrow(WorkflowServiceClass.SIGNING_SECRET_SAVED_PROBLEM);

    expect(stored("isWebhookSigningSecretSet")).toBe(false);
  });
});
