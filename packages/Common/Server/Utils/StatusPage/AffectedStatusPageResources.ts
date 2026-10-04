import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import StatusPageResourceService from "../../Services/StatusPageResourceService";
import Select from "../../Types/Database/Select";

/*
 * Which of each status page's resources an event on some monitors affects:
 * what an announcement or a scheduled maintenance event lists as affected,
 * and so which subscribers hear about it.
 *
 * On a status page that lets subscribers choose resources, a subscriber
 * picks some of the page's resources, and a resource is either one monitor
 * or a monitor group. StatusPageSubscriberService.shouldSendNotification
 * tells such a subscriber about an event when it picked one of the
 * resources the event affects on that page. So a resource is affected when
 * it is one of the event's monitors, or a monitor group that holds one of
 * them: the status page shows the event under that group, and someone who
 * subscribed to the group expects to hear about every monitor in it.
 *
 * The resources come from StatusPageResourceService.findByMonitors, the one
 * lookup from monitors to resources. Incidents and episodes reach it through
 * IncidentStatusPageScope, which also applies an incident's status page
 * scope; announcements and scheduled maintenance events - created,
 * reminders, state changes and public notes - through this. A guard test
 * (App/Tests/SubscriberNotificationResourceLookups.test.ts) fails on a
 * sender that looks resources up any other way, such as by monitorId alone,
 * which misses the monitor groups.
 */
export default class AffectedStatusPageResources {
  /*
   * The affected resources on the status pages the event is on, keyed by the
   * page's id as the senders look a page up (statusPage._id). Only those
   * pages' resources are read. A page that lists none of the monitors has no
   * entry. An event that names no monitor, or is on no page, affects no
   * resource, and nothing is looked up.
   */
  public static async findForMonitors(data: {
    monitors?: Array<Monitor> | undefined;
    monitorIds?: Array<ObjectID> | undefined;
    // The status pages the event is shown on.
    statusPages: Array<StatusPage>;
    select: Select<StatusPageResource>;
  }): Promise<Dictionary<Array<StatusPageResource>>> {
    const monitorIds: Array<ObjectID> = this.distinctIds([
      ...(data.monitorIds || []),
      ...(data.monitors || []).map((monitor: Monitor): string | undefined => {
        return monitor._id;
      }),
    ]);

    const statusPageIds: Array<ObjectID> = this.distinctIds(
      data.statusPages.map((statusPage: StatusPage): string | undefined => {
        return statusPage._id;
      }),
    );

    if (monitorIds.length === 0 || statusPageIds.length === 0) {
      return {};
    }

    const resources: Array<StatusPageResource> =
      await StatusPageResourceService.findByMonitors({
        monitorIds: monitorIds,
        statusPageIds: statusPageIds,
        select: {
          ...data.select,
          // Needed to group by page and to dedupe, whatever the caller asked for.
          _id: true,
          statusPageId: true,
        },
      });

    return this.groupByStatusPage(resources);
  }

  /*
   * The resources keyed by their status page's id, each page's in the order
   * given and each resource once. A resource without a page is left out.
   */
  public static groupByStatusPage(
    resources: Array<StatusPageResource>,
  ): Dictionary<Array<StatusPageResource>> {
    const byStatusPage: Dictionary<Array<StatusPageResource>> = {};
    const seenResourceIds: Set<string> = new Set();

    for (const resource of resources) {
      const statusPageId: string | undefined = resource.statusPageId
        ?.toString()
        .trim();

      if (!statusPageId) {
        continue;
      }

      const resourceId: string | undefined = resource._id?.toString();

      if (resourceId) {
        if (seenResourceIds.has(resourceId)) {
          continue;
        }

        seenResourceIds.add(resourceId);
      }

      const pageResources: Array<StatusPageResource> =
        byStatusPage[statusPageId] || [];

      pageResources.push(resource);
      byStatusPage[statusPageId] = pageResources;
    }

    return byStatusPage;
  }

  // The ids, each once, in the order given. A record never saved has none.
  private static distinctIds(
    candidates: Array<ObjectID | string | undefined>,
  ): Array<ObjectID> {
    const ids: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const candidate of candidates) {
      const id: string = candidate ? candidate.toString().trim() : "";

      if (!id || seen.has(id.toLowerCase())) {
        continue;
      }

      seen.add(id.toLowerCase());
      ids.push(new ObjectID(id));
    }

    return ids;
  }
}
