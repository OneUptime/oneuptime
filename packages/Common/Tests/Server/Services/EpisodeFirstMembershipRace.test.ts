import IncidentEpisodeMemberService, {
  INCIDENT_FIRST_MEMBERSHIP_INDEX,
} from "../../../Server/Services/IncidentEpisodeMemberService";
import AlertEpisodeMemberService, {
  ALERT_FIRST_MEMBERSHIP_INDEX,
} from "../../../Server/Services/AlertEpisodeMemberService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import { RecordInAnotherEpisodeException } from "../../../Server/Utils/Episode/EpisodeSingleMembershipCheck";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// The retry is logged at debug; nothing here needs a log.
jest.mock("../../../Server/Utils/Logger");

/*
 * TWO ADDS OF ONE RECORD, AT ONE MOMENT (EpisodeSingleMembership).
 *
 * A project can allow an incident (or an alert) in only one episode, and
 * the member service checks a record's memberships before it adds one. Two
 * adds of a record that is in no episode yet - to two episodes, by a person
 * and the grouping engine, or from two tabs - both found none, and both
 * were added (#4933). Each is now the record's first membership, and the
 * database takes one per record: the add that loses is refused by that
 * index, and the service makes it again from the start, as it was sent. Its
 * own check then finds the membership that won: refused while the project
 * allows one episode, added as a second membership while it allows several.
 *
 * Here the database is a stand-in for DatabaseService.create: the first
 * attempt fails as Postgres would, through the translator.
 */

interface Kind {
  name: string;
  service: { create: (createBy: CreateBy<DatabaseBaseModel>) => unknown };
  model: { new (): DatabaseBaseModel };
  recordColumn: string;
  episodeColumn: string;
  table: string;
  index: string;
}

const KINDS: Array<Kind> = [
  {
    name: "incident",
    service: IncidentEpisodeMemberService as unknown as Kind["service"],
    model: IncidentEpisodeMember,
    recordColumn: "incidentId",
    episodeColumn: "incidentEpisodeId",
    table: "IncidentEpisodeMember",
    index: INCIDENT_FIRST_MEMBERSHIP_INDEX,
  },
  {
    name: "alert",
    service: AlertEpisodeMemberService as unknown as Kind["service"],
    model: AlertEpisodeMember,
    recordColumn: "alertId",
    episodeColumn: "alertEpisodeId",
    table: "AlertEpisodeMember",
    index: ALERT_FIRST_MEMBERSHIP_INDEX,
  },
];

const PROJECT_ID: string = "0194e9a1-51e0-4a00-8000-0000000000f1";
const EPISODE_ID: string = "0194e9a1-51e0-4a00-8000-0000000000e5";
const RECORD_ID: string = "0194e9a1-51e0-4a00-8000-000000000011";

// What Postgres answers an insert a unique index refuses, as translated.
function refusedBy(table: string, index: string): unknown {
  return PostgresErrorTranslator.translate({
    message: `duplicate key value violates unique constraint "${index}"`,
    code: "23505",
    table: table,
    detail: `Key ("x")=(${RECORD_ID}) already exists.`,
    constraint: index,
  });
}

// What the stand-in database saw, attempt by attempt.
interface Attempt {
  createBy: CreateBy<DatabaseBaseModel>;
  data: Record<string, unknown>;
}

function stubDatabase(answers: Array<unknown>): Array<Attempt> {
  const attempts: Array<Attempt> = [];

  jest.spyOn(DatabaseService.prototype, "create").mockImplementation((async (
    createBy: CreateBy<DatabaseBaseModel>,
  ) => {
    attempts.push({
      createBy: createBy,
      data: { ...(createBy.data as unknown as Record<string, unknown>) },
    });

    // A hook of the first attempt wrote on the record, as onBeforeCreate does.
    (createBy.data as unknown as Record<string, unknown>)["isFirstMembership"] =
      true;

    const answer: unknown = answers.shift();

    // A saved record, a refusal - or, given nothing, the record as sent.
    if (answer instanceof DatabaseBaseModel) {
      return answer;
    }

    if (answer !== undefined) {
      throw answer;
    }

    return createBy.data;
  }) as never);

  return attempts;
}

function memberOf(kind: Kind): DatabaseBaseModel {
  const member: DatabaseBaseModel = new kind.model();
  const values: Record<string, unknown> = member as unknown as Record<
    string,
    unknown
  >;
  values["projectId"] = new ObjectID(PROJECT_ID);
  values[kind.episodeColumn] = new ObjectID(EPISODE_ID);
  values[kind.recordColumn] = new ObjectID(RECORD_ID);
  return member;
}

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: new ObjectID(PROJECT_ID),
  userId: new ObjectID("0194e9a1-51e0-4a00-8000-0000000000a1"),
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "an $name added while another add of it got in first",
  (kind: Kind) => {
    test("is made again, once, from what was sent - and its answer is the second attempt's", async () => {
      const saved: DatabaseBaseModel = memberOf(kind);
      const attempts: Array<Attempt> = stubDatabase([
        refusedBy(kind.table, kind.index),
        saved,
      ]);

      const sent: DatabaseBaseModel = memberOf(kind);
      const createBy: CreateBy<DatabaseBaseModel> = {
        data: sent,
        props: PROPS,
        miscDataProps: { addedTogether: true },
      };

      await expect(kind.service.create(createBy)).resolves.toBe(saved);

      expect(attempts).toHaveLength(2);

      // The first attempt was the caller's own.
      expect(attempts[0]!.createBy).toBe(createBy);

      // The second starts from the start: a record of its own, as sent...
      const second: CreateBy<DatabaseBaseModel> = attempts[1]!.createBy;
      expect(second).not.toBe(createBy);
      expect(second.data).not.toBe(sent);
      expect(second.data).toBeInstanceOf(kind.model);

      const values: Record<string, unknown> = attempts[1]!.data;
      expect(String(values[kind.recordColumn])).toBe(RECORD_ID);
      expect(String(values[kind.episodeColumn])).toBe(EPISODE_ID);
      expect(String(values["projectId"])).toBe(PROJECT_ID);

      // ...with nothing the first attempt's hooks wrote on it.
      expect(values["isFirstMembership"]).toBeUndefined();

      // ...for the same caller, with the same extras.
      expect(second.props).toBe(PROPS);
      expect(second.miscDataProps).toEqual({ addedTogether: true });
    });

    test("refused again - in another episode, while the project allows one - says so", async () => {
      const refusal: RecordInAnotherEpisodeException =
        new RecordInAnotherEpisodeException("Already in another episode.");
      const attempts: Array<Attempt> = stubDatabase([
        refusedBy(kind.table, kind.index),
        refusal,
      ]);

      await expect(
        kind.service.create({ data: memberOf(kind), props: PROPS }),
      ).rejects.toBe(refusal);

      // Never a third time.
      expect(attempts).toHaveLength(2);
    });

    test("a refusal by any other unique index is the caller's answer, made once", async () => {
      const other: unknown = refusedBy(kind.table, "IDX_some_other_index");
      const attempts: Array<Attempt> = stubDatabase([other]);

      await expect(
        kind.service.create({ data: memberOf(kind), props: PROPS }),
      ).rejects.toBe(other);
      expect(attempts).toHaveLength(1);
    });

    test("the other kind's index is not this kind's", async () => {
      const otherKind: Kind = KINDS.find((each: Kind): boolean => {
        return each.name !== kind.name;
      })!;
      const other: unknown = refusedBy(otherKind.table, otherKind.index);
      const attempts: Array<Attempt> = stubDatabase([other]);

      await expect(
        kind.service.create({ data: memberOf(kind), props: PROPS }),
      ).rejects.toBe(other);
      expect(attempts).toHaveLength(1);
    });

    test("any other refusal is the caller's answer, made once", async () => {
      const refusal: BadDataException = new BadDataException(
        "The episode to add to does not exist in this project.",
      );
      const attempts: Array<Attempt> = stubDatabase([refusal]);

      await expect(
        kind.service.create({ data: memberOf(kind), props: PROPS }),
      ).rejects.toBe(refusal);
      expect(attempts).toHaveLength(1);
    });

    test("an add with no race is made once, as always", async () => {
      const attempts: Array<Attempt> = stubDatabase([undefined]);
      const sent: DatabaseBaseModel = memberOf(kind);

      await expect(
        kind.service.create({ data: sent, props: PROPS }),
      ).resolves.toBe(sent);
      expect(attempts).toHaveLength(1);
    });
  },
);
