import User from "../../../../Models/DatabaseModels/User";
import OwnerNotificationDeliveryService from "../../../../Server/Services/OwnerNotificationDeliveryService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
  OwnerNotificationOf,
} from "../../../../Server/Utils/Notification/OwnerNotificationDeliveries";
import OneUptimeDate from "../../../../Types/Date";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationFeedStatus,
  OwnerNotificationKind,
} from "../../../../Types/Notification/OwnerNotificationDelivery";
import ObjectID from "../../../../Types/ObjectID";
import {
  InMemoryDeliveryRow,
  InMemoryOwnerNotificationDeliveries,
  useInMemoryOwnerNotificationDeliveries,
  usersNamedBy,
} from "../../../Helpers/InMemoryOwnerNotificationDeliveries";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

type Notify = (delivery: OwnerNotificationDelivery) => Promise<void>;

/*
 * EVERY OWNER TOLD ONCE, HOWEVER THE WORKER STOPS (issue #8199).
 *
 * OwnerNotificationDeliveries is what every owner notification job of an
 * incident or an alert tells its owners through: plan() writes who it is to
 * tell before the job takes its record, tell() sends to each of them once -
 * one run alone moves an owner from to be told to being told - and resume()
 * hands a later run the owners a stopped run left to be told. Here it runs
 * on the delivery table held in memory as Postgres answers its statements
 * (InMemoryOwnerNotificationDeliveries; OwnerNotificationDeliveryPostgres
 * runs the real statements); the jobs that call it are run through their
 * crash points in App's OwnerNotificationJobsSurviveAStop.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000003",
);

const NOW: Date = new Date("2026-11-15T10:00:00.000Z");

function minutesLater(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

function makeUser(id: string): User {
  const user: User = new User(new ObjectID(id));
  user.name = new Name(`Owner ${id}`);
  user.email = new Email(`${id}@acme.test`);
  return user;
}

const ALICE: User = makeUser("11111111-0000-4000-8000-000000000001");
const BOB: User = makeUser("11111111-0000-4000-8000-000000000002");
const CAROL: User = makeUser("11111111-0000-4000-8000-000000000003");
const DIRECTORY: Array<User> = [ALICE, BOB, CAROL];

function created(incidentId: ObjectID = INCIDENT_ID): OwnerNotificationOf {
  return {
    kind: OwnerNotificationKind.IncidentCreated,
    projectId: PROJECT_ID,
    resourceId: incidentId,
    eventId: incidentId,
  };
}

function idOf(user: User): string {
  return user.id!.toString();
}

function idsOf(users: Array<User>): Array<string> {
  return users.map(idOf);
}

// A send that records whom it sent to.
function sender(sent: Array<string>, user: User): () => Promise<void> {
  return async (): Promise<void> => {
    sent.push(idOf(user));
  };
}

// Tells every owner of a delivery, as a job does; whom it sent to.
async function tellEveryone(
  delivery: OwnerNotificationDelivery,
  sent: Array<string>,
): Promise<Array<string>> {
  const told: Array<string> = [];

  for (const owner of delivery.owners) {
    if (await delivery.tell(owner, sender(sent, owner))) {
      told.push(idOf(owner));
    }
  }

  return told;
}

describe("OwnerNotificationDeliveries", () => {
  let table: InMemoryOwnerNotificationDeliveries;
  let now: Date;
  let errors: ReturnType<typeof jest.spyOn>;
  let warnings: ReturnType<typeof jest.spyOn>;
  let userReads: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    table = useInMemoryOwnerNotificationDeliveries();
    now = NOW;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(now.getTime());
    });

    errors = jest.spyOn(logger, "error").mockImplementation((() => {
      // read by the tests
    }) as never);
    warnings = jest.spyOn(logger, "warn").mockImplementation((() => {
      // read by the tests
    }) as never);
    jest.spyOn(logger, "info").mockImplementation((() => {
      // quiet
    }) as never);

    userReads = jest
      .spyOn(UserService, "findBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        return usersNamedBy(DIRECTORY, data.query);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("plan", () => {
    test("writes a row per owner, to be told, before anyone is told - and hands them back in the order given", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [CAROL, ALICE, BOB],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      expect(idsOf(delivery.owners)).toEqual(idsOf([CAROL, ALICE, BOB]));
      expect(delivery.toldEarlier).toEqual([]);
      expect(delivery.isProjectOwners).toBe(false);
      expect(delivery.hasSetOutToTellAnyone).toBe(false);
      expect(delivery.notification).toEqual({
        kind: OwnerNotificationKind.IncidentCreated,
        projectId: PROJECT_ID,
        resourceId: INCIDENT_ID,
        eventId: INCIDENT_ID,
        occurrence: 1,
      });

      expect(table.rows).toHaveLength(3);

      for (const row of table.rows) {
        expect(row).toMatchObject({
          kind: OwnerNotificationKind.IncidentCreated,
          projectId: PROJECT_ID.toString(),
          resourceId: INCIDENT_ID.toString(),
          eventId: INCIDENT_ID.toString(),
          occurrence: 1,
          isProjectOwner: false,
          status: OwnerNotificationDeliveryStatus.Pending,
          attempts: 1,
        });
        expect(row.attemptedAt.getTime()).toBe(NOW.getTime());
      }

      // The owners given are the users: nobody is read again.
      expect(userReads).not.toHaveBeenCalled();
    });

    test("names each owner once, and leaves out one with no id", async () => {
      const nobody: User = new User();

      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, nobody, ALICE, makeUser(idOf(ALICE)), BOB],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      expect(idsOf(delivery.owners)).toEqual(idsOf([ALICE, BOB]));
      expect(table.rows).toHaveLength(2);
    });

    test("with nobody to tell writes nothing and tells nobody", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [],
          isProjectOwners: true,
          writesFeedItem: false,
        });

      expect(delivery.owners).toEqual([]);
      expect(delivery.isProjectOwners).toBe(true);
      expect(table.rows).toEqual([]);
      expect(table.statements).toEqual([]);
    });

    test("says the project's owners are told in a record's place", async () => {
      await OwnerNotificationDeliveries.plan({
        notification: created(),
        owners: [ALICE],
        isProjectOwners: true,
        writesFeedItem: false,
      });

      expect(table.rows[0]!.isProjectOwner).toBe(true);
    });

    test("written again - a second run read the record before the first took it - writes no second row, and hands back only who is still to be told", async () => {
      const first: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      const sent: Array<string> = [];
      await first.tell(ALICE, sender(sent, ALICE));

      const second: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB, CAROL],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      expect(table.rows).toHaveLength(3);
      expect(idsOf(second.owners)).toEqual(idsOf([BOB, CAROL]));
      expect(idsOf(second.toldEarlier)).toEqual(idsOf([ALICE]));
    });

    test("an owner an earlier run wrote down but who is not given now is still told, read back", async () => {
      await OwnerNotificationDeliveries.plan({
        notification: created(),
        owners: [ALICE, BOB],
        isProjectOwners: false,
        writesFeedItem: false,
      });

      const again: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      expect(idsOf(again.owners)).toEqual(idsOf([ALICE, BOB]));
      expect(userReads).toHaveBeenCalledTimes(1);
      expect(
        usersNamedBy(
          DIRECTORY,
          (userReads.mock.calls[0]![0] as { query: JSONObject }).query,
        ),
      ).toEqual([BOB]);
    });

    test("two notifications - two reminders, two incidents - are kept apart", async () => {
      await OwnerNotificationDeliveries.plan({
        notification: {
          ...created(),
          kind: OwnerNotificationKind.IncidentReminder,
          occurrence: 1,
        },
        owners: [ALICE],
        isProjectOwners: false,
        writesFeedItem: false,
      });

      const secondReminder: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: {
            ...created(),
            kind: OwnerNotificationKind.IncidentReminder,
            occurrence: 2,
          },
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      const otherIncident: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(OTHER_INCIDENT_ID),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      // The same incident's Created notification is another kind again.
      const createdOfFirst: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      expect(table.rows).toHaveLength(4);

      for (const delivery of [secondReminder, otherIncident, createdOfFirst]) {
        expect(idsOf(delivery.owners)).toEqual(idsOf([ALICE]));
      }
    });

    test("rows that cannot be written - the database refused them - tell every owner as before, without them, and say so", async () => {
      table.failWith("writeOwnersToTell", new Error("relation does not exist"));

      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      expect(idsOf(delivery.owners)).toEqual(idsOf([ALICE, BOB]));
      expect(String(errors.mock.calls[0]![0])).toContain(
        "Could not write whom IncidentCreated",
      );

      const sent: Array<string> = [];
      expect(await tellEveryone(delivery, sent)).toEqual(idsOf([ALICE, BOB]));
      expect(sent).toEqual(idsOf([ALICE, BOB]));
      expect(delivery.hasSetOutToTellAnyone).toBe(true);

      // No row was ever asked about.
      expect(
        table.statements.map((each: { statement: string }) => {
          return each.statement;
        }),
      ).toEqual(["writeOwnersToTell"]);
    });
  });

  describe("tell", () => {
    test("sends to the owner once, and records it sent", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      const sent: Array<string> = [];

      expect(await delivery.tell(ALICE, sender(sent, ALICE))).toBe(true);
      expect(delivery.hasSetOutToTellAnyone).toBe(true);
      expect(table.statusesOf(INCIDENT_ID)).toEqual({
        [idOf(ALICE)]: OwnerNotificationDeliveryStatus.Sent,
      });

      // Told already by this very run.
      expect(await delivery.tell(ALICE, sender(sent, ALICE))).toBe(false);
      expect(sent).toEqual([idOf(ALICE)]);
    });

    test("the owner is being told before the send starts, and told once it returns", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      const during: Array<Record<string, OwnerNotificationDeliveryStatus>> = [];

      await delivery.tell(ALICE, async (): Promise<void> => {
        during.push(table.statusesOf(INCIDENT_ID));
      });

      expect(during).toEqual([
        { [idOf(ALICE)]: OwnerNotificationDeliveryStatus.Sending },
      ]);
    });

    test("tells nobody who is not one of its owners", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      const sent: Array<string> = [];

      expect(await delivery.tell(BOB, sender(sent, BOB))).toBe(false);
      expect(sent).toEqual([]);
      expect(delivery.hasSetOutToTellAnyone).toBe(false);
    });

    test("two runs holding the same notification tell each owner once between them", async () => {
      const first: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB, CAROL],
          isProjectOwners: false,
          writesFeedItem: false,
        });
      const second: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB, CAROL],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      table.interleave(true);

      const sent: Array<string> = [];

      const [toldByFirst, toldBySecond] = await Promise.all([
        tellEveryone(first, sent),
        tellEveryone(second, sent),
      ]);

      expect([...sent].sort()).toEqual(idsOf([ALICE, BOB, CAROL]).sort());
      expect([...toldByFirst, ...toldBySecond].sort()).toEqual(
        idsOf([ALICE, BOB, CAROL]).sort(),
      );
      expect(Object.values(table.statusesOf(INCIDENT_ID))).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);
    });

    test("a send that throws is logged, the owner is not told again, and the others still are", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      const sent: Array<string> = [];

      expect(
        await delivery.tell(ALICE, async (): Promise<void> => {
          throw new Error("smtp connection reset");
        }),
      ).toBe(false);
      expect(await delivery.tell(BOB, sender(sent, BOB))).toBe(true);

      expect(table.statusesOf(INCIDENT_ID)).toEqual({
        [idOf(ALICE)]: OwnerNotificationDeliveryStatus.Failed,
        [idOf(BOB)]: OwnerNotificationDeliveryStatus.Sent,
      });
      expect(String(errors.mock.calls[0]![0])).toContain(
        "Telling an owner of IncidentCreated",
      );
      expect(String(errors.mock.calls[0]![0])).toContain(
        "smtp connection reset",
      );
      expect(delivery.hasSetOutToTellAnyone).toBe(true);

      // Nor does a later run, written down again, tell them.
      const again: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      expect(again.owners).toEqual([]);
      expect(idsOf(again.toldEarlier)).toEqual(idsOf([BOB]));
    });

    test("an owner it cannot say it is telling - the database is away - is not sent to, and is left for a later run", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      table.failWith("startTelling", new Error("connection terminated"));

      const sent: Array<string> = [];

      expect(await delivery.tell(ALICE, sender(sent, ALICE))).toBe(false);
      expect(sent).toEqual([]);
      expect(delivery.hasSetOutToTellAnyone).toBe(false);
      expect(table.statusesOf(INCIDENT_ID)).toEqual({
        [idOf(ALICE)]: OwnerNotificationDeliveryStatus.Pending,
      });
      expect(String(errors.mock.calls[0]![0])).toContain(
        "They are told by a later run",
      );
    });

    test("an owner told whose send cannot be recorded is never told again", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      table.failWith("finishTelling", new Error("connection terminated"));

      const sent: Array<string> = [];

      expect(await delivery.tell(ALICE, sender(sent, ALICE))).toBe(true);
      expect(table.statusesOf(INCIDENT_ID)).toEqual({
        [idOf(ALICE)]: OwnerNotificationDeliveryStatus.Sending,
      });
      expect(String(errors.mock.calls[0]![0])).toContain(
        "They are not told again",
      );

      table.failWith("finishTelling", null);
      now = minutesLater(10);

      const notify: Mock<Notify> = jest.fn<Notify>(async (): Promise<void> => {
        // nobody is left to tell
      });

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(notify).not.toHaveBeenCalled();
      expect(sent).toEqual([idOf(ALICE)]);
    });
  });

  describe("giveUp", () => {
    test("marks the owners not yet told as not told, and leaves the told ones", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB, CAROL],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      const sent: Array<string> = [];
      await delivery.tell(ALICE, sender(sent, ALICE));
      await delivery.giveUp("the incident is gone");

      expect(table.statusesOf(INCIDENT_ID)).toEqual({
        [idOf(ALICE)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(BOB)]: OwnerNotificationDeliveryStatus.Failed,
        [idOf(CAROL)]: OwnerNotificationDeliveryStatus.Failed,
      });
      expect(String(warnings.mock.calls[0]![0])).toBe(
        "Not telling 2 owner(s) of IncidentCreated aaaaaaaa-0000-4000-8000-000000000002: the incident is gone.",
      );

      // And they are told no more.
      expect(await delivery.tell(BOB, sender(sent, BOB))).toBe(false);
      expect(sent).toEqual([idOf(ALICE)]);
    });

    test("with everyone told, says nothing", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      await delivery.tell(ALICE, sender([], ALICE));
      await delivery.giveUp("the incident is gone");

      expect(warnings).not.toHaveBeenCalled();
    });
  });

  describe("resume", () => {
    // A run that wrote its owners down, told `told` of them, and stopped.
    async function stoppedAfterTelling(
      owners: Array<User>,
      told: Array<User>,
      notification: OwnerNotificationOf = created(),
    ): Promise<Array<string>> {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: notification,
          owners: owners,
          isProjectOwners: false,
          writesFeedItem: false,
        });

      const sent: Array<string> = [];

      for (const owner of told) {
        await delivery.tell(owner, sender(sent, owner));
      }

      return sent;
    }

    function notifier(sent: Array<string>): {
      notify: Mock<Notify>;
      deliveries: Array<OwnerNotificationDelivery>;
    } {
      const deliveries: Array<OwnerNotificationDelivery> = [];

      return {
        deliveries: deliveries,
        notify: jest.fn<Notify>(
          async (delivery: OwnerNotificationDelivery): Promise<void> => {
            deliveries.push(delivery);
            await tellEveryone(delivery, sent);
          },
        ),
      };
    }

    test("hands a later run exactly the owners a stopped run left to be told, with those it told", async () => {
      const sent: Array<string> = await stoppedAfterTelling(
        [ALICE, BOB, CAROL],
        [ALICE],
      );

      now = minutesLater(OwnerNotificationDeliveries.RESUME_AFTER_MINUTES);

      const { notify, deliveries } = notifier(sent);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(notify).toHaveBeenCalledTimes(1);
      expect(deliveries[0]!.notification).toEqual({
        kind: OwnerNotificationKind.IncidentCreated,
        projectId: PROJECT_ID,
        resourceId: INCIDENT_ID,
        eventId: INCIDENT_ID,
        occurrence: 1,
      });
      expect(idsOf(deliveries[0]!.owners).sort()).toEqual(
        idsOf([BOB, CAROL]).sort(),
      );
      expect(idsOf(deliveries[0]!.toldEarlier)).toEqual(idsOf([ALICE]));
      expect(deliveries[0]!.isProjectOwners).toBe(false);

      // Read back as the jobs read owners: with their names and addresses.
      expect(
        (userReads.mock.calls[0]![0] as { select: JSONObject }).select,
      ).toEqual({ _id: true, name: true, email: true, timezone: true });

      expect(sent).toEqual(idsOf([ALICE, BOB, CAROL]));
      expect(Object.values(table.statusesOf(INCIDENT_ID))).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);

      // Each attempt is counted, and when.
      for (const row of table.rows) {
        if (row.userId !== idOf(ALICE)) {
          expect(row.attempts).toBe(2);
          expect(row.attemptedAt.getTime()).toBe(now.getTime());
        }
      }

      // And once everyone is told, nothing is left for the next run.
      now = minutesLater(30);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });
      expect(notify).toHaveBeenCalledTimes(1);
    });

    test("says the project's owners are told in a record's place when they were", async () => {
      await OwnerNotificationDeliveries.plan({
        notification: created(),
        owners: [ALICE],
        isProjectOwners: true,
        writesFeedItem: false,
      });

      now = minutesLater(5);

      const { notify, deliveries } = notifier([]);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(deliveries[0]!.isProjectOwners).toBe(true);
    });

    test("leaves owners a run set out to tell moments ago: it may be telling them still", async () => {
      await stoppedAfterTelling([ALICE, BOB], []);

      now = new Date(
        minutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        ).getTime() - 1,
      );

      const { notify } = notifier([]);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(notify).not.toHaveBeenCalled();
      expect(
        table.rows.every((row: InMemoryDeliveryRow): boolean => {
          return row.attempts === 1;
        }),
      ).toBe(true);
    });

    test("takes up only the kinds of its own job", async () => {
      await stoppedAfterTelling([ALICE], [], {
        ...created(),
        kind: OwnerNotificationKind.AlertCreated,
      });

      now = minutesLater(5);

      const { notify } = notifier([]);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(notify).not.toHaveBeenCalled();

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.AlertCreated],
        notify: notify,
      });

      expect(notify).toHaveBeenCalledTimes(1);
    });

    test("never tells again an owner a stopped run was telling: nobody knows whether it went out", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      // The worker stops in Alice's send: it never returns.
      table.stopAt({ statement: "finishTelling", userId: idOf(ALICE) });
      void delivery.tell(ALICE, async (): Promise<void> => {
        // sent, as far as anybody can tell
      });

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      expect(table.stops()).toBe(1);

      now = minutesLater(5);

      const sent: Array<string> = [];
      const { notify, deliveries } = notifier(sent);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(idsOf(deliveries[0]!.owners)).toEqual(idsOf([BOB]));
      expect(sent).toEqual(idsOf([BOB]));
      expect(table.statusesOf(INCIDENT_ID)).toEqual({
        [idOf(ALICE)]: OwnerNotificationDeliveryStatus.Sending,
        [idOf(BOB)]: OwnerNotificationDeliveryStatus.Sent,
      });
      expect(
        warnings.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes(
            "1 owner(s) were being told as it stopped: whether they were, nobody knows, and they are not told again.",
          );
        }),
      ).toBe(true);
    });

    test("two later runs at once: one takes the owners up", async () => {
      await stoppedAfterTelling([ALICE, BOB], []);

      now = minutesLater(5);
      table.interleave(true);

      const sent: Array<string> = [];
      const first: ReturnType<typeof notifier> = notifier(sent);
      const second: ReturnType<typeof notifier> = notifier(sent);

      await Promise.all([
        OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify: first.notify,
        }),
        OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify: second.notify,
        }),
      ]);

      expect(
        first.notify.mock.calls.length + second.notify.mock.calls.length,
      ).toBe(1);
      expect([...sent].sort()).toEqual(idsOf([ALICE, BOB]).sort());
    });

    test("gives up on owners after ATTEMPTS_AT_MOST runs set out to tell them and stopped, and says so", async () => {
      await stoppedAfterTelling([ALICE, BOB], []);

      // Every run that takes them up stops before it tells anyone.
      const stopsBeforeTelling: Mock<Notify> = jest.fn<Notify>(
        async (): Promise<void> => {
          // the worker is killed while it builds the notification
        },
      );

      for (
        let attempt: number = 2;
        attempt <= OwnerNotificationDeliveries.ATTEMPTS_AT_MOST;
        attempt++
      ) {
        now = minutesLater(
          attempt * OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
        await OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify: stopsBeforeTelling,
        });
      }

      expect(stopsBeforeTelling).toHaveBeenCalledTimes(
        OwnerNotificationDeliveries.ATTEMPTS_AT_MOST - 1,
      );
      expect(
        table.rows.every((row: InMemoryDeliveryRow): boolean => {
          return row.attempts === 3;
        }),
      ).toBe(true);

      now = minutesLater(60);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: stopsBeforeTelling,
      });

      expect(stopsBeforeTelling).toHaveBeenCalledTimes(
        OwnerNotificationDeliveries.ATTEMPTS_AT_MOST - 1,
      );
      expect(Object.values(table.statusesOf(INCIDENT_ID))).toEqual([
        OwnerNotificationDeliveryStatus.Failed,
        OwnerNotificationDeliveryStatus.Failed,
      ]);
      expect(
        errors.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).startsWith(
            "Gave up telling 2 owner(s) of IncidentCreated aaaaaaaa-0000-4000-8000-000000000002: each of the 3 runs that set out to tell them stopped before it did.",
          );
        }),
      ).toBe(true);

      // And no run takes them up again.
      now = minutesLater(120);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: stopsBeforeTelling,
      });
      expect(
        table.rows.every((row: InMemoryDeliveryRow): boolean => {
          return row.attempts === 4;
        }),
      ).toBe(true);
      expect(
        table.statements.filter((each: { statement: string }) => {
          return each.statement === "takeUpLeftPartWay";
        }),
      ).toHaveLength(3);
    });

    test("a notification that fails is logged and left for a later run, and the next one is still told", async () => {
      await stoppedAfterTelling([ALICE], [], created(INCIDENT_ID));
      await stoppedAfterTelling([BOB], [], created(OTHER_INCIDENT_ID));

      now = minutesLater(5);

      const sent: Array<string> = [];

      await expect(
        OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify: async (delivery: OwnerNotificationDelivery) => {
            if (
              delivery.notification.eventId.toString() ===
              INCIDENT_ID.toString()
            ) {
              throw new Error("the incident could not be read");
            }

            await tellEveryone(delivery, sent);
          },
        }),
      ).resolves.toBeUndefined();

      expect(sent).toEqual(idsOf([BOB]));
      expect(table.statusesOf(INCIDENT_ID)).toEqual({
        [idOf(ALICE)]: OwnerNotificationDeliveryStatus.Pending,
      });
      expect(
        errors.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes("A later run tries again.");
        }),
      ).toBe(true);

      // A later run tries again.
      now = minutesLater(10);
      const { notify } = notifier(sent);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });
      expect(sent).toEqual(idsOf([BOB, ALICE]));
    });

    test("a read of what was left that fails is logged and tells nobody", async () => {
      await stoppedAfterTelling([ALICE], []);
      now = minutesLater(5);
      table.failWith("findLeftPartWay", new Error("connection terminated"));

      const { notify } = notifier([]);

      await expect(
        OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify: notify,
        }),
      ).resolves.toBeUndefined();

      expect(notify).not.toHaveBeenCalled();
      expect(String(errors.mock.calls[0]![0])).toContain(
        "Could not read the owners a stopped run of IncidentCreated left to be told",
      );
    });

    test("an owner whose user is gone is not told, and is not looked for again", async () => {
      const gone: User = makeUser("11111111-0000-4000-8000-0000000000ff");

      await stoppedAfterTelling([ALICE, gone], []);
      now = minutesLater(5);

      const sent: Array<string> = [];
      const { notify, deliveries } = notifier(sent);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(idsOf(deliveries[0]!.owners)).toEqual(idsOf([ALICE]));
      expect(sent).toEqual(idsOf([ALICE]));
      expect(table.statusesOf(INCIDENT_ID)[idOf(gone)]).toBe(
        OwnerNotificationDeliveryStatus.Failed,
      );
    });

    test("takes up at most TAKEN_UP_PER_RUN_AT_MOST notifications a run, the longest waiting first", async () => {
      const findLeftPartWay: ReturnType<typeof jest.spyOn> = jest.spyOn(
        OwnerNotificationDeliveryService,
        "findLeftPartWay",
      );

      await OwnerNotificationDeliveries.resume({
        kinds: [
          OwnerNotificationKind.IncidentCreated,
          OwnerNotificationKind.IncidentReminder,
        ],
        notify: jest.fn<Notify>(async (): Promise<void> => {
          // nothing
        }),
      });

      expect(findLeftPartWay).toHaveBeenCalledWith({
        kinds: [
          OwnerNotificationKind.IncidentCreated,
          OwnerNotificationKind.IncidentReminder,
        ],
        attemptedBefore: OneUptimeDate.addRemoveMinutes(
          NOW,
          -OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        ),
        limit: OwnerNotificationDeliveries.TAKEN_UP_PER_RUN_AT_MOST,
      });

      // Of those left, the one waiting longest comes first.
      now = NOW;
      await stoppedAfterTelling([ALICE], [], created(OTHER_INCIDENT_ID));
      now = minutesLater(1);
      await stoppedAfterTelling([ALICE], [], created(INCIDENT_ID));

      now = minutesLater(10);
      const { notify, deliveries } = notifier([]);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(
        deliveries.map((delivery: OwnerNotificationDelivery): string => {
          return delivery.notification.eventId.toString();
        }),
      ).toEqual([OTHER_INCIDENT_ID.toString(), INCIDENT_ID.toString()]);
    });
  });

  /*
   * THE FEED ITEM (#8510). A job that writes a feed item naming whom its
   * notification reached plans with writesFeedItem, and says when it wrote
   * it: a run that told every owner and stopped before the feed item leaves
   * it to a later run, which writes it from whom the rows say was told.
   */
  describe("the feed item", () => {
    // A run of a job that writes a feed item: told `told`, and stopped before the feed.
    async function toldAndStoppedBeforeTheFeed(
      owners: Array<User>,
      told: Array<User>,
      notification: OwnerNotificationOf = created(),
    ): Promise<Array<string>> {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: notification,
          owners: owners,
          isProjectOwners: false,
          writesFeedItem: true,
        });

      const sent: Array<string> = [];

      for (const owner of told) {
        await delivery.tell(owner, sender(sent, owner));
      }

      return sent;
    }

    // A job's notify: tells whom it is to, and writes the feed item when it should.
    function feedWriter(sent: Array<string>): {
      notify: Mock<Notify>;
      deliveries: Array<OwnerNotificationDelivery>;
      feedItems: Array<Array<string>>;
    } {
      const deliveries: Array<OwnerNotificationDelivery> = [];
      const feedItems: Array<Array<string>> = [];

      return {
        deliveries: deliveries,
        feedItems: feedItems,
        notify: jest.fn<Notify>(
          async (delivery: OwnerNotificationDelivery): Promise<void> => {
            deliveries.push(delivery);

            if (!delivery.hasWorkToDo) {
              return;
            }

            const told: Array<string> = await tellEveryone(delivery, sent);

            if (!delivery.isFeedItemToWrite) {
              return;
            }

            feedItems.push([...idsOf(delivery.toldEarlier), ...told]);
            await delivery.feedItemWritten();
          },
        ),
      };
    }

    test("a notification that writes one keeps it as still to write until the job says it is written", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE, BOB],
          isProjectOwners: false,
          writesFeedItem: true,
        });

      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.Pending,
      );

      const sent: Array<string> = [];
      await tellEveryone(delivery, sent);

      expect(delivery.isFeedItemToWrite).toBe(true);
      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.Pending,
      );

      await delivery.feedItemWritten();

      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.Written,
      );
    });

    test("a notification that writes none keeps nothing of it, and no later run takes it up", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: false,
        });

      await tellEveryone(delivery, []);
      expect(table.feedStatusOf(INCIDENT_ID)).toBeNull();

      now = minutesLater(30);
      const { notify } = feedWriter([]);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(notify).not.toHaveBeenCalled();
    });

    test("one a run that told every owner left unwritten is written by a later run, once, naming them all", async () => {
      const sent: Array<string> = await toldAndStoppedBeforeTheFeed(
        [ALICE, BOB, CAROL],
        [ALICE, BOB, CAROL],
      );

      now = minutesLater(OwnerNotificationDeliveries.RESUME_AFTER_MINUTES);

      const { notify, deliveries, feedItems } = feedWriter(sent);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(notify).toHaveBeenCalledTimes(1);
      expect(deliveries[0]!.isFeedLeftUnwritten).toBe(true);
      expect(deliveries[0]!.owners).toEqual([]);
      expect(idsOf(deliveries[0]!.toldEarlier)).toEqual(
        idsOf([ALICE, BOB, CAROL]),
      );
      expect(feedItems).toEqual([idsOf([ALICE, BOB, CAROL])]);
      // Nobody is told again.
      expect(sent).toEqual(idsOf([ALICE, BOB, CAROL]));
      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.Written,
      );

      // And no run after it writes it again.
      now = minutesLater(60);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });
      expect(notify).toHaveBeenCalledTimes(1);
    });

    test("one whose owners a later run told is written by that run, naming those the stopped run told too", async () => {
      const sent: Array<string> = await toldAndStoppedBeforeTheFeed(
        [ALICE, BOB, CAROL],
        [ALICE],
      );

      now = minutesLater(OwnerNotificationDeliveries.RESUME_AFTER_MINUTES);
      const { notify, feedItems } = feedWriter(sent);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(feedItems).toEqual([idsOf([ALICE, BOB, CAROL])]);
      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.Written,
      );

      now = minutesLater(60);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });
      expect(notify).toHaveBeenCalledTimes(1);
    });

    test("is left while a row of the notification moved moments ago: the run that told them may be writing it", async () => {
      await toldAndStoppedBeforeTheFeed([ALICE, BOB], [ALICE]);

      // Bob is told a minute on: the run is still at it.
      now = minutesLater(1);
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [BOB],
          isProjectOwners: false,
          writesFeedItem: true,
        });
      await tellEveryone(delivery, []);

      now = minutesLater(1 + OwnerNotificationDeliveries.RESUME_AFTER_MINUTES - 1);
      const { notify } = feedWriter([]);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });
      expect(notify).not.toHaveBeenCalled();

      now = minutesLater(1 + OwnerNotificationDeliveries.RESUME_AFTER_MINUTES);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });
      expect(notify).toHaveBeenCalledTimes(1);
    });

    test("is left while an owner is still to be told: the run that tells them writes it", async () => {
      await toldAndStoppedBeforeTheFeed([ALICE, BOB], [ALICE]);

      now = minutesLater(30);
      const findFeeds: ReturnType<typeof jest.spyOn> = jest.spyOn(
        OwnerNotificationDeliveryService,
        "takeUpFeedItemLeftUnwritten",
      );
      const { notify, deliveries } = feedWriter([]);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      // Bob's notification, taken up as owners left to be told - not as a feed item alone.
      expect(notify).toHaveBeenCalledTimes(1);
      expect(deliveries[0]!.isFeedLeftUnwritten).toBe(false);
      expect(idsOf(deliveries[0]!.owners)).toEqual(idsOf([BOB]));
      expect(findFeeds).not.toHaveBeenCalled();
    });

    test("two later runs at once: one writes it", async () => {
      await toldAndStoppedBeforeTheFeed([ALICE, BOB], [ALICE, BOB]);

      now = minutesLater(OwnerNotificationDeliveries.RESUME_AFTER_MINUTES);
      table.interleave(true);

      const { notify, feedItems } = feedWriter([]);

      await Promise.all([
        OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify: notify,
        }),
        OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify: notify,
        }),
      ]);

      expect(notify).toHaveBeenCalledTimes(1);
      expect(feedItems).toEqual([idsOf([ALICE, BOB])]);
    });

    test("one that fails to write is written by a later run, and given up after ATTEMPTS_AT_MOST runs set out, saying so", async () => {
      await toldAndStoppedBeforeTheFeed([ALICE], [ALICE]);

      const failing: Mock<Notify> = jest.fn<Notify>(async (): Promise<void> => {
        throw new Error("the feed refused it");
      });

      for (
        let run: number = 1;
        run <= OwnerNotificationDeliveries.ATTEMPTS_AT_MOST + 1;
        run++
      ) {
        now = minutesLater(
          run * OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
        await OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify: failing,
        });
      }

      // The run that told her and stopped, then two more that set out to write it.
      expect(failing).toHaveBeenCalledTimes(
        OwnerNotificationDeliveries.ATTEMPTS_AT_MOST - 1,
      );
      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.NotWritten,
      );
      expect(
        errors.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes("Gave up writing the feed item of");
        }),
      ).toBe(true);
    });

    test("one whose owners were all not told is not written: nobody was told", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: true,
        });

      await delivery.tell(ALICE, async (): Promise<void> => {
        throw new Error("smtp connection reset");
      });

      now = minutesLater(OwnerNotificationDeliveries.RESUME_AFTER_MINUTES);
      const { notify } = feedWriter([]);

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(notify).not.toHaveBeenCalled();
      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.NotWritten,
      );
    });

    test("one of a record gone is not written, and no later run takes it up", async () => {
      await toldAndStoppedBeforeTheFeed([ALICE], [ALICE]);

      now = minutesLater(OwnerNotificationDeliveries.RESUME_AFTER_MINUTES);
      const gone: Mock<Notify> = jest.fn<Notify>(
        async (delivery: OwnerNotificationDelivery): Promise<void> => {
          await delivery.giveUp("the incident is gone");
        },
      );

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: gone,
      });

      expect(gone).toHaveBeenCalledTimes(1);
      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.NotWritten,
      );

      now = minutesLater(60);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: gone,
      });
      expect(gone).toHaveBeenCalledTimes(1);
    });

    test("rows written before it was kept - no feed status - are never taken up", async () => {
      await toldAndStoppedBeforeTheFeed([ALICE], [ALICE]);

      for (const row of table.rows) {
        row.feedStatus = null;
      }

      now = minutesLater(30);
      const { notify } = feedWriter([]);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });

      expect(notify).not.toHaveBeenCalled();
    });

    test("saying it is written, when that fails, is logged and never throws: a later run writes it again", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: created(),
          owners: [ALICE],
          isProjectOwners: false,
          writesFeedItem: true,
        });
      await tellEveryone(delivery, []);

      table.failWith("settleFeedItem", new Error("connection reset"));
      await expect(delivery.feedItemWritten()).resolves.toBeUndefined();
      table.failWith("settleFeedItem", null);

      expect(
        errors.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes("A later run writes it again.");
        }),
      ).toBe(true);

      now = minutesLater(OwnerNotificationDeliveries.RESUME_AFTER_MINUTES);
      const { notify, feedItems } = feedWriter([]);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: notify,
      });
      expect(feedItems).toEqual([idsOf([ALICE])]);
    });

    test("takes up only the kinds of its own job", async () => {
      await toldAndStoppedBeforeTheFeed([ALICE], [ALICE]);

      now = minutesLater(30);
      const { notify } = feedWriter([]);
      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentStateChanged],
        notify: notify,
      });

      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("planForOwnersOf", () => {
    test("plans for the record's owners", async () => {
      jest.spyOn(ProjectService, "getOwners").mockResolvedValue([CAROL]);

      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.planForOwnersOf({
          notification: created(),
          findOwners: async (): Promise<Array<User>> => {
            return [ALICE, BOB];
          },
          writesFeedItem: true,
        });

      expect(idsOf(delivery.owners)).toEqual(idsOf([ALICE, BOB]));
      expect(delivery.isProjectOwners).toBe(false);
      expect(table.feedStatusOf(INCIDENT_ID)).toBe(
        OwnerNotificationFeedStatus.Pending,
      );
    });

    test("plans for the project's owners, in its place, when the record has none", async () => {
      jest.spyOn(ProjectService, "getOwners").mockResolvedValue([CAROL]);

      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.planForOwnersOf({
          notification: created(),
          findOwners: async (): Promise<Array<User>> => {
            return [];
          },
          writesFeedItem: false,
        });

      expect(idsOf(delivery.owners)).toEqual(idsOf([CAROL]));
      expect(delivery.isProjectOwners).toBe(true);
      expect(Object.keys(table.statusesOf(INCIDENT_ID))).toEqual(
        idsOf([CAROL]),
      );
    });

    test("tells nobody, and says so, when the owners cannot be read", async () => {
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.planForOwnersOf({
          notification: created(),
          findOwners: async (): Promise<Array<User>> => {
            throw new Error("connection reset");
          },
          writesFeedItem: true,
        });

      expect(delivery.owners).toEqual([]);
      expect(delivery.hasWorkToDo).toBe(false);
      expect(table.rows).toEqual([]);
      expect(
        errors.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes("Telling nobody.");
        }),
      ).toBe(true);
    });
  });

});
