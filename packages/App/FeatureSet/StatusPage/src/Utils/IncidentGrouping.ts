import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { PluralTemplate } from "Common/Types/Translator";
import StatusPageIncidentGrouping, {
  INCIDENT_LIST_MODE_RESPONSE_KEY,
  PART_OF_EPISODES_RESPONSE_KEY,
  StatusPageIncidentListMode,
} from "Common/Utils/StatusPage/IncidentGrouping";

/*
 * What this page needs of a grouped incident list (issue #10767,
 * Common/Utils/StatusPage/IncidentGrouping): the mode an answer names, the
 * incidents each episode of it lists, the episodes an incident's own answer
 * says it is part of, and the words the page says about them.
 *
 * "Episode" is the team's word for incidents grouped together, never the
 * visitor's (Pages/Incidents/Detail): an episode card is an incident to them,
 * and the incidents it holds are its related incidents.
 */

// The fold under an episode's card: "3 related incidents".
export const RELATED_INCIDENTS_WORDS: PluralTemplate = {
  one: "{{count}} related incident",
  other: "{{count}} related incidents",
};

// An episode an incident's own page names, by its id and title.
export interface PartOfEpisode {
  id: string;
  title: string;
}

/*
 * The mode an answer names, or - from a server that predates the grouping
 * switch, which names none - each list on its own, as pages always drew them.
 */
export const readIncidentListMode: (
  ...answers: Array<JSONObject | null | undefined>
) => StatusPageIncidentListMode = (
  ...answers: Array<JSONObject | null | undefined>
): StatusPageIncidentListMode => {
  for (const answer of answers) {
    const mode: unknown = answer?.[INCIDENT_LIST_MODE_RESPONSE_KEY];

    if (mode !== undefined && mode !== null) {
      return StatusPageIncidentGrouping.readMode(
        mode,
        StatusPageIncidentListMode.Separate,
      );
    }
  }

  return StatusPageIncidentListMode.Separate;
};

/*
 * The incidents each episode of an answer lists, as models, keyed by the
 * episode's lower-cased id. An episode that lists none is not in it.
 */
export const readEpisodeIncidents: (
  episodes: JSONArray | null | undefined,
) => Dictionary<Array<Incident>> = (
  episodes: JSONArray | null | undefined,
): Dictionary<Array<Incident>> => {
  const incidentsByEpisode: Dictionary<Array<Incident>> = {};

  for (const value of episodes || []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const episode: JSONObject = value as JSONObject;
    const episodeId: string = String(episode["_id"] || "")
      .trim()
      .toLowerCase();
    const listed: Array<JSONObject> =
      StatusPageIncidentGrouping.getEpisodeIncidentsFromJson(episode);

    if (!episodeId || listed.length === 0) {
      continue;
    }

    incidentsByEpisode[episodeId] = BaseModel.fromJSONArray(
      listed as JSONArray,
      Incident,
    );
  }

  return incidentsByEpisode;
};

// The incidents an episode lists, by its id in any case.
export const getEpisodeIncidents: (
  incidentsByEpisode: Dictionary<Array<Incident>>,
  episodeId: string | null | undefined,
) => Array<Incident> = (
  incidentsByEpisode: Dictionary<Array<Incident>>,
  episodeId: string | null | undefined,
): Array<Incident> => {
  return (
    incidentsByEpisode[(episodeId || "").toString().trim().toLowerCase()] || []
  );
};

// The episodes an incident's own answer says it is part of.
export const readPartOfEpisodes: (
  answer: JSONObject | null | undefined,
) => Array<PartOfEpisode> = (
  answer: JSONObject | null | undefined,
): Array<PartOfEpisode> => {
  const episodes: unknown = answer?.[PART_OF_EPISODES_RESPONSE_KEY];

  if (!Array.isArray(episodes)) {
    return [];
  }

  const partOf: Array<PartOfEpisode> = [];

  for (const value of episodes) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const id: string = String((value as JSONObject)["_id"] || "").trim();
    const title: unknown = (value as JSONObject)["title"];

    if (id && typeof title === "string" && title.trim()) {
      partOf.push({ id: id, title: title });
    }
  }

  return partOf;
};
