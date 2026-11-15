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
 * The sweep found 28 more of the same kind when it was written, kept as a
 * baseline while each was decided between wiring it in and retiring it.
 * All 28 are retired now (#8275, #8276, #8277; the migration
 * RemovePermissionsThatGrantNothing1809178600000), and the baseline is
 * gone: the sweep finds nothing. A permission it finds is new, and grants
 * nothing - wire it into the model it is named for, list the check outside
 * the models that reads it below, or retire it as these were.
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

// Feeds only record what happened: every one has update: [].
const RETIRED_FEED_PERMISSIONS: Array<Permission> = [
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
];

// A layer's people are checked with the layer's own permissions.
const RETIRED_LAYER_USER_PERMISSIONS: Array<Permission> = [
  Permission.CreateOnCallDutyPolicyScheduleLayerUser,
  Permission.DeleteOnCallDutyPolicyScheduleLayerUser,
  Permission.EditOnCallDutyPolicyScheduleLayerUser,
  Permission.ReadOnCallDutyPolicyScheduleLayerUser,
];

/*
 * The 28 the sweep found when it was written, and the issue that retired
 * each: offered, and checked by nothing.
 */
const RETIRED_FOR_GRANTING_NOTHING: Array<{
  permission: Permission;
  issue: number;
}> = [
  ...RETIRED_FEED_PERMISSIONS.map((permission: Permission) => {
    return { permission, issue: 8275 };
  }),
  ...RETIRED_LAYER_USER_PERMISSIONS.map((permission: Permission) => {
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

const RETIRED_FOR_GRANTING_NOTHING_PERMISSIONS: Array<string> =
  RETIRED_FOR_GRANTING_NOTHING.map(
    (entry: { permission: Permission }): string => {
      return entry.permission.toString();
    },
  ).sort();

// Every permission retired because nothing checks it.
const RETIRED_PERMISSIONS: Array<string> = [
  ...SERVICE_TELEMETRY_LINK_PERMISSIONS.map((permission: Permission) => {
    return permission.toString();
  }),
  ...RETIRED_FOR_GRANTING_NOTHING_PERMISSIONS,
].sort();

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
 * it is, and as it was before each retired permission was retired.
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

// The catalogue as it was before `permissions` were retired: offered.
function catalogueOfferingAgain(
  permissions: Array<string>,
): Array<PermissionProps> {
  return PermissionHelper.getAllPermissionProps().map(
    (props: PermissionProps): PermissionProps => {
      return permissions.includes(props.permission)
        ? { ...props, isAssignableToTenant: true }
        : props;
    },
  );
}

const CHECKED_OUTSIDE_MODEL_PERMISSIONS: Array<Permission> =
  CHECKED_OUTSIDE_MODELS.map((entry: CheckedOutsideModels): Permission => {
    return entry.permission;
  });

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

  test("offers nothing that no model and no listed check reads", () => {
    expect(
      findOfferedButUnchecked({
        offered: offeredNow(),
        namedByModels: NAMED_BY_MODELS,
        checkedOutsideModels: CHECKED_OUTSIDE_MODEL_PERMISSIONS,
      }),
    ).toEqual([]);
  });

  test("finds the four Service Telemetry Link permissions while they are offered", () => {
    // The catalogue as it was before #7637: the four offered.
    expect(
      findOfferedButUnchecked({
        offered: offeredInCustomRoles(
          catalogueOfferingAgain(SERVICE_TELEMETRY_LINK_PERMISSIONS),
        ),
        namedByModels: NAMED_BY_MODELS,
        checkedOutsideModels: CHECKED_OUTSIDE_MODEL_PERMISSIONS,
      }),
    ).toEqual(
      SERVICE_TELEMETRY_LINK_PERMISSIONS.map(
        (permission: Permission): string => {
          return permission.toString();
        },
      ).sort(),
    );
  });

  test("finds the 28 that grant nothing while they are offered, and no other", () => {
    // The catalogue as it was before #8275, #8276 and #8277: the 28 offered.
    expect(
      findOfferedButUnchecked({
        offered: offeredInCustomRoles(
          catalogueOfferingAgain(RETIRED_FOR_GRANTING_NOTHING_PERMISSIONS),
        ),
        namedByModels: NAMED_BY_MODELS,
        checkedOutsideModels: CHECKED_OUTSIDE_MODEL_PERMISSIONS,
      }),
    ).toEqual(RETIRED_FOR_GRANTING_NOTHING_PERMISSIONS);
  });

  test.each(
    RETIRED_FOR_GRANTING_NOTHING.map(
      (entry: { permission: Permission; issue: number }) => {
        return [entry.permission.toString(), entry.issue];
      },
    ),
  )(
    "finds %s on its own, were it offered again (#%s)",
    (permission: string) => {
      expect(
        findOfferedButUnchecked({
          offered: offeredInCustomRoles(catalogueOfferingAgain([permission])),
          namedByModels: NAMED_BY_MODELS,
          checkedOutsideModels: CHECKED_OUTSIDE_MODEL_PERMISSIONS,
        }),
      ).toEqual([permission]);
    },
  );

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
    ).toEqual([Permission.ReadService.toString()]);
  });

  test("the pickers offer none of the retired permissions", () => {
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

    expect(RETIRED_PERMISSIONS).toHaveLength(32);

    for (const permission of RETIRED_PERMISSIONS) {
      expect({ permission, offered: offered.includes(permission) }).toEqual({
        permission,
        offered: false,
      });
      expect({ permission, tenant: tenant.includes(permission) }).toEqual({
        permission,
        tenant: false,
      });
    }
  });

  test.each([
    // The Services group still offers its services.
    [Permission.ReadService],
    [Permission.CreateService],
    // Every feed is still read and written to with its own permissions.
    [Permission.CreateIncidentFeed],
    [Permission.ReadIncidentFeed],
    [Permission.CreateServiceLevelObjectiveFeed],
    [Permission.ReadServiceLevelObjectiveFeed],
    // A layer's people are added, moved, taken out and read with these.
    [Permission.CreateOnCallDutyPolicyScheduleLayer],
    [Permission.EditOnCallDutyPolicyScheduleLayer],
    [Permission.DeleteOnCallDutyPolicyScheduleLayer],
    [Permission.ReadOnCallDutyPolicyScheduleLayer],
    // Invoices are still read, and paid.
    [Permission.ReadInvoices],
    [Permission.EditInvoices],
    // Labels are still made, and put on a resource with its Edit.
    [Permission.CreateProjectLabel],
    [Permission.EditProjectMonitor],
  ])(
    "%s, which something checks, is still offered",
    (permission: Permission) => {
      expect(
        offeredNow().map((props: PermissionProps): string => {
          return props.permission.toString();
        }),
      ).toContain(permission);
    },
  );
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

  test("each is listed once, and none is also a retired one", () => {
    const names: Array<string> = CHECKED_OUTSIDE_MODEL_PERMISSIONS.map(
      (permission: Permission): string => {
        return permission.toString();
      },
    );

    expect(new Set(names).size).toBe(names.length);
    expect(
      names.filter((name: string): boolean => {
        return RETIRED_PERMISSIONS.includes(name);
      }),
    ).toEqual([]);
    expect(new Set(RETIRED_PERMISSIONS).size).toBe(RETIRED_PERMISSIONS.length);
  });
});

/*
 * The source the scan reads: the product's TypeScript - Common's (but its
 * tests), the App's feature sets, and the enterprise edition's - without
 * the catalogue itself and the migrations that remove the retired
 * permissions by name (RemoveServiceTelemetryLinkPermissions;
 * RemovePermissionsTeamsCannotBeGiven, which removes the four again with
 * every other permission no team may hold; and
 * RemovePermissionsThatGrantNothing, which removes the 28).
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
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809178100000-RemovePermissionsTeamsCannotBeGiven.ts",
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809178600000-RemovePermissionsThatGrantNothing.ts",
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
    ...RETIRED_PERMISSIONS,
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

  test.each(
    RETIRED_PERMISSIONS.map((permission: string) => {
      return [permission];
    }),
  )(
    "no model, API or page names %s, retired as nothing checks it",
    (permission: string) => {
      /*
       * One that is named somewhere may be checked there: if so, it belongs
       * in CHECKED_OUTSIDE_MODELS, with the file and why, and is offered.
       */
      expect({ permission, namedIn: named[permission] || [] }).toEqual({
        permission,
        namedIn: [],
      });
      expect(NAMED_BY_MODELS.has(permission)).toBe(false);
    },
  );
});

/*
 * Retiring them changes no one's access: no list of any model names them,
 * so a role that held them reached nothing through them - and loses nothing
 * now they are gone - and a role that never held them gains nothing either,
 * since no list was changed to let it in.
 */
describe("a role holding a retired permission reaches nothing through it", () => {
  test.each(
    RETIRED_PERMISSIONS.map((permission: string) => {
      return [permission];
    }),
  )(
    "no database model lets %s create, read, change or delete a record or a column",
    (permission: string) => {
      const reaches: Array<string> = [];

      for (const model of MODELS) {
        const lists: Dictionary<Array<Permission>> = {
          create: model.createRecordPermissions || [],
          read: model.readRecordPermissions || [],
          update: model.updateRecordPermissions || [],
          delete: model.deleteRecordPermissions || [],
        };

        for (const operation of Object.keys(lists)) {
          if (lists[operation]!.includes(permission as Permission)) {
            reaches.push(`${model.tableName}: ${operation}`);
          }
        }

        for (const column of model.getTableColumns().columns) {
          const accessControl: ColumnAccessControl | null =
            model.getColumnAccessControlFor(column);

          for (const operation of ["create", "read", "update"] as const) {
            if (
              (accessControl?.[operation] || []).includes(
                permission as Permission,
              )
            ) {
              reaches.push(`${model.tableName}.${column}: ${operation}`);
            }
          }
        }
      }

      expect(reaches).toEqual([]);
    },
  );

  test.each(
    RETIRED_PERMISSIONS.map((permission: string) => {
      return [permission];
    }),
  )("no analytics model lets %s reach its data", (permission: string) => {
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
        ].includes(permission as Permission);
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

/*
 * A row stored before the 28 were retired, or a value an API call still
 * sends, still parses and shows its title - unchanged, so the people who
 * gave it recognise it - and its description says it grants nothing, and
 * where the permission that does is.
 */
describe("a stored permission that granted nothing still reads", () => {
  const TITLES: Dictionary<string> = {
    [Permission.EditAlertEpisodeFeed]: "Edit Alert Episode Feed",
    [Permission.EditAlertFeed]: "Edit Alert Feed",
    [Permission.EditCephClusterFeed]: "Edit Ceph Cluster Feed",
    [Permission.EditCloudResourceFeed]: "Edit Cloud Resource Feed",
    [Permission.EditDatabaseServerFeed]: "Edit Database Feed",
    [Permission.EditDockerHostFeed]: "Edit Docker Host Feed",
    [Permission.EditDockerSwarmClusterFeed]: "Edit Docker Swarm Cluster Feed",
    [Permission.EditHostFeed]: "Edit Host Feed",
    [Permission.EditIncidentEpisodeFeed]: "Edit Incident Episode Feed",
    [Permission.EditIncidentFeed]: "Edit Incident Feed",
    [Permission.EditKubernetesClusterFeed]: "Edit Kubernetes Cluster Feed",
    [Permission.EditMonitorFeed]: "Edit Monitor Feed",
    [Permission.EditOnCallDutyPolicyFeed]: "Edit On-Call Policy Feed",
    [Permission.EditOpenStackCloudFeed]: "Edit OpenStack Cloud Feed",
    [Permission.EditPodmanHostFeed]: "Edit Podman Host Feed",
    [Permission.EditProxmoxClusterFeed]: "Edit Proxmox Cluster Feed",
    [Permission.EditScheduledMaintenanceFeed]: "Edit Scheduled Maintenance Feed",
    [Permission.EditServiceFeed]: "Edit Service Feed",
    [Permission.EditServiceLevelObjectiveFeed]: "Edit SLO Feed",
    [Permission.EditStorageArrayFeed]: "Edit Storage Array Feed",
    [Permission.EditVMwareVCenterFeed]: "Edit vCenter Feed",
    [Permission.CreateOnCallDutyPolicyScheduleLayerUser]:
      "Create On-Call Schedule Layer User",
    [Permission.DeleteOnCallDutyPolicyScheduleLayerUser]:
      "Delete On-Call Schedule Layer User",
    [Permission.EditOnCallDutyPolicyScheduleLayerUser]:
      "Edit On-Call Schedule Layer User",
    [Permission.ReadOnCallDutyPolicyScheduleLayerUser]:
      "Read On-Call Schedule Layer User",
    [Permission.CreateInvoices]: "Create Invoices",
    [Permission.DeleteInvoices]: "Delete Invoices",
    [Permission.AddLabelsToProjectResources]: "Add Label to Resources",
  };

  test("every one of the 28 has its title", () => {
    expect(Object.keys(TITLES).sort()).toEqual(
      RETIRED_FOR_GRANTING_NOTHING_PERMISSIONS,
    );
  });

  test.each(
    RETIRED_FOR_GRANTING_NOTHING_PERMISSIONS.map((permission: string) => {
      return [permission];
    }),
  )(
    "%s keeps its value, its title and its group, and is never offered",
    (permission: string) => {
      expect(Object.values(Permission)).toContain(permission);
      expect(PermissionHelper.getTitle(permission as Permission)).toBe(
        TITLES[permission],
      );

      const props: PermissionProps | undefined =
        PermissionHelper.getAllPermissionPropsAsDictionary()[permission];

      expect(props?.isAssignableToTenant).toBe(false);
      expect(props?.isRolePermission).toBe(false);
      expect(props?.isAccessControlPermission).toBe(false);
      expect(PermissionHelper.isAssignableToTenant(permission)).toBe(false);
      // A sentence that says so, first.
      expect(PermissionHelper.getDescription(permission as Permission)).toMatch(
        /^Grants nothing: [^\n]+\.$/,
      );
    },
  );

  test.each(
    RETIRED_FEED_PERMISSIONS.map((permission: Permission) => {
      return [permission];
    }),
  )("%s says a feed's entries are never edited", (permission: Permission) => {
    expect(PermissionHelper.getDescription(permission)).toMatch(
      /^Grants nothing: the feed of an? [^,]+ only records what happened, so no entry of it can be edited\.$/,
    );
  });

  test.each([
    [
      Permission.CreateOnCallDutyPolicyScheduleLayerUser,
      Permission.CreateOnCallDutyPolicyScheduleLayer,
    ],
    [
      Permission.DeleteOnCallDutyPolicyScheduleLayerUser,
      Permission.DeleteOnCallDutyPolicyScheduleLayer,
    ],
    [
      Permission.EditOnCallDutyPolicyScheduleLayerUser,
      Permission.EditOnCallDutyPolicyScheduleLayer,
    ],
    [
      Permission.ReadOnCallDutyPolicyScheduleLayerUser,
      Permission.ReadOnCallDutyPolicyScheduleLayer,
    ],
  ])(
    "%s names the permission that does what it says: %s",
    (retired: Permission, granting: Permission) => {
      expect(PermissionHelper.getDescription(retired)).toContain(
        PermissionHelper.getTitle(granting),
      );
      // And that one says it covers a layer's people.
      expect(PermissionHelper.getDescription(granting)).toMatch(/people|who/);
    },
  );

  test("Add Label to Resources names where labelling is granted", () => {
    expect(
      PermissionHelper.getDescription(Permission.AddLabelsToProjectResources),
    ).toContain(PermissionHelper.getTitle(Permission.EditProjectMonitor));
  });

  test.each([[Permission.CreateInvoices], [Permission.DeleteInvoices]])(
    "%s says invoices come from the payment provider",
    (permission: Permission) => {
      expect(PermissionHelper.getDescription(permission)).toContain(
        "invoices come from the payment provider",
      );
    },
  );
});
