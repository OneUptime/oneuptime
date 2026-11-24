import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Color from "../../Types/Color";
import { JSONObject } from "../../Types/JSON";
import UptimeBarTooltipIncident from "../../Types/Monitor/UptimeBarTooltipIncident";
import ObjectID from "../../Types/ObjectID";
import StatusPageIncidentGrouping from "./IncidentGrouping";

/*
 * WHAT A DAY OF THE UPTIME HISTORY LISTS ON A PAGE THAT SHOWS EPISODES BUT
 * NOT INCIDENTS (issue #10767).
 *
 * The page names no incident on its own there, so a day's tooltip and its
 * dialog said "No incidents" on a day that had them. The overview now sends
 * the episodes behind them (TIMELINE_EPISODES_RESPONSE_KEY,
 * StatusPageAPI.getTimelineEpisodes): each episode the page shows, with -
 * for each incident of it the page would show on its own - only when it was
 * declared and which of the page's monitors it is on. Here each of those
 * becomes one of the day's items, named, coloured and opened as its episode,
 * on the day and the resources of the incident: the page shows what it
 * already shows - the episode - on the days it reached each resource.
 *
 * An episode with two incidents on one day is listed once that day: the day
 * lists each event once (DayUptimeGraphUtil.getEventsOfDay).
 */

// The key the overview's answer sends them under.
export const TIMELINE_EPISODES_RESPONSE_KEY: string = "timelineEpisodes";

// The color a severity or a state without one is drawn in.
const NO_COLOR: Color = new Color("#000000");

export default class StatusPageTimelineEpisodes {
  /*
   * The days' items for the episodes an overview sent: one per incident of
   * each episode, the episode's id, title, severity and state with the
   * incident's declaration and monitors. Names go through the page's own
   * words for them (translate*). An answer without the key - an older
   * server's - lists none.
   */
  public static toTooltipIncidents(data: {
    timelineEpisodes: unknown;
    translateSeverityName: (name: string) => string;
    translateStateName: (name: string) => string;
  }): Array<UptimeBarTooltipIncident> {
    if (!Array.isArray(data.timelineEpisodes)) {
      return [];
    }

    const items: Array<UptimeBarTooltipIncident> = [];

    for (const value of data.timelineEpisodes) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }

      const json: JSONObject = value as JSONObject;
      const episode: IncidentEpisode = BaseModel.fromJSONObject(
        json,
        IncidentEpisode,
      );

      const episodeId: string = (episode._id || episode.id?.toString() || "")
        .toString()
        .trim();

      if (!episodeId) {
        continue;
      }

      for (const incidentJson of StatusPageIncidentGrouping.getEpisodeIncidentsFromJson(
        json,
      )) {
        const incident: Incident = BaseModel.fromJSONObject(
          incidentJson,
          Incident,
        );

        if (!incident.declaredAt) {
          continue;
        }

        items.push({
          id: episodeId,
          title: episode.title || "",
          declaredAt: incident.declaredAt,
          incidentSeverity: episode.incidentSeverity
            ? {
                name: data.translateSeverityName(
                  episode.incidentSeverity.name || "",
                ),
                color: episode.incidentSeverity.color || NO_COLOR,
              }
            : undefined,
          currentIncidentState: episode.currentIncidentState
            ? {
                name: data.translateStateName(
                  episode.currentIncidentState.name || "",
                ),
                color: episode.currentIncidentState.color || NO_COLOR,
              }
            : undefined,
          monitorIds: (incident.monitors || [])
            .map((monitor: Monitor): string => {
              return (monitor._id || monitor.id?.toString() || "").toString();
            })
            .filter((monitorId: string): boolean => {
              return Boolean(monitorId);
            })
            .map((monitorId: string): ObjectID => {
              return new ObjectID(monitorId);
            }),
        });
      }
    }

    return items;
  }
}
