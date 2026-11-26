jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
      getRedisOptions: jest.fn().mockReturnValue({}),
    },
  };
});

/*
 * REDIS, AS BULLMQ KEEPS A QUEUE'S JOBS IN IT - shared by every "process"
 * of this suite, so a server that stops and one that starts after it see
 * the same jobs, as two pods of one installation do. Only what the Worker
 * queue's one-off jobs use is here, and as BullMQ does it: a job is kept
 * by its id, and adding an id that is still kept adds nothing; it is
 * removed when done only when its options say so. The real Queue.addJob
 * runs on top of it, so these tests read what it hands BullMQ.
 */
interface MockStoredJob {
  name: string;
  // As Redis holds it: written out, and read back.
  data: Record<string, unknown>;
  opts: Record<string, unknown>;
  attemptsMade: number;
  // When it may run, on the suite's clock.
  availableAt: number;
  state: "waiting" | "completed" | "failed";
  addedAs: number;
}

const mockRedisJobs: Map<string, MockStoredJob> = new Map<
  string,
  MockStoredJob
>();
const mockAdds: Array<{
  name: string;
  data: Record<string, unknown>;
  opts: Record<string, unknown>;
}> = [];
const mockQueueState: {
  now: number;
  addCount: number;
  // An add that throws, or that never answers: Redis down.
  failAdds: boolean;
  hangAdds: boolean;
} = { now: 0, addCount: 0, failAdds: false, hangAdds: false };

jest.mock("bullmq", () => {
  class MockQueue {
    public client: Promise<{ on: () => void }> = Promise.resolve({
      on: (): void => {},
    });

    public async add(
      name: string,
      data: Record<string, unknown>,
      opts: Record<string, unknown>,
    ): Promise<{ id: string }> {
      if (mockQueueState.hangAdds) {
        return await new Promise<never>((): void => {});
      }

      if (mockQueueState.failAdds) {
        throw new Error("Redis connection lost");
      }

      mockAdds.push({ name, data, opts });

      const id: string = String(opts["jobId"]);

      // BullMQ keeps the job it has, whatever its state, until it is removed.
      if (!mockRedisJobs.has(id)) {
        mockRedisJobs.set(id, {
          name: name,
          data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
          opts: opts,
          attemptsMade: 0,
          availableAt: mockQueueState.now,
          state: "waiting",
          addedAs: mockQueueState.addCount++,
        });
      }

      return { id: id };
    }

    public async getJob(): Promise<undefined> {
      return undefined;
    }

    public async clean(): Promise<Array<string>> {
      return [];
    }

    public async getRepeatableJobs(): Promise<Array<unknown>> {
      return [];
    }

    public async removeRepeatableByKey(): Promise<boolean> {
      return true;
    }
  }

  return {
    __esModule: true,
    Queue: MockQueue,
    Worker: class {},
    QueueEvents: class {},
    Job: class {},
    DelayedError: class extends Error {},
    UnrecoverableError: class extends Error {},
  };
});

import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { QueueName } from "../../../Server/Infrastructure/Queue";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import SignInSettingsClearedEmail, {
  EMAIL_ENQUEUE_TIMEOUT_IN_MS,
  EMAIL_HAND_OFF_TIMEOUT_IN_MS,
  EMAIL_JOB_ATTEMPTS,
  EMAIL_JOB_BACKOFF_IN_MS,
  EMAIL_JOB_PRIORITY,
  EMAIL_SENT_CACHE_NAMESPACE,
  EMAIL_SENT_WINDOW_IN_SECONDS,
  SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB,
  SignInSettingsClearedEmailEvent,
} from "../../../Server/Utils/SignInSettingsClearedEmail";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import {
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "../../../Types/SSO/LocalSignInClearing";
import { SignInSettingsClearedBy } from "../../../Types/SSO/SignInSettingsClearedEmail";
import { SignInManagement } from "../../../Types/SSO/SsoManagedSignIn";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import path from "path";

/*
 * EMAILING THE PEOPLE WHOSE SIGN-IN SETTINGS WERE CLEARED, FROM A DURABLE
 * JOB (#9818, #9820, #9991).
 *
 * A clear cannot be undone, so its person is told - and only its person, at
 * the address on their account, in their language. The email used to wait
 * in the memory of the server that cleared: a restart in the middle of a
 * bulk clear lost the emails not yet sent. Now each is a job on the Worker
 * queue, which a worker sends:
 *
 *   - queued: one job per person whose clear removed something, carrying
 *     ids, the clearer's role, when and what was removed - nothing else of
 *     the person - with a limit on attempts and a backoff between them; the
 *     clear waits for the queue a few milliseconds at most, and never fails
 *     with it;
 *   - sent: to the address the account has when it runs, in its language
 *     and time zone, naming the project by its name then;
 *   - tried again: a failed or refused send, EMAIL_JOB_ATTEMPTS times in
 *     all, waiting longer each time, then given up, logged by the person's
 *     id and never their address;
 *   - kept through a restart: a job still waiting when its server stops is
 *     sent by a worker that starts after;
 *   - sent once: the same email queued twice, or run again after it went,
 *     is one send.
 *
 * The queue is BullMQ's, stood in by Redis as it keeps the jobs (above),
 * under the real Queue.addJob. The worker runs each job as the Workers'
 * job does (App/FeatureSet/Workers/Jobs/SignInSettings/SendClearedEmail):
 * runJob, with the attempt BullMQ is on.
 */

const COMMON_ROOT: string = path.join(__dirname, "../../..");

const ALICE_ID: ObjectID = new ObjectID("aa000000-0000-4000-8000-00000000000a");
const BOB_ID: ObjectID = new ObjectID("bb000000-0000-4000-8000-00000000000b");
const PROJECT_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-0000000000cc",
);

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  hasPasswordResetLink: false,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 1,
  passkeyAndSecurityKeyCount: 2,
  backupCodeCount: 10,
};

const CLEARED_AT: Date = new Date("2026-11-22T09:30:00.000Z");

interface StoredAccount {
  email: string | null;
  language?: string | undefined;
  timezone?: Timezone | undefined;
}

// The database and the mail service, as every process of the suite reads them.
let accounts: Map<string, StoredAccount>;
let projects: Map<string, string>;
let management: Map<string, SignInManagement | Error>;
// The emails the mail service took, whichever process sent them.
let sent: Array<{ mail: EmailMessage; options: Record<string, unknown> }>;
// What the mail service does with the next sends: fail, refuse, or take them.
let mailOutcomes: Array<"fail" | "refuse">;
// Redis's strings, as GlobalCache keeps them: the emails that went.
let cache: Map<string, { value: string; expiresAt: number }>;
let cacheFails: { read: boolean; write: boolean };

const keyOf: (id: ObjectID | string) => string = (
  id: ObjectID | string,
): string => {
  return id.toString().toLowerCase();
};

// The modules a process of the suite runs: the sender, and what it reads.
interface ProcessModules {
  email: typeof SignInSettingsClearedEmail;
  users: typeof UserService;
  projectService: typeof ProjectService;
  mail: typeof MailService;
  ssoManaged: typeof SsoManagedSignIn;
  databaseConfig: typeof DatabaseConfig;
  globalCache: typeof GlobalCache;
  log: typeof logger;
}

let errors: Array<string>;
let infos: Array<string>;

/*
 * Stands the database, the mail service and Redis in for one process's
 * modules, from the suite's shared stores - as every pod of an
 * installation reads one database and one Redis.
 */
const standIn: (modules: ProcessModules) => void = (
  modules: ProcessModules,
): void => {
  getJestSpyOn(modules.users, "findOneById").mockImplementation(
    async (data: { id: ObjectID }): Promise<User | null> => {
      const stored: StoredAccount | undefined = accounts.get(keyOf(data.id));

      if (!stored) {
        return null;
      }

      const user: User = new User();
      user._id = data.id.toString();

      if (stored.email) {
        user.email = new Email(stored.email);
      }

      if (stored.language) {
        user.language = stored.language;
      }

      if (stored.timezone) {
        user.timezone = stored.timezone;
      }

      return user;
    },
  );

  getJestSpyOn(modules.projectService, "findOneById").mockImplementation(
    async (data: { id: ObjectID }): Promise<Project | null> => {
      const name: string | undefined = projects.get(keyOf(data.id));

      if (name === undefined) {
        return null;
      }

      const project: Project = new Project();
      project._id = data.id.toString();
      project.name = name;
      return project;
    },
  );

  getJestSpyOn(modules.ssoManaged, "getSignInManagement").mockImplementation(
    async (userId: ObjectID): Promise<SignInManagement> => {
      const answer: SignInManagement | Error | undefined = management.get(
        keyOf(userId),
      );

      if (answer instanceof Error) {
        throw answer;
      }

      return (
        answer || {
          isManagedBySso: false,
          ssoProviderNames: [],
          localSignInProjectNames: [],
        }
      );
    },
  );

  getJestSpyOn(modules.databaseConfig, "getHost").mockResolvedValue(
    new Hostname("oneuptime.example.com"),
  );
  getJestSpyOn(modules.databaseConfig, "getHttpProtocol").mockResolvedValue(
    Protocol.HTTPS,
  );

  getJestSpyOn(modules.mail, "sendMail").mockImplementation(
    async (
      mail: EmailMessage,
      options: Record<string, unknown>,
    ): Promise<unknown> => {
      const outcome: "fail" | "refuse" | undefined = mailOutcomes.shift();

      if (outcome === "fail") {
        throw new Error("mail service down");
      }

      if (outcome === "refuse") {
        return new HTTPErrorResponse(503, { message: "busy" }, {});
      }

      sent.push({ mail: mail, options: options });
      return undefined;
    },
  );

  getJestSpyOn(modules.globalCache, "getString").mockImplementation(
    async (namespace: string, key: string): Promise<string | null> => {
      if (cacheFails.read) {
        throw new Error("Cache is not connected");
      }

      const entry: { value: string; expiresAt: number } | undefined = cache.get(
        `${namespace}-${key}`,
      );

      return entry && entry.expiresAt > mockQueueState.now ? entry.value : null;
    },
  );

  getJestSpyOn(modules.globalCache, "setString").mockImplementation(
    async (
      namespace: string,
      key: string,
      value: string,
      options?: { expiresInSeconds?: number | undefined },
    ): Promise<void> => {
      if (cacheFails.write) {
        throw new Error("Cache is not connected");
      }

      cache.set(`${namespace}-${key}`, {
        value: value,
        expiresAt: mockQueueState.now + (options?.expiresInSeconds || 0) * 1000,
      });
    },
  );

  getJestSpyOn(modules.log, "error").mockImplementation(
    (message: unknown): void => {
      errors.push(String(message));
    },
  );
  getJestSpyOn(modules.log, "info").mockImplementation(
    (message: unknown): void => {
      infos.push(String(message));
    },
  );
};

const THIS_PROCESS: ProcessModules = {
  email: SignInSettingsClearedEmail,
  users: UserService,
  projectService: ProjectService,
  mail: MailService,
  ssoManaged: SsoManagedSignIn,
  databaseConfig: DatabaseConfig,
  globalCache: GlobalCache,
  log: logger,
};

/*
 * Another server of the installation, started after this one stopped: a
 * module registry of its own, so nothing this process kept in memory is
 * there - only the database and Redis, which it shares.
 */
const startAnotherServer: () => ProcessModules = (): ProcessModules => {
  let modules: ProcessModules | null = null;

  jest.isolateModules((): void => {
    const load: <T>(modulePath: string) => T = <T>(modulePath: string): T => {
      return (
        jest.requireActual(path.join(COMMON_ROOT, modulePath)) as {
          default: T;
        }
      ).default;
    };

    modules = {
      email: load<typeof SignInSettingsClearedEmail>(
        "Server/Utils/SignInSettingsClearedEmail",
      ),
      users: load<typeof UserService>("Server/Services/UserService"),
      projectService: load<typeof ProjectService>(
        "Server/Services/ProjectService",
      ),
      mail: load<typeof MailService>("Server/Services/MailService"),
      ssoManaged: load<typeof SsoManagedSignIn>(
        "Server/Utils/SsoManagedSignIn",
      ),
      databaseConfig: load<typeof DatabaseConfig>("Server/DatabaseConfig"),
      globalCache: load<typeof GlobalCache>(
        "Server/Infrastructure/GlobalCache",
      ),
      log: load<typeof logger>("Server/Utils/Logger"),
    };
  });

  standIn(modules!);

  return modules!;
};

// One run of a job by a worker: which job, which attempt, when, and how it ended.
interface WorkerRun {
  jobId: string;
  attempt: number;
  at: number;
  outcome: "done" | "retry" | "failed";
}

/*
 * A worker of a process: takes the jobs that are due, one at a time, in
 * the order BullMQ gives them (no priority first, then by priority, then
 * oldest), runs each as the Workers' job does - runJob, with the attempt it
 * is on - and does what BullMQ does with the outcome: a throw is tried
 * again after the exponential backoff its options name, until its attempts
 * are spent; a job done or failed is removed when its options say so. When
 * nothing is due, the suite's clock moves on to the next job that will be.
 */
const runWorker: (
  modules: ProcessModules,
) => Promise<Array<WorkerRun>> = async (
  modules: ProcessModules,
): Promise<Array<WorkerRun>> => {
  const runs: Array<WorkerRun> = [];

  for (let step: number = 0; step < 10000; step++) {
    const waiting: Array<[string, MockStoredJob]> = Array.from(
      mockRedisJobs.entries(),
    ).filter(([, job]: [string, MockStoredJob]): boolean => {
      return job.state === "waiting";
    });

    if (waiting.length === 0) {
      return runs;
    }

    const due: Array<[string, MockStoredJob]> = waiting
      .filter(([, job]: [string, MockStoredJob]): boolean => {
        return job.availableAt <= mockQueueState.now;
      })
      .sort(
        (
          [, a]: [string, MockStoredJob],
          [, b]: [string, MockStoredJob],
        ): number => {
          return (
            Number(a.opts["priority"] || 0) - Number(b.opts["priority"] || 0) ||
            a.addedAs - b.addedAs
          );
        },
      );

    if (due.length === 0) {
      mockQueueState.now = Math.min(
        ...waiting.map(([, job]: [string, MockStoredJob]): number => {
          return job.availableAt;
        }),
      );
      continue;
    }

    const [jobId, job] = due[0]!;
    const maxAttempts: number = Number(job.opts["attempts"] || 1);
    const attempt: number = job.attemptsMade + 1;

    try {
      await modules.email.runJob(
        JSON.parse(JSON.stringify(job.data)) as Record<string, unknown>,
        { attempt: attempt, maxAttempts: maxAttempts },
      );

      runs.push({
        jobId,
        attempt,
        at: mockQueueState.now,
        outcome: "done",
      });

      job.state = "completed";

      if (job.opts["removeOnComplete"] === true) {
        mockRedisJobs.delete(jobId);
      }
    } catch {
      job.attemptsMade += 1;

      if (job.attemptsMade < maxAttempts) {
        const backoff: { type?: string; delay?: number } =
          (job.opts["backoff"] as { type?: string; delay?: number }) || {};

        job.availableAt =
          mockQueueState.now +
          Math.round(Math.pow(2, job.attemptsMade - 1) * (backoff.delay || 0));

        runs.push({
          jobId,
          attempt,
          at: mockQueueState.now,
          outcome: "retry",
        });
        continue;
      }

      runs.push({
        jobId,
        attempt,
        at: mockQueueState.now,
        outcome: "failed",
      });

      job.state = "failed";

      if (job.opts["removeOnFail"] === true) {
        mockRedisJobs.delete(jobId);
      }
    }
  }

  throw new Error("The worker never ran out of jobs.");
};

const event: (
  userId: ObjectID,
  cleared?: LocalSignInSettings,
) => SignInSettingsClearedEmailEvent = (
  userId: ObjectID,
  cleared?: LocalSignInSettings,
): SignInSettingsClearedEmailEvent => {
  return {
    userId: userId,
    cleared: cleared || EVERYTHING,
    clearedBy: SignInSettingsClearedBy.ServerAdmin,
    clearedAt: CLEARED_AT,
  };
};

const ownerEvent: (userId: ObjectID) => SignInSettingsClearedEmailEvent = (
  userId: ObjectID,
): SignInSettingsClearedEmailEvent => {
  return {
    userId: userId,
    cleared: EVERYTHING,
    clearedBy: SignInSettingsClearedBy.ProjectOwner,
    projectId: PROJECT_ID,
    clearedAt: CLEARED_AT,
  };
};

const varsOf: (index: number) => Dictionary<string> = (
  index: number,
): Dictionary<string> => {
  return sent[index]!.mail.vars as Dictionary<string>;
};

const sentTo: () => Array<string> = (): Array<string> => {
  return sent.map(
    (email: { mail: EmailMessage; options: Record<string, unknown> }) => {
      return email.mail.toEmail.toString();
    },
  );
};

beforeEach(() => {
  mockRedisJobs.clear();
  mockAdds.length = 0;
  mockQueueState.now = 0;
  mockQueueState.addCount = 0;
  mockQueueState.failAdds = false;
  mockQueueState.hangAdds = false;

  accounts = new Map<string, StoredAccount>([
    [keyOf(ALICE_ID), { email: "alice@example.com" }],
    [keyOf(BOB_ID), { email: "bob@example.com" }],
  ]);
  projects = new Map<string, string>([[keyOf(PROJECT_ID), "Acme Production"]]);
  management = new Map<string, SignInManagement | Error>();

  for (const id of [ALICE_ID, BOB_ID]) {
    management.set(keyOf(id), {
      isManagedBySso: true,
      ssoProviderNames: ["Okta"],
      localSignInProjectNames: [],
    });
  }

  sent = [];
  mailOutcomes = [];
  cache = new Map<string, { value: string; expiresAt: number }>();
  cacheFails = { read: false, write: false };
  errors = [];
  infos = [];

  standIn(THIS_PROCESS);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("queuing: a job for each person, for a worker to send", () => {
  test("one job per person whose clear removed something, on the Worker queue - nothing sent by the clear", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);

    expect(mockAdds).toHaveLength(2);
    expect(mockRedisJobs.size).toBe(2);
    expect(sent).toHaveLength(0);

    for (const add of mockAdds) {
      expect(add.name).toBe(SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB);
    }
  });

  test("with a limit on attempts, a backoff that grows, after the queue's own jobs, removed once done", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    const opts: Record<string, unknown> = mockAdds[0]!.opts;

    expect(opts["attempts"]).toBe(EMAIL_JOB_ATTEMPTS);
    expect(opts["backoff"]).toEqual({
      type: "exponential",
      delay: EMAIL_JOB_BACKOFF_IN_MS,
    });
    expect(opts["priority"]).toBe(EMAIL_JOB_PRIORITY);
    expect(opts["removeOnComplete"]).toBe(true);
    expect(opts["removeOnFail"]).toBe(true);
    // A job id BullMQ takes: no ":" in it.
    expect(String(opts["jobId"])).not.toContain(":");
    expect(EMAIL_JOB_ATTEMPTS).toBeGreaterThan(1);
  });

  test("the queue is the Worker queue, which only worker servers run", () => {
    expect(QueueName.Worker).toBe("Worker");
  });

  test("a clear that removed nothing queues nothing; of a batch, only those it removed something from", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, NO_LOCAL_SIGN_IN_SETTINGS),
    ]);
    expect(mockAdds).toHaveLength(0);

    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, NO_LOCAL_SIGN_IN_SETTINGS),
      event(BOB_ID),
    ]);
    expect(mockAdds).toHaveLength(1);
    expect(keyOf(mockAdds[0]!.data["userId"] as string)).toBe(keyOf(BOB_ID));
  });

  test("a reset link alone is something removed, and is queued (#9992)", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, {
        ...NO_LOCAL_SIGN_IN_SETTINGS,
        hasPasswordResetLink: true,
      }),
    ]);

    expect(mockAdds).toHaveLength(1);
  });

  test("nobody to email is nothing", async () => {
    await expect(SignInSettingsClearedEmail.notify([])).resolves.toBe(
      undefined,
    );
    expect(mockAdds).toHaveLength(0);
  });

  test("a job carries ids, the clearer's role, when and what was removed - nothing else of the person", async () => {
    accounts.set(keyOf(ALICE_ID), {
      email: "alice@example.com",
      language: "de",
      timezone: Timezone.AsiaKolkata,
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    const data: Record<string, unknown> = mockRedisJobs.values().next().value!
      .data;

    expect(Object.keys(data).sort()).toEqual(
      ["cleared", "clearedAt", "clearedBy", "userId"].sort(),
    );
    expect(data["userId"]).toBe(ALICE_ID.toString());
    expect(data["clearedBy"]).toBe(SignInSettingsClearedBy.ServerAdmin);
    expect(data["clearedAt"]).toBe(CLEARED_AT.toISOString());
    expect(data["cleared"]).toEqual(EVERYTHING);

    const written: string = JSON.stringify(data);
    expect(written).not.toContain("alice@example.com");
    expect(written).not.toContain("Asia");
    expect(written).not.toContain('"de"');
  });

  test("an owner's clear carries the project's id, never its name", async () => {
    await SignInSettingsClearedEmail.notify([ownerEvent(ALICE_ID)]);

    const data: Record<string, unknown> = mockRedisJobs.values().next().value!
      .data;

    expect(data["clearedBy"]).toBe(SignInSettingsClearedBy.ProjectOwner);
    expect(data["projectId"]).toBe(PROJECT_ID.toString());
    expect(JSON.stringify(data)).not.toContain("Acme Production");
  });

  test("the clear's time goes with the job; left out, it is now", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2026-11-22T11:00:00.000Z"));

    await SignInSettingsClearedEmail.notify([
      { ...event(ALICE_ID), clearedAt: undefined },
    ]);

    expect(mockAdds[0]!.data["clearedAt"]).toBe("2026-11-22T11:00:00.000Z");
  });

  test("never rejects: a queue that refuses is logged by the person's id, never their address", async () => {
    mockQueueState.failAdds = true;

    await expect(
      SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]),
    ).resolves.toBe(undefined);

    const logged: string = errors.join("\n");
    expect(logged).toContain(ALICE_ID.toString());
    expect(logged).toContain(BOB_ID.toString());
    expect(logged).not.toContain("alice@example.com");
  });

  test("a queue that does not answer is waited for EMAIL_ENQUEUE_TIMEOUT_IN_MS, no longer", async () => {
    mockQueueState.hangAdds = true;
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });

    let isDone: boolean = false;
    const queuing: Promise<void> = SignInSettingsClearedEmail.notify([
      event(ALICE_ID),
    ]).then((): void => {
      isDone = true;
    });

    for (
      let step: number = 0;
      step < 1000 && jest.getTimerCount() === 0;
      step++
    ) {
      await Promise.resolve();
    }

    jest.advanceTimersByTime(EMAIL_ENQUEUE_TIMEOUT_IN_MS - 1);
    await Promise.resolve();
    expect(isDone).toBe(false);

    jest.advanceTimersByTime(1);
    await queuing;

    expect(isDone).toBe(true);
    expect(errors.join("\n")).toContain("not all queued");
  });

  test("a queue that answers at once is waited for no longer, and leaves no timer behind", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("sending: what a worker sends, read when it runs", () => {
  test("to the address the account has when the job runs - an address changed since the clear included", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    accounts.set(keyOf(ALICE_ID), { email: "alice.new@example.com" });

    await runWorker(THIS_PROCESS);

    expect(sentTo()).toEqual(["alice.new@example.com"]);
  });

  test("the cleared-settings template, its subject literal and naming the product", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);

    expect(sent[0]!.mail.templateType).toBe(
      EmailTemplateType.SignInSettingsCleared,
    );
    expect(sent[0]!.mail.isSubjectLiteral).toBe(true);
    expect(sent[0]!.mail.subject).toBe(
      "Your OneUptime sign-in settings were cleared",
    );
    expect(sent[0]!.mail.language).toBeUndefined();
  });

  test("in the language on the person's account", async () => {
    accounts.set(keyOf(ALICE_ID), {
      email: "alice@example.com",
      language: "de",
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);

    expect(sent[0]!.mail.language).toBe("de");
    expect(sent[0]!.mail.subject).toContain("OneUptime");
    expect(sent[0]!.mail.subject).not.toBe(
      "Your OneUptime sign-in settings were cleared",
    );
  });

  test("says when it was cleared - not when the email went - in the person's own time zone", async () => {
    accounts.set(keyOf(ALICE_ID), {
      email: "alice@example.com",
      timezone: Timezone.AsiaKolkata,
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);

    // The worker runs an hour later.
    mockQueueState.now += 60 * 60 * 1000;
    await runWorker(THIS_PROCESS);

    expect(varsOf(0)["clearedAt"]).toBe(
      OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: CLEARED_AT,
        timezone: Timezone.AsiaKolkata,
      }),
    );
    // Bob has no time zone: UTC, as every account email without one.
    expect(varsOf(1)["clearedAt"]).toContain("UTC");
  });

  test("names exactly what that person had removed - a reset link alone too (#9992)", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, {
        ...NO_LOCAL_SIGN_IN_SETTINGS,
        passkeyAndSecurityKeyCount: 2,
        hasPassword: true,
      }),
      event(BOB_ID, {
        ...NO_LOCAL_SIGN_IN_SETTINGS,
        hasPasswordResetLink: true,
      }),
    ]);
    await runWorker(THIS_PROCESS);

    expect(varsOf(0)["removedPassword"]).toBe("true");
    expect(varsOf(0)["removedPasskeyCount"]).toBe("2");
    expect(varsOf(0)["removedPasswordResetLink"]).toBeUndefined();
    expect(varsOf(1)["removedPasswordResetLink"]).toBe("true");
    expect(varsOf(1)["removedPassword"]).toBeUndefined();
  });

  test("a server admin's clear names no admin; an owner's names the project as it is called when the email is written", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID),
      ownerEvent(BOB_ID),
    ]);

    projects.set(keyOf(PROJECT_ID), "Acme Platform");
    await runWorker(THIS_PROCESS);

    expect(varsOf(0)["clearedByServerAdmin"]).toBe("true");
    expect(varsOf(0)["projectName"]).toBeUndefined();
    expect(varsOf(1)["clearedByProjectOwner"]).toBe("true");
    expect(varsOf(1)["projectName"]).toBe("Acme Platform");
  });

  test("a project deleted since the clear: the email still goes, naming no project and nobody as a server admin", async () => {
    await SignInSettingsClearedEmail.notify([ownerEvent(ALICE_ID)]);

    projects.delete(keyOf(PROJECT_ID));
    await runWorker(THIS_PROCESS);

    expect(sent).toHaveLength(1);
    expect(varsOf(0)["clearedByProjectOwner"]).toBe("true");
    expect(varsOf(0)["clearedByServerAdmin"]).toBeUndefined();
    expect("projectName" in varsOf(0)).toBe(false);
  });

  test("each email is about its reader alone", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, { ...EVERYTHING, backupCodeCount: 3 }),
      event(BOB_ID, { ...EVERYTHING, backupCodeCount: 7 }),
    ]);
    await runWorker(THIS_PROCESS);

    const aliceMail: string = JSON.stringify(sent[0]!.mail);
    const bobMail: string = JSON.stringify(sent[1]!.mail);

    expect(aliceMail).not.toContain("bob");
    expect(aliceMail).not.toContain(BOB_ID.toString());
    expect(bobMail).not.toContain("alice");
    expect(bobMail).not.toContain(ALICE_ID.toString());
    expect(varsOf(0)["removedBackupCodeCount"]).toBe("3");
    expect(varsOf(1)["removedBackupCodeCount"]).toBe("7");
  });

  test("the buttons go to this server's sign-in pages", async () => {
    management.set(keyOf(BOB_ID), {
      isManagedBySso: false,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);
    await runWorker(THIS_PROCESS);

    expect(varsOf(0)["ssoSignInUrl"]).toBe(
      "https://oneuptime.example.com/accounts/sso",
    );
    expect(varsOf(0)["signInUrl"]).toBe(
      "https://oneuptime.example.com/accounts/login",
    );
    expect(varsOf(1)["forgotPasswordUrl"]).toBe(
      "https://oneuptime.example.com/accounts/forgot-password",
    );
  });

  test("each email is bounded in time and filed under its person", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);

    expect(sent[0]!.options["timeoutInMs"]).toBe(EMAIL_HAND_OFF_TIMEOUT_IN_MS);
    expect((sent[0]!.options["userId"] as ObjectID).toString()).toBe(
      ALICE_ID.toString(),
    );
  });

  test("while SSO manages their sign-in: with SSO, naming its providers", async () => {
    management.set(keyOf(ALICE_ID), {
      isManagedBySso: true,
      ssoProviderNames: ["Okta", "Azure AD"],
      localSignInProjectNames: [],
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);

    expect(varsOf(0)["signsInWithSso"]).toBe("true");
    expect(varsOf(0)["ssoProviderNames"]).toBe("Okta · Azure AD");
  });

  test("while nothing manages it: a new password, and nothing about their other projects", async () => {
    management.set(keyOf(ALICE_ID), {
      isManagedBySso: false,
      ssoProviderNames: ["Okta"],
      localSignInProjectNames: ["Side Project"],
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);

    expect(varsOf(0)["setsNewPassword"]).toBe("true");
    expect(JSON.stringify(sent[0]!.mail)).not.toContain("Side Project");
  });

  test("when the rule cannot be read: the email still goes, naming both ways", async () => {
    management.set(keyOf(ALICE_ID), new Error("database unavailable"));

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);

    expect(sent).toHaveLength(1);
    expect(varsOf(0)["signInWayUnknown"]).toBe("true");
  });

  test("an account that is gone, or has no address: nothing to send, and nothing tried again", async () => {
    accounts.delete(keyOf(ALICE_ID));
    accounts.set(keyOf(BOB_ID), { email: null });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);
    const runs: Array<WorkerRun> = await runWorker(THIS_PROCESS);

    expect(sent).toHaveLength(0);
    expect(
      runs.map((run: WorkerRun): string => {
        return run.outcome;
      }),
    ).toEqual(["done", "done"]);
  });

  test.each([
    ["no data", undefined],
    ["nobody named", { clearedBy: "ServerAdmin", cleared: EVERYTHING }],
    [
      "an id that is no id",
      {
        userId: "alice",
        clearedBy: "ServerAdmin",
        clearedAt: CLEARED_AT.toISOString(),
        cleared: EVERYTHING,
      },
    ],
    [
      "an owner's clear with no project",
      {
        userId: ALICE_ID.toString(),
        clearedBy: "ProjectOwner",
        clearedAt: CLEARED_AT.toISOString(),
        cleared: EVERYTHING,
      },
    ],
    [
      "a clearer nobody knows",
      {
        userId: ALICE_ID.toString(),
        clearedBy: "Somebody",
        clearedAt: CLEARED_AT.toISOString(),
        cleared: EVERYTHING,
      },
    ],
    [
      "no time",
      {
        userId: ALICE_ID.toString(),
        clearedBy: "ServerAdmin",
        cleared: EVERYTHING,
      },
    ],
    [
      "broken settings",
      {
        userId: ALICE_ID.toString(),
        clearedBy: "ServerAdmin",
        clearedAt: CLEARED_AT.toISOString(),
        cleared: { hasPassword: "yes" },
      },
    ],
  ])(
    "a job with %s is dropped, never tried again, and nothing is sent",
    async (_label: string, data: unknown) => {
      await expect(
        SignInSettingsClearedEmail.runJob(data, {
          attempt: 1,
          maxAttempts: EMAIL_JOB_ATTEMPTS,
        }),
      ).resolves.toBe(undefined);
      expect(sent).toHaveLength(0);
    },
  );

  test("the job's data reads back as it was written", () => {
    const written: Record<string, unknown> =
      SignInSettingsClearedEmail.toJobData(ownerEvent(ALICE_ID));

    expect(
      SignInSettingsClearedEmail.readJobData(
        JSON.parse(JSON.stringify(written)),
      ),
    ).toEqual({
      userId: ALICE_ID,
      clearedBy: SignInSettingsClearedBy.ProjectOwner,
      projectId: PROJECT_ID,
      clearedAt: CLEARED_AT,
      cleared: EVERYTHING,
    });
  });
});

describe("trying again (#9991)", () => {
  test("a send that fails is tried again, after EMAIL_JOB_BACKOFF_IN_MS, then twice as long, until it goes - once", async () => {
    mailOutcomes = ["fail", "fail"];

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    const runs: Array<WorkerRun> = await runWorker(THIS_PROCESS);

    expect(
      runs.map((run: WorkerRun): [number, number, string] => {
        return [run.attempt, run.at, run.outcome];
      }),
    ).toEqual([
      [1, 0, "retry"],
      [2, EMAIL_JOB_BACKOFF_IN_MS, "retry"],
      [3, EMAIL_JOB_BACKOFF_IN_MS * 3, "done"],
    ]);
    expect(sentTo()).toEqual(["alice@example.com"]);
    // Done, it leaves the queue.
    expect(mockRedisJobs.size).toBe(0);
  });

  test("a mail service that refuses the email is tried again too", async () => {
    mailOutcomes = ["refuse"];

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    const runs: Array<WorkerRun> = await runWorker(THIS_PROCESS);

    expect(runs).toHaveLength(2);
    expect(sentTo()).toEqual(["alice@example.com"]);
  });

  test("a read that fails - the account, the project - is tried again", async () => {
    const findUser: jest.SpyInstance = getJestSpyOn(UserService, "findOneById");
    const readUser: (data: { id: ObjectID }) => Promise<User | null> =
      findUser.getMockImplementation() as (data: {
        id: ObjectID;
      }) => Promise<User | null>;
    findUser.mockRejectedValueOnce(new Error("database unavailable"));
    findUser.mockImplementation(readUser);

    const findProject: jest.SpyInstance = getJestSpyOn(
      ProjectService,
      "findOneById",
    );
    const readProject: (data: { id: ObjectID }) => Promise<Project | null> =
      findProject.getMockImplementation() as (data: {
        id: ObjectID;
      }) => Promise<Project | null>;
    findProject.mockRejectedValueOnce(new Error("database unavailable"));
    findProject.mockImplementation(readProject);

    await SignInSettingsClearedEmail.notify([ownerEvent(ALICE_ID)]);
    const runs: Array<WorkerRun> = await runWorker(THIS_PROCESS);

    expect(
      runs.map((run: WorkerRun): string => {
        return run.outcome;
      }),
    ).toEqual(["retry", "retry", "done"]);
    expect(varsOf(0)["projectName"]).toBe("Acme Production");
  });

  test("EMAIL_JOB_ATTEMPTS attempts at most, then given up - logged by the person's id, never their address", async () => {
    mailOutcomes = Array.from({ length: EMAIL_JOB_ATTEMPTS + 5 }, () => {
      return "fail" as const;
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    const runs: Array<WorkerRun> = await runWorker(THIS_PROCESS);

    expect(runs).toHaveLength(EMAIL_JOB_ATTEMPTS);
    expect(runs[runs.length - 1]!.outcome).toBe("failed");
    expect(
      runs.map((run: WorkerRun): number => {
        return run.attempt;
      }),
    ).toEqual(
      Array.from({ length: EMAIL_JOB_ATTEMPTS }, (_v: unknown, i: number) => {
        return i + 1;
      }),
    );
    expect(sent).toHaveLength(0);
    expect(mockRedisJobs.size).toBe(0);

    const gaveUp: Array<string> = errors.filter((line: string): boolean => {
      return line.includes("Gave up");
    });
    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0]).toContain(ALICE_ID.toString());
    expect(errors.join("\n")).not.toContain("alice@example.com");
  });

  test("one person's failures hold up nobody else", async () => {
    // Alice's sends fail; Bob's, after hers, go.
    const sendMail: jest.SpyInstance = getJestSpyOn(MailService, "sendMail");
    const send: (
      mail: EmailMessage,
      options: Record<string, unknown>,
    ) => Promise<unknown> = sendMail.getMockImplementation() as (
      mail: EmailMessage,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    sendMail.mockImplementation(
      async (
        mail: EmailMessage,
        options: Record<string, unknown>,
      ): Promise<unknown> => {
        if (mail.toEmail.toString() === "alice@example.com") {
          throw new Error("mailbox unavailable");
        }

        return await send(mail, options);
      },
    );

    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);
    await runWorker(THIS_PROCESS);

    expect(sentTo()).toEqual(["bob@example.com"]);
  });
});

describe("a restart in the middle of it (#9991)", () => {
  test("a job still waiting when its server stops is sent by a worker that starts after", async () => {
    // This server queues the email, then stops before any worker runs it.
    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);
    expect(sent).toHaveLength(0);

    const next: ProcessModules = startAnotherServer();
    expect(next.email).not.toBe(SignInSettingsClearedEmail);

    const runs: Array<WorkerRun> = await runWorker(next);

    expect(sentTo().sort()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(runs).toHaveLength(2);
    expect(mockRedisJobs.size).toBe(0);
  });

  test("a job waiting for its next attempt when its server stops is tried again by the next server", async () => {
    mailOutcomes = ["fail"];

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    // This server's worker tries once, and the server stops while it waits.
    const job: MockStoredJob = mockRedisJobs.values().next().value!;
    await expect(
      SignInSettingsClearedEmail.runJob(job.data, {
        attempt: 1,
        maxAttempts: EMAIL_JOB_ATTEMPTS,
      }),
    ).rejects.toThrow(ALICE_ID.toString());
    job.attemptsMade = 1;
    job.availableAt = mockQueueState.now + EMAIL_JOB_BACKOFF_IN_MS;

    const runs: Array<WorkerRun> = await runWorker(startAnotherServer());

    expect(runs).toEqual([
      {
        jobId: expect.any(String),
        attempt: 2,
        at: EMAIL_JOB_BACKOFF_IN_MS,
        outcome: "done",
      },
    ]);
    expect(sentTo()).toEqual(["alice@example.com"]);
  });
});

describe("one email, however often it is queued (#9991)", () => {
  test("the same email queued twice while it waits is one job, and one send", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    expect(mockAdds).toHaveLength(2);
    expect(mockRedisJobs.size).toBe(1);

    await runWorker(THIS_PROCESS);
    expect(sentTo()).toEqual(["alice@example.com"]);
  });

  test("two clears that read the same settings at the same moment are one send", async () => {
    await Promise.all([
      SignInSettingsClearedEmail.notify([
        { ...event(ALICE_ID), clearedAt: CLEARED_AT },
      ]),
      SignInSettingsClearedEmail.notify([
        { ...event(ALICE_ID), clearedAt: new Date(CLEARED_AT.getTime() + 7) },
      ]),
    ]);

    await runWorker(THIS_PROCESS);
    expect(sentTo()).toEqual(["alice@example.com"]);
  });

  test("a job run again after its email went - a worker that stalled, say - sends nothing more", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    const job: MockStoredJob = mockRedisJobs.values().next().value!;

    await runWorker(THIS_PROCESS);
    expect(sent).toHaveLength(1);

    // BullMQ hands the same job to another worker.
    await expect(
      SignInSettingsClearedEmail.runJob(job.data, {
        attempt: 1,
        maxAttempts: EMAIL_JOB_ATTEMPTS,
      }),
    ).resolves.toBe(undefined);

    expect(sent).toHaveLength(1);
    expect(infos.join("\n")).toContain("already went");
  });

  test("the same email queued again after it went is not sent again within EMAIL_SENT_WINDOW_IN_SECONDS; a clear later than that is told", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);

    mockQueueState.now += 60 * 1000;
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);
    expect(sent).toHaveLength(1);

    mockQueueState.now += EMAIL_SENT_WINDOW_IN_SECONDS * 1000;
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);
    expect(sent).toHaveLength(2);
  });

  test("the email that went is remembered by a key that names no address or count", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    await runWorker(THIS_PROCESS);

    const keys: Array<string> = Array.from(cache.keys());
    expect(keys).toHaveLength(1);
    expect(keys[0]!.startsWith(`${EMAIL_SENT_CACHE_NAMESPACE}-`)).toBe(true);
    expect(keys[0]).toContain(keyOf(ALICE_ID));
    expect(keys[0]).not.toContain("alice@example.com");
  });

  test("an email that says something else is another email: another clearer, or something else removed", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID),
      ownerEvent(ALICE_ID),
      event(ALICE_ID, { ...EVERYTHING, backupCodeCount: 9 }),
    ]);

    expect(mockRedisJobs.size).toBe(3);
    await runWorker(THIS_PROCESS);
    expect(sent).toHaveLength(3);
  });

  test("one person's email never stands in for another's", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);
    await runWorker(THIS_PROCESS);

    expect(sentTo()).toEqual(["alice@example.com", "bob@example.com"]);
  });

  test("an email that went but could not be remembered ends its job: no retry sends it twice", async () => {
    cacheFails.write = true;

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    const runs: Array<WorkerRun> = await runWorker(THIS_PROCESS);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.outcome).toBe("done");
    expect(sent).toHaveLength(1);
    expect(errors.join("\n")).toContain("could not be remembered as sent");
  });

  test("a cache that cannot be read is tried again later, rather than risk a second email", async () => {
    cacheFails.read = true;

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);
    const job: MockStoredJob = mockRedisJobs.values().next().value!;

    await expect(
      SignInSettingsClearedEmail.runJob(job.data, {
        attempt: 1,
        maxAttempts: EMAIL_JOB_ATTEMPTS,
      }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);

    cacheFails.read = false;
    await runWorker(THIS_PROCESS);
    expect(sent).toHaveLength(1);
  });
});
