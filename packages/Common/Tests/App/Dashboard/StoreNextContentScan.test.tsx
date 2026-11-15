import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import StoreNextContentScan, {
  StoreNextContentScanWords,
  getStoreNextContentScanWords,
  getStoreScanNowRefusal,
  getStoreScanStopDetail,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreNextContentScan";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import OneUptimeDate from "../../../Types/Date";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  DataStoreContentScanFacts,
  DataStoreContentScanStop,
  getDataStoreNextContentScan,
} from "../../../Utils/DataSecurity/DataStoreContentScanSchedule";

/*
 * A data store's Next Content Scan, on its Overview (OneUptime issue
 * #8042): a time only when something will scan the store then, and
 * otherwise why nothing will. It showed nextContentScanAt as a date, and
 * for a store nothing may scan the probe's claim moves that a quarter of
 * an hour on, again and again: "in 17 minutes", for a scan that never came.
 * Scan Now on the same page said a scan had started for such a store.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");
const PROJECT_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_PROJECT_ID: string = "55555555-5555-4555-8555-555555555555";
const MINUTE_IN_MS: number = 60 * 1000;

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * MINUTE_IN_MS);
}

// A PostgreSQL database the project's own connected probe scans.
function probeFacts(
  store: Partial<DataStoreContentScanFacts["store"]> = {},
  rest: Partial<DataStoreContentScanFacts> = {},
): DataStoreContentScanFacts {
  return {
    store: {
      kind: DataStoreKind.PostgreSql,
      provider: DataStoreProvider.SelfManaged,
      projectId: PROJECT_ID,
      isContentScanEnabled: true,
      isArchived: false,
      scanProbeId: "66666666-6666-4666-8666-666666666666",
      probeConnectionVariable: "ORDERS_DB_URL",
      nextContentScanAt: minutesFromNow(30),
      ...store,
    },
    scanProbe: {
      isGlobalProbe: false,
      projectId: PROJECT_ID,
      connectionStatus: ProbeConnectionStatus.Connected,
    },
    projectSetting: null,
    ...rest,
  };
}

// An S3 bucket OneUptime's workers scan.
function workerFacts(
  store: Partial<DataStoreContentScanFacts["store"]> = {},
  rest: Partial<DataStoreContentScanFacts> = {},
): DataStoreContentScanFacts {
  return {
    store: {
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      projectId: PROJECT_ID,
      isContentScanEnabled: true,
      isArchived: false,
      nextContentScanAt: minutesFromNow(30),
      ...store,
    },
    projectSetting: null,
    ...rest,
  };
}

function telemetryFacts(
  rest: Partial<DataStoreContentScanFacts> = {},
): DataStoreContentScanFacts {
  return {
    store: {
      kind: DataStoreKind.TelemetryLogs,
      provider: DataStoreProvider.OneUptime,
      projectId: PROJECT_ID,
      isContentScanEnabled: true,
      isArchived: false,
      nextContentScanAt: minutesFromNow(-600),
    },
    projectSetting: null,
    ...rest,
  };
}

function words(
  facts: DataStoreContentScanFacts,
  probeName: string | null = "Datacenter probe",
): StoreNextContentScanWords {
  return getStoreNextContentScanWords(
    getDataStoreNextContentScan(facts, new Date()),
    ENGLISH,
    probeName,
  );
}

afterEach(() => {
  cleanup();
});

describe("Next Content Scan, in words", () => {
  test("due later, with a probe able to take it: the time, as the page writes dates", () => {
    const dueAt: Date = minutesFromNow(30);

    expect(words(probeFacts({ nextContentScanAt: dueAt }))).toEqual({
      headline: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        dueAt,
        false,
      ),
      dateTime: dueAt,
      detail: null,
    });
  });

  test("due later, from OneUptime's workers: the time", () => {
    const dueAt: Date = minutesFromNow(45);

    expect(words(workerFacts({ nextContentScanAt: dueAt })).dateTime).toEqual(
      dueAt,
    );
  });

  test("never scanned, with something able to scan it: due now", () => {
    for (const facts of [
      probeFacts({ nextContentScanAt: null }),
      workerFacts({ nextContentScanAt: undefined }),
    ]) {
      expect(words(facts)).toEqual({
        headline: "Due now",
        dateTime: null,
        detail: null,
      });
    }
  });

  test("due a few minutes ago: due now", () => {
    expect(
      words(probeFacts({ nextContentScanAt: minutesFromNow(-5) })).headline,
    ).toBe("Due now");
  });

  test("overdue from a probe: when it was due, and to check the probe by name", () => {
    expect(
      words(probeFacts({ nextContentScanAt: minutesFromNow(-180) })),
    ).toEqual({
      headline: "Overdue",
      dateTime: null,
      detail: `Due ${OneUptimeDate.fromNow(minutesFromNow(-180))}. Check that Datacenter probe is connected and up to date.`,
    });
  });

  test("overdue from a probe the reader may not name: 'its probe'", () => {
    expect(
      words(probeFacts({ nextContentScanAt: minutesFromNow(-180) }), null)
        .detail,
    ).toMatch(/\. Check that its probe is connected and up to date\.$/);
  });

  test("overdue from OneUptime's workers: when it was due", () => {
    expect(
      words(workerFacts({ nextContentScanAt: minutesFromNow(-180) })),
    ).toEqual({
      headline: "Overdue",
      dateTime: null,
      detail: `Due ${OneUptimeDate.fromNow(minutesFromNow(-180))}, and OneUptime's workers have not scanned it yet.`,
    });
  });

  test.each([
    [
      "content scanning off for the store",
      probeFacts({ isContentScanEnabled: false }),
      "Off",
      "Content scanning is off for this store. Turn it on in its Settings.",
    ],
    [
      "archived",
      probeFacts({ isArchived: true }),
      "Off",
      "A store that is no longer found is not scanned. It is scanned again once it is found.",
    ],
    [
      "content scanning off for the project",
      workerFacts({}, { projectSetting: { isContentScanEnabled: false } }),
      "Off",
      "Content scanning is off for this project. Turn it on in Data Security's Settings.",
    ],
    [
      "a kind OneUptime cannot sample",
      workerFacts({ kind: DataStoreKind.AwsDynamoDbTable }),
      "Not scanned",
      "OneUptime cannot sample this kind of store's content yet. Its configuration is still checked.",
    ],
    [
      "a kind a probe does not sample",
      probeFacts({ kind: DataStoreKind.MongoDb }),
      "Not scanned",
      "A probe scans PostgreSQL, MySQL and SQL Server databases only. Scan this store from OneUptime's workers in its Settings.",
    ],
    [
      "no probe connection variable",
      probeFacts({ probeConnectionVariable: "" }),
      "Not scanned",
      "Name the probe's environment variable that holds the connection string, in its Settings.",
    ],
    [
      "another project's probe",
      probeFacts(
        {},
        {
          scanProbe: {
            isGlobalProbe: false,
            projectId: OTHER_PROJECT_ID,
            connectionStatus: ProbeConnectionStatus.Connected,
          },
        },
      ),
      "Not scanned",
      "Only a probe of this project's own scans a store. Pick one in its Settings.",
    ],
    [
      "a probe the project does not have",
      probeFacts({}, { scanProbe: null }),
      "Not scanned",
      "Only a probe of this project's own scans a store. Pick one in its Settings.",
    ],
    [
      "a disconnected probe",
      probeFacts(
        {},
        {
          scanProbe: {
            isGlobalProbe: false,
            projectId: PROJECT_ID,
            connectionStatus: ProbeConnectionStatus.Disconnected,
          },
        },
      ),
      "Waiting",
      "Nothing scans this store while Datacenter probe is disconnected.",
    ],
    [
      "telemetry scanning off for the project",
      telemetryFacts({ projectSetting: { isTelemetryScanEnabled: false } }),
      "Off",
      "Telemetry scanning is off for this project. Turn it on in Data Security's Settings.",
    ],
  ])(
    "%s: no time, and why",
    (
      _name: string,
      facts: DataStoreContentScanFacts,
      headline: string,
      detail: string,
    ) => {
      // The set-aside's time, a quarter of an hour off, is never shown.
      for (const nextContentScanAt of [
        minutesFromNow(17),
        minutesFromNow(-600),
        null,
      ]) {
        expect(
          words({ ...facts, store: { ...facts.store, nextContentScanAt } }),
        ).toEqual({ headline: headline, dateTime: null, detail: detail });
      }
    },
  );

  test("a service's telemetry: every hour, with the project's telemetry scan, never a stale date", () => {
    expect(words(telemetryFacts())).toEqual({
      headline: "Every hour",
      dateTime: null,
      detail:
        "With the project's telemetry scan, from what its service sent in the last hour.",
    });
  });

  test("every reason has a sentence", () => {
    for (const stop of Object.values(DataStoreContentScanStop)) {
      expect(getStoreScanStopDetail(stop, ENGLISH, "Datacenter probe")).toMatch(
        /^[A-Z].+\.$/,
      );
    }
  });
});

describe("Scan Now, which never says a scan started that will not run", () => {
  test("a store something will scan: Scan Now scans", () => {
    expect(getStoreScanNowRefusal(probeFacts(), ENGLISH)).toBeUndefined();
    expect(getStoreScanNowRefusal(workerFacts(), ENGLISH)).toBeUndefined();
  });

  test("SQL Server from a probe, which the probe samples: Scan Now scans", () => {
    expect(
      getStoreScanNowRefusal(
        probeFacts({ kind: DataStoreKind.SqlServer }),
        ENGLISH,
      ),
    ).toBeUndefined();
  });

  test("an overdue store: Scan Now makes it due again, so it may", () => {
    expect(
      getStoreScanNowRefusal(
        probeFacts({ nextContentScanAt: minutesFromNow(-600) }),
        ENGLISH,
      ),
    ).toBeUndefined();
  });

  test("an archived store from OneUptime's workers: a worker scans one it is asked to", () => {
    expect(
      getStoreScanNowRefusal(workerFacts({ isArchived: true }), ENGLISH),
    ).toBeUndefined();
  });

  test("an archived store from OneUptime's workers in a project that scans no content: what else stops it", () => {
    expect(
      getStoreScanNowRefusal(
        workerFacts(
          { isArchived: true },
          { projectSetting: { isContentScanEnabled: false } },
        ),
        ENGLISH,
      ),
    ).toBe(
      "Content scanning is off for this project. Turn it on in Data Security's Settings.",
    );
    expect(
      getStoreScanNowRefusal(
        workerFacts({
          isArchived: true,
          kind: DataStoreKind.AwsDynamoDbTable,
        }),
        ENGLISH,
      ),
    ).toBe(
      "OneUptime cannot sample this kind of store's content yet. Its configuration is still checked.",
    );
  });

  test.each([
    [
      "content scanning off for the store",
      workerFacts({ isContentScanEnabled: false }),
      "Content scanning is off for this store. Turn it on in its Settings.",
    ],
    [
      "content scanning off for the project",
      workerFacts({}, { projectSetting: { isContentScanEnabled: false } }),
      "Content scanning is off for this project. Turn it on in Data Security's Settings.",
    ],
    [
      "an archived store from a probe, whose claim never hands it out",
      probeFacts({ isArchived: true }),
      "A store that is no longer found is not scanned. It is scanned again once it is found.",
    ],
    [
      "SQL Server from OneUptime's workers, which never sample it",
      workerFacts({
        kind: DataStoreKind.SqlServer,
        provider: DataStoreProvider.SelfManaged,
      }),
      "OneUptime cannot sample this kind of store's content yet. Its configuration is still checked.",
    ],
    [
      "no probe connection variable",
      probeFacts({ probeConnectionVariable: null }),
      "Name the probe's environment variable that holds the connection string, in its Settings.",
    ],
    [
      "a disconnected probe",
      probeFacts(
        {},
        {
          scanProbe: {
            isGlobalProbe: false,
            projectId: PROJECT_ID,
            connectionStatus: ProbeConnectionStatus.Disconnected,
          },
        },
      ),
      "Nothing scans this store while its probe is disconnected.",
    ],
    [
      "a service's telemetry, which the hourly telemetry scan reads",
      telemetryFacts(),
      "A service's telemetry is scanned every hour, with the project's telemetry scan.",
    ],
    [
      "a service's telemetry, with the project's telemetry scanning off",
      telemetryFacts({ projectSetting: { isTelemetryScanEnabled: false } }),
      "Telemetry scanning is off for this project. Turn it on in Data Security's Settings.",
    ],
  ])(
    "%s: Scan Now is off, and says why",
    (_name: string, facts: DataStoreContentScanFacts, reason: string) => {
      expect(getStoreScanNowRefusal(facts, ENGLISH)).toBe(reason);
    },
  );
});

describe("the Next Content Scan field", () => {
  test("a time is a <time> with its instant", () => {
    const dueAt: Date = minutesFromNow(90);

    render(
      <StoreNextContentScan
        facts={probeFacts({ nextContentScanAt: dueAt })}
        probeName="Datacenter probe"
      />,
    );

    const field: HTMLElement = screen.getByTestId(
      "data-store-next-content-scan",
    );
    const time: HTMLElement | null = field.querySelector("time");

    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("dateTime", dueAt.toISOString());
    expect(time).toHaveTextContent(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(dueAt, false),
    );
    expect(field.querySelector("p")).toBeNull();
  });

  test("a store whose scan is off: Off and why, and no time at all", () => {
    render(
      <StoreNextContentScan
        facts={probeFacts({
          isContentScanEnabled: false,
          nextContentScanAt: minutesFromNow(17),
        })}
      />,
    );

    const field: HTMLElement = screen.getByTestId(
      "data-store-next-content-scan",
    );

    expect(field.querySelector("time")).toBeNull();
    expect(field).toHaveTextContent("Off");
    expect(field).toHaveTextContent(
      "Content scanning is off for this store. Turn it on in its Settings.",
    );
    expect(field).not.toHaveTextContent(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        minutesFromNow(17),
        false,
      ),
    );
  });

  test("an overdue store says so, with when it was due", () => {
    render(
      <StoreNextContentScan
        facts={workerFacts({ nextContentScanAt: minutesFromNow(-120) })}
      />,
    );

    const field: HTMLElement = screen.getByTestId(
      "data-store-next-content-scan",
    );

    expect(field).toHaveTextContent("Overdue");
    expect(field).toHaveTextContent(
      "OneUptime's workers have not scanned it yet.",
    );
  });
});
