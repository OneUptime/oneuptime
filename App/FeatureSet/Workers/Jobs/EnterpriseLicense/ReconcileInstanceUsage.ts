import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE, EVERY_HOUR } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import EnterpriseLicenseService from "Common/Server/Services/EnterpriseLicenseService";
import EnterpriseLicenseInstanceService from "Common/Server/Services/EnterpriseLicenseInstanceService";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import EnterpriseLicenseUsageUtil from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import logger from "Common/Server/Utils/Logger";

RunCron(
  "EnterpriseLicense:ReconcileInstanceUsage",
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_HOUR,
    runOnStartup: true,
  },
  async () => {
    /*
     * Instance usage is stored only on hosted oneuptime.com. Self-hosted
     * installations report into it, but do not own the EnterpriseLicense
     * rows this sweep reconciles.
     */
    if (!IsBillingEnabled) {
      return;
    }

    let skip: number = 0;

    for (;;) {
      const licenses: Array<EnterpriseLicense> =
        await EnterpriseLicenseService.findBy({
          query: {},
          select: {
            _id: true,
            currentUserCount: true,
            userCountUpdatedAt: true,
            userCountSource: true,
            legacyUserCount: true,
            legacyUserCountUpdatedAt: true,
          },
          sort: {
            createdAt: SortOrder.Ascending,
            _id: SortOrder.Ascending,
          },
          skip: skip,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });

      for (const license of licenses) {
        try {
          await EnterpriseLicenseService.runWithUsageAggregationLock({
            licenseId: license.id!,
            fn: async (): Promise<void> => {
              /*
               * Capture the cutoff only after acquiring this license's lock.
               * A delayed older sweep must not run after a newer report/sweep
               * while still evaluating activity with its earlier wall time.
               */
              const now: Date = OneUptimeDate.getCurrentDate();

              /*
               * Validation creates registration-only rows. Re-read both the
               * license and its instances after taking their shared lock so a
               * just-registered instance cannot be missed by a stale sweep.
               */
              const currentLicense: EnterpriseLicense | null =
                await EnterpriseLicenseService.findOneById({
                  id: license.id!,
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

              if (!currentLicense) {
                return;
              }

              const instances: Array<EnterpriseLicenseInstance> =
                await EnterpriseLicenseInstanceService.findBy({
                  query: {
                    enterpriseLicenseId: license.id!,
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

              const reconciledUserCount: number | null =
                EnterpriseLicenseUsageUtil.getEffectiveUserCount({
                  instances,
                  storedUserCount: currentLicense.currentUserCount,
                  storedUserCountUpdatedAt: currentLicense.userCountUpdatedAt,
                  storedUserCountSource: currentLicense.userCountSource,
                  legacyUserCount: currentLicense.legacyUserCount,
                  legacyUserCountUpdatedAt:
                    currentLicense.legacyUserCountUpdatedAt,
                  now,
                });
              const previousUserCount: number | null =
                currentLicense.currentUserCount ?? null;

              if (
                reconciledUserCount === previousUserCount ||
                reconciledUserCount === null
              ) {
                return;
              }

              /*
               * The shared lock covers every known usage writer. Keep a
               * compare-and-set as an additional guard for older processes
               * during a rolling deployment. The derived write deliberately
               * leaves userCountUpdatedAt untouched because only real
               * communication may advance that timestamp.
               */
              await EnterpriseLicenseService.updateColumnsByIdWithoutHooks({
                id: license.id!,
                data: {
                  currentUserCount: reconciledUserCount,
                },
                expectedData: {
                  currentUserCount: previousUserCount,
                  userCountUpdatedAt: currentLicense.userCountUpdatedAt ?? null,
                  userCountSource: currentLicense.userCountSource ?? null,
                  legacyUserCount: currentLicense.legacyUserCount ?? null,
                  legacyUserCountUpdatedAt:
                    currentLicense.legacyUserCountUpdatedAt ?? null,
                },
              });
            },
          });
        } catch (error) {
          logger.error(
            `EnterpriseLicense:ReconcileInstanceUsage: Error while processing license ${license.id?.toString() || "unknown"}: ${error}`,
          );
        }
      }

      if (licenses.length < LIMIT_MAX) {
        break;
      }

      skip += licenses.length;
    }
  },
);
