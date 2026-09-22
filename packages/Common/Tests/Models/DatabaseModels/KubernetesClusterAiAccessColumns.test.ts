import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import {
  MAX_KUBECTL_ALLOWLIST_PATTERNS,
  MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH,
} from "../../../Server/Services/KubernetesClusterService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * The access control and the API documentation of a Kubernetes cluster's
 * OneUptime AI access columns.
 *
 * The AI settings columns deliberately keep the cluster's own update ACL:
 * every cluster editor may make AI do LESS, and making it do MORE is
 * refused in KubernetesClusterService unless the caller holds one of
 * KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS (see
 * KubernetesClusterAiSettingsPermission.test.ts). That set must stay the one
 * that may author a FullAuto AutoRemediationRule, because a cluster's AI
 * mode does that rule's job with no rule row; a drift there is how the
 * escalation came in. The columns only the server writes must stay closed
 * to every role. And the column descriptions are the public API, OpenAPI
 * and Terraform docs, so they must say what each mode really does and who
 * may loosen each setting.
 */

const projectId: ObjectID = ObjectID.generate();

// Columns an operator writes on the cluster's AI page (and through the API).
const AI_SETTING_COLUMNS: Array<string> = [
  "aiAccessRunner",
  "aiAccessRunnerId",
  "aiAccessCredential",
  "aiAccessCredentialId",
  "isAiInvestigationEnabled",
  "aiRemediationMode",
  "aiKubectlCommandAllowlist",
];

// Columns only the server writes.
const SERVER_WRITTEN_COLUMNS: Array<string> = [
  "aiAccessLastVerifiedAt",
  "aiAccessLastError",
  "aiAccessConfiguredAt",
  "aiAccessRunnerBoundAt",
];

// The settings that loosen AI access, and so name who may loosen them.
const LOOSENABLE_COLUMNS: Array<string> = [
  "aiAccessRunner",
  "aiAccessRunnerId",
  "aiAccessCredential",
  "aiAccessCredentialId",
  "aiRemediationMode",
  "aiKubectlCommandAllowlist",
];

const CLUSTER_EDITOR_ROLES: Array<Permission> = [
  Permission.SettingsMember,
  Permission.SettingsAdmin,
  Permission.EditKubernetesCluster,
  Permission.ProjectMember,
];

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function sorted(permissions: ReadonlyArray<Permission>): Array<Permission> {
  return [...permissions].sort();
}

function description(column: string): string {
  return new KubernetesCluster().getTableColumnMetadata(column).description!;
}

describe("KubernetesCluster AI access columns", () => {
  const accessControl: Record<string, ColumnAccessControl> =
    new KubernetesCluster().getColumnAccessControlForAllColumns();
  const cluster: KubernetesCluster = new KubernetesCluster();

  describe("the settings an operator writes", () => {
    it.each(AI_SETTING_COLUMNS)(
      "%s exists and cannot be set on create",
      (column: string) => {
        expect(accessControl[column]).toBeDefined();
        expect(accessControl[column]!.create).toEqual([]);
      },
    );

    /*
     * Pinned on purpose: the service, not the ACL, decides who may LOOSEN.
     * Narrowing these to the admin set would stop a Settings Member from
     * turning AI remediation off.
     */
    it.each(AI_SETTING_COLUMNS)(
      "%s is updatable by exactly the roles that may edit the cluster",
      (column: string) => {
        expect(sorted(accessControl[column]!.update)).toEqual(
          sorted(cluster.getUpdatePermissions()),
        );
      },
    );

    it.each(AI_SETTING_COLUMNS)(
      "%s is readable by exactly the roles that may read the cluster",
      (column: string) => {
        expect(sorted(accessControl[column]!.read)).toEqual(
          sorted(cluster.getReadPermissions()),
        );
      },
    );
  });

  describe("the columns only the server writes", () => {
    it.each(SERVER_WRITTEN_COLUMNS)(
      "%s cannot be created or updated by any role",
      (column: string) => {
        expect(accessControl[column]).toBeDefined();
        expect(accessControl[column]!.create).toEqual([]);
        expect(accessControl[column]!.update).toEqual([]);
      },
    );

    it.each(SERVER_WRITTEN_COLUMNS)(
      "%s is refused even for a project owner and admin",
      (column: string) => {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            KubernetesCluster,
            {
              [column]: column === "aiAccessLastError" ? "x" : new Date(),
            } as unknown as KubernetesCluster,
            makeProps([Permission.ProjectOwner, Permission.ProjectAdmin]),
            DatabaseRequestType.Update,
          );
        }).toThrow(BadDataException);
      },
    );

    it("lets the same owner update an ordinary column (harness negative control)", () => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          KubernetesCluster,
          { name: "prod-us" } as unknown as KubernetesCluster,
          makeProps([Permission.ProjectOwner]),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    });
  });

  describe("who may loosen AI access", () => {
    /*
     * A cluster's mode, allowlist and Runner binding do the job of
     * AutoRemediationRule.executionMode, commandAllowlist and commandRunners.
     * If those ACLs change, this set must change with them.
     */
    it.each(["executionMode", "commandAllowlist", "commandRunners"])(
      "is the set that may update AutoRemediationRule.%s",
      (column: string) => {
        const ruleColumn: ColumnAccessControl | null =
          new AutoRemediationRule().getColumnAccessControlFor(column);

        expect(ruleColumn).not.toBeNull();
        expect(sorted(KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS)).toEqual(
          sorted(ruleColumn!.update),
        );
      },
    );

    it.each(CLUSTER_EDITOR_ROLES)(
      "does not include %s, which may edit the cluster but not author a FullAuto rule",
      (role: Permission) => {
        expect(KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS).not.toContain(role);
      },
    );

    /*
     * The admin set is required ON TOP of the right to edit the cluster:
     * a holder of only Edit Auto Remediation Rule cannot update a cluster
     * at all. Owners and admins hold both.
     */
    it("adds to the right to edit the cluster rather than replacing it", () => {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          KubernetesCluster,
          makeProps([Permission.EditAutoRemediationRule]),
          DatabaseRequestType.Update,
        );
      }).toThrow();

      for (const permission of [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]) {
        expect(cluster.getUpdatePermissions()).toContain(permission);
      }
    });

    it("binding a credential takes the permissions that may read credentials", () => {
      expect(sorted(KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS)).toEqual(
        sorted(new RunbookCredential().getReadPermissions()),
      );
    });
  });

  describe("the column descriptions (the API and Terraform docs)", () => {
    const automaticSegment: (text: string) => string = (
      text: string,
    ): string => {
      const start: number = text.indexOf("Automatic:");
      const end: number = text.indexOf("BypassApproval:");
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return text.slice(start, end);
    };

    const CLAIMS_AUTOMATIC_ASKS: RegExp =
      /still asks|asks before|\bask(s)? (for approval )?before/i;

    it("do not claim Automatic asks before a riskier change", () => {
      expect(automaticSegment(description("aiRemediationMode"))).not.toMatch(
        CLAIMS_AUTOMATIC_ASKS,
      );
    });

    /*
     * Negative control: the wording this replaced must trip the check,
     * or the check above proves nothing.
     */
    it("would have caught the old wording", () => {
      const previous: string =
        "Disabled: AI never changes this cluster. RequireApproval: AI composes a kubectl fix and a human approves it with one click. Automatic: AI applies safe fixes (rollout restart, scale, delete a pod, cordon) on its own and still asks before riskier changes. BypassApproval: AI applies every allowed fix on its own and never asks; destructive commands still never run.";

      expect(automaticSegment(previous)).toMatch(CLAIMS_AUTOMATIC_ASKS);
    });

    it("say what Automatic does with a riskier change", () => {
      const automatic: string = automaticSegment(
        description("aiRemediationMode"),
      );

      expect(automatic).toMatch(/never run without a human/);
      expect(automatic).toMatch(/recommendations/);
      expect(automatic).toMatch(/follow-up round/);
      expect(automatic).toMatch(/allowlist/);
    });

    it.each([
      "rollout restart",
      "undo",
      "scale",
      "pod",
      "job",
      "cordon",
      "uncordon",
      "label",
      "annotate",
    ])("name %s among Automatic's safe changes", (verb: string) => {
      expect(automaticSegment(description("aiRemediationMode"))).toContain(
        verb,
      );
    });

    it("say Bypass approval never asks and destructive commands never run", () => {
      const text: string = description("aiRemediationMode");

      expect(text.slice(text.indexOf("BypassApproval:"))).toMatch(/never asks/);
      expect(text).toMatch(/Destructive commands never run in any mode/);
    });

    it.each(LOOSENABLE_COLUMNS)(
      "%s names the permissions that may loosen it",
      (column: string) => {
        for (const title of PermissionHelper.getPermissionTitles(
          KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
        )) {
          expect(description(column)).toContain(title);
        }
        expect(description(column)).toMatch(
          /anyone who may edit the cluster can/i,
        );
      },
    );

    it.each(["aiAccessCredential", "aiAccessCredentialId"])(
      "%s also names the permission to read credentials",
      (column: string) => {
        for (const title of PermissionHelper.getPermissionTitles(
          KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
        )) {
          expect(description(column)).toContain(title);
        }
      },
    );

    it("isAiInvestigationEnabled says every cluster editor may flip it and nothing is changed", () => {
      const text: string = description("isAiInvestigationEnabled");

      expect(text).toMatch(
        /Anyone who may edit the cluster can turn it on or off/,
      );
      expect(text).toMatch(/Nothing is ever changed by an investigation/);
    });

    it("aiKubectlCommandAllowlist states the limits and the prefix rule the server enforces", () => {
      const text: string = description("aiKubectlCommandAllowlist");

      expect(text).toContain(
        `at most ${MAX_KUBECTL_ALLOWLIST_PATTERNS} patterns`,
      );
      expect(text).toContain(
        `at most ${MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH} characters`,
      );
      expect(text).toMatch(/must start with "kubectl " or a \* wildcard/);
    });

    it.each(SERVER_WRITTEN_COLUMNS)(
      "%s says only the server sets it",
      (column: string) => {
        expect(description(column)).toMatch(/Set by the server/);
      },
    );
  });
});
