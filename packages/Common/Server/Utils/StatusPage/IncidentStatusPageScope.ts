import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import IncidentEpisodeMemberService from "../../Services/IncidentEpisodeMemberService";
import IncidentService from "../../Services/IncidentService";
import StatusPageResourceService from "../../Services/StatusPageResourceService";
import StatusPageSubscriberService from "../../Services/StatusPageSubscriberService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import logger from "../Logger";
import {
  ExcludedStatusPage,
  StatusPageExclusionReason,
} from "./StatusPageExclusion";
import StatusPageVisibilityQuery from "./StatusPageVisibilityQuery";

/*
 * Which status pages an incident reaches - which pages show it, and whose
 * subscribers hear about it. This is the only place that decides it; the
 * subscriber jobs, the public status page and the reports all ask here, and
 * a guard test (IncidentStatusPageScopeCallSites.test.ts) fails on code that
 * works it out for itself from an incident's monitors.
 *
 * An incident reaches a status page through its monitors: a page reaches
 * every incident on a monitor it lists (directly or through a monitor group).
 * Two things narrow that:
 *
 * - Incident.statusPages. A scoped incident (isScopedToStatusPages) reaches
 *   only the pages it is limited to AMONG the pages its monitors reach. The
 *   two sets intersect: a scope never puts an incident on a page that does
 *   not list its monitors. A scope whose pages have all been deleted is a
 *   scope to nothing - the incident reaches no page at all, rather than every
 *   page its monitors reach.
 * - StatusPage.onlyShowScopedIncidents. Such a page never reaches an unscoped
 *   incident, so an incident a monitor, Slack, Teams, the API or AI created
 *   on a monitor shared by many pages reaches none of them until someone
 *   scopes it.
 *
 * Both flags fail closed. isScopedToStatusPages is read here, never trusted
 * from a caller. A status page whose onlyShowScopedIncidents was not loaded
 * is treated as showing only scoped incidents, and an incident whose scope
 * was not loaded is in no page's scope: a select that forgets a column then
 * hides an incident, visibly, instead of broadcasting it to pages that opted
 * out.
 *
 * Scope is applied in SQL for the status page queries (two queries split on
 * isScopedToStatusPages), never as a post-filter: those queries are capped at
 * LIMIT_PER_PROJECT, and a filter applied after the cap would silently drop
 * incidents that are in scope.
 *
 * A private incident reaches no status page at all (StatusPageVisibility):
 * the display queries here show only incidents with Visible on Status Page on
 * that are not private, in SQL like the scope (StatusPageVisibilityQuery);
 * the one read that links episodes to a page reads hidden incidents too, but
 * never private ones; and a private incident is scoped to nothing when the
 * pages its subscribers hear about it on are worked out.
 *
 * Nothing here selects statusPages, isScopedToStatusPages or
 * statusPagesNotifiedOnCreation into the incidents it returns for display, so
 * one audience's page names cannot reach another audience's public page.
 */

export { StatusPageExclusionReason };
export type { ExcludedStatusPage };

/*
 * What decides where one incident reaches: the monitors it is on, and the
 * pages it is limited to (null when it is not limited to any).
 */
export interface IncidentStatusPageReach {
  // Absent for an incident that is not saved yet.
  incidentId?: string | undefined;
  monitorIds: Array<ObjectID>;
  /*
   * Lower-cased status page ids, or null for an unscoped incident. An empty
   * list is a scope with no pages left: it reaches nothing.
   */
  scopedStatusPageIds: Array<string> | null;
}

export interface ResolvedIncidentStatusPages {
  /*
   * The status pages to tell, in name order (see compareStatusPagesByName).
   * Loaded by StatusPageSubscriberService.getStatusPagesToSendNotification, so
   * they carry everything a subscriber job needs.
   */
  statusPages: Array<StatusPage>;
  /*
   * The resources each of those pages lists that the incidents affect, keyed
   * by the page's _id. Only resources the scope lets through: a page reached
   * through one incident of an episode lists only that incident's resources.
   */
  statusPageToResources: Dictionary<Array<StatusPageResource>>;
  /*
   * Whether any of the incidents is limited to specific status pages. Email
   * and SMS are sent once per address across pages only then; an unscoped
   * incident notifies exactly as it always has.
   */
  isScoped: boolean;
  // Pages the monitors reach that the scope rules left out, in name order.
  excludedStatusPages: Array<ExcludedStatusPage>;
}

/*
 * The status page a display query runs for. onlyShowScopedIncidents must be
 * loaded: a page without it is treated as showing only scoped incidents.
 */
export interface StatusPageScopeTarget {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  onlyShowScopedIncidents?: boolean | undefined;
}

// The incident columns that say where an incident reaches. Never public.
export const INCIDENT_SCOPE_COLUMNS: ReadonlyArray<string> = [
  "statusPages",
  "isScopedToStatusPages",
  "statusPagesNotifiedOnCreation",
];

/*
 * What isIncidentInScope reads of an incident, for a caller that reads
 * incidents by id (an episode's members) and applies the scope in memory.
 * Such a caller removes the columns again (removeScopeColumns) before
 * anything it read is serialized.
 */
export const INCIDENT_SCOPE_SELECT: Select<Incident> = {
  isScopedToStatusPages: true,
  statusPages: {
    _id: true,
  },
};

// What every subscriber job reads of the resources an incident affects.
export const SUBSCRIBER_NOTIFICATION_RESOURCE_SELECT: Select<StatusPageResource> =
  {
    _id: true,
    displayName: true,
    statusPageId: true,
    statusPageGroupId: true,
    statusPageGroup: {
      name: true,
    },
  };

export default class IncidentStatusPageScope {
  /*
   * The status pages these saved incidents reach, with the resources each
   * page lists that they affect. Several incidents - an episode's members -
   * reach the union of what each one reaches, each through its own scope.
   *
   * Each incident needs _id and its monitors. Its scope is read from the
   * database here rather than taken from the objects passed in, so a caller
   * that did not select it (or selected it a while ago) cannot widen the
   * reach. An incident that is no longer found reaches nothing, and neither
   * does a private one: a private member of an episode does not take the
   * episode to the pages its monitors are on.
   *
   * includePrivateIncidents resolves a private incident as if it were not
   * private: only for a summary that reports privacy on its own and sends
   * nothing (IncidentSubscriberAudienceBuilder), so what it says of the
   * pages is about the scope, not the privacy.
   */
  public static async resolvePagesForIncidents(data: {
    incidents: Array<Incident>;
    resourceSelect?: Select<StatusPageResource> | undefined;
    includePrivateIncidents?: boolean | undefined;
  }): Promise<ResolvedIncidentStatusPages> {
    const incidentIds: Array<string> = [];

    for (const incident of data.incidents) {
      const incidentId: string | undefined = this.getIncidentId(incident);

      if (!incidentId) {
        throw new BadDataException(
          "Cannot work out which status pages an incident reaches without its id.",
        );
      }

      if (!incidentIds.includes(incidentId)) {
        incidentIds.push(incidentId);
      }
    }

    const scopes: Dictionary<Array<string> | null> =
      await this.getIncidentScopes(incidentIds, {
        includePrivateIncidents: data.includePrivateIncidents === true,
      });

    const reaches: Array<IncidentStatusPageReach> = [];

    for (const incident of data.incidents) {
      const incidentId: string = this.getIncidentId(incident)!;

      reaches.push({
        incidentId: incidentId,
        monitorIds: this.getMonitorIds(incident.monitors),
        /*
         * Not found: deleted since, or not readable. Scoped to nothing, so it
         * reaches no page.
         */
        scopedStatusPageIds: Object.prototype.hasOwnProperty.call(
          scopes,
          incidentId,
        )
          ? (scopes[incidentId] as Array<string> | null)
          : [],
      });
    }

    return this.resolvePagesForReaches({
      reaches: reaches,
      resourceSelect: data.resourceSelect,
    });
  }

  /*
   * The status pages an incident that is not saved yet would reach: the
   * monitors and pages picked on a form. An empty page list is unscoped, the
   * way IncidentService derives isScopedToStatusPages on create.
   */
  public static async resolvePagesForDraftIncident(data: {
    monitorIds: Array<ObjectID>;
    statusPageIds?: Array<ObjectID | string> | undefined;
    resourceSelect?: Select<StatusPageResource> | undefined;
  }): Promise<ResolvedIncidentStatusPages> {
    const statusPageIds: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        data.statusPageIds || [],
      );

    return this.resolvePagesForReaches({
      reaches: [
        {
          monitorIds: data.monitorIds,
          scopedStatusPageIds: statusPageIds.length > 0 ? statusPageIds : null,
        },
      ],
      resourceSelect: data.resourceSelect,
    });
  }

  /*
   * The incidents of an episode, each with its _id and monitors, ready for
   * resolvePagesForIncidents. An episode reaches the union of the pages its
   * member incidents reach.
   */
  public static async getEpisodeMemberIncidents(
    incidentEpisodeId: ObjectID,
  ): Promise<Array<Incident>> {
    const members: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: incidentEpisodeId,
        },
        select: {
          incidentId: true,
          incident: {
            _id: true,
            monitors: {
              _id: true,
            },
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const incidents: Array<Incident> = [];
    const seenIncidentIds: Set<string> = new Set();

    for (const member of members) {
      const incident: Incident | undefined = member.incident;

      if (!incident) {
        continue;
      }

      // The relation's own _id, or the member's foreign key when it is not.
      if (!incident._id && member.incidentId) {
        incident._id = member.incidentId.toString();
      }

      const incidentId: string | undefined = this.getIncidentId(incident);

      if (!incidentId || seenIncidentIds.has(incidentId)) {
        continue;
      }

      seenIncidentIds.add(incidentId);
      incidents.push(incident);
    }

    return incidents;
  }

  /*
   * The pages a set of reaches adds up to. Unscoped incidents are looked up
   * together (their pages are filtered the same way); each scoped incident on
   * its own, since its resources are filtered to its own pages.
   */
  public static async resolvePagesForReaches(data: {
    reaches: Array<IncidentStatusPageReach>;
    resourceSelect?: Select<StatusPageResource> | undefined;
  }): Promise<ResolvedIncidentStatusPages> {
    const resourceSelect: Select<StatusPageResource> = {
      ...(data.resourceSelect || SUBSCRIBER_NOTIFICATION_RESOURCE_SELECT),
      // Needed to group and to dedupe, whatever the caller asked for.
      _id: true,
      statusPageId: true,
    };

    const isScoped: boolean = data.reaches.some(
      (reach: IncidentStatusPageReach): boolean => {
        return reach.scopedStatusPageIds !== null;
      },
    );

    const batches: Array<{
      resources: Array<StatusPageResource>;
      scopedStatusPageIds: Array<string> | null;
    }> = [];

    const unscopedMonitorIds: Array<ObjectID> = this.distinctMonitorIds(
      data.reaches
        .filter((reach: IncidentStatusPageReach): boolean => {
          return reach.scopedStatusPageIds === null;
        })
        .flatMap((reach: IncidentStatusPageReach): Array<ObjectID> => {
          return reach.monitorIds;
        }),
    );

    if (unscopedMonitorIds.length > 0) {
      batches.push({
        resources: await StatusPageResourceService.findByMonitors({
          monitorIds: unscopedMonitorIds,
          select: resourceSelect,
        }),
        scopedStatusPageIds: null,
      });
    }

    for (const reach of data.reaches) {
      if (reach.scopedStatusPageIds === null) {
        continue;
      }

      const monitorIds: Array<ObjectID> = this.distinctMonitorIds(
        reach.monitorIds,
      );

      // Scoped to nothing, or on no monitor: it reaches no page to look up.
      if (reach.scopedStatusPageIds.length === 0 || monitorIds.length === 0) {
        continue;
      }

      batches.push({
        resources: await StatusPageResourceService.findByMonitors({
          monitorIds: monitorIds,
          select: resourceSelect,
        }),
        scopedStatusPageIds: reach.scopedStatusPageIds,
      });
    }

    const candidateStatusPageIds: Array<string> = [];

    for (const batch of batches) {
      for (const resource of batch.resources) {
        const statusPageId: string | undefined = this.normalizeId(
          resource.statusPageId,
        );

        if (statusPageId && !candidateStatusPageIds.includes(statusPageId)) {
          candidateStatusPageIds.push(statusPageId);
        }
      }
    }

    if (candidateStatusPageIds.length === 0) {
      return {
        statusPages: [],
        statusPageToResources: {},
        isScoped: isScoped,
        excludedStatusPages: [],
      };
    }

    const loadedStatusPages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification(
        candidateStatusPageIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      );

    const statusPageById: Map<string, StatusPage> = new Map();

    for (const statusPage of loadedStatusPages) {
      const statusPageId: string | undefined = this.normalizeId(statusPage._id);

      if (statusPageId) {
        statusPageById.set(statusPageId, statusPage);
      }
    }

    // Keyed by the lower-cased page id while collecting.
    const reachedResources: Map<string, Array<StatusPageResource>> = new Map();
    /*
     * The pages a scoped incident's monitors are on that its scope left out:
     * it is limited to other pages. A page only an unscoped incident's
     * monitors reached, and which only shows scoped incidents, is left out for
     * that instead.
     */
    const outsideScopedIncidentReach: Set<string> = new Set();

    for (const batch of batches) {
      for (const resource of batch.resources) {
        const statusPageId: string | undefined = this.normalizeId(
          resource.statusPageId,
        );

        if (!statusPageId) {
          continue;
        }

        const statusPage: StatusPage | undefined =
          statusPageById.get(statusPageId);

        // Deleted since the resource was read: nothing to tell.
        if (!statusPage) {
          continue;
        }

        const isInScope: boolean =
          batch.scopedStatusPageIds === null
            ? !this.showsOnlyScopedIncidents(statusPage)
            : batch.scopedStatusPageIds.includes(statusPageId);

        if (!isInScope) {
          if (batch.scopedStatusPageIds !== null) {
            outsideScopedIncidentReach.add(statusPageId);
          }

          continue;
        }

        const resources: Array<StatusPageResource> =
          reachedResources.get(statusPageId) || [];

        const resourceId: string | undefined = this.normalizeId(resource._id);

        const isDuplicate: boolean = resources.some(
          (existing: StatusPageResource): boolean => {
            return (
              resourceId !== undefined &&
              this.normalizeId(existing._id) === resourceId
            );
          },
        );

        if (!isDuplicate) {
          resources.push(resource);
        }

        reachedResources.set(statusPageId, resources);
      }
    }

    const statusPages: Array<StatusPage> = [];
    const excludedStatusPages: Array<ExcludedStatusPage> = [];
    const statusPageToResources: Dictionary<Array<StatusPageResource>> = {};

    for (const [statusPageId, statusPage] of statusPageById.entries()) {
      const resources: Array<StatusPageResource> | undefined =
        reachedResources.get(statusPageId);

      if (resources && resources.length > 0) {
        statusPages.push(statusPage);
        // Keyed as the subscriber jobs look pages up: by the page's own _id.
        statusPageToResources[statusPage._id || statusPageId] = resources;
        continue;
      }

      /*
       * Why it was left out. A scoped incident that lists the page's monitors
       * but not the page is limited to other pages, whatever the page's own
       * setting; only a page reached by unscoped incidents alone was left
       * out because it only shows incidents limited to it.
       */
      excludedStatusPages.push({
        statusPage: statusPage,
        reason:
          !outsideScopedIncidentReach.has(statusPageId) &&
          this.showsOnlyScopedIncidents(statusPage)
            ? StatusPageExclusionReason.OnlyShowsScopedIncidents
            : StatusPageExclusionReason.OutsideIncidentScope,
      });
    }

    statusPages.sort(this.compareStatusPagesByName);
    excludedStatusPages.sort(
      (a: ExcludedStatusPage, b: ExcludedStatusPage): number => {
        return this.compareStatusPagesByName(a.statusPage, b.statusPage);
      },
    );

    logger.debug(
      `Incident status page scope: ${data.reaches.length} incident(s) reach ${statusPages.length} status page(s); ${excludedStatusPages.length} left out by scope.`,
    );

    return {
      statusPages: statusPages,
      statusPageToResources: statusPageToResources,
      isScoped: isScoped,
      excludedStatusPages: excludedStatusPages,
    };
  }

  /*
   * The incidents a status page shows that match `query`. The caller's query
   * keeps its monitors filter (the pages' monitors); this runs it twice,
   * split on isScopedToStatusPages:
   *
   * - unscoped incidents, unless the page only shows scoped incidents;
   * - incidents scoped to this page (the join-table filter QueryUtil builds
   *   from an id list, as the scheduled maintenance queries use).
   *
   * Both halves hold only incidents the status page shows: Visible on Status
   * Page on, and not private (StatusPageVisibilityQuery). With
   * includeHiddenIncidents, incidents hidden with the switch are read too -
   * for working out which episodes a page shows, which the episode's own
   * switches decide - but a private incident never is.
   *
   * The two halves are disjoint. They are merged, sorted by `sort` as the
   * database would have, and cut to `skip` and `limit` - each half is read up
   * to skip + limit rows, so the cut sees every row that can make the page.
   * Sort keys must be top-level columns; any the caller did not select are
   * read for the merge and removed again.
   */
  public static async findIncidentsForStatusPage(data: {
    statusPage: StatusPageScopeTarget;
    query: Query<Incident>;
    select: Select<Incident>;
    sort?: Sort<Incident> | undefined;
    limit: number;
    skip?: number | undefined;
    props: DatabaseCommonInteractionProps;
    includeHiddenIncidents?: boolean | undefined;
  }): Promise<Array<Incident>> {
    const skip: number = Math.max(0, data.skip || 0);
    const limit: number = Math.max(0, data.limit);

    if (limit === 0) {
      return [];
    }

    const sort: Sort<Incident> | undefined = data.sort;
    const sortKeys: Array<string> = Object.keys(sort || {});

    const select: Select<Incident> = { ...data.select };
    const addedKeys: Array<string> = [];

    for (const key of ["_id", ...sortKeys]) {
      if (!(select as Dictionary<unknown>)[key]) {
        (select as Dictionary<unknown>)[key] = true;
        addedKeys.push(key);
      }
    }

    const results: Array<Array<Incident>> = await Promise.all(
      this.getScopedQueries({
        statusPage: data.statusPage,
        query: data.query,
        includeHiddenIncidents: data.includeHiddenIncidents,
      }).map((query: Query<Incident>): Promise<Array<Incident>> => {
        return IncidentService.findBy({
          query: query,
          select: select,
          sort: sort,
          limit: skip + limit,
          skip: 0,
          props: data.props,
        });
      }),
    );

    const incidents: Array<Incident> = this.mergeIncidents({
      results: results,
      sort: sort,
    }).slice(skip, skip + limit);

    for (const incident of incidents) {
      for (const key of addedKeys) {
        // _id stays: it is what every caller keys on.
        if (key !== "_id") {
          delete (incident as unknown as Dictionary<unknown>)[key];
        }
      }
    }

    return incidents;
  }

  /*
   * The one incident matching `query` that a status page shows, if any (with
   * includeHiddenIncidents, as findIncidentsForStatusPage reads it).
   */
  public static async findOneIncidentForStatusPage(data: {
    statusPage: StatusPageScopeTarget;
    query: Query<Incident>;
    select: Select<Incident>;
    sort?: Sort<Incident> | undefined;
    props: DatabaseCommonInteractionProps;
    includeHiddenIncidents?: boolean | undefined;
  }): Promise<Incident | null> {
    const incidents: Array<Incident> = await this.findIncidentsForStatusPage({
      statusPage: data.statusPage,
      query: data.query,
      select: data.select,
      sort: data.sort,
      limit: 1,
      skip: 0,
      props: data.props,
      includeHiddenIncidents: data.includeHiddenIncidents,
    });

    return incidents[0] || null;
  }

  /*
   * How many incidents matching `query` a status page shows: the unscoped
   * ones (unless the page only shows scoped incidents) plus the ones scoped
   * to it. The two counts are disjoint, so they add up. Only the project's
   * incidents the status page shows count: visible on status pages, and not
   * private.
   */
  public static async countIncidentsForStatusPage(data: {
    statusPage: StatusPageScopeTarget;
    projectId: ObjectID;
    query: Query<Incident>;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<number> {
    const counts: Array<PositiveNumber> = await Promise.all(
      this.getScopedQueries({
        statusPage: data.statusPage,
        query: {
          ...data.query,
          projectId: data.projectId,
        },
      }).map((query: Query<Incident>): Promise<PositiveNumber> => {
        return IncidentService.countBy({
          query: query,
          props: data.props || {
            isRoot: true,
          },
        });
      }),
    );

    return counts.reduce((total: number, count: PositiveNumber): number => {
      return total + count.toNumber();
    }, 0);
  }

  /*
   * Whether a status page shows this incident, as far as scope goes (whether
   * the page lists its monitors is the caller's query). For incidents already
   * read, like an episode's members: the incident needs isScopedToStatusPages
   * and statusPages loaded, and the page onlyShowScopedIncidents. Missing
   * either fails closed.
   */
  public static isIncidentInScope(
    incident: Pick<Incident, "isScopedToStatusPages" | "statusPages">,
    statusPage: StatusPageScopeTarget,
  ): boolean {
    if (incident.isScopedToStatusPages === true) {
      const statusPageId: string | undefined = this.getStatusPageId(statusPage);

      return Boolean(
        statusPageId &&
          IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
            incident.statusPages,
          ).includes(statusPageId),
      );
    }

    if (incident.isScopedToStatusPages === false) {
      return !this.showsOnlyScopedIncidents(statusPage);
    }

    // Not loaded: in no page's scope.
    return false;
  }

  /*
   * Removes the scope columns from an incident about to be serialized for a
   * public status page - the model or its JSON - in case a select brought
   * them in.
   */
  public static removeScopeColumns<T extends Incident | JSONObject>(
    incident: T,
  ): T {
    for (const column of INCIDENT_SCOPE_COLUMNS) {
      delete (incident as unknown as Dictionary<unknown>)[column];
    }

    return incident;
  }

  /*
   * Visiting order for a send: by name, then id. Email and SMS go once per
   * address across the pages of a scoped incident, so the page visited first
   * is the one whose template, branding and unsubscribe link a person on
   * several of them gets - and name order makes that predictable.
   */
  public static compareStatusPagesByName(a: StatusPage, b: StatusPage): number {
    const nameA: string = (a.name || a.pageTitle || "").trim();
    const nameB: string = (b.name || b.pageTitle || "").trim();

    const byName: number = nameA.localeCompare(nameB, "en", {
      sensitivity: "base",
      numeric: true,
    });

    if (byName !== 0) {
      return byName;
    }

    return (a._id || "").localeCompare(b._id || "");
  }

  /*
   * The two halves of a display query for one status page, each kept to the
   * incidents the page shows (StatusPageVisibilityQuery): visible on status
   * pages and not private - or, with includeHiddenIncidents, not private.
   */
  private static getScopedQueries(data: {
    statusPage: StatusPageScopeTarget;
    query: Query<Incident>;
    includeHiddenIncidents?: boolean | undefined;
  }): Array<Query<Incident>> {
    const statusPageId: string | undefined = this.getStatusPageId(
      data.statusPage,
    );

    if (!statusPageId) {
      throw new BadDataException(
        "Cannot find the incidents a status page shows without its id.",
      );
    }

    const query: Query<Incident> = data.includeHiddenIncidents
      ? StatusPageVisibilityQuery.notPrivateIncidents(data.query)
      : StatusPageVisibilityQuery.shownIncidents(data.query);

    const queries: Array<Query<Incident>> = [];

    if (!this.showsOnlyScopedIncidents(data.statusPage)) {
      queries.push({
        ...query,
        isScopedToStatusPages: false,
      } as Query<Incident>);
    }

    queries.push({
      ...query,
      isScopedToStatusPages: true,
      // An id list on an entity-array column becomes a join-table filter.
      statusPages: [statusPageId],
    } as unknown as Query<Incident>);

    return queries;
  }

  /*
   * One list out of the two halves: each incident once, sorted by `sort`
   * the way Postgres sorts - NULLs last ascending and first descending. With
   * no sort, unscoped incidents come first, as each half came back.
   */
  private static mergeIncidents(data: {
    results: Array<Array<Incident>>;
    sort: Sort<Incident> | undefined;
  }): Array<Incident> {
    const merged: Array<Incident> = [];
    const seen: Set<string> = new Set();

    for (const incident of data.results.flat()) {
      const incidentId: string | undefined = this.getIncidentId(incident);

      if (incidentId) {
        if (seen.has(incidentId)) {
          continue;
        }

        seen.add(incidentId);
      }

      merged.push(incident);
    }

    const sortEntries: Array<[string, SortOrder]> = Object.entries(
      data.sort || {},
    ) as Array<[string, SortOrder]>;

    if (sortEntries.length === 0) {
      return merged;
    }

    return merged.sort((a: Incident, b: Incident): number => {
      for (const [key, order] of sortEntries) {
        const compared: number = this.compareSortValues(
          (a as unknown as Dictionary<unknown>)[key],
          (b as unknown as Dictionary<unknown>)[key],
        );

        if (compared !== 0) {
          return order === SortOrder.Descending ? -compared : compared;
        }
      }

      return 0;
    });
  }

  // Ascending order of two column values; a missing value sorts last.
  private static compareSortValues(a: unknown, b: unknown): number {
    const aMissing: boolean = a === undefined || a === null;
    const bMissing: boolean = b === undefined || b === null;

    if (aMissing || bMissing) {
      return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    }

    const aValue: unknown = a instanceof Date ? a.getTime() : a;
    const bValue: unknown = b instanceof Date ? b.getTime() : b;

    if (typeof aValue === "number" && typeof bValue === "number") {
      return aValue - bValue;
    }

    if (typeof aValue === "boolean" && typeof bValue === "boolean") {
      return Number(aValue) - Number(bValue);
    }

    return String(aValue).localeCompare(String(bValue));
  }

  /*
   * Each incident's scope as stored: the lower-cased ids of the pages it is
   * limited to, or null when unscoped. Incidents not found are left out, and
   * so are private ones (StatusPageVisibilityQuery) unless asked for: a
   * private incident is scoped to nothing, so it reaches no page.
   */
  private static async getIncidentScopes(
    incidentIds: Array<string>,
    options: { includePrivateIncidents: boolean },
  ): Promise<Dictionary<Array<string> | null>> {
    const scopes: Dictionary<Array<string> | null> = {};

    if (incidentIds.length === 0) {
      return scopes;
    }

    const query: Query<Incident> = {
      _id: QueryHelper.any(incidentIds),
    };

    const incidents: Array<Incident> = await IncidentService.findBy({
      query: options.includePrivateIncidents
        ? query
        : StatusPageVisibilityQuery.notPrivateIncidents(query),
      select: {
        _id: true,
        isScopedToStatusPages: true,
        statusPages: {
          _id: true,
        },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const incident of incidents) {
      const incidentId: string | undefined = this.getIncidentId(incident);

      if (!incidentId) {
        continue;
      }

      /*
       * The flag decides, not the list: a scoped incident whose pages were
       * all deleted has an empty list and still reaches nothing.
       */
      scopes[incidentId] =
        incident.isScopedToStatusPages === false
          ? null
          : IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
              incident.statusPages,
            );
    }

    return scopes;
  }

  /*
   * Whether a page only shows scoped incidents. Not loaded counts as yes (see
   * the top of this file): the column is NOT NULL, so a read that has it is
   * always true or false.
   */
  private static showsOnlyScopedIncidents(statusPage: {
    onlyShowScopedIncidents?: boolean | undefined;
  }): boolean {
    return statusPage.onlyShowScopedIncidents !== false;
  }

  private static getStatusPageId(
    statusPage: StatusPageScopeTarget,
  ): string | undefined {
    return this.normalizeId(statusPage._id || statusPage.id);
  }

  private static getIncidentId(incident: Incident): string | undefined {
    return this.normalizeId(incident._id || incident.id);
  }

  private static getMonitorIds(
    monitors: Array<Monitor> | undefined,
  ): Array<ObjectID> {
    return this.distinctMonitorIds(
      (monitors || [])
        .map((monitor: Monitor): string | undefined => {
          return this.normalizeId(monitor?._id || monitor?.id);
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        })
        .map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
    );
  }

  private static distinctMonitorIds(
    monitorIds: Array<ObjectID>,
  ): Array<ObjectID> {
    const seen: Set<string> = new Set();
    const distinct: Array<ObjectID> = [];

    for (const monitorId of monitorIds) {
      const id: string | undefined = this.normalizeId(monitorId);

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      distinct.push(new ObjectID(id));
    }

    return distinct;
  }

  // An id in any shape it arrives in, lower-cased as the database returns it.
  private static normalizeId(
    value: ObjectID | string | null | undefined,
  ): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const id: string = value.toString().trim().toLowerCase();

    return id || undefined;
  }
}
