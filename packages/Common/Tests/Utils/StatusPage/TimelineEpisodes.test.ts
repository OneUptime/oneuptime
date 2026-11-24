import StatusPageTimelineEpisodes, {
  TIMELINE_EPISODES_RESPONSE_KEY,
} from "../../../Utils/StatusPage/TimelineEpisodes";
import { JSONObject } from "../../../Types/JSON";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What a day of the uptime history lists on a page that shows episodes but
 * not incidents (#10767): the overview sends each episode with, for each of
 * its incidents the page would show, only when it was declared and which of
 * the page's monitors it is on. Each becomes a day's item, named, coloured
 * and opened as the episode, on the incident's day and resources.
 */

const EPISODE_ID: string = "e0000000-0000-4000-8000-000000000001";
const WEBSITE: string = "c0000000-0000-4000-8000-000000000001";
const API: string = "c0000000-0000-4000-8000-000000000002";

function dateTime(iso: string): JSONObject {
  return { _type: "DateTime", value: iso };
}

const EPISODE: JSONObject = {
  _id: EPISODE_ID,
  title: "Infrastructure Outage",
  currentIncidentState: {
    name: "Investigating",
    color: { _type: "Color", value: "#f59e0b" },
  },
  incidentSeverity: {
    name: "Major Incident",
    color: { _type: "Color", value: "#ef4444" },
  },
  incidents: [
    {
      declaredAt: dateTime("2026-11-23T09:00:00.000Z"),
      monitors: [{ _id: WEBSITE }],
    },
    {
      declaredAt: dateTime("2026-11-24T10:00:00.000Z"),
      monitors: [{ _id: API }, { _id: WEBSITE }],
    },
  ],
};

function items(timelineEpisodes: unknown): Array<UptimeBarTooltipIncident> {
  return StatusPageTimelineEpisodes.toTooltipIncidents({
    timelineEpisodes: timelineEpisodes,
    translateSeverityName: (name: string): string => {
      return `severity:${name}`;
    },
    translateStateName: (name: string): string => {
      return `state:${name}`;
    },
  });
}

describe("StatusPageTimelineEpisodes.toTooltipIncidents", () => {
  test("one item per incident of each episode, as the episode, on the incident's day and monitors", () => {
    const list: Array<UptimeBarTooltipIncident> = items([EPISODE]);

    expect(list).toHaveLength(2);

    expect(
      list.map((item: UptimeBarTooltipIncident) => {
        return {
          id: item.id,
          title: item.title,
          declaredAt: new Date(item.declaredAt).toISOString(),
          monitors: item.monitorIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        };
      }),
    ).toEqual([
      {
        id: EPISODE_ID,
        title: "Infrastructure Outage",
        declaredAt: "2026-11-23T09:00:00.000Z",
        monitors: [WEBSITE],
      },
      {
        id: EPISODE_ID,
        title: "Infrastructure Outage",
        declaredAt: "2026-11-24T10:00:00.000Z",
        monitors: [API, WEBSITE],
      },
    ]);
  });

  test("names the episode's severity and state in the page's words, in their colours", () => {
    const item: UptimeBarTooltipIncident = items([EPISODE])[0]!;

    expect(item.incidentSeverity?.name).toBe("severity:Major Incident");
    expect(item.incidentSeverity?.color.toString()).toBe("#ef4444");
    expect(item.currentIncidentState?.name).toBe("state:Investigating");
    expect(item.currentIncidentState?.color.toString()).toBe("#f59e0b");
  });

  test("an episode without a severity or a state names none", () => {
    const item: UptimeBarTooltipIncident = items([
      {
        _id: EPISODE_ID,
        title: "Quiet",
        incidents: [{ declaredAt: dateTime("2026-11-23T09:00:00.000Z") }],
      },
    ])[0]!;

    expect(item.incidentSeverity).toBeUndefined();
    expect(item.currentIncidentState).toBeUndefined();
    expect(item.monitorIds).toEqual([]);
  });

  test("an incident without a declaration is on no day, and an episode without an id is no item", () => {
    expect(
      items([
        { ...EPISODE, incidents: [{ monitors: [{ _id: WEBSITE }] }] },
        { title: "No id", incidents: EPISODE["incidents"] },
      ]),
    ).toEqual([]);
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["not a list", { episodes: [] }],
    ["a list of odd things", [null, 3, "x", []]],
  ])(
    "an answer whose episodes are %s lists none",
    (_label: string, value: unknown) => {
      expect(items(value)).toEqual([]);
    },
  );

  test("the overview names them under one key", () => {
    expect(TIMELINE_EPISODES_RESPONSE_KEY).toBe("timelineEpisodes");
  });
});
