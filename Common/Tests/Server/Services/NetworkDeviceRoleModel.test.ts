import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "../../../Models/DatabaseModels/NetworkDeviceRole";
import Project from "../../../Models/DatabaseModels/Project";
import NetworkDeviceRoleService from "../../../Server/Services/NetworkDeviceRoleService";
import ProjectService from "../../../Server/Services/ProjectService";
import Services from "../../../Server/Services/Index";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getUniqueColumnBy } from "../../../Types/Database/UniqueColumnBy";
import GenericFunction from "../../../Types/GenericFunction";
import DEFAULT_NETWORK_DEVICE_ROLES, {
  DefaultNetworkDeviceRole,
} from "../../../Types/NetworkDevice/DefaultNetworkDeviceRole";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";

/*
 * NetworkDeviceRole: the contracts that live in metadata and in wiring rather
 * than in code, and which therefore no functional test would notice losing.
 *
 * Device roles used to be a fixed TypeScript union with the label, the
 * topology silhouette and the "is this a core device?" flag hardcoded in three
 * different modules. They are now a per-project table an operator edits, and
 * two properties of that table are what keep the rest of the feature standing:
 *
 *  1. THE KEY IS SERVER-OWNED AND IMMUTABLE. The SNMP classifier is
 *     evidence-driven: it answers in the built-in vocabulary ("router",
 *     "wirelessAccessPoint") and can never invent a project's custom role. The
 *     key is what its answer is matched back to, so it has to survive a
 *     rename. Grant anybody update on it and renaming "Wireless AP" to
 *     "Access Point" — or an over-helpful form that submits every field —
 *     silently re-points, or unpoints, every access point already classified.
 *
 *  2. EVERY PROJECT GETS THE SAME SEEDED SET. Both the project-creation hook
 *     and the backfill for projects that predate the table seed from the one
 *     DEFAULT_NETWORK_DEVICE_ROLES list, through the same public method, so a
 *     project created yesterday and one created today cannot disagree about
 *     what "Router" means.
 *
 * Nothing here touches a database: the model is instantiated and read for its
 * decorator metadata, the seeder is run against spied services, and the two
 * pieces of wiring that live in another workspace are read off the source.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const PROJECT_SERVICE_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../Server/Services/ProjectService.ts"),
  "utf8",
);

/*
 * The API router and the backfill both live in the App workspace, which this
 * suite cannot import. They are read as text — the same thing the other
 * wiring tests in this directory do — so the assertion is on the registration
 * itself rather than on a re-export somebody could add to make it pass.
 */
const BASE_API_INDEX_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
  "utf8",
);

const BACKFILL_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "../../../../App/FeatureSet/Workers/DataMigrations/BackfillNetworkDeviceRoles.ts",
  ),
  "utf8",
);

function relationArgs(
  target: GenericFunction,
  propertyName: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === target && relation.propertyName === propertyName
      );
    },
  );
}

function accessControlFor(
  model: BaseModel,
  columnName: string,
): ColumnAccessControl {
  const accessControl: ColumnAccessControl | null =
    model.getColumnAccessControlFor(columnName);

  expect(accessControl).not.toBeNull();

  return accessControl as ColumnAccessControl;
}

describe("NetworkDeviceRole is a project-scoped, API-exposed lookup table", () => {
  const role: NetworkDeviceRole = new NetworkDeviceRole();

  /*
   * The tenant column is what makes every read, write and permission check
   * project-scoped by default. Without it a role table is global, and one
   * project's custom roles show up in another's picker.
   */
  test("it is scoped to a project by projectId", () => {
    expect(role.getTenantColumn()).toBe("projectId");
  });

  test("it is served at /network-device-role", () => {
    expect(role.getCrudApiPath()?.toString()).toBe("/network-device-role");
  });

  /*
   * A model that is not in AllModelTypes gets no table created for it and no
   * permission catalogue coverage — the settings page would 500 on first
   * load.
   */
  test("the model is registered", () => {
    expect(AllModelTypes).toContain(NetworkDeviceRole);
  });

  test("the service is registered", () => {
    expect(Services).toContain(NetworkDeviceRoleService);
  });

  /*
   * ...and the CRUD router is mounted. The settings page is entirely
   * model-backed — it does nothing but list, create and edit through this
   * endpoint — so an unmounted router is a page that 404s on every action.
   */
  test("the CRUD router is mounted in the API", () => {
    expect(BASE_API_INDEX_SOURCE).toContain(
      'import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";',
    );
    expect(BASE_API_INDEX_SOURCE).toContain(
      "new BaseAPI<NetworkDeviceRole, NetworkDeviceRoleServiceType>(",
    );
    expect(BASE_API_INDEX_SOURCE).toContain("NetworkDeviceRoleService,");
  });
});

describe("the key column is server-derived and immutable", () => {
  const role: NetworkDeviceRole = new NetworkDeviceRole();

  /*
   * THE INVARIANT THIS FILE EXISTS FOR.
   *
   * An operator names a role; they never name its identifier. The key is
   * derived once, by the service, from the name at create time — and it is
   * what the SNMP classifier's answer and every stored topology payload are
   * matched against. Empty create and empty update mean the API cannot set it
   * on the way in or move it afterwards, so classification keeps matching
   * across a rename. Granting update to even ProjectOwner would be enough:
   * the settings form posts the whole row.
   */
  test("nobody, at any permission level, may create or update the key", () => {
    const accessControl: ColumnAccessControl = accessControlFor(role, "key");

    expect(accessControl.create).toEqual([]);
    expect(accessControl.update).toEqual([]);
  });

  /*
   * Read is a different matter and must stay open: the topology API selects
   * networkDeviceRole.key on every map load to stamp nodes with their role,
   * and a Viewer looking at the map is the least-privileged caller that does
   * it.
   */
  test("but it stays readable, because the topology map matches on it", () => {
    const accessControl: ColumnAccessControl = accessControlFor(role, "key");

    expect(accessControl.read).toContain(Permission.ReadNetworkDeviceRole);
    expect(accessControl.read).toContain(Permission.Viewer);
  });

  test("it is selectable through the device relation, which is how the map reads it", () => {
    const metadata: TableColumnMetadata = role.getTableColumnMetadata("key");

    expect(metadata.canReadOnRelationQuery).toBe(true);
  });

  /*
   * The contrast is the point. The name is the label and is meant to be
   * edited; the key is the identity and is not. If a future edit ever makes
   * the two look alike, one of these two assertions fails.
   */
  test("the name, by contrast, is editable — label and identity are separate columns", () => {
    const accessControl: ColumnAccessControl = accessControlFor(role, "name");

    expect(accessControl.update).toContain(Permission.EditNetworkDeviceRole);
    expect(accessControl.update.length).toBeGreaterThan(0);
  });
});

describe("a role's name is unique within its project, not globally", () => {
  const role: NetworkDeviceRole = new NetworkDeviceRole();

  /*
   * Global uniqueness would mean the first project to create "Router" stops
   * every other project from having one. Scoping to projectId is also what
   * the seeder's idempotency guard leans on.
   */
  test("name is unique per project", () => {
    expect(getUniqueColumnBy(role, "name")).toBe("projectId");
  });

  /*
   * The key is scoped the same way and for a stronger reason: two rows in one
   * project sharing a key would make the classifier's lookup ambiguous, so a
   * device classified as a switch could land on either row.
   */
  test("key is unique per project too, so classification never has two answers", () => {
    expect(getUniqueColumnBy(role, "key")).toBe("projectId");
  });
});

describe("NetworkDevice points at a role without depending on one", () => {
  const device: NetworkDevice = new NetworkDevice();

  test("it has a networkDeviceRoleId column and the relation behind it", () => {
    const idMetadata: TableColumnMetadata = device.getTableColumnMetadata(
      "networkDeviceRoleId",
    );

    expect(idMetadata).toBeDefined();
    expect(idMetadata.type).toBe(TableColumnType.ObjectID);
    expect(idMetadata.required).toBe(false);

    const relationMetadata: TableColumnMetadata =
      device.getTableColumnMetadata("networkDeviceRole");

    expect(relationMetadata.type).toBe(TableColumnType.Entity);
    expect(relationMetadata.modelType).toBe(NetworkDeviceRole);
    expect(relationMetadata.manyToOneRelationColumn).toBe(
      "networkDeviceRoleId",
    );
  });

  /*
   * Configuration must never delete inventory: removing a role from the
   * settings page puts its devices back to being classified from their own
   * SNMP identity, which is exactly what an unset role has always meant. A
   * CASCADE here — the action every other NetworkDevice relation uses — would
   * mean deleting "Printer" deletes the printers.
   */
  test("deleting the role detaches the devices rather than deleting them", () => {
    expect(
      relationArgs(NetworkDevice, "networkDeviceRole")?.options.onDelete,
    ).toBe("SET NULL");
  });

  /*
   * The deprecated inline string is retained on purpose — the backfill reads
   * it to point each device at its new role row — but it has to be labelled
   * loudly enough that nobody writes new code against it, because the plan is
   * to drop it once the backfill has run everywhere.
   */
  test("the old deviceRole string survives, marked deprecated for the backfill", () => {
    const metadata: TableColumnMetadata =
      device.getTableColumnMetadata("deviceRole");

    expect(metadata).toBeDefined();
    expect(metadata.title).toContain("Deprecated");
    expect(metadata.description?.toLowerCase()).toContain("deprecated");
  });
});

describe("the seeded defaults", () => {
  /*
   * The seeder's idempotency guard is a lookup by name and by key, so a
   * duplicate in this list would make it seed one row and then skip the
   * other — silently shipping a project one role short.
   */
  test("carry no duplicate names or keys", () => {
    const names: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.map(
      (role: DefaultNetworkDeviceRole): string => {
        return role.name;
      },
    );
    const keys: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.map(
      (role: DefaultNetworkDeviceRole): string => {
        return role.key;
      },
    );

    expect(new Set(names).size).toBe(names.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /*
   * "unknown" is the classifier saying it has no answer, not a role an
   * operator assigns. Seeding it would put "Unknown" in the role picker,
   * where choosing it would mean "stop classifying this device forever"
   * rather than "I don't know yet".
   */
  test("do not include the classifier's own no-answer value", () => {
    expect(
      DEFAULT_NETWORK_DEVICE_ROLES.map(
        (role: DefaultNetworkDeviceRole): string => {
          return role.key;
        },
      ),
    ).not.toContain("unknown");
  });
});

describe("every project is seeded with the default device roles", () => {
  let createSpy: jest.SpyInstance;

  beforeEach(() => {
    /*
     * getExistingProjectScopedNames reads the project's roles through
     * findBy; getKeysInProject is the second half of the idempotency guard.
     * Both are stubbed empty here so this describe block sees a brand new
     * project, and overridden per-test where the guard itself is the subject.
     */
    jest.spyOn(NetworkDeviceRoleService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(NetworkDeviceRoleService, "getKeysInProject")
      .mockResolvedValue(new Set<string>());

    createSpy = jest
      .spyOn(NetworkDeviceRoleService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<NetworkDeviceRole>,
        ): Promise<NetworkDeviceRole> => {
          return createBy.data;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function newProject(): Project {
    const project: Project = new Project();
    project._id = PROJECT_ID.toString();

    return project;
  }

  function seededRoles(): Array<NetworkDeviceRole> {
    return createSpy.mock.calls.map(
      (call: Array<unknown>): NetworkDeviceRole => {
        return (call[0] as CreateBy<NetworkDeviceRole>).data;
      },
    );
  }

  /*
   * Calling this method from a test at all is the assertion that it is
   * public: it is `await`ed from BackfillNetworkDeviceRoles in another
   * workspace, and making it private would fail ts-jest's compile here as
   * well as breaking that migration.
   */
  test("the seeder is public, and the backfill for older projects calls it", async () => {
    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    expect(createSpy).toHaveBeenCalled();
    expect(BACKFILL_SOURCE).toContain(
      "ProjectService.addDefaultNetworkDeviceRoles(project)",
    );
  });

  /*
   * The role seeder runs in the same parallel batch as the site-type seeder
   * on the project-creation hook. Alongside, not after: a project whose roles
   * are seeded by some later job would render its first topology map with no
   * roles at all. This is read off the source because the hook itself is a
   * private method behind a full project create.
   */
  test("it runs from the project-creation hook, next to the site-type seeder", () => {
    const start: number = PROJECT_SERVICE_SOURCE.indexOf("await Promise.all([");

    expect(start).toBeGreaterThan(-1);

    const promiseAllBlock: string = PROJECT_SERVICE_SOURCE.slice(
      start,
      PROJECT_SERVICE_SOURCE.indexOf("]);", start),
    );

    expect(promiseAllBlock).toContain(
      "this.addDefaultNetworkSiteTypes(createdItem)",
    );
    expect(promiseAllBlock).toContain(
      "this.addDefaultNetworkDeviceRoles(createdItem)",
    );
  });

  test("it seeds one role per default, named and ordered as the list is", async () => {
    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    const seeded: Array<NetworkDeviceRole> = seededRoles();

    expect(seeded.length).toBe(DEFAULT_NETWORK_DEVICE_ROLES.length);
    expect(
      seeded.map((role: NetworkDeviceRole): string | undefined => {
        return role.name;
      }),
    ).toEqual(
      DEFAULT_NETWORK_DEVICE_ROLES.map(
        (role: DefaultNetworkDeviceRole): string => {
          return role.name;
        },
      ),
    );
  });

  /*
   * order is the array index PLUS ONE, and the +1 is load-bearing: order is
   * an optional numeric column, and a leading zero sorts and reads as "unset"
   * everywhere a falsy check is made. Starting at 1 also lines the settings
   * page up with the map legend, which is why the defaults are listed in
   * legend order in the first place.
   */
  test("it numbers the roles from 1, matching the map legend's order", async () => {
    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    expect(
      seededRoles().map((role: NetworkDeviceRole): number | undefined => {
        return role.order;
      }),
    ).toEqual(
      DEFAULT_NETWORK_DEVICE_ROLES.map(
        (_role: DefaultNetworkDeviceRole, index: number): number => {
          return index + 1;
        },
      ),
    );
  });

  /*
   * The key is passed EXPLICITLY rather than left for the service to derive.
   * "Wireless AP" is the case that proves why: no derivation from that name
   * produces "wirelessAccessPoint", which is the value the SNMP classifier
   * actually emits — so a seeded AP would match no row and every access point
   * on the map would fall back to unclassified.
   */
  test("it passes the classifier's own key rather than letting one be derived", async () => {
    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    const seeded: Array<NetworkDeviceRole> = seededRoles();

    expect(
      seeded.map((role: NetworkDeviceRole): string | undefined => {
        return role.key;
      }),
    ).toEqual(
      DEFAULT_NETWORK_DEVICE_ROLES.map(
        (role: DefaultNetworkDeviceRole): string => {
          return role.key;
        },
      ),
    );

    const wirelessAccessPoint: NetworkDeviceRole | undefined = seeded.find(
      (role: NetworkDeviceRole): boolean => {
        return role.key === "wirelessAccessPoint";
      },
    );

    expect(wirelessAccessPoint?.name).toBe("Wireless AP");
  });

  /*
   * The shape and the two flags are the whole of what used to be hardcoded in
   * the renderer and the layout module. A seeded project has to draw exactly
   * the map it drew before roles were configurable, which means these three
   * come across untouched.
   */
  test("it carries the shape and both behaviour flags across unchanged", async () => {
    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    const seeded: Array<NetworkDeviceRole> = seededRoles();

    for (let index: number = 0; index < seeded.length; index++) {
      const expectedRole: DefaultNetworkDeviceRole =
        DEFAULT_NETWORK_DEVICE_ROLES[index]!;
      const seededRole: NetworkDeviceRole = seeded[index]!;

      expect(seededRole.topologyShape).toBe(expectedRole.topologyShape);
      expect(seededRole.isCoreLayer).toBe(expectedRole.isCoreLayer);
      expect(seededRole.isSnmpWalkable).toBe(expectedRole.isSnmpWalkable);
    }
  });

  test("every seeded role belongs to the project being created, and is written as root", async () => {
    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    for (const call of createSpy.mock.calls as Array<Array<unknown>>) {
      const createBy: CreateBy<NetworkDeviceRole> =
        call[0] as CreateBy<NetworkDeviceRole>;

      expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
      /*
       * Root, because this runs inside the project-creation hook: the owner
       * does not have permissions on a project that does not exist yet.
       */
      expect(createBy.props.isRoot).toBe(true);
    }
  });

  /*
   * The backfill re-runs the seeder against projects that may already have
   * been seeded, so re-running it must be a no-op rather than a second copy of
   * every role.
   */
  test("re-running it against an already-seeded project creates nothing", async () => {
    jest.spyOn(NetworkDeviceRoleService, "getKeysInProject").mockResolvedValue(
      new Set<string>(
        DEFAULT_NETWORK_DEVICE_ROLES.map(
          (role: DefaultNetworkDeviceRole): string => {
            return role.key;
          },
        ),
      ),
    );

    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    expect(createSpy).not.toHaveBeenCalled();
  });

  /*
   * ...including when the project has RENAMED a seeded role. The name guard
   * alone would miss this and hand the project a second "Router" beside its
   * "Edge Router"; the key is the identity that survives the rename, which is
   * why the guard checks both.
   */
  test("a renamed role is still recognised, by its key rather than its name", async () => {
    jest
      .spyOn(NetworkDeviceRoleService, "getKeysInProject")
      .mockResolvedValue(new Set<string>(["router"]));

    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    const seeded: Array<NetworkDeviceRole> = seededRoles();

    expect(seeded.length).toBe(DEFAULT_NETWORK_DEVICE_ROLES.length - 1);
    expect(
      seeded.map((role: NetworkDeviceRole): string | undefined => {
        return role.key;
      }),
    ).not.toContain("router");
  });

  /*
   * The other half of the same guard: a project that already holds a role by
   * name — seeded before the key column carried anything useful, say — does
   * not get a duplicate either.
   */
  test("a role that already exists by name is not seeded twice", async () => {
    const existing: NetworkDeviceRole = new NetworkDeviceRole();
    existing.name = "Router";

    jest
      .spyOn(NetworkDeviceRoleService, "findBy")
      .mockResolvedValue([existing]);

    await ProjectService.addDefaultNetworkDeviceRoles(newProject());

    expect(seededRoles().length).toBe(DEFAULT_NETWORK_DEVICE_ROLES.length - 1);
  });
});

describe("the four device-role permissions", () => {
  interface RolePermissionUnderTest {
    name: string;
    permission: Permission;
  }

  /*
   * The names are written out rather than derived from the enum, because the
   * stored value is the half that matters: a team's permission row persists
   * the string, so a value that ever drifts from its member name orphans
   * every grant already handed out.
   */
  const ROLE_PERMISSIONS: Array<RolePermissionUnderTest> = [
    {
      name: "CreateNetworkDeviceRole",
      permission: Permission.CreateNetworkDeviceRole,
    },
    {
      name: "ReadNetworkDeviceRole",
      permission: Permission.ReadNetworkDeviceRole,
    },
    {
      name: "EditNetworkDeviceRole",
      permission: Permission.EditNetworkDeviceRole,
    },
    {
      name: "DeleteNetworkDeviceRole",
      permission: Permission.DeleteNetworkDeviceRole,
    },
  ];

  /*
   * A permission the enum declares but the catalogue does not describe cannot
   * be granted: the team-permission editor renders from getAllPermissionProps,
   * so a missing descriptor means the permission exists, gates the model, and
   * can never be handed to anybody.
   */
  test.each(ROLE_PERMISSIONS)(
    "$name has a catalogue entry in the Monitor group",
    (entry: RolePermissionUnderTest) => {
      const descriptor: PermissionProps | undefined =
        PermissionHelper.getAllPermissionProps().find(
          (props: PermissionProps): boolean => {
            return props.permission === entry.permission;
          },
        );

      expect(descriptor).toBeDefined();
      /*
       * Monitor, not Settings: device roles are configured under Network, and
       * the group is what decides which section of the permission editor they
       * appear in.
       */
      expect(descriptor?.group).toBe(PermissionGroup.Monitor);
      /*
       * ...and assignable to a project team, which is the only way a
       * non-owner ever gets one.
       */
      expect(descriptor?.isAssignableToTenant).toBe(true);
    },
  );

  test.each(ROLE_PERMISSIONS)(
    "$name is stored under exactly its own name",
    (entry: RolePermissionUnderTest) => {
      expect(entry.permission.toString()).toBe(entry.name);
    },
  );

  /*
   * The table's own access control has to accept the granular permissions, or
   * granting "Create Network Device Role" to a team would grant nothing at
   * all — the catalogue entry would exist and the gate would still refuse.
   */
  test("the model's table access control honours each of them", () => {
    const role: NetworkDeviceRole = new NetworkDeviceRole();

    expect(role.createRecordPermissions).toContain(
      Permission.CreateNetworkDeviceRole,
    );
    expect(role.readRecordPermissions).toContain(
      Permission.ReadNetworkDeviceRole,
    );
    expect(role.updateRecordPermissions).toContain(
      Permission.EditNetworkDeviceRole,
    );
    expect(role.deleteRecordPermissions).toContain(
      Permission.DeleteNetworkDeviceRole,
    );
  });
});
