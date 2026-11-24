import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceNamingRule from "../../../Models/DatabaseModels/NetworkDeviceNamingRule";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import NetworkSiteLink from "../../../Models/DatabaseModels/NetworkSiteLink";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "../../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import NetworkDeviceNamingRuleService from "../../Services/NetworkDeviceNamingRuleService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkEndpointService from "../../Services/NetworkEndpointService";
import NetworkSiteAssignmentRuleService from "../../Services/NetworkSiteAssignmentRuleService";
import NetworkSiteLinkService from "../../Services/NetworkSiteLinkService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * WHAT IS IN A NETWORK SITE, OR NAMES IT: whether a site is empty
 * (#10188).
 *
 * A site is empty when deleting it loses nothing but the site itself:
 *
 *   - no network device is in it, archived ones included: a device that is
 *     unarchived goes back to its site;
 *   - no site is under it (a delete would be refused);
 *   - no endpoint is placed in it;
 *   - no link runs to or from it and no site assignment rule puts devices
 *     in it: deleting the site would delete the link or the rule with it;
 *   - no naming rule is limited to it and no maintenance event that is not
 *     over names it: deleting it would change what the rule or the event
 *     covers.
 *
 * Asked as OneUptime itself, whoever asks: a device a person may not read
 * is in the site all the same, and must keep it.
 *
 * What Add devices takes away again - a site it added for devices it could
 * not add - and the Sites page's Delete Empty Sites both ask this, so the
 * two never disagree about what is empty.
 */

// The sites one lookup asks about.
const SITE_CHUNK_SIZE: number = 500;

// The rows one read of a site's devices or endpoints pages through.
const ROW_PAGE_SIZE: number = 1000;

function chunks<T>(items: Array<T>, size: number): Array<Array<T>> {
  const result: Array<Array<T>> = [];

  for (let offset: number = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }

  return result;
}

function toKey(id: unknown): string {
  return id ? id.toString().toLowerCase() : "";
}

/*
 * The rows of a model that name one of `siteIds` in `column`: read until
 * every site has one, or there are none left - a page names at least one
 * site the next page no longer asks about, so a site with ten thousand
 * devices costs one read, not ten.
 */
type FindRowsNamingSites = (data: {
  projectId: ObjectID;
  siteIds: Array<string>;
  limit: number;
}) => Promise<Array<string | undefined>>;

async function addSitesNamedByRows(data: {
  projectId: ObjectID;
  siteIds: Array<string>;
  inUse: Set<string>;
  find: FindRowsNamingSites;
}): Promise<void> {
  const remaining: Set<string> = new Set<string>(
    data.siteIds.filter((siteId: string): boolean => {
      return !data.inUse.has(siteId);
    }),
  );

  while (remaining.size > 0) {
    const named: Array<string | undefined> = await data.find({
      projectId: data.projectId,
      siteIds: Array.from(remaining),
      limit: ROW_PAGE_SIZE,
    });

    let isAnyNew: boolean = false;

    for (const siteId of named) {
      const key: string = toKey(siteId);

      if (key && remaining.has(key)) {
        remaining.delete(key);
        data.inUse.add(key);
        isAnyNew = true;
      }
    }

    if (named.length < ROW_PAGE_SIZE || !isAnyNew) {
      return;
    }
  }
}

export default class NetworkSiteUsage {
  /*
   * Which of `siteIds`, of the project, something is in or names - see the
   * header. Ids in lower case.
   */
  public static async findSitesInUse(data: {
    projectId: ObjectID;
    siteIds: Array<string>;
    now?: Date | undefined;
  }): Promise<Set<string>> {
    const inUse: Set<string> = new Set<string>();
    const siteIds: Array<string> = Array.from(
      new Set<string>(
        data.siteIds.map((siteId: string): string => {
          return toKey(siteId);
        }),
      ),
    ).filter(Boolean);

    if (siteIds.length === 0) {
      return inUse;
    }

    const asked: Set<string> = new Set<string>(siteIds);
    const projectId: ObjectID = data.projectId;

    for (const chunk of chunks(siteIds, SITE_CHUNK_SIZE)) {
      // Devices, archived ones too.
      await addSitesNamedByRows({
        projectId,
        siteIds: chunk,
        inUse,
        find: async (find: {
          projectId: ObjectID;
          siteIds: Array<string>;
          limit: number;
        }): Promise<Array<string | undefined>> => {
          const devices: Array<NetworkDevice> =
            await NetworkDeviceService.findBy({
              query: {
                projectId: find.projectId,
                siteId: QueryHelper.any(find.siteIds),
              },
              select: { _id: true, siteId: true },
              limit: find.limit,
              skip: 0,
              props: { isRoot: true },
            });

          return devices.map((device: NetworkDevice): string | undefined => {
            return device.siteId?.toString();
          });
        },
      });

      // Sites under them, deleted ones too: their rows still name them.
      for (const parentId of await NetworkSiteService.findSiteIdsWithChildren({
        projectId,
        siteIds: chunk,
      })) {
        inUse.add(parentId);
      }

      // Endpoints placed in them.
      await addSitesNamedByRows({
        projectId,
        siteIds: chunk,
        inUse,
        find: async (find: {
          projectId: ObjectID;
          siteIds: Array<string>;
          limit: number;
        }): Promise<Array<string | undefined>> => {
          const endpoints: Array<NetworkEndpoint> =
            await NetworkEndpointService.findBy({
              query: {
                projectId: find.projectId,
                siteId: QueryHelper.any(find.siteIds),
              },
              select: { _id: true, siteId: true },
              limit: find.limit,
              skip: 0,
              props: { isRoot: true },
            });

          return endpoints.map(
            (endpoint: NetworkEndpoint): string | undefined => {
              return endpoint.siteId?.toString();
            },
          );
        },
      });

      // Links to or from them.
      for (const column of ["fromSiteId", "toSiteId"] as const) {
        const links: Array<NetworkSiteLink> =
          await NetworkSiteLinkService.findBy({
            query: {
              projectId,
              [column]: QueryHelper.any(chunk),
            },
            select: { _id: true, fromSiteId: true, toSiteId: true },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          });

        for (const link of links) {
          for (const siteId of [link.fromSiteId, link.toSiteId]) {
            const key: string = toKey(siteId);

            if (asked.has(key)) {
              inUse.add(key);
            }
          }
        }
      }

      // Site assignment rules that put devices in them.
      const rules: Array<NetworkSiteAssignmentRule> =
        await NetworkSiteAssignmentRuleService.findBy({
          query: {
            projectId,
            siteId: QueryHelper.any(chunk),
          },
          select: { _id: true, siteId: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      for (const rule of rules) {
        const key: string = toKey(rule.siteId);

        if (asked.has(key)) {
          inUse.add(key);
        }
      }
    }

    // Naming rules limited to them: a project has a handful.
    const namingRules: Array<NetworkDeviceNamingRule> =
      await NetworkDeviceNamingRuleService.findBy({
        query: { projectId },
        select: { _id: true, sites: { _id: true } },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    for (const rule of namingRules) {
      for (const site of rule.sites || []) {
        const key: string = toKey(site?._id);

        if (asked.has(key)) {
          inUse.add(key);
        }
      }
    }

    // Maintenance events that are not over.
    const events: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId,
          endsAt: QueryHelper.greaterThanOrNull(
            data.now || OneUptimeDate.getCurrentDate(),
          ),
        },
        select: { _id: true, networkSites: { _id: true } },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    for (const event of events) {
      for (const site of event.networkSites || []) {
        const key: string = toKey(site?._id);

        if (asked.has(key)) {
          inUse.add(key);
        }
      }
    }

    return inUse;
  }
}
