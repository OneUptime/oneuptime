import {
  SERVER_ALERTS_JOB_NAME,
  SERVER_ALERT_SENDERS,
  ServerAlertSenders,
  tellMasterAdmins,
} from "../../FeatureSet/Workers/Jobs/ServerAlerts/TellMasterAdmins";
import { runWithInstanceHealthLease } from "../../FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthLock";
import RunCron from "../../FeatureSet/Workers/Utils/Cron";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import UserPushService from "Common/Server/Services/UserPushService";
import UserService from "Common/Server/Services/UserService";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import GlobalProbesBehind from "Common/Server/Utils/Probe/GlobalProbesBehind";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import { InstallationHealthProbeBehind } from "Common/Types/InstallationHealth/InstallationHealth";
import { ProbeBehindWork } from "Common/Types/Probe/ProbeBehind";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import {
  SERVER_ALERT_MIN_INTERVAL_MS,
  ServerAlertCondition,
  ServerAlertSubject,
} from "Common/Types/ServerSending/ServerAlerts";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "Common/Types/ServerSending/ServerSendingStatus";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TELLING MASTER ADMINS WHEN THE SERVER'S EMAIL OR GLOBAL PROBES STOP, AS A
 * JOB (#6879).
 *
 * Every five minutes, under the instance-health lease, the job compares
 * where the server stands with what it last told, and tells only a change:
 *
 *   - email that stops working is told by push and SMS, never by email, and
 *     once more when it works again - not again while it stays as it is,
 *     and at most once an hour;
 *   - every global probe going quiet is told by email too, and so is one
 *     falling behind, its monitors checked or its network devices polled
 *     later than their interval, and all keeping up again (#9500);
 *   - with no channel that can carry it, nothing is sent and nothing is
 *     thrown; a channel that refuses does not keep the others from going;
 *   - OneUptime Cloud sends nothing until its operator chooses;
 *   - the pushes go to the master admins' own devices only.
 *
 * The database, where the server stands, and the senders are stood in for.
 */

type Flags = { billingEnabled: boolean };

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const flags: Flags = { billingEnabled: false };

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    Host: "oneuptime.acme.io",
    mockFlags: flags,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return flags.billingEnabled;
    },
  });

  return mocked;
});

// RunCron registers a repeatable BullMQ job at import time.
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

// The lease is Redis's; here it runs the job once, as a replica that took it does.
jest.mock(
  "../../FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthLock",
  () => {
    return {
      __esModule: true,
      INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES: 15,
      INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS: 1200,
      runWithInstanceHealthLease: jest.fn(
        async (data: { run: () => Promise<void> }): Promise<void> => {
          await data.run();
        },
      ),
    };
  },
);

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/ServerSending/ServerSendingStatus", () => {
  return { __esModule: true, default: { getAnswer: jest.fn() } };
});

// Which global probes are behind, as OneUptime Health reads them.
jest.mock("Common/Server/Utils/Probe/GlobalProbesBehind", () => {
  return { __esModule: true, default: { read: jest.fn() } };
});

jest.mock("Common/Server/Services/UserService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/UserPushService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/PushNotificationService", () => {
  return { __esModule: true, default: { sendPushNotification: jest.fn() } };
});

jest.mock("Common/Server/Utils/Logger");

// What the job module registered when it was imported, before any test ran.
const registrations: Array<Array<unknown>> = [
  ...(RunCron as unknown as jest.Mock).mock.calls,
];

const flags: Flags = (
  jest.requireMock("Common/Server/EnvironmentConfig") as { mockFlags: Flags }
).mockFlags;

const findOneById: jest.Mock =
  GlobalConfigService.findOneById as unknown as jest.Mock;
const updateOneById: jest.Mock =
  GlobalConfigService.updateOneById as unknown as jest.Mock;
const getAnswer: jest.Mock =
  ServerSendingStatus.getAnswer as unknown as jest.Mock;
const readBehind: jest.Mock = GlobalProbesBehind.read as unknown as jest.Mock;

const NOW: Date = new Date("2026-11-18T10:00:00.000Z");

const later: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
};

interface Sent {
  channel: "push" | "sms" | "email";
  to?: string;
  title?: string;
  text: string;
}

let sent: Array<Sent> = [];
let refusing: Set<string> = new Set<string>();

const senders: ServerAlertSenders = {
  push: async (data: { title: string; body: string }): Promise<boolean> => {
    if (refusing.has("push")) {
      throw new Error("relay is down");
    }

    sent.push({ channel: "push", title: data.title, text: data.body });
    return true;
  },
  sms: async (data: { to: Phone; text: string }): Promise<boolean> => {
    if (refusing.has("sms")) {
      return false;
    }

    sent.push({ channel: "sms", to: data.to.toString(), text: data.text });
    return true;
  },
  email: async (data: {
    to: Email;
    title: string;
    body: string;
  }): Promise<boolean> => {
    sent.push({
      channel: "email",
      to: data.to.toString(),
      title: data.title,
      text: data.body,
    });
    return true;
  },
};

// The one settings row, as the job reads and writes it.
let stored: {
  serverAlertPhoneNumber: Phone | undefined;
  isServerAlertPushOn: boolean | undefined;
  adminNotificationEmail: Email | undefined;
  serverAlertState: JSONObject | undefined;
};

function standing(
  states: Partial<Record<ServerSendingChannel, ServerSendingState>> = {},
  probes: { total: number; reporting: number } | null = {
    total: 2,
    reporting: 2,
  },
): ServerSendingStatusAnswer {
  return {
    channels: [
      ServerSendingChannel.Email,
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
      ServerSendingChannel.Push,
    ].map((channel: ServerSendingChannel): ServerChannelStatus => {
      return {
        channel: channel,
        state: states[channel] || ServerSendingState.Working,
      } as ServerChannelStatus;
    }),
    globalProbes: probes,
  };
}

async function runAt(
  now: Date,
  answer: ServerSendingStatusAnswer,
): Promise<void> {
  getAnswer.mockResolvedValue(answer as never);
  await tellMasterAdmins({ now, senders });
}

beforeEach(() => {
  jest.clearAllMocks();
  sent = [];
  refusing = new Set<string>();
  flags.billingEnabled = false;
  readBehind.mockResolvedValue([] as never);

  stored = {
    serverAlertPhoneNumber: new Phone("+15550100"),
    isServerAlertPushOn: undefined,
    adminNotificationEmail: new Email("ops@example.test"),
    serverAlertState: undefined,
  };

  findOneById.mockImplementation(async (): Promise<GlobalConfig> => {
    return {
      ...stored,
    } as unknown as GlobalConfig;
  });

  updateOneById.mockImplementation(async (data: unknown): Promise<void> => {
    const update: { data: { serverAlertState: JSONObject } } = data as {
      data: { serverAlertState: JSONObject };
    };
    stored.serverAlertState = update.data.serverAlertState;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the job", () => {
  test("runs every five minutes, under the instance-health lease", async () => {
    expect(registrations).toHaveLength(1);
    expect(registrations[0]![0]).toBe(SERVER_ALERTS_JOB_NAME);
    expect(registrations[0]![1]).toMatchObject({ schedule: EVERY_FIVE_MINUTE });

    getAnswer.mockResolvedValue(standing() as never);
    await (registrations[0]![2] as () => Promise<void>)();

    expect(runWithInstanceHealthLease).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: SERVER_ALERTS_JOB_NAME }),
    );
  });
});

describe("email that stops working", () => {
  test("the first look only notes where things stand", async () => {
    await runAt(
      NOW,
      standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
    );

    expect(sent).toEqual([]);
    expect(updateOneById).toHaveBeenCalledTimes(1);
  });

  test("is told by push and SMS, never by email, and once only", async () => {
    await runAt(NOW, standing());
    updateOneById.mockClear();

    await runAt(
      later(5),
      standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
    );

    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["push", "sms"]);
    expect(sent[1]).toMatchObject({ to: "+15550100" });
    expect(sent[1]!.text).toContain("oneuptime.acme.io");
    expect(sent[1]!.text).toContain("stopped working");
    expect(updateOneById).toHaveBeenCalledTimes(1);

    // Five minutes on, still failing: nothing more, and nothing written.
    sent = [];
    updateOneById.mockClear();
    await runAt(
      later(10),
      standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
    );

    expect(sent).toEqual([]);
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("working again is told once more, after the hour since the last message", async () => {
    await runAt(NOW, standing());
    await runAt(
      later(5),
      standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
    );
    sent = [];

    // Back within the hour: it waits.
    await runAt(later(20), standing());
    expect(sent).toEqual([]);

    // Still working once the hour is over: told.
    await runAt(later(5 + SERVER_ALERT_MIN_INTERVAL_MS / 60000), standing());

    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["push", "sms"]);
    expect(sent[0]!.text).toContain("works again");
  });

  test("with no channel that can carry it, nothing is sent and nothing is thrown", async () => {
    await runAt(NOW, standing());
    updateOneById.mockClear();

    await expect(
      runAt(
        later(5),
        standing({
          [ServerSendingChannel.Email]: ServerSendingState.Failing,
          [ServerSendingChannel.SMS]: ServerSendingState.NotSetUp,
          [ServerSendingChannel.Push]: ServerSendingState.Failing,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(sent).toEqual([]);
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("a channel that refuses keeps no other from going, and throws nothing", async () => {
    await runAt(NOW, standing());
    refusing.add("push");

    await expect(
      runAt(
        later(5),
        standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
      ),
    ).resolves.toBeUndefined();

    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["sms"]);
    expect(
      (stored.serverAlertState as JSONObject)[ServerAlertSubject.Email],
    ).toMatchObject({ told: ServerAlertCondition.Failing });
  });

  test("when every channel refuses, it is tried again after the hour", async () => {
    await runAt(NOW, standing());
    refusing.add("push");
    refusing.add("sms");

    await runAt(
      later(5),
      standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
    );
    expect(sent).toEqual([]);

    refusing = new Set<string>();

    await runAt(
      later(15),
      standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
    );
    expect(sent).toEqual([]);

    await runAt(
      later(5 + SERVER_ALERT_MIN_INTERVAL_MS / 60000),
      standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
    );
    expect(sent).toHaveLength(2);
  });
});

describe("every global probe going quiet", () => {
  test("is told by push, SMS and the Admin Notification Email", async () => {
    await runAt(NOW, standing());

    await runAt(later(5), standing({}, { total: 2, reporting: 0 }));

    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["push", "sms", "email"]);
    expect(sent[2]).toMatchObject({ to: "ops@example.test" });
    expect(sent[2]!.title).toContain("No global probe");
  });
});

/*
 * A global probe falling behind (#9500): its monitors checked, or its
 * network devices polled, later than their interval, as OneUptime Health
 * finds it. The same path and the same rules as the rest.
 */
describe("a global probe falling behind", () => {
  const BEHIND: Array<InstallationHealthProbeBehind> = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Probe-1",
      since: "2026-11-18T09:50:00.000Z",
      work: ProbeBehindWork.DevicePolls,
    },
  ];

  async function behindAt(
    now: Date,
    behind: Array<InstallationHealthProbeBehind>,
    probes: { total: number; reporting: number } = { total: 2, reporting: 2 },
  ): Promise<void> {
    readBehind.mockResolvedValue(behind as never);
    await runAt(now, standing({}, probes));
  }

  test("is told by push, SMS and the Admin Notification Email, naming the probe and what it is behind on", async () => {
    await behindAt(NOW, []);
    expect(sent).toEqual([]);

    await behindAt(later(5), BEHIND);

    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["push", "sms", "email"]);
    expect(sent[1]).toMatchObject({ to: "+15550100" });
    expect(sent[2]).toMatchObject({ to: "ops@example.test" });
    expect(sent[0]!.title).toBe(
      "Global probe Probe-1 of oneuptime.acme.io is behind",
    );
    expect(sent[1]!.text).toContain(
      "its network devices are polled less often than set",
    );
    expect(
      (stored.serverAlertState as JSONObject)[
        ServerAlertSubject.GlobalProbesBehind
      ],
    ).toMatchObject({ told: ServerAlertCondition.Failing });
  });

  test("still behind five minutes on says nothing more and writes nothing; keeping up again is told once the hour is over", async () => {
    await behindAt(NOW, []);
    await behindAt(later(5), BEHIND);
    sent = [];
    updateOneById.mockClear();

    await behindAt(later(10), BEHIND);
    expect(sent).toEqual([]);
    expect(updateOneById).not.toHaveBeenCalled();

    // Caught up within the hour: it waits.
    await behindAt(later(20), []);
    expect(sent).toEqual([]);

    await behindAt(later(5 + SERVER_ALERT_MIN_INTERVAL_MS / 60000), []);

    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["push", "sms", "email"]);
    expect(sent[0]!.text).toBe(
      "Global probes of oneuptime.acme.io keep up again: none is behind.",
    );
  });

  test("the first look after an upgrade only notes it", async () => {
    await behindAt(NOW, BEHIND);

    expect(sent).toEqual([]);
    expect(
      (stored.serverAlertState as JSONObject)[
        ServerAlertSubject.GlobalProbesBehind
      ],
    ).toMatchObject({ told: ServerAlertCondition.Failing });
  });

  test("while no global probe reports, only that is said", async () => {
    await behindAt(NOW, []);

    await behindAt(later(5), [], { total: 2, reporting: 0 });

    // One message, by push, SMS and email: none of it about probes behind.
    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["push", "sms", "email"]);
    for (const one of sent) {
      expect(one.text).toContain("No global probe of oneuptime.acme.io");
      expect(one.text).not.toContain("behind");
      expect(one.text).not.toContain("keep up");
    }
  });

  test("a read of the probes behind that fails tells nothing of them, changes nothing, and stops nothing else", async () => {
    await behindAt(NOW, []);
    readBehind.mockRejectedValue(new Error("statement timeout") as never);

    await expect(
      runAt(
        later(5),
        standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
      ),
    ).resolves.toBeUndefined();

    // Email stopping is still told, by push and SMS.
    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["push", "sms"]);
    expect(
      (stored.serverAlertState as JSONObject)[
        ServerAlertSubject.GlobalProbesBehind
      ],
    ).toMatchObject({ told: ServerAlertCondition.Working });
  });

  test("OneUptime Cloud says nothing of it until its operator chooses", async () => {
    flags.billingEnabled = true;
    stored.serverAlertPhoneNumber = undefined;

    await behindAt(NOW, []);
    await behindAt(later(5), BEHIND);

    expect(sent).toEqual([]);
  });
});

describe("where it goes", () => {
  test("a master admin who turned push off gets no push", async () => {
    stored.isServerAlertPushOn = false;

    await runAt(NOW, standing());
    await runAt(
      later(5),
      standing({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
    );

    expect(
      sent.map((one: Sent): string => {
        return one.channel;
      }),
    ).toEqual(["sms"]);
  });

  test("OneUptime Cloud sends nothing until its operator chooses", async () => {
    flags.billingEnabled = true;
    stored.serverAlertPhoneNumber = undefined;

    await runAt(NOW, standing());
    await runAt(later(5), standing({}, { total: 2, reporting: 0 }));

    expect(sent).toEqual([]);
  });

  test("the pushes go to the master admins' own devices, and nobody else's", async () => {
    const admin: User = new User();
    admin.id = ObjectID.generate();

    (UserService.findBy as unknown as jest.Mock).mockResolvedValue([
      admin,
    ] as never);

    const device: UserPush = new UserPush();
    device.deviceToken = "ExponentPushToken[admin-phone]";
    device.deviceType = PushDeviceType.iOS;
    device.deviceName = "Admin's phone";

    (UserPushService.findBy as unknown as jest.Mock).mockResolvedValue([
      device,
      device,
    ] as never);
    (
      PushNotificationService.sendPushNotification as unknown as jest.Mock
    ).mockResolvedValue(undefined as never);

    expect(
      await SERVER_ALERT_SENDERS.push({
        title: "Email from oneuptime.acme.io stopped working",
        body: "…",
        tag: "server-alert-email",
      }),
    ).toBe(true);

    expect(
      (UserService.findBy as unknown as jest.Mock).mock.calls[0]![0],
    ).toMatchObject({ query: { isMasterAdmin: true } });
    expect(
      JSON.stringify(
        (UserPushService.findBy as unknown as jest.Mock).mock.calls[0]![0],
      ),
    ).toContain(admin.id!.toString());

    const push: Array<unknown> = (
      PushNotificationService.sendPushNotification as unknown as jest.Mock
    ).mock.calls[0]! as Array<unknown>;

    // One device, once, however many rows name it.
    expect((push[0] as { devices: Array<unknown> }).devices).toHaveLength(1);
  });

  test("with no master admin, nobody gets a push", async () => {
    (UserService.findBy as unknown as jest.Mock).mockResolvedValue([] as never);

    expect(
      await SERVER_ALERT_SENDERS.push({ title: "t", body: "b", tag: "x" }),
    ).toBe(false);
    expect(UserPushService.findBy).not.toHaveBeenCalled();
    expect(PushNotificationService.sendPushNotification).not.toHaveBeenCalled();
  });
});
