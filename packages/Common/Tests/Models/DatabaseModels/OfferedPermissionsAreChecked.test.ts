import AllModelTypes from "../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import {
  getPermissionPropsAllowedInCustomRole,
  PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
} from "../../../Types/Team/CustomRole";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY PERMISSION A CUSTOM ROLE OFFERS IS CHECKED BY SOMETHING.
 *
 * Contract under test: a permission the pickers offer (a custom role's Add
 * Permission, and a team's and an API key's, which offer the same list but
 * Project Owner) is named by the access control of some database or
 * analytics model - a table's create, read, update or delete list, or a
 * column's - or by one of the checks outside the models listed below.
 *
 * The case that prompted it (#7637): #6817 renamed the four permissions
 * that guarded the links between a service and its telemetry services to
 * Service Telemetry Link. The link and its model had gone months before,
 * and nothing had checked the four since - yet the picker offered them
 * under Services, so a role given Read Service Telemetry Link got nothing,
 * and one denied it lost nothing. They are retired now (not offered, and
 * taken from every team, key and role by the migration
 * RemoveServiceTelemetryLinkPermissions1809176500000).
 *
 * The sweep found 28 more of the same kind when it was written. They are
 * the baseline below, each with the issue that fixes it, rather than fixed
 * here: each needs its own decision between wiring the permission into the
 * model it was meant for (which widens access for whoever holds it) and
 * retiring it.
 */

type ModelType = { new (): BaseModel };

const COMMON_ROOT: string = path.join(__dirname, "../../..");
const REPOSITORY_ROOT: string = path.join(COMMON_ROOT, "../..");

const SERVICE_TELEMETRY_LINK_PERMISSIONS: Array<Permission> = [
  Permission.CreateServiceTelemetryService,
  Permission.DeleteServiceTelemetryService,
  Permission.EditServiceTelemetryService,
  Permission.ReadServiceTelemetryService,
];

interface CheckedOutsideModels {
  permission: Permission;
  // The file, under packages/Common, whose code names it.
  file: string;
  why: string;
}

/*
 * The permissions that guard something no model's access lists describe:
 * an action of an API of its own, or a block every check reads. Each one's
 * file must name it in code (not only in a comment), so an exemption goes
 * stale the moment its check does.
 */
const CHECKED_OUTSIDE_MODELS: Array<CheckedOutsideModels> = [
  {
    permission: Permission.DeleteAllOperationalResources,
    file: "Types/HeldPermissions.ts",
    why: "the wildcard a delete of every operational resource accepts (TablePermission), as the Read, Create and Edit ones - which some models also name - are for theirs",
  },
  {
    permission: Permission.EditInvoices,
    file: "Utils/Project/ProjectBilling.ts",
    why: "who pays an open invoice (POST /billing-invoices/pay)",
  },
  {
    permission: Permission.EditBillingPaymentMethod,
    file: "Utils/Project/ProjectBilling.ts",
    why: "who makes a card the project's default payment method",
  },
  {
    permission: Permission.ManageProjectUserNotificationMethod,
    file: "Server/API/UserNotificationMethodAdminAPI.ts",
    why: "who sets up a member's notification methods for them",
  },
  {
    permission: Permission.DownloadPacketCapture,
    file: "Types/PacketCapture/PacketCapturePermissions.ts",
    why: "who downloads a packet capture's file (PacketCaptureAPI)",
  },
  {
    permission: Permission.AuthorizeMcpClient,
    file: "Server/Utils/Mcp/McpOAuthGrantAccess.ts",
    why: "a block of it refuses a member's MCP client grant; every member may connect one",
  },
];

/*
 * Offered, and checked by nothing. Each issue decides, for its own, between
 * wiring it in and retiring it. This list must only ever shrink: a new
 * entry is a new permission that grants nothing.
 */
const KNOWN_UNCHECKED: Array<{ permission: Permission; issue: number }> = [
  // Feeds are append-only: every one has update: [].
  ...[
    Permission.EditAlertEpisodeFeed,
    Permission.EditAlertFeed,
    Permission.EditCephClusterFeed,
    Permission.EditCloudResourceFeed,
    Permission.EditDatabaseServerFeed,
    Permission.EditDockerHostFeed,
    Permission.EditDockerSwarmClusterFeed,
    Permission.EditHostFeed,
    Permission.EditIncidentEpisodeFeed,
    Permission.EditIncidentFeed,
    Permission.EditKubernetesClusterFeed,
    Permission.EditMonitorFeed,
    Permission.EditOnCallDutyPolicyFeed,
    Permission.EditOpenStackCloudFeed,
    Permission.EditPodmanHostFeed,
    Permission.EditProxmoxClusterFeed,
    Permission.EditScheduledMaintenanceFeed,
    Permission.EditServiceFeed,
    Permission.EditServiceLevelObjectiveFeed,
    Permission.EditStorageArrayFeed,
    Permission.EditVMwareVCenterFeed,
  ].map((permission: Permission) => {
    return { permission, issue: 8275 };
  }),
  // A layer's people are checked with the layer's own permissions.
  ...[
    Permission.CreateOnCallDutyPolicyScheduleLayerUser,
    Permission.DeleteOnCallDutyPolicyScheduleLayerUser,
    Permission.EditOnCallDutyPolicyScheduleLayerUser,
    Permission.ReadOnCallDutyPolicyScheduleLayerUser,
  ].map((permission: Permission) => {
    return { permission, issue: 8276 };
  }),
  // Invoices come from the payment provider; labels take each resource's Edit.
  ...[
    Permission.CreateInvoices,
    Permission.DeleteInvoices,
    Permission.AddLabelsToProjectResources,
  ].map((permission: Permission) => {
    return { permission, issue: 8277 };
  }),
];

const MODELS: Array<BaseModel> = (AllModelTypes as Array<ModelType>).map(
  (modelType: ModelType): BaseModel => {
    return new modelType();
  },
);

const ANALYTICS_MODELS: Array<AnalyticsBaseModel> = (
  AnalyticsModels as Array<{ new (): AnalyticsBaseModel }>
).map((modelType: { new (): AnalyticsBaseModel }): AnalyticsBaseModel => {
  return new modelType();
});

// Every permission a database model's table or column access lists name.
function permissionsNamedByDatabaseModels(): Set<string> {
  const named: Set<string> = new Set<string>();

  for (const model of MODELS) {
    for (const permission of [
      ...(model.createRecordPermissions || []),
      ...(model.readRecordPermissions || []),
      ...(model.updateRecordPermissions || []),
      ...(model.deleteRecordPermissions || []),
    ]) {
      named.add(permission.toString());
    }

    for (const column of model.getTableColumns().columns) {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      for (const permission of [
        ...(accessControl?.create || []),
        ...(accessControl?.read || []),
        ...(accessControl?.update || []),
      ]) {
        named.add(permission.toString());
      }
    }
  }

  return named;
}

// Every permission an analytics model's table or column access lists name.
function permissionsNamedByAnalyticsModels(): Set<string> {
  const named: Set<string> = new Set<string>();

  for (const model of ANALYTICS_MODELS) {
    for (const permission of [
      ...model.getCreatePermissions(),
      ...model.getReadPermissions(),
      ...model.getUpdatePermissions(),
      ...model.getDeletePermissions(),
    ]) {
      named.add(permission.toString());
    }

    const columns: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of Object.keys(columns)) {
      for (const permission of [
        ...(columns[column]?.create || []),
        ...(columns[column]?.read || []),
        ...(columns[column]?.update || []),
      ]) {
        named.add(permission.toString());
      }
    }
  }

  return named;
}

const NAMED_BY_DATABASE_MODELS: Set<string> =
  permissionsNamedByDatabaseModels();
const NAMED_BY_ANALYTICS_MODELS: Set<string> =
  permissionsNamedByAnalyticsModels();
const NAMED_BY_MODELS: Set<string> = new Set<string>([
  ...NAMED_BY_DATABASE_MODELS,
  ...NAMED_BY_ANALYTICS_MODELS,
]);

/*
 * The permissions of `offered` that no model names and no check outside
 * the models reads, sorted. Pure: the tests below hand it the catalogue as
 * it is, and as it was before the four were retired.
 */
function findOfferedButUnchecked(data: {
  offered: Array<PermissionProps>;
  namedByModels: Set<string>;
  checkedOutsideModels: Array<Permission>;
}): Array<string> {
  const checkedElsewhere: Set<string> = new Set<string>(
    data.checkedOutsideModels.map((permission: Permission): string => {
      return permission.toString();
    }),
  );

  return data.offered
    .map((props: PermissionProps): string => {
      return props.permission.toString();
    })
    .filter((permission: string): boolean => {
      return (
        !data.namedByModels.has(permission) && !checkedElsewhere.has(permission)
      );
    })
    .sort();
}

// What a custom role offers, from a catalogue: its tenant permissions but Project Owner.
function offeredInCustomRoles(
  catalogue: Array<PermissionProps>,
): Array<PermissionProps> {
  return catalogue.filter((props: PermissionProps): boolean => {
    return (
      props.isAssignableToTenant &&
      !PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE.includes(props.permission)
    );
  });
}

const CHECKED_OUTSIDE_MODEL_PERMISSIONS: Array<Permission> =
  CHECKED_OUTSIDE_MODELS.map((entry: CheckedOutsideModels): Permission => {
    return entry.permission;
  });

const KNOWN_UNCHECKED_PERMISSIONS: Array<string> = KNOWN_UNCHECKED.map(
  (entry: { permission: Permission }): string => {
    return entry.permission.toString();
  },
).sort();

// A file's code: its block and line comments taken out.
function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function offeredNow(): Array<PermissionProps> {
  return getPermissionPropsAllowedInCustomRole();
}

describe("every permission a custom role offers is checked", () => {
  test("the sweep sees every model's lists, the analytics ones too", () => {
    // Database models' table lists, and an analytics table's.
    expect(NAMED_BY_DATABASE_MODELS.has(Permission.ReadService)).toBe(true);
    expect(NAMED_BY_DATABASE_MODELS.has(Permission.CreateProjectMonitor)).toBe(
      true,
    );
    expect(
      NAMED_BY_ANALYTICS_MODELS.has(Permission.ReadTelemetryServiceLog),
    ).toBe(true);
    expect(
      NAMED_BY_DATABASE_MODELS.has(Permission.ReadTelemetryServiceLog),
    ).toBe(false);
    // Most of what is offered is named by a model.
    expect(NAMED_BY_MODELS.size).toBeGreaterThan(1000);
  });

  test("offers nothing no model and no listed check reads, but the known ones", () => {
    expect(
      findOfferedButUnchecked({
        offered: offeredNow(),
        namedByModels: NAMED_BY_MODELS,
        checkedOutsideModels: CHECKED_OUTSIDE_MODEL_PERMISSIONS,
      }),
    ).toEqual(KNOWN_UNCHECKED_PERMISSIONS);
  });

  test("finds the four Service Telemetry Link permissions while they are offered", () => {
    // The catalogue as it was before #7637: the four offered.
    const before: Array<PermissionProps> =
      PermissionHelper.getAllPermissionProps().map(
        (props: PermissionProps): PermissionProps => {
          return SERVICE_TELEMETRY_LINK_PERMISSIONS.includes(props.permission)
            ? { ...props, isAssignableToTenant: true }
            : props;
        },
      );

    expect(
      findOfferedButUnchecked({
        offered: offeredInCustomRoles(before),
        namedByModels: NAMED_BY_MODELS,
        checkedOutsideModels: CHECKED_OUTSIDE_MODEL_PERMISSIONS,
      }),
    ).toEqual(
      [
        ...SERVICE_TELEMETRY_LINK_PERMISSIONS.map(
          (permission: Permission): string => {
            return permission.toString();
          },
        ),
        ...KNOWN_UNCHECKED_PERMISSIONS,
      ].sort(),
    );
  });

  test("finds a permission a model stops checking", () => {
    // Read Service, as if the Service model's lists forgot it.
    const namedWithoutReadService: Set<string> = new Set<string>(
      NAMED_BY_MODELS,
    );
    namedWithoutReadService.delete(Permission.ReadService);

    expect(
      findOfferedButUnchecked({
        offered: offeredNow(),
        namedByModels: namedWithoutReadService,
        checkedOutsideModels: CHECKED_OUTSIDE_MODEL_PERMISSIONS,
      }),
    ).toEqual(
      [
        Permission.ReadService.toString(),
        ...KNOWN_UNCHECKED_PERMISSIONS,
      ].sort(),
    );
  });

  test("the pickers offer none of the four", () => {
    const offered: Array<string> = offeredNow().map(
      (props: PermissionProps): string => {
        return props.permission.toString();
      },
    );
    const tenant: Array<string> =
      PermissionHelper.getTenantPermissionProps().map(
        (props: PermissionProps): string => {
          return props.permission.toString();
        },
      );

    for (const permission of SERVICE_TELEMETRY_LINK_PERMISSIONS) {
      expect({ permission, offered: offered.includes(permission) }).toEqual({
        permission,
        offered: false,
      });
      expect({ permission, tenant: tenant.includes(permission) }).toEqual({
        permission,
        tenant: false,
      });
    }

    // The Services group still offers its services.
    expect(offered).toContain(Permission.ReadService);
    expect(offered).toContain(Permission.CreateService);
  });
});

describe("the checks outside the models are real", () => {
  test.each(
    CHECKED_OUTSIDE_MODELS.map(
      (entry: CheckedOutsideModels): [string, CheckedOutsideModels] => {
        return [entry.permission.toString(), entry];
      },
    ),
  )(
    "%s is named in the code of the file that checks it",
    (_name: string, entry: CheckedOutsideModels) => {
      const file: string = path.join(COMMON_ROOT, entry.file);

      expect({ file: entry.file, exists: fs.existsSync(file) }).toEqual({
        file: entry.file,
        exists: true,
      });
      expect(codeOf(file)).toMatch(
        new RegExp(`\\bPermission\\.${entry.permission}\\b`),
      );
    },
  );

  test("each is offered, and named by no model: otherwise it needs no exemption", () => {
    const offered: Set<string> = new Set<string>(
      offeredNow().map((props: PermissionProps): string => {
        return props.permission.toString();
      }),
    );
    const stale: Array<string> = CHECKED_OUTSIDE_MODELS.filter(
      (entry: CheckedOutsideModels): boolean => {
        return (
          !offered.has(entry.permission) ||
          NAMED_BY_MODELS.has(entry.permission)
        );
      },
    ).map((entry: CheckedOutsideModels): string => {
      return entry.permission;
    });

    expect(stale).toEqual([]);
  });

  test("each is listed once, and none is also a known unchecked one", () => {
    const names: Array<string> = CHECKED_OUTSIDE_MODEL_PERMISSIONS.map(
      (permission: Permission): string => {
        return permission.toString();
      },
    );

    expect(new Set(names).size).toBe(names.length);
    expect(
      names.filter((name: string): boolean => {
        return KNOWN_UNCHECKED_PERMISSIONS.includes(name);
      }),
    ).toEqual([]);
    expect(new Set(KNOWN_UNCHECKED_PERMISSIONS).size).toBe(
      KNOWN_UNCHECKED_PERMISSIONS.length,
    );
  });
});

/*
 * The source the scan reads: the product's TypeScript - Common's (but its
 * tests), the App's feature sets, and the enterprise edition's - without
 * the catalogue itself and the migration that removes the four by name.
 */
const SCANNED_DIRECTORIES: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Types",
  "packages/Common/UI",
  "packages/Common/Utils",
  "packages/Common/Models",
  "packages/App/FeatureSet",
  "ee/Server",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

const NOT_SCANNED: Array<string> = [
  "packages/Common/Types/Permission.ts",
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809176500000-RemoveServiceTelemetryLinkPermissions.ts",
];

const SKIPPED_DIRECTORY_NAMES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
]);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

function sourceFiles(directory: string, into: Array<string>): Array<string> {
  if (!fs.existsSync(directory)) {
    return into;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        sourceFiles(full, into);
      }
    } else if (TYPESCRIPT_FILE.test(entry.name)) {
      into.push(full);
    }
  }

  return into;
}

/*
 * Where the product's code names each of `permissions` - as
 * Permission.<Name> or as the quoted value - outside the catalogue.
 */
function whereNamed(permissions: Array<string>): Dictionary<Array<string>> {
  const pattern: RegExp = new RegExp(
    `(?:\\bPermission\\.(${permissions.join("|")})\\b)|(?:["'\`](${permissions.join("|")})["'\`])`,
    "g",
  );
  const skipped: Set<string> = new Set<string>(
    NOT_SCANNED.map((file: string): string => {
      return path.join(REPOSITORY_ROOT, file);
    }),
  );
  const found: Dictionary<Array<string>> = {};

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of sourceFiles(path.join(REPOSITORY_ROOT, directory), [])) {
      if (skipped.has(file)) {
        continue;
      }

      for (const match of codeOf(file).matchAll(pattern)) {
        const name: string = (match[1] || match[2])!;
        found[name] = [
          ...(found[name] || []),
          path.relative(REPOSITORY_ROOT, file),
        ];
      }
    }
  }

  return found;
}

describe("what the sweep reports is checked nowhere", () => {
  // The scan reads every source file once, for every name together.
  const named: Dictionary<Array<string>> = whereNamed([
    ...SERVICE_TELEMETRY_LINK_PERMISSIONS.map(
      (permission: Permission): string => {
        return permission.toString();
      },
    ),
    ...KNOWN_UNCHECKED_PERMISSIONS,
    // A control: checked outside the models, so the scan must find it.
    Permission.DownloadPacketCapture.toString(),
  ]);

  test("the scan finds a permission that is checked outside the models", () => {
    expect(named[Permission.DownloadPacketCapture]).toEqual(
      expect.arrayContaining([
        "packages/Common/Types/PacketCapture/PacketCapturePermissions.ts",
      ]),
    );
  });

  test("no model, API or page names the four Service Telemetry Link permissions", () => {
    for (const permission of SERVICE_TELEMETRY_LINK_PERMISSIONS) {
      expect({ permission, namedIn: named[permission] || [] }).toEqual({
        permission,
        namedIn: [],
      });
      expect(NAMED_BY_MODELS.has(permission)).toBe(false);
    }
  });

  test("no code names a known unchecked permission: none of them is a false positive", () => {
    /*
     * One that is named somewhere may be checked there: if so, it belongs
     * in CHECKED_OUTSIDE_MODELS, with the file and why.
     */
    const namedSomewhere: Dictionary<Array<string>> = {};

    for (const permission of KNOWN_UNCHECKED_PERMISSIONS) {
      if (named[permission]) {
        namedSomewhere[permission] = named[permission]!;
      }
    }

    expect(namedSomewhere).toEqual({});
  });
});

/*
 * Retiring the four changes no one's access: no list of any model names
 * them, so a role that held them reached nothing through them - and loses
 * nothing now they are gone - and a role that never held them gains
 * nothing either, since no list was changed to let it in.
 */
describe("a role holding the four Service Telemetry Link permissions reaches nothing through them", () => {
  test.each(
    SERVICE_TELEMETRY_LINK_PERMISSIONS.map((p: Permission) => {
      return [p];
    }),
  )(
    "no database model lets %s create, read, change or delete a record or a column",
    (permission: Permission) => {
      const reaches: Array<string> = [];

      for (const model of MODELS) {
        const lists: Dictionary<Array<Permission>> = {
          create: model.createRecordPermissions || [],
          read: model.readRecordPermissions || [],
          update: model.updateRecordPermissions || [],
          delete: model.deleteRecordPermissions || [],
        };

        for (const operation of Object.keys(lists)) {
          if (lists[operation]!.includes(permission)) {
            reaches.push(`${model.tableName}: ${operation}`);
          }
        }

        for (const column of model.getTableColumns().columns) {
          const accessControl: ColumnAccessControl | null =
            model.getColumnAccessControlFor(column);

          for (const operation of ["create", "read", "update"] as const) {
            if ((accessControl?.[operation] || []).includes(permission)) {
              reaches.push(`${model.tableName}.${column}: ${operation}`);
            }
          }
        }
      }

      expect(reaches).toEqual([]);
    },
  );

  test.each(
    SERVICE_TELEMETRY_LINK_PERMISSIONS.map((p: Permission) => {
      return [p];
    }),
  )("no analytics model lets %s reach its data", (permission: Permission) => {
    const reaches: Array<string> = ANALYTICS_MODELS.filter(
      (model: AnalyticsBaseModel): boolean => {
        const columns: Dictionary<ColumnAccessControl> =
          model.getColumnAccessControlForAllColumns();

        return [
          ...model.getCreatePermissions(),
          ...model.getReadPermissions(),
          ...model.getUpdatePermissions(),
          ...model.getDeletePermissions(),
          ...Object.values(columns).flatMap(
            (accessControl: ColumnAccessControl): Array<Permission> => {
              return [
                ...(accessControl.create || []),
                ...(accessControl.read || []),
                ...(accessControl.update || []),
              ];
            },
          ),
        ].includes(permission);
      },
    ).map((model: AnalyticsBaseModel): string => {
      return model.tableName;
    });

    expect(reaches).toEqual([]);
  });

  test("the sweep reads every model the API serves", () => {
    expect(MODELS.length).toBeGreaterThan(500);
    expect(ANALYTICS_MODELS.length).toBeGreaterThan(5);
  });
});

describe("a stored Service Telemetry Link permission still reads", () => {
  test.each(
    SERVICE_TELEMETRY_LINK_PERMISSIONS.map((p: Permission) => {
      return [p];
    }),
  )("%s keeps its value, its title and its group", (permission: Permission) => {
    expect(Object.values(Permission)).toContain(permission);
    expect(PermissionHelper.getTitle(permission)).toMatch(
      /^(Create|Read|Edit|Delete) Service Telemetry Link$/,
    );
    expect(PermissionHelper.getDescription(permission)).toBe(
      "Grants nothing: OneUptime no longer keeps links between services and their telemetry, so no record checks this permission.",
    );

    const props: PermissionProps | undefined =
      PermissionHelper.getAllPermissionPropsAsDictionary()[permission];

    expect(props?.isAssignableToTenant).toBe(false);
    expect(props?.isRolePermission).toBe(false);
    expect(props?.isAccessControlPermission).toBe(false);
  });
});
