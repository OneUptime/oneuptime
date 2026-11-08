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
  ALERT_EPISODE_FIRST_MEMBER,
  EpisodeFirstMemberKind,
  INCIDENT_EPISODE_FIRST_MEMBER,
  fetchFirstEpisodeMember,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeFirstMember";
import {
  ALERT_EPISODE_MEMBERSHIP,
  INCIDENT_EPISODE_MEMBERSHIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembers";
import { EPISODE_MEMBER_IDS_PER_REQUEST } from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/FetchEpisodeMembers";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * AN EPISODE'S FIRST MEMBER (issue #6320): the incident or alert its
 * Overview charts the telemetry of, and its Root Cause page the metrics of.
 * Both pick it here, so the two pages always show the same member: the
 * earliest declared incident, or the earliest created alert, among the
 * members of the episode's membership the reader may see; one whose start
 * it cannot read comes last, and a tie goes to the lower id - in one
 * request or across many, as Postgres and DatabaseService order them.
 *
 * ModelAPI is the only thing faked, by a server that sorts, filters and
 * pages as the API does.
 */

const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";

// What the Overview reads of the first member, and what the Root Cause page reads.
const OVERVIEW_SELECT: Record<string, unknown> = {
  _id: true,
  telemetryQuery: true,
  seriesLabels: true,
};
const INCIDENT_ROOT_CAUSE_SELECT: Record<string, unknown> = {
  _id: true,
  telemetryQuery: true,
  seriesLabels: true,
  createdCriteriaId: true,
  monitors: { _id: true, monitorType: true, monitorSteps: true },
};
const ALERT_ROOT_CAUSE_SELECT: Record<string, unknown> = {
  _id: true,
  telemetryQuery: true,
  seriesLabels: true,
  createdCriteriaId: true,
  monitor: { _id: true, monitorType: true, monitorSteps: true },
};

type MemberIdFunction = (index: number) => string;

const memberId: MemberIdFunction = (index: number): string => {
  return `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`;
};

type AtFunction = (minute: number) => Date;

const at: AtFunction = (minute: number): Date => {
  return new Date(Date.UTC(2026, 9, 6, 12, 0) + minute * 60 * 1000);
};

interface ServedMember {
  id: string;
  // When it started; undefined: a start the reader cannot read.
  startedAt: Date | undefined;
  // A member the reader may not see: the member read leaves it out.
  isHidden?: boolean | undefined;
}

interface EpisodeKind {
  name: string;
  kind: EpisodeFirstMemberKind<BaseModel, BaseModel>;
  membershipModel: unknown;
  memberModel: { new (): BaseModel };
  membershipEpisodeField: string;
  membershipMemberField: string;
  startField: string;
  rootCauseSelect: Record<string, unknown>;
}

const INCIDENT_KIND: EpisodeKind = {
  name: "an incident episode",
  kind: INCIDENT_EPISODE_FIRST_MEMBER as unknown as EpisodeFirstMemberKind<
    BaseModel,
    BaseModel
  >,
  membershipModel: IncidentEpisodeMember,
  memberModel: Incident,
  membershipEpisodeField: "incidentEpisodeId",
  membershipMemberField: "incidentId",
  startField: "declaredAt",
  rootCauseSelect: INCIDENT_ROOT_CAUSE_SELECT,
};

const ALERT_KIND: EpisodeKind = {
  name: "an alert episode",
  kind: ALERT_EPISODE_FIRST_MEMBER as unknown as EpisodeFirstMemberKind<
    BaseModel,
    BaseModel
  >,
  membershipModel: AlertEpisodeMember,
  memberModel: Alert,
  membershipEpisodeField: "alertEpisodeId",
  membershipMemberField: "alertId",
  startField: "createdAt",
  rootCauseSelect: ALERT_ROOT_CAUSE_SELECT,
};

// The members' order as Postgres gives it: earliest first, NULL last, ties by id.
function postgresOrder(
  startField: string,
): (left: BaseModel, right: BaseModel) => number {
  return (left: BaseModel, right: BaseModel): number => {
    const leftStart: unknown = (left as unknown as Record<string, unknown>)[
      startField
    ];
    const rightStart: unknown = (right as unknown as Record<string, unknown>)[
      startField
    ];
    const leftMs: number =
      leftStart instanceof Date ? leftStart.getTime() : Number.POSITIVE_INFINITY;
    const rightMs: number =
      rightStart instanceof Date
        ? rightStart.getTime()
        : Number.POSITIVE_INFINITY;

    if (leftMs !== rightMs) {
      return leftMs < rightMs ? -1 : 1;
    }

    const leftId: string = left.id!.toString();
    const rightId: string = right.id!.toString();
    return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
  };
}

/*
 * The API: the membership in the order its rows were written, paged; the
 * members it names that the reader may see, sorted and limited.
 */
function serve(
  episodeKind: EpisodeKind,
  membership: Array<string>,
  members: Array<ServedMember>,
): void {
  getListMock.mockImplementation(async (...args: Array<any>) => {
    const request: Record<string, any> = args[0];

    if (request.modelType === episodeKind.membershipModel) {
      const page: Array<string> = membership.slice(
        request.skip,
        request.skip + request.limit,
      );

      return {
        data: page.map((id: string): Record<string, unknown> => {
          return { [episodeKind.membershipMemberField]: new ObjectID(id) };
        }),
        count: membership.length,
        skip: request.skip,
        limit: request.limit,
      };
    }

    if (request.modelType === episodeKind.memberModel) {
      const ids: Array<string> = (request.query._id as Includes).values.map(
        (id: unknown): string => {
          return String(id);
        },
      );
      const visible: Array<BaseModel> = members
        .filter((member: ServedMember): boolean => {
          return ids.includes(member.id) && !member.isHidden;
        })
        .map((member: ServedMember): BaseModel => {
          const record: BaseModel = new episodeKind.memberModel();
          record.id = new ObjectID(member.id);

          if (member.startedAt) {
            (record as unknown as Record<string, unknown>)[
              episodeKind.startField
            ] = member.startedAt;
          }

          return record;
        })
        .sort(postgresOrder(episodeKind.startField));

      return {
        data: visible.slice(0, request.limit),
        count: visible.length,
        skip: 0,
        limit: request.limit,
      };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });
}

function firstOf(
  episodeKind: EpisodeKind,
  select: Record<string, unknown>,
): Promise<BaseModel | null> {
  return fetchFirstEpisodeMember<BaseModel, BaseModel>({
    episodeId: new ObjectID(EPISODE_ID),
    kind: episodeKind.kind,
    select: select as never,
  });
}

type RequestFunction = (index: number) => Record<string, any>;

const request: RequestFunction = (index: number): Record<string, any> => {
  return getListMock.mock.calls[index]![0];
};

beforeEach((): void => {
  getListMock.mockReset();
});

describe("an episode's first member, the rule both its pages pick it by", () => {
  test("an incident episode's: its earliest declared incident, by its membership", () => {
    expect(INCIDENT_EPISODE_FIRST_MEMBER).toEqual({
      membership: INCIDENT_EPISODE_MEMBERSHIP,
      modelType: Incident,
      startedAtField: "declaredAt",
    });
  });

  test("an alert episode's: its earliest created alert, by its membership", () => {
    expect(ALERT_EPISODE_FIRST_MEMBER).toEqual({
      membership: ALERT_EPISODE_MEMBERSHIP,
      modelType: Alert,
      startedAtField: "createdAt",
    });
  });
});

describe.each([INCIDENT_KIND, ALERT_KIND])(
  "fetchFirstEpisodeMember: $name",
  (episodeKind: EpisodeKind) => {
    test("reads the episode's membership, then the earliest started of the members it names, with only the columns asked for and its start", async () => {
      serve(
        episodeKind,
        [memberId(1), memberId(2), memberId(3)],
        [
          { id: memberId(1), startedAt: at(20) },
          { id: memberId(2), startedAt: at(5) },
          { id: memberId(3), startedAt: at(10) },
        ],
      );

      const first: BaseModel | null = await firstOf(
        episodeKind,
        episodeKind.rootCauseSelect,
      );

      expect(first?.id?.toString()).toBe(memberId(2));
      expect(getListMock).toHaveBeenCalledTimes(2);

      const membership: Record<string, any> = request(0);
      expect(membership["modelType"]).toBe(episodeKind.membershipModel);
      expect(
        membership["query"][episodeKind.membershipEpisodeField].toString(),
      ).toBe(EPISODE_ID);
      expect(membership["select"]).toEqual({
        [episodeKind.membershipMemberField]: true,
      });
      expect(membership["sort"]).toEqual({ createdAt: SortOrder.Ascending });
      expect(membership["limit"]).toBe(EPISODE_MEMBER_IDS_PER_REQUEST);
      expect(membership["skip"]).toBe(0);

      const members: Record<string, any> = request(1);
      expect(members["modelType"]).toBe(episodeKind.memberModel);
      expect(Object.keys(members["query"])).toEqual(["_id"]);
      expect((members["query"]._id as Includes).values).toEqual([
        memberId(1),
        memberId(2),
        memberId(3),
      ]);
      expect(members["select"]).toEqual({
        ...episodeKind.rootCauseSelect,
        [episodeKind.startField]: true,
      });
      expect(members["sort"]).toEqual({
        [episodeKind.startField]: SortOrder.Ascending,
      });
      expect(members["limit"]).toBe(1);
    });

    test("an episode with no member: none, after the one read that says so", async () => {
      serve(episodeKind, [], []);

      expect(await firstOf(episodeKind, OVERVIEW_SELECT)).toBeNull();
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    test("members the reader may not see are no members: none", async () => {
      serve(
        episodeKind,
        [memberId(1)],
        [{ id: memberId(1), startedAt: at(1), isHidden: true }],
      );

      expect(await firstOf(episodeKind, OVERVIEW_SELECT)).toBeNull();
    });

    test("a member the reader may not see is passed over: the first they may", async () => {
      serve(
        episodeKind,
        [memberId(1), memberId(2)],
        [
          { id: memberId(1), startedAt: at(1), isHidden: true },
          { id: memberId(2), startedAt: at(9) },
        ],
      );

      expect(
        (await firstOf(episodeKind, OVERVIEW_SELECT))?.id?.toString(),
      ).toBe(memberId(2));
    });

    test("two members that started together: the lower id", async () => {
      serve(
        episodeKind,
        [memberId(9), memberId(3)],
        [
          { id: memberId(9), startedAt: at(4) },
          { id: memberId(3), startedAt: at(4) },
        ],
      );

      expect(
        (await firstOf(episodeKind, OVERVIEW_SELECT))?.id?.toString(),
      ).toBe(memberId(3));
    });

    test("a member whose start it cannot read comes after every one it can, and is first only when none can be", async () => {
      serve(
        episodeKind,
        [memberId(1), memberId(2)],
        [
          { id: memberId(1), startedAt: undefined },
          { id: memberId(2), startedAt: at(100) },
        ],
      );
      expect(
        (await firstOf(episodeKind, OVERVIEW_SELECT))?.id?.toString(),
      ).toBe(memberId(2));

      serve(
        episodeKind,
        [memberId(4), memberId(3)],
        [
          { id: memberId(4), startedAt: undefined },
          { id: memberId(3), startedAt: undefined },
        ],
      );
      expect(
        (await firstOf(episodeKind, OVERVIEW_SELECT))?.id?.toString(),
      ).toBe(memberId(3));
    });

    test(`more members than one read names (${EPISODE_MEMBER_IDS_PER_REQUEST}): the first of them all, read in pages and merged`, async () => {
      const ids: Array<string> = [];
      const members: Array<ServedMember> = [];

      for (let index: number = 0; index < EPISODE_MEMBER_IDS_PER_REQUEST + 2; index++) {
        ids.push(memberId(index + 10));
        members.push({ id: memberId(index + 10), startedAt: at(500 - (index % 7)) });
      }

      // On the second page: the earliest of all.
      ids.push(memberId(1));
      members.push({ id: memberId(1), startedAt: at(2) });
      serve(episodeKind, ids, members);

      expect(
        (await firstOf(episodeKind, OVERVIEW_SELECT))?.id?.toString(),
      ).toBe(memberId(1));
      // Two membership reads, and a member read for each.
      expect(getListMock).toHaveBeenCalledTimes(4);
      expect(request(2)["skip"]).toBe(EPISODE_MEMBER_IDS_PER_REQUEST);
    });

    test("a read the reader may not make fails with its error: the page decides whether it can do without", async () => {
      getListMock.mockImplementation(async () => {
        throw new Error("No permission to read memberships");
      });

      await expect(firstOf(episodeKind, OVERVIEW_SELECT)).rejects.toThrow(
        "No permission to read memberships",
      );
    });
  },
);

/*
 * SEEDED: THE OVERVIEW AND THE ROOT CAUSE PAGE PICK THE SAME MEMBER.
 *
 * Whatever the episode holds - from none to more members than one read
 * names, joined in any order, the same member joined twice, starts that tie
 * or that the reader cannot read, members the reader may not see - the
 * Overview's read and the Root Cause page's read pick the same member, and
 * it is the earliest started of those the reader may see: by start, one
 * with none last, a tie to the lower id.
 */
describe("seeded: the Overview and the Root Cause page pick the same first member", () => {
  test.each([INCIDENT_KIND, ALERT_KIND])(
    "$name, over 300 episodes",
    async (episodeKind: EpisodeKind) => {
      const random: SeededRandom = seededRandom(
        episodeKind === INCIDENT_KIND ? 63201 : 63202,
      );
      let withMember: number = 0;
      let paged: number = 0;
      let tied: number = 0;
      let unread: number = 0;

      for (let draw: number = 0; draw < 300; draw++) {
        const count: number =
          random(25) === 0
            ? EPISODE_MEMBER_IDS_PER_REQUEST + random(40)
            : random(12);
        const members: Array<ServedMember> = [];

        for (let index: number = 0; index < count; index++) {
          const kindOfStart: number = random(10);
          // Ids in no particular order: the membership is shuffled below.
          members.push({
            id: memberId(draw * 100000 + ((index * 7919) % 100000)),
            startedAt:
              kindOfStart === 0
                ? undefined
                : at(kindOfStart < 4 ? random(3) : random(600)),
            isHidden: random(8) === 0,
          });
        }

        // Joined in any order, some of them twice (two adds racing).
        const membership: Array<string> = shuffled(
          members.map((member: ServedMember): string => {
            return member.id;
          }),
          random,
        );

        if (membership.length > 0 && random(3) === 0) {
          membership.push(membership[random(membership.length)]!);
        }

        serve(episodeKind, membership, members);
        const overview: BaseModel | null = await firstOf(
          episodeKind,
          OVERVIEW_SELECT,
        );
        const rootCause: BaseModel | null = await firstOf(
          episodeKind,
          episodeKind.rootCauseSelect,
        );

        // The reference: the earliest started member the reader may see.
        const visible: Array<ServedMember> = members.filter(
          (member: ServedMember): boolean => {
            return !member.isHidden;
          },
        );
        const expected: ServedMember | undefined = [...visible].sort(
          (left: ServedMember, right: ServedMember): number => {
            const leftMs: number = left.startedAt
              ? left.startedAt.getTime()
              : Number.POSITIVE_INFINITY;
            const rightMs: number = right.startedAt
              ? right.startedAt.getTime()
              : Number.POSITIVE_INFINITY;

            if (leftMs !== rightMs) {
              return leftMs - rightMs;
            }

            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
          },
        )[0];

        expect({ draw, overview: overview?.id?.toString() }).toEqual({
          draw,
          overview: expected?.id,
        });
        expect({ draw, rootCause: rootCause?.id?.toString() }).toEqual({
          draw,
          rootCause: overview?.id?.toString(),
        });

        if (expected) {
          withMember++;
          tied += visible.some((member: ServedMember): boolean => {
            return (
              member.id !== expected.id &&
              member.startedAt?.getTime() === expected.startedAt?.getTime()
            );
          })
            ? 1
            : 0;
          unread += expected.startedAt ? 0 : 1;
        }

        paged += count > EPISODE_MEMBER_IDS_PER_REQUEST ? 1 : 0;
      }

      // The draws reach every case, not one of them over and over.
      expect(withMember).toBeGreaterThan(150);
      expect(tied).toBeGreaterThan(5);
      expect(unread).toBeGreaterThan(0);
      expect(paged).toBeGreaterThan(3);
    },
    120000,
  );
});
