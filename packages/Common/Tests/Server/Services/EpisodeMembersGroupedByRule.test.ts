import AlertEpisodeMemberService, {
  ALERT_ALREADY_IN_EPISODE_MESSAGE,
} from "../../../Server/Services/AlertEpisodeMemberService";
import IncidentEpisodeMemberService, {
  INCIDENT_ALREADY_IN_EPISODE_MESSAGE,
} from "../../../Server/Services/IncidentEpisodeMemberService";
import EpisodeMembersBatch from "../../../Server/Utils/Episode/EpisodeMembersBatch";
import { RecordInAnotherEpisodeException } from "../../../Server/Utils/Episode/EpisodeSingleMembershipCheck";
import { AlertEpisodeMemberAddedBy } from "../../../Models/DatabaseModels/AlertEpisodeMember";
import { IncidentEpisodeMemberAddedBy } from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * THE INCIDENTS (OR ALERTS) A GROUPING RULE OPENS AN EPISODE WITH ONCE
 * ENOUGH OF THEM ARE ONGOING (issue #5374).
 *
 * The rule's engine hands them over together - the ones that waited, oldest
 * first, then the one that made the count - and each becomes the same member
 * row a rule adds on its own:
 *
 *   - added by the rule, naming the rule it matched;
 *   - founding the episode, so its owners are not told again, one by one,
 *     that each was added - the episode's created notification covers them;
 *   - added together, so the episode's count, its feed entry and its
 *     severity are written once for all of them, the severity raised to the
 *     most severe of them, as a rule raises it for each that joins;
 *   - and one that is in the episode already, or was put in another one
 *     meanwhile in a project that allows only one, is skipped.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-000000005374",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000e1",
);
const RULE_ID: ObjectID = new ObjectID("0193c0de-5a7e-4abc-8def-0000000000c1");

function recordId(index: number): ObjectID {
  return new ObjectID(
    `0193c0de-5a7e-4abc-8def-${(0xd000 + index).toString(16).padStart(12, "0")}`,
  );
}

type AnyFunction = (...args: Array<unknown>) => unknown;

interface Kind {
  name: string;
  service: Record<string, AnyFunction>;
  method: string;
  episodeKey: string;
  recordKey: string;
  idsKey: string;
  addedIdsKey: string;
  notifiedColumn: string;
  rule: string;
  alreadyMessage: string;
}

const KINDS: Array<Kind> = [
  {
    name: "incident",
    service: IncidentEpisodeMemberService as unknown as Record<
      string,
      AnyFunction
    >,
    method: "addIncidentsGroupedByRule",
    episodeKey: "incidentEpisodeId",
    recordKey: "incidentId",
    idsKey: "incidentIds",
    addedIdsKey: "addedIncidentIds",
    notifiedColumn: "isOwnerNotifiedOfIncidentAdded",
    rule: IncidentEpisodeMemberAddedBy.Rule,
    alreadyMessage: INCIDENT_ALREADY_IN_EPISODE_MESSAGE,
  },
  {
    name: "alert",
    service: AlertEpisodeMemberService as unknown as Record<
      string,
      AnyFunction
    >,
    method: "addAlertsGroupedByRule",
    episodeKey: "alertEpisodeId",
    recordKey: "alertId",
    idsKey: "alertIds",
    addedIdsKey: "addedAlertIds",
    notifiedColumn: "isOwnerNotifiedOfAlertAdded",
    rule: AlertEpisodeMemberAddedBy.Rule,
    alreadyMessage: ALERT_ALREADY_IN_EPISODE_MESSAGE,
  },
];

interface Created {
  data: Record<string, unknown>;
  props: Record<string, unknown>;
  miscDataProps: Record<string, unknown> | undefined;
}

describe.each(KINDS)(
  "$name members a grouping rule adds together",
  (kind: Kind) => {
    let created: Array<Created> = [];
    let episodeSides: Array<Record<string, unknown>> = [];
    // Which record's create fails, and how.
    let failures: Map<string, Error> = new Map<string, Error>();

    beforeEach(() => {
      created = [];
      episodeSides = [];
      failures = new Map<string, Error>();

      jest.spyOn(kind.service, "create").mockImplementation((async (input: {
        data: Record<string, unknown>;
        props: Record<string, unknown>;
        miscDataProps?: Record<string, unknown>;
      }) => {
        const failure: Error | undefined = failures.get(
          String(input.data[kind.recordKey]),
        );

        if (failure) {
          throw failure;
        }

        created.push({
          data: input.data,
          props: input.props,
          miscDataProps: input.miscDataProps,
        });
        return input.data;
      }) as never);

      jest
        .spyOn(kind.service, "updateEpisodeAfterAddingTogether")
        .mockImplementation((async (data: Record<string, unknown>) => {
          episodeSides.push(data);
        }) as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function add(ids: Array<ObjectID>): Promise<Array<string>> {
      const added: Array<ObjectID> = (await kind.service[kind.method]!.call(
        kind.service,
        {
          projectId: PROJECT_ID,
          [kind.episodeKey]: EPISODE_ID,
          [kind.idsKey]: ids,
          matchedRuleId: RULE_ID,
        },
      )) as Array<ObjectID>;

      return added.map((id: ObjectID): string => {
        return id.toString();
      });
    }

    test("each becomes the rule's member row, founding the episode, added together, in the order handed over", async () => {
      const ids: Array<ObjectID> = [recordId(1), recordId(2), recordId(3)];

      expect(await add(ids)).toEqual(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      expect(
        created.map((entry: Created): string => {
          return String(entry.data[kind.recordKey]);
        }),
      ).toEqual(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      for (const entry of created) {
        expect(String(entry.data["projectId"])).toBe(PROJECT_ID.toString());
        expect(String(entry.data[kind.episodeKey])).toBe(EPISODE_ID.toString());
        expect(entry.data["addedBy"]).toBe(kind.rule);
        expect(String(entry.data["matchedRuleId"])).toBe(RULE_ID.toString());
        expect(entry.data["addedAt"]).toBeInstanceOf(Date);
        // The episode's created notification covers it.
        expect(entry.data[kind.notifiedColumn]).toBe(true);
        // Nobody added it: OneUptime did.
        expect(entry.data["addedByUserId"]).toBeUndefined();
        expect(entry.props).toEqual({ isRoot: true });
        expect(entry.miscDataProps).toEqual(
          EpisodeMembersBatch.getMiscDataProps(),
        );
        expect(
          EpisodeMembersBatch.isAddedTogether({
            props: entry.props as DatabaseCommonInteractionProps,
            miscDataProps: entry.miscDataProps as JSONObject | undefined,
          }),
        ).toBe(true);
      }
    });

    test("the episode's side is written once: counted, raised to the most severe, one entry naming them", async () => {
      await add([recordId(1), recordId(2)]);

      expect(episodeSides).toHaveLength(1);
      expect(episodeSides[0]).toMatchObject({
        projectId: PROJECT_ID,
        [kind.episodeKey]: EPISODE_ID,
        addedByUserId: undefined,
        raiseSeverity: true,
        writeFeedItem: true,
      });
      expect(
        (episodeSides[0]![kind.addedIdsKey] as Array<ObjectID>).map(
          (id: ObjectID): string => {
            return id.toString();
          },
        ),
      ).toEqual([recordId(1).toString(), recordId(2).toString()]);
    });

    test("one in the episode already, or put in another one meanwhile, is skipped, and the rest go in", async () => {
      failures.set(
        recordId(2).toString(),
        new BadDataException(kind.alreadyMessage),
      );
      failures.set(
        recordId(3).toString(),
        new RecordInAnotherEpisodeException("In another episode."),
      );

      expect(
        await add([recordId(1), recordId(2), recordId(3), recordId(4)]),
      ).toEqual([recordId(1).toString(), recordId(4).toString()]);
      expect(
        (episodeSides[0]![kind.addedIdsKey] as Array<ObjectID>).map(
          (id: ObjectID): string => {
            return id.toString();
          },
        ),
      ).toEqual([recordId(1).toString(), recordId(4).toString()]);
    });

    test("any other failure is skipped too, rather than leaving the rest out", async () => {
      failures.set(recordId(1).toString(), new Error("connection lost"));

      expect(await add([recordId(1), recordId(2)])).toEqual([
        recordId(2).toString(),
      ]);
    });

    test("none added, the episode is told nothing was", async () => {
      failures.set(
        recordId(1).toString(),
        new BadDataException(kind.alreadyMessage),
      );

      expect(await add([recordId(1)])).toEqual([]);
      expect(episodeSides).toHaveLength(1);
      expect(episodeSides[0]![kind.addedIdsKey]).toEqual([]);
    });
  },
);
