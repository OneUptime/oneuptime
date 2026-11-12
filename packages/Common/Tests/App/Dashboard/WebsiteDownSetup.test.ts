import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FirstCheckAnswer,
  MONITOR_NAME_MAX_LENGTH,
  WEBSITE_DOWN_COPY,
  WEBSITE_DOWN_POLICY_NAME,
  WEBSITE_DOWN_SETUP,
  WebsiteAddress,
  WebsiteDownProgressFacts,
  WebsiteDownStep,
  WebsiteDownSummaryFacts,
  WebsiteDownSummaryRow,
  WebsiteMonitorSeeds,
  WhoIsToldFacts,
  WhoIsToldMode,
  buildWebsiteMonitor,
  describeFirstCheck,
  getIncidentSeverityId,
  getMonitorAddress,
  getWebsiteDownProgress,
  getWebsiteDownSummaryRows,
  getWhoIsToldMode,
  isDownAnswer,
  isTestDone,
  isWebsiteDownFinished,
  parseWebsiteAddress,
  readFirstCheckAnswers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import { DEFAULT_MONITORING_INTERVAL } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { MonitorStepProbeResponse } from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * The website-down guided setup's rules and words (issue #6804): the
 * address and the monitor made from it, what the first check says, who is
 * told, which step a returning person lands on, and a summary whose every
 * claim comes from the records it is handed.
 */

const english: Translator = createTranslator(undefined, "en");

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const table: Record<string, string> = readLocale(language);

  return createTranslator((key: string): string => {
    return table[key] || key;
  }, language);
};

const seeds: WebsiteMonitorSeeds = {
  operationalStatusId: new ObjectID("00000000-0000-4000-8000-000000000001"),
  offlineStatusId: new ObjectID("00000000-0000-4000-8000-000000000002"),
  incidentSeverityId: new ObjectID("00000000-0000-4000-8000-000000000003"),
  alertSeverityId: new ObjectID("00000000-0000-4000-8000-000000000004"),
};

const address: (text: string) => WebsiteAddress = (
  text: string,
): WebsiteAddress => {
  const parsed: WebsiteAddress | null = parseWebsiteAddress(text);
  expect(parsed).not.toBeNull();
  return parsed!;
};

describe("the address", () => {
  test("a bare host is https, named after the host", () => {
    expect(parseWebsiteAddress("example.com")).toEqual({
      url: "https://example.com",
      host: "example.com",
      monitorName: "example.com",
    });
  });

  test("spaces around it are not part of it", () => {
    expect(parseWebsiteAddress("  example.com \n")?.url).toBe(
      "https://example.com",
    );
  });

  test("a whole URL is kept as typed; the name drops www and a trailing slash", () => {
    expect(parseWebsiteAddress("http://www.Example.com/")).toEqual({
      url: "http://www.Example.com/",
      host: "www.example.com",
      monitorName: "example.com",
    });
  });

  test("an API endpoint is named with its path, never its query", () => {
    expect(
      parseWebsiteAddress("https://api.acme.io/v1/health?token=x#top"),
    ).toEqual({
      url: "https://api.acme.io/v1/health?token=x#top",
      host: "api.acme.io",
      monitorName: "api.acme.io/v1/health",
    });
  });

  test("a port stays in the name", () => {
    expect(parseWebsiteAddress("localhost:8080/status")?.monitorName).toBe(
      "localhost:8080/status",
    );
    expect(parseWebsiteAddress("10.0.0.5")?.host).toBe("10.0.0.5");
  });

  test("a long address gives a name that fits", () => {
    const parsed: WebsiteAddress = address(
      `example.com/${"a".repeat(MONITOR_NAME_MAX_LENGTH * 2)}`,
    );

    expect(parsed.monitorName.length).toBe(MONITOR_NAME_MAX_LENGTH);
    expect(parsed.monitorName.startsWith("example.com/aaa")).toBe(true);
  });

  test.each([
    [""],
    ["   "],
    ["not an address"],
    ["intranet"],
    ["ftp://example.com"],
    ["mailto:ana@example.com"],
    ["https://"],
    ["javascript:alert(1)"],
    ["https://ana:secret@example.com"],
  ])("%j is not an address a website monitor checks", (text: string) => {
    expect(parseWebsiteAddress(text)).toBeNull();
  });
});

describe("the monitor made from it", () => {
  test("a Website monitor with Create Monitor's defaults", () => {
    const monitor: Monitor = buildWebsiteMonitor({
      address: address("example.com"),
      isApi: false,
      seeds: seeds,
    });

    expect(monitor.name).toBe("example.com");
    expect(monitor.monitorType).toBe(MonitorType.Website);
    expect(monitor.monitoringInterval).toBe(DEFAULT_MONITORING_INTERVAL);
    // As the monitor keeps it: a URL, with its root path.
    expect(getMonitorAddress(monitor.monitorSteps)).toBe(
      "https://example.com/",
    );
    expect(monitor.monitorSteps?.data?.defaultMonitorStatusId?.toString()).toBe(
      seeds.operationalStatusId.toString(),
    );
  });

  test("an API monitor when the person says it is an API endpoint", () => {
    expect(
      buildWebsiteMonitor({
        address: address("api.example.com/health"),
        isApi: true,
        seeds: seeds,
      }).monitorType,
    ).toBe(MonitorType.API);
  });

  test("its criteria mark it offline and open an incident of the most severe severity", () => {
    const monitor: Monitor = buildWebsiteMonitor({
      address: address("example.com"),
      isApi: false,
      seeds: seeds,
    });
    const instances: Array<MonitorCriteriaInstance> =
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
        .monitorCriteria.data!.monitorCriteriaInstanceArray;
    const offline: MonitorCriteriaInstance | undefined = instances.find(
      (instance: MonitorCriteriaInstance): boolean => {
        return (
          instance.data?.monitorStatusId?.toString() ===
          seeds.offlineStatusId.toString()
        );
      },
    );

    expect(offline?.data?.createIncidents).toBe(true);
    expect(getIncidentSeverityId(monitor.monitorSteps)).toBe(
      seeds.incidentSeverityId.toString(),
    );
  });

  test("a criteria switched off, or that opens nothing, names no severity", () => {
    const monitor: Monitor = buildWebsiteMonitor({
      address: address("example.com"),
      isApi: false,
      seeds: seeds,
    });

    for (const instance of monitor.monitorSteps!.data!
      .monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!
      .monitorCriteriaInstanceArray) {
      instance.data!.isEnabled = false;
    }

    expect(getIncidentSeverityId(monitor.monitorSteps)).toBeNull();
    expect(getIncidentSeverityId(undefined)).toBeNull();
    expect(getMonitorAddress(undefined)).toBe("");
  });

  test("its criteria are written in the reader's language", () => {
    const german: Translator = translatorFor("de");
    const inGerman: Monitor = buildWebsiteMonitor({
      address: address("example.com"),
      isApi: false,
      seeds: seeds,
      translator: german,
    });
    const inEnglish: Monitor = buildWebsiteMonitor({
      address: address("example.com"),
      isApi: false,
      seeds: seeds,
    });
    const names: (monitor: Monitor) => Array<string> = (
      monitor: Monitor,
    ): Array<string> => {
      return monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.map(
        (instance: MonitorCriteriaInstance): string => {
          return instance.data?.name || "";
        },
      );
    };

    expect(names(inGerman)).not.toEqual(names(inEnglish));
  });
});

const log: (
  response: Partial<FirstCheckAnswer> & { isOnline: boolean },
) => MonitorStepProbeResponse = (
  response: Partial<FirstCheckAnswer> & { isOnline: boolean },
): MonitorStepProbeResponse => {
  return {
    "step-1": {
      projectId: new ObjectID("00000000-0000-4000-8000-000000000009"),
      monitorStepId: new ObjectID("00000000-0000-4000-8000-000000000008"),
      monitorId: new ObjectID("00000000-0000-4000-8000-000000000007"),
      probeId: new ObjectID("00000000-0000-4000-8000-000000000006"),
      failureCause: response.failureCause || "",
      isOnline: response.isOnline,
      responseCode: response.responseCode,
      responseTimeInMs: response.responseTimeInMs,
    },
  } as unknown as MonitorStepProbeResponse;
};

describe("what the first check found", () => {
  test("each probe's latest answer, skipping probes that have not answered", () => {
    expect(
      readFirstCheckAnswers([
        log({ isOnline: true, responseCode: 200, responseTimeInMs: 312 }),
        undefined,
        null,
        {} as MonitorStepProbeResponse,
        log({ isOnline: false, failureCause: "Connection refused" }),
      ]),
    ).toEqual([
      {
        isOnline: true,
        responseCode: 200,
        responseTimeInMs: 312,
        failureCause: undefined,
      },
      {
        isOnline: false,
        responseCode: undefined,
        responseTimeInMs: undefined,
        failureCause: "Connection refused",
      },
    ]);
  });

  test.each([
    [{ isOnline: true, responseCode: 200 }, false],
    [{ isOnline: true, responseCode: 301 }, false],
    [{ isOnline: true, responseCode: 399 }, false],
    [{ isOnline: true, responseCode: 400 }, true],
    [{ isOnline: true, responseCode: 503 }, true],
    [{ isOnline: true, responseCode: 199 }, true],
    [{ isOnline: true }, true],
    [{ isOnline: false, responseCode: 200 }, true],
  ])(
    "%j is down: %s (the default criteria: no answer, or outside 200 to 399)",
    (answer: FirstCheckAnswer, isDown: boolean) => {
      expect(isDownAnswer(answer)).toBe(isDown);
    },
  );

  test("while no probe has answered: what is being waited for", () => {
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 2,
        answers: [],
      }),
    ).toEqual({
      text: "Checking example.com from 2 locations...",
      isDown: false,
      isWaiting: true,
    });
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 1,
        answers: [],
      }).text,
    ).toBe("Checking example.com from 1 location...");
  });

  test("with no probe at all: says so, and where probes are added", () => {
    const sentence: ReturnType<typeof describeFirstCheck> = describeFirstCheck({
      translator: english,
      host: "example.com",
      locationCount: 0,
      answers: [],
    });

    expect(sentence.text).toBe(
      "No location checks example.com yet. Probes are added under Monitors > Settings > Probes.",
    );
    expect(sentence.isWaiting).toBe(false);
  });

  test("answered: the code, the average time and how many locations", () => {
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 2,
        answers: [
          { isOnline: true, responseCode: 200, responseTimeInMs: 300 },
          { isOnline: true, responseCode: 200, responseTimeInMs: 325 },
        ],
      }),
    ).toEqual({
      text: "example.com answered 200 in 313 ms from 2 locations.",
      isDown: false,
      isWaiting: false,
    });
  });

  test("answered from one location so far", () => {
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 2,
        answers: [
          { isOnline: true, responseCode: 204, responseTimeInMs: 1234 },
        ],
      }).text,
    ).toBe("example.com answered 204 in 1,234 ms from 1 location.");
  });

  test("an error answer counts as down, and says an incident opens", () => {
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 2,
        answers: [
          { isOnline: true, responseCode: 503, responseTimeInMs: 30 },
          { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
        ],
      }),
    ).toEqual({
      text: "example.com answered 503 from 1 location. That counts as down, so an incident opens.",
      isDown: true,
      isWaiting: false,
    });
  });

  test("no answer: why, when the probe said", () => {
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 2,
        answers: [
          { isOnline: false, failureCause: "Connection refused" },
          { isOnline: false, failureCause: "Timed out" },
        ],
      }),
    ).toEqual({
      text: "example.com did not answer from 2 locations: Connection refused",
      isDown: true,
      isWaiting: false,
    });
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 1,
        answers: [{ isOnline: false }],
      }).text,
    ).toBe("example.com did not answer from 1 location.");
  });

  test("in the reader's language, the values kept", () => {
    const text: string = describeFirstCheck({
      translator: translatorFor("de"),
      host: "example.com",
      locationCount: 2,
      answers: [
        { isOnline: true, responseCode: 200, responseTimeInMs: 312 },
        { isOnline: true, responseCode: 200, responseTimeInMs: 312 },
      ],
    }).text;

    expect(text).not.toBe(
      "example.com answered 200 in 312 ms from 2 locations.",
    );
    expect(text).toContain("example.com");
    expect(text).toContain("200");
    expect(text).toContain("312");
  });
});

const whoFacts: (extra?: Partial<WhoIsToldFacts>) => WhoIsToldFacts = (
  extra?: Partial<WhoIsToldFacts>,
): WhoIsToldFacts => {
  return {
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
    ...extra,
  };
};

describe("who is told", () => {
  test("a project with no policy or rule, and someone who may set one up: the setup makes a policy", () => {
    expect(getWhoIsToldMode(whoFacts())).toBe(WhoIsToldMode.CreatePolicy);
  });

  test("a project that pages people already keeps its own policies and rules", () => {
    expect(getWhoIsToldMode(whoFacts({ policyCount: 1 }))).toBe(
      WhoIsToldMode.ExistingPolicy,
    );
    expect(getWhoIsToldMode(whoFacts({ incidentRuleCount: 2 }))).toBe(
      WhoIsToldMode.ExistingPolicy,
    );
    expect(getWhoIsToldMode(whoFacts({ alertRuleCount: 1 }))).toBe(
      WhoIsToldMode.ExistingPolicy,
    );
    // Whoever reads it, permission or not: nothing is made beside it.
    expect(
      getWhoIsToldMode(
        whoFacts({
          policyCount: 3,
          mayCreatePolicy: false,
          mayAddRules: false,
        }),
      ),
    ).toBe(WhoIsToldMode.ExistingPolicy);
  });

  test.each([
    [{ mayCreatePolicy: false }],
    [{ mayAddEscalationRules: false }],
    [{ mayAddRules: false }],
  ])(
    "someone who may not make every part of it (%j) is told as the monitor's owner",
    (extra: Partial<WhoIsToldFacts>) => {
      expect(getWhoIsToldMode(whoFacts(extra))).toBe(
        WhoIsToldMode.OwnerEmailOnly,
      );
    },
  );

  test.each([
    [{ policyCount: null }],
    [{ incidentRuleCount: null }],
    [{ alertRuleCount: null }],
  ])(
    "counts that could not be read (%j) make nothing",
    (extra: Partial<WhoIsToldFacts>) => {
      expect(getWhoIsToldMode(whoFacts(extra))).toBe(
        WhoIsToldMode.OwnerEmailOnly,
      );
    },
  );
});

const progressFacts: (
  extra?: Partial<WebsiteDownProgressFacts>,
) => WebsiteDownProgressFacts = (
  extra?: Partial<WebsiteDownProgressFacts>,
): WebsiteDownProgressFacts => {
  return {
    hasMonitor: false,
    isWhoIsToldDone: false,
    testStatus: null,
    isTestSkipped: false,
    ...extra,
  };
};

const doneKeys: (facts: WebsiteDownProgressFacts) => Array<string> = (
  facts: WebsiteDownProgressFacts,
): Array<string> => {
  return getWebsiteDownProgress(facts)
    .filter((step: { isDone: boolean }): boolean => {
      return step.isDone;
    })
    .map((step: { key: string }): string => {
      return step.key;
    });
};

describe("which steps are done, from the records", () => {
  test("the steps, in order, under the setup's key", () => {
    expect(WEBSITE_DOWN_SETUP).toBe("website_down");
    expect(
      getWebsiteDownProgress(progressFacts()).map(
        (step: { key: string }): string => {
          return step.key;
        },
      ),
    ).toEqual([
      WebsiteDownStep.Check,
      WebsiteDownStep.WhoIsTold,
      WebsiteDownStep.Test,
    ]);
  });

  test("a monitor finishes the first step", () => {
    expect(doneKeys(progressFacts({ hasMonitor: true }))).toEqual([
      WebsiteDownStep.Check,
    ]);
  });

  test("who is told, once saved", () => {
    expect(
      doneKeys(progressFacts({ hasMonitor: true, isWhoIsToldDone: true })),
    ).toEqual([WebsiteDownStep.Check, WebsiteDownStep.WhoIsTold]);
  });

  test("the test, once acknowledged or skipped", () => {
    expect(
      doneKeys(
        progressFacts({
          hasMonitor: true,
          isWhoIsToldDone: true,
          testStatus: OnCallTestPageStatus.Acknowledged,
        }),
      ),
    ).toHaveLength(3);
    expect(
      doneKeys(
        progressFacts({
          hasMonitor: true,
          isWhoIsToldDone: true,
          isTestSkipped: true,
        }),
      ),
    ).toHaveLength(3);
  });

  test.each([
    [OnCallTestPageStatus.Paging],
    [OnCallTestPageStatus.Ended],
    [OnCallTestPageStatus.Failed],
  ])("a test that is %s is not done", (status: OnCallTestPageStatus) => {
    expect(isTestDone(progressFacts({ testStatus: status }))).toBe(false);
  });

  test("nothing after a missing monitor counts: a deleted monitor is the step to do again", () => {
    expect(
      doneKeys(
        progressFacts({
          hasMonitor: false,
          isWhoIsToldDone: true,
          testStatus: OnCallTestPageStatus.Acknowledged,
        }),
      ),
    ).toEqual([]);
  });

  test("finished only when the test page was acknowledged, never when it was skipped", () => {
    expect(
      isWebsiteDownFinished(
        progressFacts({
          hasMonitor: true,
          isWhoIsToldDone: true,
          testStatus: OnCallTestPageStatus.Acknowledged,
        }),
      ),
    ).toBe(true);
    expect(
      isWebsiteDownFinished(
        progressFacts({
          hasMonitor: true,
          isWhoIsToldDone: true,
          isTestSkipped: true,
        }),
      ),
    ).toBe(false);
    expect(
      isWebsiteDownFinished(
        progressFacts({
          hasMonitor: true,
          testStatus: OnCallTestPageStatus.Acknowledged,
        }),
      ),
    ).toBe(false);
  });
});

const acknowledged: OnCallTestPageResult = {
  executionLogId: "log-1",
  kind: "Person" as OnCallTestPageKind,
  recordKind: OnCallTestPageRecordKind.Incident,
  severityName: "Critical",
  walksEscalation: false,
  status: OnCallTestPageStatus.Acknowledged,
  statusMessage: "",
  startedAt: "2026-11-11T10:00:00.000Z",
  endsAt: "2026-11-11T10:30:00.000Z",
  steps: [],
};

const summaryFacts: (
  extra?: Partial<WebsiteDownSummaryFacts>,
) => WebsiteDownSummaryFacts = (
  extra?: Partial<WebsiteDownSummaryFacts>,
): WebsiteDownSummaryFacts => {
  return {
    monitorName: "example.com",
    intervalText: "Every 5 minutes",
    locationCount: 2,
    incidentSeverityName: "Critical",
    mode: WhoIsToldMode.CreatePolicy,
    policyName: WEBSITE_DOWN_POLICY_NAME,
    policyResponders: ["Ana Lopez", "Platform"],
    isMonitorOwner: true,
    canSendEmail: true,
    testResult: acknowledged,
    testResultSentence: "Ana Lopez acknowledged it by email after 14 seconds.",
    ...extra,
  };
};

const rowText: (
  rows: Array<WebsiteDownSummaryRow>,
  key: string,
) => string | undefined = (
  rows: Array<WebsiteDownSummaryRow>,
  key: string,
): string | undefined => {
  return rows.find((row: WebsiteDownSummaryRow): boolean => {
    return row.key === key;
  })?.text;
};

describe("the summary, read from the records", () => {
  test("what is checked, what happens, who is told and the test", () => {
    const rows: Array<WebsiteDownSummaryRow> = getWebsiteDownSummaryRows(
      english,
      summaryFacts(),
    );

    expect(rows).toEqual([
      {
        key: "checked",
        label: "Checked",
        text: "Every 5 minutes, from 2 locations.",
      },
      {
        key: "when_down",
        label: "When it goes down",
        text: "If it does not answer, or answers with an error, OneUptime opens a Critical incident.",
      },
      {
        key: "who_is_told",
        label: "Who is told",
        text: 'The on-call policy "Default on-call policy" pages Ana Lopez, Platform for every new incident and alert. You own this monitor, so you are emailed when its status changes.',
      },
      {
        key: "tested",
        label: "Tested",
        text: "Ana Lopez acknowledged it by email after 14 seconds.",
      },
    ]);
  });

  test("one location is one", () => {
    expect(
      rowText(
        getWebsiteDownSummaryRows(english, summaryFacts({ locationCount: 1 })),
        "checked",
      ),
    ).toBe("Every 5 minutes, from 1 location.");
  });

  test("criteria that open no incident say the status changes", () => {
    expect(
      rowText(
        getWebsiteDownSummaryRows(
          english,
          summaryFacts({ incidentSeverityName: null }),
        ),
        "when_down",
      ),
    ).toBe(
      "If it does not answer, or answers with an error, its status changes to Offline.",
    );
  });

  test("a policy whose responders could not be read is named alone", () => {
    expect(
      rowText(
        getWebsiteDownSummaryRows(
          english,
          summaryFacts({ policyResponders: [] }),
        ),
        "who_is_told",
      ),
    ).toContain(
      'The on-call policy "Default on-call policy" runs for every new incident and alert.',
    );
  });

  test("a project that paged people already: its own policies and rules", () => {
    expect(
      rowText(
        getWebsiteDownSummaryRows(
          english,
          summaryFacts({
            mode: WhoIsToldMode.ExistingPolicy,
            policyName: null,
            policyResponders: [],
          }),
        ),
        "who_is_told",
      ),
    ).toBe(
      "This project's on-call policies and rules decide who is paged. You own this monitor, so you are emailed when its status changes.",
    );
  });

  test("someone who could not set paging up: told as the monitor's owner", () => {
    expect(
      rowText(
        getWebsiteDownSummaryRows(
          english,
          summaryFacts({
            mode: WhoIsToldMode.OwnerEmailOnly,
            policyName: null,
            policyResponders: [],
          }),
        ),
        "who_is_told",
      ),
    ).toBe("You own this monitor, so you are emailed when its status changes.");
  });

  test("never claims an email the server cannot send", () => {
    const text: string | undefined = rowText(
      getWebsiteDownSummaryRows(
        english,
        summaryFacts({
          mode: WhoIsToldMode.OwnerEmailOnly,
          policyName: null,
          canSendEmail: false,
        }),
      ),
      "who_is_told",
    );

    expect(text).toBe(
      "You own this monitor, but this server cannot send email yet, so nobody is emailed.",
    );
    expect(text).not.toContain("you are emailed");
  });

  test("nothing read about ownership: says only what the server does anyway", () => {
    expect(
      rowText(
        getWebsiteDownSummaryRows(
          english,
          summaryFacts({
            mode: WhoIsToldMode.OwnerEmailOnly,
            policyName: null,
            isMonitorOwner: false,
          }),
        ),
        "who_is_told",
      ),
    ).toBe("The project's owners are emailed about incidents nobody owns.");
  });

  test.each([
    [null],
    [{ ...acknowledged, status: OnCallTestPageStatus.Paging }],
    [{ ...acknowledged, status: OnCallTestPageStatus.Ended }],
  ])(
    "a test not acknowledged (%j) is not claimed",
    (result: OnCallTestPageResult | null) => {
      expect(
        rowText(
          getWebsiteDownSummaryRows(
            english,
            summaryFacts({ testResult: result }),
          ),
          "tested",
        ),
      ).toBe(WEBSITE_DOWN_COPY.summaryNotTested);
    },
  );
});

describe("its words", () => {
  const words: Array<string> = Object.entries(WEBSITE_DOWN_COPY)
    .filter(([name]: [string, string]): boolean => {
      return name !== "addressPlaceholder";
    })
    .map(([, value]: [string, string]): string => {
      return value;
    });

  const languages: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(".json", "");
    });

  test("every one is a key of en.json", () => {
    const en: Record<string, string> = readLocale("en");

    for (const word of words) {
      expect(en[word]).toBe(word);
    }
  });

  test("and is translated in every language", () => {
    expect(languages.length).toBe(17);

    for (const language of languages) {
      const table: Record<string, string> = readLocale(language);
      const untranslated: Array<string> = words.filter(
        (word: string): boolean => {
          return !table[word] || table[word] === word;
        },
      );

      expect({ language, untranslated }).toEqual({
        language,
        untranslated: [],
      });
    }
  });

  test("a translation keeps every placeholder of its sentence", () => {
    for (const language of languages) {
      const table: Record<string, string> = readLocale(language);

      for (const word of words) {
        const placeholders: Array<string> = word.match(/{{\w+}}/g) || [];

        for (const placeholder of placeholders) {
          expect({
            language,
            word,
            kept: table[word]!.includes(placeholder),
          }).toEqual({ language, word, kept: true });
        }
      }
    }
  });
});
