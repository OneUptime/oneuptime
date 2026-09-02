import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import Project from "Common/Models/DatabaseModels/Project";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceRoleService from "Common/Server/Services/NetworkDeviceRoleService";
import ProjectService from "Common/Server/Services/ProjectService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { normalizeRoleKey } from "Common/Utils/Monitor/NetworkDeviceRoleCatalog";

interface ProjectDeviceRoleIndex {
  // Normalized role key -> the role row's id, for case-insensitive resolution.
  idsByKey: Map<string, ObjectID>;
  // Order given to the next role created for this project, so the settings list stays deterministic.
  nextOrder: number;
}

/*
 * Devices are backfilled a batch at a time, and each batch is re-queried
 * rather than paginated with an offset: backfilled devices drop straight out
 * of the "networkDeviceRoleId IS NULL" result set, so a moving offset would
 * step over rows. A project with more unassigned devices than this simply
 * takes another round.
 */
const DEVICE_BATCH_SIZE: number = LIMIT_MAX;

/*
 * Device roles moved from a fixed union stored inline on
 * NetworkDevice.deviceRole to the per-project NetworkDeviceRole lookup table,
 * so projects can rename "Wireless AP" to "Access Point", change what a
 * firewall is drawn as, or add roles of their own.
 *
 * This migration, for every project:
 *   1. seeds the default roles (existing projects predate the table and have
 *      none) through ProjectService.addDefaultNetworkDeviceRoles, so the
 *      defaults - names, descriptions, order, shapes, and the two load-bearing
 *      flags isCoreLayer and isSnmpWalkable - are defined in exactly one place
 *      and cannot drift between project creation and this backfill, and
 *   2. points every device whose networkDeviceRoleId is still NULL at the role
 *      row matching its legacy deviceRole string, case-insensitively. A legacy
 *      string that matches no configured role gets a role created for it so no
 *      operator's assignment is silently discarded.
 *
 * WHY THE DEPRECATED COLUMN IS READ HERE: NetworkDevice.deviceRole is the only
 * record of a device's assigned role - there is nowhere else to recover it
 * from. The column is kept nullable and deprecated purely so this migration
 * can read it once; a follow-up PR drops it. This is the last code that may
 * read it, and no new code should.
 *
 * WHY MOST DEVICES ARE SKIPPED: an empty deviceRole is not a gap, it is the
 * normal state. It means "no override - work the role out from the device's
 * SNMP identity", which is what the classifier does on every poll and what the
 * topology builder still does for an unassigned device. Only devices whose
 * operator actually answered the question have anything to migrate.
 *
 * Idempotent and safe to re-run: the seeder guards every create on the
 * project's existing names and keys, ad-hoc roles are guarded by a
 * case-insensitive key lookup, and only devices with networkDeviceRoleId IS
 * NULL are touched - so a second run (or a run resumed after a killed pod) is
 * a no-op over everything already backfilled. Failures are logged per project
 * / per device rather than thrown: the migration runner halts the entire chain
 * on the first throw, and one unmappable device must not freeze every later
 * migration.
 */
export default class BackfillNetworkDeviceRoles extends DataMigrationBase {
  public constructor() {
    super("BackfillNetworkDeviceRoles");
  }

  public override async migrate(): Promise<void> {
    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      if (!project.id) {
        continue;
      }

      try {
        await this.backfillProject(project);
      } catch (err) {
        logger.error(
          `Failed to backfill network device roles for project ${project.id.toString()}:`,
        );
        logger.error(err);
      }
    }
  }

  private async backfillProject(project: Project): Promise<void> {
    const projectId: ObjectID = project.id!;

    // Seed the defaults first so every built-in legacy key has a row to land on.
    await ProjectService.addDefaultNetworkDeviceRoles(project);

    const roleIndex: ProjectDeviceRoleIndex =
      await this.loadDeviceRoleIndex(projectId);

    /*
     * The candidate query (networkDeviceRoleId IS NULL) shrinks as devices are
     * backfilled, so every batch is read from offset 0 rather than paginated -
     * skipping ahead would step over rows that moved up as earlier ones were
     * resolved. Devices that cannot be backfilled (no legacy string, or a
     * failed write) stay in the result set forever, so attempted ids are
     * tracked and the loop stops as soon as a batch contains nothing new to
     * try.
     */
    const attemptedDeviceIds: Set<string> = new Set<string>();

    while (true) {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          projectId: projectId,
          networkDeviceRoleId: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          deviceRole: true,
        },
        skip: 0,
        limit: DEVICE_BATCH_SIZE,
        props: {
          isRoot: true,
        },
      });

      const devicesToBackfill: Array<NetworkDevice> = devices.filter(
        (device: NetworkDevice): boolean => {
          return (
            Boolean(device.id) && !attemptedDeviceIds.has(device.id!.toString())
          );
        },
      );

      if (devicesToBackfill.length === 0) {
        return;
      }

      for (const device of devicesToBackfill) {
        attemptedDeviceIds.add(device.id!.toString());

        // Reading the deprecated column - see the note at the top of this file.
        const legacyRoleKey: string | undefined = normalizeRoleKey(
          device.deviceRole,
        );

        /*
         * No assignment to migrate. Also skipped for the literal "unknown",
         * which the old column refused as an override and which means the same
         * thing an empty column does - let the classifier decide.
         */
        if (!legacyRoleKey || legacyRoleKey === "unknown") {
          continue;
        }

        try {
          const roleId: ObjectID | null = await this.resolveDeviceRoleId({
            projectId: projectId,
            roleIndex: roleIndex,
            legacyRoleKey: legacyRoleKey,
          });

          if (!roleId) {
            continue;
          }

          await NetworkDeviceService.updateOneById({
            id: device.id!,
            data: {
              networkDeviceRoleId: roleId,
            },
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          logger.error(
            `Failed to backfill network device role for device ${device.id!.toString()}:`,
          );
          logger.error(err);
        }
      }
    }
  }

  /**
   * Indexes the roles the project has right now (seeded defaults plus anything
   * the project configured itself) by normalized key.
   */
  private async loadDeviceRoleIndex(
    projectId: ObjectID,
  ): Promise<ProjectDeviceRoleIndex> {
    const existingRoles: Array<NetworkDeviceRole> =
      await NetworkDeviceRoleService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          key: true,
          order: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const roleIndex: ProjectDeviceRoleIndex = {
      idsByKey: new Map<string, ObjectID>(),
      nextOrder: 1,
    };

    for (const existingRole of existingRoles) {
      if (!existingRole.id || !existingRole.key) {
        continue;
      }

      const key: string | undefined = normalizeRoleKey(existingRole.key);
      if (key) {
        roleIndex.idsByKey.set(key, existingRole.id);
      }

      if (existingRole.order && existingRole.order >= roleIndex.nextOrder) {
        roleIndex.nextOrder = existingRole.order + 1;
      }
    }

    return roleIndex;
  }

  /**
   * Resolves a legacy device role key to a role row, creating the role when
   * the project has nothing matching it (a seeded role that was deleted, or a
   * value written by an import or the API rather than the picker).
   */
  private async resolveDeviceRoleId(data: {
    projectId: ObjectID;
    roleIndex: ProjectDeviceRoleIndex;
    legacyRoleKey: string;
  }): Promise<ObjectID | null> {
    const existingRoleId: ObjectID | undefined = data.roleIndex.idsByKey.get(
      data.legacyRoleKey,
    );

    if (existingRoleId) {
      return existingRoleId;
    }

    /*
     * isCoreLayer is false and isSnmpWalkable true for these - the neutral
     * answers. Guessing either from an unrecognised legacy string would
     * silently move devices between tiers of the topology map, or change how
     * the adopt-a-neighbour flow opens, on no evidence at all.
     *
     * The key is kept EXACTLY as it was stored, not re-derived from the name:
     * it is what the classifier and every stored payload already match on, and
     * re-deriving it would break the match this migration exists to preserve.
     */
    return this.createDeviceRole({
      projectId: data.projectId,
      roleIndex: data.roleIndex,
      key: data.legacyRoleKey,
      order: data.roleIndex.nextOrder,
    });
  }

  private async createDeviceRole(data: {
    projectId: ObjectID;
    roleIndex: ProjectDeviceRoleIndex;
    key: string;
    order: number;
  }): Promise<ObjectID | null> {
    const role: NetworkDeviceRole = new NetworkDeviceRole();
    role.projectId = data.projectId;
    role.key = data.key;
    role.name = BackfillNetworkDeviceRoles.nameForLegacyKey(data.key);
    role.description =
      "Recovered from a device role that was set before roles were configurable.";
    role.order = data.order;
    role.isCoreLayer = false;
    role.isSnmpWalkable = true;

    try {
      const createdRole: NetworkDeviceRole =
        await NetworkDeviceRoleService.create({
          data: role,
          props: {
            isRoot: true,
          },
        });

      if (!createdRole.id) {
        return null;
      }

      data.roleIndex.idsByKey.set(data.key, createdRole.id);

      if (data.order >= data.roleIndex.nextOrder) {
        data.roleIndex.nextOrder = data.order + 1;
      }

      return createdRole.id;
    } catch (err) {
      /*
       * Both the name and the key are unique per project, so a concurrent
       * writer (project creation running the same seeder, or a user adding the
       * role by hand) can win this race. Logged and skipped rather than thrown
       * - the device stays unassigned and a re-run picks the row up through the
       * key lookup.
       */
      logger.error(
        `Failed to create network device role "${data.key}" for project ${data.projectId.toString()}:`,
      );
      logger.error(err);

      return null;
    }
  }

  /**
   * A readable name for a role recovered from a legacy key.
   *
   * The key is a camelCase identifier ("wirelessAccessPoint") and the name is
   * what a human reads, so the words are split back out and the first one
   * capitalised: "Wireless access point". Deliberately not title case - the
   * seeded names are sentence case too ("Load balancer", "IP phone").
   */
  public static nameForLegacyKey(key: string): string {
    const spaced: string = key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim();

    if (!spaced) {
      return key;
    }

    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
