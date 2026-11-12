import { describe, expect, test } from "@jest/globals";
import InstallationHealthUtil, {
  CLICKHOUSE_DISK_FIX_FREE_PERCENT,
  CLICKHOUSE_DISK_WARN_FREE_PERCENT,
  INSTALLATION_HEALTH_ADMIN_PATHS,
  INSTALLATION_HEALTH_GUIDES,
  INSTALLATION_HEALTH_SETUP_FIX,
  INSTALLATION_HEALTH_WORDS,
  InstallationHealthAnswer,
  InstallationHealthCheck,
  InstallationHealthFacts,
  InstallationHealthFinding,
  InstallationHealthFindingId,
  InstallationHealthLevel,
  QUEUE_BACKLOG_LIMIT,
} from "../../../Types/InstallationHealth/InstallationHealth";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  SERVER_SETUP_STATUS_WORDS,
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupFacts,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import { getTemplatePlaceholders } from "../../../Types/Translator";

/*
 * WHAT IS WRONG WITH THIS INSTALLATION, AS PURE RULES (#6826).
 *
 * The findings `npm run doctor`, diagnose.sh and the Admin Dashboard's
 * OneUptime Health overview print, from facts the server reads:
 *
 *   - a datastore that does not answer is something to fix;
 *   - a failed migration that is still pending is something to fix, and
 *     pending ones alone are worth a look;
 *   - ClickHouse's fullest disk under 10% free is something to fix, under
 *     20% worth a look;
 *   - a queue with a backlog, and a newer release, are worth a look;
 *   - the server setup checklist's open steps in its own words: required
 *     ones to fix, recommended ones worth a look, optional ones only when
 *     they fail.
 *
 * Worst first, each with its fix and where it is fixed.
 */

const EARLIER: string = "2026-11-10T09:30:00.000Z";
const GB: number = 1000 * 1000 * 1000;

function channel(
  name: ServerSendingChannel,
  state: ServerSendingState,
): ServerChannelStatus {
  return {
    channel: name,
    state: state,
    hasWorked: state === ServerSendingState.Working,
    lastWorkedAt: state === ServerSendingState.Working ? EARLIER : null,
    failingSince: state === ServerSendingState.Failing ? EARLIER : null,
    lastFailure:
      state === ServerSendingState.Failing ? "535 Authentication failed" : null,
    setUpProblem: null,
  };
}

function setupFacts(overrides: Partial<ServerSetupFacts> = {}): ServerSetupFacts {
  return {
    isHttpsSetUp: true,
    areSignupsClosed: true,
    email: channel(ServerSendingChannel.Email, ServerSendingState.Working),
    sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
    call: channel(ServerSendingChannel.Call, ServerSendingState.Working),
    emailSentThrough: "smtp.example.com",
    smsSentThrough: "Twilio",
    callSentThrough: "Twilio",
    globalProbes: { total: 1, reporting: 1 },
    updateChecks: { isDisabled: false, lastCheckedAt: EARLIER, lastFailure: null },
    lastBackup: { succeeded: true, finishedAt: EARLIER, error: null },
    hasScheduledBackups: true,
    isBrowserPushSetUp: true,
    hasAiProvider: true,
    hasSingleSignOn: true,
    choices: { choices: {}, hiddenBy: {} },
    ...overrides,
  };
}

function checklist(
  overrides: Partial<ServerSetupFacts> = {},
): ServerSetupChecklistAnswer {
  return ServerSetupChecklistUtil.getAnswer({
    facts: setupFacts(overrides),
    readerUserId: null,
  });
}

// A server with nothing wrong.
function healthyFacts(
  overrides: Partial<InstallationHealthFacts> = {},
): InstallationHealthFacts {
  return {
    isPostgresConnected: true,
    isClickhouseConnected: true,
    isValkeyConnected: true,
    migrations: { pending: 0, failure: null },
    clickhouseDisks: [
      { name: "clickhouse default", freeInBytes: 80 * GB, totalInBytes: 100 * GB },
    ],
    queues: [{ name: "Worker", waiting: 3 }],
    version: {
      current: "14.0.108",
      latest: "14.0.108",
      isUpdateAvailable: false,
      isUpdateCheckDisabled: false,
    },
    serverSetup: checklist(),
    ...overrides,
  };
}

function ids(findings: Array<InstallationHealthFinding>): Array<string> {
  return findings.map((finding: InstallationHealthFinding): string => {
    return finding.id;
  });
}

function only(facts: InstallationHealthFacts): InstallationHealthFinding {
  const findings: Array<InstallationHealthFinding> =
    InstallationHealthUtil.evaluate(facts);

  expect(findings).toHaveLength(1);

  return findings[0]!;
}

describe("a healthy server", () => {
  test("has nothing to say", () => {
    expect(InstallationHealthUtil.evaluate(healthyFacts())).toEqual([]);
  });

  test("its answer says what was looked at, the version, and when", () => {
    const answer: InstallationHealthAnswer = InstallationHealthUtil.getAnswer({
      facts: healthyFacts(),
      addressProof: "nonce.signature",
      checkedAt: EARLIER,
    });

    expect(answer).toEqual({
      findings: [],
      checked: Object.values(InstallationHealthCheck),
      version: healthyFacts().version,
      addressProof: "nonce.signature",
      checkedAt: EARLIER,
    });
  });
});

describe("the datastores", () => {
  test.each([
    ["PostgreSQL", { isPostgresConnected: false }, InstallationHealthFindingId.Postgres],
    ["ClickHouse", { isClickhouseConnected: false }, InstallationHealthFindingId.Clickhouse],
    ["Valkey", { isValkeyConnected: false }, InstallationHealthFindingId.Valkey],
  ])(
    "%s not answering is something to fix, with what stops and where to look",
    (
      title: string,
      overrides: Partial<InstallationHealthFacts>,
      id: InstallationHealthFindingId,
    ) => {
      const finding: InstallationHealthFinding = only(healthyFacts(overrides));

      expect(finding.id).toBe(id);
      expect(finding.level).toBe(InstallationHealthLevel.Fix);
      expect(finding.title).toBe(title);
      expect(finding.sentence).toBe(INSTALLATION_HEALTH_WORDS[id].words);
      expect(finding.sentence).toContain(`${title} does not answer`);
      expect(finding.fixSentence).toBe(
        `Check that ${title} is running, and read its log for the reason.`,
      );
    },
  );

  test("PostgreSQL down: the checklist could not be read, and nothing is said about it", () => {
    expect(
      ids(
        InstallationHealthUtil.evaluate(
          healthyFacts({
            isPostgresConnected: false,
            migrations: null,
            serverSetup: null,
          }),
        ),
      ),
    ).toEqual([InstallationHealthFindingId.Postgres]);
  });
});

describe("the migrations", () => {
  test("one that failed and is still pending: its name, when and why, and the fix", () => {
    const finding: InstallationHealthFinding = only(
      healthyFacts({
        migrations: {
          pending: 2,
          failure: {
            name: "AddMonitorColumns1809110968240",
            reason: 'column "x" already exists',
            at: EARLIER,
          },
        },
      }),
    );

    expect(finding.level).toBe(InstallationHealthLevel.Fix);
    expect(finding.sentence).toBe(
      'The database migration AddMonitorColumns1809110968240 failed on 2026-11-10 09:30 UTC: column "x" already exists',
    );
    expect(finding.fixSentence).toContain("restart OneUptime");
    expect(finding.adminPath).toBe(INSTALLATION_HEALTH_ADMIN_PATHS.migrations);
  });

  test("pending without a failure is worth a look: they run while OneUptime starts", () => {
    const finding: InstallationHealthFinding = only(
      healthyFacts({ migrations: { pending: 3, failure: null } }),
    );

    expect(finding.id).toBe(InstallationHealthFindingId.MigrationsPending);
    expect(finding.level).toBe(InstallationHealthLevel.Warn);
    expect(finding.sentence).toBe(
      "Database migrations are still running: 3 left. They run while OneUptime starts.",
    );
  });

  test("none pending says nothing, even with an old failure on record", () => {
    expect(
      InstallationHealthUtil.evaluate(
        healthyFacts({
          migrations: {
            pending: 0,
            failure: { name: "Old", reason: "x", at: EARLIER },
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("ClickHouse's disk", () => {
  function withFree(freePercent: number): InstallationHealthFacts {
    return healthyFacts({
      clickhouseDisks: [
        { name: "roomy", freeInBytes: 90 * GB, totalInBytes: 100 * GB },
        {
          name: "clickhouse default",
          freeInBytes: freePercent * GB,
          totalInBytes: 100 * GB,
        },
      ],
    });
  }

  test(`at ${CLICKHOUSE_DISK_WARN_FREE_PERCENT}% free and above says nothing`, () => {
    expect(
      InstallationHealthUtil.evaluate(withFree(CLICKHOUSE_DISK_WARN_FREE_PERCENT)),
    ).toEqual([]);
  });

  test(`under ${CLICKHOUSE_DISK_WARN_FREE_PERCENT}% free is worth a look, naming the fullest disk, not a roomy one`, () => {
    const finding: InstallationHealthFinding = only(withFree(15));

    expect(finding.level).toBe(InstallationHealthLevel.Warn);
    expect(finding.sentence).toBe(
      "ClickHouse's disk clickhouse default has 15 GB free of 100 GB. When it fills, ClickHouse stops saving telemetry.",
    );
    expect(finding.adminPath).toBe(INSTALLATION_HEALTH_ADMIN_PATHS.clickhouse);
  });

  test(`under ${CLICKHOUSE_DISK_FIX_FREE_PERCENT}% free is something to fix`, () => {
    expect(only(withFree(5)).level).toBe(InstallationHealthLevel.Fix);
  });

  test("a disk with no size is left out", () => {
    expect(
      InstallationHealthUtil.evaluate(
        healthyFacts({
          clickhouseDisks: [{ name: "x", freeInBytes: 0, totalInBytes: 0 }],
        }),
      ),
    ).toEqual([]);
  });

  test("bytes as people read a disk", () => {
    expect(InstallationHealthUtil.formatBytes(512 * 1000 * 1000)).toBe(
      "512 MB",
    );
    expect(InstallationHealthUtil.formatBytes(8.44 * GB)).toBe("8.4 GB");
    expect(InstallationHealthUtil.formatBytes(120.4 * GB)).toBe("120 GB");
    expect(InstallationHealthUtil.formatBytes(-1)).toBe("0 MB");
  });
});

describe("the queues", () => {
  test(`more than ${QUEUE_BACKLOG_LIMIT} waiting is worth a look, naming the queue furthest behind`, () => {
    const finding: InstallationHealthFinding = only(
      healthyFacts({
        queues: [
          { name: "Worker", waiting: 1500 },
          { name: "Telemetry", waiting: 40000 },
        ],
      }),
    );

    expect(finding.level).toBe(InstallationHealthLevel.Warn);
    expect(finding.sentence).toBe(
      "40000 jobs are waiting in the Telemetry queue, so the workers are behind.",
    );
  });

  test(`${QUEUE_BACKLOG_LIMIT} waiting is not a backlog`, () => {
    expect(
      InstallationHealthUtil.evaluate(
        healthyFacts({ queues: [{ name: "Worker", waiting: QUEUE_BACKLOG_LIMIT }] }),
      ),
    ).toEqual([]);
  });
});

describe("the version", () => {
  test("a newer release is worth a look, with the upgrading guide", () => {
    const finding: InstallationHealthFinding = only(
      healthyFacts({
        version: {
          current: "14.0.100",
          latest: "14.0.108",
          isUpdateAvailable: true,
          isUpdateCheckDisabled: false,
        },
      }),
    );

    expect(finding.level).toBe(InstallationHealthLevel.Warn);
    expect(finding.sentence).toBe(
      "This server runs OneUptime 14.0.100. 14.0.108 is out.",
    );
    expect(finding.fixSentence).toContain("npm run update");
    expect(finding.fixSentence).toContain("helm upgrade");
    expect(finding.guidePath).toBe(INSTALLATION_HEALTH_GUIDES.upgrading);
  });
});

describe("the server setup checklist, in its own words", () => {
  test("a fresh server: email, HTTPS and sign-ups to fix; SMS and calls, probes, backups worth a look; optional ones not at all", () => {
    const findings: Array<InstallationHealthFinding> =
      InstallationHealthUtil.evaluate(
        healthyFacts({
          serverSetup: checklist({
            isHttpsSetUp: false,
            areSignupsClosed: false,
            email: channel(ServerSendingChannel.Email, ServerSendingState.NotSetUp),
            sms: channel(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
            call: channel(ServerSendingChannel.Call, ServerSendingState.NotSetUp),
            globalProbes: { total: 1, reporting: 0 },
            lastBackup: null,
            isBrowserPushSetUp: false,
            hasAiProvider: false,
            hasSingleSignOn: false,
          }),
        }),
      );

    expect(
      findings.map((finding: InstallationHealthFinding): [string, string] => {
        return [finding.id, finding.level];
      }),
    ).toEqual([
      ["setup-email", InstallationHealthLevel.Fix],
      ["setup-https", InstallationHealthLevel.Fix],
      ["setup-signups", InstallationHealthLevel.Fix],
      ["setup-sms-and-calls", InstallationHealthLevel.Warn],
      ["setup-probes", InstallationHealthLevel.Warn],
      ["setup-backups", InstallationHealthLevel.Warn],
    ]);

    const email: InstallationHealthFinding = findings[0]!;

    expect(email.title).toBe("Email");
    expect(email.words).toBe(
      SERVER_SETUP_STATUS_WORDS[ServerSetupCheckId.Email]["not-set-up"],
    );
    expect(email.fix).toBe(INSTALLATION_HEALTH_SETUP_FIX);
    expect(email.adminPath).toBe("/admin/settings/smtp");
    expect(findings[1]!.guidePath).toBe(
      "/docs/installation/docker-compose#set-up-https",
    );
  });

  test("a failing channel says since when", () => {
    const finding: InstallationHealthFinding = only(
      healthyFacts({
        serverSetup: checklist({
          email: channel(ServerSendingChannel.Email, ServerSendingState.Failing),
        }),
      }),
    );

    expect(finding.id).toBe("setup-email");
    expect(finding.sentence).toBe(
      "Failing: emails have not gone out since 2026-11-10 09:30 UTC.",
    );
  });

  test("a step an admin chose to do without is finished: nothing to say", () => {
    expect(
      InstallationHealthUtil.evaluate(
        healthyFacts({
          serverSetup: checklist({
            sms: channel(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
            call: channel(ServerSendingChannel.Call, ServerSendingState.NotSetUp),
            choices: {
              choices: {
                [ServerSetupCheckId.SmsAndCalls]: {
                  kind: ServerSetupChoiceKind.Skipped,
                  at: EARLIER,
                  byUserId: null,
                },
              },
              hiddenBy: {},
            },
          }),
        }),
      ),
    ).toEqual([]);
  });
});

describe("worst first", () => {
  test("every fix before every warn, each level in its own order", () => {
    const findings: Array<InstallationHealthFinding> =
      InstallationHealthUtil.evaluate(
        healthyFacts({
          isValkeyConnected: false,
          queues: [],
          migrations: { pending: 1, failure: null },
          version: {
            current: "1.0.0",
            latest: "2.0.0",
            isUpdateAvailable: true,
            isUpdateCheckDisabled: false,
          },
          serverSetup: checklist({
            email: channel(ServerSendingChannel.Email, ServerSendingState.NotSetUp),
          }),
        }),
      );

    expect(ids(findings)).toEqual([
      InstallationHealthFindingId.Valkey,
      "setup-email",
      InstallationHealthFindingId.MigrationsPending,
      InstallationHealthFindingId.UpdateAvailable,
    ]);
  });
});

describe("the words", () => {
  test("every finding's words, fix and title are filled from its own values, with no placeholder left", () => {
    for (const id of Object.values(InstallationHealthFindingId)) {
      const words: { title: string; words: string; fix: string } =
        INSTALLATION_HEALTH_WORDS[id];
      const placeholders: Array<string> = getTemplatePlaceholders(words.words);

      // The fix uses no value the words do not.
      for (const placeholder of getTemplatePlaceholders(words.fix)) {
        expect(placeholders).toContain(placeholder);
      }

      expect(words.title.length).toBeGreaterThan(0);
      expect(words.words.endsWith(".") || words.words.endsWith("}}")).toBe(true);
      expect(words.fix.endsWith(".")).toBe(true);
    }
  });

  test("a finding is filled for a terminal", () => {
    const finding: InstallationHealthFinding = InstallationHealthUtil.finding({
      id: "x",
      level: InstallationHealthLevel.Warn,
      title: "T",
      words: "{{a}} and {{b}}.",
      fix: "Fix {{a}}.",
      values: { a: "one", b: "two" },
    });

    expect(finding.sentence).toBe("one and two.");
    expect(finding.fixSentence).toBe("Fix one.");
    expect(finding.adminPath).toBe(null);
  });

  test("a time it cannot read is said as unknown", () => {
    expect(InstallationHealthUtil.formatTime(null)).toBe("an unknown date");
    expect(InstallationHealthUtil.formatTime("not a date")).toBe(
      "an unknown date",
    );
  });
});

describe("the answer, read back in a browser", () => {
  test("round-trips", () => {
    const answer: InstallationHealthAnswer = InstallationHealthUtil.getAnswer({
      facts: healthyFacts({
        isClickhouseConnected: false,
        serverSetup: checklist({
          email: channel(ServerSendingChannel.Email, ServerSendingState.NotSetUp),
        }),
      }),
      addressProof: null,
      checkedAt: EARLIER,
    });

    expect(
      InstallationHealthUtil.parseAnswer(JSON.parse(JSON.stringify(answer))),
    ).toEqual(answer);
  });

  test("what is not an answer is null", () => {
    expect(InstallationHealthUtil.parseAnswer(null)).toBe(null);
    expect(InstallationHealthUtil.parseAnswer("<html>")).toBe(null);
    expect(InstallationHealthUtil.parseAnswer({ findings: "x" })).toBe(null);
  });

  test("a row that is not a finding is left out, and the rest put worst first", () => {
    const parsed: InstallationHealthAnswer | null =
      InstallationHealthUtil.parseAnswer({
        findings: [
          { id: "a", level: "warn", title: "A", words: "A is slow." },
          { id: "b", level: "info", title: "B", words: "B." },
          { id: "c", level: "fix", title: "C" },
          "nonsense",
          { id: "d", level: "fix", title: "D", words: "D is down." },
        ],
        checked: ["postgres", "nonsense"],
      });

    expect(ids(parsed!.findings)).toEqual(["d", "a"]);
    expect(parsed!.checked).toEqual([InstallationHealthCheck.Postgres]);
    expect(parsed!.version).toEqual({
      current: "",
      latest: null,
      isUpdateAvailable: false,
      isUpdateCheckDisabled: false,
    });
  });

  test("a link is a path on this server, never another host's address", () => {
    const parsed: InstallationHealthAnswer | null =
      InstallationHealthUtil.parseAnswer({
        findings: [
          {
            id: "a",
            level: "fix",
            title: "A",
            words: "A.",
            adminPath: "https://evil.example.com/admin",
            guidePath: "//evil.example.com/docs",
          },
          {
            id: "b",
            level: "fix",
            title: "B",
            words: "B.",
            adminPath: "/admin/setup",
          },
        ],
      });

    expect(parsed!.findings[0]!.adminPath).toBe(null);
    expect(parsed!.findings[0]!.guidePath).toBe(null);
    expect(parsed!.findings[1]!.adminPath).toBe("/admin/setup");
  });
});
