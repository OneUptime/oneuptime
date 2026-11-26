import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import CreatedNotificationHold, {
  OwnersAddedBy,
} from "../../../../Server/Utils/Notification/CreatedNotificationHold";
import WorkspaceRuleOwnersOnCreate from "../../../../Server/Utils/Workspace/WorkspaceRuleOwnersOnCreate";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A NOTIFICATION RULE THAT ASKS WHO OWNS A RECORD IS MATCHED ON ALL OF ITS
 * OWNERS AS THE RECORD IS CREATED (#11146).
 *
 * An incident's or alert's create chain adds the owners handed over with
 * the create and its owner rules' before it opens the record's channels
 * and posts its Created message. Its creator (Create) and the code that
 * made it - a monitor's criteria (Caller) - add theirs from outside the
 * chain: in a project with a rule that asks who owns such a record, the
 * chain waits for them a moment first (WorkspaceRuleOwnersOnCreate), at
 * most OWNERS_WAITED_FOR_AT_MOST_MS, and never fails for it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11146000-0000-4000-8000-00000000000a",
);
const ALERT_ID: ObjectID = new ObjectID("11146000-0000-4000-8000-00000000000b");
const INCIDENT_ID: ObjectID = new ObjectID(
  "11146000-0000-4000-8000-00000000000c",
);

let rulesAskWhoOwns: boolean = true;
let ruleReads: jest.SpiedFunction<
  typeof WorkspaceNotificationRuleService.hasRulesWithOwnerCondition
>;
let warnings: jest.SpiedFunction<typeof logger.warn>;
let errorsLogged: jest.SpiedFunction<typeof logger.error>;

// A create as a monitor makes it: its creator's owners and the monitor's own.
function monitorsCreate(): CreateBy<Alert> {
  const create: CreateBy<Alert> = {
    data: new Alert(),
    props: { isRoot: true },
  };

  CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Create);
  CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Caller);

  return create;
}

function waitFor(create: CreateBy<Alert>): Promise<void> {
  return WorkspaceRuleOwnersOnCreate.waitForOwnersOfCreate({
    createBy: create,
    projectId: PROJECT_ID,
    eventType: NotificationRuleEventType.Alert,
    recordId: ALERT_ID,
  });
}

// Whether a promise has settled after a few turns of the event loop.
async function hasSettled(promise: Promise<void>): Promise<boolean> {
  let settled: boolean = false;

  promise.then(() => {
    settled = true;
  });

  for (let i: number = 0; i < 20; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }

  return settled;
}

function withWaitOf(ms: number): () => void {
  const target: { OWNERS_WAITED_FOR_AT_MOST_MS: number } =
    WorkspaceRuleOwnersOnCreate as unknown as {
      OWNERS_WAITED_FOR_AT_MOST_MS: number;
    };
  const was: number = target.OWNERS_WAITED_FOR_AT_MOST_MS;

  target.OWNERS_WAITED_FOR_AT_MOST_MS = ms;

  return (): void => {
    target.OWNERS_WAITED_FOR_AT_MOST_MS = was;
  };
}

beforeEach(() => {
  rulesAskWhoOwns = true;

  ruleReads = jest
    .spyOn(WorkspaceNotificationRuleService, "hasRulesWithOwnerCondition")
    .mockImplementation(async (): Promise<boolean> => {
      return rulesAskWhoOwns;
    });

  warnings = jest.spyOn(logger, "warn").mockImplementation((() => {
    // read by the tests
  }) as never);
  errorsLogged = jest.spyOn(logger, "error").mockImplementation((() => {
    // read by the tests
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("waitForOwnersOfCreate", () => {
  test("waits until the creator's and the caller's owners are both in", async () => {
    const create: CreateBy<Alert> = monitorsCreate();

    const waiting: Promise<void> = waitFor(create);

    expect(await hasSettled(waiting)).toBe(false);

    // The create returned: its creator is in. The monitor is still adding the criteria's owners.
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Create);
    expect(await hasSettled(waiting)).toBe(false);

    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Caller);
    expect(await hasSettled(waiting)).toBe(true);

    expect(warnings).not.toHaveBeenCalled();
  });

  test("asks the rules of the record's own kind, in its project", async () => {
    const create: CreateBy<Alert> = monitorsCreate();

    const waiting: Promise<void> =
      WorkspaceRuleOwnersOnCreate.waitForOwnersOfCreate({
        createBy: create as unknown as CreateBy<Incident>,
        projectId: PROJECT_ID,
        eventType: NotificationRuleEventType.Incident,
        recordId: INCIDENT_ID,
      });

    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Create);
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Caller);
    await waiting;

    expect(ruleReads).toHaveBeenCalledTimes(1);
    expect(ruleReads).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      eventType: NotificationRuleEventType.Incident,
    });
  });

  test("a project with no rule that asks who owns the record waits for nobody", async () => {
    rulesAskWhoOwns = false;

    expect(await hasSettled(waitFor(monitorsCreate()))).toBe(true);
    expect(ruleReads).toHaveBeenCalledTimes(1);
  });

  test("nobody still adding owners waits for nothing, and reads no rule", async () => {
    const create: CreateBy<Alert> = monitorsCreate();

    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Create);
    await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Caller);

    expect(await hasSettled(waitFor(create))).toBe(true);
    expect(ruleReads).not.toHaveBeenCalled();

    // A create nobody adds owners to from outside its chain - a form's, as root - neither.
    expect(
      await hasSettled(waitFor({ data: new Alert(), props: { isRoot: true } })),
    ).toBe(true);
    expect(ruleReads).not.toHaveBeenCalled();
  });

  test("the chain's own owners are not waited for: it adds them itself, before this", async () => {
    const create: CreateBy<Alert> = { data: new Alert(), props: {} };

    CreatedNotificationHold.hold(create);
    CreatedNotificationHold.chainAddsOwners(create, async () => {
      // released by the chain
    });

    expect(
      CreatedNotificationHold.isAddingOwners(create, [OwnersAddedBy.Chain]),
    ).toBe(true);
    expect(await hasSettled(waitFor(create))).toBe(true);
    expect(ruleReads).not.toHaveBeenCalled();
  });

  test("it waits OWNERS_WAITED_FOR_AT_MOST_MS at most, says so, and the rules are matched without them", async () => {
    expect(WorkspaceRuleOwnersOnCreate.OWNERS_WAITED_FOR_AT_MOST_MS).toBe(
      10 * 1000,
    );

    const restore: () => void = withWaitOf(30);

    try {
      // Nobody says their owners are in: the wait runs out.
      await expect(waitFor(monitorsCreate())).resolves.toBeUndefined();

      expect(warnings).toHaveBeenCalledTimes(1);
      expect(String(warnings.mock.calls[0]![0])).toContain(
        "owners were not all in after 30 ms",
      );
    } finally {
      restore();
    }
  });

  test("rules that cannot be read wait for nobody, and never fail the create", async () => {
    ruleReads.mockRejectedValue(new Error("the database is away") as never);

    const waiting: Promise<void> = waitFor(monitorsCreate());

    expect(await hasSettled(waiting)).toBe(true);
    await expect(waiting).resolves.toBeUndefined();
    expect(String(errorsLogged.mock.calls[0]![0])).toContain(
      "Could not wait for",
    );
    expect(String(errorsLogged.mock.calls[0]![0])).toContain(
      "the database is away",
    );
  });
});
