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
  InstallationHealthProduct,
  InstallationHealthProducts,
  QUEUE_BACKLOG_LIMIT,
} from "../../../Types/InstallationHealth/InstallationHealth";
import { ProbeBehindWork } from "../../../Types/Probe/ProbeBehind";
import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import {
  SWITCHABLE_PRODUCTS,
  ServerProductOffReason,
  ServerProductsPreset,
  TELEMETRY_INGESTION_PRODUCTS,
  getOffByPreset,
} from "../../../Types/Product/ServerProducts";
import {
  ServerProductsAnswer,
  ServerProductsSource,
} from "../../../Types/Product/ServerProductsAnswer";
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
import path from "path";

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
 *   - a queue with a backlog, a global probe that is behind (#9488) and a
 *     newer release are worth a look;
 *   - the server setup checklist's open steps in its own words: required
 *     ones to fix, recommended ones worth a look, optional ones only when
 *     they fail.
 *
 * Worst first, each with its fix and where it is fixed.
 */

const EARLIER: string = "2026-11-10T09:30:00.000Z";
const GB: number = 1000 * 1000 * 1000;

// <repo>/packages/Common/Tests/Types/InstallationHealth -> <repo>
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

// One of the installation's own scripts, as `npm run doctor` runs it.
function requireScript<T>(relativePath: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(path.join(REPOSITORY_ROOT, relativePath)) as T;
}

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

function setupFacts(
  overrides: Partial<ServerSetupFacts> = {},
): ServerSetupFacts {
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
    updateChecks: {
      isDisabled: false,
      lastCheckedAt: EARLIER,
      lastFailure: null,
    },
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
      {
        name: "clickhouse default",
        freeInBytes: 80 * GB,
        totalInBytes: 100 * GB,
      },
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
      // A reader that did not ask for the products says nothing of them.
      products: null,
      addressProof: "nonce.signature",
      checkedAt: EARLIER,
    });
  });
});

/*
 * #7481: which products the server switches off, for `npm run doctor` -
 * facts, not findings - from what Admin Dashboard > Settings > Products
 * reads.
 */
describe("the products switched off on the server", () => {
  function productsAnswer(
    overrides: Partial<ServerProductsAnswer> = {},
  ): ServerProductsAnswer {
    return {
      off: {},
      switchedOff: [],
      preset: ServerProductsPreset.Everything,
      source: ServerProductsSource.StartingValue,
      startingValue: "",
      startingValueUnknownNames: [],
      isTelemetryIngestionStopped: false,
      shouldSuggestStoppingIngestion: false,
      changedAt: null,
      ...overrides,
    };
  }

  function productsOf(
    answer: ServerProductsAnswer,
  ): InstallationHealthProducts {
    const products: InstallationHealthProducts | null =
      InstallationHealthUtil.getAnswer({
        facts: healthyFacts({ serverProducts: answer }),
        addressProof: null,
        checkedAt: EARLIER,
      }).products;

    expect(products).not.toBe(null);

    return products!;
  }

  function titles(products: Array<InstallationHealthProduct>): Array<string> {
    return products.map((product: InstallationHealthProduct): string => {
      return product.title;
    });
  }

  test("every product on: all of them counted, the Everything preset, nothing off", () => {
    expect(productsOf(productsAnswer())).toEqual({
      switchableCount: SWITCHABLE_PRODUCTS.length,
      onCount: SWITCHABLE_PRODUCTS.length,
      preset: ServerProductsPreset.Everything,
      presetTitle: "Everything",
      source: ServerProductsSource.StartingValue,
      switchedOff: [],
      unknownNames: [],
      isTelemetryIngestionStopped: false,
      offByIngestion: [],
      shouldSuggestStoppingIngestion: false,
    });
  });

  test("a preset an admin saved: its English name, how many are on, and the rest by name in the menu's order", () => {
    const off: Array<ProductKey> = getOffByPreset(
      ServerProductsPreset.MonitoringAndStatusPages,
    );
    const products: InstallationHealthProducts = productsOf(
      productsAnswer({
        switchedOff: [...off].reverse(),
        preset: ServerProductsPreset.MonitoringAndStatusPages,
        source: ServerProductsSource.Saved,
      }),
    );

    expect(products.onCount).toBe(5);
    expect(products.switchableCount).toBe(SWITCHABLE_PRODUCTS.length);
    expect(products.presetTitle).toBe("Monitoring and status pages");
    expect(products.source).toBe(ServerProductsSource.Saved);
    expect(
      products.switchedOff.map((entry: InstallationHealthProduct) => {
        return entry.product;
      }),
    ).toEqual(off);
    expect(titles(products.switchedOff)).toContain("Logs");
  });

  test("a choice of one's own has no preset", () => {
    const products: InstallationHealthProducts = productsOf(
      productsAnswer({
        switchedOff: [ProductKey.Logs, ProductKey.Traces],
        preset: null,
      }),
    );

    expect(products.preset).toBe(null);
    expect(products.presetTitle).toBe(null);
    expect(products.onCount).toBe(SWITCHABLE_PRODUCTS.length - 2);
    expect(titles(products.switchedOff)).toEqual(["Logs", "Traces"]);
  });

  test("telemetry ingestion stopped: the products it turns off, by name, apart from what the switches say", () => {
    const off: ServerProductsAnswer["off"] = {};

    for (const product of TELEMETRY_INGESTION_PRODUCTS) {
      off[product] = ServerProductOffReason.TelemetryIngestionStopped;
    }

    const products: InstallationHealthProducts = productsOf(
      productsAnswer({ off: off, isTelemetryIngestionStopped: true }),
    );

    expect(products.isTelemetryIngestionStopped).toBe(true);
    expect(products.onCount).toBe(SWITCHABLE_PRODUCTS.length);
    expect(
      products.offByIngestion.map((entry: InstallationHealthProduct) => {
        return entry.product;
      }),
    ).toEqual(
      PRODUCT_KEYS.filter((product: ProductKey): boolean => {
        return TELEMETRY_INGESTION_PRODUCTS.includes(product);
      }),
    );
  });

  test("the names SERVER_PRODUCTS held that the server did not know, as many and as long as a line takes, with no control character", () => {
    const products: InstallationHealthProducts = productsOf(
      productsAnswer({
        startingValueUnknownNames: [
          "monitor",
          "status\u001b[31mpages",
          "x".repeat(200),
          ...Array.from({ length: 20 }, (_value: unknown, index: number) => {
            return `name-${index}`;
          }),
        ],
      }),
    );

    expect(products.unknownNames.length).toBe(10);
    expect(products.unknownNames[0]).toBe("monitor");
    expect(products.unknownNames[1]).toBe("status[31mpages");
    expect(products.unknownNames[2]).toBe("x".repeat(60));
  });

  test("SERVER_PRODUCTS itself, and who saved the page when, are not in the answer: it carries no setting's value", () => {
    const answer: InstallationHealthAnswer = InstallationHealthUtil.getAnswer({
      facts: healthyFacts({
        serverProducts: productsAnswer({
          startingValue: "monitors, incidents, typo-product",
          startingValueUnknownNames: ["typo-product"],
          changedAt: EARLIER,
        }),
      }),
      addressProof: null,
      checkedAt: "2026-11-18T10:00:00.000Z",
    });
    const json: string = JSON.stringify(answer.products);

    expect(json).not.toContain("monitors, incidents");
    expect(json).not.toContain(EARLIER);
    expect(answer.products!.unknownNames).toEqual(["typo-product"]);
  });

  test("the suggestion to stop ingestion is passed on", () => {
    expect(
      productsOf(productsAnswer({ shouldSuggestStoppingIngestion: true }))
        .shouldSuggestStoppingIngestion,
    ).toBe(true);
  });

  test("they are no finding: a choice is not a fault", () => {
    expect(
      InstallationHealthUtil.evaluate(
        healthyFacts({
          serverProducts: productsAnswer({
            switchedOff: getOffByPreset(
              ServerProductsPreset.MonitoringAndStatusPages,
            ),
            preset: ServerProductsPreset.MonitoringAndStatusPages,
          }),
        }),
      ),
    ).toEqual([]);
  });

  test("read back: round-trips, and an older server's answer has none", () => {
    const answer: InstallationHealthAnswer = InstallationHealthUtil.getAnswer({
      facts: healthyFacts({
        serverProducts: productsAnswer({
          switchedOff: getOffByPreset(ServerProductsPreset.IncidentResponse),
          preset: ServerProductsPreset.IncidentResponse,
          startingValueUnknownNames: ["monitor"],
        }),
      }),
      addressProof: null,
      checkedAt: EARLIER,
    });

    expect(
      InstallationHealthUtil.parseAnswer(JSON.parse(JSON.stringify(answer))),
    ).toEqual(answer);
    expect(InstallationHealthUtil.parseAnswer({ findings: [] })!.products).toBe(
      null,
    );
  });

  /*
   * `npm run doctor` (Scripts/Install/Doctor.js) reads this answer as the
   * server sends it: the real one, through JSON, prints the lines its own
   * tests stand in for.
   */
  test("npm run doctor reads them as the server sends them", () => {
    const doctor: {
      productsFindings: (
        products: unknown,
        publicUrl: string | null,
      ) => Array<{ level: string; message: string }>;
    } = requireScript("Scripts/Install/Doctor.js");
    const sent: (answer: ServerProductsAnswer) => unknown = (
      answer: ServerProductsAnswer,
    ): unknown => {
      return JSON.parse(
        JSON.stringify(
          InstallationHealthUtil.getAnswer({
            facts: healthyFacts({ serverProducts: answer }),
            addressProof: null,
            checkedAt: EARLIER,
          }),
        ),
      )["products"];
    };

    expect(
      doctor.productsFindings(
        sent(
          productsAnswer({
            switchedOff: getOffByPreset(
              ServerProductsPreset.MonitoringAndStatusPages,
            ),
            preset: ServerProductsPreset.MonitoringAndStatusPages,
            source: ServerProductsSource.Saved,
          }),
        ),
        "https://oneuptime.example.com",
      ),
    ).toEqual([
      expect.objectContaining({
        level: "note",
        message: `Products: Monitoring and status pages (5 of ${SWITCHABLE_PRODUCTS.length} on), set in the Admin Dashboard at https://oneuptime.example.com/admin/settings/products.`,
      }),
    ]);

    const off: ServerProductsAnswer["off"] = {};

    for (const product of TELEMETRY_INGESTION_PRODUCTS) {
      off[product] = ServerProductOffReason.TelemetryIngestionStopped;
    }

    expect(
      doctor
        .productsFindings(
          sent(
            productsAnswer({
              off: off,
              isTelemetryIngestionStopped: true,
              startingValueUnknownNames: ["monitor"],
            }),
          ),
          null,
        )
        .map((entry: { level: string; message: string }): string => {
          return `${entry.level}: ${entry.message}`;
        }),
    ).toEqual([
      "ok: Products: every product is switched on.",
      "warn: SERVER_PRODUCTS in config.env names what OneUptime does not know, so it left it out: monitor.",
      "note: Telemetry ingestion is stopped (DISABLE_TELEMETRY_INGESTION=true), so Logs, Metrics, Traces, Profiles and Exceptions are off for every project.",
    ]);
  });

  test("read back: what is not a product, a preset or a source is left out, and the counts are the reader's own", () => {
    expect(
      InstallationHealthUtil.parseProducts({
        switchableCount: 9999,
        onCount: -4,
        preset: "nonsense",
        source: "nonsense",
        switchedOff: [
          { product: "logs", title: "<b>Logs</b>" },
          { product: "nonsense", title: "Nonsense" },
          { product: "logs" },
          "traces",
        ],
        unknownNames: "monitor",
        isTelemetryIngestionStopped: "yes",
        offByIngestion: null,
      }),
    ).toEqual({
      switchableCount: SWITCHABLE_PRODUCTS.length,
      onCount: SWITCHABLE_PRODUCTS.length - 1,
      preset: null,
      presetTitle: null,
      source: ServerProductsSource.StartingValue,
      switchedOff: [{ product: ProductKey.Logs, title: "Logs" }],
      unknownNames: [],
      isTelemetryIngestionStopped: false,
      offByIngestion: [],
      shouldSuggestStoppingIngestion: false,
    });
  });
});

describe("the datastores", () => {
  test.each([
    [
      "PostgreSQL",
      { isPostgresConnected: false },
      InstallationHealthFindingId.Postgres,
    ],
    [
      "ClickHouse",
      { isClickhouseConnected: false },
      InstallationHealthFindingId.Clickhouse,
    ],
    [
      "Valkey",
      { isValkeyConnected: false },
      InstallationHealthFindingId.Valkey,
    ],
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
      InstallationHealthUtil.evaluate(
        withFree(CLICKHOUSE_DISK_WARN_FREE_PERCENT),
      ),
    ).toEqual([]);
  });

  test(`under ${CLICKHOUSE_DISK_WARN_FREE_PERCENT}% free is worth a look, naming the fullest disk, not a roomy one`, () => {
    const finding: InstallationHealthFinding = only(withFree(15));

    expect(finding.level).toBe(InstallationHealthLevel.Warn);
    expect(finding.sentence).toBe(
      "ClickHouse's disk clickhouse default has 15\u00A0GB free of 100\u00A0GB. When it fills, ClickHouse stops saving telemetry.",
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
      "512\u00A0MB",
    );
    expect(InstallationHealthUtil.formatBytes(8.44 * GB)).toBe("8.4\u00A0GB");
    expect(InstallationHealthUtil.formatBytes(120.4 * GB)).toBe("120\u00A0GB");
    expect(InstallationHealthUtil.formatBytes(-1)).toBe("0\u00A0MB");
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
        healthyFacts({
          queues: [{ name: "Worker", waiting: QUEUE_BACKLOG_LIMIT }],
        }),
      ),
    ).toEqual([]);
  });
});

/*
 * #9488: a global probe that is behind - its monitors checked later than
 * their interval - is worth a look, one finding a probe.
 */
describe("the global probes", () => {
  const PROBE_ONE: string = "11111111-1111-4111-8111-111111111111";
  const PROBE_TWO: string = "22222222-2222-4222-8222-222222222222";

  test("one behind is worth a look: its name, since when, and the settings that let it check more at once", () => {
    const finding: InstallationHealthFinding = only(
      healthyFacts({
        globalProbesBehind: [
          { id: PROBE_ONE, name: "Probe-1", since: EARLIER },
        ],
      }),
    );

    expect(finding.id).toBe(
      `${InstallationHealthFindingId.GlobalProbeBehind}-${PROBE_ONE}`,
    );
    expect(finding.level).toBe(InstallationHealthLevel.Warn);
    expect(finding.title).toBe("Global probes");
    expect(finding.sentence).toBe(
      "Probe-1 is behind: since 2026-11-10 09:30 UTC, its monitors have waited more than a minute past their check time, so they are checked less often than set.",
    );
    expect(finding.fixSentence).toContain("GLOBAL_PROBE_1_MONITORING_WORKERS");
    expect(finding.fixSentence).toContain("config.env");
    expect(finding.fixSentence).toContain("monitoringWorkers");
    expect(finding.adminPath).toBe(INSTALLATION_HEALTH_ADMIN_PATHS.probes);
    expect(finding.guidePath).toBe(INSTALLATION_HEALTH_GUIDES.probeBehind);
  });

  test("each probe behind is a finding of its own, the one behind longest first", () => {
    const findings: Array<InstallationHealthFinding> =
      InstallationHealthUtil.evaluate(
        healthyFacts({
          globalProbesBehind: [
            {
              id: PROBE_TWO,
              name: "Probe-2",
              since: "2026-11-10T09:45:00.000Z",
            },
            { id: PROBE_ONE, name: "Probe-1", since: EARLIER },
          ],
        }),
      );

    expect(ids(findings)).toEqual([
      `${InstallationHealthFindingId.GlobalProbeBehind}-${PROBE_ONE}`,
      `${InstallationHealthFindingId.GlobalProbeBehind}-${PROBE_TWO}`,
    ]);
  });

  /*
   * #9499: a global probe behind on the network devices it polls is a
   * finding of its own, with the setting that lets it poll more at once.
   */
  test("one behind on its network devices says so, with the settings that let it poll more at once", () => {
    const finding: InstallationHealthFinding = only(
      healthyFacts({
        globalProbesBehind: [
          {
            id: PROBE_ONE,
            name: "Probe-1",
            since: EARLIER,
            work: ProbeBehindWork.DevicePolls,
          },
        ],
      }),
    );

    expect(finding.id).toBe(
      `${InstallationHealthFindingId.GlobalProbeDevicesBehind}-${PROBE_ONE}`,
    );
    expect(finding.level).toBe(InstallationHealthLevel.Warn);
    expect(finding.title).toBe("Global probes");
    expect(finding.sentence).toBe(
      "Probe-1 is behind on its network devices: since 2026-11-10 09:30 UTC, they have waited more than a minute past their poll time, so they are polled less often than set.",
    );
    expect(finding.fixSentence).toContain(
      "GLOBAL_PROBE_1_NETWORK_DEVICE_POLL_CONCURRENCY",
    );
    expect(finding.fixSentence).toContain("config.env");
    expect(finding.fixSentence).toContain("networkDevicePollConcurrency");
    expect(finding.fixSentence).not.toContain("MONITORING_WORKERS");
    expect(finding.adminPath).toBe(INSTALLATION_HEALTH_ADMIN_PATHS.probes);
    expect(finding.guidePath).toBe(INSTALLATION_HEALTH_GUIDES.probeBehind);
  });

  test("a probe behind on both is two findings, its monitors' and its devices', the longest first; one from a reader that names no work is its monitors'", () => {
    const findings: Array<InstallationHealthFinding> =
      InstallationHealthUtil.evaluate(
        healthyFacts({
          globalProbesBehind: [
            {
              id: PROBE_ONE,
              name: "Probe-1",
              since: "2026-11-10T09:45:00.000Z",
              work: ProbeBehindWork.MonitorChecks,
            },
            {
              id: PROBE_ONE,
              name: "Probe-1",
              since: EARLIER,
              work: ProbeBehindWork.DevicePolls,
            },
            {
              id: PROBE_TWO,
              name: "Probe-2",
              since: "2026-11-10T09:50:00.000Z",
            },
          ],
        }),
      );

    expect(ids(findings)).toEqual([
      `${InstallationHealthFindingId.GlobalProbeDevicesBehind}-${PROBE_ONE}`,
      `${InstallationHealthFindingId.GlobalProbeBehind}-${PROBE_ONE}`,
      `${InstallationHealthFindingId.GlobalProbeBehind}-${PROBE_TWO}`,
    ]);
  });

  test("none behind, or none read, says nothing", () => {
    expect(
      InstallationHealthUtil.evaluate(healthyFacts({ globalProbesBehind: [] })),
    ).toEqual([]);
    expect(
      InstallationHealthUtil.evaluate(
        healthyFacts({ globalProbesBehind: null }),
      ),
    ).toEqual([]);
  });

  test("comes after what is to fix, with the other things worth a look", () => {
    const findings: Array<InstallationHealthFinding> =
      InstallationHealthUtil.evaluate(
        healthyFacts({
          isValkeyConnected: false,
          queues: [{ name: "Worker", waiting: QUEUE_BACKLOG_LIMIT + 1 }],
          globalProbesBehind: [
            { id: PROBE_ONE, name: "Probe-1", since: EARLIER },
          ],
        }),
      );

    expect(ids(findings)).toEqual([
      InstallationHealthFindingId.Valkey,
      InstallationHealthFindingId.QueueBacklog,
      `${InstallationHealthFindingId.GlobalProbeBehind}-${PROBE_ONE}`,
    ]);
  });

  test("the answer says the global probes were looked at, and the finding reads back in a browser", () => {
    const answer: InstallationHealthAnswer = InstallationHealthUtil.getAnswer({
      facts: healthyFacts({
        globalProbesBehind: [
          { id: PROBE_ONE, name: "Probe-1", since: EARLIER },
        ],
      }),
      addressProof: null,
      checkedAt: EARLIER,
    });

    expect(answer.checked).toContain(InstallationHealthCheck.GlobalProbes);

    const read: InstallationHealthAnswer | null =
      InstallationHealthUtil.parseAnswer(JSON.parse(JSON.stringify(answer)));

    expect(read!.findings).toEqual(answer.findings);
    expect(read!.checked).toContain(InstallationHealthCheck.GlobalProbes);
  });

  test("npm run doctor prints it with its fix and the Health page to see it on", () => {
    const doctor: {
      serverFindings: (
        response: unknown,
        publicUrl: string,
      ) => Array<{ level: string; message: string; fix: string | null }>;
    } = requireScript("Scripts/Install/Doctor.js");

    const answer: InstallationHealthAnswer = InstallationHealthUtil.getAnswer({
      facts: healthyFacts({
        globalProbesBehind: [
          { id: PROBE_ONE, name: "Probe-1", since: EARLIER },
        ],
      }),
      addressProof: null,
      checkedAt: EARLIER,
    });

    const printed: Array<{
      level: string;
      message: string;
      fix: string | null;
    }> = doctor.serverFindings(
      { status: 200, json: JSON.parse(JSON.stringify(answer)) },
      "https://oneuptime.example.com",
    );

    const behind:
      | { level: string; message: string; fix: string | null }
      | undefined = printed.find((line: { message: string }) => {
      return line.message.startsWith("Global probes: Probe-1 is behind");
    });

    expect(behind?.level).toBe("warn");
    expect(behind?.fix).toContain("GLOBAL_PROBE_1_MONITORING_WORKERS");
    expect(behind?.fix).toContain(
      "https://oneuptime.example.com/admin/health/probes",
    );
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
            email: channel(
              ServerSendingChannel.Email,
              ServerSendingState.NotSetUp,
            ),
            sms: channel(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
            call: channel(
              ServerSendingChannel.Call,
              ServerSendingState.NotSetUp,
            ),
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
    // The Self-Hosting Guide's HTTPS step, for either install (#7073).
    expect(findings[1]!.guidePath).toBe(
      "/docs/installation/self-hosting-guide#turn-on-https",
    );
  });

  test("a failing channel says since when", () => {
    const finding: InstallationHealthFinding = only(
      healthyFacts({
        serverSetup: checklist({
          email: channel(
            ServerSendingChannel.Email,
            ServerSendingState.Failing,
          ),
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
            call: channel(
              ServerSendingChannel.Call,
              ServerSendingState.NotSetUp,
            ),
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
            email: channel(
              ServerSendingChannel.Email,
              ServerSendingState.NotSetUp,
            ),
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
      expect(words.words.endsWith(".") || words.words.endsWith("}}")).toBe(
        true,
      );
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
          email: channel(
            ServerSendingChannel.Email,
            ServerSendingState.NotSetUp,
          ),
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
