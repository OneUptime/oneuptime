import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import {
  ProjectScopedReferenceException,
  normalizeReferenceId,
} from "../Database/ProjectScopedReferenceRefusal";
import ProjectScopedReferenceValidator, {
  resolveReferenceIds,
} from "../Database/ProjectScopedReferenceValidator";
import ArchivedMonitorResources from "../../../Utils/StatusPage/ArchivedMonitorResources";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE RESOURCES A SUBSCRIPTION NAMES ARE ITS OWN STATUS PAGE'S.
 *
 * A subscriber picks the resources it wants to hear about from the status
 * page it subscribed to: the StatusPageResource rows of that page - a
 * monitor or a monitor group, in one of the page's groups or in none. So a
 * subscription names only resources of its own page, on every write of it:
 * a sign-up and a change on the status page, the team's dashboard, the API
 * and a workflow alike, for every kind of subscriber (email, SMS, Slack,
 * Microsoft Teams, webhook). StatusPageSubscriberService asks it of every
 * create and update, and is the one place that does.
 *
 * A resource of another status page - of this project or of another one -
 * is answered exactly as an id that matches nothing: the refusal every
 * reference check gives (ProjectScopedReferenceValidator.getRefusalMessage),
 * in the words the project check uses for this list, echoing the ids as the
 * caller sent them. Nothing tells "another page's resource" apart from
 * "no such resource".
 *
 * A visitor - a sign-up on the status page, or a change from its manage
 * subscription page - picks from what the page shows them (the status
 * page's resources route): a resource whose monitor is archived is left out
 * of every public read of the page (ArchivedMonitorResources), so naming one
 * gets the same answer. The team may name any resource of the page, as the
 * dashboard's resource picker lists them all.
 *
 * A change asks only about the resources it adds: what a subscription
 * already names stays nameable, so a subscription whose resource's monitor
 * was archived since, or one saved before this check, can still be saved.
 *
 * Why this is not an option of ProjectScopedReferenceValidator: that check
 * is keyed by project throughout - its lookups pin the referenced model's
 * project, and an update's exemptions are grouped per project - while this
 * one pins each subscriber to its own page, and a bulk update can change
 * subscribers of several pages at once; and what a page shows a visitor is
 * the status page's own rule. It shares the validator's refusal, its id
 * reading and its hook-free lookups instead.
 */

// "Subscribed to Resources": how the project check names this list.
const getResourcesColumnTitle: () => string = (): string => {
  const metadata: TableColumnMetadata | undefined =
    new StatusPageSubscriber().getTableColumnMetadata("statusPageResources");

  return metadata?.title || "Subscribed to Resources";
};

export default class StatusPageSubscriberResources {
  // The list a subscription names its resources in.
  public static readonly RESOURCES_COLUMN: string = "statusPageResources";

  /*
   * The ids a value of the resources list names - model instances,
   * `{ _id }` objects, ObjectIDs or bare uuid strings - each once, as
   * written. An entry with no id names nothing.
   */
  public static getNamedIds(value: unknown): Array<string> {
    const ids: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const id of resolveReferenceIds(value)) {
      const written: string = id.toString().trim();

      if (!written || seen.has(normalizeReferenceId(written))) {
        continue;
      }

      seen.add(normalizeReferenceId(written));
      ids.push(written);
    }

    return ids;
  }

  /*
   * Of `ids`, the ones that are resources of the status page - and, for a
   * visitor (`shownToVisitorsOnly`), ones the page shows - normalized. A
   * malformed id names no resource, and is answered without a query; with
   * no status page named, nothing is on it (a query without the page would
   * match every page's resources).
   */
  public static async findIdsOnPage(data: {
    statusPageId: ObjectID | undefined;
    ids: Array<string>;
    shownToVisitorsOnly: boolean;
  }): Promise<Set<string>> {
    const validIds: Array<string> = data.ids
      .map((id: string): string => {
        return id.trim();
      })
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      });

    if (!data.statusPageId || validIds.length === 0) {
      return new Set<string>();
    }

    /*
     * Hook-free (getLookupService): a read of what is on the page, which
     * neither needs nor may run another service's hooks.
     */
    const resourceService: DatabaseService<StatusPageResource> =
      ProjectScopedReferenceValidator.getLookupService(StatusPageResource);

    const resources: Array<StatusPageResource> = await resourceService.findBy({
      query: {
        _id: QueryHelper.any(validIds),
        statusPageId: data.statusPageId,
      },
      select: {
        _id: true,
        ...(data.shownToVisitorsOnly
          ? {
              monitor: {
                _id: true,
                isArchived: true,
              },
            }
          : {}),
      },
      limit: Math.min(validIds.length, LIMIT_MAX),
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const onPage: Array<StatusPageResource> = data.shownToVisitorsOnly
      ? ArchivedMonitorResources.withoutArchivedMonitors(resources)
      : resources;

    return new Set<string>(
      onPage
        .map((resource: StatusPageResource): string => {
          return normalizeReferenceId(resource._id?.toString() || "");
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    );
  }

  /*
   * Refuses `ids` - resources a write names that are not its status page's
   * (or, for a visitor, not shown on it) - with the answer an id that
   * matches nothing gets. Nothing to refuse when there are none.
   */
  public static refuse(ids: Array<string>): void {
    if (ids.length === 0) {
      return;
    }

    const columnTitle: string = getResourcesColumnTitle();

    throw new ProjectScopedReferenceException(
      ProjectScopedReferenceValidator.getRefusalMessage({
        subject: (
          new StatusPageSubscriber().singularName || "status page subscriber"
        ).toLowerCase(),
        described: ids.map((id: string): string => {
          return `${columnTitle} "${id}"`;
        }),
      }),
    );
  }

  /*
   * A new subscription's check: every id of `ids` must be a resource of the
   * status page (shown on it, for a visitor), or it is refused - all of
   * them in one answer.
   */
  public static async assertOnPage(data: {
    statusPageId: ObjectID | undefined;
    ids: Array<string>;
    shownToVisitorsOnly: boolean;
  }): Promise<void> {
    if (data.ids.length === 0) {
      return;
    }

    const onPage: Set<string> =
      await StatusPageSubscriberResources.findIdsOnPage(data);

    StatusPageSubscriberResources.refuse(
      data.ids.filter((id: string): boolean => {
        return !onPage.has(normalizeReferenceId(id));
      }),
    );
  }

  /*
   * An update's check: of `named`, the ids a subscriber the update changes
   * does not name already must be resources of that subscriber's page (shown
   * on it, for a visitor; a subscriber with no page has none to add). Each
   * page is read once, however many of its subscribers the update changes,
   * and everything refused is named in one answer, in the order written.
   */
  public static async assertUpdateOnPages(data: {
    subscribers: Array<
      Pick<StatusPageSubscriber, "statusPageId" | "statusPageResources">
    >;
    named: Array<string>;
    shownToVisitorsOnly: boolean;
  }): Promise<void> {
    if (data.named.length === 0) {
      return;
    }

    const addedByPage: Map<
      string,
      { statusPageId: ObjectID; ids: Array<string> }
    > = new Map();

    const refused: Set<string> = new Set<string>();

    for (const subscriber of data.subscribers) {
      const held: Set<string> = new Set<string>(
        StatusPageSubscriberResources.getNamedIds(
          subscriber.statusPageResources,
        ).map(normalizeReferenceId),
      );

      const added: Array<string> = data.named.filter((id: string): boolean => {
        return !held.has(normalizeReferenceId(id));
      });

      if (!subscriber.statusPageId) {
        for (const id of added) {
          refused.add(normalizeReferenceId(id));
        }

        continue;
      }

      const pageKey: string = normalizeReferenceId(
        subscriber.statusPageId.toString(),
      );

      const entry: { statusPageId: ObjectID; ids: Array<string> } =
        addedByPage.get(pageKey) || {
          statusPageId: subscriber.statusPageId,
          ids: [],
        };

      for (const id of added) {
        const isListed: boolean = entry.ids.some((listed: string): boolean => {
          return normalizeReferenceId(listed) === normalizeReferenceId(id);
        });

        if (!isListed) {
          entry.ids.push(id);
        }
      }

      if (entry.ids.length > 0) {
        addedByPage.set(pageKey, entry);
      }
    }

    for (const entry of addedByPage.values()) {
      const onPage: Set<string> =
        await StatusPageSubscriberResources.findIdsOnPage({
          statusPageId: entry.statusPageId,
          ids: entry.ids,
          shownToVisitorsOnly: data.shownToVisitorsOnly,
        });

      for (const id of entry.ids) {
        if (!onPage.has(normalizeReferenceId(id))) {
          refused.add(normalizeReferenceId(id));
        }
      }
    }

    StatusPageSubscriberResources.refuse(
      data.named.filter((id: string): boolean => {
        return refused.has(normalizeReferenceId(id));
      }),
    );
  }

  /*
   * Whether a resource a subscriber names is one of `statusPageId`'s, as the
   * subscriber jobs read it (with its page: getSubscribersByStatusPage). A
   * resource read without its page, or asked about without one, is not
   * known to be on it, so it counts as not on it.
   */
  public static isOnPage(
    resource: Pick<StatusPageResource, "statusPageId">,
    statusPageId: ObjectID | string | undefined | null,
  ): boolean {
    if (!resource.statusPageId || !statusPageId) {
      return false;
    }

    return (
      normalizeReferenceId(resource.statusPageId.toString()) ===
      normalizeReferenceId(statusPageId.toString())
    );
  }
}
