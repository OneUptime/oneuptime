import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT,
  CLOUD_APP_AZURE_MONITOR_HINT,
  CLOUD_APP_INSTANCES_HINT,
  CLOUD_APP_LOAD_FAILED_SUBLABEL,
  CLOUD_APP_NO_TRACES_NOTE,
  CLOUD_APP_NOT_ON_PLATFORM_NOTE,
  CLOUD_APP_NOT_REPORTED_NOTE,
  CLOUD_APP_PLATFORMS_WITHOUT_USAGE,
  CLOUD_APP_REVISION_HINT,
  CLOUD_APP_ROW_ARRIVING,
  CLOUD_APP_ROW_CHECKING,
  CLOUD_APP_ROW_CONNECTED,
  CLOUD_APP_ROW_LABELS,
  CLOUD_APP_ROW_NONE,
  CLOUD_APP_ROW_NONE_SINCE,
  CLOUD_APP_ROW_NOT_CONNECTED,
  CLOUD_APP_ROW_NOT_REPORTED,
  CLOUD_APP_ROW_NOT_REPORTING,
  CLOUD_APP_ROW_QUIET,
  CLOUD_APP_ROW_REPORTED,
  CLOUD_APP_SETUP_DESCRIPTION,
  CLOUD_APP_SETUP_GUIDE,
  CLOUD_APP_SETUP_TITLE,
  CLOUD_APP_TRACES_HINT,
  CloudAppArrival,
  CloudAppArrivalSource,
  CloudAppArrivalState,
  CloudAppPlatformResourceState,
  CloudAppSetupInput,
  CloudAppSetupRow,
  CloudAppSetupRowKey,
  formatCloudAppSinceDate,
  getCloudAppArrival,
  getCloudAppInstancesTileNote,
  getCloudAppPlatformName,
  getCloudAppSetupRows,
  getCloudAppTraceTileNote,
  getCloudAppUsageTileNote,
  getCloudEnvironmentTraceTileNote,
  hasCloudAppSentTraces,
  isCloudAppSetupIncomplete,
  showsCloudAppUsageTiles,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";
import { CloudAppTelemetrySignal } from "../../../Types/Cloud/CloudAppTelemetrySignal";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
} from "../../../Types/Cloud/CloudPlatform";
import OneUptimeDate from "../../../Types/Date";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * WHAT AN APP PLATFORMS APP SENDS, AND WHAT ITS PAGE SAYS ABOUT IT (#6770).
 *
 * An Azure App Service app that sent only metrics read "Running",
 * "0 requests", "0 instances" and "No revision reported yet", with nothing
 * to say the zeros were never measured. The ingest now marks when each kind
 * of telemetry last arrived for an app, and CloudAppTelemetrySetup turns that
 * into what the page says:
 *
 *   - which kinds arrive, lately or not, and since when none has;
 *   - a tile's note in place of a number the app never sent: "No traces
 *     received" on the trace tiles, "Not reported" on Instances, "Not on
 *     Azure App Service" on CPU and Memory - and never in place of a number
 *     the app did send;
 *   - when the page leads with its Setup check, and that check's rows: each
 *     kind and attribute, its state, and for what is missing what to add;
 *   - all of it in the reader's language.
 */

const MINUTE_MS: number = 60 * 1000;
const NOW: Date = new Date("2026-11-11T12:00:00.000Z");
const TRACKED_SINCE: Date = new Date("2026-11-10T09:30:00.000Z");
const CREATED_AT: Date = new Date("2026-10-01T08:00:00.000Z");

const ENGLISH: Translator = createTranslator(undefined, "en");
const GERMAN: Translator = dashboardTranslator("de");

const ARRIVAL_SIGNALS: Array<
  | CloudAppTelemetrySignal.Traces
  | CloudAppTelemetrySignal.Logs
  | CloudAppTelemetrySignal.Metrics
> = [
  CloudAppTelemetrySignal.Traces,
  CloudAppTelemetrySignal.Logs,
  CloudAppTelemetrySignal.Metrics,
];

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

function setupInput(
  fields: Partial<CloudAppSetupInput> = {},
): CloudAppSetupInput {
  return {
    app: {
      cloudPlatform: ManagedCloudPlatform.AzureAppService,
      signalArrivalsTrackedSince: TRACKED_SINCE,
      createdAt: CREATED_AT,
    },
    isRunning: true,
    hasReportedInstances: false,
    now: NOW,
    translator: ENGLISH,
    ...fields,
  };
}

function rowOf(
  rows: Array<CloudAppSetupRow>,
  key: CloudAppSetupRowKey,
): CloudAppSetupRow {
  const row: CloudAppSetupRow | undefined = rows.find(
    (candidate: CloudAppSetupRow): boolean => {
      return candidate.key === key;
    },
  );

  expect(row).toBeDefined();

  return row as CloudAppSetupRow;
}

describe("what arrived from the app, kind by kind", () => {
  test("a kind that never arrived has none since the install began keeping arrivals", () => {
    const arrival: CloudAppArrival = getCloudAppArrival({
      app: { signalArrivalsTrackedSince: TRACKED_SINCE, createdAt: CREATED_AT },
      signal: CloudAppTelemetrySignal.Traces,
      now: NOW,
    });

    expect(arrival).toEqual({
      state: CloudAppArrivalState.None,
      latestAt: null,
      since: TRACKED_SINCE,
    });
  });

  test("an app that appeared after the upgrade has none since it appeared", () => {
    const arrival: CloudAppArrival = getCloudAppArrival({
      app: { createdAt: CREATED_AT },
      signal: CloudAppTelemetrySignal.Logs,
      now: NOW,
    });

    expect(arrival.state).toBe(CloudAppArrivalState.None);
    expect(arrival.since).toEqual(CREATED_AT);
  });

  test("with neither date, none is said with no date at all", () => {
    expect(
      getCloudAppArrival({
        app: {},
        signal: CloudAppTelemetrySignal.Metrics,
        now: NOW,
      }),
    ).toEqual({
      state: CloudAppArrivalState.None,
      latestAt: null,
      since: null,
    });
  });

  test("a kind that arrived in the live window is arriving, and one before it is quiet", () => {
    const arriving: CloudAppArrival = getCloudAppArrival({
      app: { metricsLastReceivedAt: minutesBefore(2) },
      signal: CloudAppTelemetrySignal.Metrics,
      now: NOW,
    });
    const quiet: CloudAppArrival = getCloudAppArrival({
      app: { metricsLastReceivedAt: minutesBefore(3 * 60) },
      signal: CloudAppTelemetrySignal.Metrics,
      now: NOW,
    });

    expect(arriving).toEqual({
      state: CloudAppArrivalState.Arriving,
      latestAt: minutesBefore(2),
      since: null,
    });
    expect(quiet).toEqual({
      state: CloudAppArrivalState.Quiet,
      latestAt: minutesBefore(3 * 60),
      since: null,
    });
  });

  test("the live window is the one an app counts as Running in, its last minute included", () => {
    const at: (minutes: number) => CloudAppArrivalState = (
      minutes: number,
    ): CloudAppArrivalState => {
      return getCloudAppArrival({
        app: { tracesLastReceivedAt: minutesBefore(minutes) },
        signal: CloudAppTelemetrySignal.Traces,
        now: NOW,
      }).state;
    };

    expect(at(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES)).toBe(
      CloudAppArrivalState.Arriving,
    );
    expect(at(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES + 1)).toBe(
      CloudAppArrivalState.Quiet,
    );
  });

  test("dates read from the API as strings count, and a date that does not parse counts as none", () => {
    expect(
      getCloudAppArrival({
        app: { logsLastReceivedAt: minutesBefore(1).toISOString() },
        signal: CloudAppTelemetrySignal.Logs,
        now: NOW,
      }),
    ).toEqual({
      state: CloudAppArrivalState.Arriving,
      latestAt: minutesBefore(1),
      since: null,
    });

    expect(
      getCloudAppArrival({
        app: {
          logsLastReceivedAt: "not a date",
          signalArrivalsTrackedSince: TRACKED_SINCE.toISOString(),
        },
        signal: CloudAppTelemetrySignal.Logs,
        now: NOW,
      }),
    ).toEqual({
      state: CloudAppArrivalState.None,
      latestAt: null,
      since: TRACKED_SINCE,
    });
  });

  test("each kind reads its own column, and only its own", () => {
    const app: CloudAppArrivalSource = {
      logsLastReceivedAt: minutesBefore(4),
      signalArrivalsTrackedSince: TRACKED_SINCE,
    };
    const states: Array<CloudAppArrivalState> = ARRIVAL_SIGNALS.map(
      (
        signal:
          | CloudAppTelemetrySignal.Traces
          | CloudAppTelemetrySignal.Logs
          | CloudAppTelemetrySignal.Metrics,
      ): CloudAppArrivalState => {
        return getCloudAppArrival({ app, signal, now: NOW }).state;
      },
    );

    expect(states).toEqual([
      CloudAppArrivalState.None,
      CloudAppArrivalState.Arriving,
      CloudAppArrivalState.None,
    ]);
  });

  test("an app has sent traces once its traces column is set, however long ago", () => {
    expect(hasCloudAppSentTraces({})).toBe(false);
    expect(hasCloudAppSentTraces({ tracesLastReceivedAt: null })).toBe(false);
    expect(hasCloudAppSentTraces({ tracesLastReceivedAt: "not a date" })).toBe(
      false,
    );
    expect(
      hasCloudAppSentTraces({
        logsLastReceivedAt: minutesBefore(1),
        metricsLastReceivedAt: minutesBefore(1),
      }),
    ).toBe(false);
    expect(
      hasCloudAppSentTraces({
        tracesLastReceivedAt: minutesBefore(90 * 24 * 60),
      }),
    ).toBe(true);
  });
});

describe("the trace tiles' note", () => {
  const noTraces: CloudAppArrivalSource = {
    metricsLastReceivedAt: minutesBefore(1),
  };
  const withTraces: CloudAppArrivalSource = {
    tracesLastReceivedAt: minutesBefore(1),
  };

  test("an app that sends no traces and served nothing in the range reads No traces received", () => {
    expect(
      getCloudAppTraceTileNote({ app: noTraces, metrics: { total: 0 } }),
    ).toBe(CLOUD_APP_NO_TRACES_NOTE);
  });

  test("an app whose traces arrive and that served nothing in the range reads its 0", () => {
    expect(
      getCloudAppTraceTileNote({ app: withTraces, metrics: { total: 0 } }),
    ).toBeUndefined();
  });

  test("a number the app did send always shows, even before its traces were tracked", () => {
    expect(
      getCloudAppTraceTileNote({ app: noTraces, metrics: { total: 12 } }),
    ).toBeUndefined();
  });

  test("nothing is said while the read is out, or when it failed: the tile says could not load", () => {
    expect(
      getCloudAppTraceTileNote({ app: noTraces, metrics: null }),
    ).toBeUndefined();
    expect(
      getCloudAppTraceTileNote({
        app: noTraces,
        metrics: { total: 0, failed: true },
      }),
    ).toBeUndefined();
    expect(CLOUD_APP_LOAD_FAILED_SUBLABEL).toBe("could not load");
  });

  test("over any mix of totals and arrivals, the note is there exactly when nothing was measured", () => {
    const random: SeededRandom = seededRandom(6770);

    for (let draw: number = 0; draw < 500; draw++) {
      const total: number = random(3) === 0 ? 0 : random(10_000);
      const failed: boolean = random(5) === 0;
      const tracesArrived: boolean = random(2) === 0;
      const app: CloudAppArrivalSource = tracesArrived
        ? { tracesLastReceivedAt: minutesBefore(random(60 * 24 * 30)) }
        : { logsLastReceivedAt: minutesBefore(random(60)) };
      const expected: string | undefined =
        !failed && total <= 0 && !tracesArrived
          ? CLOUD_APP_NO_TRACES_NOTE
          : undefined;

      expect({
        total,
        failed,
        tracesArrived,
        note: getCloudAppTraceTileNote({ app, metrics: { total, failed } }),
      }).toEqual({ total, failed, tracesArrived, note: expected });
    }
  });
});

describe("an environment's trace tiles' note", () => {
  test("an environment none of whose apps sent a trace, and that served nothing, reads No traces received", () => {
    expect(
      getCloudEnvironmentTraceTileNote({
        appsWithTraces: 0,
        metrics: { total: 0 },
      }),
    ).toBe(CLOUD_APP_NO_TRACES_NOTE);
  });

  test("one app that sends traces is enough for the environment's 0 to be a real 0", () => {
    expect(
      getCloudEnvironmentTraceTileNote({
        appsWithTraces: 1,
        metrics: { total: 0 },
      }),
    ).toBeUndefined();
  });

  test("requests the environment served always show", () => {
    expect(
      getCloudEnvironmentTraceTileNote({
        appsWithTraces: 0,
        metrics: { total: 7 },
      }),
    ).toBeUndefined();
  });

  test("nothing is said while either read is out, or when the spans could not be read", () => {
    expect(
      getCloudEnvironmentTraceTileNote({
        appsWithTraces: null,
        metrics: { total: 0 },
      }),
    ).toBeUndefined();
    expect(
      getCloudEnvironmentTraceTileNote({ appsWithTraces: 0, metrics: null }),
    ).toBeUndefined();
    expect(
      getCloudEnvironmentTraceTileNote({
        appsWithTraces: 0,
        metrics: { total: 0, failed: true },
      }),
    ).toBeUndefined();
  });
});

describe("the CPU and Memory tiles' note", () => {
  test("a reading always shows, on every platform: a platform that gives no usage cannot hide a real one", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      for (const isRunning of [true, false]) {
        expect({
          platform: descriptor.platform,
          isRunning,
          note: getCloudAppUsageTileNote({
            cloudPlatform: descriptor.platform,
            isRunning,
            hasReading: true,
            translator: ENGLISH,
          }),
        }).toEqual({
          platform: descriptor.platform,
          isRunning,
          note: undefined,
        });
      }
    }
  });

  test("App Service, App Engine and App Runner give an app no CPU or memory, and say so by name", () => {
    expect(Array.from(CLOUD_APP_PLATFORMS_WITHOUT_USAGE).sort()).toEqual(
      [
        ManagedCloudPlatform.AwsAppRunner,
        ManagedCloudPlatform.AzureAppService,
        ManagedCloudPlatform.GcpAppEngine,
      ].sort(),
    );

    expect(
      getCloudAppUsageTileNote({
        cloudPlatform: ManagedCloudPlatform.AzureAppService,
        isRunning: true,
        hasReading: false,
        translator: ENGLISH,
      }),
    ).toBe("Not on Azure App Service");
    expect(
      getCloudAppUsageTileNote({
        cloudPlatform: ManagedCloudPlatform.GcpAppEngine,
        isRunning: false,
        hasReading: false,
        translator: ENGLISH,
      }),
    ).toBe("Not on Google App Engine");
    expect(
      getCloudAppUsageTileNote({
        cloudPlatform: ManagedCloudPlatform.AwsAppRunner,
        isRunning: true,
        hasReading: false,
        translator: ENGLISH,
      }),
    ).toBe("Not on AWS App Runner");
  });

  test("on the other platforms, a running app with no reading reads Not reported, and one not running a dash", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      if (CLOUD_APP_PLATFORMS_WITHOUT_USAGE.has(descriptor.platform)) {
        continue;
      }

      expect({
        platform: descriptor.platform,
        running: getCloudAppUsageTileNote({
          cloudPlatform: descriptor.platform,
          isRunning: true,
          hasReading: false,
          translator: ENGLISH,
        }),
        stopped: getCloudAppUsageTileNote({
          cloudPlatform: descriptor.platform,
          isRunning: false,
          hasReading: false,
          translator: ENGLISH,
        }),
      }).toEqual({
        platform: descriptor.platform,
        running: CLOUD_APP_NOT_REPORTED_NOTE,
        stopped: undefined,
      });
    }
  });

  test("the platform note is worded in the reader's language, with the platform's own name kept", () => {
    const german: string | undefined = getCloudAppUsageTileNote({
      cloudPlatform: ManagedCloudPlatform.AzureAppService,
      isRunning: true,
      hasReading: false,
      translator: GERMAN,
    });
    const template: string | undefined =
      readDashboardLocale("de")[CLOUD_APP_NOT_ON_PLATFORM_NOTE];

    expect(template).toBeDefined();
    expect(german).toBe(
      (template as string).replace("{{platform}}", "Azure App Service"),
    );
    expect(german).not.toBe("Not on Azure App Service");
  });
});

describe("when the CPU and Memory tiles give way to the platform's section", () => {
  test("only on a platform without usage, once its section shows, and neither tile has a number", () => {
    const shows: (fields: {
      cloudPlatform?: string | null | undefined;
      hasCpuReading?: boolean;
      hasMemoryReading?: boolean;
      hasPlatformSection?: boolean;
    }) => boolean = (fields: {
      cloudPlatform?: string | null | undefined;
      hasCpuReading?: boolean;
      hasMemoryReading?: boolean;
      hasPlatformSection?: boolean;
    }): boolean => {
      return showsCloudAppUsageTiles({
        cloudPlatform:
          "cloudPlatform" in fields
            ? fields.cloudPlatform
            : ManagedCloudPlatform.AzureAppService,
        hasCpuReading: fields.hasCpuReading ?? false,
        hasMemoryReading: fields.hasMemoryReading ?? false,
        hasPlatformSection: fields.hasPlatformSection ?? true,
      });
    };

    // The issue's app, its site connected: the section has its CPU and memory.
    expect(shows({})).toBe(false);
    // Not connected (or the look-up failed): the tiles say why they are empty.
    expect(shows({ hasPlatformSection: false })).toBe(true);
    // A number is never hidden.
    expect(shows({ hasCpuReading: true })).toBe(true);
    expect(shows({ hasMemoryReading: true })).toBe(true);
    // A platform whose instances report usage keeps its tiles, section or not.
    expect(shows({ cloudPlatform: ManagedCloudPlatform.AwsEcs })).toBe(true);
    expect(shows({ cloudPlatform: null })).toBe(true);
    expect(shows({ cloudPlatform: "" })).toBe(true);
  });

  test("every platform without usage gives way, every other keeps its tiles", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      expect({
        platform: descriptor.platform,
        shows: showsCloudAppUsageTiles({
          cloudPlatform: descriptor.platform,
          hasCpuReading: false,
          hasMemoryReading: false,
          hasPlatformSection: true,
        }),
      }).toEqual({
        platform: descriptor.platform,
        shows: !CLOUD_APP_PLATFORMS_WITHOUT_USAGE.has(descriptor.platform),
      });
    }
  });
});

describe("the Instances tile's note", () => {
  test("a running app that never named an instance reads Not reported, not 0", () => {
    expect(
      getCloudAppInstancesTileNote({
        isRunning: true,
        hasReportedInstances: false,
      }),
    ).toBe(CLOUD_APP_NOT_REPORTED_NOTE);
  });

  test("a count of instances shows, and an app not running reads its 0", () => {
    expect(
      getCloudAppInstancesTileNote({
        isRunning: true,
        hasReportedInstances: true,
      }),
    ).toBeUndefined();
    expect(
      getCloudAppInstancesTileNote({
        isRunning: false,
        hasReportedInstances: false,
      }),
    ).toBeUndefined();
  });
});

describe("the platform's name in a sentence", () => {
  test("each managed platform is named as its console names it", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      expect(getCloudAppPlatformName(descriptor.platform)).toBe(
        descriptor.productName,
      );
    }
  });

  test("a platform OneUptime does not know is named by its raw value, and none by nothing", () => {
    expect(getCloudAppPlatformName("heroku")).toBe("heroku");
    expect(getCloudAppPlatformName(null)).toBe("");
    expect(getCloudAppPlatformName(undefined)).toBe("");
  });
});

describe("when the page leads with its Setup check", () => {
  const complete: CloudAppSetupInput = setupInput({
    app: {
      cloudPlatform: ManagedCloudPlatform.AzureAppService,
      tracesLastReceivedAt: minutesBefore(1),
      currentRevision: "2026.11.1",
    },
    isRunning: true,
    hasReportedInstances: true,
  });

  test("not once traces, an instance and a version all arrive", () => {
    expect(isCloudAppSetupIncomplete(complete)).toBe(false);
  });

  test("while no trace has arrived", () => {
    expect(
      isCloudAppSetupIncomplete({
        ...complete,
        app: { ...complete.app, tracesLastReceivedAt: null },
      }),
    ).toBe(true);
  });

  test("while a running app names no instance - but not for an app that is not running", () => {
    expect(
      isCloudAppSetupIncomplete({ ...complete, hasReportedInstances: false }),
    ).toBe(true);
    expect(
      isCloudAppSetupIncomplete({
        ...complete,
        isRunning: false,
        hasReportedInstances: false,
      }),
    ).toBe(false);
  });

  test("while the app reports no version, a blank one included", () => {
    expect(
      isCloudAppSetupIncomplete({
        ...complete,
        app: { ...complete.app, currentRevision: undefined },
      }),
    ).toBe(true);
    expect(
      isCloudAppSetupIncomplete({
        ...complete,
        app: { ...complete.app, currentRevision: "   " },
      }),
    ).toBe(true);
  });

  test("the issue's app - only metrics, no instance, no version - leads with it", () => {
    expect(
      isCloudAppSetupIncomplete(
        setupInput({
          app: {
            cloudPlatform: ManagedCloudPlatform.AzureAppService,
            metricsLastReceivedAt: minutesBefore(1),
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("the Setup check's rows", () => {
  test("the issue's App Service app: what arrives, what does not, and what to add", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          metricsLastReceivedAt: minutesBefore(2),
          signalArrivalsTrackedSince: TRACKED_SINCE,
          createdAt: CREATED_AT,
        },
        isRunning: true,
        hasReportedInstances: false,
        platformResource: CloudAppPlatformResourceState.NotFound,
      }),
    );
    const since: string = formatCloudAppSinceDate(TRACKED_SINCE, NOW);

    expect(
      rows.map((row: CloudAppSetupRow): CloudAppSetupRowKey => {
        return row.key;
      }),
    ).toEqual([
      CloudAppSetupRowKey.Traces,
      CloudAppSetupRowKey.Metrics,
      CloudAppSetupRowKey.Logs,
      CloudAppSetupRowKey.Instances,
      CloudAppSetupRowKey.Revision,
      CloudAppSetupRowKey.AzureMonitor,
    ]);

    expect(rowOf(rows, CloudAppSetupRowKey.Traces)).toEqual({
      key: CloudAppSetupRowKey.Traces,
      label: "Traces",
      tone: "warning",
      text: `None since ${since}.`,
      hint: CLOUD_APP_TRACES_HINT,
    });
    expect(rowOf(rows, CloudAppSetupRowKey.Metrics)).toEqual({
      key: CloudAppSetupRowKey.Metrics,
      label: "Metrics",
      tone: "ok",
      text: `Arriving. The latest came in ${OneUptimeDate.fromNow(minutesBefore(2), NOW)}.`,
    });
    // Nothing on the page needs logs: a grey dash, nothing asked.
    expect(rowOf(rows, CloudAppSetupRowKey.Logs)).toEqual({
      key: CloudAppSetupRowKey.Logs,
      label: "Logs",
      tone: "off",
      text: `None since ${since}.`,
      hint: undefined,
    });
    expect(rowOf(rows, CloudAppSetupRowKey.Instances)).toEqual({
      key: CloudAppSetupRowKey.Instances,
      label: "Instances",
      tone: "warning",
      text: CLOUD_APP_ROW_NOT_REPORTED,
      hint: CLOUD_APP_INSTANCES_HINT,
    });
    expect(rowOf(rows, CloudAppSetupRowKey.Revision)).toEqual({
      key: CloudAppSetupRowKey.Revision,
      label: "Revision",
      tone: "warning",
      text: CLOUD_APP_ROW_NOT_REPORTED,
      hint: CLOUD_APP_REVISION_HINT,
    });
    expect(rowOf(rows, CloudAppSetupRowKey.AzureMonitor)).toEqual({
      key: CloudAppSetupRowKey.AzureMonitor,
      label: "Azure Monitor",
      tone: "off",
      text: CLOUD_APP_ROW_NOT_CONNECTED,
      hint: CLOUD_APP_AZURE_MONITOR_HINT,
    });
  });

  test("a kind that arrived once, not lately, is quiet: still a green check, with when", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: { tracesLastReceivedAt: minutesBefore(6 * 60) },
      }),
    );

    expect(rowOf(rows, CloudAppSetupRowKey.Traces)).toEqual({
      key: CloudAppSetupRowKey.Traces,
      label: "Traces",
      tone: "ok",
      text: `Quiet. The latest came in ${OneUptimeDate.fromNow(minutesBefore(6 * 60), NOW)}.`,
    });
  });

  test("with no date to say since when, a missing kind is Not set up", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({ app: {} }),
    );

    expect(rowOf(rows, CloudAppSetupRowKey.Traces).text).toBe(
      CLOUD_APP_ROW_NONE,
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Metrics).text).toBe(
      CLOUD_APP_ROW_NONE,
    );
  });

  test("an app that is not running and names no instance is not reporting, and is asked for nothing", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({ isRunning: false, hasReportedInstances: false }),
    );

    expect(rowOf(rows, CloudAppSetupRowKey.Instances)).toEqual({
      key: CloudAppSetupRowKey.Instances,
      label: "Instances",
      tone: "off",
      text: CLOUD_APP_ROW_NOT_REPORTING,
      hint: undefined,
    });
    expect(CLOUD_APP_ROW_NOT_REPORTING).toBe("Not reporting");
  });

  test("instances and a version that arrive are Reported, with nothing asked", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          currentRevision: "2026.11.1",
        },
        hasReportedInstances: true,
      }),
    );

    for (const key of [
      CloudAppSetupRowKey.Instances,
      CloudAppSetupRowKey.Revision,
    ]) {
      expect(rowOf(rows, key).tone).toBe("ok");
      expect(rowOf(rows, key).text).toBe(CLOUD_APP_ROW_REPORTED);
      expect(rowOf(rows, key).hint).toBeUndefined();
    }
  });

  test("the version row is named as the app's platform names a revision", () => {
    const labelOn: (platform: ManagedCloudPlatform) => string = (
      platform: ManagedCloudPlatform,
    ): string => {
      return rowOf(
        getCloudAppSetupRows(setupInput({ app: { cloudPlatform: platform } })),
        CloudAppSetupRowKey.Revision,
      ).label;
    };

    expect(labelOn(ManagedCloudPlatform.AwsEcs)).toBe(
      "Task definition revision",
    );
    expect(labelOn(ManagedCloudPlatform.GcpAppEngine)).toBe("Version");
    expect(labelOn(ManagedCloudPlatform.AwsElasticBeanstalk)).toBe("Version");
    expect(labelOn(ManagedCloudPlatform.GcpCloudRun)).toBe("Revision");
    expect(labelOn(ManagedCloudPlatform.AzureAppService)).toBe("Revision");
  });

  test("Azure Monitor's row follows the look-up: checking, connected, or not connected", () => {
    const azureRow: (
      state: CloudAppPlatformResourceState,
    ) => CloudAppSetupRow = (
      state: CloudAppPlatformResourceState,
    ): CloudAppSetupRow => {
      return rowOf(
        getCloudAppSetupRows(setupInput({ platformResource: state })),
        CloudAppSetupRowKey.AzureMonitor,
      );
    };

    expect(azureRow(CloudAppPlatformResourceState.Checking)).toEqual({
      key: CloudAppSetupRowKey.AzureMonitor,
      label: "Azure Monitor",
      tone: "waiting",
      text: CLOUD_APP_ROW_CHECKING,
      hint: undefined,
    });
    expect(azureRow(CloudAppPlatformResourceState.Found)).toEqual({
      key: CloudAppSetupRowKey.AzureMonitor,
      label: "Azure Monitor",
      tone: "ok",
      text: CLOUD_APP_ROW_CONNECTED,
      hint: CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT,
    });
    expect(azureRow(CloudAppPlatformResourceState.NotFound)).toEqual({
      key: CloudAppSetupRowKey.AzureMonitor,
      label: "Azure Monitor",
      tone: "off",
      text: CLOUD_APP_ROW_NOT_CONNECTED,
      hint: CLOUD_APP_AZURE_MONITOR_HINT,
    });
  });

  test("an app on a platform with no resource to look up has no Azure Monitor row", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: { cloudPlatform: ManagedCloudPlatform.AwsEcs },
        platformResource: undefined,
      }),
    );

    expect(
      rows.some((row: CloudAppSetupRow): boolean => {
        return row.key === CloudAppSetupRowKey.AzureMonitor;
      }),
    ).toBe(false);
    expect(rows.length).toBe(5);
  });

  test("every row is worded in the reader's language", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          metricsLastReceivedAt: minutesBefore(2),
          signalArrivalsTrackedSince: TRACKED_SINCE,
        },
        platformResource: CloudAppPlatformResourceState.NotFound,
        translator: GERMAN,
      }),
    );
    const german: Record<string, string> = readDashboardLocale("de");

    expect(rowOf(rows, CloudAppSetupRowKey.Traces).label).toBe(
      german["Traces"],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Traces).hint).toBe(
      german[CLOUD_APP_TRACES_HINT],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Instances).text).toBe(
      german[CLOUD_APP_ROW_NOT_REPORTED],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Instances).hint).toBe(
      german[CLOUD_APP_INSTANCES_HINT],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.AzureMonitor).hint).toBe(
      german[CLOUD_APP_AZURE_MONITOR_HINT],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Traces).text).not.toMatch(
      /^None since/,
    );
  });
});

describe("since when, as a row says it", () => {
  test("within two days a date reads with its time; older, the day is enough", () => {
    const recent: Date = minutesBefore(60);
    const old: Date = minutesBefore(5 * 24 * 60);

    expect(formatCloudAppSinceDate(recent, NOW)).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(recent, false),
    );
    expect(formatCloudAppSinceDate(old, NOW)).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(old, true),
    );
  });
});

describe("the words, in every language", () => {
  const WORDS: Array<string> = [
    CLOUD_APP_NO_TRACES_NOTE,
    CLOUD_APP_NOT_REPORTED_NOTE,
    CLOUD_APP_NOT_ON_PLATFORM_NOTE,
    CLOUD_APP_LOAD_FAILED_SUBLABEL,
    CLOUD_APP_SETUP_TITLE,
    CLOUD_APP_SETUP_DESCRIPTION,
    CLOUD_APP_SETUP_GUIDE,
    CLOUD_APP_ROW_ARRIVING,
    CLOUD_APP_ROW_QUIET,
    CLOUD_APP_ROW_NONE_SINCE,
    CLOUD_APP_ROW_NONE,
    CLOUD_APP_ROW_REPORTED,
    CLOUD_APP_ROW_NOT_REPORTED,
    CLOUD_APP_ROW_NOT_REPORTING,
    CLOUD_APP_ROW_CHECKING,
    CLOUD_APP_ROW_CONNECTED,
    CLOUD_APP_ROW_NOT_CONNECTED,
    CLOUD_APP_TRACES_HINT,
    CLOUD_APP_INSTANCES_HINT,
    CLOUD_APP_REVISION_HINT,
    CLOUD_APP_AZURE_MONITOR_HINT,
    CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT,
    ...Object.values(CLOUD_APP_ROW_LABELS),
  ];

  test("every word the page says is a key of the English locale", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const word of WORDS) {
      expect({ word, inEnglish: english[word] === word }).toEqual({
        word,
        inEnglish: true,
      });
    }
  });

  test("and each language words it", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const word of WORDS) {
        expect({
          language,
          word,
          worded: isWordedInDashboardLocale(word, language),
        }).toEqual({ language, word, worded: true });
      }
    }
  });

  test("a translated template keeps its placeholders", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const [template, placeholder] of [
        [CLOUD_APP_NOT_ON_PLATFORM_NOTE, "{{platform}}"],
        [CLOUD_APP_ROW_ARRIVING, "{{time}}"],
        [CLOUD_APP_ROW_QUIET, "{{time}}"],
        [CLOUD_APP_ROW_NONE_SINCE, "{{date}}"],
      ] as Array<[string, string]>) {
        expect({
          language,
          template,
          keeps: (words[template] || "").includes(placeholder),
        }).toEqual({ language, template, keeps: true });
      }
    }
  });

  test("each platform without usage is named whole inside every language's note", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const platform of CLOUD_APP_PLATFORMS_WITHOUT_USAGE) {
        const descriptor: ManagedCloudPlatformDescriptor | undefined =
          MANAGED_CLOUD_PLATFORMS.find(
            (candidate: ManagedCloudPlatformDescriptor): boolean => {
              return candidate.platform === platform;
            },
          );
        const note: string | undefined = getCloudAppUsageTileNote({
          cloudPlatform: platform,
          isRunning: true,
          hasReading: false,
          translator,
        });

        expect({
          language,
          platform,
          named: note?.includes(descriptor?.productName || "?"),
        }).toEqual({
          language,
          platform,
          named: true,
        });
      }
    }
  });
});
