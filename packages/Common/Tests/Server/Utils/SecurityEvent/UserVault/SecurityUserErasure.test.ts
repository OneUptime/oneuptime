import SecurityUserErasureRequest from "../../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityUserErasureRequestService, {
  SecurityUserErasureCounts,
  toStoredErasureNames,
} from "../../../../../Server/Services/SecurityUserErasureRequestService";
import JobDeadline, {
  JOB_DEADLINE_GRACE_MS,
} from "../../../../../Server/Utils/JobDeadline";
import SecurityUserVaultService from "../../../../../Server/Services/SecurityUserVaultService";
import { SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS } from "../../../../../Server/Utils/SecurityEvent/SecurityProjectWork";
import SecurityUserErasure, {
  DETECTION_TURN_SETTLE_MS,
  MAX_ERASURE_ATTEMPTS,
  RESUBMIT_AFTER_MS,
  RETRY_BACKOFF_MS,
  SUPPRESSION_SETTLE_MS,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasure";
import SecurityUserErasureEvents from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureEvents";
import SecurityUserErasureFindings, {
  FindingsCursor,
  FindingsScanProgress,
  FindingsScanStep,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureFindings";
import {
  SecurityUserErasureProgress,
  readErasureProgress,
  toStoredErasureProgress,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureProgress";
import SecurityUserErasureRecords from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureRecords";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityUserErasureRequestStatus } from "../../../../../Types/SecurityEvent/SecurityUserErasure";
import { ErasedName } from "../../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * THE ERASURE WORKER'S MOVES (#10908), with everything it reads and writes
 * stood in: when a request starts, when it is checked, told again, retried,
 * given up on - and who it hands Postgres to take out. The statements
 * themselves run on a real ClickHouse in SecurityUserErasureClickhouse, and
 * Postgres's half on a real Postgres in SecurityUserErasurePostgres.
 *
 * And #11044's: the names a run keeps on the request, and the Detection
 * Findings it reads and changes by them. And #11160's: a project with more
 * findings than one run reads is read over several runs, each on from where
 * the last one stopped, in passes from the first finding to the last - and
 * the request reads Erased only once a pass that started after nothing
 * else named the person, for as long as a detection could still be writing
 * about them, found nothing left to change.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000d1",
);
const FILED_AT: Date = new Date("2026-11-24T10:00:00.000Z");

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

const ALICE: string = "alice@example.com";

/*
 * A project's findings as the read sees them: each names the person or not,
 * read `findingsPerRun` a run. A change is applied when the next run starts
 * (`applyLag`), as ClickHouse applies a mutation a while after it holds it.
 */
interface FindingsWorld {
  naming: Array<boolean>;
  perRun: number;
  // Changes queued and not yet applied.
  queued: Set<number>;
  applyLag: boolean;
  reads: Array<FindingsCursor | null>;
  changedTotal: number;
}

interface World {
  vaultRows: number;
  namedEvents: number;
  findings: FindingsWorld;
  claimed: boolean;
  calls: Array<string>;
  names: Array<Array<ErasedName>>;
  keptNames: Array<Array<ErasedName>>;
  findingNames: Array<Array<ErasedName>>;
  // The request as the worker keeps it: progress and counts, written as it goes.
  progress: SecurityUserErasureProgress | null;
  eventsUnnamed: number | null;
  rewrittenFingerprints: Array<Array<ErasedName>>;
  scanError: Error | null;
  emailed: number;
}

let world: World;

function describeNames(names: ReadonlyArray<ErasedName>): Array<string> {
  return names
    .map((name: ErasedName): string => {
      return `${name.named} -> ${name.hashed}`;
    })
    .sort();
}

function cursorOf(index: number): FindingsCursor {
  return { time: String(1764000000000000000 + index), id: `f${index}` };
}

function indexOf(cursor: FindingsCursor | null): number {
  return cursor ? Number(cursor.id.slice(1)) + 1 : 0;
}

function findingsWorld(count: number, namingEvery: number): FindingsWorld {
  return {
    naming: Array.from({ length: count }, (_v: unknown, index: number) => {
      return namingEvery > 0 && index % namingEvery === 0;
    }),
    perRun: 1000,
    queued: new Set<number>(),
    applyLag: false,
    reads: [],
    changedTotal: 0,
  };
}

function request(
  overrides: Partial<Record<string, unknown>> = {},
): SecurityUserErasureRequest {
  const model: SecurityUserErasureRequest = new SecurityUserErasureRequest();

  model.id = ObjectID.generate();
  model.projectId = PROJECT_ID;
  model.userToErase = ALICE;
  model.tokens = [tokenOf(ALICE)];
  model.status = SecurityUserErasureRequestStatus.Pending;
  model.requestedAt = FILED_AT;
  model.updatedAt = FILED_AT;
  model.attempts = 0;
  model.vaultEntriesDeleted = 0;
  model.eventsUnnamed = 0;
  model.casesUnnamed = 0;
  model.proposalsWithdrawn = 0;

  Object.assign(model, overrides);

  return model;
}

// The request as the worker left it: what the next run reads.
function kept(
  model: SecurityUserErasureRequest,
  overrides: Partial<Record<string, unknown>> = {},
): SecurityUserErasureRequest {
  return request({
    id: model.id,
    status: SecurityUserErasureRequestStatus.InProgress,
    userToErase: model.userToErase,
    tokens: model.tokens,
    namesToErase: world.keptNames.length
      ? toStoredErasureNames(world.keptNames[world.keptNames.length - 1]!)
      : undefined,
    progress: world.progress
      ? toStoredErasureProgress(world.progress)
      : undefined,
    eventsUnnamed: world.eventsUnnamed || 0,
    ...overrides,
  });
}

function at(milliseconds: number): Date {
  return new Date(FILED_AT.getTime() + milliseconds);
}

const STARTED_AT: number = SUPPRESSION_SETTLE_MS;
const MINUTE: number = 60 * 1000;

beforeEach(() => {
  world = {
    vaultRows: 1,
    namedEvents: 2,
    findings: findingsWorld(3, 3),
    claimed: true,
    calls: [],
    names: [],
    keptNames: [],
    findingNames: [],
    progress: null,
    eventsUnnamed: null,
    rewrittenFingerprints: [],
    scanError: null,
    emailed: 0,
  };

  jest
    .spyOn(SecurityUserErasureFindings, "scanFindings")
    .mockImplementation(
      async (data: {
        names: ReadonlyArray<ErasedName>;
        after: FindingsCursor | null;
        onProgress: (progress: FindingsScanProgress) => Promise<void>;
      }): Promise<FindingsScanStep> => {
        const findings: FindingsWorld = world.findings;

        world.calls.push(`scan from ${indexOf(data.after)}`);
        world.findingNames.push([...data.names]);
        findings.reads.push(data.after);

        if (world.scanError) {
          throw world.scanError;
        }

        // What ClickHouse held since the last run is applied now.
        if (findings.applyLag) {
          for (const index of findings.queued) {
            findings.naming[index] = false;
          }

          findings.queued.clear();
        }

        let index: number = indexOf(data.after);
        let changed: number = 0;
        const end: number = Math.min(
          findings.naming.length,
          index + findings.perRun,
        );

        for (; index < end; index++) {
          if (findings.naming[index] && !findings.queued.has(index)) {
            changed++;

            if (findings.applyLag) {
              findings.queued.add(index);
            } else {
              findings.naming[index] = false;
            }
          } else if (findings.naming[index] && findings.applyLag) {
            // Still waiting on ClickHouse: queued again, which changes nothing more.
            changed++;
          }
        }

        findings.changedTotal += changed;

        const after: FindingsCursor | null =
          index > 0 ? cursorOf(index - 1) : data.after;

        await data.onProgress({
          after,
          changed,
          unnamed: changed,
          correlationValues:
            changed > 0
              ? [
                  {
                    named: `${ALICE} / 203.0.113.7`,
                    hashed: `${tokenOf(ALICE)} / 203.0.113.7`,
                  },
                ]
              : [],
        });

        return {
          after,
          isAtEnd: index >= findings.naming.length,
          changed,
          unnamed: changed,
          ...(index >= findings.naming.length ? {} : { stoppedBy: "time" }),
        } as FindingsScanStep;
      },
    );

  jest
    .spyOn(
      SecurityUserErasureRequestService,
      "compareAndSetColumnsByIdWithoutHooks",
    )
    .mockImplementation(async (): Promise<boolean> => {
      world.calls.push("claim");
      return world.claimed;
    });
  jest
    .spyOn(SecurityUserErasureRequestService, "markInProgress")
    .mockImplementation(
      async (data: {
        counts: SecurityUserErasureCounts;
        names?: ReadonlyArray<ErasedName> | undefined;
        progress?: SecurityUserErasureProgress | undefined;
      }): Promise<void> => {
        world.calls.push(`inProgress ${JSON.stringify(data.counts)}`);

        if (data.names) {
          world.keptNames.push([...data.names]);
        }

        if (data.progress) {
          world.progress = readErasureProgress(
            JSON.parse(JSON.stringify(data.progress)),
          );
        }

        world.eventsUnnamed = data.counts.eventsUnnamed;
      },
    );
  jest
    .spyOn(SecurityUserErasureRequestService, "markProgress")
    .mockImplementation(
      async (data: {
        progress: SecurityUserErasureProgress;
        eventsUnnamed?: number | undefined;
      }): Promise<void> => {
        world.progress = readErasureProgress(
          JSON.parse(JSON.stringify(data.progress)),
        );

        if (data.eventsUnnamed !== undefined) {
          world.eventsUnnamed = data.eventsUnnamed;
        }
      },
    );
  jest
    .spyOn(SecurityUserErasureRequestService, "markCompleted")
    .mockImplementation(
      async (data: { counts: SecurityUserErasureCounts }): Promise<void> => {
        world.calls.push(`completed ${JSON.stringify(data.counts)}`);
      },
    );
  jest
    .spyOn(SecurityUserErasureRequestService, "markAttemptFailed")
    .mockImplementation(
      async (data: {
        attempts: number;
        status: string;
        failureReason: string;
      }): Promise<void> => {
        world.calls.push(
          `attemptFailed ${data.attempts} ${data.status} ${data.failureReason}`,
        );
      },
    );
  jest
    .spyOn(SecurityUserErasureRequestService, "markFailed")
    .mockImplementation(async (data: { attempts: number }): Promise<void> => {
      world.calls.push(`failed ${data.attempts}`);
    });
  jest
    .spyOn(SecurityUserVaultService, "findEntriesOfTokens")
    .mockImplementation(async () => {
      return world.vaultRows > 0
        ? [{ token: tokenOf(ALICE), user: ALICE }]
        : [];
    });
  jest
    .spyOn(SecurityUserVaultService, "countRowsOfTokens")
    .mockImplementation(async (): Promise<number> => {
      return world.vaultRows;
    });
  jest
    .spyOn(SecurityUserVaultService, "eraseTokens")
    .mockImplementation(async (): Promise<void> => {
      world.calls.push("eraseVault");
    });
  jest
    .spyOn(SecurityUserErasureEvents, "findNamedPairs")
    .mockImplementation(async () => {
      return world.namedEvents > 0
        ? [{ named: `auth0|${ALICE}`, hashed: `auth0|${tokenOf(ALICE)}` }]
        : [];
    });
  jest
    .spyOn(SecurityUserErasureEvents, "countNamedEvents")
    .mockImplementation(async (): Promise<number> => {
      return world.namedEvents;
    });
  jest
    .spyOn(SecurityUserErasureEvents, "unnameEvents")
    .mockImplementation(async (): Promise<void> => {
      world.calls.push("unnameEvents");
    });
  jest
    .spyOn(SecurityUserErasureRecords, "unnameRecords")
    .mockImplementation(async (data: { names: ReadonlyArray<ErasedName> }) => {
      world.names.push([...data.names]);
      world.calls.push("unnameRecords");
      return { cases: 2, proposals: 1 };
    });
  jest
    .spyOn(SecurityUserErasureRecords, "rewriteFingerprints")
    .mockImplementation(
      async (data: { groupValues: ReadonlyArray<ErasedName> }) => {
        world.rewrittenFingerprints.push([...data.groupValues]);
        return { detections: 0, alerts: 0, incidents: 0, entityRisks: 0 };
      },
    );
  jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockImplementation(async (): Promise<void> => {
      world.emailed++;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// One run of the worker on the request as it was last kept, at `now`.
async function runAt(
  model: SecurityUserErasureRequest,
  now: number,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<void> {
  await SecurityUserErasure.processRequest({
    request: kept(model, overrides),
    now: at(now),
  });
}

describe("how long a final check waits", () => {
  test("as long as a detection turn that read the name may still be writing", () => {
    expect(DETECTION_TURN_SETTLE_MS).toBe(
      SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS + JOB_DEADLINE_GRACE_MS,
    );
    expect(DETECTION_TURN_SETTLE_MS).toBeLessThan(RESUBMIT_AFTER_MS);
  });
});

describe("a Pending request", () => {
  test("waits until every process refuses its tokens", async () => {
    await SecurityUserErasure.processRequest({
      request: request(),
      now: at(SUPPRESSION_SETTLE_MS - 1),
    });

    expect(world.calls).toEqual([]);
  });

  test("is claimed, then Postgres first and ClickHouse after - the events, the vault, then the findings' first pass - its counts kept at each step", async () => {
    await SecurityUserErasure.processRequest({
      request: request(),
      now: at(STARTED_AT),
    });

    expect(world.calls).toEqual([
      "claim",
      "unnameRecords",
      `inProgress ${JSON.stringify({
        vaultEntriesDeleted: 0,
        eventsUnnamed: 0,
        casesUnnamed: 2,
        proposalsWithdrawn: 1,
      })}`,
      "unnameEvents",
      "eraseVault",
      `inProgress ${JSON.stringify({
        vaultEntriesDeleted: 1,
        eventsUnnamed: 2,
        casesUnnamed: 2,
        proposalsWithdrawn: 1,
      })}`,
      "scan from 0",
    ]);
    // Two events and one Detection Finding.
    expect(world.eventsUnnamed).toBe(3);
    expect(world.progress).toEqual({
      toldAt: at(STARTED_AT).toISOString(),
      namedEvents: 2,
      cleanSince: null,
      unnamedFindings: 1,
      findings: {
        number: 1,
        startedAt: at(STARTED_AT).toISOString(),
        after: cursorOf(2),
        changed: 1,
        unnamed: 1,
        isFinal: false,
        endedAt: expect.any(String),
      },
    });
  });

  test("keeps every name it found on the request before anything in ClickHouse changes, and reads the findings by them (#11044)", async () => {
    await SecurityUserErasure.processRequest({
      request: request({ userToErase: "Alice@Example.com" }),
      now: at(STARTED_AT),
    });

    const everyName: Array<string> = [
      `Alice@Example.com -> ${tokenOf("Alice@Example.com")}`,
      `${ALICE} -> ${tokenOf(ALICE)}`,
      `auth0|${ALICE} -> auth0|${tokenOf(ALICE)}`,
    ].sort();

    const firstKept: number = world.calls.findIndex((call: string): boolean => {
      return call.startsWith("inProgress");
    });

    expect(world.keptNames).toHaveLength(1);
    expect(describeNames(world.keptNames[0]!)).toEqual(everyName);
    expect(firstKept).toBeGreaterThan(-1);
    expect(firstKept).toBeLessThan(world.calls.indexOf("unnameEvents"));
    expect(firstKept).toBeLessThan(world.calls.indexOf("eraseVault"));
    expect(firstKept).toBeLessThan(world.calls.indexOf("scan from 0"));
    expect(describeNames(world.findingNames[0]!)).toEqual(everyName);
  });

  test("hands Postgres every name the vault knew them by, each once, with what the rule left", async () => {
    await SecurityUserErasure.processRequest({
      request: request({ userToErase: "  Alice@Example.com " }),
      now: at(STARTED_AT),
    });

    expect(describeNames(world.names[0]!)).toEqual(
      [
        `Alice@Example.com -> ${tokenOf("Alice@Example.com")}`,
        `${ALICE} -> ${tokenOf(ALICE)}`,
        `auth0|${ALICE} -> auth0|${tokenOf(ALICE)}`,
      ].sort(),
    );
  });

  test("a pasted token: nothing typed to name, the vault and the events name them", async () => {
    await SecurityUserErasure.processRequest({
      request: request({ userToErase: undefined }),
      now: at(STARTED_AT),
    });

    expect(
      world.names[0]!.map((name: ErasedName): string => {
        return name.named;
      }),
    ).toEqual([ALICE, `auth0|${ALICE}`]);
  });

  test("a pasted token nobody was named by: nothing to look for, no finding read, and done as soon as ClickHouse is", async () => {
    world.vaultRows = 0;
    world.namedEvents = 0;

    await SecurityUserErasure.processRequest({
      request: request({ userToErase: undefined }),
      now: at(STARTED_AT),
    });

    expect(world.calls.some((call: string): boolean => {
      return call.startsWith("scan");
    })).toBe(false);
    expect(world.calls[world.calls.length - 1]).toMatch(/^completed /);
  });

  test("claimed by another worker first: this one does nothing", async () => {
    world.claimed = false;

    await SecurityUserErasure.processRequest({
      request: request(),
      now: at(STARTED_AT),
    });

    expect(world.calls).toEqual(["claim"]);
  });
});

describe("a project with more findings than one run reads (#11160)", () => {
  test("is read over several runs, each on from where the last one stopped, never failing for its size", async () => {
    // 2,000 findings, every 7th about the person, 300 read a run.
    world.findings = findingsWorld(2000, 7);
    world.findings.perRun = 300;

    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });

    // The vault and the events are done a minute later.
    world.vaultRows = 0;
    world.namedEvents = 0;

    let now: number = STARTED_AT;

    for (let run: number = 0; run < 6; run++) {
      now += MINUTE;
      await runAt(model, now);
    }

    // Each run started where the last one stopped: 0, 300, 600 ... 1800.
    expect(world.findings.reads.map(indexOf)).toEqual([
      0, 300, 600, 900, 1200, 1500, 1800,
    ]);
    expect(world.progress?.findings?.endedAt).toBeTruthy();
    expect(world.progress?.findings?.number).toBe(1);
    expect(world.findings.naming.some(Boolean)).toBe(false);
    expect(world.calls.some((call: string): boolean => {
      return call.startsWith("attemptFailed") || call.startsWith("failed");
    })).toBe(false);
    // Never Erased off the first pass, which started before nothing named them.
    expect(world.calls.some((call: string): boolean => {
      return call.startsWith("completed");
    })).toBe(false);
  });

  test("is Erased once a final pass, started after the settle, reads every finding and changes none", async () => {
    world.findings = findingsWorld(900, 5);
    world.findings.perRun = 400;

    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });

    world.vaultRows = 0;
    world.namedEvents = 0;

    // The first pass ends; the vault and events have been clean since STARTED_AT + 1 minute.
    await runAt(model, STARTED_AT + MINUTE);
    await runAt(model, STARTED_AT + 2 * MINUTE);

    const cleanSince: number = STARTED_AT + MINUTE;

    expect(world.progress?.cleanSince).toBe(at(cleanSince).toISOString());
    expect(world.progress?.findings?.endedAt).toBeTruthy();

    // Too soon for a final check: nothing is read.
    const readsBefore: number = world.findings.reads.length;

    await runAt(model, cleanSince + DETECTION_TURN_SETTLE_MS - 1);
    expect(world.findings.reads).toHaveLength(readsBefore);

    // The final pass, over three runs.
    await runAt(model, cleanSince + DETECTION_TURN_SETTLE_MS);
    expect(world.progress?.findings).toEqual(
      expect.objectContaining({ number: 2, isFinal: true, endedAt: null }),
    );
    await runAt(model, cleanSince + DETECTION_TURN_SETTLE_MS + MINUTE);
    expect(world.calls[world.calls.length - 1]).not.toMatch(/^completed/);
    await runAt(model, cleanSince + DETECTION_TURN_SETTLE_MS + 2 * MINUTE);

    expect(world.calls[world.calls.length - 1]).toBe(
      `completed ${JSON.stringify({
        vaultEntriesDeleted: 0,
        // Two events, and the 180 findings the first pass un-named.
        eventsUnnamed: 2 + 180,
        casesUnnamed: 2,
        proposalsWithdrawn: 1,
      })}`,
    );
    expect(world.findings.reads.slice(-3).map(indexOf)).toEqual([0, 400, 800]);
  });

  test("a final pass that still finds something changes it, and another checks again: Erased only after one that finds nothing", async () => {
    world.findings = findingsWorld(10, 2);
    // ClickHouse applies a change a run after it holds it.
    world.findings.applyLag = true;

    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });

    world.vaultRows = 0;
    world.namedEvents = 0;
    // A finding a rule wrote from the events before they lost the name, after the first pass read past it.
    world.findings.naming.push(true);

    await runAt(model, STARTED_AT + MINUTE);

    const settled: number = STARTED_AT + MINUTE + DETECTION_TURN_SETTLE_MS;

    await runAt(model, settled);
    expect(world.progress?.findings).toEqual(
      expect.objectContaining({ number: 2, isFinal: true, changed: 1 }),
    );
    expect(world.calls[world.calls.length - 1]).not.toMatch(/^completed/);

    await runAt(model, settled + MINUTE);
    expect(world.progress?.findings).toEqual(
      expect.objectContaining({ number: 3, isFinal: true, changed: 0 }),
    );
    expect(world.calls[world.calls.length - 1]).toMatch(/^completed /);
  });

  test("keeps its counts across passes as the most one counted, never their sum", async () => {
    world.findings = findingsWorld(10, 2);
    world.findings.applyLag = true;

    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });

    world.vaultRows = 0;
    world.namedEvents = 0;

    const settled: number = STARTED_AT + MINUTE + DETECTION_TURN_SETTLE_MS;

    await runAt(model, STARTED_AT + MINUTE);
    await runAt(model, settled);
    await runAt(model, settled + MINUTE);

    // Two events, and five findings: the second pass queued none of them again.
    expect(world.eventsUnnamed).toBe(2 + 5);
  });

  test("a run that fails keeps where its read got to: the retry goes on from there", async () => {
    world.findings = findingsWorld(1000, 4);
    world.findings.perRun = 250;

    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });
    await runAt(model, STARTED_AT + MINUTE);

    world.scanError = new Error("ClickHouse is away");
    await runAt(model, STARTED_AT + 2 * MINUTE);
    expect(world.calls[world.calls.length - 1]).toBe(
      "attemptFailed 1 InProgress ClickHouse is away",
    );

    world.scanError = null;
    // Its backoff over, the request is told again and reads on from 500.
    await runAt(model, STARTED_AT + 2 * MINUTE + RETRY_BACKOFF_MS, {
      attempts: 1,
      failureReason: "ClickHouse is away",
      updatedAt: at(STARTED_AT + 2 * MINUTE),
    });

    expect(world.findings.reads.map(indexOf)).toEqual([0, 250, 500, 500]);
    expect(world.calls).toContain("unnameEvents");
  });

  test("a run that runs out of its time stops in the read, counts no attempt, and the next run goes on", async () => {
    world.findings = findingsWorld(600, 3);
    world.findings.perRun = 200;

    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });

    const deadline: JobDeadline = new JobDeadline();

    world.scanError = Object.assign(new Error("out of time"), {});
    deadline.end();

    await SecurityUserErasure.processRequest({
      request: kept(model),
      now: at(STARTED_AT + MINUTE),
      deadline,
    });

    expect(world.calls.some((call: string): boolean => {
      return call.startsWith("attemptFailed");
    })).toBe(false);

    world.scanError = null;
    await runAt(model, STARTED_AT + 2 * MINUTE);
    expect(world.findings.reads.map(indexOf)).toEqual([0, 200, 200]);
  });

  test("hands Postgres the correlations' values each batch changed, for what else carries their fingerprint", async () => {
    await SecurityUserErasure.processRequest({
      request: request(),
      now: at(STARTED_AT),
    });

    expect(world.rewrittenFingerprints).toEqual([
      [
        {
          named: `${ALICE} / 203.0.113.7`,
          hashed: `${tokenOf(ALICE)} / 203.0.113.7`,
        },
      ],
    ]);
  });
});

describe("an InProgress request", () => {
  test("is not Erased while the vault or the events still name the person, and starts no new pass", async () => {
    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });

    const reads: number = world.findings.reads.length;

    for (let minute: number = 1; minute < 20; minute++) {
      await runAt(model, STARTED_AT + minute * MINUTE);
    }

    expect(world.findings.reads).toHaveLength(reads);
    expect(world.calls.some((call: string): boolean => {
      return call.startsWith("completed");
    })).toBe(false);
  });

  test("still named a while after ClickHouse was told: told again, its counts never added twice", async () => {
    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });

    world.calls = [];
    await runAt(model, STARTED_AT + RESUBMIT_AFTER_MS - 1);
    expect(world.calls).not.toContain("unnameEvents");

    await runAt(model, STARTED_AT + RESUBMIT_AFTER_MS);
    expect(world.calls).toContain("unnameEvents");
    expect(world.calls).toContain("eraseVault");
    // The larger count of two tells, never their sum.
    expect(world.progress?.namedEvents).toBe(2);
    expect(world.progress?.toldAt).toBe(
      at(STARTED_AT + RESUBMIT_AFTER_MS).toISOString(),
    );
  });

  test("one started before #11160 kept no progress: it was told when it last ran, and its read starts from the first finding", async () => {
    world.vaultRows = 0;
    world.namedEvents = 0;

    await SecurityUserErasure.processRequest({
      request: request({
        status: SecurityUserErasureRequestStatus.InProgress,
        updatedAt: at(STARTED_AT),
        namesToErase: toStoredErasureNames([
          { named: ALICE, hashed: tokenOf(ALICE) },
        ]),
      }),
      now: at(STARTED_AT + MINUTE),
    });

    expect(world.calls).not.toContain("unnameEvents");
    expect(world.calls).toContain("scan from 0");
    expect(world.progress?.findings?.number).toBe(1);
  });

  test("its last pass over Postgres, as it completes, goes through the names it kept", async () => {
    world.findings = findingsWorld(3, 0);

    const model: SecurityUserErasureRequest = request();

    await SecurityUserErasure.processRequest({
      request: model,
      now: at(STARTED_AT),
    });

    world.vaultRows = 0;
    world.namedEvents = 0;
    world.names = [];

    await runAt(model, STARTED_AT + MINUTE);
    await runAt(model, STARTED_AT + MINUTE + DETECTION_TURN_SETTLE_MS);

    expect(world.calls[world.calls.length - 1]).toMatch(/^completed /);
    expect(describeNames(world.names[world.names.length - 1]!)).toEqual(
      [
        `${ALICE} -> ${tokenOf(ALICE)}`,
        `auth0|${ALICE} -> auth0|${tokenOf(ALICE)}`,
      ].sort(),
    );
  });

  test("whose last run failed: run again once its backoff is over, never Completed before", async () => {
    world.vaultRows = 0;
    world.namedEvents = 0;

    const failed: Partial<Record<string, unknown>> = {
      status: SecurityUserErasureRequestStatus.InProgress,
      attempts: 2,
      failureReason: "ClickHouse is away",
      updatedAt: at(STARTED_AT),
    };

    await SecurityUserErasure.processRequest({
      request: request(failed),
      now: at(STARTED_AT + 2 * RETRY_BACKOFF_MS - 1),
    });
    expect(world.calls).toEqual([]);

    await SecurityUserErasure.processRequest({
      request: request(failed),
      now: at(STARTED_AT + 2 * RETRY_BACKOFF_MS),
    });
    expect(world.calls).toContain("unnameRecords");
    expect(world.calls).toContain("unnameEvents");
  });
});

describe("a run that fails", () => {
  test("is retried while attempts remain, why it failed kept on the request", async () => {
    world.scanError = new Error("ClickHouse is away");

    await SecurityUserErasure.processRequest({
      request: request(),
      now: at(STARTED_AT),
    });

    expect(world.calls[world.calls.length - 1]).toBe(
      "attemptFailed 1 InProgress ClickHouse is away",
    );
    expect(world.emailed).toBe(0);
  });

  test("on its last attempt, the request fails and the project's owners are told", async () => {
    world.scanError = new Error("ClickHouse is away");

    await SecurityUserErasure.processRequest({
      request: request({
        status: SecurityUserErasureRequestStatus.InProgress,
        attempts: MAX_ERASURE_ATTEMPTS - 1,
        failureReason: "ClickHouse is away",
        updatedAt: at(0),
      }),
      now: at(STARTED_AT + MAX_ERASURE_ATTEMPTS * RETRY_BACKOFF_MS),
    });

    expect(world.calls[world.calls.length - 1]).toBe(
      `failed ${MAX_ERASURE_ATTEMPTS}`,
    );
    expect(world.emailed).toBe(1);
  });

  test("an email that cannot be sent, or a failure that cannot be kept, never throws", async () => {
    world.scanError = new Error("ClickHouse is away");
    jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockRejectedValue(new Error("no mail"));

    await expect(
      SecurityUserErasure.processRequest({
        request: request({
          status: SecurityUserErasureRequestStatus.InProgress,
          attempts: MAX_ERASURE_ATTEMPTS - 1,
          failureReason: "x",
          updatedAt: at(0),
        }),
        now: at(STARTED_AT + MAX_ERASURE_ATTEMPTS * RETRY_BACKOFF_MS),
      }),
    ).resolves.toBeUndefined();

    jest
      .spyOn(SecurityUserErasureRequestService, "markAttemptFailed")
      .mockRejectedValue(new Error("no database"));

    await expect(
      SecurityUserErasure.processRequest({
        request: request(),
        now: at(STARTED_AT),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("a run that runs out of its time", () => {
  test("stops between requests: the rest wait for the next run", async () => {
    const deadline: JobDeadline = new JobDeadline();
    const first: SecurityUserErasureRequest = request();
    const second: SecurityUserErasureRequest = request();
    const order: Array<string> = [];

    jest
      .spyOn(SecurityUserErasureRequestService, "getOpenRequests")
      .mockResolvedValue([first, second]);
    jest
      .spyOn(SecurityUserErasure, "processRequest")
      .mockImplementation(
        async (data: {
          request: SecurityUserErasureRequest;
        }): Promise<void> => {
          order.push(data.request.id!.toString());
          deadline.end();
        },
      );

    await SecurityUserErasure.processOpenRequests(at(STARTED_AT), deadline);

    expect(order).toEqual([first.id!.toString()]);
  });
});

describe("whether a final check may start", () => {
  const progress: SecurityUserErasureProgress = readErasureProgress({
    cleanSince: at(STARTED_AT).toISOString(),
  });

  test("only once nothing has named the person for the settle", () => {
    expect(
      SecurityUserErasure.canStartFinalPass({
        progress,
        isClean: true,
        now: at(STARTED_AT + DETECTION_TURN_SETTLE_MS),
      }),
    ).toBe(true);
    expect(
      SecurityUserErasure.canStartFinalPass({
        progress,
        isClean: true,
        now: at(STARTED_AT + DETECTION_TURN_SETTLE_MS - 1),
      }),
    ).toBe(false);
    expect(
      SecurityUserErasure.canStartFinalPass({
        progress,
        isClean: false,
        now: at(STARTED_AT + DETECTION_TURN_SETTLE_MS),
      }),
    ).toBe(false);
    expect(
      SecurityUserErasure.canStartFinalPass({
        progress: readErasureProgress(null),
        isClean: true,
        now: at(STARTED_AT + DETECTION_TURN_SETTLE_MS),
      }),
    ).toBe(false);
  });
});

describe("the names a request goes on looking for (#11044)", () => {
  test("each spelling typed, with its own token, and every name a run kept - each once", () => {
    const keptNames: Array<ErasedName> = [
      { named: ALICE, hashed: tokenOf(ALICE) },
      { named: `auth0|${ALICE}`, hashed: `auth0|${tokenOf(ALICE)}` },
    ];

    expect(
      describeNames(
        SecurityUserErasure.getKeptNames(
          request({
            userToErase: "Alice@Example.com",
            namesToErase: toStoredErasureNames(keptNames),
          }),
        ),
      ),
    ).toEqual(
      [
        `Alice@Example.com -> ${tokenOf("Alice@Example.com")}`,
        `${ALICE} -> ${tokenOf(ALICE)}`,
        `auth0|${ALICE} -> auth0|${tokenOf(ALICE)}`,
      ].sort(),
    );
  });

  test("nothing typed and nothing kept: none", () => {
    expect(
      SecurityUserErasure.getKeptNames(request({ userToErase: undefined })),
    ).toEqual([]);
  });

  test("what the column holds that is no name is never looked for", () => {
    for (const stored of [
      "not json",
      "{}",
      JSON.stringify([{ named: ALICE }]),
      JSON.stringify([{ named: ALICE, hashed: ALICE }]),
      JSON.stringify([{ named: 1, hashed: tokenOf(ALICE) }]),
      JSON.stringify([null]),
    ]) {
      expect(
        SecurityUserErasure.getKeptNames(
          request({ userToErase: undefined, namesToErase: stored }),
        ),
      ).toEqual([]);
    }
  });
});

describe("what the worker leaves alone", () => {
  test("a request over already, or one with no id or project", async () => {
    for (const status of [
      SecurityUserErasureRequestStatus.Completed,
      SecurityUserErasureRequestStatus.Failed,
    ]) {
      await SecurityUserErasure.processRequest({
        request: request({ status }),
        now: at(STARTED_AT + RESUBMIT_AFTER_MS),
      });
    }

    const noId: SecurityUserErasureRequest = new SecurityUserErasureRequest();

    noId.projectId = PROJECT_ID;
    noId.tokens = [tokenOf(ALICE)];
    noId.status = SecurityUserErasureRequestStatus.Pending;
    noId.requestedAt = FILED_AT;

    const noProject: SecurityUserErasureRequest = request();

    noProject.projectId = undefined as unknown as ObjectID;

    for (const unsaved of [noId, noProject]) {
      await SecurityUserErasure.processRequest({
        request: unsaved,
        now: at(STARTED_AT),
      });
    }

    expect(world.calls).toEqual([]);
  });

  test("a request with no token of today's form has nothing left in the vault or the events", async () => {
    expect(
      await SecurityUserErasure.isVaultAndEventsClean(
        request({ tokens: ["alice"] }),
      ),
    ).toBe(true);
  });

  test("processes every open request a run reads, oldest first", async () => {
    const order: Array<string> = [];
    const first: SecurityUserErasureRequest = request();
    const second: SecurityUserErasureRequest = request();

    jest
      .spyOn(SecurityUserErasureRequestService, "getOpenRequests")
      .mockResolvedValue([first, second]);
    jest
      .spyOn(SecurityUserErasure, "processRequest")
      .mockImplementation(
        async (data: {
          request: SecurityUserErasureRequest;
        }): Promise<void> => {
          order.push(data.request.id!.toString());
        },
      );

    await SecurityUserErasure.processOpenRequests(at(STARTED_AT));

    expect(order).toEqual([first.id!.toString(), second.id!.toString()]);
  });
});
