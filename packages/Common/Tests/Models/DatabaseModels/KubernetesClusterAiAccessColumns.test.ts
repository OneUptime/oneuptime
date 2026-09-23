import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import KubectlPolicy, {
  KUBECTL_ALLOWLIST_MAX_PATTERNS,
  KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import {
  KubectlCommandTier,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
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
import fs from "fs";
import path from "path";

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

const COMMENT_LINE_PREFIX: RegExp = /^\s*\*\s?/;
const WHITESPACE_RUN: RegExp = /\s+/g;

function normalizeWhitespace(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

/*
 * The canonical description of the remediation modes: the doc comment on
 * KubernetesAiRemediationMode in Types/Kubernetes/KubernetesClusterAiAccess.ts,
 * from "Disabled:" to its end, with the comment markup and the column
 * alignment taken out. Every copy of these semantics (prompts, the AI page,
 * the docs, this column's description) must say the same.
 */
function canonicalRemediationModeText(): string {
  const source: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../Types/Kubernetes/KubernetesClusterAiAccess.ts",
    ),
    "utf8",
  );
  const enumAt: number = source.indexOf(
    "export enum KubernetesAiRemediationMode",
  );
  expect(enumAt).toBeGreaterThan(0);

  const commentStart: number = source.lastIndexOf("/*", enumAt);
  const commentEnd: number = source.indexOf("*/", commentStart);
  expect(commentStart).toBeGreaterThanOrEqual(0);
  expect(commentEnd).toBeLessThan(enumAt);

  const body: string = source
    .slice(commentStart + 2, commentEnd)
    .split("\n")
    .map((line: string) => {
      return line.replace(COMMENT_LINE_PREFIX, "");
    })
    .join(" ");

  const text: string = normalizeWhitespace(body);
  const disabledAt: number = text.indexOf("Disabled:");
  expect(disabledAt).toBeGreaterThanOrEqual(0);

  return text.slice(disabledAt);
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

    /*
     * The column description is the API and Terraform copy of the
     * canonical mode semantics. Round one rewrote it in parallel with the
     * remediation and policy changes and it drifted: it said a riskier
     * change is only proposed by a follow-up round (a round that could only
     * find riskier fixes now proposes them at once) and listed "delete a
     * named pod or job" as safe (deleting a Job is a riskier change).
     */
    it("carries the canonical mode semantics word for word", () => {
      expect(
        normalizeWhitespace(description("aiRemediationMode")).toLowerCase(),
      ).toContain(canonicalRemediationModeText().toLowerCase());
    });

    it("negative control: the parity check catches the round-one wording", () => {
      const roundOne: string =
        "Disabled: AI never proposes or runs a change on this cluster. RequireApproval: AI composes a kubectl plan and a human approves it with one click before anything runs. Automatic: safe kubectl changes to one named object (rollout restart/undo, scale, delete a named pod or job, cordon/uncordon, label/annotate) run on their own; a riskier change (patch, set image, drain, deleting workloads) is never run without a human: AI leaves the exact command in its written recommendations, and only a follow-up round after a failed fix proposes one for approval, unless the kubectl allowlist names its shape. BypassApproval: AI never asks; every change the policy allows, riskier ones included, runs on its own, follow-up rounds too. Destructive commands never run in any mode.";

      expect(normalizeWhitespace(roundOne).toLowerCase()).not.toContain(
        canonicalRemediationModeText().toLowerCase(),
      );
    });

    it.each([
      "only a follow-up round",
      "left for you",
      "left in the recommendations",
      "delete a named pod or job",
      "never asks",
    ])("no longer says %p", (stale: string) => {
      expect(description("aiRemediationMode").toLowerCase()).not.toContain(
        stale,
      );
    });

    it("say what Automatic does with a riskier change", () => {
      const automatic: string = automaticSegment(
        description("aiRemediationMode"),
      );

      expect(automatic).toMatch(/never runs without one/);
      expect(automatic).toMatch(/one-click approval/);
      expect(automatic).toMatch(/follow-up round/);
      expect(automatic).toMatch(/allowlist/);
    });

    it.each([
      "rollout restart",
      "undo",
      "scale one workload above zero",
      "delete one named pod",
      "cordon/uncordon one node",
      "label/annotate",
    ])("name %s among Automatic's safe changes", (change: string) => {
      const automatic: string = automaticSegment(
        description("aiRemediationMode"),
      );
      const safe: string = automatic.slice(0, automatic.indexOf("riskier"));

      expect(safe).toContain(change);
    });

    /*
     * Tied to the policy, not only to the canonical text: what the
     * description calls safe must be what KubectlPolicy tiers SafeWrite.
     */
    it("lists deleting a named pod as safe and deleting a Job as riskier, as the policy tiers them", () => {
      expect(
        KubectlPolicy.evaluateCommand("kubectl delete pod/web-1 -n web").tier,
      ).toBe(KubectlCommandTier.SafeWrite);
      expect(
        KubectlPolicy.evaluateCommand("kubectl delete job/migrate -n web").tier,
      ).toBe(KubectlCommandTier.RiskyWrite);

      const automatic: string = automaticSegment(
        description("aiRemediationMode"),
      );
      const riskierAt: number = automatic.indexOf("riskier");
      const safe: string = automatic.slice(0, riskierAt);
      const riskier: string = automatic.slice(riskierAt);

      expect(safe).toContain("delete one named pod");
      expect(safe).not.toMatch(/\bjobs?\b/);
      expect(riskier).toMatch(/deleting workloads or jobs/);
    });

    it("say Bypass approval does not ask, and what is never automatic in any mode", () => {
      const text: string = description("aiRemediationMode");

      expect(text.slice(text.indexOf("BypassApproval:"))).toMatch(
        /does not ask/,
      );
      expect(text).toMatch(/destructive commands \(Denied tier\) never run/);
      expect(text).toMatch(/a node drain and a node taint always need a human/);
      expect(text).toMatch(
        /breaker trips or another unattended round already holds the cluster/,
      );
      for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
        expect(text).toContain(namespace);
      }
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

    /*
     * Round one described the old whole-command glob ("must start with
     * kubectl or a * wildcard"). KubectlPolicy.matchesAllowlist compares
     * word by word, and the server validates entries with the matcher's own
     * rule (KubectlPolicy.describeAllowlistPatternProblem).
     */
    it("aiKubectlCommandAllowlist states the limits and the word-by-word rule the matcher applies", () => {
      const text: string = description("aiKubectlCommandAllowlist");

      expect(text.toLowerCase()).toContain(
        `at most ${KUBECTL_ALLOWLIST_MAX_PATTERNS} patterns`,
      );
      expect(text.toLowerCase()).toContain(
        `at most ${KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH} characters`,
      );
      expect(text).toMatch(/word by word/);
      expect(text).toMatch(/\* stands for exactly one word/);
      expect(text).toMatch(/leading "kubectl" is optional/);
      expect(text).not.toMatch(/whole command/);
      expect(text).not.toMatch(/must start with/);
    });

    it("aiKubectlCommandAllowlist's example is a pattern the server accepts", () => {
      expect(
        KubectlPolicy.describeAllowlistPatternProblem(
          "kubectl set image deployment/web * -n web",
        ),
      ).toBeNull();
      expect(description("aiKubectlCommandAllowlist")).toContain(
        '["kubectl set image deployment/web * -n web"]',
      );
    });

    it("aiAccessRunner says another cluster's in-cluster Runner cannot be bound", () => {
      for (const column of ["aiAccessRunner", "aiAccessRunnerId"]) {
        expect(description(column)).toMatch(
          /Another cluster's in-cluster Runner cannot be bound/,
        );
      }
    });

    it("aiAccessCredential says the credential must be assigned to the Runner", () => {
      for (const column of ["aiAccessCredential", "aiAccessCredentialId"]) {
        expect(description(column)).toMatch(/assigned to that Runner/);
      }
    });

    it.each(SERVER_WRITTEN_COLUMNS)(
      "%s says only the server sets it",
      (column: string) => {
        expect(description(column)).toMatch(/Set by the server/);
      },
    );
  });
});
