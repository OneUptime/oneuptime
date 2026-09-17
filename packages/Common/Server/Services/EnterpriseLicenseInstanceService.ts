import DatabaseService from "./DatabaseService";
import EnterpriseLicenseInstance from "../../Models/DatabaseModels/EnterpriseLicenseInstance";
import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseService from "./EnterpriseLicenseService";
import EnterpriseLicenseUsageUtil, {
  EffectiveEnterpriseLicenseUserCount,
} from "../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import EnterpriseLicenseUserCountSource from "../../Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";
import DeleteById from "../Types/Database/DeleteById";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../Types/ObjectID";
import PartialEntity from "../../Types/Database/PartialEntity";
import ModelPermission from "../Types/Database/Permissions/Index";

export class Service extends DatabaseService<EnterpriseLicenseInstance> {
  public constructor() {
    super(EnterpriseLicenseInstance);
  }

  public override async deleteOneById(deleteById: DeleteById): Promise<number> {
    /*
     * A source marker is written before deleting some upgrade-era rows. Check
     * permission first so a refused delete can never produce that write. The
     * inherited deletion below deliberately performs its normal check again.
     */
    await ModelPermission.checkDeletePermissionByModel({
      modelType: this.modelType,
      fetchModelWithAccessControlIds: async () => {
        return await this.findOneById({
          id: deleteById.id,
          select: {},
          props: {
            isRoot: true,
          },
        });
      },
      props: deleteById.props,
    });

    /*
     * Resolve the owning license before taking its lock. The actual delete
     * still goes through DatabaseService below with the caller's original
     * props, so this root read does not bypass delete permission checks.
     */
    const instance: EnterpriseLicenseInstance | null = await this.findOneById({
      id: deleteById.id,
      select: {
        enterpriseLicenseId: true,
      },
      props: {
        isRoot: true,
      },
    });
    const licenseId: ObjectID | undefined = instance?.enterpriseLicenseId;

    if (!licenseId) {
      return await super.deleteOneById(deleteById);
    }

    return await EnterpriseLicenseService.runWithUsageAggregationLock({
      licenseId,
      fn: async (): Promise<number> => {
        /*
         * A report for this row uses the same lock. Re-read its provenance in
         * the critical section so the fallback decision cannot race a report.
         */
        const lockedInstance: EnterpriseLicenseInstance | null =
          await this.findOneById({
            id: deleteById.id,
            select: {
              lastReportedAt: true,
            },
            props: {
              isRoot: true,
            },
          });
        const deletedTargetHadReportedUsage: boolean = Boolean(
          lockedInstance?.lastReportedAt,
        );

        if (deletedTargetHadReportedUsage) {
          const sourceLicense: EnterpriseLicense | null =
            await EnterpriseLicenseService.findOneById({
              id: licenseId,
              select: {
                userCountSource: true,
              },
              props: {
                isRoot: true,
              },
            });

          /*
           * Old rows predate the persisted provenance column. Mark the stored
           * aggregate before deleting its last evidence, so even a later
           * aggregate-write failure cannot resurrect it as legacy usage.
           */
          if (sourceLicense && !sourceLicense.userCountSource) {
            await EnterpriseLicenseService.updateOneById({
              id: licenseId,
              data: {
                userCountSource: EnterpriseLicenseUserCountSource.Instance,
              },
              props: {
                isRoot: true,
                ignoreHooks: true,
              },
            });
          }
        }

        const deletedCount: number = await super.deleteOneById(deleteById);

        /*
         * The row may have disappeared between the ownership lookup and lock
         * acquisition. Preserve DatabaseService's zero-row result and avoid
         * changing an aggregate for a deletion this call did not perform.
         */
        if (deletedCount === 0) {
          return 0;
        }

        const now: Date = OneUptimeDate.getCurrentDate();
        const remainingInstances: Array<EnterpriseLicenseInstance> =
          await this.findBy({
            query: {
              enterpriseLicenseId: licenseId,
            },
            select: {
              createdAt: true,
              userCount: true,
              userEmailHashes: true,
              lastReportedAt: true,
            },
            sort: {
              createdAt: SortOrder.Ascending,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
              isRoot: true,
            },
          });
        const license: EnterpriseLicense | null =
          await EnterpriseLicenseService.findOneById({
            id: licenseId,
            select: {
              currentUserCount: true,
              userCountUpdatedAt: true,
              userCountSource: true,
              legacyUserCount: true,
              legacyUserCountUpdatedAt: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!license) {
          return deletedCount;
        }

        const effectiveUsage: EffectiveEnterpriseLicenseUserCount =
          EnterpriseLicenseUsageUtil.getEffectiveUserCountAndSource({
            instances: remainingInstances,
            storedUserCount: license.currentUserCount,
            storedUserCountUpdatedAt: license.userCountUpdatedAt,
            storedUserCountSource:
              license.userCountSource ||
              (deletedTargetHadReportedUsage
                ? EnterpriseLicenseUserCountSource.Instance
                : undefined),
            legacyUserCount: license.legacyUserCount,
            legacyUserCountUpdatedAt: license.legacyUserCountUpdatedAt,
            allowStoredUserCountAsLegacyFallback:
              !deletedTargetHadReportedUsage,
            now,
          });

        if (effectiveUsage.userCount !== null) {
          const usageUpdate: PartialEntity<EnterpriseLicense> = {
            currentUserCount: effectiveUsage.userCount,
          };

          if (effectiveUsage.source !== null) {
            usageUpdate.userCountSource = effectiveUsage.source;
          }

          await EnterpriseLicenseService.updateOneById({
            id: licenseId,
            data: usageUpdate,
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
        }

        return deletedCount;
      },
    });
  }
}

export default new Service();
