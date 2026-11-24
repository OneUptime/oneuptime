import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentEpisodeMemberService from "../../Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import IncidentStatusPageScope, {
  StatusPageScopeTarget,
} from "./IncidentStatusPageScope";
import StatusPageVisibilityQuery from "./StatusPageVisibilityQuery";

/*
 * WHAT A STATUS PAGE SAYS OF AN EPISODE'S INCIDENTS, AND OF AN INCIDENT'S
 * EPISODES (issue #10767).
 *
 * An episode card names the resources the episode affects, and - while the
 * page groups incidents by episode (StatusPageIncidentGrouping) - lists its
 * incidents. Both come from the incidents of the episode that the page
 * shows on their own: visible on status pages and not private
 * (StatusPageVisibilityQuery), in scope for the page (IncidentStatusPageScope)
 * and on one of the page's monitors - the rule every incident the page shows
 * goes through, applied in SQL before the list is cut to its limit. So an
 * incident hidden from status pages stays hidden inside its episode's card:
 * it is not listed, and the resources only it affects are not named. An
 * incident limited to other status pages, or one on a monitor the page does
 * not list, is not either.
 *
 * Each incident goes out with its monitors cut to the page's own
 * (keepPageMonitors): which other monitors an incident is on is the
 * project's business, as getTimelineScheduledMaintenanceEvents keeps a
 * maintenance event's.
 *
 * It does not ask who is reading: its callers in StatusPageAPI check that
 * the reader may read the page first.
 */

// What an episode's incident is listed with on the page.
export const EPISODE_INCIDENT_SELECT: Select<Incident> = {
  _id: true,
  title: true,
  declaredAt: true,
  createdAt: true,
  incidentSeverity: {
    name: true,
    color: true,
  },
  currentIncidentState: {
    _id: true,
    name: true,
    color: true,
    order: true,
  },
  monitors: {
    _id: true,
  },
};

// What an incident's page names its episodes by.
export interface ShownEpisodeOfIncident {
  _id: string;
  title: string;
}

// An id as the database returns it: lower-cased, trimmed.
const normalizeId: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const id: string = String(value).trim().toLowerCase();

  return id || undefined;
};

export default class StatusPageEpisodeIncidents {
  /*
   * The incidents of each episode that the page shows, newest first, keyed
   * by the episode's lower-cased id. An episode none of whose incidents the
   * page shows is keyed to an empty list.
   */
  public static async getShownIncidentsByEpisode(data: {
    statusPage: StatusPageScopeTarget;
    projectId: ObjectID;
    episodeIds: Array<ObjectID | string>;
    monitorsOnStatusPage: Array<ObjectID>;
  }): Promise<Map<string, Array<Incident>>> {
    const incidentsByEpisode: Map<string, Array<Incident>> = new Map();

    const episodeIds: Array<string> = [];

    for (const episodeId of data.episodeIds) {
      const id: string | undefined = normalizeId(episodeId);

      if (id && !episodeIds.includes(id)) {
        episodeIds.push(id);
        incidentsByEpisode.set(id, []);
      }
    }

    if (episodeIds.length === 0 || data.monitorsOnStatusPage.length === 0) {
      return incidentsByEpisode;
    }

    const members: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: QueryHelper.any(
            episodeIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          projectId: data.projectId,
        },
        select: {
          incidentEpisodeId: true,
          incidentId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const memberIncidentIds: Array<string> = [];

    for (const member of members) {
      const incidentId: string | undefined = normalizeId(member.incidentId);

      if (incidentId && !memberIncidentIds.includes(incidentId)) {
        memberIncidentIds.push(incidentId);
      }
    }

    if (memberIncidentIds.length === 0) {
      return incidentsByEpisode;
    }

    const shownIncidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: data.statusPage,
        query: {
          _id: QueryHelper.any(
            memberIncidentIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          monitors: data.monitorsOnStatusPage as any,
          projectId: data.projectId,
        },
        select: EPISODE_INCIDENT_SELECT,
        sort: {
          declaredAt: SortOrder.Descending,
          createdAt: SortOrder.Descending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const shownById: Map<string, Incident> = new Map();

    for (const incident of shownIncidents) {
      const incidentId: string | undefined = normalizeId(
        incident._id || incident.id,
      );

      if (incidentId) {
        incident.monitors = this.keepPageMonitors(
          incident.monitors,
          data.monitorsOnStatusPage,
        );
        shownById.set(incidentId, incident);
      }
    }

    // Each episode's, in the order the incidents were read: newest first.
    for (const incident of shownIncidents) {
      const incidentId: string | undefined = normalizeId(
        incident._id || incident.id,
      );

      if (!incidentId) {
        continue;
      }

      for (const member of members) {
        const episodeId: string | undefined = normalizeId(
          member.incidentEpisodeId,
        );

        if (
          !episodeId ||
          normalizeId(member.incidentId) !== incidentId ||
          !incidentsByEpisode.has(episodeId)
        ) {
          continue;
        }

        const listed: Array<Incident> = incidentsByEpisode.get(episodeId)!;

        if (
          !listed.some((existing: Incident): boolean => {
            return normalizeId(existing._id || existing.id) === incidentId;
          })
        ) {
          listed.push(shownById.get(incidentId)!);
        }
      }
    }

    return incidentsByEpisode;
  }

  /*
   * The monitors the incidents are on, each once, in the order they come:
   * what an episode's card names its resources from.
   */
  public static getMonitorIdsOfIncidents(
    incidents: Array<Incident>,
  ): Array<string> {
    const monitorIds: Array<string> = [];

    for (const incident of incidents) {
      for (const monitor of incident.monitors || []) {
        const monitorId: string | undefined = normalizeId(
          monitor?._id || monitor?.id,
        );

        if (monitorId && !monitorIds.includes(monitorId)) {
          monitorIds.push(monitorId);
        }
      }
    }

    return monitorIds;
  }

  /*
   * An episode's incidents as the page's answers carry them
   * (EPISODE_INCIDENTS_KEY): the incidents serialized as every incident the
   * page shows is, by the caller (serialize), then cut to what an episode's
   * card lists of each.
   */
  public static toJSON(data: {
    incidents: Array<Incident>;
    serialize: (incidents: Array<Incident>) => JSONArray;
  }): JSONArray {
    return data.serialize(data.incidents).map((item: unknown): JSONObject => {
      const json: JSONObject = item as JSONObject;
      const listed: JSONObject = {};

      for (const key of Object.keys(EPISODE_INCIDENT_SELECT)) {
        if (json[key] !== undefined) {
          listed[key] = json[key]!;
        }
      }

      return listed;
    });
  }

  /*
   * The episodes the page shows that an incident it shows belongs to:
   * visible on status pages and not private. The incident reaches the page,
   * so each of them does too, through it - the page lists them while it
   * shows episodes - and its page can name them.
   */
  public static async getShownEpisodesOfIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<Array<ShownEpisodeOfIncident>> {
    const members: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentId: data.incidentId,
          projectId: data.projectId,
        },
        select: {
          incidentEpisodeId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const episodeIds: Array<ObjectID> = [];

    for (const member of members) {
      const episodeId: string | undefined = normalizeId(
        member.incidentEpisodeId,
      );

      if (
        episodeId &&
        !episodeIds.some((id: ObjectID): boolean => {
          return id.toString() === episodeId;
        })
      ) {
        episodeIds.push(new ObjectID(episodeId));
      }
    }

    if (episodeIds.length === 0) {
      return [];
    }

    const episodes: Array<IncidentEpisode> =
      await IncidentEpisodeService.findBy({
        query: StatusPageVisibilityQuery.shownEpisodes({
          _id: QueryHelper.any(episodeIds),
          projectId: data.projectId,
        }),
        select: {
          _id: true,
          title: true,
        },
        sort: {
          declaredAt: SortOrder.Descending,
          createdAt: SortOrder.Descending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    return episodes
      .map((episode: IncidentEpisode): ShownEpisodeOfIncident | null => {
        const id: string | undefined = normalizeId(episode._id || episode.id);

        return id ? { _id: id, title: episode.title || "" } : null;
      })
      .filter(
        (
          episode: ShownEpisodeOfIncident | null,
        ): episode is ShownEpisodeOfIncident => {
          return Boolean(episode);
        },
      );
  }

  /*
   * An incident's monitors cut to the page's own (monitorsOnStatusPage: each
   * resource's monitor, and every monitor of a monitor group the page
   * lists), each once.
   */
  public static keepPageMonitors(
    monitors: Array<Monitor> | undefined,
    monitorsOnStatusPage: Array<ObjectID>,
  ): Array<Monitor> {
    const pageMonitorIds: Set<string> = new Set<string>();

    for (const monitorId of monitorsOnStatusPage) {
      const id: string | undefined = normalizeId(monitorId);

      if (id) {
        pageMonitorIds.add(id);
      }
    }

    const kept: Array<Monitor> = [];
    const seen: Set<string> = new Set<string>();

    for (const monitor of monitors || []) {
      const id: string | undefined = normalizeId(monitor?._id || monitor?.id);

      if (id && pageMonitorIds.has(id) && !seen.has(id)) {
        seen.add(id);
        kept.push(monitor);
      }
    }

    return kept;
  }
}
