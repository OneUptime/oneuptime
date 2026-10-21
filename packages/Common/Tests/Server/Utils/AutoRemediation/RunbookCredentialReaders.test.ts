import RunbookCredentialReaders from "../../../../Server/Utils/AutoRemediation/RunbookCredentialReaders";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import RelationListPermission from "../../../../Server/Types/Database/Permissions/RelationListPermission";
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
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

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
 *   - a workflow's step: never. It acts as a Project Admin, who may read
 *     runbook credentials, but that read is not lent to it, whoever saved
 *     the workflow and whatever its variables, webhooks and runs hand it -
 *     no one is looked up.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000002",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000003",
);

// A person whose request names PROJECT_ID, holding `permissions` in `holdsIn`.
function memberOf(
  holdsIn: ObjectID,
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [holdsIn.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: holdsIn,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
            };
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function person(data: {
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
  userType?: UserType | undefined;
}): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: data.userType === UserType.API ? undefined : ObjectID.generate(),
    userType: data.userType || UserType.User,
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

function step(): DatabaseCommonInteractionProps {
  return WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
    workflowName: "Turn on AI commands",
  });
}

describe("RunbookCredentialReaders", () => {
  describe("for a person or an API key", () => {
    it.each([
      ["Read Runbook Credential", [Permission.ReadRunbookCredential]],
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
    ])(
      "lets whoever holds %s",
      (_label: string, permissions: Array<Permission>) => {
        expect(RunbookCredentialReaders.mayRead(person({ permissions }))).toBe(
          true,
        );
        expect(
          RunbookCredentialReaders.mayRead(
            person({ permissions, userType: UserType.API }),
          ),
        ).toBe(true);
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
      (_label: string, permissions: Array<Permission>) => {
        expect(RunbookCredentialReaders.mayRead(person({ permissions }))).toBe(
          false,
        );
      },
    );

    it("a block on Read Runbook Credential takes it away, even from an admin", () => {
      expect(
        RunbookCredentialReaders.mayRead(
          person({
            permissions: [Permission.ProjectAdmin],
            blocked: [Permission.ReadRunbookCredential],
          }),
        ),
      ).toBe(false);
    });

    it("lets OneUptime itself and a master admin", () => {
      expect(
        RunbookCredentialReaders.mayRead({
          isRoot: true,
        } as DatabaseCommonInteractionProps),
      ).toBe(true);

      expect(
        RunbookCredentialReaders.mayRead({
          isMasterAdmin: true,
          tenantId: PROJECT_ID,
        } as DatabaseCommonInteractionProps),
      ).toBe(true);
    });

    it("adds nothing to a refusal", () => {
      expect(
        RunbookCredentialReaders.getWorkflowNote(
          person({ permissions: [Permission.ProjectMember] }),
        ),
      ).toBe("");
    });

    /*
     * A check of a record whose project is known (a cluster's) asks about
     * that project, as the check of the rest of the write does - not about
     * whichever project the request named.
     */
    it("asks about the project it is given, and the caller's own when none is", () => {
      const readsInOther: DatabaseCommonInteractionProps = memberOf(
        OTHER_PROJECT_ID,
        [Permission.ReadRunbookCredential],
      );

      expect(RunbookCredentialReaders.mayRead(readsInOther)).toBe(false);
      expect(
        RunbookCredentialReaders.mayRead(readsInOther, OTHER_PROJECT_ID),
      ).toBe(true);

      const readsInOwn: DatabaseCommonInteractionProps = memberOf(PROJECT_ID, [
        Permission.ReadRunbookCredential,
      ]);

      expect(RunbookCredentialReaders.mayRead(readsInOwn)).toBe(true);
      expect(RunbookCredentialReaders.mayRead(readsInOwn, PROJECT_ID)).toBe(
        true,
      );
      expect(
        RunbookCredentialReaders.mayRead(readsInOwn, OTHER_PROJECT_ID),
      ).toBe(false);

      // The caller's props are read, never changed.
      expect(readsInOther.tenantId!.toString()).toBe(PROJECT_ID.toString());
    });
  });

  describe("for a workflow's step", () => {
    it("acts as a Project Admin, which reads runbook credentials - and is never lent that read", () => {
      expect(
        new RunbookCredential()
          .getReadPermissions()
          .includes(WorkflowPrincipal.PERMISSION),
      ).toBe(true);

      expect(RunbookCredentialReaders.mayRead(step())).toBe(false);
    });

    it("is not lent it by any permission it might carry, not even Read Runbook Credential itself", () => {
      const props: DatabaseCommonInteractionProps = step();

      props.userTenantAccessPermission![
        PROJECT_ID.toString()
      ]!.permissions.push(
        {
          _type: "UserPermission",
          permission: Permission.ReadRunbookCredential,
          labelIds: [],
          isBlockPermission: false,
        },
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
        },
      );

      expect(RunbookCredentialReaders.mayRead(props)).toBe(false);
    });

    it("is not lent it whatever the step's props name besides: a user, a person's type, the step's run", () => {
      const props: DatabaseCommonInteractionProps = {
        ...step(),
        userId: ObjectID.generate(),
      };

      expect(RunbookCredentialReaders.mayRead(props)).toBe(false);
    });

    it("is answered without a project, too, and in any project it is given", () => {
      const props: DatabaseCommonInteractionProps = step();
      delete props.tenantId;

      expect(RunbookCredentialReaders.mayRead(props)).toBe(false);
      expect(RunbookCredentialReaders.mayRead(step(), PROJECT_ID)).toBe(false);
      expect(RunbookCredentialReaders.mayRead(step(), OTHER_PROJECT_ID)).toBe(
        false,
      );
    });

    it("says in a refusal that no step has the permission, so a person has to make the change", () => {
      const note: string = RunbookCredentialReaders.getWorkflowNote(step());

      expect(note).toBe(
        " Workflow steps never have this permission, so a person who has it has to make this change.",
      );
      expect(note).not.toContain("saved");
    });

    it("is the same answer the check of the records a write names gives (RelationListPermission)", () => {
      expect(
        RelationListPermission.mayReadTable(RunbookCredential, step()),
      ).toBe(false);
    });

    /*
     * One place decides that a step is not lent the read of a setting that
     * holds credentials (RelationListPermission.isReadWithheldFromWorkflow):
     * the read, the refusal of a write that names one, and the note a
     * refusal adds all ask it.
     */
    it("is decided in one place, for every setting that holds credentials and nothing else", () => {
      for (const modelType of AllModelTypes as Array<{
        new (): BaseModel;
      }>) {
        const isCredentialSetting: boolean =
          RelationListPermission.isHeldToTableRead(modelType);

        expect(
          RelationListPermission.isReadWithheldFromWorkflow(modelType, step()),
        ).toBe(isCredentialSetting);

        expect(
          RelationListPermission.isReadWithheldFromWorkflow(
            modelType,
            person({ permissions: [Permission.ProjectAdmin] }),
          ),
        ).toBe(false);
      }

      expect(
        RelationListPermission.isReadWithheldFromWorkflow(
          RunbookCredential,
          step(),
        ),
      ).toBe(true);
    });
  });

  it("names who may by the read list of runbook credentials", () => {
    expect(RunbookCredentialReaders.getReadPermissions()).toEqual(
      new RunbookCredential().getReadPermissions(),
    );

    expect(RunbookCredentialReaders.getTitles()).toBe(
      PermissionHelper.getPermissionTitles(
        new RunbookCredential().getReadPermissions(),
      ).join(", "),
    );
  });

  it("is synchronous: nothing is looked up to answer it", () => {
    const answer: unknown = RunbookCredentialReaders.mayRead(
      person({ permissions: [Permission.ProjectAdmin] }),
    );

    expect(typeof answer).toBe("boolean");
  });

  /*
   * The workflow's last saver is gone: nothing reads who saved a workflow's
   * steps to answer a step (RunbookCredentialReaders imports no service,
   * and no props carry a saver).
   */
  it("asks no one who saved a workflow", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../Server/Utils/AutoRemediation/RunbookCredentialReaders.ts",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/AccessTokenService|SavedBy|lastSaved/);
    expect(source).not.toMatch(/from "\.\.\/\.\.\/Services\//);
  });
});

/*
 * EVERY RECORD THAT NAMES A RUNBOOK CREDENTIAL IS ONE WHOSE WRITE IS HELD TO
 * THE RULE.
 *
 * A record that names a runbook credential in a field of its own is held to
 * the caller's read of runbook credentials by the check of the records a
 * write names (RelationListPermission: the settings that hold credentials),
 * which refuses a workflow's step outright - and, where naming it lets
 * OneUptime AI use it, by its service too. Pinned here with where; a new one
 * fails this test until it is looked at and added.
 */
const NAMES_A_RUNBOOK_CREDENTIAL: Record<string, string> = {
  "KubernetesCluster.aiAccessCredential":
    "KubernetesClusterService.assertMayChangeAiAccess asks RunbookCredentialReaders before a credential is bound",
};

describe("the records that name a runbook credential", () => {
  it("are each held to the rule", () => {
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

    expect(RelationListPermission.isHeldToTableRead(RunbookCredential)).toBe(
      true,
    );
  });
});
