import { describe, expect, test } from "@jest/globals";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import BadDataException from "../../../Types/Exception/BadDataException";
import EpisodeMembersAdd, {
  ALERT_EPISODE_ID_KEY,
  ALERT_EPISODE_MEMBERS_ADD_PATH,
  ALERT_IDS_KEY,
  ALERT_IDS_TO_ADD_KEY,
  ALERT_NOT_FOUND_REASON,
  ALERT_NOUNS,
  ALREADY_IN_EPISODE_REASON,
  EpisodeMembersAddResult,
  INCIDENT_EPISODE_ID_KEY,
  INCIDENT_EPISODE_MEMBERS_ADD_PATH,
  INCIDENT_IDS_KEY,
  INCIDENT_IDS_TO_ADD_KEY,
  INCIDENT_NOT_FOUND_REASON,
  INCIDENT_NOUNS,
  MAX_EPISODE_MEMBERS_PER_ADD,
} from "../../../Types/Episode/EpisodeMembersAdd";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * What adding several incidents or alerts to an episode shares between the
 * server and the dashboard: the routes, the body keys, the limit, the
 * words, and how a request's ids and an answer are read. Both sides read
 * these, so a change here is a change to the API.
 */

type MakeIdFunction = (index: number) => string;

const makeId: MakeIdFunction = (index: number): string => {
  return `9a000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
};

describe("the routes and keys", () => {
  test("each route sits under its member model's own API path", () => {
    const alertPath: string =
      new AlertEpisodeMember().getCrudApiPath()?.toString() || "";
    const incidentPath: string =
      new IncidentEpisodeMember().getCrudApiPath()?.toString() || "";

    expect(alertPath).toBe("/alert-episode-member");
    expect(incidentPath).toBe("/incident-episode-member");
    expect(ALERT_EPISODE_MEMBERS_ADD_PATH).toBe(`${alertPath}/add-alerts`);
    expect(INCIDENT_EPISODE_MEMBERS_ADD_PATH).toBe(
      `${incidentPath}/add-incidents`,
    );
  });

  test("the body keys name the episode and what is added, as the models name them", () => {
    expect(ALERT_EPISODE_ID_KEY).toBe("alertEpisodeId");
    expect(ALERT_IDS_KEY).toBe("alertIds");
    expect(INCIDENT_EPISODE_ID_KEY).toBe("incidentEpisodeId");
    expect(INCIDENT_IDS_KEY).toBe("incidentIds");
    expect(ALERT_IDS_TO_ADD_KEY).toBe("alertIdsToAdd");
    expect(INCIDENT_IDS_TO_ADD_KEY).toBe("incidentIdsToAdd");
  });

  test("the reasons are whole sentences", () => {
    for (const reason of [
      ALREADY_IN_EPISODE_REASON,
      ALERT_NOT_FOUND_REASON,
      INCIDENT_NOT_FOUND_REASON,
    ]) {
      expect(reason.endsWith(".")).toBe(true);
      expect(reason[0]).toBe(reason[0]!.toUpperCase());
    }

    // One that does not exist and one the caller cannot see read alike.
    expect(ALERT_NOT_FOUND_REASON).toContain("or you do not have access");
    expect(INCIDENT_NOT_FOUND_REASON).toContain("or you do not have access");
  });

  test("the limit is one hundred", () => {
    expect(MAX_EPISODE_MEMBERS_PER_ADD).toBe(100);
  });
});

describe("parseIds", () => {
  const parse: (value: unknown) => Array<string> = (
    value: unknown,
  ): Array<string> => {
    return EpisodeMembersAdd.parseIds({
      value: value,
      key: ALERT_IDS_KEY,
      nouns: ALERT_NOUNS,
    }).map((id: ObjectID): string => {
      return id.toString();
    });
  };

  test("keeps the ids in the order they were named", () => {
    expect(parse([makeId(3), makeId(1), makeId(2)])).toEqual([
      makeId(3),
      makeId(1),
      makeId(2),
    ]);
  });

  test("names each id once, the first time, whatever its case or padding", () => {
    expect(
      parse([
        makeId(1),
        ` ${makeId(2).toUpperCase()} `,
        makeId(2),
        makeId(1).toUpperCase(),
      ]),
    ).toEqual([makeId(1), makeId(2)]);
  });

  test("takes ObjectIDs as well as text", () => {
    expect(parse([new ObjectID(makeId(7)), makeId(8)])).toEqual([
      makeId(7),
      makeId(8),
    ]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", makeId(1)],
    ["an object", { 0: makeId(1) }],
    ["a number", 7],
  ])(
    "refuses %s in place of an array, naming the key",
    (_name: string, value: unknown) => {
      expect(() => {
        parse(value);
      }).toThrow(
        new BadDataException("alertIds must be an array of alert IDs."),
      );
    },
  );

  test.each([
    ["a word", "project-1"],
    ["an empty string", ""],
    ["a number", 1],
    ["an object", { _id: makeId(1) }],
    ["null", null],
  ])(
    "refuses an array holding %s, before anything else",
    (_name: string, value: unknown) => {
      expect(() => {
        parse([makeId(1), value]);
      }).toThrow(new BadDataException("alertIds must only contain alert IDs."));
    },
  );

  test("refuses an empty selection", () => {
    expect(() => {
      parse([]);
    }).toThrow(
      new BadDataException(
        "Please select at least one alert to add to the episode.",
      ),
    );
  });

  test("takes exactly the limit, and refuses one more, saying how many were selected", () => {
    const ids: Array<string> = Array.from(
      { length: MAX_EPISODE_MEMBERS_PER_ADD + 1 },
      (_value: unknown, index: number): string => {
        return makeId(index + 1);
      },
    );

    expect(parse(ids.slice(0, MAX_EPISODE_MEMBERS_PER_ADD))).toHaveLength(
      MAX_EPISODE_MEMBERS_PER_ADD,
    );

    expect(() => {
      parse(ids);
    }).toThrow(
      new BadDataException(
        "You can add at most 100 alerts to an episode at a time. 101 were selected.",
      ),
    );
  });

  test("counts the limit after repeats are dropped", () => {
    const ids: Array<string> = Array.from(
      { length: MAX_EPISODE_MEMBERS_PER_ADD },
      (_value: unknown, index: number): string => {
        return makeId(index + 1);
      },
    );

    expect(parse([...ids, ...ids])).toHaveLength(MAX_EPISODE_MEMBERS_PER_ADD);
  });

  test("says incidents for incidents", () => {
    expect(() => {
      EpisodeMembersAdd.parseIds({
        value: [],
        key: INCIDENT_IDS_KEY,
        nouns: INCIDENT_NOUNS,
      });
    }).toThrow(
      new BadDataException(
        "Please select at least one incident to add to the episode.",
      ),
    );

    expect(() => {
      EpisodeMembersAdd.parseIds({
        value: ["not-an-id"],
        key: INCIDENT_IDS_KEY,
        nouns: INCIDENT_NOUNS,
      });
    }).toThrow(
      new BadDataException("incidentIds must only contain incident IDs."),
    );
  });
});

describe("parseEpisodeId", () => {
  test("reads one id, as Postgres compares it", () => {
    expect(
      EpisodeMembersAdd.parseEpisodeId({
        value: ` ${makeId(5).toUpperCase()} `,
        key: ALERT_EPISODE_ID_KEY,
      }).toString(),
    ).toBe(makeId(5));

    expect(
      EpisodeMembersAdd.parseEpisodeId({
        value: new ObjectID(makeId(6)),
        key: ALERT_EPISODE_ID_KEY,
      }).toString(),
    ).toBe(makeId(6));
  });

  test.each([undefined, null, "", "episode-1", 12, [makeId(1)]])(
    "refuses %p",
    (value: unknown) => {
      expect(() => {
        EpisodeMembersAdd.parseEpisodeId({
          value: value,
          key: INCIDENT_EPISODE_ID_KEY,
        });
      }).toThrow(
        new BadDataException(
          "incidentEpisodeId must be the ID of the episode to add to.",
        ),
      );
    },
  );
});

describe("the answer", () => {
  const result: EpisodeMembersAddResult = {
    added: [makeId(1), makeId(2)],
    alreadyInEpisode: [makeId(3)],
    notAdded: [{ id: makeId(4), reason: ALERT_NOT_FOUND_REASON }],
  };

  test("reads back as it was written", () => {
    expect(
      EpisodeMembersAdd.fromJSON(
        JSON.parse(
          JSON.stringify(EpisodeMembersAdd.toJSON(result)),
        ) as JSONObject,
      ),
    ).toEqual(result);
  });

  test("an empty answer is three empty lists", () => {
    expect(EpisodeMembersAdd.emptyResult()).toEqual({
      added: [],
      alreadyInEpisode: [],
      notAdded: [],
    });
    expect(EpisodeMembersAdd.fromJSON(null)).toEqual({
      added: [],
      alreadyInEpisode: [],
      notAdded: [],
    });
  });

  test("leaves out what is not the shape, rather than trusting it", () => {
    expect(
      EpisodeMembersAdd.fromJSON({
        added: [makeId(1), 7, "", null] as unknown as JSONObject["added"],
        alreadyInEpisode: "everything",
        notAdded: [
          { id: makeId(2), reason: "Already deleted." },
          { id: 3, reason: "x" },
          { reason: "no id" },
          "a string",
          { id: makeId(4) },
        ] as unknown as JSONObject["notAdded"],
      }),
    ).toEqual({
      added: [makeId(1)],
      alreadyInEpisode: [],
      notAdded: [
        { id: makeId(2), reason: "Already deleted." },
        { id: makeId(4), reason: "" },
      ],
    });
  });

  test("normalizeId reads an id as Postgres compares it", () => {
    expect(EpisodeMembersAdd.normalizeId(` ${makeId(1).toUpperCase()}`)).toBe(
      makeId(1),
    );
    expect(EpisodeMembersAdd.normalizeId(new ObjectID(makeId(2)))).toBe(
      makeId(2),
    );
  });
});
