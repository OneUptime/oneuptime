import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock const is still unassigned when the factory runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import {
  ALERT_EPISODE_MEMBERSHIP,
  INCIDENT_EPISODE_MEMBERSHIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembers";
import {
  EPISODE_MEMBER_IDS_PER_REQUEST,
  FetchedEpisodeMembers,
  fetchEpisodeMembers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/FetchEpisodeMembers";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";

/*
 * The read behind the episode overview's member card and its telemetry
 * snapshot: the episode's membership rows, then the incidents or alerts they
 * name, read from their own table. ModelAPI is the only thing faked; each
 * test answers its requests in order, the way the API would.
 */

const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";

type MemberIdFunction = (index: number) => string;

const memberId: MemberIdFunction = (index: number): string => {
  return `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`;
};

type ListResultFunction = (
  data: Array<unknown>,
  count: number,
) => { data: Array<unknown>; count: number; skip: number; limit: number };

const listResult: ListResultFunction = (
  data: Array<unknown>,
  count: number,
) => {
  return { data, count, skip: 0, limit: data.length };
};

type MembershipsFunction = (ids: Array<string>) => Array<IncidentEpisodeMember>;

const memberships: MembershipsFunction = (
  ids: Array<string>,
): Array<IncidentEpisodeMember> => {
  return ids.map((id: string): IncidentEpisodeMember => {
    const membership: IncidentEpisodeMember = new IncidentEpisodeMember();
    membership.incidentEpisodeId = new ObjectID(EPISODE_ID);
    membership.incidentId = new ObjectID(id);
    return membership;
  });
};

type IncidentFunction = (id: string, declaredAt: Date | undefined) => Incident;

const incident: IncidentFunction = (
  id: string,
  declaredAt: Date | undefined,
): Incident => {
  const record: Incident = new Incident();
  record.id = new ObjectID(id);

  if (declaredAt) {
    record.declaredAt = declaredAt;
  }

  return record;
};

type AtFunction = (minute: number) => Date;

const at: AtFunction = (minute: number): Date => {
  return new Date(Date.UTC(2026, 9, 6, 12, minute));
};

type FetchIncidentsFunction = (options: {
  sortOrder: SortOrder;
  limit: number;
  select?: Record<string, unknown> | undefined;
}) => Promise<FetchedEpisodeMembers<Incident>>;

const fetchIncidents: FetchIncidentsFunction = (options: {
  sortOrder: SortOrder;
  limit: number;
  select?: Record<string, unknown> | undefined;
}): Promise<FetchedEpisodeMembers<Incident>> => {
  return fetchEpisodeMembers<Incident, IncidentEpisodeMember>({
    episodeId: new ObjectID(EPISODE_ID),
    membership: INCIDENT_EPISODE_MEMBERSHIP,
    modelType: Incident,
    select: (options.select || { _id: true, title: true }) as never,
    sortField: "declaredAt",
    sortOrder: options.sortOrder,
    limit: options.limit,
  });
};

type RequestFunction = (index: number) => Record<string, any>;

const request: RequestFunction = (index: number): Record<string, any> => {
  return getListMock.mock.calls[index]![0];
};

type IdsOfFunction = (members: Array<Incident>) => Array<string>;

const idsOf: IdsOfFunction = (members: Array<Incident>): Array<string> => {
  return members.map((member: Incident): string => {
    return member.id!.toString();
  });
};

beforeEach((): void => {
  getListMock.mockReset();
});

describe("fetchEpisodeMembers: the two reads", () => {
  test("reads the membership, then the members it names by id", async () => {
    getListMock
      .mockResolvedValueOnce(
        listResult(memberships([memberId(1), memberId(2)]), 2) as never,
      )
      .mockResolvedValueOnce(
        listResult(
          [incident(memberId(2), at(5)), incident(memberId(1), at(1))],
          2,
        ) as never,
      );

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Descending,
      limit: 8,
    });

    expect(getListMock).toHaveBeenCalledTimes(2);

    expect(request(0)["modelType"]).toBe(IncidentEpisodeMember);
    expect(Object.keys(request(0)["query"])).toEqual(["incidentEpisodeId"]);
    expect(request(0)["query"]["incidentEpisodeId"].toString()).toBe(
      EPISODE_ID,
    );
    expect(request(0)["select"]).toEqual({ incidentId: true });
    expect(request(0)["sort"]).toEqual({ createdAt: SortOrder.Ascending });
    expect(request(0)["skip"]).toBe(0);
    expect(request(0)["limit"]).toBe(EPISODE_MEMBER_IDS_PER_REQUEST);

    expect(request(1)["modelType"]).toBe(Incident);
    expect(Object.keys(request(1)["query"])).toEqual(["_id"]);
    expect(request(1)["query"]["_id"]).toBeInstanceOf(Includes);
    // Plain strings: an ObjectID serializes at about twice the size.
    expect(request(1)["query"]["_id"].values).toEqual([
      memberId(1),
      memberId(2),
    ]);
    expect(request(1)["sort"]).toEqual({ declaredAt: SortOrder.Descending });
    expect(request(1)["skip"]).toBe(0);
    expect(request(1)["limit"]).toBe(8);

    expect(idsOf(result.members)).toEqual([memberId(2), memberId(1)]);
    expect(result.totalCount).toBe(2);
  });

  test("asks for the sort column along with the caller's select", async () => {
    getListMock
      .mockResolvedValueOnce(listResult(memberships([memberId(1)]), 1) as never)
      .mockResolvedValueOnce(listResult([], 0) as never);

    await fetchIncidents({
      sortOrder: SortOrder.Ascending,
      limit: 1,
      select: { _id: true, telemetryQuery: true, seriesLabels: true },
    });

    expect(request(1)["select"]).toEqual({
      _id: true,
      telemetryQuery: true,
      seriesLabels: true,
      declaredAt: true,
    });
    expect(request(1)["sort"]).toEqual({ declaredAt: SortOrder.Ascending });
    expect(request(1)["limit"]).toBe(1);
  });

  test("reads alert episodes through their own membership", async () => {
    const membership: AlertEpisodeMember = new AlertEpisodeMember();
    membership.alertEpisodeId = new ObjectID(EPISODE_ID);
    membership.alertId = new ObjectID(memberId(3));

    const alert: Alert = new Alert();
    alert.id = new ObjectID(memberId(3));
    alert.createdAt = at(3);

    getListMock
      .mockResolvedValueOnce(listResult([membership], 1) as never)
      .mockResolvedValueOnce(listResult([alert], 1) as never);

    const result: FetchedEpisodeMembers<Alert> = await fetchEpisodeMembers<
      Alert,
      AlertEpisodeMember
    >({
      episodeId: new ObjectID(EPISODE_ID),
      membership: ALERT_EPISODE_MEMBERSHIP,
      modelType: Alert,
      select: { _id: true },
      sortField: "createdAt",
      sortOrder: SortOrder.Descending,
      limit: 8,
    });

    expect(request(0)["modelType"]).toBe(AlertEpisodeMember);
    expect(Object.keys(request(0)["query"])).toEqual(["alertEpisodeId"]);
    expect(request(0)["select"]).toEqual({ alertId: true });
    expect(request(1)["modelType"]).toBe(Alert);
    expect(request(1)["query"]["_id"].values).toEqual([memberId(3)]);
    expect(request(1)["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(result.members[0]?.id?.toString()).toBe(memberId(3));
    expect(result.totalCount).toBe(1);
  });

  test("an episode without members asks for no incidents", async () => {
    getListMock.mockResolvedValueOnce(listResult([], 0) as never);

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Descending,
      limit: 8,
    });

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ members: [], totalCount: 0 });
  });

  test("a member listed twice is asked for and counted once", async () => {
    getListMock
      .mockResolvedValueOnce(
        listResult(
          memberships([memberId(1), memberId(2), memberId(1)]),
          3,
        ) as never,
      )
      .mockResolvedValueOnce(
        listResult(
          [incident(memberId(1), at(1)), incident(memberId(2), at(2))],
          2,
        ) as never,
      );

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Descending,
      limit: 8,
    });

    expect(request(1)["query"]["_id"].values).toEqual([
      memberId(1),
      memberId(2),
    ]);
    expect(result.totalCount).toBe(2);
  });

  test("the total is what the member read counts, not the membership", async () => {
    // Three members; the reader may see two (the third is private).
    getListMock
      .mockResolvedValueOnce(
        listResult(
          memberships([memberId(1), memberId(2), memberId(3)]),
          3,
        ) as never,
      )
      .mockResolvedValueOnce(
        listResult(
          [incident(memberId(2), at(2)), incident(memberId(1), at(1))],
          2,
        ) as never,
      );

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Descending,
      limit: 8,
    });

    expect(result.totalCount).toBe(2);
    expect(idsOf(result.members)).toEqual([memberId(2), memberId(1)]);
  });

  test("a failed read fails the fetch", async () => {
    getListMock
      .mockResolvedValueOnce(listResult(memberships([memberId(1)]), 1) as never)
      .mockRejectedValueOnce(new Error("Incidents are unavailable") as never);

    await expect(
      fetchIncidents({ sortOrder: SortOrder.Descending, limit: 8 }),
    ).rejects.toThrow("Incidents are unavailable");
  });
});

describe("fetchEpisodeMembers: an episode bigger than one request", () => {
  const PAGE: number = EPISODE_MEMBER_IDS_PER_REQUEST;

  const firstPageIds: Array<string> = Array.from(
    { length: PAGE },
    (_value: unknown, index: number): string => {
      return memberId(index);
    },
  );

  test("reads the membership page by page and merges the members", async () => {
    getListMock
      // Membership, first page: full, of PAGE + 2.
      .mockResolvedValueOnce(
        listResult(memberships(firstPageIds), PAGE + 2) as never,
      )
      // Its members: the newest three of them.
      .mockResolvedValueOnce(
        listResult(
          [
            incident(memberId(10), at(40)),
            incident(memberId(11), at(30)),
            incident(memberId(12), at(20)),
          ],
          PAGE,
        ) as never,
      )
      // Membership, second page: the last two.
      .mockResolvedValueOnce(
        listResult(
          memberships([memberId(PAGE), memberId(PAGE + 1)]),
          PAGE + 2,
        ) as never,
      )
      .mockResolvedValueOnce(
        listResult(
          [
            incident(memberId(PAGE), at(50)),
            incident(memberId(PAGE + 1), at(25)),
          ],
          2,
        ) as never,
      );

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Descending,
      limit: 3,
    });

    expect(getListMock).toHaveBeenCalledTimes(4);
    expect(request(0)["skip"]).toBe(0);
    expect(request(1)["query"]["_id"].values).toHaveLength(PAGE);
    expect(request(2)["modelType"]).toBe(IncidentEpisodeMember);
    expect(request(2)["skip"]).toBe(PAGE);
    expect(request(3)["query"]["_id"].values).toEqual([
      memberId(PAGE),
      memberId(PAGE + 1),
    ]);

    // Newest of both reads, as one read of every member would order them.
    expect(idsOf(result.members)).toEqual([
      memberId(PAGE),
      memberId(10),
      memberId(11),
    ]);
    expect(result.totalCount).toBe(PAGE + 2);
  });

  test("stops at an empty page even when the count promised more", async () => {
    getListMock
      .mockResolvedValueOnce(
        listResult(memberships(firstPageIds), PAGE + 5) as never,
      )
      .mockResolvedValueOnce(
        listResult([incident(memberId(1), at(1))], PAGE) as never,
      )
      // The rows went away between the two reads.
      .mockResolvedValueOnce(listResult([], PAGE) as never);

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Descending,
      limit: 8,
    });

    expect(getListMock).toHaveBeenCalledTimes(3);
    expect(result.totalCount).toBe(PAGE);
  });

  test("a full last page that the count says is the last ends the read", async () => {
    getListMock
      .mockResolvedValueOnce(
        listResult(memberships(firstPageIds), PAGE) as never,
      )
      .mockResolvedValueOnce(
        listResult([incident(memberId(1), at(1))], PAGE) as never,
      );

    await fetchIncidents({ sortOrder: SortOrder.Descending, limit: 8 });

    expect(getListMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchEpisodeMembers: merged order", () => {
  /*
   * Members come back from the API in its order, and the merge must keep
   * exactly that order: NULL above every value (last ascending, first
   * descending), ties broken by id, ascending.
   */
  const undated: Incident = incident(memberId(9), undefined);
  const laterB: Incident = incident(memberId(2), at(5));
  const laterA: Incident = incident(memberId(1), at(5));
  const latest: Incident = incident(memberId(3), at(9));

  type ServeFunction = () => void;

  const serve: ServeFunction = (): void => {
    getListMock
      .mockResolvedValueOnce(
        listResult(
          memberships([memberId(9), memberId(2), memberId(1), memberId(3)]),
          4,
        ) as never,
      )
      // Deliberately out of order.
      .mockResolvedValueOnce(
        listResult([laterB, latest, undated, laterA], 4) as never,
      );
  };

  test("newest first: undated first, then by date, ties by id", async () => {
    serve();

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Descending,
      limit: 4,
    });

    expect(idsOf(result.members)).toEqual([
      memberId(9),
      memberId(3),
      memberId(1),
      memberId(2),
    ]);
  });

  test("oldest first: by date, ties by id, undated last", async () => {
    serve();

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Ascending,
      limit: 4,
    });

    expect(idsOf(result.members)).toEqual([
      memberId(1),
      memberId(2),
      memberId(3),
      memberId(9),
    ]);
  });

  test("keeps only the first `limit`", async () => {
    serve();

    const result: FetchedEpisodeMembers<Incident> = await fetchIncidents({
      sortOrder: SortOrder.Ascending,
      limit: 1,
    });

    expect(idsOf(result.members)).toEqual([memberId(1)]);
    expect(result.totalCount).toBe(4);
  });
});
