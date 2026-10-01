import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../Models/AnalyticsModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import McpOAuthClient from "../../Models/DatabaseModels/McpOAuthClient";
import McpOAuthGrant from "../../Models/DatabaseModels/McpOAuthGrant";
import McpOAuthToken from "../../Models/DatabaseModels/McpOAuthToken";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import {
  ColumnAccessControl,
  TableAccessControl,
} from "../../Types/BaseDatabase/AccessControl";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../Types/Dictionary";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The three tables behind OAuth sign-in for the MCP server, and the three
 * permissions that govern it.
 *
 * Everything pinned here is configuration that is invisible until it is
 * wrong in production:
 *
 *   - McpOAuthGrant is the ONE table a person reaches through the CRUD API,
 *     and only to list and to revoke. Nothing may create or update a grant
 *     that way - a grant is a person pressing Authorize on the consent
 *     screen, and an API that could write one would be a way to mint access
 *     without that;
 *   - McpOAuthToken and McpOAuthClient hold credential digests and have no
 *     API at all;
 *   - what a grant row shows about itself stops short of the columns the
 *     server decides with (the audience, the SSO evidence);
 *   - revoking is deleting, so the token rows have to go with the grant;
 *   - connecting a client needs no permission, which is what makes the
 *     AuthorizeMcpClient BLOCK the only governance lever.
 */

type ModelType = { new (): BaseModel };

const NO_ACCESS: ColumnAccessControl = { create: [], read: [], update: [] };

const GRANT_READERS: Array<Permission> = [
  Permission.CurrentUser,
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadMcpClientAuthorization,
];

const GRANT_REVOKERS: Array<Permission> = [
  Permission.CurrentUser,
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteMcpClientAuthorization,
];

// What a member (or an administrator) may see of a grant.
const GRANT_VISIBLE_COLUMNS: Array<string> = [
  "project",
  "projectId",
  "user",
  "userId",
  "name",
  "clientId",
  "scope",
  "activatedAt",
  "expiresAt",
  "lastUsedAt",
];

// What the server decides with, and nobody is shown.
const GRANT_HIDDEN_COLUMNS: Array<string> = [
  "resource",
  "ssoProviderType",
  "ssoProviderId",
  "ssoExpiresAt",
];

const TOKEN_COLUMNS: Array<string> = [
  "mcpOAuthGrant",
  "mcpOAuthGrantId",
  "tokenType",
  "tokenHash",
  "expiresAt",
  "consumedAt",
  "codeChallenge",
  "redirectUri",
];

const CLIENT_COLUMNS: Array<string> = [
  "clientName",
  "clientUri",
  "redirectUris",
  "tokenEndpointAuthMethod",
  "clientSecretHash",
  "lastUsedAt",
];

const INTERNAL_MODELS: Array<[string, ModelType, Array<string>]> = [
  ["McpOAuthToken", McpOAuthToken, TOKEN_COLUMNS],
  ["McpOAuthClient", McpOAuthClient, CLIENT_COLUMNS],
];

const ALL_THREE: Array<[string, ModelType]> = [
  ["McpOAuthGrant", McpOAuthGrant],
  ["McpOAuthToken", McpOAuthToken],
  ["McpOAuthClient", McpOAuthClient],
];

const BASE_COLUMNS: Array<string> = new BaseModel().getTableColumns().columns;

function ownColumns(modelType: ModelType): Array<string> {
  return new modelType()
    .getTableColumns()
    .columns.filter((column: string): boolean => {
      return !BASE_COLUMNS.includes(column);
    });
}

function typeormColumn(
  modelType: ModelType,
  propertyName: string,
): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (entry: ColumnMetadataArgs): boolean => {
        return (
          entry.target === modelType && entry.propertyName === propertyName
        );
      },
    );

  if (!column) {
    throw new Error(`${modelType.name}.${propertyName} has no @Column`);
  }

  return column;
}

function typeormRelation(
  modelType: ModelType,
  propertyName: string,
): RelationMetadataArgs {
  const relation: RelationMetadataArgs | undefined =
    getMetadataArgsStorage().relations.find(
      (entry: RelationMetadataArgs): boolean => {
        return (
          entry.target === modelType && entry.propertyName === propertyName
        );
      },
    );

  if (!relation) {
    throw new Error(`${modelType.name}.${propertyName} has no relation`);
  }

  return relation;
}

// The single columns of a model that carry their own @Index().
function indexedColumns(modelType: ModelType): Array<string> {
  return getMetadataArgsStorage()
    .indices.filter((entry: IndexMetadataArgs): boolean => {
      return entry.target === modelType;
    })
    .map((entry: IndexMetadataArgs): string => {
      const columns: Array<string> = Array.isArray(entry.columns)
        ? (entry.columns as Array<string>)
        : [];

      return columns.length === 1 ? (columns[0] as string) : "";
    })
    .filter((column: string): boolean => {
      return column !== "";
    });
}

describe("the three MCP OAuth models", () => {
  test.each(ALL_THREE)(
    "%s is registered in the model index",
    (_name: string, modelType: ModelType) => {
      expect((AllModelTypes as Array<ModelType>).includes(modelType)).toBe(
        true,
      );
    },
  );

  test.each(ALL_THREE)(
    "%s uses its own table, named after the class",
    (name: string, modelType: ModelType) => {
      expect(new modelType().tableName).toBe(name);

      const owners: Array<string> = (AllModelTypes as Array<ModelType>)
        .filter((candidate: ModelType): boolean => {
          return new candidate().tableName === name;
        })
        .map((candidate: ModelType): string => {
          return candidate.name;
        });

      expect(owners).toEqual([name]);
    },
  );

  test.each(ALL_THREE)(
    "%s is not offered as MCP tools, nor documented as a public API",
    (_name: string, modelType: ModelType) => {
      /*
       * An MCP client must not be handed tools that list or delete the very
       * grants and tokens it runs on.
       */
      const model: BaseModel = new modelType();

      expect(model.enableMCP).toBeFalsy();
      expect(model.enableDocumentation).toBeFalsy();
    },
  );

  test.each(ALL_THREE)(
    "%s needs no enterprise license and triggers no workflows",
    (_name: string, modelType: ModelType) => {
      const model: BaseModel = new modelType();

      expect(model.requiresEnterprise).toBeFalsy();
      expect(model.enableWorkflowOn).toBeFalsy();
    },
  );
});

describe("McpOAuthGrant: the one table a person can reach", () => {
  const grant: McpOAuthGrant = new McpOAuthGrant();

  test("is named for people as an MCP Client Authorization", () => {
    // The audit trail and the dashboard's audit page key on this name.
    expect(grant.singularName).toBe("MCP Client Authorization");
    expect(grant.pluralName).toBe("MCP Client Authorizations");
  });

  test("is served from /mcp-client-authorization, a route nothing else uses", () => {
    expect(grant.getCrudApiPath()?.toString()).toBe(
      "/mcp-client-authorization",
    );

    const owners: Array<string> = (AllModelTypes as Array<ModelType>)
      .filter((modelType: ModelType): boolean => {
        return (
          new modelType().getCrudApiPath()?.toString() ===
          "/mcp-client-authorization"
        );
      })
      .map((modelType: ModelType): string => {
        return modelType.name;
      });

    expect(owners).toEqual(["McpOAuthGrant"]);
  });

  test("is tenant scoped by projectId", () => {
    expect(grant.getTenantColumn()).toBe("projectId");
  });

  test("a member reaches their own grants through userId", () => {
    expect(grant.getUserColumn()).toBe("userId");
    expect(grant.currentUserCanAccessColumnBy).toBe("userId");
  });

  describe("who may do what", () => {
    test("NOTHING creates a grant through the API", () => {
      expect(grant.createRecordPermissions).toEqual([]);
      expect(grant.getCreatePermissions()).toEqual([]);
    });

    test("NOTHING updates a grant through the API", () => {
      expect(grant.updateRecordPermissions).toEqual([]);
      expect(grant.getUpdatePermissions()).toEqual([]);
    });

    test("it is read by the member it belongs to, project owners and admins, and holders of the read permission", () => {
      expect(grant.readRecordPermissions).toEqual(GRANT_READERS);
    });

    test("it is revoked by the member it belongs to, project owners and admins, and holders of the delete permission", () => {
      expect(grant.deleteRecordPermissions).toEqual(GRANT_REVOKERS);
    });

    test("the read permission does not revoke, and the delete permission does not read", () => {
      expect(grant.deleteRecordPermissions).not.toContain(
        Permission.ReadMcpClientAuthorization,
      );
      expect(grant.readRecordPermissions).not.toContain(
        Permission.DeleteMcpClientAuthorization,
      );
    });

    test("no project-wide or public permission is on either list", () => {
      /*
       * Every principal in a project holds ProjectUser, and every member
       * ProjectMember: either one here would let any member list - or sign
       * out - everybody else's agents.
       */
      const tooBroad: Array<Permission> = [
        Permission.Public,
        Permission.AuthenticatedRequest,
        Permission.ProjectUser,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.AuthorizeMcpClient,
      ];

      for (const permission of tooBroad) {
        expect(grant.readRecordPermissions).not.toContain(permission);
        expect(grant.deleteRecordPermissions).not.toContain(permission);
      }
    });
  });

  describe("the plan gate", () => {
    test("creating a grant needs the plan creating an API key needs: Growth", () => {
      expect(grant.getCreateBillingPlan()).toBe(PlanType.Growth);
    });

    test("reading and revoking are never plan gated", () => {
      // A project that changes plan must still see what is connected and turn it off.
      expect(grant.getReadBillingPlan()).toBe(PlanType.Free);
      expect(grant.getDeleteBillingPlan()).toBe(PlanType.Free);
      expect(grant.getUpdateBillingPlan()).toBe(PlanType.Free);
    });
  });

  describe("the audit trail", () => {
    test("records connecting and revoking, and not the bookkeeping updates", () => {
      expect(grant.enableAuditLogOn).toEqual({
        create: true,
        update: false,
        delete: true,
        ignoreColumns: ["lastUsedAt", "expiresAt", "activatedAt"],
      });
    });

    test("the row is called by the client's name: the column is `name`", () => {
      // AuditLogService names an entry after the row's `name`.
      expect(grant.hasColumn("name")).toBe(true);
      expect(grant.getTableColumnMetadata("name").title).toBe("Client");
    });
  });

  describe("the columns", () => {
    test("are exactly the ones listed here", () => {
      // A new column has to be placed on one of the two lists deliberately.
      expect(ownColumns(McpOAuthGrant).sort()).toEqual(
        [...GRANT_VISIBLE_COLUMNS, ...GRANT_HIDDEN_COLUMNS].sort(),
      );
    });

    test("NO column can be set or changed through the API", () => {
      const accessControl: Dictionary<ColumnAccessControl> =
        grant.getColumnAccessControlForAllColumns();

      for (const column of grant.getTableColumns().columns) {
        const control: ColumnAccessControl | undefined = accessControl[column];

        // `version` carries no access control of its own.
        if (!control) {
          expect(column).toBe("version");
          continue;
        }

        expect({ column, create: control.create }).toEqual({
          column,
          create: [],
        });
        expect({ column, update: control.update }).toEqual({
          column,
          update: [],
        });
      }
    });

    test.each(GRANT_VISIBLE_COLUMNS)(
      "%s is readable by exactly those who may read the grant",
      (column: string) => {
        expect(grant.getColumnAccessControlFor(column)).toEqual({
          create: [],
          read: GRANT_READERS,
          update: [],
        });
      },
    );

    test.each(GRANT_HIDDEN_COLUMNS)(
      "%s is readable by nobody",
      (column: string) => {
        expect(grant.getColumnAccessControlFor(column)).toEqual(NO_ACCESS);
      },
    );

    test.each(GRANT_HIDDEN_COLUMNS)(
      "%s is server-written, undocumented and unreachable through a relation",
      (column: string) => {
        const metadata: TableColumnMetadata =
          grant.getTableColumnMetadata(column);

        expect({ column, computed: metadata.computed }).toEqual({
          column,
          computed: true,
        });
        expect({
          column,
          hidden: metadata.hideColumnInDocumentation,
        }).toEqual({ column, hidden: true });
        expect({
          column,
          relation: metadata.canReadOnRelationQuery,
        }).toEqual({ column, relation: false });
      },
    );

    test("the timestamps the server maintains are marked server-written", () => {
      for (const column of ["activatedAt", "expiresAt", "lastUsedAt"]) {
        expect({
          column,
          computed: grant.getTableColumnMetadata(column).computed,
        }).toEqual({ column, computed: true });
      }
    });

    test("nothing in the row is encrypted or hashed: a grant holds no secret", () => {
      expect(grant.getEncryptedColumns().columns).toEqual([]);
      expect(grant.getHashedColumns().columns).toEqual([]);
    });
  });

  describe("at the database", () => {
    test("the project, the member, the client, the scope, the audience and the expiry are NOT NULL", () => {
      for (const column of [
        "projectId",
        "userId",
        "name",
        "clientId",
        "scope",
        "resource",
        "expiresAt",
      ]) {
        expect({
          column,
          nullable: typeormColumn(McpOAuthGrant, column).options.nullable,
        }).toEqual({ column, nullable: false });
        expect({
          column,
          required: grant.getTableColumnMetadata(column).required,
        }).toEqual({ column, required: true });
      }
    });

    test("a pending grant has no activation time, and a grant may carry no SSO evidence", () => {
      for (const column of [
        "activatedAt",
        "lastUsedAt",
        "ssoProviderType",
        "ssoProviderId",
        "ssoExpiresAt",
      ]) {
        expect({
          column,
          nullable: typeormColumn(McpOAuthGrant, column).options.nullable,
        }).toEqual({ column, nullable: true });
      }
    });

    test("the lookups it is found by are indexed", () => {
      const indexed: Array<string> = indexedColumns(McpOAuthGrant);

      // projectId / userId: the list; clientId: replacing a client's earlier grants; expiresAt: the sweep.
      for (const column of ["projectId", "userId", "clientId", "expiresAt"]) {
        expect(indexed).toContain(column);
      }
    });

    test("a grant goes when its project or its member does", () => {
      const project: RelationMetadataArgs = typeormRelation(
        McpOAuthGrant,
        "project",
      );
      const user: RelationMetadataArgs = typeormRelation(McpOAuthGrant, "user");

      expect(project.options.onDelete).toBe("CASCADE");
      expect(user.options.onDelete).toBe("CASCADE");
      expect((project.type as () => unknown)()).toBe(Project);
      expect((user.type as () => unknown)()).toBe(User);
    });

    test("the client id is long enough for a metadata document URL", () => {
      expect(grant.getTableColumnMetadata("clientId").type).toBe(
        TableColumnType.LongText,
      );
      expect(
        Number(typeormColumn(McpOAuthGrant, "clientId").options.length),
      ).toBeGreaterThanOrEqual(500);
    });
  });
});

describe("McpOAuthToken and McpOAuthClient: internal, with no API at all", () => {
  test.each(INTERNAL_MODELS)(
    "%s has no CRUD route",
    (_name: string, modelType: ModelType) => {
      expect(new modelType().getCrudApiPath()).toBeFalsy();
    },
  );

  test.each(INTERNAL_MODELS)(
    "%s grants no permission any operation",
    (_name: string, modelType: ModelType) => {
      const model: BaseModel = new modelType();

      expect(model.createRecordPermissions).toEqual([]);
      expect(model.readRecordPermissions).toEqual([]);
      expect(model.updateRecordPermissions).toEqual([]);
      expect(model.deleteRecordPermissions).toEqual([]);
    },
  );

  test.each(INTERNAL_MODELS)(
    "%s carries exactly the columns listed here",
    (_name: string, modelType: ModelType, columns: Array<string>) => {
      expect(ownColumns(modelType).sort()).toEqual([...columns].sort());
    },
  );

  test.each(INTERNAL_MODELS)(
    "%s denies every operation on every column",
    (_name: string, modelType: ModelType) => {
      const model: BaseModel = new modelType();
      const accessControl: Dictionary<ColumnAccessControl> =
        model.getColumnAccessControlForAllColumns();

      for (const column of model.getTableColumns().columns) {
        const control: ColumnAccessControl | undefined = accessControl[column];

        if (!control) {
          expect(column).toBe("version");
          continue;
        }

        expect({ column, control }).toEqual({ column, control: NO_ACCESS });
      }
    },
  );

  test.each(INTERNAL_MODELS)(
    "%s is not tenant scoped, not user scoped, not plan gated and not audited",
    (_name: string, modelType: ModelType) => {
      const model: BaseModel = new modelType();

      expect(model.getTenantColumn()).toBeFalsy();
      expect(model.getUserColumn()).toBeFalsy();
      expect(model.getCreateBillingPlan()).toBeFalsy();
      expect(model.getReadBillingPlan()).toBeFalsy();
      expect(model.enableAuditLogOn).toBeFalsy();
    },
  );

  describe("McpOAuthToken", () => {
    const token: McpOAuthToken = new McpOAuthToken();

    test("the digest is UNIQUE and NOT NULL at the database", () => {
      const column: ColumnMetadataArgs = typeormColumn(
        McpOAuthToken,
        "tokenHash",
      );

      expect(column.options.unique).toBe(true);
      expect(column.options.nullable).toBe(false);
      expect(token.getTableColumnMetadata("tokenHash").required).toBe(true);
    });

    test("the digest is never checked for uniqueness in the application (the check would echo it in an error)", () => {
      expect(token.getTableColumnMetadata("tokenHash").unique).toBeFalsy();
    });

    test("the digest is readable by nobody, server-written and undocumented", () => {
      const metadata: TableColumnMetadata =
        token.getTableColumnMetadata("tokenHash");

      expect(token.getColumnAccessControlFor("tokenHash")).toEqual(NO_ACCESS);
      expect(metadata.computed).toBe(true);
      expect(metadata.hideColumnInDocumentation).toBe(true);
      expect(metadata.canReadOnRelationQuery).toBe(false);
    });

    test("the digest is stored as it is: neither encrypted nor re-hashed", () => {
      // A keyed transform would turn a rotated ENCRYPTION_SECRET into every client being signed out.
      expect(token.getEncryptedColumns().columns).toEqual([]);
      expect(token.getHashedColumns().columns).toEqual([]);
    });

    test("deleting a grant deletes its tokens: the foreign key CASCADES", () => {
      const relation: RelationMetadataArgs = typeormRelation(
        McpOAuthToken,
        "mcpOAuthGrant",
      );

      expect(relation.options.onDelete).toBe("CASCADE");
      expect(relation.options.nullable).toBe(false);
      expect((relation.type as () => unknown)()).toBe(McpOAuthGrant);
      expect(
        token.getTableColumnMetadata("mcpOAuthGrant").manyToOneRelationColumn,
      ).toBe("mcpOAuthGrantId");
    });

    test("a token always belongs to a grant, and always expires", () => {
      for (const column of ["mcpOAuthGrantId", "tokenType", "expiresAt"]) {
        expect({
          column,
          nullable: typeormColumn(McpOAuthToken, column).options.nullable,
        }).toEqual({ column, nullable: false });
      }
    });

    test("the columns only a single-use credential has are optional", () => {
      for (const column of ["consumedAt", "codeChallenge", "redirectUri"]) {
        expect({
          column,
          nullable: typeormColumn(McpOAuthToken, column).options.nullable,
        }).toEqual({ column, nullable: true });
      }
    });

    test("the grant lookup and the retention sweep are indexed", () => {
      const indexed: Array<string> = indexedColumns(McpOAuthToken);

      expect(indexed).toContain("mcpOAuthGrantId");
      expect(indexed).toContain("expiresAt");
    });

    test("the PKCE challenge and the redirect URI are kept out of the documentation", () => {
      for (const column of ["codeChallenge", "redirectUri"]) {
        expect({
          column,
          hidden:
            token.getTableColumnMetadata(column).hideColumnInDocumentation,
        }).toEqual({ column, hidden: true });
      }
    });
  });

  describe("McpOAuthClient", () => {
    const client: McpOAuthClient = new McpOAuthClient();

    test("belongs to no project and no user: registering proves nothing", () => {
      const columns: Array<string> = ownColumns(McpOAuthClient);

      for (const column of ["project", "projectId", "user", "userId"]) {
        expect(columns).not.toContain(column);
      }

      expect(
        getMetadataArgsStorage().relations.filter(
          (entry: RelationMetadataArgs): boolean => {
            return entry.target === McpOAuthClient;
          },
        ),
      ).toEqual([]);
    });

    test("the client secret digest is readable by nobody, server-written and undocumented", () => {
      const metadata: TableColumnMetadata =
        client.getTableColumnMetadata("clientSecretHash");

      expect(client.getColumnAccessControlFor("clientSecretHash")).toEqual(
        NO_ACCESS,
      );
      expect(metadata.computed).toBe(true);
      expect(metadata.hideColumnInDocumentation).toBe(true);
      expect(metadata.canReadOnRelationQuery).toBe(false);
    });

    test("a public client has no secret digest: the column is optional", () => {
      expect(
        typeormColumn(McpOAuthClient, "clientSecretHash").options.nullable,
      ).toBe(true);
    });

    test("the digest is stored as it is: neither encrypted nor re-hashed", () => {
      expect(client.getEncryptedColumns().columns).toEqual([]);
      expect(client.getHashedColumns().columns).toEqual([]);
    });

    test("the name, the redirect URIs, the auth method and the last-used time are NOT NULL", () => {
      for (const column of [
        "clientName",
        "redirectUris",
        "tokenEndpointAuthMethod",
        "lastUsedAt",
      ]) {
        expect({
          column,
          nullable: typeormColumn(McpOAuthClient, column).options.nullable,
        }).toEqual({ column, nullable: false });
      }
    });

    test("the redirect URIs are a JSON list", () => {
      expect(client.getTableColumnMetadata("redirectUris").type).toBe(
        TableColumnType.JSON,
      );
    });

    test("the retention sweep's column is indexed", () => {
      expect(indexedColumns(McpOAuthClient)).toContain("lastUsedAt");
    });
  });
});

describe("the MCP client permissions", () => {
  const NEW_PERMISSIONS: Array<[Permission, string, string]> = [
    [
      Permission.AuthorizeMcpClient,
      "AuthorizeMcpClient",
      "Authorize MCP Client",
    ],
    [
      Permission.ReadMcpClientAuthorization,
      "ReadMcpClientAuthorization",
      "Read MCP Client Authorization",
    ],
    [
      Permission.DeleteMcpClientAuthorization,
      "DeleteMcpClientAuthorization",
      "Revoke MCP Client Authorization",
    ],
  ];

  function propsOf(permission: Permission): PermissionProps | undefined {
    return PermissionHelper.getAllPermissionProps().find(
      (props: PermissionProps): boolean => {
        return props.permission === permission;
      },
    );
  }

  test.each(NEW_PERMISSIONS)(
    "%s is in the Permission enum under its own name",
    (permission: Permission, value: string) => {
      expect(permission).toBe(value);
      expect(Object.values(Permission)).toContain(value);
    },
  );

  test.each(NEW_PERMISSIONS)(
    "%s is described exactly once in the catalogue",
    (permission: Permission) => {
      expect(
        PermissionHelper.getAllPermissionProps().filter(
          (props: PermissionProps): boolean => {
            return props.permission === permission;
          },
        ),
      ).toHaveLength(1);
    },
  );

  test.each(NEW_PERMISSIONS)(
    "%s is a Settings permission a team can be given (or blocked from)",
    (permission: Permission, _value: string, title: string) => {
      const props: PermissionProps | undefined = propsOf(permission);

      expect(props).toBeDefined();
      expect(props!.title).toBe(title);
      expect(props!.group).toBe(PermissionGroup.Settings);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.isAccessControlPermission).toBe(false);
      expect(props!.isRolePermission).toBe(false);
      expect(props!.description.length).toBeGreaterThan(20);
    },
  );

  test.each(NEW_PERMISSIONS)(
    "%s is offered in the team permission picker, and is not a label-scoped or role permission",
    (permission: Permission) => {
      const assignable: Array<Permission> =
        PermissionHelper.getTenantPermissionProps().map(
          (props: PermissionProps): Permission => {
            return props.permission;
          },
        );
      const roles: Array<Permission> =
        PermissionHelper.getRolePermissionProps().map(
          (props: PermissionProps): Permission => {
            return props.permission;
          },
        );

      expect(assignable).toContain(permission);
      expect(roles).not.toContain(permission);
      expect(PermissionHelper.isAccessControlPermission(permission)).toBe(
        false,
      );
    },
  );

  test("Authorize MCP Client says that it is there to be blocked", () => {
    const description: string = propsOf(
      Permission.AuthorizeMcpClient,
    )!.description.toLowerCase();

    expect(description).toContain("block");
    expect(description).toContain("every project member");
  });

  describe("AuthorizeMcpClient is never something a member has to be GRANTED", () => {
    /*
     * Connecting a client needs no permission - every member may - so the
     * only thing this permission can do is refuse, as a block row. If any
     * table or column listed it as a way in, a team that was merely not
     * given it would be locked out, and an allow row for it would start to
     * mean something.
     */

    test("no Postgres model lists it for any operation, on the table or on any column", () => {
      const offenders: Array<string> = [];

      for (const modelType of AllModelTypes as Array<ModelType>) {
        const model: BaseModel = new modelType();

        const tableLists: Array<Array<Permission>> = [
          model.createRecordPermissions || [],
          model.readRecordPermissions || [],
          model.updateRecordPermissions || [],
          model.deleteRecordPermissions || [],
        ];

        if (
          tableLists.some((list: Array<Permission>): boolean => {
            return list.includes(Permission.AuthorizeMcpClient);
          })
        ) {
          offenders.push(`${modelType.name} (table)`);
        }

        const columns: Dictionary<ColumnAccessControl> =
          model.getColumnAccessControlForAllColumns();

        for (const column of Object.keys(columns)) {
          const control: ColumnAccessControl = columns[
            column
          ] as ColumnAccessControl;

          if (
            [control.create, control.read, control.update].some(
              (list: Array<Permission>): boolean => {
                return (list || []).includes(Permission.AuthorizeMcpClient);
              },
            )
          ) {
            offenders.push(`${modelType.name}.${column}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });

    test("no ClickHouse model lists it either", () => {
      const offenders: Array<string> = [];

      for (const modelType of AnalyticsModels) {
        const model: AnalyticsBaseModel = new modelType();
        const table: TableAccessControl | undefined = model.accessControl;

        const lists: Array<Array<Permission>> = [
          table?.create || [],
          table?.read || [],
          table?.update || [],
          table?.delete || [],
        ];

        const columns: Dictionary<ColumnAccessControl> =
          model.getColumnAccessControlForAllColumns();

        for (const column of Object.keys(columns)) {
          const control: ColumnAccessControl = columns[
            column
          ] as ColumnAccessControl;

          lists.push(
            control.create || [],
            control.read || [],
            control.update || [],
          );
        }

        if (
          lists.some((list: Array<Permission>): boolean => {
            return list.includes(Permission.AuthorizeMcpClient);
          })
        ) {
          offenders.push(modelType.name);
        }
      }

      expect(offenders).toEqual([]);
    });

    test("in particular, the grant table's create list is empty rather than naming it", () => {
      expect(new McpOAuthGrant().createRecordPermissions).toEqual([]);
    });
  });

  test("the read and revoke permissions govern the grant table and nothing else", () => {
    const users: Dictionary<Array<string>> = {
      [Permission.ReadMcpClientAuthorization]: [],
      [Permission.DeleteMcpClientAuthorization]: [],
    };

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: BaseModel = new modelType();

      const all: Array<Permission> = [
        ...(model.createRecordPermissions || []),
        ...(model.readRecordPermissions || []),
        ...(model.updateRecordPermissions || []),
        ...(model.deleteRecordPermissions || []),
      ];

      for (const permission of Object.keys(users)) {
        if (all.includes(permission as Permission)) {
          (users[permission] as Array<string>).push(modelType.name);
        }
      }
    }

    expect(users[Permission.ReadMcpClientAuthorization]).toEqual([
      "McpOAuthGrant",
    ]);
    expect(users[Permission.DeleteMcpClientAuthorization]).toEqual([
      "McpOAuthGrant",
    ]);
  });
});
