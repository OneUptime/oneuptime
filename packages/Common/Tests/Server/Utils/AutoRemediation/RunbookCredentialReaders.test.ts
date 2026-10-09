import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import RunbookCredentialReaders from "../../../../Server/Utils/AutoRemediation/RunbookCredentialReaders";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import RunbookCredential from "../../../../Models/DatabaseModels/RunbookCredential";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../../Types/Database/TableColumn";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * WHO MAY LET A COMMAND RUN WITH A RUNBOOK CREDENTIAL (RunbookCredentialReaders).
 *
 * The one rule approving an AI command plan, saving a rule that runs
 * OneUptime AI's commands without asking, turning on a Runner's "Runs AI
 * Remediation Commands", assigning an SSH credential to such a Runner,
 * naming a credential in a runbook's steps and binding one to a cluster all
 * ask:
 *
 *   - a person, an API key: whoever holds a read of runbook credentials
 *     that no block takes away;
 *   - OneUptime itself and a master admin: always;
 *   - a workflow's step: never by its own Project Admin permissions - the
 *     person who last saved the workflow's steps, as they are in the step's
 *     project when the step asks. A workflow whose steps were saved by
 *     nobody (an API key, or before OneUptime recorded who saved them) may
 *     not.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000002",
);
const SAVER_ID: ObjectID = new ObjectID("c1000000-0000-4000-8000-000000000003");

function person(data: {
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
}): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          ...data.permissions.map((permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
            };
          }),
          ...(data.blocked || []).map(
            (permission: Permission): UserPermission => {
              return {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: true,
              };
            },
          ),
        ],
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function step(
  savedBy: ObjectID | null = SAVER_ID,
): DatabaseCommonInteractionProps {
  return WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
    workflowName: "Turn on AI commands",
    savedByUserId: savedBy,
  });
}

describe("RunbookCredentialReaders", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("for a person or an API key", () => {
    it.each([
      ["Read Runbook Credential", [Permission.ReadRunbookCredential]],
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
    ])(
      "lets whoever holds %s",
      async (_label: string, permissions: Array<Permission>) => {
        await expect(
          RunbookCredentialReaders.mayRead(person({ permissions })),
        ).resolves.toBe(true);
      },
    );

    it.each([
      ["Project Member", [Permission.ProjectMember]],
      ["Runbook Admin", [Permission.RunbookAdmin]],
      ["Edit Runner", [Permission.EditRunner]],
      [
        "Create and Edit Runbook Credential",
        [Permission.CreateRunbookCredential, Permission.EditRunbookCredential],
      ],
      ["Workflow Admin", [Permission.WorkflowAdmin]],
    ])(
      "does not let whoever holds only %s",
      async (_label: string, permissions: Array<Permission>) => {
        await expect(
          RunbookCredentialReaders.mayRead(person({ permissions })),
        ).resolves.toBe(false);
      },
    );

    it("a block on Read Runbook Credential takes it away, even from an admin", async () => {
      await expect(
        RunbookCredentialReaders.mayRead(
          person({
            permissions: [Permission.ProjectAdmin],
            blocked: [Permission.ReadRunbookCredential],
          }),
        ),
      ).resolves.toBe(false);
    });

    it("lets OneUptime itself and a master admin", async () => {
      await expect(
        RunbookCredentialReaders.mayRead({
          isRoot: true,
        } as DatabaseCommonInteractionProps),
      ).resolves.toBe(true);

      await expect(
        RunbookCredentialReaders.mayRead({
          isMasterAdmin: true,
          tenantId: PROJECT_ID,
        } as DatabaseCommonInteractionProps),
      ).resolves.toBe(true);
    });

    it("never looks anyone else up", async () => {
      const lookUp: jest.SpyInstance = jest.spyOn(
        AccessTokenService,
        "getDatabaseCommonInteractionPropsByUserAndProject",
      );

      await RunbookCredentialReaders.mayRead(
        person({ permissions: [Permission.ProjectMember] }),
      );

      expect(lookUp).not.toHaveBeenCalled();
    });

    it("adds nothing to a refusal", () => {
      expect(
        RunbookCredentialReaders.getWorkflowNote(
          person({ permissions: [Permission.ProjectMember] }),
        ),
      ).toBe("");
    });
  });

  describe("for a workflow's step", () => {
    let saver: DatabaseCommonInteractionProps | null;
    let lookUp: jest.SpyInstance;

    beforeEach(() => {
      saver = person({ permissions: [Permission.WorkflowAdmin] });

      lookUp = jest
        .spyOn(
          AccessTokenService,
          "getDatabaseCommonInteractionPropsByUserAndProject",
        )
        .mockImplementation(
          async (data: {
            userId: ObjectID;
            projectId: ObjectID;
          }): Promise<DatabaseCommonInteractionProps> => {
            if (!saver) {
              return {
                userId: data.userId,
                tenantId: data.projectId,
                userTenantAccessPermission: {
                  [data.projectId.toString()]: null,
                },
              } as unknown as DatabaseCommonInteractionProps;
            }

            return { ...saver, userId: data.userId };
          },
        );
    });

    it("acts as a Project Admin, which reads runbook credentials - and that is not what is asked", async () => {
      expect(
        new RunbookCredential()
          .getReadPermissions()
          .includes(WorkflowPrincipal.PERMISSION),
      ).toBe(true);

      await expect(RunbookCredentialReaders.mayRead(step())).resolves.toBe(
        false,
      );
    });

    it("asks about the person who last saved the workflow, in the step's project", async () => {
      await RunbookCredentialReaders.mayRead(step());

      expect(lookUp).toHaveBeenCalledTimes(1);

      const asked: { userId: ObjectID; projectId: ObjectID } = lookUp.mock
        .calls[0]![0] as { userId: ObjectID; projectId: ObjectID };

      expect(asked.userId.toString()).toBe(SAVER_ID.toString());
      expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    });

    it.each([
      ["Read Runbook Credential", [Permission.ReadRunbookCredential]],
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
    ])(
      "lets it when the person who last saved it holds %s",
      async (_label: string, permissions: Array<Permission>) => {
        saver = person({ permissions });

        await expect(RunbookCredentialReaders.mayRead(step())).resolves.toBe(
          true,
        );
      },
    );

    it("does not let it when the person who last saved it may not read credentials", async () => {
      await expect(RunbookCredentialReaders.mayRead(step())).resolves.toBe(
        false,
      );
    });

    it("does not let it when a block takes the read away from the person who last saved it", async () => {
      saver = person({
        permissions: [Permission.ProjectAdmin],
        blocked: [Permission.ReadRunbookCredential],
      });

      await expect(RunbookCredentialReaders.mayRead(step())).resolves.toBe(
        false,
      );
    });

    it("does not let it when the person who last saved it is no longer a member", async () => {
      saver = null;

      await expect(RunbookCredentialReaders.mayRead(step())).resolves.toBe(
        false,
      );
    });

    it("does not let it, and looks nobody up, when the workflow names nobody as its last saver", async () => {
      await expect(RunbookCredentialReaders.mayRead(step(null))).resolves.toBe(
        false,
      );

      expect(lookUp).not.toHaveBeenCalled();
    });

    it("does not let it, and looks nobody up, for a step with no project", async () => {
      const props: DatabaseCommonInteractionProps = step();
      delete props.tenantId;

      await expect(RunbookCredentialReaders.mayRead(props)).resolves.toBe(
        false,
      );

      expect(lookUp).not.toHaveBeenCalled();
    });

    it("says in a refusal whose permission was asked about, and how to let the workflow do it", () => {
      const note: string = RunbookCredentialReaders.getWorkflowNote(step());

      expect(note).toContain(
        "the person who last saved the workflow's steps has it, and they do not",
      );
      expect(note).toContain(
        "Ask someone who has it to save the workflow's steps.",
      );
    });
  });

  it("names who may by the read list of runbook credentials", () => {
    expect(RunbookCredentialReaders.getTitles()).toBe(
      PermissionHelper.getPermissionTitles(
        new RunbookCredential().getReadPermissions(),
      ).join(", "),
    );
  });
});

/*
 * EVERY RECORD THAT NAMES A RUNBOOK CREDENTIAL IS ONE WHOSE SERVICE ASKS
 * THIS RULE.
 *
 * The check of the records a write names (RelationListPermission) answers a
 * workflow's step by its own Project Admin read, which may read runbook
 * credentials. So each record that may name one has a service that asks
 * RunbookCredentialReaders before it is named, which asks a step's saver -
 * pinned here with where. A new one fails this test until its service asks
 * too and it is added.
 */
const NAMES_A_RUNBOOK_CREDENTIAL: Record<string, string> = {
  "KubernetesCluster.aiAccessCredential":
    "KubernetesClusterService.assertMayChangeAiAccess, which asks it before a credential is bound",
};

describe("the records that name a runbook credential", () => {
  it("are each held to the rule by their service", () => {
    const runbookCredentialTable: string = new RunbookCredential().tableName!;
    const found: Array<string> = [];

    for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
      const model: BaseModel = new modelType();

      if (model.tableName === runbookCredentialTable) {
        continue;
      }

      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

      for (const [column, metadata] of Object.entries(columns)) {
        if (
          metadata.modelType &&
          new metadata.modelType().tableName === runbookCredentialTable
        ) {
          found.push(`${model.tableName}.${column}`);
        }
      }
    }

    expect(found.sort()).toEqual(
      Object.keys(NAMES_A_RUNBOOK_CREDENTIAL).sort(),
    );
  });
});
