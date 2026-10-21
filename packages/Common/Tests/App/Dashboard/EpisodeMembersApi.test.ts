import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock consts are still unassigned when the
 * factories run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
      getCommonHeaders: () => {
        return { tenantid: "the-project" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
    },
  };
});

import {
  ALERT_EPISODE_MEMBER_KIND,
  EpisodeMemberKindConfig,
  INCIDENT_EPISODE_MEMBER_KIND,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeMemberKinds";
import {
  EPISODE_MEMBER_IDS_LIMIT,
  EPISODE_MEMBER_PICKER_LIMIT,
  EpisodeRecordRow,
  EpisodeRows,
  OPEN_EPISODE_PICKER_LIMIT,
  RESOLVED_EPISODE_PICKER_LIMIT,
  addToEpisode,
  createEpisodeWith,
  fetchEpisodeLabels,
  fetchEpisodeMemberIds,
  fetchEpisodeRows,
  fetchRecordRows,
  fetchRecordsForNewEpisode,
  fetchSeverities,
  getEpisodeRow,
  getNumberLabel,
  getPill,
  getRecordRow,
  getSearchText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeMembersApi";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import Project from "../../../Models/DatabaseModels/Project";
import {
  ALERT_IN_ANOTHER_EPISODE_REASON,
  INCIDENT_IN_ANOTHER_EPISODE_REASON,
} from "../../../Types/Episode/EpisodeSingleMembership";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Black } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import {
  ALERT_EPISODE_MEMBERS_ADD_PATH,
  INCIDENT_EPISODE_MEMBERS_ADD_PATH,
  MAX_EPISODE_MEMBERS_PER_ADD,
} from "../../../Types/Episode/EpisodeMembersAdd";
import ObjectID from "../../../Types/ObjectID";

/*
 * What the dialogs that add incidents or alerts to an episode read and
 * write (EpisodeMembersApi): which rows they ask for and how they read them,
 * and the two writes - the add request and the episode created with them.
 * ModelAPI and API are stand-ins that record what they were asked.
 */

const RED: Color = new Color("#ff0000");

type ListResultFunction = (data: Array<unknown>) => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const listResult: ListResultFunction = (data: Array<unknown>) => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

type IdFunction = (index: number) => string;

const id: IdFunction = (index: number): string => {
  return `5e000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
};

function alertOf(values: Record<string, unknown>): Alert {
  const alert: Alert = new Alert();
  Object.assign(alert, values);
  return alert;
}

function lastListCall(): Record<string, any> {
  const calls: Array<Array<any>> = getListMock.mock.calls as Array<Array<any>>;
  return calls[calls.length - 1]![0];
}

beforeEach(() => {
  getListMock.mockReset();
  createMock.mockReset();
  postMock.mockReset();
  getListMock.mockResolvedValue(listResult([]));
});

describe("how a row is read", () => {
  test("a number reads with the project's prefix, else as #n, else not at all", () => {
    expect(getNumberLabel("ALT-63", 63)).toBe("ALT-63");
    expect(getNumberLabel("  ", 63)).toBe("#63");
    expect(getNumberLabel(undefined, 7)).toBe("#7");
    expect(getNumberLabel(undefined, undefined)).toBeUndefined();
    expect(getNumberLabel(12, "12")).toBeUndefined();
  });

  test("a state or severity is a pill; one that lost its name or colour still shows", () => {
    expect(getPill({ name: "Critical", color: RED })).toEqual({
      name: "Critical",
      color: RED,
    });
    expect(getPill({ name: "", color: "red" })).toEqual({
      name: "Unknown",
      color: Black,
    });
    expect(getPill(undefined)).toBeUndefined();
    expect(getPill("Critical")).toBeUndefined();
  });

  test("a search by number may start with #", () => {
    expect(getSearchText("  #12 ")).toBe("12");
    expect(getSearchText("ALT-12")).toBe("ALT-12");
    expect(getSearchText("   ")).toBe("");
  });

  test("an alert row: its number, title, privacy, pills, date and the latest other episode it is in", () => {
    const state: AlertState = new AlertState();
    state.name = "Firing";
    state.color = RED;

    const createdAt: Date = new Date("2026-10-14T08:00:00.000Z");

    const row: EpisodeRecordRow = getRecordRow(
      ALERT_EPISODE_MEMBER_KIND,
      alertOf({
        _id: id(1).toUpperCase(),
        title: "Checkout API is offline",
        isPrivate: true,
        alertNumber: 63,
        alertNumberWithPrefix: "ALT-63",
        currentAlertState: state,
        createdAt: createdAt,
        alertEpisodeId: new ObjectID(id(9)),
      }),
    );

    expect(row).toEqual({
      id: id(1),
      number: "ALT-63",
      title: "Checkout API is offline",
      isPrivate: true,
      state: { name: "Firing", color: RED },
      severity: undefined,
      date: createdAt,
      otherEpisodeId: id(9),
    });
  });

  test("an incident row is dated by when it was declared", () => {
    const incident: Incident = new Incident();
    incident._id = id(2);
    incident.title = "Database down";
    incident.declaredAt = new Date("2026-10-13T08:00:00.000Z");
    incident.createdAt = new Date("2026-10-14T08:00:00.000Z");

    expect(getRecordRow(INCIDENT_EPISODE_MEMBER_KIND, incident).date).toEqual(
      new Date("2026-10-13T08:00:00.000Z"),
    );
  });

  test("an episode row: its count, and whether it is resolved", () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode._id = id(3);
    episode.title = "Checkout degradation";
    episode.episodeNumberWithPrefix = "AE-3";
    episode.alertCount = 4;
    episode.resolvedAt = new Date();

    expect(getEpisodeRow(ALERT_EPISODE_MEMBER_KIND, episode)).toEqual(
      expect.objectContaining({
        id: id(3),
        number: "AE-3",
        memberCount: 4,
        isResolved: true,
      }),
    );
  });

  test("an episode row is dated by what its section is sorted by: when it started, or when it was resolved", () => {
    const createdAt: Date = new Date("2026-10-13T08:00:00.000Z");
    const resolvedAt: Date = new Date("2026-10-14T09:30:00.000Z");

    const ongoing: AlertEpisode = new AlertEpisode();
    ongoing._id = id(4);
    ongoing.createdAt = createdAt;

    const resolved: AlertEpisode = new AlertEpisode();
    resolved._id = id(5);
    resolved.createdAt = createdAt;
    resolved.resolvedAt = resolvedAt;

    expect(getEpisodeRow(ALERT_EPISODE_MEMBER_KIND, ongoing).date).toEqual(
      createdAt,
    );
    expect(getEpisodeRow(ALERT_EPISODE_MEMBER_KIND, resolved).date).toEqual(
      resolvedAt,
    );
  });
});

describe("what the add dialog lists", () => {
  test("newest first, leaving out what the episode holds, as the person", async () => {
    await fetchRecordRows({
      config: ALERT_EPISODE_MEMBER_KIND,
      searchText: "",
      excludedIds: [id(1), id(2)],
    });

    const call: Record<string, any> = lastListCall();

    expect(call["modelType"]).toBe(Alert);
    expect(call["query"]["_id"]).toBeInstanceOf(IncludesNone);
    expect((call["query"]["_id"] as IncludesNone).values).toEqual([
      id(1),
      id(2),
    ]);
    expect(call["query"]["_multiFieldSearch"]).toBeUndefined();
    expect(call["limit"]).toBe(EPISODE_MEMBER_PICKER_LIMIT);
    expect(call["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(call["select"]).toEqual(
      expect.objectContaining({
        alertNumber: true,
        alertNumberWithPrefix: true,
        alertEpisodeId: true,
        currentAlertState: { _id: true, name: true, color: true },
        alertSeverity: { _id: true, name: true, color: true },
      }),
    );
  });

  /*
   * A project that allows one in only one episode (EpisodeSingleMembership):
   * the list asks for the ones that can be added - in no episode at all.
   */
  test.each([ALERT_EPISODE_MEMBER_KIND, INCIDENT_EPISODE_MEMBER_KIND])(
    "only the ones in no episode, when asked: the $kind's own episode column is empty",
    async (config: EpisodeMemberKindConfig) => {
      await fetchRecordRows({
        config: config,
        searchText: "",
        excludedIds: [id(1)],
        onlyOutsideEpisodes: true,
      });

      const call: Record<string, any> = lastListCall();

      expect(call["query"][config.recordEpisodeIdField]).toBeInstanceOf(IsNull);
      // Still leaving out what the episode holds.
      expect((call["query"]["_id"] as IncludesNone).values).toEqual([id(1)]);
    },
  );

  test("unasked, the episode column is not filtered: one in another episode is listed", async () => {
    await fetchRecordRows({
      config: ALERT_EPISODE_MEMBER_KIND,
      searchText: "",
      excludedIds: [],
      onlyOutsideEpisodes: false,
    });

    expect(lastListCall()["query"]["alertEpisodeId"]).toBeUndefined();
  });

  test("a search looks at the title and the number, with or without its prefix", async () => {
    await fetchRecordRows({
      config: INCIDENT_EPISODE_MEMBER_KIND,
      searchText: "#42",
      excludedIds: [],
    });

    const call: Record<string, any> = lastListCall();
    const search: MultiSearch = call["query"]["_multiFieldSearch"];

    expect(call["query"]["_id"]).toBeUndefined();
    expect(search).toBeInstanceOf(MultiSearch);
    expect(search.fields).toEqual([
      "title",
      "incidentNumberWithPrefix",
      "incidentNumber",
    ]);
    expect(search.value).toBe("42");
    expect(call["sort"]).toEqual({ declaredAt: SortOrder.Descending });
  });

  test("a row without an id is dropped", async () => {
    getListMock.mockResolvedValue(
      listResult([alertOf({ title: "No id" }), alertOf({ _id: id(4) })]),
    );

    const rows: Array<EpisodeRecordRow> = await fetchRecordRows({
      config: ALERT_EPISODE_MEMBER_KIND,
      searchText: "",
      excludedIds: [],
    });

    expect(
      rows.map((row: EpisodeRecordRow): string => {
        return row.id;
      }),
    ).toEqual([id(4)]);
  });

  test("what an episode holds is read from its membership rows, each once", async () => {
    const memberships: Array<AlertEpisodeMember> = [id(5), id(5), id(6)].map(
      (alertId: string): AlertEpisodeMember => {
        const member: AlertEpisodeMember = new AlertEpisodeMember();
        member.alertId = new ObjectID(alertId.toUpperCase());
        return member;
      },
    );
    getListMock.mockResolvedValue(listResult(memberships));

    const ids: Array<string> = await fetchEpisodeMemberIds({
      config: ALERT_EPISODE_MEMBER_KIND,
      episodeId: new ObjectID(id(9)),
    });

    expect(ids).toEqual([id(5), id(6)]);

    const call: Record<string, any> = lastListCall();
    expect(call["modelType"]).toBe(AlertEpisodeMember);
    expect(call["query"]).toEqual({ alertEpisodeId: new ObjectID(id(9)) });
    expect(call["limit"]).toBe(EPISODE_MEMBER_IDS_LIMIT);
  });

  test("the other episodes rows are in are named only if the person can see them", async () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode._id = id(7);
    episode.episodeNumber = 7;
    episode.title = "Checkout degradation";
    getListMock.mockResolvedValue(listResult([episode]));

    const labels: Map<string, unknown> = await fetchEpisodeLabels({
      config: ALERT_EPISODE_MEMBER_KIND,
      episodeIds: [id(7), id(7), id(8)],
    });

    expect(Array.from(labels.entries())).toEqual([
      [id(7), { number: "#7", title: "Checkout degradation" }],
    ]);
    expect((lastListCall()["query"]["_id"] as Includes).values).toEqual([
      id(7),
      id(8),
    ]);
  });

  test("no other episode asks nothing", async () => {
    await fetchEpisodeLabels({
      config: ALERT_EPISODE_MEMBER_KIND,
      episodeIds: [],
    });

    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("what Add to Existing Episode lists", () => {
  test("the open episodes newest first, then the most recently resolved, both searched alike", async () => {
    const open: AlertEpisode = new AlertEpisode();
    open._id = id(10);
    const resolved: AlertEpisode = new AlertEpisode();
    resolved._id = id(11);
    resolved.resolvedAt = new Date();

    getListMock.mockImplementation((async (call: Record<string, any>) => {
      return listResult(
        call["query"]["resolvedAt"] instanceof IsNull ? [open] : [resolved],
      );
    }) as never);

    const rows: EpisodeRows = await fetchEpisodeRows({
      config: ALERT_EPISODE_MEMBER_KIND,
      searchText: "AE-1",
    });

    expect(
      rows.open.map((row: { id: string }) => {
        return row.id;
      }),
    ).toEqual([id(10)]);
    expect(
      rows.resolved.map((row: { id: string }) => {
        return row.id;
      }),
    ).toEqual([id(11)]);

    const calls: Array<Record<string, any>> = (
      getListMock.mock.calls as Array<Array<any>>
    ).map((args: Array<any>) => {
      return args[0];
    });

    const openCall: Record<string, any> = calls.find(
      (call: Record<string, any>) => {
        return call["query"]["resolvedAt"] instanceof IsNull;
      },
    )!;
    const resolvedCall: Record<string, any> = calls.find(
      (call: Record<string, any>) => {
        return call["query"]["resolvedAt"] instanceof NotNull;
      },
    )!;

    expect(openCall["modelType"]).toBe(AlertEpisode);
    expect(openCall["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(openCall["limit"]).toBe(OPEN_EPISODE_PICKER_LIMIT);
    expect(resolvedCall["sort"]).toEqual({ resolvedAt: SortOrder.Descending });
    expect(resolvedCall["limit"]).toBe(RESOLVED_EPISODE_PICKER_LIMIT);

    for (const call of [openCall, resolvedCall]) {
      expect(call["query"]["_multiFieldSearch"].fields).toEqual([
        "title",
        "episodeNumberWithPrefix",
        "episodeNumber",
      ]);
      expect(call["query"]["_multiFieldSearch"].value).toBe("AE-1");
      expect(call["select"]).toEqual(
        expect.objectContaining({ alertCount: true, resolvedAt: true }),
      );
    }
  });
});

describe("what Add to New Episode starts from", () => {
  test("the selected rows, read fresh, in the order they were selected; one gone is left out", async () => {
    getListMock.mockResolvedValue(
      listResult([
        alertOf({
          _id: id(21),
          title: "Second",
          alertSeverityId: new ObjectID(id(31)),
        }),
        alertOf({
          _id: id(20),
          title: "First",
          isPrivate: true,
          alertEpisodeId: new ObjectID(id(40)),
        }),
      ]),
    );

    const records: Array<Record<string, unknown>> =
      (await fetchRecordsForNewEpisode({
        config: ALERT_EPISODE_MEMBER_KIND,
        ids: [id(20), id(21).toUpperCase(), id(22)],
      })) as unknown as Array<Record<string, unknown>>;

    expect(records).toEqual([
      {
        id: id(20),
        title: "First",
        isPrivate: true,
        otherEpisodeId: id(40),
      },
      {
        id: id(21),
        title: "Second",
        isPrivate: false,
        severityId: id(31),
      },
    ]);
    expect((lastListCall()["query"]["_id"] as Includes).values).toEqual([
      id(20),
      id(21).toUpperCase(),
      id(22),
    ]);
  });

  test("nothing selected asks nothing", async () => {
    expect(
      await fetchRecordsForNewEpisode({
        config: ALERT_EPISODE_MEMBER_KIND,
        ids: [],
      }),
    ).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("the project's severities, most severe first", async () => {
    const critical: IncidentSeverity = new IncidentSeverity();
    critical._id = id(50);
    critical.name = "Critical";
    critical.order = 1;
    critical.color = RED;
    getListMock.mockResolvedValue(listResult([critical]));

    expect(
      await fetchSeverities({ config: INCIDENT_EPISODE_MEMBER_KIND }),
    ).toEqual([{ id: id(50), name: "Critical", order: 1, color: RED }]);
    expect(lastListCall()["modelType"]).toBe(IncidentSeverity);
    expect(lastListCall()["sort"]).toEqual({ order: SortOrder.Ascending });
  });
});

describe("adding to an episode", () => {
  test.each([
    [ALERT_EPISODE_MEMBER_KIND, ALERT_EPISODE_MEMBERS_ADD_PATH],
    [INCIDENT_EPISODE_MEMBER_KIND, INCIDENT_EPISODE_MEMBERS_ADD_PATH],
  ])(
    "is one request to the route the server serves, in the project",
    async (config: EpisodeMemberKindConfig, path: string) => {
      postMock.mockResolvedValue(
        new HTTPResponse(
          200,
          { added: [id(1)], alreadyInEpisode: [id(2)], notAdded: [] },
          {},
        ),
      );

      const result: unknown = await addToEpisode({
        config: config,
        episodeId: id(9),
        ids: [id(1), id(2)],
      });

      expect(result).toEqual({
        added: [id(1)],
        alreadyInEpisode: [id(2)],
        notAdded: [],
      });

      expect(postMock).toHaveBeenCalledTimes(1);
      const call: Record<string, any> = (
        postMock.mock.calls as Array<Array<any>>
      )[0]![0];

      // The route the dashboard writes out is the one the server serves.
      expect(call["url"].toString().endsWith(`/api${path}`)).toBe(true);
      expect(call["data"]).toEqual({
        [config.episodeIdKey]: id(9),
        [config.idsKey]: [id(1), id(2)],
      });
      expect(call["headers"]).toEqual({ tenantid: "the-project" });
    },
  );

  test("a refusal is thrown, for the dialog to show", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "The episode to add the alerts to does not exist." },
      {},
    );
    postMock.mockResolvedValue(refusal);

    let outcome: unknown = "went on";
    try {
      await addToEpisode({
        config: ALERT_EPISODE_MEMBER_KIND,
        episodeId: id(9),
        ids: [id(1)],
      });
    } catch (error) {
      outcome = error;
    }

    expect(outcome).toBe(refusal);
  });

  test("more than the server takes is never sent", async () => {
    let outcome: unknown = "went on";
    try {
      await addToEpisode({
        config: ALERT_EPISODE_MEMBER_KIND,
        episodeId: id(9),
        ids: Array.from(
          { length: MAX_EPISODE_MEMBERS_PER_ADD + 1 },
          (_value: unknown, index: number): string => {
            return id(index + 1);
          },
        ),
      });
    } catch (error) {
      outcome = error;
    }

    expect(outcome).toBeInstanceOf(Error);
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("creating an episode with them", () => {
  test("is the episode's own create, carrying their ids, with the title and severity asked", async () => {
    createMock.mockResolvedValue(
      new HTTPResponse(
        200,
        { _id: id(60), episodeNumberWithPrefix: "IE-12" },
        {},
      ),
    );

    const created: unknown = await createEpisodeWith({
      config: INCIDENT_EPISODE_MEMBER_KIND,
      title: "  Checkout outage  ",
      severityId: id(50),
      ids: [id(1), id(2)],
    });

    expect(created).toEqual({ id: id(60), number: "IE-12" });

    const call: Record<string, any> = (
      createMock.mock.calls as Array<Array<any>>
    )[0]![0];
    const episode: IncidentEpisode = call["model"];

    expect(call["modelType"]).toBe(IncidentEpisode);
    expect(episode.title).toBe("Checkout outage");
    expect(episode.isManuallyCreated).toBe(true);
    expect(episode.incidentSeverityId?.toString()).toBe(id(50));
    expect(call["miscDataProps"]).toEqual({ incidentIdsToAdd: [id(1), id(2)] });
  });

  test("no severity asked leaves it to the server: the most severe of theirs", async () => {
    createMock.mockResolvedValue(new HTTPResponse(200, { _id: id(61) }, {}));

    expect(
      await createEpisodeWith({
        config: ALERT_EPISODE_MEMBER_KIND,
        title: "Checkout outage",
        severityId: undefined,
        ids: [id(1)],
      }),
    ).toEqual({ id: id(61), number: undefined });

    const episode: AlertEpisode = (
      createMock.mock.calls as Array<Array<any>>
    )[0]![0]["model"];
    expect(episode.alertSeverityId).toBeUndefined();
    expect(
      (createMock.mock.calls as Array<Array<any>>)[0]![0]["miscDataProps"],
    ).toEqual({ alertIdsToAdd: [id(1)] });
  });
});

// The models the kinds name, so a kind pointed at the wrong one fails here.
describe("the two kinds", () => {
  test("name their own models", () => {
    expect(ALERT_EPISODE_MEMBER_KIND.recordModelType).toBe(Alert);
    expect(ALERT_EPISODE_MEMBER_KIND.episodeModelType).toBe(AlertEpisode);
    expect(ALERT_EPISODE_MEMBER_KIND.membershipModelType).toBe(
      AlertEpisodeMember,
    );
    expect(ALERT_EPISODE_MEMBER_KIND.severityModelType).toBe(AlertSeverity);
    expect(INCIDENT_EPISODE_MEMBER_KIND.recordModelType).toBe(Incident);
    expect(INCIDENT_EPISODE_MEMBER_KIND.episodeModelType).toBe(IncidentEpisode);
    expect(INCIDENT_EPISODE_MEMBER_KIND.severityModelType).toBe(
      IncidentSeverity,
    );
  });

  test("name columns their models have", () => {
    for (const config of [
      ALERT_EPISODE_MEMBER_KIND,
      INCIDENT_EPISODE_MEMBER_KIND,
    ]) {
      const record: BaseModel = new config.recordModelType();
      const episode: BaseModel = new config.episodeModelType();
      const membership: BaseModel = new config.membershipModelType();

      for (const column of [
        config.recordNumberField,
        config.recordNumberWithPrefixField,
        config.recordStateField,
        config.recordSeverityField,
        config.recordSeverityIdField,
        config.recordEpisodeIdField,
        config.recordDateField,
      ]) {
        expect(record.getTableColumnMetadata(column)).toBeTruthy();
      }

      for (const column of [
        config.episodeStateField,
        config.episodeSeverityField,
        config.episodeSeverityIdField,
        config.episodeCountField,
      ]) {
        expect(episode.getTableColumnMetadata(column)).toBeTruthy();
      }

      for (const column of [
        config.membershipEpisodeIdField,
        config.membershipRecordIdField,
      ]) {
        expect(membership.getTableColumnMetadata(column)).toBeTruthy();
      }
    }
  });

  test("name the Project switch that allows one in only one episode, and the reason the server gives", () => {
    const project: Project = new Project();

    expect(ALERT_EPISODE_MEMBER_KIND.singleMembershipColumn).toBe(
      "limitAlertsToOneEpisode",
    );
    expect(INCIDENT_EPISODE_MEMBER_KIND.singleMembershipColumn).toBe(
      "limitIncidentsToOneEpisode",
    );

    for (const config of [
      ALERT_EPISODE_MEMBER_KIND,
      INCIDENT_EPISODE_MEMBER_KIND,
    ]) {
      expect(
        project.getTableColumnMetadata(config.singleMembershipColumn),
      ).toBeTruthy();
    }

    expect(ALERT_EPISODE_MEMBER_KIND.inAnotherEpisodeReason).toBe(
      ALERT_IN_ANOTHER_EPISODE_REASON,
    );
    expect(INCIDENT_EPISODE_MEMBER_KIND.inAnotherEpisodeReason).toBe(
      INCIDENT_IN_ANOTHER_EPISODE_REASON,
    );
    // Each kind words the dialogs for its own records.
    expect(ALERT_EPISODE_MEMBER_KIND.singleMembershipCopy.listRule).toContain(
      "An alert can be in only one episode",
    );
    expect(
      INCIDENT_EPISODE_MEMBER_KIND.singleMembershipCopy.listRule,
    ).toContain("An incident can be in only one episode");
  });
});
