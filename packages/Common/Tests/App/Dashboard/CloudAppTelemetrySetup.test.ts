import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_APP_AZURE_DEPLOYMENT,
  CLOUD_APP_AZURE_FIRST_READ,
  CLOUD_APP_AZURE_FIRST_READ_HINT,
  CLOUD_APP_AZURE_IMAGE,
  CLOUD_APP_AZURE_INSTANCES,
  CLOUD_APP_AZURE_INSTANCES_HINT,
  CLOUD_APP_AZURE_METRICS_NEED_CONNECTION,
  CLOUD_APP_AZURE_METRICS_NEXT_READ,
  CLOUD_APP_AZURE_METRICS_NOT_READ,
  CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT,
  CLOUD_APP_AZURE_MONITOR_HINT,
  CLOUD_APP_AZURE_NO_CONNECTION,
  CLOUD_APP_AZURE_NO_SITES,
  CLOUD_APP_AZURE_NO_SUBSCRIPTION,
  CLOUD_APP_AZURE_READ_BY,
  CLOUD_APP_AZURE_RESOURCE_ID_HINT,
  CLOUD_APP_AZURE_SITE_ELSEWHERE,
  CLOUD_APP_AZURE_SITE_ELSEWHERE_HINT,
  CLOUD_APP_AZURE_SITE_NAME_HINT,
  CLOUD_APP_AZURE_SITE_NOT_FOUND,
  CLOUD_APP_AZURE_SITE_READ,
  CLOUD_APP_AZURE_SLOT,
  CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ,
  CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ_HINT,
  CLOUD_APP_AZURE_CONNECTION_FAILING,
  CLOUD_APP_AZURE_CONNECTION_OFF,
  CLOUD_APP_INSTANCES_HINT,
  CLOUD_APP_LOAD_FAILED_SUBLABEL,
  CLOUD_APP_LOGS_LATEST_FROM_APP,
  CLOUD_APP_LOGS_LATEST_FROM_AZURE,
  CLOUD_APP_NO_TRACES_NOTE,
  CLOUD_APP_NOT_ON_PLATFORM_NOTE,
  CLOUD_APP_NOT_REPORTED_NOTE,
  CLOUD_APP_OPEN_CONNECTIONS,
  CLOUD_APP_PLATFORMS_WITHOUT_USAGE,
  CLOUD_APP_REVISION_HINT,
  CLOUD_APP_ROW_CHECKING,
  CLOUD_APP_ROW_CONNECTED,
  CLOUD_APP_ROW_LABELS,
  CLOUD_APP_ROW_LATEST,
  CLOUD_APP_ROW_NONE,
  CLOUD_APP_ROW_NONE_SINCE,
  CLOUD_APP_ROW_NONE_YET,
  CLOUD_APP_ROW_NOT_CHECKED,
  CLOUD_APP_ROW_NOT_CONNECTED,
  CLOUD_APP_ROW_NOT_REPORTED,
  CLOUD_APP_ROW_NOT_REPORTING,
  CLOUD_APP_ROW_REPORTED,
  CLOUD_APP_ROW_WAITING_FOR_FIRST_READ,
  CLOUD_APP_SEND_WITH_OTEL_HINT,
  CLOUD_APP_SERVICE_LOGS_HINT,
  CLOUD_APP_SET_UP_TELEMETRY,
  CLOUD_APP_SETUP_ACTION_LABELS,
  CLOUD_APP_SETUP_DESCRIPTION,
  CLOUD_APP_SETUP_GUIDE,
  CLOUD_APP_SETUP_STATUS_LABELS,
  CLOUD_APP_SETUP_TITLE,
  CLOUD_APP_TRACES_HINT,
  CLOUD_APP_TRAFFIC_SIGNAL_RECEIVED_MS,
  CloudAppArrival,
  CloudAppArrivalSource,
  CloudAppArrivalState,
  CloudAppAzureMonitorLookup,
  CloudAppSetupAction,
  CloudAppSetupInput,
  CloudAppSetupRow,
  CloudAppSetupRowKey,
  CloudAppSetupStatus,
  formatCloudAppSinceDate,
  getCloudAppArrival,
  getCloudAppInstancesTileNote,
  getCloudAppPlatformName,
  getCloudAppSetupRows,
  getCloudAppTraceTileNote,
  getCloudAppUsageTileNote,
  getCloudEnvironmentTraceTileNote,
  getShortAppServiceDeploymentId,
  hasCloudAppSentTraces,
  isCloudAppSetupIncomplete,
  showsCloudAppUsageTiles,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import {
  CloudAppAzureLink,
  CloudAppAzureMonitorState,
  getCloudAppAzureMonitorState,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppAzureLink";
import {
  CloudAppSiteMatch,
  CloudAppSubscriptionSource,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import {
  AppServiceDeploymentStatus,
  AppServiceInstanceState,
  AppServiceSiteActivity,
  AppServiceSiteReadError,
} from "../../../Types/Cloud/AppServiceSiteActivity";
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

// ---- #10294: every signal on a row of its own -------------------------------

const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const OTHER_SUBSCRIPTION: string = "3f1c9a52-7d4e-4b8a-9e21-6c5d0b7a2f13";
const SITE: string = "azure-monitor-collector-northcentralus";
const SITE_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-monitoring/providers/Microsoft.Web/sites/${SITE}`;

function connection(fields: Partial<CloudConnection> = {}): CloudConnection {
  return Object.assign(new CloudConnection(), {
    _id: "77100000-0000-4000-8000-000000000001",
    name: "Azure production",
    provider: "azure",
    config: { readIntervalInMinutes: 5 },
    isEnabled: true,
    lastPulledAt: minutesBefore(5),
    lastSuccessfulPullAt: minutesBefore(5),
    ...fields,
  });
}

function site(fields: Partial<CloudResource> = {}): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: "78000000-0000-4000-8000-000000000001",
    name: SITE,
    providerResourceId: SITE_ID,
    cloudReadings: {
      requests: { value: 120, time: minutesBefore(6).toISOString() },
    },
    cloudReadingsAt: minutesBefore(4),
    ...fields,
  });
}

// The app's way to Azure Monitor, its links as each test names them.
function link(fields: Partial<CloudAppAzureLink> = {}): CloudAppAzureLink {
  return {
    siteName: SITE,
    slot: null,
    subscription: {
      id: SUBSCRIPTION,
      source: CloudAppSubscriptionSource.Environment,
    },
    site: null,
    matchedBy: null,
    elsewhere: [],
    account: Object.assign(new CloudAccount(), { accountId: SUBSCRIPTION }),
    connection: connection(),
    azureConnections: 1,
    connectionsChecked: true,
    sitesInSubscription: 3,
    ...fields,
  };
}

function read(
  fields: Partial<CloudAppAzureLink> = {},
): CloudAppAzureMonitorLookup {
  return { status: "read", link: link(fields) };
}

const CONNECTED: CloudAppAzureMonitorLookup = read({
  site: site(),
  matchedBy: CloudAppSiteMatch.Name,
});

const INSTANCE_A: string =
  "8f0a3d1c2b4e6f8a0c2e4a6b8d0f1e3c5a7b9d1f3e5c7a9b1d3f5e7c9a1b3d5e";
const INSTANCE_B: string =
  "1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d";

function activity(
  fields: Partial<AppServiceSiteActivity> = {},
): AppServiceSiteActivity {
  return {
    readAt: NOW.toISOString(),
    instances: {
      items: [
        { id: INSTANCE_A, state: AppServiceInstanceState.Ready },
        { id: INSTANCE_B, state: AppServiceInstanceState.Ready },
        { id: "stopped", state: AppServiceInstanceState.Stopped },
      ],
    },
    deployments: {
      items: [
        {
          id: "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
          status: AppServiceDeploymentStatus.Succeeded,
          active: true,
          author: "Ops Bot",
          deployer: "GitHub",
          message: "Merge pull request #212",
          startTime: minutesBefore(95).toISOString(),
          endTime: minutesBefore(90).toISOString(),
        },
      ],
    },
    image: null,
    ...fields,
  };
}

interface RowView {
  status: CloudAppSetupStatus;
  statusLabel: string;
  tone: string;
  text: string;
  hint?: string | undefined;
  action?: CloudAppSetupAction | undefined;
}

function viewOf(row: CloudAppSetupRow): RowView {
  return {
    status: row.status,
    statusLabel: row.statusLabel,
    tone: row.tone,
    text: row.text,
    hint: row.hint,
    action: row.action,
  };
}

function keysOf(rows: Array<CloudAppSetupRow>): Array<CloudAppSetupRowKey> {
  return rows.map((row: CloudAppSetupRow): CloudAppSetupRowKey => {
    return row.key;
  });
}

const APP_SERVICE_ROWS: Array<CloudAppSetupRowKey> = [
  CloudAppSetupRowKey.AzureMonitor,
  CloudAppSetupRowKey.AzureMonitorMetrics,
  CloudAppSetupRowKey.Traces,
  CloudAppSetupRowKey.Metrics,
  CloudAppSetupRowKey.Logs,
  CloudAppSetupRowKey.Instances,
  CloudAppSetupRowKey.Revision,
];

function ago(minutes: number): string {
  return OneUptimeDate.fromNow(minutesBefore(minutes), NOW);
}

describe("the Setup check of an App Service app, for each set of signals it sends", () => {
  const since: string = formatCloudAppSinceDate(TRACKED_SINCE, NOW);

  test("none: its subscription not connected, nothing sent, nothing named - each row says what to set up", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        azureMonitor: read({
          account: null,
          connection: null,
          azureConnections: 0,
          sitesInSubscription: null,
        }),
      }),
    );

    expect(keysOf(rows)).toEqual(APP_SERVICE_ROWS);
    expect(rows.map(viewOf)).toEqual([
      {
        status: CloudAppSetupStatus.NeedsSetup,
        statusLabel: CLOUD_APP_ROW_NOT_CONNECTED,
        tone: "setup",
        text: CLOUD_APP_AZURE_NO_CONNECTION,
        hint: CLOUD_APP_AZURE_MONITOR_HINT,
        action: CloudAppSetupAction.ConnectCloud,
      },
      {
        status: CloudAppSetupStatus.NeedsSetup,
        statusLabel: "Needs setup",
        tone: "setup",
        text: CLOUD_APP_AZURE_METRICS_NEED_CONNECTION,
        hint: undefined,
        action: undefined,
      },
      {
        status: CloudAppSetupStatus.NeedsSetup,
        statusLabel: "Needs setup",
        tone: "setup",
        text: `None since ${since}.`,
        hint: CLOUD_APP_TRACES_HINT,
        action: CloudAppSetupAction.SetUpTelemetry,
      },
      // Nothing on the page waits for its own metrics: grey, not asked for.
      {
        status: CloudAppSetupStatus.NotSetUp,
        statusLabel: CLOUD_APP_ROW_NONE,
        tone: "off",
        text: `None since ${since}.`,
        hint: CLOUD_APP_SEND_WITH_OTEL_HINT,
        action: undefined,
      },
      {
        status: CloudAppSetupStatus.NeedsSetup,
        statusLabel: "Needs setup",
        tone: "setup",
        text: `None since ${since}.`,
        hint: CLOUD_APP_SERVICE_LOGS_HINT,
        action: CloudAppSetupAction.SetUpTelemetry,
      },
      {
        status: CloudAppSetupStatus.NeedsSetup,
        statusLabel: "Needs setup",
        tone: "setup",
        text: CLOUD_APP_ROW_NOT_REPORTED,
        hint: CLOUD_APP_INSTANCES_HINT,
        action: undefined,
      },
      {
        status: CloudAppSetupStatus.NeedsSetup,
        statusLabel: "Needs setup",
        tone: "setup",
        text: CLOUD_APP_ROW_NOT_REPORTED,
        hint: CLOUD_APP_REVISION_HINT,
        action: undefined,
      },
    ]);
    expect(isCloudAppSetupIncomplete(rows)).toBe(true);
  });

  test("metrics only - the issue's app: its connected subscription holds no site of its name, and that is what it says", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          metricsLastReceivedAt: minutesBefore(3),
          signalArrivalsTrackedSince: TRACKED_SINCE,
          createdAt: CREATED_AT,
        },
        azureMonitor: read(),
      }),
    );

    expect(keysOf(rows)).toEqual(APP_SERVICE_ROWS);
    expect(viewOf(rowOf(rows, CloudAppSetupRowKey.AzureMonitor))).toEqual({
      status: CloudAppSetupStatus.NeedsSetup,
      statusLabel: "Needs setup",
      tone: "setup",
      text: `Subscription ${SUBSCRIPTION} is connected, but holds no App Service app named ${SITE}.`,
      hint: CLOUD_APP_AZURE_SITE_NAME_HINT,
      action: undefined,
    });
    // Never "Not connected" for a subscription that is.
    for (const row of rows) {
      expect(row.statusLabel).not.toBe(CLOUD_APP_ROW_NOT_CONNECTED);
    }
    expect(viewOf(rowOf(rows, CloudAppSetupRowKey.Metrics))).toEqual({
      status: CloudAppSetupStatus.Received,
      statusLabel: "Received",
      tone: "ok",
      text: `The latest came in ${ago(3)}.`,
      hint: undefined,
      action: undefined,
    });
    // Its own metrics are not Azure Monitor's: that row has its own state.
    expect(rowOf(rows, CloudAppSetupRowKey.AzureMonitorMetrics).status).toBe(
      CloudAppSetupStatus.NeedsSetup,
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Traces).status).toBe(
      CloudAppSetupStatus.NeedsSetup,
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Logs).status).toBe(
      CloudAppSetupStatus.NeedsSetup,
    );
    expect(isCloudAppSetupIncomplete(rows)).toBe(true);
  });

  test("metrics and traces: its site found, Azure Monitor's numbers arriving, and still the logs, instances and version to set up", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          metricsLastReceivedAt: minutesBefore(1),
          tracesLastReceivedAt: minutesBefore(2),
          signalArrivalsTrackedSince: TRACKED_SINCE,
        },
        azureMonitor: CONNECTED,
      }),
    );

    expect(viewOf(rowOf(rows, CloudAppSetupRowKey.AzureMonitor))).toEqual({
      status: CloudAppSetupStatus.Received,
      statusLabel: CLOUD_APP_ROW_CONNECTED,
      tone: "ok",
      text: `The connection Azure production reads ${SITE} in subscription ${SUBSCRIPTION}.`,
      hint: CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT,
      action: undefined,
    });
    expect(
      viewOf(rowOf(rows, CloudAppSetupRowKey.AzureMonitorMetrics)),
    ).toEqual({
      status: CloudAppSetupStatus.Received,
      statusLabel: "Received",
      tone: "ok",
      text: `The latest came in ${ago(6)}.`,
      hint: undefined,
      action: undefined,
    });
    expect(rowOf(rows, CloudAppSetupRowKey.Traces).status).toBe(
      CloudAppSetupStatus.Received,
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Metrics).status).toBe(
      CloudAppSetupStatus.Received,
    );
    for (const key of [
      CloudAppSetupRowKey.Logs,
      CloudAppSetupRowKey.Instances,
      CloudAppSetupRowKey.Revision,
    ]) {
      expect({ key, status: rowOf(rows, key).status }).toEqual({
        key,
        status: CloudAppSetupStatus.NeedsSetup,
      });
    }
    expect(isCloudAppSetupIncomplete(rows)).toBe(true);
  });

  test("everything: each row received, and the page leads with its numbers alone", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          metricsLastReceivedAt: minutesBefore(1),
          tracesLastReceivedAt: minutesBefore(1),
          logsLastReceivedAt: minutesBefore(2),
          currentRevision: "2026.11.20",
          signalArrivalsTrackedSince: TRACKED_SINCE,
        },
        hasReportedInstances: true,
        azureMonitor: CONNECTED,
        diagnosticLogsLastReceivedAt: minutesBefore(4),
        azureActivity: activity(),
      }),
    );

    expect(
      rows.map((row: CloudAppSetupRow) => {
        return [row.key, row.status];
      }),
    ).toEqual(
      APP_SERVICE_ROWS.map((key: CloudAppSetupRowKey) => {
        return [key, CloudAppSetupStatus.Received];
      }),
    );
    // The app's own logs are the newest: said as the app's.
    expect(rowOf(rows, CloudAppSetupRowKey.Logs).text).toBe(
      `The latest came in ${ago(2)}, from the app's OpenTelemetry.`,
    );
    // Azure's count beside the instances the telemetry names.
    expect(rowOf(rows, CloudAppSetupRowKey.Instances).text).toBe(
      "Azure runs 2 instances.",
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Revision).text).toBe(
      CLOUD_APP_ROW_REPORTED,
    );
    expect(isCloudAppSetupIncomplete(rows)).toBe(false);
  });
});

describe("the Azure Monitor connection's row, link by link", () => {
  function connectionRow(lookup: CloudAppAzureMonitorLookup): RowView {
    return viewOf(
      rowOf(
        getCloudAppSetupRows(setupInput({ azureMonitor: lookup })),
        CloudAppSetupRowKey.AzureMonitor,
      ),
    );
  }

  test("checking, while it is looked up: neither connected nor not", () => {
    expect(connectionRow({ status: "checking" })).toEqual({
      status: CloudAppSetupStatus.Checking,
      statusLabel: CLOUD_APP_ROW_CHECKING,
      tone: "waiting",
      text: CLOUD_APP_ROW_CHECKING,
      hint: undefined,
      action: undefined,
    });
  });

  test("a look-up that failed says it could not check - never 'Not connected'", () => {
    for (const lookup of [
      { status: "failed" } as CloudAppAzureMonitorLookup,
      read({ connectionsChecked: false, azureConnections: null }),
    ]) {
      expect(connectionRow(lookup)).toEqual({
        status: CloudAppSetupStatus.NotAvailable,
        statusLabel: "Not available",
        tone: "off",
        text: CLOUD_APP_ROW_NOT_CHECKED,
        hint: undefined,
        action: undefined,
      });
    }
  });

  test("a site found with no connection name to say: OneUptime reads it", () => {
    expect(
      connectionRow(
        read({
          site: site(),
          matchedBy: CloudAppSiteMatch.ResourceId,
          connectionsChecked: false,
          connection: null,
        }),
      ).text,
    ).toBe(`OneUptime reads ${SITE} in subscription ${SUBSCRIPTION}.`);
  });

  test("the subscription no Azure connection reads, named, with how to add it", () => {
    expect(
      connectionRow(
        read({ account: null, connection: null, azureConnections: 2 }),
      ),
    ).toEqual({
      status: CloudAppSetupStatus.NeedsSetup,
      statusLabel: CLOUD_APP_ROW_NOT_CONNECTED,
      tone: "setup",
      text: `No Azure connection reads subscription ${SUBSCRIPTION}.`,
      hint: CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ_HINT,
      action: CloudAppSetupAction.OpenConnections,
    });
  });

  test("telemetry that names no subscription, and no site of the app's name", () => {
    expect(
      connectionRow(
        read({ subscription: null, account: null, connection: null }),
      ),
    ).toEqual({
      status: CloudAppSetupStatus.NeedsSetup,
      statusLabel: "Needs setup",
      tone: "setup",
      text: `Its telemetry names no Azure subscription, and no connected App Service app is named ${SITE}.`,
      hint: CLOUD_APP_AZURE_RESOURCE_ID_HINT,
      action: undefined,
    });
  });

  test("its connection turned off, or failing: not connected, with the way to the connections", () => {
    expect(
      connectionRow(read({ connection: connection({ isEnabled: false }) })),
    ).toEqual({
      status: CloudAppSetupStatus.NotReceived,
      statusLabel: CLOUD_APP_ROW_NOT_CONNECTED,
      tone: "warning",
      text: "The connection Azure production is turned off.",
      hint: undefined,
      action: CloudAppSetupAction.OpenConnections,
    });
    expect(
      connectionRow(
        read({
          site: site(),
          connection: connection({
            lastPulledAt: minutesBefore(2),
            lastSuccessfulPullAt: minutesBefore(600),
            lastError: "AuthorizationFailed",
          }),
        }),
      ),
    ).toEqual({
      status: CloudAppSetupStatus.NotReceived,
      statusLabel: CLOUD_APP_ROW_NOT_CONNECTED,
      tone: "warning",
      text: "The last read of the connection Azure production failed.",
      hint: undefined,
      action: CloudAppSetupAction.OpenConnections,
    });
  });

  test("its connection's first read still to come", () => {
    expect(
      connectionRow(
        read({
          connection: connection({
            lastPulledAt: undefined,
            lastSuccessfulPullAt: undefined,
          }),
        }),
      ),
    ).toEqual({
      status: CloudAppSetupStatus.Checking,
      statusLabel: CLOUD_APP_ROW_WAITING_FOR_FIRST_READ,
      tone: "waiting",
      text: "The connection Azure production has not finished its first read.",
      hint: CLOUD_APP_AZURE_FIRST_READ_HINT,
      action: undefined,
    });
  });

  test("a connected subscription OneUptime reads no App Service app in yet", () => {
    expect(connectionRow(read({ sitesInSubscription: 0 })).text).toBe(
      `Subscription ${SUBSCRIPTION} is connected, but OneUptime reads no App Service app in it yet.`,
    );
  });

  test("a site of the app's name in another subscription, which a cloud.account.id typed by hand most likely meant", () => {
    expect(
      connectionRow(
        read({
          elsewhere: [
            site({
              providerResourceId: SITE_ID.replace(
                SUBSCRIPTION,
                OTHER_SUBSCRIPTION,
              ),
            }),
          ],
        }),
      ),
    ).toEqual({
      status: CloudAppSetupStatus.NeedsSetup,
      statusLabel: "Needs setup",
      tone: "setup",
      text: `${SITE} is in subscription ${OTHER_SUBSCRIPTION}, not in ${SUBSCRIPTION}, which its telemetry names.`,
      hint: CLOUD_APP_AZURE_SITE_ELSEWHERE_HINT,
      action: undefined,
    });
  });

  test("an app of a deployment slot: not available, and why", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({ azureMonitor: read({ slot: "staging" }) }),
    );

    expect(viewOf(rowOf(rows, CloudAppSetupRowKey.AzureMonitor))).toEqual({
      status: CloudAppSetupStatus.NotAvailable,
      statusLabel: "Not available",
      tone: "off",
      text: "It runs in deployment slot staging, which Azure Monitor reports as a resource of its own that OneUptime does not read yet.",
      hint: undefined,
      action: undefined,
    });
    expect(
      viewOf(rowOf(rows, CloudAppSetupRowKey.AzureMonitorMetrics)).text,
    ).toBe(CLOUD_APP_AZURE_METRICS_NOT_READ);
  });

  test("every state the chain can be in has a row that says it", () => {
    const lookups: Record<
      CloudAppAzureMonitorState,
      CloudAppAzureMonitorLookup
    > = {
      [CloudAppAzureMonitorState.Connected]: CONNECTED,
      [CloudAppAzureMonitorState.Slot]: read({ slot: "staging" }),
      [CloudAppAzureMonitorState.NoConnection]: read({
        account: null,
        connection: null,
        azureConnections: 0,
      }),
      [CloudAppAzureMonitorState.SubscriptionNotRead]: read({
        account: null,
        connection: null,
      }),
      [CloudAppAzureMonitorState.NoSubscription]: read({
        subscription: null,
        account: null,
        connection: null,
      }),
      [CloudAppAzureMonitorState.ConnectionOff]: read({
        connection: connection({ isEnabled: false }),
      }),
      [CloudAppAzureMonitorState.ConnectionFailing]: read({
        connection: connection({
          lastSuccessfulPullAt: undefined,
          lastError: "AuthorizationFailed",
        }),
      }),
      [CloudAppAzureMonitorState.FirstReadPending]: read({
        connection: connection({
          lastPulledAt: undefined,
          lastSuccessfulPullAt: undefined,
        }),
      }),
      [CloudAppAzureMonitorState.SiteNotFound]: read(),
      [CloudAppAzureMonitorState.SiteInOtherSubscription]: read({
        elsewhere: [site()],
      }),
      [CloudAppAzureMonitorState.Unknown]: read({ connectionsChecked: false }),
    };

    const texts: Set<string> = new Set<string>();

    for (const state of Object.values(CloudAppAzureMonitorState)) {
      const lookup: CloudAppAzureMonitorLookup = lookups[state];

      expect({
        state,
        read:
          lookup.status === "read"
            ? getCloudAppAzureMonitorState(lookup.link)
            : null,
      }).toEqual({ state, read: state });

      const row: RowView = connectionRow(lookup);

      expect(row.text.length).toBeGreaterThan(0);
      texts.add(row.text);
    }

    // Each says something of its own.
    expect(texts.size).toBe(Object.values(CloudAppAzureMonitorState).length);
  });
});

describe("the Azure Monitor metrics' row", () => {
  function metricsRow(lookup: CloudAppAzureMonitorLookup): CloudAppSetupRow {
    return rowOf(
      getCloudAppSetupRows(setupInput({ azureMonitor: lookup })),
      CloudAppSetupRowKey.AzureMonitorMetrics,
    );
  }

  test("received while its newest reading is within two reads and a quarter hour, at every read interval", () => {
    for (const interval of [5, 10, 15, 30, 60]) {
      const window: number = 2 * interval + 15;
      const at: (minutes: number) => CloudAppAzureMonitorLookup = (
        minutes: number,
      ): CloudAppAzureMonitorLookup => {
        return read({
          site: site({
            cloudReadings: {
              requests: {
                value: 1,
                time: minutesBefore(minutes).toISOString(),
              },
            },
          }),
          connection: connection({
            config: { readIntervalInMinutes: interval },
          }),
        });
      };

      expect({ interval, status: metricsRow(at(window)).status }).toEqual({
        interval,
        status: CloudAppSetupStatus.Received,
      });
      expect({ interval, status: metricsRow(at(window + 1)).status }).toEqual({
        interval,
        status: CloudAppSetupStatus.NotReceived,
      });
    }
  });

  test("a site found with no reading yet: they come with the next read", () => {
    expect(
      viewOf(
        metricsRow(
          read({
            site: site({ cloudReadings: {}, cloudReadingsAt: undefined }),
          }),
        ),
      ),
    ).toEqual({
      status: CloudAppSetupStatus.NotReceived,
      statusLabel: "Not received",
      tone: "warning",
      text: CLOUD_APP_AZURE_METRICS_NEXT_READ,
      hint: undefined,
      action: undefined,
    });
  });

  test("its connection off: its last reading, not received", () => {
    const row: CloudAppSetupRow = metricsRow(
      read({
        site: site({
          cloudReadings: {
            requests: { value: 1, time: minutesBefore(300).toISOString() },
          },
        }),
        connection: connection({ isEnabled: false }),
      }),
    );

    expect(row.status).toBe(CloudAppSetupStatus.NotReceived);
    expect(row.text).toBe(`The latest came in ${ago(300)}.`);
  });

  test("while it is looked up, checking; when it could not be, not available", () => {
    expect(metricsRow({ status: "checking" }).status).toBe(
      CloudAppSetupStatus.Checking,
    );
    expect(metricsRow({ status: "failed" }).text).toBe(
      CLOUD_APP_ROW_NOT_CHECKED,
    );
  });
});

describe("the logs' row: the app's own, or its site's that Azure streams", () => {
  function logsRow(fields: Partial<CloudAppSetupInput>): CloudAppSetupRow {
    return rowOf(
      getCloudAppSetupRows(setupInput(fields)),
      CloudAppSetupRowKey.Logs,
    );
  }

  test("an App Service app that sends none, whose site's diagnostic settings stream: received, from Azure", () => {
    expect(
      viewOf(
        logsRow({
          azureMonitor: CONNECTED,
          diagnosticLogsLastReceivedAt: minutesBefore(8),
        }),
      ),
    ).toEqual({
      status: CloudAppSetupStatus.Received,
      statusLabel: "Received",
      tone: "ok",
      text: `The latest came in ${ago(8)}, from Azure's diagnostic settings.`,
      hint: undefined,
      action: undefined,
    });
  });

  test("the newest of the two is said, with where it came from", () => {
    expect(
      logsRow({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          logsLastReceivedAt: minutesBefore(30),
        },
        diagnosticLogsLastReceivedAt: minutesBefore(2),
      }).text,
    ).toBe(`The latest came in ${ago(2)}, from Azure's diagnostic settings.`);
    expect(
      logsRow({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          logsLastReceivedAt: minutesBefore(1),
        },
        diagnosticLogsLastReceivedAt: minutesBefore(2),
      }).text,
    ).toBe(`The latest came in ${ago(1)}, from the app's OpenTelemetry.`);
  });

  test("logs come with traffic: received for a day after the latest, not received after", () => {
    expect(
      logsRow({ diagnosticLogsLastReceivedAt: minutesBefore(23 * 60) }).status,
    ).toBe(CloudAppSetupStatus.Received);
    expect(
      logsRow({ diagnosticLogsLastReceivedAt: minutesBefore(25 * 60) }).status,
    ).toBe(CloudAppSetupStatus.NotReceived);
  });

  test("on another platform, how to send them names no Azure setting, and the latest no source", () => {
    expect(
      viewOf(logsRow({ app: { cloudPlatform: ManagedCloudPlatform.AwsEcs } })),
    ).toEqual({
      status: CloudAppSetupStatus.NeedsSetup,
      statusLabel: "Needs setup",
      tone: "setup",
      text: CLOUD_APP_ROW_NONE_YET,
      hint: CLOUD_APP_SEND_WITH_OTEL_HINT,
      action: CloudAppSetupAction.SetUpTelemetry,
    });
    expect(
      logsRow({
        app: {
          cloudPlatform: ManagedCloudPlatform.AwsEcs,
          logsLastReceivedAt: minutesBefore(3),
        },
      }).text,
    ).toBe(`The latest came in ${ago(3)}.`);
  });
});

describe("instances and the revision, from the telemetry and else from Azure", () => {
  test("Azure's instances count while the telemetry names none, with how to name them", () => {
    const row: CloudAppSetupRow = rowOf(
      getCloudAppSetupRows(
        setupInput({ azureMonitor: CONNECTED, azureActivity: activity() }),
      ),
      CloudAppSetupRowKey.Instances,
    );

    expect(viewOf(row)).toEqual({
      status: CloudAppSetupStatus.Received,
      statusLabel: "Received",
      tone: "ok",
      text: "Azure runs 2 instances.",
      hint: CLOUD_APP_AZURE_INSTANCES_HINT,
      action: undefined,
    });
  });

  test("one instance is said as one", () => {
    expect(
      rowOf(
        getCloudAppSetupRows(
          setupInput({
            azureActivity: activity({
              instances: {
                items: [
                  { id: INSTANCE_A, state: AppServiceInstanceState.Ready },
                ],
              },
            }),
          }),
        ),
        CloudAppSetupRowKey.Instances,
      ).text,
    ).toBe("Azure runs 1 instance.");
  });

  test("instances Azure could not list, or lists none running: the telemetry's hint", () => {
    for (const instances of [
      { items: null, error: AppServiceSiteReadError.NoAccess },
      {
        items: [{ id: INSTANCE_A, state: AppServiceInstanceState.Stopped }],
      },
    ]) {
      const row: CloudAppSetupRow = rowOf(
        getCloudAppSetupRows(
          setupInput({ azureActivity: activity({ instances }) }),
        ),
        CloudAppSetupRowKey.Instances,
      );

      expect(row.status).toBe(CloudAppSetupStatus.NeedsSetup);
      expect(row.hint).toBe(CLOUD_APP_INSTANCES_HINT);
    }
  });

  test("Azure's active deployment stands for a version the telemetry does not name", () => {
    expect(
      viewOf(
        rowOf(
          getCloudAppSetupRows(setupInput({ azureActivity: activity() })),
          CloudAppSetupRowKey.Revision,
        ),
      ),
    ).toEqual({
      status: CloudAppSetupStatus.Received,
      statusLabel: "Received",
      tone: "ok",
      text: `Azure's latest deployment, 4d1c9a8, finished ${ago(90)}.`,
      hint: CLOUD_APP_REVISION_HINT,
      action: undefined,
    });
  });

  test("with no deployment, the image a container app runs stands for it", () => {
    expect(
      rowOf(
        getCloudAppSetupRows(
          setupInput({
            azureActivity: activity({
              deployments: { items: [] },
              image: "myregistry.azurecr.io/checkout:1.4.2",
            }),
          }),
        ),
        CloudAppSetupRowKey.Revision,
      ).text,
    ).toBe("Azure runs the image myregistry.azurecr.io/checkout:1.4.2.");
  });

  test("a deployment's id as a row says it: a commit's seven, a GUID's first group, else twelve", () => {
    expect(
      getShortAppServiceDeploymentId(
        "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
      ),
    ).toBe("4d1c9a8");
    expect(
      getShortAppServiceDeploymentId("0c8f1d2e-3b4a-4c5d-9e6f-7a8b9c0d1e2f"),
    ).toBe("0c8f1d2e");
    expect(getShortAppServiceDeploymentId(" release-2026-11-20-a ")).toBe(
      "release-2026",
    );
  });
});

describe("when the page leads with its Setup check", () => {
  const complete: CloudAppSetupInput = setupInput({
    app: {
      cloudPlatform: ManagedCloudPlatform.AwsEcs,
      tracesLastReceivedAt: minutesBefore(1),
      logsLastReceivedAt: minutesBefore(1),
      currentRevision: "2026.11.1",
    },
    isRunning: true,
    hasReportedInstances: true,
  });

  function incomplete(input: CloudAppSetupInput): boolean {
    return isCloudAppSetupIncomplete(getCloudAppSetupRows(input));
  }

  test("not once traces, logs, an instance and a version all arrive - its own metrics are not asked for", () => {
    expect(incomplete(complete)).toBe(false);
  });

  test("while no trace or no log has arrived", () => {
    expect(
      incomplete({
        ...complete,
        app: { ...complete.app, tracesLastReceivedAt: null },
      }),
    ).toBe(true);
    expect(
      incomplete({
        ...complete,
        app: { ...complete.app, logsLastReceivedAt: null },
      }),
    ).toBe(true);
  });

  test("while what came stopped", () => {
    expect(
      incomplete({
        ...complete,
        app: {
          ...complete.app,
          tracesLastReceivedAt: minutesBefore(3 * 24 * 60),
        },
      }),
    ).toBe(true);
  });

  test("while a running app names no instance - but not for an app that is not running", () => {
    expect(incomplete({ ...complete, hasReportedInstances: false })).toBe(true);
    expect(
      incomplete({
        ...complete,
        isRunning: false,
        hasReportedInstances: false,
      }),
    ).toBe(false);
  });

  test("while the app reports no version, a blank one included", () => {
    expect(
      incomplete({
        ...complete,
        app: { ...complete.app, currentRevision: undefined },
      }),
    ).toBe(true);
    expect(
      incomplete({
        ...complete,
        app: { ...complete.app, currentRevision: "   " },
      }),
    ).toBe(true);
  });

  test("an App Service app that sends everything leads with it while Azure Monitor is not set up - and not while it is checked", () => {
    const appService: CloudAppSetupInput = {
      ...complete,
      app: {
        ...complete.app,
        cloudPlatform: ManagedCloudPlatform.AzureAppService,
      },
    };

    expect(incomplete({ ...appService, azureMonitor: CONNECTED })).toBe(false);
    expect(incomplete({ ...appService, azureMonitor: read() })).toBe(true);
    expect(
      incomplete({ ...appService, azureMonitor: { status: "checking" } }),
    ).toBe(false);
    expect(
      incomplete({ ...appService, azureMonitor: { status: "failed" } }),
    ).toBe(false);
    expect(
      incomplete({ ...appService, azureMonitor: read({ slot: "staging" }) }),
    ).toBe(false);
  });
});

describe("the Setup check's rows on every platform", () => {
  test("a kind that came, and stopped, says when it last came", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({ app: { tracesLastReceivedAt: minutesBefore(2 * 24 * 60) } }),
    );

    expect(viewOf(rowOf(rows, CloudAppSetupRowKey.Traces))).toEqual({
      status: CloudAppSetupStatus.NotReceived,
      statusLabel: "Not received",
      tone: "warning",
      text: `The latest came in ${ago(2 * 24 * 60)}.`,
      hint: undefined,
      action: undefined,
    });
  });

  test("traces and logs come with traffic: received for a day; metrics come on a clock: received for the live window", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: {
          tracesLastReceivedAt: minutesBefore(20 * 60),
          metricsLastReceivedAt: minutesBefore(
            CLOUD_INSTANCE_LIVE_WINDOW_MINUTES + 1,
          ),
        },
      }),
    );

    expect(rowOf(rows, CloudAppSetupRowKey.Traces).status).toBe(
      CloudAppSetupStatus.Received,
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Metrics).status).toBe(
      CloudAppSetupStatus.NotReceived,
    );
    expect(CLOUD_APP_TRAFFIC_SIGNAL_RECEIVED_MS).toBe(24 * 60 * 60 * 1000);
  });

  test("with no date to say since when, a missing kind is none yet", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({ app: {} }),
    );

    expect(rowOf(rows, CloudAppSetupRowKey.Traces).text).toBe(
      CLOUD_APP_ROW_NONE_YET,
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Metrics).text).toBe(
      CLOUD_APP_ROW_NONE_YET,
    );
  });

  test("an app that is not running and names no instance is not reporting, and is asked for nothing", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({ isRunning: false, hasReportedInstances: false }),
    );

    expect(viewOf(rowOf(rows, CloudAppSetupRowKey.Instances))).toEqual({
      status: CloudAppSetupStatus.NotAvailable,
      statusLabel: "Not available",
      tone: "off",
      text: CLOUD_APP_ROW_NOT_REPORTING,
      hint: undefined,
      action: undefined,
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

  test("an app with no Azure Monitor to look up has no Azure rows: five rows, each signal its own", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({ app: { cloudPlatform: ManagedCloudPlatform.AwsEcs } }),
    );

    expect(keysOf(rows)).toEqual([
      CloudAppSetupRowKey.Traces,
      CloudAppSetupRowKey.Metrics,
      CloudAppSetupRowKey.Logs,
      CloudAppSetupRowKey.Instances,
      CloudAppSetupRowKey.Revision,
    ]);
    expect(rowOf(rows, CloudAppSetupRowKey.Metrics).label).toBe(
      "OpenTelemetry metrics",
    );
  });

  test("every row is worded in the reader's language", () => {
    const rows: Array<CloudAppSetupRow> = getCloudAppSetupRows(
      setupInput({
        app: {
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          metricsLastReceivedAt: minutesBefore(2),
          signalArrivalsTrackedSince: TRACKED_SINCE,
        },
        azureMonitor: read(),
        translator: GERMAN,
      }),
    );
    const german: Record<string, string> = readDashboardLocale("de");

    expect(rowOf(rows, CloudAppSetupRowKey.Traces).label).toBe(
      german["Traces"],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Traces).statusLabel).toBe(
      german["Needs setup"],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Traces).hint).toBe(
      german[CLOUD_APP_TRACES_HINT],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.Instances).text).toBe(
      german[CLOUD_APP_ROW_NOT_REPORTED],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.AzureMonitor).label).toBe(
      german["Azure Monitor connection"],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.AzureMonitor).hint).toBe(
      german[CLOUD_APP_AZURE_SITE_NAME_HINT],
    );
    expect(rowOf(rows, CloudAppSetupRowKey.AzureMonitor).text).toContain(
      SUBSCRIPTION,
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
    CLOUD_APP_ROW_LATEST,
    CLOUD_APP_ROW_NONE_SINCE,
    CLOUD_APP_ROW_NONE_YET,
    CLOUD_APP_ROW_NONE,
    CLOUD_APP_ROW_REPORTED,
    CLOUD_APP_ROW_NOT_REPORTED,
    CLOUD_APP_ROW_NOT_REPORTING,
    CLOUD_APP_ROW_CHECKING,
    CLOUD_APP_ROW_CONNECTED,
    CLOUD_APP_ROW_NOT_CONNECTED,
    CLOUD_APP_ROW_NOT_CHECKED,
    CLOUD_APP_ROW_WAITING_FOR_FIRST_READ,
    CLOUD_APP_LOGS_LATEST_FROM_APP,
    CLOUD_APP_LOGS_LATEST_FROM_AZURE,
    CLOUD_APP_TRACES_HINT,
    CLOUD_APP_SEND_WITH_OTEL_HINT,
    CLOUD_APP_SERVICE_LOGS_HINT,
    CLOUD_APP_INSTANCES_HINT,
    CLOUD_APP_REVISION_HINT,
    CLOUD_APP_AZURE_MONITOR_HINT,
    CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT,
    CLOUD_APP_AZURE_READ_BY,
    CLOUD_APP_AZURE_SITE_READ,
    CLOUD_APP_AZURE_NO_CONNECTION,
    CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ,
    CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ_HINT,
    CLOUD_APP_AZURE_NO_SUBSCRIPTION,
    CLOUD_APP_AZURE_RESOURCE_ID_HINT,
    CLOUD_APP_AZURE_CONNECTION_OFF,
    CLOUD_APP_AZURE_CONNECTION_FAILING,
    CLOUD_APP_AZURE_FIRST_READ,
    CLOUD_APP_AZURE_FIRST_READ_HINT,
    CLOUD_APP_AZURE_SITE_NOT_FOUND,
    CLOUD_APP_AZURE_NO_SITES,
    CLOUD_APP_AZURE_SITE_NAME_HINT,
    CLOUD_APP_AZURE_SITE_ELSEWHERE,
    CLOUD_APP_AZURE_SITE_ELSEWHERE_HINT,
    CLOUD_APP_AZURE_SLOT,
    CLOUD_APP_AZURE_METRICS_NEXT_READ,
    CLOUD_APP_AZURE_METRICS_NEED_CONNECTION,
    CLOUD_APP_AZURE_METRICS_NOT_READ,
    CLOUD_APP_AZURE_INSTANCES.other,
    CLOUD_APP_AZURE_INSTANCES_HINT,
    CLOUD_APP_AZURE_DEPLOYMENT,
    CLOUD_APP_AZURE_IMAGE,
    CLOUD_APP_OPEN_CONNECTIONS,
    CLOUD_APP_SET_UP_TELEMETRY,
    ...Object.values(CLOUD_APP_SETUP_STATUS_LABELS),
    ...Object.values(CLOUD_APP_SETUP_ACTION_LABELS),
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
        [CLOUD_APP_ROW_LATEST, "{{time}}"],
        [CLOUD_APP_ROW_NONE_SINCE, "{{date}}"],
        [CLOUD_APP_LOGS_LATEST_FROM_APP, "{{time}}"],
        [CLOUD_APP_LOGS_LATEST_FROM_AZURE, "{{time}}"],
        [CLOUD_APP_AZURE_READ_BY, "{{connection}}"],
        [CLOUD_APP_AZURE_READ_BY, "{{site}}"],
        [CLOUD_APP_AZURE_READ_BY, "{{subscription}}"],
        [CLOUD_APP_AZURE_SITE_READ, "{{site}}"],
        [CLOUD_APP_AZURE_SITE_READ, "{{subscription}}"],
        [CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ, "{{subscription}}"],
        [CLOUD_APP_AZURE_NO_SUBSCRIPTION, "{{site}}"],
        [CLOUD_APP_AZURE_CONNECTION_OFF, "{{connection}}"],
        [CLOUD_APP_AZURE_CONNECTION_FAILING, "{{connection}}"],
        [CLOUD_APP_AZURE_FIRST_READ, "{{connection}}"],
        [CLOUD_APP_AZURE_SITE_NOT_FOUND, "{{subscription}}"],
        [CLOUD_APP_AZURE_SITE_NOT_FOUND, "{{site}}"],
        [CLOUD_APP_AZURE_NO_SITES, "{{subscription}}"],
        [CLOUD_APP_AZURE_SITE_ELSEWHERE, "{{site}}"],
        [CLOUD_APP_AZURE_SITE_ELSEWHERE, "{{other}}"],
        [CLOUD_APP_AZURE_SITE_ELSEWHERE, "{{subscription}}"],
        [CLOUD_APP_AZURE_SLOT, "{{slot}}"],
        [CLOUD_APP_AZURE_INSTANCES.other, "{{count}}"],
        [CLOUD_APP_AZURE_DEPLOYMENT, "{{deployment}}"],
        [CLOUD_APP_AZURE_DEPLOYMENT, "{{time}}"],
        [CLOUD_APP_AZURE_IMAGE, "{{image}}"],
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
