import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import NetworkSiteService from "../../Services/NetworkSiteService";
import QueryHelper from "../../Types/Database/QueryHelper";
import NetworkSiteUsage from "./NetworkSiteUsage";

/*
 * THE SITES PAGE'S DELETE EMPTY SITES (#10188).
 *
 * An add of a Meraki organization's devices on OneUptime 16.0.0 added a
 * site for each Meraki network before it added a device, then could add no
 * device at all: hundreds of sites were left with nothing in them, one by
 * one to delete. This lists the project's empty sites (NetworkSiteUsage
 * says what empty is) and deletes the ones a person confirmed:
 *
 *   - listed with the person's own read permission: a site they cannot
 *     see is never listed to them;
 *   - deleted as the person, with their own delete permission, through
 *     NetworkSiteService - its checks and its audit log, as a delete from
 *     the list is;
 *   - only the sites the person was shown and confirmed, and only those
 *     still empty when they confirm: a site that got a device since, or a
 *     site under it, is kept and counted.
 */

export interface EmptyNetworkSite {
  id: string;
  name: string;
}

// The sites one delete asks about at once.
const DELETE_CHUNK_SIZE: number = 100;

// Sites one confirmation deletes at most: every site a project lists.
export const MAX_EMPTY_SITES_DELETED: number = LIMIT_PER_PROJECT;

function chunks<T>(items: Array<T>, size: number): Array<Array<T>> {
  const result: Array<Array<T>> = [];

  for (let offset: number = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }

  return result;
}

export default class EmptyNetworkSites {
  // The project's empty sites the person may read, by name.
  public static async find(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<EmptyNetworkSite>> {
    const sites: Array<NetworkSite> = await NetworkSiteService.findBy({
      query: { projectId: data.projectId },
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: data.props,
    });

    const ids: Array<string> = sites
      .map((site: NetworkSite): string => {
        return site.id?.toString().toLowerCase() || "";
      })
      .filter(Boolean);

    const inUse: Set<string> = await NetworkSiteUsage.findSitesInUse({
      projectId: data.projectId,
      siteIds: ids,
    });

    const empty: Array<EmptyNetworkSite> = [];

    for (const site of sites) {
      const id: string = site.id?.toString().toLowerCase() || "";

      if (!id || inUse.has(id)) {
        continue;
      }

      empty.push({ id: id, name: site.name || "" });
    }

    return empty;
  }

  /*
   * Deletes the sites of `siteIds` that are still empty, as the person:
   * how many it deleted, and how many it kept because something is in them
   * now, or they are not there to delete.
   */
  public static async delete(data: {
    projectId: ObjectID;
    siteIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ deletedCount: number; keptCount: number }> {
    const asked: Array<string> = Array.from(
      new Set<string>(
        data.siteIds
          .filter((siteId: string): boolean => {
            return ObjectID.isValidUUID(siteId);
          })
          .map((siteId: string): string => {
            return siteId.toLowerCase();
          }),
      ),
    );

    if (asked.length === 0) {
      return { deletedCount: 0, keptCount: 0 };
    }

    const inUse: Set<string> = await NetworkSiteUsage.findSitesInUse({
      projectId: data.projectId,
      siteIds: asked,
    });

    const toDelete: Array<string> = asked.filter((siteId: string): boolean => {
      return !inUse.has(siteId);
    });

    let deletedCount: number = 0;

    for (const chunk of chunks(toDelete, DELETE_CHUNK_SIZE)) {
      deletedCount += await NetworkSiteService.deleteBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(chunk),
        },
        limit: chunk.length,
        skip: 0,
        props: data.props,
      });
    }

    return {
      deletedCount: deletedCount,
      keptCount: asked.length - deletedCount,
    };
  }
}
