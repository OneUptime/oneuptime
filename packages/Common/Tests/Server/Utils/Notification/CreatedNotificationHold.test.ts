import Incident from "../../../../Models/DatabaseModels/Incident";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import CreatedNotificationHold, {
  OwnersAddedBy,
} from "../../../../Server/Utils/Notification/CreatedNotificationHold";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE CREATED NOTIFICATION WAITS FOR EVERY OWNER (#7210).
 *
 * The one record a create's hold and release are decided on: held from
 * onBeforeCreate, released - marked not notified, so the job tells its
 * owners - once the create, its chain and its caller have each said their
 * owners are in. Released only when it was held, and only once: the job may
 * have told the owners of anything nobody held already, and would tell them
 * again.
 */

type Release = () => Promise<void>;

let errors: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  errors = jest.spyOn(logger, "error").mockImplementation((() => {
    // read by the tests
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function newRelease(): ReturnType<typeof jest.fn<Release>> {
  return jest.fn<Release>().mockResolvedValue(undefined);
}

// A create, as its caller hands it to the service and every hook is handed it.
function newCreate(): CreateBy<Incident> {
  return { data: new Incident(), props: { isRoot: true } };
}

// A create a monitor makes: its creator's word, its chain's and its caller's.
function monitorCreate(release: Release): CreateBy<Incident> {
  const create: CreateBy<Incident> = newCreate();

  CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Create);
  CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Caller);
  CreatedNotificationHold.hold(create);
  CreatedNotificationHold.chainAddsOwners(create, release);

  return create;
}

describe("a held create", () => {
  const EVERY_ORDER: Array<Array<OwnersAddedBy>> = [
    [OwnersAddedBy.Create, OwnersAddedBy.Chain, OwnersAddedBy.Caller],
    [OwnersAddedBy.Create, OwnersAddedBy.Caller, OwnersAddedBy.Chain],
    [OwnersAddedBy.Chain, OwnersAddedBy.Create, OwnersAddedBy.Caller],
    [OwnersAddedBy.Chain, OwnersAddedBy.Caller, OwnersAddedBy.Create],
    [OwnersAddedBy.Caller, OwnersAddedBy.Create, OwnersAddedBy.Chain],
    [OwnersAddedBy.Caller, OwnersAddedBy.Chain, OwnersAddedBy.Create],
  ];

  test.each(EVERY_ORDER)(
    "is released once the last of them says its owners are in: %s, %s, %s",
    async (
      first: OwnersAddedBy,
      second: OwnersAddedBy,
      last: OwnersAddedBy,
    ) => {
      const release: ReturnType<typeof newRelease> = newRelease();
      const create: CreateBy<Incident> = monitorCreate(release);

      await CreatedNotificationHold.ownersAreIn(create, first);
      await CreatedNotificationHold.ownersAreIn(create, second);

      expect(release).not.toHaveBeenCalled();

      await CreatedNotificationHold.ownersAreIn(create, last);

      expect(release).toHaveBeenCalledTimes(1);
      expect(errors).not.toHaveBeenCalled();
    },
  );

  test("is released once: a word said again, or by one that never said it adds owners, does not release it again", async () => {
    const release: ReturnType<typeof newRelease> = newRelease();
    const create: CreateBy<Incident> = newCreate();

    CreatedNotificationHold.hold(create);
    CreatedNotificationHold.chainAddsOwners(create, release);

    // Nobody said the caller adds owners: its word holds nothing back.
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Caller);

    expect(release).not.toHaveBeenCalled();

    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Chain);
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Chain);
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Caller);
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Create);

    expect(release).toHaveBeenCalledTimes(1);
  });

  test("stays held until its chain has started: the chain is what releases it", async () => {
    const release: ReturnType<typeof newRelease> = newRelease();
    const create: CreateBy<Incident> = newCreate();

    CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Create);
    CreatedNotificationHold.hold(create);
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Create);

    expect(release).not.toHaveBeenCalled();

    CreatedNotificationHold.chainAddsOwners(create, release);

    // The chain's owners are not in yet.
    expect(release).not.toHaveBeenCalled();

    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Chain);

    expect(release).toHaveBeenCalledTimes(1);
  });

  test("is released after its release has run: the word that releases it waits for it", async () => {
    let finish: () => void = (): void => {};
    const order: Array<string> = [];
    const release: Release = async (): Promise<void> => {
      order.push("release started");
      await new Promise<void>((resolve: () => void) => {
        finish = resolve;
      });
      order.push("release done");
    };
    const create: CreateBy<Incident> = newCreate();

    CreatedNotificationHold.hold(create);
    CreatedNotificationHold.chainAddsOwners(create, release);

    const said: Promise<void> = CreatedNotificationHold.ownersAreIn(
      create,
      OwnersAddedBy.Chain,
    ).then(() => {
      order.push("owners are in");
    });

    await Promise.resolve();
    expect(order).toEqual(["release started"]);

    finish();
    await said;

    expect(order).toEqual(["release started", "release done", "owners are in"]);
  });

  test("whose release fails is logged, never thrown, and not tried again", async () => {
    const release: ReturnType<typeof jest.fn<Release>> = jest
      .fn<Release>()
      .mockRejectedValue(new Error("The database is away"));
    const create: CreateBy<Incident> = newCreate();

    CreatedNotificationHold.hold(create);
    CreatedNotificationHold.chainAddsOwners(create, release);

    await expect(
      CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Chain),
    ).resolves.toBeUndefined();
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Chain);

    expect(release).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain(
      "Releasing a Created notification held for its owners failed: Error: The database is away",
    );
    // Not lost: the job takes a hold nobody let go once it has lasted long enough (#7571).
    expect(String(errors.mock.calls[0]?.[0])).toContain(
      "The owners are told once the hold has lasted 5 minutes.",
    );
  });

  test("is told apart from every other create: releasing one leaves the other held", async () => {
    const releaseFirst: ReturnType<typeof newRelease> = newRelease();
    const releaseSecond: ReturnType<typeof newRelease> = newRelease();
    const first: CreateBy<Incident> = monitorCreate(releaseFirst);
    const second: CreateBy<Incident> = monitorCreate(releaseSecond);

    for (const by of [
      OwnersAddedBy.Create,
      OwnersAddedBy.Chain,
      OwnersAddedBy.Caller,
    ]) {
      await CreatedNotificationHold.ownersAreIn(first, by);
    }

    expect(releaseFirst).toHaveBeenCalledTimes(1);
    expect(releaseSecond).not.toHaveBeenCalled();

    await CreatedNotificationHold.ownersAreIn(second, OwnersAddedBy.Create);
    await CreatedNotificationHold.ownersAreIn(second, OwnersAddedBy.Chain);

    // Its caller is still adding its owners.
    expect(releaseSecond).not.toHaveBeenCalled();
  });
});

describe("a create nobody held", () => {
  test("is never released, whoever says their owners are in: the job may have told its owners already", async () => {
    const release: ReturnType<typeof newRelease> = newRelease();
    const create: CreateBy<Incident> = newCreate();

    // Written as notified already by its caller: onBeforeCreate held nothing.
    CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Create);
    CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Caller);
    CreatedNotificationHold.chainAddsOwners(create, release);

    for (const by of [
      OwnersAddedBy.Chain,
      OwnersAddedBy.Create,
      OwnersAddedBy.Caller,
    ]) {
      await CreatedNotificationHold.ownersAreIn(create, by);
    }

    expect(release).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  test("never seen at all: a word about it does nothing", async () => {
    await expect(
      CreatedNotificationHold.ownersAreIn(newCreate(), OwnersAddedBy.Chain),
    ).resolves.toBeUndefined();

    expect(errors).not.toHaveBeenCalled();
  });
});

/*
 * WHEN THE JOB TAKES A RECORD (#7571, #7573): one let go once it was
 * created a minute ago or earlier - so owners a separate request adds right
 * after the create are in by then - and one still held once its hold has
 * lasted five minutes: nobody will let it go.
 */
describe("the records the Created job takes", () => {
  const NOW: Date = new Date("2026-11-15T10:00:30.250Z");

  test("are those let go a minute after their create, and those held for five minutes", () => {
    expect(CreatedNotificationHold.SENT_AFTER_CREATED_IN_MINUTES).toBe(1);
    expect(CreatedNotificationHold.HELD_FOR_AT_MOST_MINUTES).toBe(5);

    expect(CreatedNotificationHold.getDue(NOW)).toEqual({
      createdBefore: new Date("2026-11-15T09:59:30.250Z"),
      heldBefore: new Date("2026-11-15T09:55:30.250Z"),
    });
  });

  test("a hold outlasts the wait after a create: a record let go in time is never taken as held", () => {
    expect(CreatedNotificationHold.HELD_FOR_AT_MOST_MINUTES).toBeGreaterThan(
      CreatedNotificationHold.SENT_AFTER_CREATED_IN_MINUTES,
    );
  });

  test("are worked out from the moment the job runs, which is left as it was", () => {
    const now: Date = new Date(NOW.getTime());

    CreatedNotificationHold.getDue(now);

    expect(now).toEqual(NOW);
  });
});

describe("the records the Created job read", () => {
  const FIRST: string = "75710000-0000-4000-8000-0000000000a1";
  const SECOND: string = "75710000-0000-4000-8000-0000000000a2";

  function recordWith(id: string | null): Incident {
    const incident: Incident = new Incident();

    if (id) {
      incident._id = id;
    }

    return incident;
  }

  test("are taken each once, in the order first read: one let go between its two reads is in both", () => {
    const first: Incident = recordWith(FIRST);
    const second: Incident = recordWith(SECOND);
    const firstAgain: Incident = recordWith(FIRST);

    const once: Array<Incident> = CreatedNotificationHold.oncePerRecord([
      first,
      second,
      firstAgain,
    ]);

    expect(once).toHaveLength(2);
    expect(once[0]).toBe(first);
    expect(once[1]).toBe(second);
  });

  test("leave out a record read without its id: there is nothing to take it by", () => {
    expect(
      CreatedNotificationHold.oncePerRecord([
        recordWith(null),
        recordWith(SECOND),
      ]).map((record: Incident): string => {
        return record.id!.toString();
      }),
    ).toEqual([SECOND]);
  });

  test("are none when the job read none", () => {
    expect(CreatedNotificationHold.oncePerRecord([])).toEqual([]);
  });
});
