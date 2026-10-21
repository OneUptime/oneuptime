import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
  AI_RESOURCE_TYPE_INFO,
  AiResourceTypeInfo,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  RESOURCE_ALLOWLIST_MAX_PATTERNS,
  RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH,
} from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The OneUptime AI access columns of every resource a resource AI agent can
 * serve (DockerHost, PodmanHost, DockerSwarmCluster, ProxmoxCluster,
 * VMwareVCenter, CephCluster, DatabaseServer, Host) — the resource twin of
 * KubernetesClusterAiAccessColumns.test.ts.
 *
 *  - The three settings (isAiInvestigationEnabled, aiRemediationMode,
 *    aiCommandAllowlist) keep the resource's OWN update ACL, exactly like a
 *    cluster's: every editor may make AI do less, and making it do more is
 *    the service's check, not the ACL's. None of them can be set on create.
 *  - The three aiAccess* columns are written only by the server.
 *  - Defaults: investigation on and remediation Disabled, as on a cluster:
 *    AI investigations are on by default, so a resource nobody configured
 *    is investigated read-only as soon as its agent connects, and nothing is
 *    changed until an operator allows fixes.
 *  - Column for column they are declared like the cluster's analogous
 *    columns (same database types), so stored values and the API behave the
 *    same.
 *  - The descriptions are the public API, OpenAPI and Terraform docs: the
 *    mode text is the canonical ResourceAiRemediationMode semantics, and the
 *    loosenable settings name who may loosen them.
 */

type ModelType = { new (): BaseModel; name: string };

interface ResourceCase {
  type: AiResourceType;
  model: ModelType;
  // How the model's own descriptions name the resource ("this Docker host").
  noun: string;
  edit: Permission;
  read: Permission;
}

const CASES: Array<ResourceCase> = [
  {
    type: AiResourceType.DockerHost,
    model: DockerHost,
    noun: "Docker host",
    edit: Permission.EditDockerHost,
    read: Permission.ReadDockerHost,
  },
  {
    type: AiResourceType.PodmanHost,
    model: PodmanHost,
    noun: "Podman host",
    edit: Permission.EditPodmanHost,
    read: Permission.ReadPodmanHost,
  },
  {
    type: AiResourceType.DockerSwarmCluster,
    model: DockerSwarmCluster,
    noun: "Docker Swarm cluster",
    edit: Permission.EditDockerSwarmCluster,
    read: Permission.ReadDockerSwarmCluster,
  },
  {
    type: AiResourceType.ProxmoxCluster,
    model: ProxmoxCluster,
    noun: "Proxmox cluster",
    edit: Permission.EditProxmoxCluster,
    read: Permission.ReadProxmoxCluster,
  },
  {
    type: AiResourceType.VMwareVCenter,
    model: VMwareVCenter,
    noun: "vCenter",
    edit: Permission.EditVMwareVCenter,
    read: Permission.ReadVMwareVCenter,
  },
  {
    type: AiResourceType.CephCluster,
    model: CephCluster,
    noun: "Ceph cluster",
    edit: Permission.EditCephCluster,
    read: Permission.ReadCephCluster,
  },
  {
    type: AiResourceType.DatabaseServer,
    model: DatabaseServer,
    noun: "database server",
    edit: Permission.EditDatabaseServer,
    read: Permission.ReadDatabaseServer,
  },
  {
    type: AiResourceType.Host,
    model: Host,
    noun: "host",
    edit: Permission.EditHost,
    read: Permission.ReadHost,
  },
];

// Columns an operator writes on the resource's AI page (and through the API).
const AI_SETTING_COLUMNS: Array<string> = [
  "isAiInvestigationEnabled",
  "aiRemediationMode",
  "aiCommandAllowlist",
];

// Columns only the server writes.
const SERVER_WRITTEN_COLUMNS: Array<string> = [
  "aiAccessLastVerifiedAt",
  "aiAccessLastError",
  "aiAccessConfiguredAt",
];

// The settings that loosen AI access, and so name who may loosen them.
const LOOSENABLE_COLUMNS: Array<string> = [
  "aiRemediationMode",
  "aiCommandAllowlist",
];

// Each resource column and the KubernetesCluster column it mirrors.
const KUBERNETES_TWIN: Record<string, string> = {
  isAiInvestigationEnabled: "isAiInvestigationEnabled",
  aiRemediationMode: "aiRemediationMode",
  aiCommandAllowlist: "aiKubectlCommandAllowlist",
  aiAccessLastVerifiedAt: "aiAccessLastVerifiedAt",
  aiAccessLastError: "aiAccessLastError",
  aiAccessConfiguredAt: "aiAccessConfiguredAt",
};

const projectId: ObjectID = ObjectID.generate();

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

function declaredColumn(
  model: ModelType,
  property: string,
): ColumnMetadataArgs {
  const declared: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return column.target === model && column.propertyName === property;
      },
    );

  if (!declared) {
    throw new Error(`${model.name} declares no column ${property}`);
  }

  return declared;
}

function description(model: ModelType, column: string): string {
  return new model().getTableColumnMetadata(column).description!;
}

const COMMENT_LINE_PREFIX: RegExp = /^\s*\*\s?/;
const WHITESPACE_RUN: RegExp = /\s+/g;

function normalizeWhitespace(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

/*
 * The canonical description of the resource remediation modes: the doc
 * comment on ResourceAiRemediationMode in
 * Types/ResourceAiAgent/ResourceAiAccess.ts, from "Disabled:" to its end,
 * with the comment markup and the column alignment taken out.
 */
function canonicalRemediationModeText(): string {
  const source: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../Types/ResourceAiAgent/ResourceAiAccess.ts",
    ),
    "utf8",
  );
  const enumAt: number = source.indexOf(
    "export enum ResourceAiRemediationMode",
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

/*
 * The canonical text as one resource's description says it: "this
 * resource" names the resource, and the environment variable constants are
 * spelled out as the operator types them.
 */
function canonicalTextFor(noun: string): string {
  return canonicalRemediationModeText()
    .split("this resource")
    .join(`this ${noun}`)
    .split("the resource's")
    .join(`the ${noun}'s`)
    .split("RESOURCE_AI_ALLOW_WRITES_ENV")
    .join(RESOURCE_AI_ALLOW_WRITES_ENV)
    .split("RESOURCE_AI_WRITE_TARGETS_ENV")
    .join(RESOURCE_AI_WRITE_TARGETS_ENV);
}

function caseTable(): Array<[string, ResourceCase]> {
  return CASES.map((resource: ResourceCase): [string, ResourceCase] => {
    return [resource.model.name, resource];
  });
}

describe("resource AI access columns - coverage", () => {
  it("covers every AiResourceType exactly once, with the model of that name", () => {
    expect(
      CASES.map((resource: ResourceCase) => {
        return resource.type;
      }),
    ).toEqual([...ALL_AI_RESOURCE_TYPES]);

    for (const resource of CASES) {
      expect(new resource.model().tableName).toBe(resource.type);
    }
  });

  it("the canonical mode text still carries the phrases this file substitutes", () => {
    const text: string = canonicalRemediationModeText();

    expect(text).toContain("this resource");
    expect(text).toContain("the resource's");
    expect(text).toContain("RESOURCE_AI_ALLOW_WRITES_ENV");
    expect(text).toContain("RESOURCE_AI_WRITE_TARGETS_ENV");
  });
});

describe.each(caseTable())(
  "%s AI access columns",
  (_name: string, resource: ResourceCase) => {
    const model: BaseModel = new resource.model();
    const accessControl: Record<string, ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();
    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[resource.type];

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
        "%s is updatable by exactly the roles that may edit the resource",
        (column: string) => {
          expect(sorted(accessControl[column]!.update)).toEqual(
            sorted(model.getUpdatePermissions()),
          );
          expect(accessControl[column]!.update).toContain(resource.edit);
        },
      );

      it.each(AI_SETTING_COLUMNS)(
        "%s is readable by exactly the roles that may read the resource",
        (column: string) => {
          expect(sorted(accessControl[column]!.read)).toEqual(
            sorted(model.getReadPermissions()),
          );
          expect(accessControl[column]!.read).toContain(resource.read);
        },
      );

      it.each([Permission.ProjectMember, Permission.SettingsMember])(
        "a %s (an editor, not an AI admin) may write every setting as far as the ACL is concerned",
        (role: Permission) => {
          expect(() => {
            ColumnPermissions.checkDataColumnPermissions(
              resource.model,
              {
                isAiInvestigationEnabled: false,
                aiRemediationMode: ResourceAiRemediationMode.Disabled,
                aiCommandAllowlist: [],
              } as unknown as BaseModel,
              makeProps([role]),
              DatabaseRequestType.Update,
            );
          }).not.toThrow();
        },
      );

      it("a holder of only the resource's own Edit permission may write the settings", () => {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            resource.model,
            {
              aiRemediationMode: ResourceAiRemediationMode.Disabled,
            } as unknown as BaseModel,
            makeProps([resource.edit]),
            DatabaseRequestType.Update,
          );
        }).not.toThrow();
      });

      it("a viewer may read but not write the settings", () => {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            resource.model,
            { isAiInvestigationEnabled: true } as unknown as BaseModel,
            makeProps([Permission.Viewer]),
            DatabaseRequestType.Update,
          );
        }).toThrow();

        const readable: Array<string> =
          ColumnPermissions.getModelColumnsByPermissions(
            resource.model,
            makeProps([Permission.Viewer]).userTenantAccessPermission![
              projectId.toString()
            ]!.permissions,
            DatabaseRequestType.Read,
          ).columns;

        for (const column of [
          ...AI_SETTING_COLUMNS,
          ...SERVER_WRITTEN_COLUMNS,
        ]) {
          expect(readable).toContain(column);
        }
      });

      it("an AI setting cannot be set when creating the resource, even by a project owner", () => {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            resource.model,
            {
              aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
            } as unknown as BaseModel,
            makeProps([Permission.ProjectOwner]),
            DatabaseRequestType.Create,
          );
        }).toThrow(BadDataException);
      });
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
        "%s is readable by exactly the roles that may read the resource",
        (column: string) => {
          expect(sorted(accessControl[column]!.read)).toEqual(
            sorted(model.getReadPermissions()),
          );
        },
      );

      it.each(SERVER_WRITTEN_COLUMNS)(
        "%s is refused even for a project owner and admin",
        (column: string) => {
          expect(() => {
            ColumnPermissions.checkDataColumnPermissions(
              resource.model,
              {
                [column]: column === "aiAccessLastError" ? "x" : new Date(),
              } as unknown as BaseModel,
              makeProps([Permission.ProjectOwner, Permission.ProjectAdmin]),
              DatabaseRequestType.Update,
            );
          }).toThrow(BadDataException);
        },
      );

      it("lets the same owner update an ordinary column (harness negative control)", () => {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            resource.model,
            { name: "prod-1" } as unknown as BaseModel,
            makeProps([Permission.ProjectOwner]),
            DatabaseRequestType.Update,
          );
        }).not.toThrow();
      });

      it.each(SERVER_WRITTEN_COLUMNS)(
        "%s says only the server sets it",
        (column: string) => {
          expect(description(resource.model, column)).toMatch(
            /Set by the server/,
          );
        },
      );
    });

    describe("defaults and storage", () => {
      it("investigation is on by default, in the API metadata and the column", () => {
        const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
          model.getTableColumnMetadata("isAiInvestigationEnabled");

        expect(metadata.type).toBe(TableColumnType.Boolean);
        expect(metadata.required).toBe(true);
        expect(metadata.isDefaultValueColumn).toBe(true);
        expect(metadata.defaultValue).toBe(true);
        expect(
          declaredColumn(resource.model, "isAiInvestigationEnabled").options,
        ).toEqual(
          expect.objectContaining({
            type: ColumnType.Boolean,
            nullable: false,
            default: true,
          }),
        );
      });

      // AI investigations are on by default everywhere: a cluster's too.
      it("investigation starts the way a cluster's does", () => {
        const ours: ColumnMetadataArgs = declaredColumn(
          resource.model,
          "isAiInvestigationEnabled",
        );
        const theirs: ColumnMetadataArgs = declaredColumn(
          KubernetesCluster,
          "isAiInvestigationEnabled",
        );

        expect(ours.options.default).toBe(theirs.options.default);
        expect(
          model.getTableColumnMetadata("isAiInvestigationEnabled").defaultValue,
        ).toBe(
          new KubernetesCluster().getTableColumnMetadata(
            "isAiInvestigationEnabled",
          ).defaultValue,
        );
      });

      it("remediation is Disabled by default, in the API metadata and the column", () => {
        const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
          model.getTableColumnMetadata("aiRemediationMode");

        expect(metadata.type).toBe(TableColumnType.ShortText);
        expect(metadata.required).toBe(true);
        expect(metadata.isDefaultValueColumn).toBe(true);
        expect(metadata.defaultValue).toBe(ResourceAiRemediationMode.Disabled);
        expect(metadata.example).toBe(
          ResourceAiRemediationMode.RequireApproval,
        );
        expect(
          declaredColumn(resource.model, "aiRemediationMode").options,
        ).toEqual(
          expect.objectContaining({
            type: ColumnType.ShortText,
            length: ColumnLength.ShortText,
            nullable: false,
            default: ResourceAiRemediationMode.Disabled,
          }),
        );
      });

      it("every mode fits the mode column", () => {
        for (const mode of Object.values(ResourceAiRemediationMode)) {
          expect(mode.length).toBeLessThanOrEqual(ColumnLength.ShortText);
        }
      });

      it("the allowlist is an optional JSON array", () => {
        const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
          model.getTableColumnMetadata("aiCommandAllowlist");

        expect(metadata.type).toBe(TableColumnType.JSON);
        expect(metadata.required).toBe(false);
        expect(
          declaredColumn(resource.model, "aiCommandAllowlist").options,
        ).toEqual(
          expect.objectContaining({ type: ColumnType.JSON, nullable: true }),
        );
      });

      it.each([
        ["aiAccessLastVerifiedAt", TableColumnType.Date, ColumnType.Date],
        ["aiAccessConfiguredAt", TableColumnType.Date, ColumnType.Date],
        ["aiAccessLastError", TableColumnType.LongText, ColumnType.LongText],
      ])(
        "%s is an optional %s",
        (
          column: string,
          tableType: TableColumnType,
          columnType: ColumnType,
        ) => {
          expect(model.getTableColumnMetadata(column).type).toBe(tableType);
          expect(model.getTableColumnMetadata(column).required).toBe(false);
          expect(declaredColumn(resource.model, column).options).toEqual(
            expect.objectContaining({ type: columnType, nullable: true }),
          );
        },
      );

      /*
       * The same database shape as the cluster's analogous column, so the two
       * stacks store (and the drift check sees) the same thing. The defaults
       * agree too: investigation on, fixes Disabled (pinned above).
       */
      it.each(Object.entries(KUBERNETES_TWIN))(
        "%s is stored like KubernetesCluster.%s",
        (column: string, twin: string) => {
          const ours: ColumnMetadataArgs = declaredColumn(
            resource.model,
            column,
          );
          const theirs: ColumnMetadataArgs = declaredColumn(
            KubernetesCluster,
            twin,
          );

          expect({
            type: ours.options.type,
            length: ours.options.length,
            nullable: ours.options.nullable,
          }).toEqual({
            type: theirs.options.type,
            length: theirs.options.length,
            nullable: theirs.options.nullable,
          });

          const ourAcl: ColumnAccessControl = accessControl[column]!;
          const theirAcl: ColumnAccessControl =
            new KubernetesCluster().getColumnAccessControlFor(twin)!;

          expect({
            create: ourAcl.create,
            updatable: ourAcl.update.length > 0,
          }).toEqual({
            create: theirAcl.create,
            updatable: theirAcl.update.length > 0,
          });
        },
      );

      it("stored modes are interchangeable with a cluster's", () => {
        expect(
          declaredColumn(resource.model, "aiRemediationMode").options.default,
        ).toBe(KubernetesAiRemediationMode.Disabled);
      });
    });

    describe("the column descriptions (the API and Terraform docs)", () => {
      it("aiRemediationMode carries the canonical mode semantics word for word", () => {
        expect(
          normalizeWhitespace(description(resource.model, "aiRemediationMode")),
        ).toContain(canonicalTextFor(resource.noun));
      });

      it("aiRemediationMode names the environment variables the agent reads", () => {
        const text: string = description(resource.model, "aiRemediationMode");

        expect(text).toContain(`${RESOURCE_AI_ALLOW_WRITES_ENV}=true`);
        expect(text).toContain(RESOURCE_AI_WRITE_TARGETS_ENV);
        expect(text).not.toMatch(/RESOURCE_AI_\w+_ENV/);
      });

      it("negative control: the parity check catches a drifted Automatic", () => {
        const drifted: string = canonicalTextFor(resource.noun).replace(
          "a riskier change is proposed for approval",
          "a riskier change also runs on its own",
        );

        expect(drifted).not.toBe(canonicalTextFor(resource.noun));
        expect(
          normalizeWhitespace(description(resource.model, "aiRemediationMode")),
        ).not.toContain(drifted);
      });

      it.each(LOOSENABLE_COLUMNS)(
        "%s names the permissions that may loosen it",
        (column: string) => {
          for (const title of PermissionHelper.getPermissionTitles(
            KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
          )) {
            expect(description(resource.model, column)).toContain(title);
          }
          expect(description(resource.model, column)).toContain(
            `nyone who may edit the ${resource.noun} can`,
          );
        },
      );

      it("isAiInvestigationEnabled says it is on by default, nothing is changed, and every editor may flip it", () => {
        const text: string = description(
          resource.model,
          "isAiInvestigationEnabled",
        );

        expect(text).toMatch(/Nothing is ever changed by an investigation/);
        expect(text).toMatch(/On by default/);
        expect(text).not.toMatch(/Off by default/);
        expect(text).toContain(
          `Anyone who may edit the ${resource.noun} can turn it on or off`,
        );
        expect(text).toContain(info.agentDisplayName);
        expect(text).toMatch(/read-only/);
      });

      it("aiCommandAllowlist states the limits and the word-by-word rule the matcher applies", () => {
        const text: string = description(resource.model, "aiCommandAllowlist");

        expect(text.toLowerCase()).toContain(
          `at most ${RESOURCE_ALLOWLIST_MAX_PATTERNS} patterns`,
        );
        expect(text.toLowerCase()).toContain(
          `at most ${RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH} characters`,
        );
        expect(text).toMatch(/word by word/);
        expect(text).toMatch(/\* stands for exactly one word/);
        expect(text).toMatch(/Denied tier\) never run/);
      });

      /*
       * The first program is the one a pattern for this resource starts with
       * (a host has several; the description names the first and says there
       * are others, so a program added to the list needs no copy edit here).
       */
      it("aiCommandAllowlist names the program its agent runs", () => {
        expect(description(resource.model, "aiCommandAllowlist")).toMatch(
          new RegExp(`\\(${info.programs[0]!}\\b`),
        );
      });

      it.each(["aiAccessLastVerifiedAt", "aiAccessConfiguredAt"])(
        "%s names the resource's AI agent",
        (column: string) => {
          expect(description(resource.model, column)).toContain(
            info.agentDisplayName,
          );
        },
      );
    });
  },
);

describe("who may loosen a resource's AI access", () => {
  /*
   * A resource's mode and allowlist do the job of
   * AutoRemediationRule.executionMode and commandAllowlist, exactly as a
   * cluster's do; the descriptions name that set.
   */
  it.each(["executionMode", "commandAllowlist"])(
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

  it.each(caseTable())(
    "holding only Edit Auto Remediation Rule does not let anyone update a %s at all",
    (_name: string, resource: ResourceCase) => {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          resource.model,
          makeProps([Permission.EditAutoRemediationRule]),
          DatabaseRequestType.Update,
        );
      }).toThrow();
    },
  );
});
