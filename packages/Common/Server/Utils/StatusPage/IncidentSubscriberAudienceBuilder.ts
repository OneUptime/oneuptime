import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceCounts,
  IncidentSubscriberAudienceExcludedStatusPage,
  IncidentSubscriberAudienceExclusionReason,
  IncidentSubscriberAudienceNamedStatusPage,
  IncidentSubscriberAudienceResult,
  IncidentSubscriberAudienceStatusPage,
} from "../../../Types/StatusPage/IncidentSubscriberAudience";
import IncidentService from "../../Services/IncidentService";
import MonitorService from "../../Services/MonitorService";
import StatusPageService from "../../Services/StatusPageService";
import StatusPageSubscriberService from "../../Services/StatusPageSubscriberService";
import QueryHelper from "../../Types/Database/QueryHelper";
import IncidentStatusPageScope, {
  ExcludedStatusPage,
  ResolvedIncidentStatusPages,
  StatusPageExclusionReason,
} from "./IncidentStatusPageScope";

/*
 * Who an incident's status page notifications would reach (see
 * Common/Types/StatusPage/IncidentSubscriberAudience), for
 * POST /incident/subscriber-audience.
 *
 * Which pages an incident reaches is IncidentStatusPageScope's call, the same
 * as for the subscriber jobs: through its monitors, narrowed to the pages it
 * is limited to, without the pages that only show scoped incidents when it is
 * not scoped. On top of that, a page that does not show incidents at all is
 * skipped by the jobs, so it is reported as left out here too.
 *
 * What the caller learns is bounded by what they may read:
 *
 * - the incident is read with the caller's own permissions (labels, private
 *   incidents), and must be in the caller's project;
 * - monitors and status pages named for an incident being declared must be
 *   the project's; another project's id is refused, not looked up;
 * - a status page the caller cannot read (status pages are label-scoped, and
 *   incident roles do not read them at all) is not named here and its
 *   subscribers are not counted - the pages that will be notified that the
 *   caller cannot see come back as one number;
 * - subscribers are counted, never read out. No address leaves the server.
 *
 * What that protects is which pages list an incident's monitors. The pages
 * an incident is limited to are part of the incident, like its monitors and
 * like a scheduled maintenance event's status pages: anyone who can read the
 * incident sees their names (the Status Page Scope card, and the incident
 * feed, which names the pages added to and removed from the scope), whether
 * or not they can read those status pages themselves.
 */

export type IncidentSubscriberAudienceRequest =
  | {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      incidentId: ObjectID;
    }
  | {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      monitorIds: Array<ObjectID>;
      statusPageIds: Array<ObjectID>;
    };

// What decides the audience, once the request is resolved.
interface AudienceInputs {
  resolved: ResolvedIncidentStatusPages;
  hasMonitors: boolean;
  // The pages the incident is limited to, lower-cased; empty when unscoped.
  scopedStatusPageIds: Array<string>;
  isHiddenFromStatusPages: boolean;
}

export default class IncidentSubscriberAudienceBuilder {
  public static async build(
    request: IncidentSubscriberAudienceRequest,
  ): Promise<IncidentSubscriberAudienceResult> {
    const inputs: AudienceInputs =
      "incidentId" in request
        ? await this.getInputsForIncident(request)
        : await this.getInputsForDraft(request);

    return this.buildAudience({
      projectId: request.projectId,
      props: request.props,
      inputs: inputs,
    });
  }

  // An incident that exists: read with the caller's permissions.
  private static async getInputsForIncident(request: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    incidentId: ObjectID;
  }): Promise<AudienceInputs> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: request.incidentId,
        projectId: request.projectId,
      },
      select: {
        _id: true,
        isVisibleOnStatusPage: true,
        isPrivate: true,
        monitors: {
          _id: true,
        },
      },
      props: request.props,
    });

    if (!incident) {
      throw new NotFoundException("Incident not found");
    }

    /*
     * The scope is read as root, now that the caller has been shown to read
     * the incident: its status page ids only decide which pages below are
     * reported as listing none of its monitors, and those are named only if
     * the caller can read them.
     */
    const incidentWithScope: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: request.incidentId,
        projectId: request.projectId,
      },
      select: {
        _id: true,
        isScopedToStatusPages: true,
        statusPages: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incident],
      });

    return {
      resolved: resolved,
      hasMonitors: (incident.monitors || []).length > 0,
      scopedStatusPageIds:
        incidentWithScope?.isScopedToStatusPages === true
          ? this.normalizeIds(incidentWithScope.statusPages)
          : [],
      /*
       * The jobs send nothing for an incident hidden from status pages.
       * Private incidents are always hidden (IncidentService forces it), but
       * a row that says private is treated as hidden either way.
       */
      isHiddenFromStatusPages:
        incident.isVisibleOnStatusPage !== true || incident.isPrivate === true,
    };
  }

  /*
   * An incident being declared: the monitors and status pages picked on the
   * form. Both lists must be the project's.
   */
  private static async getInputsForDraft(request: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    monitorIds: Array<ObjectID>;
    statusPageIds: Array<ObjectID>;
  }): Promise<AudienceInputs> {
    const monitorIds: Array<string> = this.normalizeIds(request.monitorIds);
    const statusPageIds: Array<string> = this.normalizeIds(
      request.statusPageIds,
    );

    await Promise.all([
      this.assertBelongToProject({
        ids: monitorIds,
        projectId: request.projectId,
        find: async (ids: Array<string>): Promise<Array<{ _id?: string }>> => {
          return MonitorService.findBy({
            query: {
              _id: QueryHelper.any(ids),
              projectId: request.projectId,
            },
            select: {
              _id: true,
            },
            limit: ids.length,
            skip: 0,
            props: {
              isRoot: true,
            },
          });
        },
        message:
          "One or more of these monitors were not found in this project.",
      }),
      this.assertBelongToProject({
        ids: statusPageIds,
        projectId: request.projectId,
        find: async (ids: Array<string>): Promise<Array<{ _id?: string }>> => {
          return StatusPageService.findBy({
            query: {
              _id: QueryHelper.any(ids),
              projectId: request.projectId,
            },
            select: {
              _id: true,
            },
            limit: ids.length,
            skip: 0,
            props: {
              isRoot: true,
            },
          });
        },
        message:
          "One or more of these status pages were not found in this project.",
      }),
    ]);

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForDraftIncident({
        monitorIds: monitorIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
        statusPageIds: statusPageIds,
      });

    return {
      resolved: resolved,
      hasMonitors: monitorIds.length > 0,
      scopedStatusPageIds: statusPageIds,
      // The form knows whether the incident will be private; the page says so.
      isHiddenFromStatusPages: false,
    };
  }

  private static async assertBelongToProject(data: {
    ids: Array<string>;
    projectId: ObjectID;
    find: (ids: Array<string>) => Promise<Array<{ _id?: string }>>;
    message: string;
  }): Promise<void> {
    if (data.ids.length === 0) {
      return;
    }

    const found: Array<string> = this.normalizeIds(await data.find(data.ids));

    const isEveryIdFound: boolean = data.ids.every((id: string): boolean => {
      return found.includes(id);
    });

    if (!isEveryIdFound) {
      throw new BadDataException(data.message);
    }
  }

  private static async buildAudience(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    inputs: AudienceInputs;
  }): Promise<IncidentSubscriberAudienceResult> {
    const projectId: string = data.projectId.toString().toLowerCase();

    // Another project's page cannot be reached; if one were, it is not told.
    const isProjectPage: (statusPage: StatusPage) => boolean = (
      statusPage: StatusPage,
    ): boolean => {
      return (
        !statusPage.projectId ||
        statusPage.projectId.toString().toLowerCase() === projectId
      );
    };

    const notifiedPages: Array<StatusPage> = [];
    const excludedPages: Array<{
      statusPage: StatusPage;
      reason: IncidentSubscriberAudienceExclusionReason;
    }> = [];

    for (const statusPage of data.inputs.resolved.statusPages) {
      if (!isProjectPage(statusPage)) {
        continue;
      }

      // The jobs skip a page that does not show incidents.
      if (statusPage.showIncidentsOnStatusPage === false) {
        excludedPages.push({
          statusPage: statusPage,
          reason: IncidentSubscriberAudienceExclusionReason.HidesIncidents,
        });
        continue;
      }

      notifiedPages.push(statusPage);
    }

    for (const excluded of data.inputs.resolved.excludedStatusPages) {
      if (!isProjectPage(excluded.statusPage)) {
        continue;
      }

      excludedPages.push({
        statusPage: excluded.statusPage,
        reason: this.toExclusionReason(excluded),
      });
    }

    excludedPages.sort(
      (
        a: { statusPage: StatusPage },
        b: { statusPage: StatusPage },
      ): number => {
        return IncidentStatusPageScope.compareStatusPagesByName(
          a.statusPage,
          b.statusPage,
        );
      },
    );

    const reachedIds: Array<string> = [
      ...notifiedPages,
      ...excludedPages.map((excluded: { statusPage: StatusPage }) => {
        return excluded.statusPage;
      }),
    ]
      .map((statusPage: StatusPage): string => {
        return this.getId(statusPage);
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      });

    /*
     * Pages the incident is limited to that its monitors do not reach. With
     * no monitor at all nothing is reached, which the summary says on its
     * own, so they are not listed then.
     */
    const selectedNotListingMonitorIds: Array<string> = data.inputs.hasMonitors
      ? data.inputs.scopedStatusPageIds.filter((id: string): boolean => {
          return !reachedIds.includes(id);
        })
      : [];

    const readableNames: Dictionary<string> = await this.getReadableNames({
      projectId: data.projectId,
      props: data.props,
      statusPageIds: [...reachedIds, ...selectedNotListingMonitorIds],
    });

    const isReadable: (id: string) => boolean = (id: string): boolean => {
      return Object.prototype.hasOwnProperty.call(readableNames, id);
    };

    const readableNotifiedPages: Array<StatusPage> = notifiedPages.filter(
      (statusPage: StatusPage): boolean => {
        return isReadable(this.getId(statusPage));
      },
    );

    const counts: Dictionary<IncidentSubscriberAudienceCounts> =
      readableNotifiedPages.length > 0
        ? await StatusPageSubscriberService.countActiveSubscribersByChannel({
            projectId: data.projectId,
            statusPageIds: readableNotifiedPages.map(
              (statusPage: StatusPage): ObjectID => {
                return new ObjectID(this.getId(statusPage));
              },
            ),
          })
        : {};

    const statusPages: Array<IncidentSubscriberAudienceStatusPage> =
      readableNotifiedPages.map(
        (statusPage: StatusPage): IncidentSubscriberAudienceStatusPage => {
          const id: string = this.getId(statusPage);

          return {
            statusPageId: id,
            name: readableNames[id] || "",
            subscriberCounts: {
              ...(counts[id] || IncidentSubscriberAudience.getEmptyCounts()),
            },
          };
        },
      );

    const excludedStatusPages: Array<IncidentSubscriberAudienceExcludedStatusPage> =
      excludedPages
        .filter((excluded: { statusPage: StatusPage }): boolean => {
          return isReadable(this.getId(excluded.statusPage));
        })
        .map(
          (excluded: {
            statusPage: StatusPage;
            reason: IncidentSubscriberAudienceExclusionReason;
          }): IncidentSubscriberAudienceExcludedStatusPage => {
            const id: string = this.getId(excluded.statusPage);

            return {
              statusPageId: id,
              name: readableNames[id] || "",
              reason: excluded.reason,
            };
          },
        );

    const selectedStatusPagesNotListingMonitors: Array<IncidentSubscriberAudienceNamedStatusPage> =
      selectedNotListingMonitorIds
        .filter(isReadable)
        .map((id: string): IncidentSubscriberAudienceNamedStatusPage => {
          return {
            statusPageId: id,
            name: readableNames[id] || "",
          };
        })
        .sort(
          (
            a: IncidentSubscriberAudienceNamedStatusPage,
            b: IncidentSubscriberAudienceNamedStatusPage,
          ): number => {
            return a.name.localeCompare(b.name, "en", {
              sensitivity: "base",
              numeric: true,
            });
          },
        );

    return {
      hasMonitors: data.inputs.hasMonitors,
      isScoped: data.inputs.resolved.isScoped,
      isHiddenFromStatusPages: data.inputs.isHiddenFromStatusPages,
      statusPages: statusPages,
      hiddenStatusPageCount: notifiedPages.length - statusPages.length,
      excludedStatusPages: excludedStatusPages,
      selectedStatusPagesNotListingMonitors:
        selectedStatusPagesNotListingMonitors,
    };
  }

  /*
   * The names of the status pages the caller may read, keyed by lower-cased
   * id, read with the caller's own permissions - and so through the labels
   * status page access is restricted by. A caller with no status page read
   * access at all can read none of them.
   */
  private static async getReadableNames(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    statusPageIds: Array<string>;
  }): Promise<Dictionary<string>> {
    const names: Dictionary<string> = {};

    const statusPageIds: Array<string> = this.normalizeIds(data.statusPageIds);

    if (statusPageIds.length === 0) {
      return names;
    }

    let statusPages: Array<StatusPage> = [];

    try {
      statusPages = await StatusPageService.findBy({
        query: {
          _id: QueryHelper.any(statusPageIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        limit: Math.min(statusPageIds.length, LIMIT_PER_PROJECT),
        skip: 0,
        props: data.props,
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return names;
      }

      throw err;
    }

    for (const statusPage of statusPages) {
      const id: string = this.getId(statusPage);

      if (id && statusPageIds.includes(id)) {
        names[id] = statusPage.name?.trim() || "Untitled status page";
      }
    }

    return names;
  }

  private static toExclusionReason(
    excluded: ExcludedStatusPage,
  ): IncidentSubscriberAudienceExclusionReason {
    return excluded.reason ===
      StatusPageExclusionReason.OnlyShowsScopedIncidents
      ? IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents
      : IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope;
  }

  private static getId(model: StatusPage | Monitor): string {
    return (model._id || model.id?.toString() || "").toString().toLowerCase();
  }

  /*
   * Ids in any shape they arrive in - an ObjectID, a string, a model or a
   * {_id} - lower-cased as the database returns them, without duplicates.
   */
  private static normalizeIds(value: unknown): Array<string> {
    return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(value);
  }
}
