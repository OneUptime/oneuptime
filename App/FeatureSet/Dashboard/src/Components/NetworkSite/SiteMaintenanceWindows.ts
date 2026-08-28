import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import GreaterThanOrNull from "Common/Types/BaseDatabase/GreaterThanOrNull";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import SiteMaintenanceUtil, {
  MaintenanceEventWindow,
} from "Common/Utils/NetworkSite/SiteMaintenanceUtil";
import { SiteMaintenanceWindow } from "Common/Utils/NetworkSite/SiteUptimeUtil";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The scheduled maintenance windows that cover one network site, for the
 * pages that show its uptime.
 *
 * Coverage is inherited DOWN the hierarchy - a window on a Region covers
 * every Unit in it - so the query cannot filter on the site id alone. It
 * fetches the events that overlap the measured window and lets
 * SiteMaintenanceUtil decide coverage against the site's materialized path,
 * which is the same function the server uses for the hierarchy API. Doing
 * the ancestry match here rather than server-side keeps one definition of
 * "covered" instead of two that can disagree.
 */
export interface FetchSiteMaintenanceWindowsInput {
  siteId: ObjectID;
  /*
   * The site's materialized path, which carries its ancestor ids. Undefined
   * only matches windows attached to the site itself - correct behaviour for
   * a site whose path has not been built yet, not a silent failure.
   */
  materializedPath?: string | null | undefined;
  windowStart: Date;
  windowEnd: Date;
}

export type FetchSiteMaintenanceWindowsFunction = (
  input: FetchSiteMaintenanceWindowsInput,
) => Promise<Array<SiteMaintenanceWindow>>;

export const fetchSiteMaintenanceWindows: FetchSiteMaintenanceWindowsFunction =
  async (
    input: FetchSiteMaintenanceWindowsInput,
  ): Promise<Array<SiteMaintenanceWindow>> => {
    const result: ListResult<ScheduledMaintenance> =
      await ModelAPI.getList<ScheduledMaintenance>({
        modelType: ScheduledMaintenance,
        query: {
          startsAt: new LessThanOrEqual<Date>(input.windowEnd),
          endsAt: new GreaterThanOrNull<Date>(input.windowStart),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          startsAt: true,
          endsAt: true,
          networkSites: {
            _id: true,
          },
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
      });

    const events: Array<MaintenanceEventWindow> = [];

    for (const event of result.data) {
      if (!event.startsAt) {
        continue;
      }

      const siteIds: Array<string> = (event.networkSites || [])
        .map((site: { _id?: string | undefined }): string => {
          return site._id ? String(site._id) : "";
        })
        .filter((id: string): boolean => {
          return id.length > 0;
        });

      if (siteIds.length === 0) {
        continue;
      }

      events.push({
        startsAt: event.startsAt,
        endsAt: (event.endsAt as Date | undefined) || null,
        siteIds: siteIds,
      });
    }

    return SiteMaintenanceUtil.windowsCoveringSite({
      siteId: input.siteId.toString(),
      materializedPath: input.materializedPath,
      events: events,
    });
  };

export default fetchSiteMaintenanceWindows;
