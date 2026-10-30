import {
  MIN_HOURS_BETWEEN_CHECKS,
  MIN_MINUTES_BETWEEN_ATTEMPTS,
  UPDATE_CHECK_JOB_NAME,
  UPDATE_CHECK_LEASE_TTL_IN_SECONDS,
  UPDATE_CHECK_TIMEOUT_IN_MS,
  checkForUpdates,
  runUpdateCheck,
} from "../../FeatureSet/Workers/Jobs/InstanceUpdate/CheckForNewVersion";
import {
  getSecurityAdvisoryRecipients,
  parseEmailedRecord,
} from "../../FeatureSet/Workers/Jobs/InstanceUpdate/SecurityAdvisoryNotification";
import { runWithInstanceHealthLease } from "../../FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthLock";
import RunCron from "../../FeatureSet/Workers/Utils/Cron";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import GitHubUpdateCheck from "Common/Server/Utils/UpdateCheck/GitHubUpdateCheck";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityAdvisoryUtil, {
  SecurityAdvisory,
  SecurityAdvisorySeverity,
} from "Common/Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure from "Common/Types/UpdateCheck/UpdateCheckFailure";
import { EVERY_DAY } from "Common/Utils/CronTime";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE DAILY UPDATE CHECK, AS A JOB.
 *
 * Once a day a self-hosted installation reads the latest OneUptime release
 * and OneUptime's published security advisories from GitHub, keeps them,
 * and emails its owners - master admins and the Admin Notification Email -
 * once about each advisory that affects the version it runs. This holds the
 * job to that, with GitHub, the database and the mail service mocked:
 *
 *   - it stores what GitHub answered, and when, and that it asked;
 *   - it emails once per advisory: never again on the runs after, and only
 *     the new advisory when another is published;
 *   - it never asks about advisories, or emails anyone, on OneUptime Cloud;
 *   - it does nothing at all with DISABLE_UPDATE_CHECK, or for a build that
 *     reports no version;
 *   - when GitHub cannot be reached it keeps the last good answer, records
 *     why, and asks again an hour later at the soonest;
 *   - it records an advisory as emailed only once somebody received it.
 */

type Flags = {
  appVersion: string;
  updateCheckDisabled: boolean;
  billingEnabled: boolean;
  host: string;
};

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const urlModule: { default: { fromString: (value: string) => unknown } } =
    jest.requireActual("Common/Types/API/URL") as {
      default: { fromString: (value: string) => unknown };
    };

  const flags: Flags = {
    appVersion: "14.0.60",
    updateCheckDisabled: false,
    billingEnabled: false,
    host: "oneuptime.acme.io",
  };

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    IsDevelopment: false,
    DocsClientUrl: urlModule.default.fromString(
      "https://oneuptime.acme.io/docs",
    ),
    HomeClientUrl: urlModule.default.fromString("https://oneuptime.acme.io/"),
    mockFlags: flags,
  };

  for (const [name, read] of [
    [
      "AppVersion",
      (): unknown => {
        return flags.appVersion;
      },
    ],
    [
      "DisableUpdateCheck",
      (): unknown => {
        return flags.updateCheckDisabled;
      },
    ],
    [
      "IsBillingEnabled",
      (): unknown => {
        return flags.billingEnabled;
      },
    ],
    [
      "Host",
      (): unknown => {
        return flags.host;
      },
    ],
  ] as Array<[string, () => unknown]>) {
    Object.defineProperty(mocked, name, { get: read });
  }

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

jest.mock("Common/Server/Services/UserService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MailService", () => {
  return { __esModule: true, default: { sendMail: jest.fn() } };
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
const findUsers: jest.Mock = UserService.findBy as unknown as jest.Mock;
const sendMail: jest.Mock = MailService.sendMail as unknown as jest.Mock;
const lease: jest.Mock = runWithInstanceHealthLease as unknown as jest.Mock;

let fetchLatestRelease: ReturnType<typeof jest.spyOn>;
let fetchAdvisories: ReturnType<typeof jest.spyOn>;

const NOW: Date = new Date("2026-10-30T08:00:00.000Z");

let counter: number = 0;

const advisory: (overrides?: Partial<SecurityAdvisory>) => SecurityAdvisory = (
  overrides?: Partial<SecurityAdvisory>,
): SecurityAdvisory => {
  counter++;
  const id: string = `GHSA-aaaa-bbbb-${String(counter).padStart(4, "0")}`;

  return {
    ghsaId: id,
    cveId: null,
    summary: `Advisory ${counter}`,
    severity: SecurityAdvisorySeverity.High,
    url: `https://github.com/OneUptime/oneuptime/security/advisories/${id}`,
    publishedAt: "2026-10-01T00:00:00.000Z",
    vulnerabilities: [
      { vulnerableVersionRange: "<= 14.0.66", patchedVersions: "14.0.67" },
    ],
    ...(overrides || {}),
  };
};

const user: (email: string | null) => User = (email: string | null): User => {
  const model: User = new User();
  model.id = ObjectID.generate();

  if (email) {
    model.email = new Email(email);
  }

  return model;
};

const stored: (overrides?: Partial<GlobalConfig>) => GlobalConfig = (
  overrides?: Partial<GlobalConfig>,
): GlobalConfig => {
  const config: GlobalConfig = new GlobalConfig();
  config.id = ObjectID.getZeroObjectID();
  return Object.assign(config, overrides || {});
};

const delivered: () => { isSuccess: () => boolean } = () => {
  return {
    isSuccess: (): boolean => {
      return true;
    },
  };
};

const refused: () => { isSuccess: () => boolean } = () => {
  return {
    isSuccess: (): boolean => {
      return false;
    },
  };
};

// Every update written to GlobalConfig, in order.
const writes: () => Array<JSONObject> = (): Array<JSONObject> => {
  return updateOneById.mock.calls.map((call: Array<unknown>): JSONObject => {
    const argument: { data: JSONObject; props: JSONObject; id: ObjectID } =
      call[0] as { data: JSONObject; props: JSONObject; id: ObjectID };

    expect(argument.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(argument.id.toString()).toBe(ObjectID.getZeroObjectID().toString());

    return argument.data;
  });
};

const emailedTo: () => Array<string> = (): Array<string> => {
  return sendMail.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { toEmail: Email }).toEmail.toString();
  });
};

beforeEach(() => {
  flags.appVersion = "14.0.60";
  flags.updateCheckDisabled = false;
  flags.billingEnabled = false;
  flags.host = "oneuptime.acme.io";

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  findOneById.mockReset().mockResolvedValue(stored() as never);
  updateOneById.mockReset().mockResolvedValue(undefined as never);
  findUsers
    .mockReset()
    .mockResolvedValue([user("ada@acme.io"), user("grace@acme.io")] as never);
  sendMail.mockReset().mockResolvedValue(delivered() as never);
  lease.mockClear();

  fetchLatestRelease = jest
    .spyOn(GitHubUpdateCheck, "fetchLatestRelease")
    .mockResolvedValue({
      ok: true,
      value: {
        version: "14.0.80",
        publishedAt: new Date("2026-10-20T00:00:00.000Z"),
      },
    });

  fetchAdvisories = jest
    .spyOn(GitHubUpdateCheck, "fetchPublishedSecurityAdvisories")
    .mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how the job is scheduled", () => {
  test("once a day and on startup, with time for both questions and the emails", () => {
    expect(registrations).toEqual([
      [
        "InstanceUpdate:CheckForNewVersion",
        {
          schedule: EVERY_DAY,
          runOnStartup: true,
          timeoutInMS: UPDATE_CHECK_TIMEOUT_IN_MS,
        },
        checkForUpdates,
      ],
    ]);
    expect(UPDATE_CHECK_JOB_NAME).toBe("InstanceUpdate:CheckForNewVersion");
  });

  test("runs under one lease across replicas, held for longer than the job may run", async () => {
    await checkForUpdates();

    expect(lease).toHaveBeenCalledTimes(1);
    expect(lease.mock.calls[0]![0]).toMatchObject({
      jobName: "InstanceUpdate:CheckForNewVersion",
      lockLabel: "instance-update-check",
      leaseTtlInSeconds: UPDATE_CHECK_LEASE_TTL_IN_SECONDS,
    });
    expect(UPDATE_CHECK_LEASE_TTL_IN_SECONDS * 1000).toBeGreaterThan(
      UPDATE_CHECK_TIMEOUT_IN_MS,
    );
  });
});

describe("when it does nothing at all", () => {
  test("with DISABLE_UPDATE_CHECK set: no read, no request, no email", async () => {
    flags.updateCheckDisabled = true;

    await checkForUpdates();

    expect(lease).not.toHaveBeenCalled();
    expect(findOneById).not.toHaveBeenCalled();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(fetchAdvisories).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test.each([["unknown"], [""], ["dev"], ["14.0"]])(
    "for a build that reports %j: there is nothing to compare",
    async (version: string) => {
      flags.appVersion = version;

      await checkForUpdates();

      expect(lease).not.toHaveBeenCalled();
      expect(fetchLatestRelease).not.toHaveBeenCalled();
      expect(fetchAdvisories).not.toHaveBeenCalled();
    },
  );
});

describe("what it stores", () => {
  test("the latest release, the advisories, when GitHub answered and that it asked", async () => {
    const published: SecurityAdvisory = advisory();
    fetchAdvisories.mockResolvedValue({ ok: true, value: [published] });

    await runUpdateCheck();

    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
    expect(fetchAdvisories).toHaveBeenCalledTimes(1);
    expect(writes()[0]).toEqual({
      updateCheckLastAttemptAt: NOW,
      latestReleaseVersion: "14.0.80",
      latestReleaseCheckedAt: NOW,
      latestReleasePublishedAt: new Date("2026-10-20T00:00:00.000Z"),
      securityAdvisories: [SecurityAdvisoryUtil.toJSON(published)],
      securityAdvisoriesCheckedAt: NOW,
      updateCheckLastFailure: null,
    });
  });

  test("asks GitHub's own addresses unless a mirror is set", async () => {
    await runUpdateCheck();

    expect(String(fetchLatestRelease.mock.calls[0]![0])).toBe(
      "https://api.github.com/repos/OneUptime/oneuptime/releases/latest",
    );
    expect(String(fetchAdvisories.mock.calls[0]![0])).toBe(
      "https://api.github.com/repos/OneUptime/oneuptime/security-advisories",
    );
  });

  test("an empty list of advisories is stored as one", async () => {
    await runUpdateCheck();

    expect(writes()[0]).toMatchObject({
      securityAdvisories: [],
      securityAdvisoriesCheckedAt: NOW,
    });
  });
});

describe("when GitHub cannot be reached", () => {
  const LAST_GOOD: Date = new Date("2026-10-28T08:00:00.000Z");

  beforeEach(() => {
    findOneById.mockResolvedValue(
      stored({
        latestReleaseVersion: "14.0.70",
        latestReleaseCheckedAt: LAST_GOOD,
        securityAdvisories: [SecurityAdvisoryUtil.toJSON(advisory())],
        securityAdvisoriesCheckedAt: LAST_GOOD,
        updateCheckLastAttemptAt: LAST_GOOD,
      }) as never,
    );
  });

  test("keeps the last good answer, and records that it asked and why it failed", async () => {
    fetchLatestRelease.mockResolvedValue({
      ok: false,
      failure: UpdateCheckFailure.RateLimited,
      detail: "403",
    });
    fetchAdvisories.mockResolvedValue({
      ok: false,
      failure: UpdateCheckFailure.Unreachable,
      detail: "ENOTFOUND",
    });

    await expect(runUpdateCheck()).resolves.toBeUndefined();

    expect(writes()[0]).toEqual({
      updateCheckLastAttemptAt: NOW,
      updateCheckLastFailure: UpdateCheckFailure.RateLimited,
    });
  });

  test("keeps what did answer when only one question fails", async () => {
    fetchAdvisories.mockResolvedValue({
      ok: false,
      failure: UpdateCheckFailure.TimedOut,
      detail: "timeout",
    });

    await runUpdateCheck();

    expect(writes()[0]).toEqual({
      updateCheckLastAttemptAt: NOW,
      latestReleaseVersion: "14.0.80",
      latestReleaseCheckedAt: NOW,
      latestReleasePublishedAt: new Date("2026-10-20T00:00:00.000Z"),
      updateCheckLastFailure: UpdateCheckFailure.TimedOut,
    });
  });

  test("still tells the owners about an advisory it read before", async () => {
    fetchAdvisories.mockResolvedValue({
      ok: false,
      failure: UpdateCheckFailure.Unreachable,
      detail: "ENOTFOUND",
    });

    await runUpdateCheck();

    expect(emailedTo()).toEqual(["ada@acme.io", "grace@acme.io"]);
  });

  test("asks again an hour after a failed attempt at the soonest", async () => {
    findOneById.mockResolvedValue(
      stored({
        latestReleaseCheckedAt: LAST_GOOD,
        securityAdvisoriesCheckedAt: LAST_GOOD,
        updateCheckLastAttemptAt: OneUptimeDate.addRemoveMinutes(
          NOW,
          -(MIN_MINUTES_BETWEEN_ATTEMPTS - 1),
        ),
      }) as never,
    );

    await runUpdateCheck();

    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(fetchAdvisories).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);

    findOneById.mockResolvedValue(
      stored({
        latestReleaseCheckedAt: LAST_GOOD,
        securityAdvisoriesCheckedAt: LAST_GOOD,
        updateCheckLastAttemptAt: OneUptimeDate.addRemoveMinutes(
          NOW,
          -(MIN_MINUTES_BETWEEN_ATTEMPTS + 1),
        ),
      }) as never,
    );

    await runUpdateCheck();

    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
    expect(fetchAdvisories).toHaveBeenCalledTimes(1);
  });
});

describe("how often it asks", () => {
  test("not again within 12 hours of an answer", async () => {
    const recently: Date = OneUptimeDate.addRemoveHours(
      NOW,
      -(MIN_HOURS_BETWEEN_CHECKS - 1),
    );

    findOneById.mockResolvedValue(
      stored({
        latestReleaseCheckedAt: recently,
        securityAdvisoriesCheckedAt: recently,
        updateCheckLastAttemptAt: recently,
      }) as never,
    );

    await runUpdateCheck();

    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(fetchAdvisories).not.toHaveBeenCalled();
  });

  test("only the question that is due", async () => {
    findOneById.mockResolvedValue(
      stored({
        latestReleaseCheckedAt: OneUptimeDate.addRemoveHours(NOW, -2),
        securityAdvisoriesCheckedAt: null as unknown as Date,
        updateCheckLastAttemptAt: OneUptimeDate.addRemoveHours(NOW, -2),
      }) as never,
    );

    await runUpdateCheck();

    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(fetchAdvisories).toHaveBeenCalledTimes(1);
    expect(writes()[0]).not.toHaveProperty("latestReleaseVersion");
  });
});

describe("on OneUptime Cloud", () => {
  test("reads the latest release - its licenses page needs it - but never the advisories, and emails nobody", async () => {
    flags.billingEnabled = true;
    findOneById.mockResolvedValue(
      stored({
        securityAdvisories: [SecurityAdvisoryUtil.toJSON(advisory())],
      }) as never,
    );

    await runUpdateCheck();

    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
    expect(fetchAdvisories).not.toHaveBeenCalled();
    expect(writes()[0]).not.toHaveProperty("securityAdvisories");
    expect(findUsers).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("emailing the owners", () => {
  test("emails every master admin and the admin notification email about an advisory that affects the version", async () => {
    const published: SecurityAdvisory = advisory({
      severity: SecurityAdvisorySeverity.Critical,
    });
    fetchAdvisories.mockResolvedValue({ ok: true, value: [published] });
    findOneById.mockResolvedValue(
      stored({ adminNotificationEmail: new Email("ops@acme.io") }) as never,
    );

    await runUpdateCheck();

    expect(findUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { isMasterAdmin: true, isDisabled: false, isBlocked: false },
        props: { isRoot: true },
      }),
    );
    expect(emailedTo()).toEqual([
      "ada@acme.io",
      "grace@acme.io",
      "ops@acme.io",
    ]);

    const [envelope, options] = sendMail.mock.calls[0] as [
      {
        templateType: EmailTemplateType;
        subject: string;
        isSubjectLiteral: boolean;
        vars: JSONObject;
      },
      JSONObject,
    ];

    expect(envelope.templateType).toBe(
      EmailTemplateType.SecurityAdvisoryAffectsInstallation,
    );
    expect(envelope.isSubjectLiteral).toBe(true);
    expect(envelope.subject).toBe(
      "ACTION REQUIRED: a security advisory affects OneUptime 14.0.60 on oneuptime.acme.io",
    );
    expect(envelope.vars["recommendedVersion"]).toBe("14.0.80");
    expect(envelope.vars["upgradeGuideLink"]).toBe(
      "https://oneuptime.acme.io/docs/installation/upgrading",
    );
    expect(envelope.vars["advisories"]).toEqual([
      {
        title: `Critical: ${published.summary}`,
        details: `${published.ghsaId} · Affects <= 14.0.66 · Fixed in 14.0.67`,
      },
    ]);
    expect(options).toMatchObject({ timeoutInMs: 30000 });
  });

  test("records the advisory as emailed, and on the runs after emails nobody", async () => {
    const published: SecurityAdvisory = advisory();
    fetchAdvisories.mockResolvedValue({ ok: true, value: [published] });

    await runUpdateCheck();

    const recorded: JSONObject = writes()[1]!;

    expect(recorded).toEqual({
      securityAdvisoriesEmailed: { [published.ghsaId]: NOW.toISOString() },
    });

    sendMail.mockClear();
    updateOneById.mockClear();
    findOneById.mockResolvedValue(
      stored({
        securityAdvisories: [SecurityAdvisoryUtil.toJSON(published)],
        securityAdvisoriesCheckedAt: NOW,
        latestReleaseCheckedAt: NOW,
        updateCheckLastAttemptAt: NOW,
        securityAdvisoriesEmailed: recorded[
          "securityAdvisoriesEmailed"
        ] as JSONObject,
      }) as never,
    );

    for (let run: number = 0; run < 3; run++) {
      await runUpdateCheck();
    }

    expect(sendMail).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  test("emails only the new advisory when another is published, and keeps the record of the first", async () => {
    const first: SecurityAdvisory = advisory();
    const second: SecurityAdvisory = advisory({
      summary: "A second issue",
      vulnerabilities: [
        { vulnerableVersionRange: "< 14.0.75", patchedVersions: "14.0.75" },
      ],
    });
    const earlier: string = "2026-10-01T08:00:00.000Z";

    findOneById.mockResolvedValue(
      stored({
        securityAdvisoriesEmailed: { [first.ghsaId]: earlier },
      }) as never,
    );
    fetchAdvisories.mockResolvedValue({ ok: true, value: [first, second] });

    await runUpdateCheck();

    expect(emailedTo()).toEqual(["ada@acme.io", "grace@acme.io"]);

    const vars: JSONObject = (
      sendMail.mock.calls[0]![0] as { vars: JSONObject }
    ).vars;

    expect(vars["advisories"]).toEqual([
      expect.objectContaining({ title: "High: A second issue" }),
    ]);
    expect(writes()[1]).toEqual({
      securityAdvisoriesEmailed: {
        [first.ghsaId]: earlier,
        [second.ghsaId]: NOW.toISOString(),
      },
    });
  });

  test("emails nobody when no advisory affects the version it runs", async () => {
    flags.appVersion = "14.0.80";
    fetchAdvisories.mockResolvedValue({ ok: true, value: [advisory()] });

    await runUpdateCheck();

    expect(findUsers).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("an upgrade that is still affected by an advisory already emailed sends nothing again", async () => {
    const published: SecurityAdvisory = advisory({
      vulnerabilities: [
        { vulnerableVersionRange: "< 14.0.75", patchedVersions: "14.0.75" },
      ],
    });

    findOneById.mockResolvedValue(
      stored({
        securityAdvisoriesEmailed: {
          [published.ghsaId]: "2026-10-01T00:00:00.000Z",
        },
      }) as never,
    );
    fetchAdvisories.mockResolvedValue({ ok: true, value: [published] });
    flags.appVersion = "14.0.70";

    await runUpdateCheck();

    expect(sendMail).not.toHaveBeenCalled();
  });

  test("records nothing when nobody received it, so the next run tries again", async () => {
    fetchAdvisories.mockResolvedValue({ ok: true, value: [advisory()] });
    sendMail.mockResolvedValue(refused() as never);

    await runUpdateCheck();

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).not.toHaveProperty("securityAdvisoriesEmailed");
  });

  test("records it once one owner received it, whatever happened to the others", async () => {
    const published: SecurityAdvisory = advisory();
    fetchAdvisories.mockResolvedValue({ ok: true, value: [published] });
    sendMail
      .mockRejectedValueOnce(new Error("SMTP refused") as never)
      .mockResolvedValueOnce(delivered() as never);

    await expect(runUpdateCheck()).resolves.toBeUndefined();

    expect(writes()[1]).toEqual({
      securityAdvisoriesEmailed: { [published.ghsaId]: NOW.toISOString() },
    });
  });

  test("records nothing with nobody to tell", async () => {
    fetchAdvisories.mockResolvedValue({ ok: true, value: [advisory()] });
    findUsers.mockResolvedValue([] as never);

    await runUpdateCheck();

    expect(sendMail).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(1);
  });
});

describe("who the owners are", () => {
  test("every master admin with an email, once each, then the admin notification email unless it is one of theirs", async () => {
    findUsers.mockResolvedValue([
      user("ada@acme.io"),
      user(null),
      user("ADA@acme.io"),
      user("grace@acme.io"),
    ] as never);

    expect(
      (await getSecurityAdvisoryRecipients("Grace@Acme.io")).map(
        (recipient: { email: Email }): string => {
          return recipient.email.toString();
        },
      ),
    ).toEqual(["ada@acme.io", "grace@acme.io"]);

    expect(
      (await getSecurityAdvisoryRecipients(new Email("ops@acme.io"))).map(
        (recipient: { email: Email }): string => {
          return recipient.email.toString();
        },
      ),
    ).toEqual(["ada@acme.io", "grace@acme.io", "ops@acme.io"]);
  });

  test("an admin notification email that is not one is left out", async () => {
    for (const address of ["not an email", "", null, undefined]) {
      expect(await getSecurityAdvisoryRecipients(address)).toHaveLength(2);
    }
  });

  test("reads every master admin, page by page", async () => {
    const page: Array<User> = Array.from(
      { length: LIMIT_MAX },
      (_: unknown, index: number) => {
        return user(`admin${index}@acme.io`);
      },
    );

    findUsers
      .mockResolvedValueOnce(page as never)
      .mockResolvedValueOnce([user("last@acme.io")] as never);

    const recipients: Array<{ email: Email }> =
      await getSecurityAdvisoryRecipients(null);

    expect(recipients).toHaveLength(LIMIT_MAX + 1);
    expect((findUsers.mock.calls[1]![0] as { skip: number }).skip).toBe(
      LIMIT_MAX,
    );
  });

  test("names the user of each master admin, for their email log", async () => {
    const admin: User = user("ada@acme.io");
    findUsers.mockResolvedValue([admin] as never);

    expect(await getSecurityAdvisoryRecipients(null)).toEqual([
      { email: admin.email, userId: admin.id },
    ]);
  });
});

describe("the record of what was emailed", () => {
  test("is read without trusting it", () => {
    expect(
      parseEmailedRecord({
        "GHSA-aaaa-bbbb-cccc": "2026-10-01T00:00:00.000Z",
        "ghsa-DDDD-eeee-ffff": "2026-10-02T00:00:00.000Z",
        "not-an-id": "2026-10-01T00:00:00.000Z",
        "GHSA-aaaa-bbbb-dddd": 42,
      }),
    ).toEqual({
      "GHSA-aaaa-bbbb-cccc": "2026-10-01T00:00:00.000Z",
      "GHSA-dddd-eeee-ffff": "2026-10-02T00:00:00.000Z",
    });

    for (const value of [null, undefined, "x", 42, ["GHSA-aaaa-bbbb-cccc"]]) {
      expect(parseEmailedRecord(value)).toEqual({});
    }
  });
});
