import SecurityUserErasureRequest from "../../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityUserErasureRequestService, {
  SecurityUserErasureCounts,
} from "../../../../../Server/Services/SecurityUserErasureRequestService";
import SecurityUserVaultService from "../../../../../Server/Services/SecurityUserVaultService";
import SecurityUserErasure, {
  MAX_ERASURE_ATTEMPTS,
  RESUBMIT_AFTER_MS,
  RETRY_BACKOFF_MS,
  SUPPRESSION_SETTLE_MS,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasure";
import SecurityUserErasureEvents from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureEvents";
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
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000d1",
);
const FILED_AT: Date = new Date("2026-11-24T10:00:00.000Z");

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

const ALICE: string = "alice@example.com";

interface World {
  vaultRows: number;
  namedEvents: number;
  claimed: boolean;
  calls: Array<string>;
  names: Array<Array<ErasedName>>;
  emailed: number;
}

let world: World;

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

function at(milliseconds: number): Date {
  return new Date(FILED_AT.getTime() + milliseconds);
}

beforeEach(() => {
  world = {
    vaultRows: 1,
    namedEvents: 2,
    claimed: true,
    calls: [],
    names: [],
    emailed: 0,
  };

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
      async (data: { counts: SecurityUserErasureCounts }): Promise<void> => {
        world.calls.push(`inProgress ${JSON.stringify(data.counts)}`);
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
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockImplementation(async (): Promise<void> => {
      world.emailed++;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Pending request", () => {
  test("waits until every process refuses its tokens", async () => {
    await SecurityUserErasure.processRequest({
      request: request(),
      now: at(SUPPRESSION_SETTLE_MS - 1),
    });

    expect(world.calls).toEqual([]);
  });

  test("is claimed, then Postgres first and ClickHouse after, its counts kept at each step", async () => {
    await SecurityUserErasure.processRequest({
      request: request(),
      now: at(SUPPRESSION_SETTLE_MS),
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
    ]);
  });

  test("hands Postgres every name the vault knew them by, each once, with what the rule left", async () => {
    await SecurityUserErasure.processRequest({
      request: request({ userToErase: "  Alice@Example.com " }),
      now: at(SUPPRESSION_SETTLE_MS),
    });

    expect(
      world.names[0]!.map((name: ErasedName): string => {
        return `${name.named} -> ${name.hashed}`;
      }).sort(),
    ).toEqual(
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
      now: at(SUPPRESSION_SETTLE_MS),
    });

    expect(
      world.names[0]!.map((name: ErasedName): string => {
        return name.named;
      }),
    ).toEqual([ALICE, `auth0|${ALICE}`]);
  });

  test("claimed by another worker first: this one does nothing", async () => {
    world.claimed = false;

    await SecurityUserErasure.processRequest({
      request: request(),
      now: at(SUPPRESSION_SETTLE_MS),
    });

    expect(world.calls).toEqual(["claim"]);
  });
});

describe("an InProgress request", () => {
  const started: Partial<Record<string, unknown>> = {
    status: SecurityUserErasureRequestStatus.InProgress,
    vaultEntriesDeleted: 1,
    eventsUnnamed: 2,
    casesUnnamed: 2,
    proposalsWithdrawn: 1,
  };

  test("is Completed once nothing in ClickHouse names the person, with the counts it showed", async () => {
    world.vaultRows = 0;
    world.namedEvents = 0;

    await SecurityUserErasure.processRequest({
      request: request(started),
      now: at(SUPPRESSION_SETTLE_MS + 60000),
    });

    expect(world.calls).toEqual([
      `completed ${JSON.stringify({
        vaultEntriesDeleted: 1,
        eventsUnnamed: 2,
        casesUnnamed: 2,
        proposalsWithdrawn: 1,
      })}`,
    ]);
  });

  test("still named, and not long since it ran: waits for ClickHouse", async () => {
    await SecurityUserErasure.processRequest({
      request: request({ ...started, updatedAt: at(SUPPRESSION_SETTLE_MS) }),
      now: at(SUPPRESSION_SETTLE_MS + RESUBMIT_AFTER_MS - 1),
    });

    expect(world.calls).toEqual([]);
  });

  test("still named after a long wait: told again, its counts never added twice", async () => {
    // Postgres was done the first time: nothing more names the person there.
    jest
      .spyOn(SecurityUserErasureRecords, "unnameRecords")
      .mockResolvedValue({ cases: 0, proposals: 0 });

    await SecurityUserErasure.processRequest({
      request: request({ ...started, updatedAt: at(SUPPRESSION_SETTLE_MS) }),
      now: at(SUPPRESSION_SETTLE_MS + RESUBMIT_AFTER_MS),
    });

    expect(world.calls).toContain("unnameEvents");
    expect(world.calls).toContain("eraseVault");
    // What is still there is counted again, and the larger kept: never the sum.
    expect(world.calls[world.calls.length - 1]).toBe(
      `inProgress ${JSON.stringify({
        vaultEntriesDeleted: 1,
        eventsUnnamed: 2,
        casesUnnamed: 2,
        proposalsWithdrawn: 1,
      })}`,
    );
  });

  test("whose last run failed: run again once its backoff is over, never Completed before", async () => {
    world.vaultRows = 0;
    world.namedEvents = 0;

    const failed: SecurityUserErasureRequest = request({
      ...started,
      attempts: 2,
      failureReason: "ClickHouse is down",
      updatedAt: at(SUPPRESSION_SETTLE_MS),
    });

    await SecurityUserErasure.processRequest({
      request: failed,
      now: at(SUPPRESSION_SETTLE_MS + 2 * RETRY_BACKOFF_MS - 1),
    });
    expect(world.calls).toEqual([]);

    await SecurityUserErasure.processRequest({
      request: failed,
      now: at(SUPPRESSION_SETTLE_MS + 2 * RETRY_BACKOFF_MS),
    });
    expect(world.calls).toContain("unnameRecords");
    expect(
      world.calls.some((call: string): boolean => {
        return call.startsWith("completed");
      }),
    ).toBe(false);
  });
});

describe("a run that fails", () => {
  test("is retried while attempts remain, why it failed kept on the request", async () => {
    jest
      .spyOn(SecurityUserErasureEvents, "countNamedEvents")
      .mockRejectedValue(new Error("ClickHouse is down") as never);

    await SecurityUserErasure.processRequest({
      request: request({ attempts: 1 }),
      now: at(SUPPRESSION_SETTLE_MS),
    });

    expect(world.calls[world.calls.length - 1]).toBe(
      `attemptFailed 2 ${SecurityUserErasureRequestStatus.InProgress} ClickHouse is down`,
    );
    expect(world.emailed).toBe(0);
  });

  test("on its last attempt, the request fails and the project's owners are told", async () => {
    jest
      .spyOn(SecurityUserErasureRecords, "unnameRecords")
      .mockRejectedValue(new Error("Postgres is down") as never);

    await SecurityUserErasure.processRequest({
      request: request({ attempts: MAX_ERASURE_ATTEMPTS - 1 }),
      now: at(SUPPRESSION_SETTLE_MS),
    });

    expect(world.calls[world.calls.length - 1]).toBe(
      `failed ${MAX_ERASURE_ATTEMPTS}`,
    );
    expect(world.emailed).toBe(1);
  });

  test("an email that cannot be sent, or a failure that cannot be kept, never throws", async () => {
    jest
      .spyOn(SecurityUserErasureRecords, "unnameRecords")
      .mockRejectedValue(new Error("Postgres is down") as never);
    jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockRejectedValue(new Error("No mail server") as never);

    await expect(
      SecurityUserErasure.processRequest({
        request: request({ attempts: MAX_ERASURE_ATTEMPTS - 1 }),
        now: at(SUPPRESSION_SETTLE_MS),
      }),
    ).resolves.toBeUndefined();

    jest
      .spyOn(SecurityUserErasureRequestService, "markAttemptFailed")
      .mockRejectedValue(new Error("Postgres is down") as never);

    await expect(
      SecurityUserErasure.processRequest({
        request: request({ attempts: 0 }),
        now: at(SUPPRESSION_SETTLE_MS),
      }),
    ).resolves.toBeUndefined();
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
        now: at(SUPPRESSION_SETTLE_MS + RESUBMIT_AFTER_MS),
      });
    }

    // Never saved: no id. And one that names no project.
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
        now: at(SUPPRESSION_SETTLE_MS),
      });
    }

    expect(world.calls).toEqual([]);
  });

  test("a request with no token of today's form is erased as soon as it is checked", async () => {
    expect(
      await SecurityUserErasure.isErased(request({ tokens: ["alice"] })),
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

    await SecurityUserErasure.processOpenRequests(at(SUPPRESSION_SETTLE_MS));

    expect(order).toEqual([first.id!.toString(), second.id!.toString()]);
  });
});
