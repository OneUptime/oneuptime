import {
  getEpisodeIncidents,
  readEpisodeIncidents,
  readIncidentListMode,
  readPartOfEpisodes,
  RELATED_INCIDENTS_WORDS,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/IncidentGrouping";
import Incident from "../../../Models/DatabaseModels/Incident";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { StatusPageIncidentListMode } from "../../../Utils/StatusPage/IncidentGrouping";
import { describe, expect, test } from "@jest/globals";

/*
 * What the status page reads of a grouped incident list from the public
 * API's answers (#10767): the mode they name, the incidents each episode
 * lists, and the episodes an incident's own answer says it is part of -
 * each read defensively, as an answer from a server the page does not
 * control.
 */

describe("readIncidentListMode", () => {
  test.each(Object.values(StatusPageIncidentListMode))(
    "reads %s from the first answer that names one",
    (mode: string) => {
      expect(
        readIncidentListMode(
          null,
          { incidentListMode: mode },
          {
            incidentListMode: "Separate",
          },
        ),
      ).toBe(mode);
    },
  );

  test("an older server's answers name none: each list on its own", () => {
    expect(readIncidentListMode({}, {})).toBe(
      StatusPageIncidentListMode.Separate,
    );
    expect(readIncidentListMode()).toBe(StatusPageIncidentListMode.Separate);
  });

  test("a mode the page does not know reads as each list on its own", () => {
    expect(readIncidentListMode({ incidentListMode: "Clustered" })).toBe(
      StatusPageIncidentListMode.Separate,
    );
  });
});

describe("readEpisodeIncidents", () => {
  const answer: Array<JSONObject> = [
    {
      _id: "E-1",
      incidents: [
        {
          _id: "i-1",
          title: "Website down",
          declaredAt: { _type: "DateTime", value: "2026-11-24T08:00:00.000Z" },
        },
        { _id: "i-2", title: "API down" },
      ],
    },
    { _id: "e-2", incidents: [] },
    { _id: "e-3" },
  ];

  test("reads each episode's incidents as models, keyed by its lower-cased id", () => {
    const read: Dictionary<Array<Incident>> = readEpisodeIncidents(answer);

    expect(Object.keys(read)).toEqual(["e-1"]);
    expect(
      read["e-1"]!.map((incident: Incident): string => {
        return incident.title || "";
      }),
    ).toEqual(["Website down", "API down"]);
    expect(read["e-1"]![0]!.declaredAt).toBeInstanceOf(Date);
  });

  test("finds an episode's incidents by its id in any case, and none for one that lists none", () => {
    const read: Dictionary<Array<Incident>> = readEpisodeIncidents(answer);

    expect(getEpisodeIncidents(read, "E-1")).toHaveLength(2);
    expect(getEpisodeIncidents(read, " e-1 ")).toHaveLength(2);
    expect(getEpisodeIncidents(read, "e-2")).toEqual([]);
    expect(getEpisodeIncidents(read, undefined)).toEqual([]);
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["a list of odd things", [null, 3, "x", [], { incidents: [{}] }]],
  ])(
    "an answer whose episodes are %s lists none",
    (_label: string, value: unknown) => {
      expect(readEpisodeIncidents(value as Array<JSONObject>)).toEqual({});
    },
  );
});

describe("readPartOfEpisodes", () => {
  test("reads each episode's id and title", () => {
    expect(
      readPartOfEpisodes({
        partOfEpisodes: [
          { _id: "e-1", title: "Infrastructure Outage" },
          { _id: "e-2", title: "Login trouble" },
        ],
      }),
    ).toEqual([
      { id: "e-1", title: "Infrastructure Outage" },
      { id: "e-2", title: "Login trouble" },
    ]);
  });

  test("leaves out an episode with no id or no title", () => {
    expect(
      readPartOfEpisodes({
        partOfEpisodes: [
          { title: "No id" },
          { _id: "e-1" },
          { _id: "e-2", title: "   " },
          null,
          "e-3",
          { _id: "e-4", title: "Kept" },
        ],
      }),
    ).toEqual([{ id: "e-4", title: "Kept" }]);
  });

  test("an answer that names none, or is not there, names none", () => {
    expect(readPartOfEpisodes({})).toEqual([]);
    expect(readPartOfEpisodes(null)).toEqual([]);
    expect(readPartOfEpisodes({ partOfEpisodes: "e-1" })).toEqual([]);
  });
});

describe("the fold's words", () => {
  test("say how many, in both forms", () => {
    expect(RELATED_INCIDENTS_WORDS).toEqual({
      one: "{{count}} related incident",
      other: "{{count}} related incidents",
    });
  });
});
