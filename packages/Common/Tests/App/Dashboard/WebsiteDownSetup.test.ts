import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CHECK_HELP_FROM_LOCATIONS,
  FirstCheckAnswer,
  FirstCheckSentence,
  FirstCheckVerdict,
  MONITOR_NAME_MAX_LENGTH,
  WEBSITE_DOWN_COPY,
  WEBSITE_DOWN_OPTIONAL_STEPS,
  WEBSITE_DOWN_POLICY_NAME,
  WEBSITE_DOWN_SETUP,
  WEBSITE_DOWN_STEPS,
  WEBSITE_DOWN_TERMS,
  WebsiteAddress,
  WebsiteDownProgressFacts,
  WebsiteDownStatusPageChoice,
  WebsiteDownStep,
  WebsiteDownSummaryFacts,
  WebsiteDownSummaryRow,
  WebsiteMonitorSeeds,
  WhoIsToldFacts,
  WhoIsToldMode,
  areWhoIsToldCountsKnown,
  buildWebsiteMonitor,
  describeFirstCheck,
  getCheckHelpTemplate,
  getIncidentSeverityId,
  getMonitorAddress,
  getOtherMonitorSentence,
  getPagedByPhonePage,
  getStatusPageShownSentence,
  getWebsiteAddressIdentity,
  getWebsiteDownProgress,
  getFirstCheckVerdict,
  getPaymentNeededText,
  getWebsiteDownSummaryRows,
  getWhoIsToldDoneLine,
  getWhoIsToldHelp,
  getWhoIsToldMode,
  hasStatusPageStep,
  isDownAnswer,
  isFirstCheckSettled,
  isMonitorCheckingAddress,
  isSameWebsiteAddress,
  isStatusPageSetupOffered,
  isTestDone,
  isWebsiteDownFinished,
  parseWebsiteAddress,
  readFirstCheckAnswers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { DEFAULT_MONITORING_INTERVAL } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { MonitorStepProbeResponse } from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  formatPriceInUSD,
} from "../../../Types/Billing/PayAsYouGoPricing";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { Translator, createTranslator } from "../../../Types/Translator";
import { translateRecordName } from "../../../Utils/DefaultRecordNames";
import { StateListType } from "../../../Utils/StateOrder";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * The website-down guided setup's rules and words (issue #6804): the
 * address and the monitor made from it, what the first check says, who is
 * told, which step a returning person lands on, and a summary whose every
 * claim comes from the records it is handed.
 */

const english: Translator = createTranslator(undefined, "en");

// A value that is a count or a code, written in digits.
const ONLY_DIGITS: RegExp = /^\d+$/;

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

  test("trailing slashes, however many, are not part of the name; slashes inside it are", () => {
    expect(parseWebsiteAddress("acme.example/health///")?.monitorName).toBe(
      "acme.example/health",
    );
    expect(parseWebsiteAddress("acme.example//a//")?.monitorName).toBe(
      "acme.example//a",
    );
    expect(parseWebsiteAddress("acme.example////")?.monitorName).toBe(
      "acme.example",
    );
    // A long run of them in the middle is read once, not again at each one.
    expect(
      parseWebsiteAddress(`acme.example/a${"/".repeat(20000)}b/`)?.monitorName,
    ).toBe(`acme.example/a${"/".repeat(MONITOR_NAME_MAX_LENGTH - 14)}`);
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

/*
 * ONE ADDRESS, HOWEVER IT WAS TYPED (#7059): how the setup knows a monitor
 * of this person's checks the address typed, so it makes no second one.
 */
describe("one address, however it was typed", () => {
  test.each([
    ["acme.example", "https://acme.example"],
    ["acme.example", "https://acme.example/"],
    ["ACME.Example", "https://acme.example"],
    ["  acme.example  ", "acme.example"],
    ["https://acme.example:443/", "acme.example"],
    ["http://acme.example:80", "http://acme.example/"],
    ["acme.example/health/", "https://acme.example/health"],
    ["acme.example/health///", "https://acme.example/health"],
    ["acme.example//", "acme.example"],
    ["acme.example/#top", "acme.example"],
    ["acme.example/status?x=1", "https://acme.example/status?x=1"],
    ["localhost:8080/status", "https://LOCALHOST:8080/status/"],
  ])("%j and %j are one address", (left: string, right: string) => {
    expect(isSameWebsiteAddress(left, right)).toBe(true);
    expect(isSameWebsiteAddress(right, left)).toBe(true);
    expect(getWebsiteAddressIdentity(left)).toBe(
      getWebsiteAddressIdentity(right),
    );
  });

  test.each([
    ["http://acme.example", "https://acme.example"],
    ["www.acme.example", "acme.example"],
    ["status.acme.example", "acme.example"],
    ["acme.example:8080", "acme.example"],
    ["acme.example/health", "acme.example"],
    ["acme.example/Health", "acme.example/health"],
    ["acme.example?x=1", "acme.example"],
    ["acme.example?x=1", "acme.example?x=2"],
  ])("%j and %j are two checks", (left: string, right: string) => {
    expect(isSameWebsiteAddress(left, right)).toBe(false);
    expect(isSameWebsiteAddress(right, left)).toBe(false);
  });

  test("what makes an address one: scheme, host, port, path and query", () => {
    expect(getWebsiteAddressIdentity("acme.example")).toBe(
      "https://acme.example",
    );
    expect(getWebsiteAddressIdentity("ACME.example:8443/Health/?a=1#top")).toBe(
      "https://acme.example:8443/Health?a=1",
    );
    // Every address the setup parses has one.
    expect(
      getWebsiteAddressIdentity(address("api.acme.example/v1/health").url),
    ).toBe("https://api.acme.example/v1/health");
  });

  test.each([
    [""],
    ["   "],
    ["not an address"],
    ["ftp://acme.example"],
    ["mailto:ana@acme.example"],
    ["https://ana:secret@acme.example"],
    ["javascript:alert(1)"],
    ["https://"],
  ])("%j is no address, and never the same as one", (text: string) => {
    expect(getWebsiteAddressIdentity(text)).toBeNull();
    expect(isSameWebsiteAddress(text, text)).toBe(false);
    expect(isSameWebsiteAddress(text, "acme.example")).toBe(false);
  });
});

describe("a monitor of this person's that checks the address (#7059)", () => {
  const madeFor: (text: string) => Monitor = (text: string): Monitor => {
    return buildWebsiteMonitor({
      address: address(text),
      isApi: false,
      seeds: seeds,
    });
  };

  test("one made for the address checks it, however the address is typed now", () => {
    const monitor: Monitor = madeFor("acme.example");

    for (const typed of [
      "acme.example",
      "https://ACME.example/",
      "acme.example//",
    ]) {
      expect(
        isMonitorCheckingAddress({ monitor: monitor, address: address(typed) }),
      ).toBe(true);
    }
  });

  test("an API monitor for the endpoint checks it too", () => {
    expect(
      isMonitorCheckingAddress({
        monitor: buildWebsiteMonitor({
          address: address("api.acme.example/health"),
          isApi: true,
          seeds: seeds,
        }),
        address: address("https://api.acme.example/health/"),
      }),
    ).toBe(true);
  });

  test("one that is archived or turned off is no longer checking it", () => {
    const monitor: Monitor = madeFor("acme.example");

    expect(
      isMonitorCheckingAddress({
        monitor: { monitorSteps: monitor.monitorSteps, isArchived: true },
        address: address("acme.example"),
      }),
    ).toBe(false);
    expect(
      isMonitorCheckingAddress({
        monitor: {
          monitorSteps: monitor.monitorSteps,
          disableActiveMonitoring: true,
        },
        address: address("acme.example"),
      }),
    ).toBe(false);
    expect(
      isMonitorCheckingAddress({
        monitor: {
          monitorSteps: monitor.monitorSteps,
          isArchived: false,
          disableActiveMonitoring: false,
        },
        address: address("acme.example"),
      }),
    ).toBe(true);
  });

  test("one for another address, or with no step to read, does not", () => {
    expect(
      isMonitorCheckingAddress({
        monitor: madeFor("status.acme.example"),
        address: address("acme.example"),
      }),
    ).toBe(false);
    expect(
      isMonitorCheckingAddress({
        monitor: madeFor("http://acme.example"),
        address: address("acme.example"),
      }),
    ).toBe(false);
    expect(
      isMonitorCheckingAddress({
        monitor: { monitorSteps: undefined },
        address: address("acme.example"),
      }),
    ).toBe(false);
    expect(
      isMonitorCheckingAddress({
        monitor: { monitorSteps: null },
        address: address("acme.example"),
      }),
    ).toBe(false);
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

  test("until the first read returns: checking, never no location (#7410)", () => {
    const sentence: FirstCheckSentence = describeFirstCheck({
      translator: english,
      host: "example.com",
      isRead: false,
      // What the page passes while it has read nothing yet.
      locationCount: 0,
      answers: [],
    });

    expect(sentence).toEqual({
      text: "Checking example.com...",
      verdict: null,
      verdictKind: FirstCheckVerdict.None,
      isDown: false,
      isWaiting: true,
    });
    expect(sentence.text).not.toContain("No location");
  });

  test("the not-read sentence is worded in every language, the host kept", () => {
    for (const language of [...DASHBOARD_LANGUAGES]) {
      const text: string = describeFirstCheck({
        translator: dashboardTranslator(language),
        host: "example.com",
        isRead: false,
        locationCount: 0,
        answers: [],
      }).text;

      expect({ language, worded: text !== "Checking example.com..." }).toEqual({
        language,
        worded: true,
      });
      expect(withoutIsolateMarks(text)).toContain("example.com");
    }
  });

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
      verdict: null,
      verdictKind: FirstCheckVerdict.None,
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

  test("with no probe at all, once read: says so, and where probes are added", () => {
    const sentence: FirstCheckSentence = describeFirstCheck({
      translator: english,
      host: "example.com",
      isRead: true,
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
      text: "example.com answered 200 in 313\u00A0ms from 2 locations.",
      verdict: null,
      verdictKind: FirstCheckVerdict.None,
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
    ).toBe("example.com answered 204 in 1,234\u00A0ms from 1 location.");
  });

  test("an error from its one location counts as down, and says an incident opens", () => {
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 1,
        answers: [{ isOnline: true, responseCode: 503, responseTimeInMs: 30 }],
      }),
    ).toEqual({
      text: "example.com answered 503 from 1 location.",
      verdict: "That counts as down, so an incident opens.",
      verdictKind: FirstCheckVerdict.Down,
      isDown: true,
      isWaiting: false,
    });
  });

  test("an error from every location: an incident opens", () => {
    const sentence: FirstCheckSentence = describeFirstCheck({
      translator: english,
      host: "example.com",
      locationCount: 2,
      answers: [
        { isOnline: true, responseCode: 503, responseTimeInMs: 30 },
        { isOnline: false, failureCause: "Connection refused" },
      ],
    });

    expect(sentence.text).toBe("example.com answered 503 from 2 locations.");
    expect(sentence.verdict).toBe("That counts as down, so an incident opens.");
  });

  /*
   * The bug (#7410): one probe of several got an error, and the step said
   * an incident opens. The server changes nothing until all of a new
   * monitor's probes agree.
   */
  test("an error from one location of two, the other up: no incident opens", () => {
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
      text: "example.com answered 503 from 1 location.",
      verdict: "example.com was up from 1 location, so no incident opens.",
      verdictKind: FirstCheckVerdict.StaysUp,
      isDown: true,
      isWaiting: false,
    });
  });

  test("one location of three with no answer, the others up: says which failed, that the others answered, and no incident", () => {
    const sentence: FirstCheckSentence = describeFirstCheck({
      translator: english,
      host: "example.com",
      locationCount: 3,
      answers: [
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
        { isOnline: false, failureCause: "Connection refused" },
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
      ],
    });

    expect(sentence.text).toBe(
      "example.com did not answer from 1 location: Connection refused",
    );
    expect(sentence.verdict).toBe(
      "example.com was up from 2 locations, so no incident opens.",
    );
    expect(sentence.verdict).not.toContain("an incident opens");
  });

  test("two of three down, the third yet to answer: waits for it, claiming nothing", () => {
    const sentence: FirstCheckSentence = describeFirstCheck({
      translator: english,
      host: "example.com",
      locationCount: 3,
      answers: [
        { isOnline: false, failureCause: "Connection refused" },
        { isOnline: false, failureCause: "Connection refused" },
      ],
    });

    expect(sentence.verdict).toBe("Waiting for 1 more location...");
    expect(sentence.verdictKind).toBe(FirstCheckVerdict.Waiting);
    expect(sentence.isWaiting).toBe(true);
  });

  test("a minimum the monitor sets is the one counted: two of three agreeing opens one", () => {
    const sentence: FirstCheckSentence = describeFirstCheck({
      translator: english,
      host: "example.com",
      locationCount: 3,
      minimumProbeAgreement: 2,
      answers: [
        { isOnline: false, failureCause: "Connection refused" },
        { isOnline: false, failureCause: "Connection refused" },
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
      ],
    });

    expect(sentence.verdict).toBe("That counts as down, so an incident opens.");
  });

  test("a disconnected location is left out, as the server leaves it out", () => {
    // Three enabled probes, one disconnected: both connected ones down is all.
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 3,
        activeLocationCount: 2,
        answers: [
          { isOnline: false, failureCause: "Connection refused" },
          { isOnline: false, failureCause: "Connection refused" },
        ],
      }).verdictKind,
    ).toBe(FirstCheckVerdict.Down);
  });

  test("as many up as down, both enough: says what each found, never which wins", () => {
    const sentence: FirstCheckSentence = describeFirstCheck({
      translator: english,
      host: "example.com",
      locationCount: 2,
      minimumProbeAgreement: 1,
      answers: [
        { isOnline: true, responseCode: 500, responseTimeInMs: 30 },
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
      ],
    });

    expect(sentence.verdictKind).toBe(FirstCheckVerdict.Split);
    expect(sentence.verdict).toBe("example.com was up from 1 location.");
  });

  test("criteria that open no incident: its status changes, and no incident is claimed", () => {
    expect(
      describeFirstCheck({
        translator: english,
        host: "example.com",
        locationCount: 1,
        opensIncident: false,
        answers: [{ isOnline: false }],
      }).verdict,
    ).toBe("That counts as down, so its status changes to Offline.");
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
      verdict: "That counts as down, so an incident opens.",
      verdictKind: FirstCheckVerdict.Down,
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
      "example.com answered 200 in 312\u00A0ms from 2 locations.",
    );
    expect(text).toContain("example.com");
    expect(text).toContain("200");
    expect(text).toContain("312");
  });

  test("each verdict is worded in every language, its values kept", () => {
    const cases: Array<{
      english: string;
      data: Parameters<typeof describeFirstCheck>[0];
    }> = [
      {
        english: "That counts as down, so an incident opens.",
        data: {
          translator: english,
          host: "example.com",
          locationCount: 1,
          answers: [{ isOnline: false }],
        },
      },
      {
        english: "That counts as down, so its status changes to Offline.",
        data: {
          translator: english,
          host: "example.com",
          locationCount: 1,
          opensIncident: false,
          answers: [{ isOnline: false }],
        },
      },
      {
        english: "example.com was up from 2 locations, so no incident opens.",
        data: {
          translator: english,
          host: "example.com",
          locationCount: 3,
          answers: [
            { isOnline: false },
            { isOnline: true, responseCode: 200 },
            { isOnline: true, responseCode: 200 },
          ],
        },
      },
      {
        english: "Waiting for 2 more locations...",
        data: {
          translator: english,
          host: "example.com",
          locationCount: 3,
          answers: [{ isOnline: false }],
        },
      },
      {
        english: "example.com was up from 1 location.",
        data: {
          translator: english,
          host: "example.com",
          locationCount: 2,
          minimumProbeAgreement: 1,
          answers: [{ isOnline: false }, { isOnline: true, responseCode: 200 }],
        },
      },
      {
        english: "example.com answered 503 from 1 location.",
        data: {
          translator: english,
          host: "example.com",
          locationCount: 1,
          answers: [{ isOnline: true, responseCode: 503 }],
        },
      },
    ];

    for (const testCase of cases) {
      const inEnglish: FirstCheckSentence = describeFirstCheck(testCase.data);

      expect([inEnglish.text, inEnglish.verdict]).toContain(testCase.english);

      for (const language of [...DASHBOARD_LANGUAGES]) {
        const worded: FirstCheckSentence = describeFirstCheck({
          ...testCase.data,
          translator: dashboardTranslator(language),
        });
        const line: string = withoutIsolateMarks(
          (inEnglish.text === testCase.english
            ? worded.text
            : worded.verdict) || "",
        );

        expect({ language, line: line !== testCase.english }).toEqual({
          language,
          line: true,
        });

        for (const value of testCase.english.match(/example\.com|\d+/g) || []) {
          // A count in the reader's digits ("۲" in Persian), a code as written.
          const readerValue: string = ONLY_DIGITS.test(value)
            ? dashboardTranslator(language).formatNumber(Number(value))
            : value;

          expect({
            language,
            value,
            kept: line.includes(value) || line.includes(readerValue),
          }).toEqual({
            language,
            value,
            kept: true,
          });
        }
      }
    }
  });
});

describe("what the answers mean under the probe agreement rule (#7410)", () => {
  const up: FirstCheckAnswer = { isOnline: true, responseCode: 200 };
  const down: FirstCheckAnswer = { isOnline: false };

  const verdictOf: (data: {
    active: number;
    answers: Array<FirstCheckAnswer>;
    minimum?: number | null;
  }) => FirstCheckVerdict = (data: {
    active: number;
    answers: Array<FirstCheckAnswer>;
    minimum?: number | null;
  }): FirstCheckVerdict => {
    return getFirstCheckVerdict({
      activeLocationCount: data.active,
      answers: data.answers,
      minimumProbeAgreement: data.minimum,
    });
  };

  test.each([
    // [active, answers, minimum, verdict]
    [1, [up], null, FirstCheckVerdict.None],
    [1, [down], null, FirstCheckVerdict.Down],
    [2, [down, down], null, FirstCheckVerdict.Down],
    [2, [down, up], null, FirstCheckVerdict.StaysUp],
    [2, [down], null, FirstCheckVerdict.Waiting],
    [3, [down, up, up], null, FirstCheckVerdict.StaysUp],
    [3, [down, down, up], null, FirstCheckVerdict.StaysUp],
    [3, [down, down], null, FirstCheckVerdict.Waiting],
    [3, [down, up], null, FirstCheckVerdict.StaysUp],
    [3, [down, down, down], null, FirstCheckVerdict.Down],
    [3, [down, down, up], 2, FirstCheckVerdict.Down],
    [3, [down, up, up], 2, FirstCheckVerdict.StaysUp],
    [3, [down], 2, FirstCheckVerdict.Waiting],
    // One required: the first down answer carries it, as the server judges it then.
    [3, [down], 1, FirstCheckVerdict.Down],
    [2, [down, up], 1, FirstCheckVerdict.Split],
    [4, [down, down, up, up], 2, FirstCheckVerdict.Split],
    // A minimum above the locations that take part is all of them.
    [2, [down, down], 5, FirstCheckVerdict.Down],
    [0, [], null, FirstCheckVerdict.None],
  ] as Array<
    [number, Array<FirstCheckAnswer>, number | null, FirstCheckVerdict]
  >)(
    "%i locations, answers %j, minimum %s: %s",
    (
      active: number,
      answers: Array<FirstCheckAnswer>,
      minimum: number | null,
      verdict: FirstCheckVerdict,
    ) => {
      expect(verdictOf({ active, answers, minimum })).toBe(verdict);
    },
  );

  /*
   * The server's own decision, written out as MonitorResourceUtil.
   * checkProbeAgreement makes it, for every way three locations can answer:
   * the verdict most of them reached wins when it is enough, ties going to
   * the one counted first. Down is said only where the server changes the
   * status whichever order it reads the probes in.
   */
  const serverOpens: (data: {
    active: number;
    answers: Array<FirstCheckAnswer>;
    minimum: number | null;
    downFirst: boolean;
  }) => boolean = (data: {
    active: number;
    answers: Array<FirstCheckAnswer>;
    minimum: number | null;
    downFirst: boolean;
  }): boolean => {
    const required: number = Math.min(data.minimum ?? data.active, data.active);
    const downCount: number = data.answers.filter(isDownAnswer).length;
    const upCount: number = data.answers.length - downCount;
    const counts: Array<[string, number]> = data.downFirst
      ? [
          ["down", downCount],
          ["up", upCount],
        ]
      : [
          ["up", upCount],
          ["down", downCount],
        ];
    let winner: string = "";
    let max: number = 0;

    for (const [key, count] of counts) {
      if (count > max) {
        max = count;
        winner = key;
      }
    }

    return max >= required && winner === "down";
  };

  test("says down exactly when the server opens one, whichever probe it reads first", () => {
    const shapes: Array<Array<FirstCheckAnswer>> = [];

    for (let answered: number = 0; answered <= 3; answered++) {
      for (let downs: number = 0; downs <= answered; downs++) {
        shapes.push([
          ...Array(downs).fill(down),
          ...Array(answered - downs).fill(up),
        ]);
      }
    }

    for (const minimum of [null, 1, 2, 3]) {
      for (const answers of shapes) {
        const verdict: FirstCheckVerdict = verdictOf({
          active: 3,
          answers,
          minimum,
        });
        const opensEitherWay: boolean =
          serverOpens({ active: 3, answers, minimum, downFirst: true }) &&
          serverOpens({ active: 3, answers, minimum, downFirst: false });
        const opensOneWay: boolean =
          serverOpens({ active: 3, answers, minimum, downFirst: true }) !==
          serverOpens({ active: 3, answers, minimum, downFirst: false });

        expect({
          minimum,
          answers: answers.map(isDownAnswer),
          saysDown: verdict === FirstCheckVerdict.Down,
        }).toEqual({
          minimum,
          answers: answers.map(isDownAnswer),
          saysDown: opensEitherWay,
        });

        // A tie the server breaks by its order: never "opens", never "no incident".
        if (opensOneWay) {
          expect([
            FirstCheckVerdict.Split,
            FirstCheckVerdict.Waiting,
          ]).toContain(verdict);
        }

        // "No incident opens" is said only where the server opens none.
        if (verdict === FirstCheckVerdict.StaysUp) {
          expect([
            serverOpens({ active: 3, answers, minimum, downFirst: true }),
            serverOpens({ active: 3, answers, minimum, downFirst: false }),
          ]).toEqual([false, false]);
        }
      }
    }
  });

  test("settled once every connected location has answered", () => {
    expect(isFirstCheckSettled({ activeLocationCount: 2, answers: [] })).toBe(
      false,
    );
    expect(
      isFirstCheckSettled({ activeLocationCount: 2, answers: [down] }),
    ).toBe(false);
    expect(
      isFirstCheckSettled({ activeLocationCount: 2, answers: [down, up] }),
    ).toBe(true);
    // No connected location: nothing settles it but an answer.
    expect(isFirstCheckSettled({ activeLocationCount: 0, answers: [] })).toBe(
      false,
    );
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
      // And say so, so the step can ask again rather than guess (#7059).
      expect(areWhoIsToldCountsKnown(whoFacts(extra))).toBe(false);
    },
  );

  test("counts read, none or some, whoever reads them, are known", () => {
    expect(areWhoIsToldCountsKnown(whoFacts())).toBe(true);
    expect(
      areWhoIsToldCountsKnown(
        whoFacts({ policyCount: 2, incidentRuleCount: 1, alertRuleCount: 0 }),
      ),
    ).toBe(true);
    expect(
      areWhoIsToldCountsKnown(
        whoFacts({
          mayCreatePolicy: false,
          mayAddEscalationRules: false,
          mayAddRules: false,
        }),
      ),
    ).toBe(true);
    expect(
      areWhoIsToldCountsKnown(
        whoFacts({
          policyCount: null,
          incidentRuleCount: null,
          alertRuleCount: null,
        }),
      ),
    ).toBe(false);
  });
});

/*
 * "You own this monitor, so you are emailed when it goes down" was said to
 * a self-hosted master admin, whom the server never makes the owner of what
 * they create (#7409). The setup now makes them one; and the step says it
 * only of someone who is.
 */
describe("who is told, said only when it is true (#7409)", () => {
  test("a policy this run makes says it itself: no help line", () => {
    for (const isMonitorOwner of [true, false, null]) {
      expect(
        getWhoIsToldHelp({ mode: WhoIsToldMode.CreatePolicy, isMonitorOwner }),
      ).toBeNull();
    }
  });

  test("a project whose policies decide: the email is promised only to the owner", () => {
    expect(
      getWhoIsToldHelp({
        mode: WhoIsToldMode.ExistingPolicy,
        isMonitorOwner: true,
      }),
    ).toBe(WEBSITE_DOWN_COPY.whoExistingHelp);
    expect(
      getWhoIsToldHelp({
        mode: WhoIsToldMode.ExistingPolicy,
        isMonitorOwner: false,
      }),
    ).toBe(WEBSITE_DOWN_COPY.whoExistingHelpNotOwner);
    // Not read yet: what is true either way.
    expect(
      getWhoIsToldHelp({
        mode: WhoIsToldMode.ExistingPolicy,
        isMonitorOwner: null,
      }),
    ).toBe(WEBSITE_DOWN_COPY.whoExistingHelpNotOwner);
    expect(WEBSITE_DOWN_COPY.whoExistingHelpNotOwner).not.toContain("emailed");
    // The same sentence, without the promise.
    expect(WEBSITE_DOWN_COPY.whoExistingHelp).toBe(
      `${WEBSITE_DOWN_COPY.whoExistingHelpNotOwner} You own this monitor, so you are also emailed when it goes down.`,
    );
  });

  test("someone who may not set paging up: told the email is theirs, or how to make it so", () => {
    expect(
      getWhoIsToldHelp({
        mode: WhoIsToldMode.OwnerEmailOnly,
        isMonitorOwner: true,
      }),
    ).toBe(WEBSITE_DOWN_COPY.whoOwnerOnlyHelp);
    expect(
      getWhoIsToldHelp({
        mode: WhoIsToldMode.OwnerEmailOnly,
        isMonitorOwner: false,
      }),
    ).toBe(WEBSITE_DOWN_COPY.whoOwnerOnlyHelpNotOwner);
    expect(WEBSITE_DOWN_COPY.whoOwnerOnlyHelpNotOwner).toContain(
      "You do not own this monitor, so you are not emailed when it goes down",
    );
    // Nothing said until it is known.
    expect(
      getWhoIsToldHelp({
        mode: WhoIsToldMode.OwnerEmailOnly,
        isMonitorOwner: null,
      }),
    ).toBeNull();
  });

  test("the done line: the owner's email only for the owner", () => {
    const line: (
      mode: WhoIsToldMode,
      isMonitorOwner: boolean | null,
    ) => string = (
      mode: WhoIsToldMode,
      isMonitorOwner: boolean | null,
    ): string => {
      return getWhoIsToldDoneLine({
        translator: english,
        mode,
        isMonitorOwner,
      });
    };

    expect(line(WhoIsToldMode.OwnerEmailOnly, true)).toBe(
      "You are emailed as the monitor's owner.",
    );
    expect(line(WhoIsToldMode.OwnerEmailOnly, false)).toBe(
      "Project Owners are emailed about incidents nobody owns.",
    );
    expect(line(WhoIsToldMode.OwnerEmailOnly, null)).toBe(
      "Project Owners are emailed about incidents nobody owns.",
    );
    for (const isMonitorOwner of [true, false, null]) {
      expect(line(WhoIsToldMode.ExistingPolicy, isMonitorOwner)).toBe(
        "This project's on-call policies and rules decide who is paged.",
      );
    }
  });
});

/*
 * On Cloud's Free plan with no payment method, Start checking was refused
 * in red, with no warning before it and no link (#7367).
 */
describe("a payment method, said before Start checking (#7367)", () => {
  test("with the price the server bills, and what to do", () => {
    expect(
      getPaymentNeededText({ translator: english, mayAddPaymentMethod: true }),
    ).toBe(
      "This project is on the Free plan, where a monitor that checks your site is billed as you use it, at $1 per monitor per month. Add a payment method before you start checking.",
    );
  });

  test("someone who may not add one is told who can", () => {
    expect(
      getPaymentNeededText({ translator: english, mayAddPaymentMethod: false }),
    ).toBe(
      "This project is on the Free plan, where a monitor that checks your site is billed as you use it, at $1 per monitor per month. Ask a Project Owner to add a payment method before you start checking.",
    );
  });

  test("the price is the one the billing quotes everywhere", () => {
    const text: string = getPaymentNeededText({
      translator: english,
      mayAddPaymentMethod: true,
    });

    expect(text).toContain(
      formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH),
    );
  });

  test("in every language, the price kept", () => {
    for (const language of [...DASHBOARD_LANGUAGES]) {
      for (const mayAddPaymentMethod of [true, false]) {
        const text: string = getPaymentNeededText({
          translator: dashboardTranslator(language),
          mayAddPaymentMethod,
        });

        expect({
          language,
          worded:
            text !==
            getPaymentNeededText({ translator: english, mayAddPaymentMethod }),
          price: withoutIsolateMarks(text).includes("$1"),
        }).toEqual({ language, worded: true, price: true });
      }
    }
  });

  test("its button is the billing page's own, worded as the billing page words it", () => {
    const billing: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Billing.tsx",
      ),
      "utf8",
    );

    expect(WEBSITE_DOWN_COPY.addPaymentMethod).toBe("Add Payment Method");
    expect(billing).toContain('submitButtonText={"Add Payment Method"}');
  });
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
        text: "If it does not answer, or answers with an error, OneUptime opens an incident (Critical). A status change needs both connected probes to agree.",
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
          summaryFacts({ incidentSeverityName: null, locationCount: 1 }),
        ),
        "when_down",
      ),
    ).toBe(
      "If it does not answer, or answers with an error, its status changes to Offline.",
    );
  });

  /*
   * "If it does not answer ... OneUptime opens an incident" was said of a
   * monitor checked from three locations, where one location failing opens
   * none (#7410): the row says how many must agree, as the monitor's probes
   * card says it.
   */
  describe("how many locations must agree (#7410)", () => {
    const whenDown: (extra: Partial<WebsiteDownSummaryFacts>) => string = (
      extra: Partial<WebsiteDownSummaryFacts>,
    ): string => {
      return (
        rowText(
          getWebsiteDownSummaryRows(english, summaryFacts(extra)),
          "when_down",
        ) || ""
      );
    };

    test("one location: nothing to agree on", () => {
      expect(whenDown({ locationCount: 1 })).toBe(
        "If it does not answer, or answers with an error, OneUptime opens an incident (Critical).",
      );
    });

    test("three locations, all must agree", () => {
      expect(whenDown({ locationCount: 3 })).toBe(
        "If it does not answer, or answers with an error, OneUptime opens an incident (Critical). A status change needs all 3 connected probes to agree.",
      );
    });

    test("a minimum the monitor sets", () => {
      expect(
        whenDown({ locationCount: 3, minimumProbeAgreement: 2 }),
      ).toContain("A status change needs 2 of 3 connected probes to agree.");
      // A minimum of one needs no agreement.
      expect(
        whenDown({ locationCount: 3, minimumProbeAgreement: 1 }),
      ).not.toContain("agree");
    });

    test("only the connected locations count", () => {
      expect(
        whenDown({ locationCount: 3, activeLocationCount: 1 }),
      ).not.toContain("agree");
      expect(whenDown({ locationCount: 3, activeLocationCount: 2 })).toContain(
        "A status change needs both connected probes to agree.",
      );
    });

    test("criteria that open no incident: the status change needs it too", () => {
      expect(whenDown({ locationCount: 2, incidentSeverityName: null })).toBe(
        "If it does not answer, or answers with an error, its status changes to Offline. A status change needs both connected probes to agree.",
      );
    });

    test("the agreement is said in the reader's language", () => {
      const inGerman: string =
        rowText(
          getWebsiteDownSummaryRows(
            dashboardTranslator("de"),
            summaryFacts({ locationCount: 3 }),
          ),
          "when_down",
        ) || "";
      const sentence: string =
        readDashboardLocale("de")[
          "A status change needs all {{count}} connected probes to agree."
        ] || "";

      expect(sentence).not.toBe("");
      expect(inGerman).not.toContain("A status change needs");
      expect(inGerman).toContain(sentence.replace("{{count}}", "3"));
    });
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
    ).toBe("Project Owners are emailed about incidents nobody owns.");
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

/*
 * THE SEVERITY, AFTER THE WORD FOR INCIDENT (#7060): the summary names the
 * incident's severity in brackets after the word for incident, in every
 * language. A project's severities keep the names they were given, and a
 * default one is called "Critical Incident", so a sentence that set the name
 * before the word read "a Critical Incident incident"; the English was
 * reworded with the severity in brackets, and the other languages kept the
 * old wording until #7060.
 */
const SEVERITY_SENTENCE: string =
  "If it does not answer, or answers with an error, OneUptime opens an incident ({{severity}}).";

// The word each language's setup says incident with: its other sentences use it too.
const INCIDENT_WORDS: Record<string, string> = {
  en: "incident",
  ar: "حادثة",
  da: "hændelse",
  de: "Vorfall",
  es: "incidente",
  fa: "حادثه",
  fr: "incident",
  hi: "घटना",
  it: "incidente",
  ja: "インシデント",
  ko: "인시던트",
  nl: "incident",
  no: "hendelse",
  pt: "incidente",
  ru: "инцидент",
  sv: "incident",
  "zh-CN": "事件",
  "zh-TW": "事件",
};

const SEVERITY_PLACEHOLDER: string = "{{severity}}";

/*
 * The words from the word for incident to the closing bracket: "Vorfall
 * ({{severity}})", "インシデント（{{severity}}）". Null when the sentence does
 * not set the severity in brackets right after the word for incident.
 */
const getBracketedSeverity: (
  sentence: string,
  incidentWord: string,
) => string | null = (
  sentence: string,
  incidentWord: string,
): string | null => {
  const at: number = sentence.indexOf(SEVERITY_PLACEHOLDER);

  if (at < 0 || sentence.indexOf(SEVERITY_PLACEHOLDER, at + 1) >= 0) {
    return null;
  }

  const before: string = sentence.slice(0, at);
  const after: string = sentence.slice(at + SEVERITY_PLACEHOLDER.length);

  // Brackets as the language writes them: full width in Chinese and Japanese.
  for (const [open, close] of [
    [" (", ")"],
    ["(", ")"],
    ["（", "）"],
  ] as Array<[string, string]>) {
    if (before.endsWith(`${incidentWord}${open}`) && after.startsWith(close)) {
      return `${incidentWord}${open}${SEVERITY_PLACEHOLDER}${close}`;
    }
  }

  return null;
};

describe("the summary's severity, in brackets after the word for incident, in every language (#7060)", () => {
  const languages: Array<string> = Object.keys(INCIDENT_WORDS);

  test("every language the Dashboard offers is here", () => {
    expect(
      languages
        .filter((language: string): boolean => {
          return language !== "en";
        })
        .sort(),
    ).toEqual([...DASHBOARD_LANGUAGES].sort());
  });

  test.each(languages)(
    "%s: the word for incident is the one the setup's other sentences use",
    (language: string) => {
      const table: Record<string, string> = readDashboardLocale(language);

      for (const sentence of [
        WEBSITE_DOWN_COPY.whoCreateHelp,
        WEBSITE_DOWN_COPY.whoExistingHelp,
      ]) {
        expect(table[sentence]).toContain(INCIDENT_WORDS[language]!);
      }
    },
  );

  test.each(languages)(
    "%s: the sentence sets the severity in brackets right after it, and nowhere else",
    (language: string) => {
      const sentence: string =
        readDashboardLocale(language)[SEVERITY_SENTENCE]!;

      expect(sentence).toBeTruthy();
      expect(
        getBracketedSeverity(sentence, INCIDENT_WORDS[language]!),
      ).not.toBeNull();
    },
  );

  /*
   * A project's own name kept as it was given ("SEV1"), and the names a new
   * project starts with in the reader's words, as their badges read them
   * (Common/Utils/DefaultRecordNames, #7894): German "Kritischer Vorfall",
   * in brackets, so "einen Vorfall (Kritischer Vorfall)" names the
   * severity once and never reads it as a word before the word for
   * incident.
   */
  const severities: Array<string> = [
    "Critical Incident",
    "Major Incident",
    "Minor Incident",
    "SEV1",
  ];

  test.each(
    languages.flatMap((language: string): Array<[string, string]> => {
      return severities.map((severity: string): [string, string] => {
        return [language, severity];
      });
    }),
  )(
    "%s, a severity named %j: read in brackets, never as a word before the word for incident",
    (language: string, severity: string) => {
      const incidentWord: string = INCIDENT_WORDS[language]!;
      const bracketed: string = getBracketedSeverity(
        readDashboardLocale(language)[SEVERITY_SENTENCE]!,
        incidentWord,
      )!;
      const text: string = withoutIsolateMarks(
        rowText(
          getWebsiteDownSummaryRows(
            dashboardTranslator(language),
            summaryFacts({ incidentSeverityName: severity }),
          ),
          "when_down",
        )!,
      );

      const shown: string = translateRecordName(
        dashboardTranslator(language),
        StateListType.IncidentSeverity,
        severity,
      );

      if (severity === "SEV1") {
        expect(shown).toBe(severity);
      }

      expect(text).toContain(bracketed.replace(SEVERITY_PLACEHOLDER, shown));
      // "Critical Incident incident", "Kritischer Vorfall Vorfall": never.
      expect(text.toLowerCase()).not.toContain(
        `${shown} ${incidentWord}`.toLowerCase(),
      );
      expect(text.toLowerCase()).not.toContain(
        `${shown}${incidentWord}`.toLowerCase(),
      );
      expect(text.split(shown)).toHaveLength(2);
    },
  );

  test("the check tells the old wordings apart: each would fail it", () => {
    const old: Array<[string, string]> = [
      [
        "en",
        "If it does not answer, or answers with an error, OneUptime opens a {{severity}} incident.",
      ],
      [
        "de",
        "Kommt keine Antwort oder eine Fehlerantwort, eröffnet OneUptime einen Vorfall mit Schweregrad {{severity}}.",
      ],
      [
        "fr",
        "Si aucune réponse n'arrive, ou si la réponse est une erreur, OneUptime ouvre un incident de gravité {{severity}}.",
      ],
      [
        "ja",
        "応答がない場合、またはエラーが返された場合、OneUptime は重大度 {{severity}} のインシデントを作成します。",
      ],
      [
        "ko",
        "응답이 없거나 오류로 응답하면 OneUptime이 심각도 {{severity}} 인시던트를 엽니다.",
      ],
      [
        "hi",
        "अगर जवाब नहीं आता, या जवाब में त्रुटि आती है, तो OneUptime {{severity}} गंभीरता वाली घटना खोलता है।",
      ],
      [
        "zh-CN",
        "如果没有响应，或响应出错，OneUptime 会创建严重程度为 {{severity}} 的事件。",
      ],
      [
        "ar",
        "إذا لم يُجب، أو أجاب بخطأ، يفتح OneUptime حادثة بخطورة {{severity}}.",
      ],
    ];

    for (const [language, sentence] of old) {
      expect({
        language,
        bracketed: getBracketedSeverity(sentence, INCIDENT_WORDS[language]!),
      }).toEqual({ language, bracketed: null });
    }

    // And a sentence naming the severity twice is not one either.
    expect(
      getBracketedSeverity(
        "OneUptime opens an incident ({{severity}}), {{severity}}.",
        "incident",
      ),
    ).toBeNull();
  });
});

/*
 * STEP 1 SAYS FROM HOW MANY LOCATIONS (#7461): "from several locations" was
 * said on a server with one probe. The number is the probes a new monitor
 * starts with; with none known, no number - never "several".
 */
describe("step 1 says from how many locations (#7461)", () => {
  const help: (count: number | null) => string = (
    count: number | null,
  ): string => {
    const chosen: ReturnType<typeof getCheckHelpTemplate> =
      getCheckHelpTemplate(count);
    const values: Record<string, string> = {
      monitor: "monitor",
      incident: "incident",
    };

    return typeof chosen.template === "string"
      ? english.translateTemplate(chosen.template, values)
      : english.translatePlural(chosen.template, chosen.count!, values);
  };

  test("one probe: from 1 location, and when that location finds it down", () => {
    expect(help(1)).toBe(
      "OneUptime makes a monitor that checks it every 5 minutes from 1 location. An incident opens when that location finds it down: no answer, or an answer with an error.",
    );
  });

  test("three probes: from 3 locations, and when all of them find it down", () => {
    expect(help(3)).toBe(
      "OneUptime makes a monitor that checks it every 5 minutes from 3 locations. An incident opens when all of them find it down: no answer, or an answer with an error.",
    );
  });

  test("a number that could not be read, or no probe: no number at all", () => {
    expect(getCheckHelpTemplate(null)).toEqual({
      template: WEBSITE_DOWN_COPY.checkHelp,
    });
    expect(getCheckHelpTemplate(0)).toEqual({
      template: WEBSITE_DOWN_COPY.checkHelp,
    });
    expect(help(null)).toBe(
      "OneUptime makes a monitor that checks it every 5 minutes. An incident opens when every location that checks it finds it down: no answer, or an answer with an error.",
    );
  });

  test.each([[null], [0], [1], [2], [7]])(
    "never promises several locations (%s)",
    (count: number | null) => {
      expect(help(count)).not.toMatch(/several/i);
    },
  );

  test("its every form keeps the Glossary's words and the number, in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const table: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        CHECK_HELP_FROM_LOCATIONS.other,
        `${CHECK_HELP_FROM_LOCATIONS.other}_one`,
      ]) {
        const worded: string | undefined = table[key];

        expect({ language, key, worded: Boolean(worded) }).toEqual({
          language,
          key,
          worded: true,
        });

        for (const placeholder of [
          "{{monitor}}",
          "{{incident}}",
          "{{count}}",
        ]) {
          expect({
            language,
            key,
            placeholder,
            kept: worded!.includes(placeholder),
          }).toEqual({
            language,
            key,
            placeholder,
            kept: true,
          });
        }

        expect({ language, key, isEnglish: worded === key }).toEqual({
          language,
          key,
          isEnglish: false,
        });
      }
    }
  });

  test("German: one location in the one form, three in the other, the number in the sentence", () => {
    const german: Translator = dashboardTranslator("de");
    const values: Record<string, string> = {
      monitor: "Monitor",
      incident: "Vorfall",
    };

    expect(
      german.translatePlural(CHECK_HELP_FROM_LOCATIONS, 1, values),
    ).toContain("von 1 Standort aus");
    expect(
      german.translatePlural(CHECK_HELP_FROM_LOCATIONS, 3, values),
    ).toContain("von 3 Standorten aus");
  });

  test("Persian: the number in the reader's digits", () => {
    const persian: Translator = dashboardTranslator("fa");

    expect(
      persian.translatePlural(CHECK_HELP_FROM_LOCATIONS, 3, {
        monitor: "مانیتور",
        incident: "حادثه",
      }),
    ).toContain("۳ مکان");
  });
});

/*
 * THE GLOSSARY'S WORDS IN THE SETUP'S SENTENCES (#7057): each its own key,
 * worded for the middle of a sentence, so the slot a sentence leaves for it
 * reads as the language says it.
 */
describe("the Glossary's words the setup marks (#7057)", () => {
  test("monitor, incident and on-call policy, and How to Reach Me's link", () => {
    expect(WEBSITE_DOWN_TERMS).toEqual({
      monitor: "monitor",
      incident: "incident",
      onCallPolicy: "on-call policy",
      howToReachMe: "How to Reach Me",
    });
  });

  test("each is worded in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const table: Record<string, string> = readDashboardLocale(language);

      for (const word of Object.values(WEBSITE_DOWN_TERMS)) {
        expect({ language, word, worded: Boolean(table[word]) }).toEqual({
          language,
          word,
          worded: true,
        });
      }
    }

    // Norwegian's incident was left in English; its menu says Hendelser.
    expect(readDashboardLocale("no")["incident"]).toBe("hendelse");
  });

  test("the sentences leave them a slot, in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const table: Record<string, string> = readDashboardLocale(language);

      for (const [key, slot] of [
        [WEBSITE_DOWN_COPY.checkHelp, "{{monitor}}"],
        [WEBSITE_DOWN_COPY.checkHelp, "{{incident}}"],
        [WEBSITE_DOWN_COPY.whoCreatePolicyNote, "{{onCallPolicy}}"],
        [WEBSITE_DOWN_COPY.whoCreateHelp, "{{howToReachMe}}"],
      ] as Array<[string, string]>) {
        expect({ language, slot, kept: table[key]!.includes(slot) }).toEqual({
          language,
          slot,
          kept: true,
        });
      }
    }
  });
});

/*
 * A MONITOR SOMEONE ELSE MADE (#7254): its name, set apart, and who made it
 * when the records name a person.
 */
describe("a monitor someone else made for the address (#7254)", () => {
  test("a teammate's: its name, and who made it", () => {
    expect(
      withoutIsolateMarks(
        getOtherMonitorSentence({
          translator: english,
          monitorName: "acme.example",
          creatorName: "Grace Hopper",
        }),
      ),
    ).toBe(
      'The monitor "acme.example" already checks this address. Grace Hopper made it.',
    );
  });

  test("one the API, Terraform or an import made: its name alone", () => {
    for (const creatorName of ["", "   "]) {
      expect(
        withoutIsolateMarks(
          getOtherMonitorSentence({
            translator: english,
            monitorName: "acme.example",
            creatorName: creatorName,
          }),
        ),
      ).toBe('The monitor "acme.example" already checks this address.');
    }
  });

  test.each(["de", "ar", "fa", "ja", "hi"])(
    "in %s: the reader's words, the name and the person kept as written",
    (language: string) => {
      const sentence: string = withoutIsolateMarks(
        getOtherMonitorSentence({
          translator: dashboardTranslator(language),
          monitorName: "acme.example",
          creatorName: "Grace Hopper",
        }),
      );
      const worded: string =
        readDashboardLocale(language)[WEBSITE_DOWN_COPY.otherMonitorMadeBy]!;

      expect(sentence).toBe(
        worded
          .replace("{{name}}", "acme.example")
          .replace("{{person}}", "Grace Hopper"),
      );
      expect(sentence).not.toContain("already checks");
    },
  );

  test("the name and the person are set apart, so a right-to-left sentence keeps them in order", () => {
    const sentence: string = getOtherMonitorSentence({
      translator: dashboardTranslator("fa"),
      monitorName: "acme.example",
      creatorName: "Grace Hopper",
    });

    expect(sentence).not.toBe(withoutIsolateMarks(sentence));
  });
});

/*
 * WHERE "GET PAGED BY SMS OR PHONE CALL" LEADS (#7370): the on-call guided
 * setup for whoever may use it, Notification Methods for anyone else.
 */
describe("Get paged by SMS or phone call (#7370)", () => {
  test("the on-call guided setup, for whoever may use it", () => {
    expect(getPagedByPhonePage(true)).toBe(PageMap.ON_CALL_DUTY_GUIDED_SETUP);
  });

  test("Notification Methods, for anyone else", () => {
    expect(getPagedByPhonePage(false)).toBe(
      PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
    );
  });
});

/*
 * STEP 4, SHOW IT TO CUSTOMERS? (#7053): only where it can be done, done
 * once a page shows the monitor or the person said "Not now", and never a
 * condition of the setup's finish.
 */
describe("4. Show it to customers? (#7053)", () => {
  const PAGE: WebsiteDownStatusPageChoice = { id: "sp-1", name: "Acme Status" };

  test("walked only by someone who may add a monitor to a page, in a project with one", () => {
    expect(
      hasStatusPageStep({ mayAddToStatusPage: true, statusPages: [PAGE] }),
    ).toBe(true);
    expect(
      hasStatusPageStep({ mayAddToStatusPage: false, statusPages: [PAGE] }),
    ).toBe(false);
    expect(
      hasStatusPageStep({ mayAddToStatusPage: true, statusPages: [] }),
    ).toBe(false);
  });

  test("the summary offers the status page setup instead, while there is no page, to whoever may make one", () => {
    expect(
      isStatusPageSetupOffered({
        hasStatusPageStep: false,
        mayCreateStatusPage: true,
      }),
    ).toBe(true);
    expect(
      isStatusPageSetupOffered({
        hasStatusPageStep: false,
        mayCreateStatusPage: false,
      }),
    ).toBe(false);
    expect(
      isStatusPageSetupOffered({
        hasStatusPageStep: true,
        mayCreateStatusPage: true,
      }),
    ).toBe(false);
  });

  test("a fourth step, last, only when the run walks it", () => {
    expect(
      getWebsiteDownProgress(progressFacts({ hasStatusPageStep: true })).map(
        (step: { key: string }): string => {
          return step.key;
        },
      ),
    ).toEqual([
      WebsiteDownStep.Check,
      WebsiteDownStep.WhoIsTold,
      WebsiteDownStep.Test,
      WebsiteDownStep.StatusPage,
    ]);
    expect(getWebsiteDownProgress(progressFacts())).toHaveLength(3);
    expect(WEBSITE_DOWN_STEPS).toHaveLength(3);
    expect(WEBSITE_DOWN_OPTIONAL_STEPS).toEqual([WebsiteDownStep.StatusPage]);
  });

  const tested: Partial<WebsiteDownProgressFacts> = {
    hasMonitor: true,
    isWhoIsToldDone: true,
    testStatus: OnCallTestPageStatus.Acknowledged,
    hasStatusPageStep: true,
  };

  test("done once a page shows the monitor, or the person said Not now", () => {
    expect(doneKeys(progressFacts(tested))).not.toContain(
      WebsiteDownStep.StatusPage,
    );
    expect(
      doneKeys(progressFacts({ ...tested, isOnStatusPage: true })),
    ).toContain(WebsiteDownStep.StatusPage);
    expect(
      doneKeys(progressFacts({ ...tested, isStatusPageSkipped: true })),
    ).toContain(WebsiteDownStep.StatusPage);
  });

  test("never before the test: each step builds on the one before", () => {
    expect(
      doneKeys(
        progressFacts({
          ...tested,
          testStatus: null,
          isOnStatusPage: true,
        }),
      ),
    ).toEqual([WebsiteDownStep.Check, WebsiteDownStep.WhoIsTold]);
  });

  test("optional: the setup is finished at the acknowledged test, step 4 done or not", () => {
    expect(isWebsiteDownFinished(progressFacts(tested))).toBe(true);
  });

  test("the summary says which page shows it, only when one does", () => {
    expect(
      rowText(
        getWebsiteDownSummaryRows(
          english,
          summaryFacts({ statusPageName: "Acme Status" }),
        ),
        "status_page",
      ),
    ).toBe('"Acme Status" shows it to your customers.');
    expect(
      rowText(
        getWebsiteDownSummaryRows(english, summaryFacts()),
        "status_page",
      ),
    ).toBeUndefined();
    expect(
      getWebsiteDownSummaryRows(english, summaryFacts({ statusPageName: null }))
        .length,
    ).toBe(4);
  });

  test("the page's name is set apart in the sentence", () => {
    const sentence: string = getStatusPageShownSentence(
      dashboardTranslator("ar"),
      "Acme Status",
    );

    expect(sentence).not.toBe(withoutIsolateMarks(sentence));
    expect(withoutIsolateMarks(sentence)).toBe(
      readDashboardLocale("ar")[WEBSITE_DOWN_COPY.statusPageShown]!.replace(
        "{{statusPage}}",
        "Acme Status",
      ),
    );
  });
});
