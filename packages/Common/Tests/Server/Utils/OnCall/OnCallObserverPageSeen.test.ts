import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallObserverPageSeen, {
  OnCallObserverPageSeenRequest,
} from "../../../../Server/Utils/OnCall/OnCallObserverPageSeen";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import ObjectID from "../../../../Types/ObjectID";
import { OnCallObserverOpenPage } from "../../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  OnCallOpenPage,
  OnCallPageRecordType,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import AcknowledgementTimeoutWorld, {
  ACKNOWLEDGED,
  CREATED,
  RESOLVED,
} from "./AcknowledgementTimeoutWorld";
import {
  ANA,
  BOB,
  CARL,
  DANA,
  INCIDENT_ID,
  PROJECT_ID,
  RUN_ID,
} from "./PassOnWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "I'VE SEEN IT" FROM THE MOBILE APP, END TO END (OnCallObserverPageSeen).
 *
 * Somebody paged as an observer answers their page from the record's screen
 * in the On-Call app - the action under their push opens it there. These run
 * the real code - the escalation rule paging its people, the acknowledge
 * hook every way of answering a page reaches
 * (UserOnCallLogTimelineService.acknowledgePage), the acknowledgement
 * timeout's clock - in an in-memory world (AcknowledgementTimeoutWorld), on
 * a run that pages as observers. Answering it says the person has seen it,
 * and nothing more: the incident is not acknowledged, so nobody else's page
 * stops and nobody becomes its Incident Commander. A responder's page is
 * never answered this way.
 *
 * The policy, Oversight, pages Ana and Bob at Level 1.
 */

let world: AcknowledgementTimeoutWorld;

beforeEach(() => {
  world = new AcknowledgementTimeoutWorld();
  world.install();
  world.addRule({ order: 1, users: [ANA, BOB] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The world's run, paging as observers.
async function startObserverRun(): Promise<OnCallDutyPolicyExecutionLog> {
  await world.startRun();

  const run: OnCallDutyPolicyExecutionLog = world.runById(RUN_ID);
  run.isObserverPage = true;

  return run;
}

function asked(
  userId: ObjectID,
  overrides: Partial<OnCallObserverPageSeenRequest> = {},
): OnCallObserverPageSeenRequest {
  return {
    userId: userId,
    projectId: PROJECT_ID,
    recordType: OnCallPageRecordType.Incident,
    recordId: INCIDENT_ID,
    ...overrides,
  };
}

async function openRuns(
  request: OnCallObserverPageSeenRequest,
): Promise<Array<string>> {
  return (await OnCallObserverPageSeen.getOpenPagesForRecord(request)).map(
    (page: OnCallObserverOpenPage) => {
      return page.executionLogId;
    },
  );
}

function logOf(userId: ObjectID): UserOnCallLog {
  return world.logsOf(userId)[0]!;
}

function spyOnRecordAcknowledgements(): Array<jest.SpiedFunction<() => void>> {
  return [
    jest.spyOn(IncidentService, "acknowledgeIncident"),
    jest.spyOn(AlertService, "acknowledgeAlert"),
  ] as unknown as Array<jest.SpiedFunction<() => void>>;
}

describe("an observer says they have seen their page", () => {
  test("their page is open to answer, one for the run", async () => {
    await startObserverRun();

    expect(await openRuns(asked(ANA))).toEqual([RUN_ID.toString()]);
  });

  test("the incident stays as it was - not acknowledged, no state written - and nobody becomes its commander", async () => {
    const acknowledgements: Array<jest.SpiedFunction<() => void>> =
      spyOnRecordAcknowledgements();
    await startObserverRun();

    world.advance(5);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA)),
    ).toBe(1);

    for (const acknowledgement of acknowledgements) {
      expect(acknowledgement).not.toHaveBeenCalled();
    }
    expect(world.incident!.stateId.toString()).toBe(CREATED.toString());
    expect(world.stateRows).toEqual([]);
  });

  test("their page and the run end, saying who saw it and what it did not do", async () => {
    await startObserverRun();

    world.advance(5);
    await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA));

    const run: OnCallDutyPolicyExecutionLog = world.runById(RUN_ID);

    expect(run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(run.acknowledgedByUserId?.toString()).toBe(ANA.toString());
    expect(run.statusMessage).toMatch(/^Seen by .+, paged as an observer\./);
    expect(run.statusMessage).toContain(
      "The incident is not acknowledged by this.",
    );
    expect(logOf(ANA).acknowledgedAt).toBeTruthy();
    expect(world.isStillPaging(ANA, RUN_ID)).toBe(false);
  });

  test("no acknowledgement timeout starts: getting the incident resolved is the responders' work", async () => {
    await startObserverRun();

    world.advance(5);
    await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA));

    expect(world.runningClocks()).toEqual([]);
  });

  test("once answered it is not open any more, and answering again answers nothing", async () => {
    await startObserverRun();

    await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA));

    expect(await openRuns(asked(ANA))).toEqual([]);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA)),
    ).toBe(0);
  });

  test("on an incident the responders acknowledged - the usual case - it is just as open, and answered the same way", async () => {
    const acknowledgements: Array<jest.SpiedFunction<() => void>> =
      spyOnRecordAcknowledgements();
    await startObserverRun();
    await world.acknowledgeInDashboard(DANA);

    expect(await openRuns(asked(ANA))).toEqual([RUN_ID.toString()]);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA)),
    ).toBe(1);

    for (const acknowledgement of acknowledgements) {
      expect(acknowledgement).not.toHaveBeenCalled();
    }
    expect(world.incident!.stateId.toString()).toBe(ACKNOWLEDGED.toString());
    expect(world.runById(RUN_ID).status).toBe(OnCallDutyPolicyStatus.Completed);
  });

  test("its notifications all went out already - a push, then nothing - and it is still theirs to answer, as its email's link is", async () => {
    await startObserverRun();
    logOf(ANA).status = UserNotificationExecutionStatus.Completed;

    expect(await openRuns(asked(ANA))).toEqual([RUN_ID.toString()]);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA)),
    ).toBe(1);
  });
});

describe("what is not theirs to answer", () => {
  test("once one of the people it paged said so, it is answered: nobody else's is open", async () => {
    await startObserverRun();

    await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA));

    expect(await openRuns(asked(BOB))).toEqual([]);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(BOB)),
    ).toBe(0);
    // Ana saw it first, and the run says so still.
    expect(world.runById(RUN_ID).acknowledgedByUserId?.toString()).toBe(
      ANA.toString(),
    );
  });

  test("a page they escalated is the next level's", async () => {
    await startObserverRun();
    logOf(ANA).status = UserNotificationExecutionStatus.PassedOn;

    expect(await openRuns(asked(ANA))).toEqual([]);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA)),
    ).toBe(0);
    expect(world.runById(RUN_ID).status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  test("a resolved incident: its observers' pages are over", async () => {
    await startObserverRun();
    world.incident = { stateId: RESOLVED };

    expect(await openRuns(asked(ANA))).toEqual([]);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA)),
    ).toBe(0);
    expect(world.runById(RUN_ID).acknowledgedAt).toBeFalsy();
  });

  test("a deleted incident: nothing to answer", async () => {
    await startObserverRun();
    world.incident = null;

    expect(await openRuns(asked(ANA))).toEqual([]);
  });

  test("a responder's page is never answered here: answering it would acknowledge the incident", async () => {
    const acknowledgements: Array<jest.SpiedFunction<() => void>> =
      spyOnRecordAcknowledgements();
    await world.startRun();

    expect(await openRuns(asked(ANA))).toEqual([]);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(ANA)),
    ).toBe(0);

    for (const acknowledgement of acknowledgements) {
      expect(acknowledgement).not.toHaveBeenCalled();
    }
    expect(world.incident!.stateId.toString()).toBe(CREATED.toString());
    expect(world.runById(RUN_ID).status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(world.isStillPaging(ANA, RUN_ID)).toBe(true);
  });

  test("somebody the run does not page has none", async () => {
    await startObserverRun();

    expect(await openRuns(asked(CARL))).toEqual([]);
    expect(
      await OnCallObserverPageSeen.markPagesSeenForRecord(asked(CARL)),
    ).toBe(0);
    expect(world.isStillPaging(ANA, RUN_ID)).toBe(true);
  });

  test("only the record asked about, in the project the person is signed in to", async () => {
    await startObserverRun();

    for (const overrides of [
      { projectId: ObjectID.generate() },
      { recordId: ObjectID.generate() },
      // The incident's id, asked about as an alert: no alert has it.
      { recordType: OnCallPageRecordType.Alert },
    ] as Array<Partial<OnCallObserverPageSeenRequest>>) {
      expect(await openRuns(asked(ANA, overrides))).toEqual([]);
      expect(
        await OnCallObserverPageSeen.markPagesSeenForRecord(
          asked(ANA, overrides),
        ),
      ).toBe(0);
    }

    expect(world.isStillPaging(ANA, RUN_ID)).toBe(true);
  });
});

/*
 * The record's open pages for Escalate (OnCallPagePassOn) say which is an
 * observer's, so the mobile app keeps Escalate off it: there is nothing for
 * an observer to escalate.
 */
describe("Escalate's open pages", () => {
  async function openPassOnPages(): Promise<Array<OnCallOpenPage>> {
    return await OnCallPagePassOn.getOpenPagesForRecord({
      userId: ANA,
      projectId: PROJECT_ID,
      recordType: OnCallPageRecordType.Incident,
      recordId: INCIDENT_ID,
    });
  }

  test("an observer's page says it is one", async () => {
    await startObserverRun();

    const pages: Array<OnCallOpenPage> = await openPassOnPages();

    expect(pages).toHaveLength(1);
    expect(pages[0]!.isObserverPage).toBe(true);
  });

  test("a responder's page says nothing of the kind, as before", async () => {
    await world.startRun();

    const pages: Array<OnCallOpenPage> = await openPassOnPages();

    expect(pages).toHaveLength(1);
    expect("isObserverPage" in pages[0]!).toBe(false);
  });
});
