import StatusPageIncidentGrouping, {
  EPISODE_INCIDENTS_KEY,
  GROUP_INCIDENTS_BY_EPISODE_COLUMN,
  INCIDENT_LIST_MODE_RESPONSE_KEY,
  StatusPageIncidentListCards,
  StatusPageIncidentListMode,
  StatusPageIncidentListSwitches,
} from "../../../Utils/StatusPage/IncidentGrouping";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * How a status page lists its incidents and episodes (#10767): the mode its
 * three switches put it in, and the cards each mode draws - above all that
 * grouping by episode folds an incident into its episode's card only when
 * that card is drawn, and draws no episode card that would list nothing.
 */

interface TestIncident {
  id: string;
  title: string;
}

interface TestEpisode {
  id: string;
  title: string;
  incidentIds: Array<string>;
}

const incident: (id: string) => TestIncident = (id: string): TestIncident => {
  return { id: id, title: `Incident ${id}` };
};

const episode: (id: string, incidentIds: Array<string>) => TestEpisode = (
  id: string,
  incidentIds: Array<string>,
): TestEpisode => {
  return { id: id, title: `Episode ${id}`, incidentIds: incidentIds };
};

const cardsOf: (data: {
  mode: StatusPageIncidentListMode;
  incidents: Array<TestIncident>;
  episodes: Array<TestEpisode>;
}) => { incidents: Array<string>; episodes: Array<string> } = (data: {
  mode: StatusPageIncidentListMode;
  incidents: Array<TestIncident>;
  episodes: Array<TestEpisode>;
}): { incidents: Array<string>; episodes: Array<string> } => {
  const cards: StatusPageIncidentListCards<TestIncident, TestEpisode> =
    StatusPageIncidentGrouping.getCards<TestIncident, TestEpisode>({
      mode: data.mode,
      incidents: data.incidents,
      episodes: data.episodes,
      getIncidentId: (item: TestIncident): string => {
        return item.id;
      },
      getEpisodeIncidentIds: (item: TestEpisode): Array<string> => {
        return item.incidentIds;
      },
    });

  return {
    incidents: cards.incidents.map((item: TestIncident): string => {
      return item.id;
    }),
    episodes: cards.episodes.map((item: TestEpisode): string => {
      return item.id;
    }),
  };
};

describe("StatusPageIncidentGrouping.getMode", () => {
  test.each([
    [true, true, true, StatusPageIncidentListMode.GroupedByEpisode],
    [true, true, false, StatusPageIncidentListMode.Separate],
    [true, false, true, StatusPageIncidentListMode.IncidentsOnly],
    [true, false, false, StatusPageIncidentListMode.IncidentsOnly],
    [false, true, true, StatusPageIncidentListMode.EpisodesOnly],
    [false, true, false, StatusPageIncidentListMode.EpisodesOnly],
    [false, false, true, StatusPageIncidentListMode.None],
    [false, false, false, StatusPageIncidentListMode.None],
  ])(
    "incidents %s, episodes %s, grouping %s is %s",
    (
      showIncidents: boolean,
      showEpisodes: boolean,
      group: boolean,
      expected: StatusPageIncidentListMode,
    ) => {
      expect(
        StatusPageIncidentGrouping.getMode({
          showIncidentsOnStatusPage: showIncidents,
          showEpisodesOnStatusPage: showEpisodes,
          groupIncidentsByEpisode: group,
        }),
      ).toBe(expected);
    },
  );

  test("a page from a server that predates the switch lists both kinds as it always did", () => {
    expect(
      StatusPageIncidentGrouping.getMode({
        showIncidentsOnStatusPage: true,
        showEpisodesOnStatusPage: true,
      }),
    ).toBe(StatusPageIncidentListMode.Separate);
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["the string true", "true"],
    ["one", 1],
  ])(
    "a switch that is %s counts as off: only true turns one on",
    (_label: string, value: unknown) => {
      const switches: StatusPageIncidentListSwitches = {
        showIncidentsOnStatusPage: value,
        showEpisodesOnStatusPage: value,
        groupIncidentsByEpisode: value,
      };

      expect(StatusPageIncidentGrouping.getMode(switches)).toBe(
        StatusPageIncidentListMode.None,
      );
      expect(
        StatusPageIncidentGrouping.getMode({
          showIncidentsOnStatusPage: true,
          showEpisodesOnStatusPage: true,
          groupIncidentsByEpisode: value,
        }),
      ).toBe(StatusPageIncidentListMode.Separate);
    },
  );

  test("no page at all is None", () => {
    expect(StatusPageIncidentGrouping.getMode(undefined)).toBe(
      StatusPageIncidentListMode.None,
    );
    expect(StatusPageIncidentGrouping.getMode(null)).toBe(
      StatusPageIncidentListMode.None,
    );
  });

  test("a new page, as the model makes one, groups incidents by episode", () => {
    const page: StatusPage = new StatusPage();

    expect(
      StatusPageIncidentGrouping.getMode({
        showIncidentsOnStatusPage: page.getTableColumnMetadata(
          "showIncidentsOnStatusPage",
        )?.defaultValue,
        showEpisodesOnStatusPage: page.getTableColumnMetadata(
          "showEpisodesOnStatusPage",
        )?.defaultValue,
        groupIncidentsByEpisode: page.getTableColumnMetadata(
          GROUP_INCIDENTS_BY_EPISODE_COLUMN,
        )?.defaultValue,
      }),
    ).toBe(StatusPageIncidentListMode.GroupedByEpisode);
  });
});

describe("StatusPageIncidentGrouping.readMode", () => {
  test.each(Object.values(StatusPageIncidentListMode))(
    "reads %s as it is named",
    (mode: string) => {
      expect(
        StatusPageIncidentGrouping.readMode(
          mode,
          StatusPageIncidentListMode.None,
        ),
      ).toBe(mode);
    },
  );

  test.each([
    ["missing", undefined],
    ["null", null],
    ["unknown", "Grouped"],
    ["lower-cased", "groupedbyepisode"],
    ["a number", 3],
    ["an object", { mode: "Separate" }],
  ])(
    "a mode that is %s reads as the fallback",
    (_label: string, value: unknown) => {
      expect(
        StatusPageIncidentGrouping.readMode(
          value,
          StatusPageIncidentListMode.Separate,
        ),
      ).toBe(StatusPageIncidentListMode.Separate);
    },
  );

  test("the answers name it under one key", () => {
    expect(INCIDENT_LIST_MODE_RESPONSE_KEY).toBe("incidentListMode");
  });
});

describe("StatusPageIncidentGrouping - what each mode draws", () => {
  test.each([
    [StatusPageIncidentListMode.None, false, false],
    [StatusPageIncidentListMode.IncidentsOnly, true, false],
    [StatusPageIncidentListMode.EpisodesOnly, false, true],
    [StatusPageIncidentListMode.Separate, true, true],
    [StatusPageIncidentListMode.GroupedByEpisode, true, true],
  ])(
    "%s: incidents %s, episodes %s",
    (
      mode: StatusPageIncidentListMode,
      incidents: boolean,
      episodes: boolean,
    ) => {
      expect(StatusPageIncidentGrouping.showsIncidents(mode)).toBe(incidents);
      expect(StatusPageIncidentGrouping.showsEpisodes(mode)).toBe(episodes);
      expect(StatusPageIncidentGrouping.isGroupedByEpisode(mode)).toBe(
        mode === StatusPageIncidentListMode.GroupedByEpisode,
      );
    },
  );
});

describe("StatusPageIncidentGrouping.getCards", () => {
  const website: TestIncident = incident("website");
  const api: TestIncident = incident("api");
  const database: TestIncident = incident("database");
  const lonely: TestIncident = incident("lonely");

  test("one incident in no episode is a card of its own in every mode that shows incidents", () => {
    for (const mode of [
      StatusPageIncidentListMode.IncidentsOnly,
      StatusPageIncidentListMode.Separate,
      StatusPageIncidentListMode.GroupedByEpisode,
    ]) {
      expect(
        cardsOf({ mode: mode, incidents: [lonely], episodes: [] }),
      ).toEqual({ incidents: ["lonely"], episodes: [] });
    }
  });

  test("grouped, an episode of three is one card and its incidents get none of their own", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [website, api, database],
        episodes: [episode("outage", ["website", "api", "database"])],
      }),
    ).toEqual({ incidents: [], episodes: ["outage"] });
  });

  test("separate, the same episode of three is four cards, as pages always drew it", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.Separate,
        incidents: [website, api, database],
        episodes: [episode("outage", ["website", "api", "database"])],
      }),
    ).toEqual({
      incidents: ["website", "api", "database"],
      episodes: ["outage"],
    });
  });

  test("grouped, a mix: the episode's incidents fold into it, the one outside keeps its card", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [website, lonely, api, database],
        episodes: [episode("outage", ["website", "api", "database"])],
      }),
    ).toEqual({ incidents: ["lonely"], episodes: ["outage"] });
  });

  test("grouped, an episode with a hidden incident lists only what it holds, and the rest fold in", () => {
    // The server lists only the incidents of an episode the page shows.
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [website, api],
        episodes: [episode("outage", ["website", "api"])],
      }),
    ).toEqual({ incidents: [], episodes: ["outage"] });
  });

  test("grouped, an episode with only hidden incidents is not drawn: it would list nothing", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [lonely],
        episodes: [episode("hidden-only", [])],
      }),
    ).toEqual({ incidents: ["lonely"], episodes: [] });
  });

  test("grouped, an incident whose episode the page does not draw keeps its card", () => {
    // Its episode is hidden or private, so it is not among the episodes.
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [website, api],
        episodes: [],
      }),
    ).toEqual({ incidents: ["website", "api"], episodes: [] });
  });

  test("grouped, an episode drawn for none of the listed incidents still folds only what it holds", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [website],
        episodes: [episode("older", ["older-incident"])],
      }),
    ).toEqual({ incidents: ["website"], episodes: ["older"] });
  });

  test("grouped, an incident two drawn episodes hold folds into both and has no card", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [website],
        episodes: [
          episode("first", ["website"]),
          episode("second", ["website"]),
        ],
      }),
    ).toEqual({ incidents: [], episodes: ["first", "second"] });
  });

  test("grouped, ids match whatever case and spaces they arrive in", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [incident("AbC-1")],
        episodes: [episode("outage", [" abc-1 "])],
      }),
    ).toEqual({ incidents: [], episodes: ["outage"] });
  });

  test("grouped, an incident with no id cannot be folded, so it keeps its card", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [incident("")],
        episodes: [episode("outage", ["website"])],
      }),
    ).toEqual({ incidents: [""], episodes: ["outage"] });
  });

  test("episodes only draws the episodes and no incident, whatever they hold", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.EpisodesOnly,
        incidents: [website, lonely],
        episodes: [episode("outage", ["website"]), episode("bare", [])],
      }),
    ).toEqual({ incidents: [], episodes: ["outage", "bare"] });
  });

  test("incidents only draws every incident and no episode", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.IncidentsOnly,
        incidents: [website, lonely],
        episodes: [episode("outage", ["website"])],
      }),
    ).toEqual({ incidents: ["website", "lonely"], episodes: [] });
  });

  test("none draws nothing", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.None,
        incidents: [website],
        episodes: [episode("outage", ["website"])],
      }),
    ).toEqual({ incidents: [], episodes: [] });
  });

  test("each list keeps the order it came in", () => {
    expect(
      cardsOf({
        mode: StatusPageIncidentListMode.GroupedByEpisode,
        incidents: [incident("c"), incident("a"), incident("b")],
        episodes: [episode("z", ["x"]), episode("y", ["w"])],
      }),
    ).toEqual({ incidents: ["c", "a", "b"], episodes: ["z", "y"] });
  });

  test("never changes what it is handed", () => {
    const incidents: Array<TestIncident> = [website, api];
    const episodes: Array<TestEpisode> = [episode("outage", ["website"])];

    cardsOf({
      mode: StatusPageIncidentListMode.GroupedByEpisode,
      incidents: incidents,
      episodes: episodes,
    });

    expect(incidents).toEqual([website, api]);
    expect(episodes).toEqual([episode("outage", ["website"])]);
  });
});

describe("StatusPageIncidentGrouping - an episode's incidents as the API sends them", () => {
  test("reads each incident's id under the episode's incidents key", () => {
    const json: JSONObject = {
      _id: "episode-1",
      [EPISODE_INCIDENTS_KEY]: [
        { _id: "Incident-A", title: "Website down" },
        { _id: "incident-b", title: "API down" },
      ],
    };

    expect(
      StatusPageIncidentGrouping.getEpisodeIncidentIdsFromJson(json),
    ).toEqual(["incident-a", "incident-b"]);
    expect(EPISODE_INCIDENTS_KEY).toBe("incidents");
  });

  test.each([
    ["no key", {}],
    ["a key that is not a list", { [EPISODE_INCIDENTS_KEY]: "incident-a" }],
    ["a list of odd things", { [EPISODE_INCIDENTS_KEY]: [null, 3, "x", []] }],
  ])(
    "an episode with %s lists no incident",
    (_label: string, json: unknown) => {
      expect(
        StatusPageIncidentGrouping.getEpisodeIncidentIdsFromJson(
          json as JSONObject,
        ),
      ).toEqual([]);
    },
  );

  test("an incident without an id is left out", () => {
    expect(
      StatusPageIncidentGrouping.getEpisodeIncidentIdsFromJson({
        [EPISODE_INCIDENTS_KEY]: [{ title: "No id" }, { _id: "kept" }],
      }),
    ).toEqual(["kept"]);
  });

  test("no episode lists nothing", () => {
    expect(
      StatusPageIncidentGrouping.getEpisodeIncidentIdsFromJson(undefined),
    ).toEqual([]);
    expect(
      StatusPageIncidentGrouping.getEpisodeIncidentsFromJson(null),
    ).toEqual([]);
  });
});
