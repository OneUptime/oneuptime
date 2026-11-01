import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_APP_ERROR_RATE_DANGER_PERCENT,
  CLOUD_APP_ERROR_RATE_WARNING_PERCENT,
  CLOUD_APP_LIVE_WINDOW_MINUTES,
  CloudAppChangeMarker,
  CloudAppChangeMarkerKind,
  CloudAppErrorRateTone,
  CloudAppRevisionState,
  CloudAppSignalRead,
  CloudAppSignals,
  CloudAppState,
  MAX_SIGNAL_GROUP_BY_KEYS,
  countLiveInstancesByApp,
  countLiveInstancesByRevision,
  getCloudAppAttributeNoun,
  getCloudAppAttributes,
  getCloudAppChangeMarkers,
  getCloudAppDetailAttributeKeys,
  getCloudAppErrorRateTone,
  getCloudAppGroupLabel,
  getCloudAppGroupNoun,
  getCloudAppRevisionNoun,
  getCloudAppRevisionState,
  getCloudAppSignalReads,
  getCloudAppState,
  getCloudAppTelemetryDisplayKeys,
  getCloudAppTelemetryDisplayValues,
  getCloudAppTelemetryFilters,
  getShortRevision,
  isCloudAppGroupAttribute,
  isCloudAppRolledBack,
  isCloudAppScoped,
  matchCloudAppSignals,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudApps";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { getCloudResourceAttributeDisplayKeys } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";

/*
 * What App Platforms' lists and an app's page read off an app (CloudApp):
 * whether it runs, what its platform calls its revision and its group, the
 * filter its telemetry is scoped by, its requests, errors and p95 from one
 * grouped read per environment, its live instances, and the deploys and
 * rollbacks its charts mark.
 */

const NOW: Date = new Date("2026-11-01T10:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const CLUSTER_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:cluster/production";

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

const ECS_ENVIRONMENT: {
  cloudPlatform: string;
  cloudAccountId: string;
  cloudRegion: string;
} = {
  cloudPlatform: "aws_ecs",
  cloudAccountId: "123456789012",
  cloudRegion: "us-east-1",
};

const CHECKOUT: {
  _id: string;
  cloudResourceId: string;
  telemetryAttributes: Record<string, string>;
} = {
  _id: "app-checkout",
  cloudResourceId: "env-1",
  telemetryAttributes: {
    "aws.ecs.task.family": "checkout-api",
    "aws.ecs.cluster.arn": CLUSTER_ARN,
  },
};

describe("whether an app runs", () => {
  test(`it runs while it was seen in the last ${CLOUD_APP_LIVE_WINDOW_MINUTES} minutes`, () => {
    expect(getCloudAppState(minutesAgo(1), NOW)).toBe(CloudAppState.Running);
    expect(getCloudAppState(minutesAgo(15), NOW)).toBe(CloudAppState.Running);
    expect(getCloudAppState(minutesAgo(16), NOW)).toBe(
      CloudAppState.NotReporting,
    );
    expect(getCloudAppState(null, NOW)).toBe(CloudAppState.NotReporting);
    expect(getCloudAppState("not a date", NOW)).toBe(
      CloudAppState.NotReporting,
    );
    expect(getCloudAppState(minutesAgo(2).toISOString(), NOW)).toBe(
      CloudAppState.Running,
    );
  });
});

describe("what each platform calls things", () => {
  test("what keeps two apps of one name apart", () => {
    expect(getCloudAppGroupNoun("aws_ecs")).toBe("Cluster");
    expect(getCloudAppGroupNoun("aws_elastic_beanstalk")).toBe("Environment");
    expect(getCloudAppGroupNoun("azure_app_service")).toBe("Slot");
    expect(getCloudAppGroupNoun("gcp_cloud_run")).toBeNull();
    expect(getCloudAppGroupNoun(null)).toBeNull();
  });

  test("the revision an app runs", () => {
    expect(getCloudAppRevisionNoun("aws_ecs")).toBe("Task definition revision");
    expect(getCloudAppRevisionNoun("gcp_app_engine")).toBe("Version");
    expect(getCloudAppRevisionNoun("aws_elastic_beanstalk")).toBe("Version");
    expect(getCloudAppRevisionNoun("gcp_cloud_run")).toBe("Revision");
    expect(getCloudAppRevisionNoun(undefined)).toBe("Revision");
  });

  test("a revision named after its service is shown without the service's name", () => {
    expect(
      getShortRevision({ revision: "api-00042-xyz", appName: "api" }),
    ).toBe("00042-xyz");
    expect(
      getShortRevision({ revision: "orders--abc123", appName: "orders" }),
    ).toBe("abc123");
    expect(getShortRevision({ revision: "43", appName: "checkout" })).toBe(
      "43",
    );
    // Nothing would be left: shown whole.
    expect(getShortRevision({ revision: "api-", appName: "api" })).toBe("api-");
    expect(getShortRevision({ revision: null, appName: "api" })).toBe("");
    expect(getShortRevision({ revision: " 7 ", appName: null })).toBe("7");
  });
});

// The reader's words for the nouns a line puts before a group's name.
const ENGLISH: Translator = createTranslator(undefined, "en");
const GERMAN: Translator = createTranslator((key: string): string => {
  return (
    { Cluster: "Cluster", Slot: "Bereitstellungsslot" } as Record<
      string,
      string
    >
  )[key] as string;
}, "de");

describe("an app's place and its attributes, as a line and its Details name them", () => {
  test("what keeps two apps of one name apart is a group attribute; the rest name the app", () => {
    expect(isCloudAppGroupAttribute("aws.ecs.cluster.arn")).toBe(true);
    expect(isCloudAppGroupAttribute("deployment.environment.name")).toBe(true);
    expect(isCloudAppGroupAttribute("deployment.environment")).toBe(true);
    expect(isCloudAppGroupAttribute("aws.ecs.task.family")).toBe(false);
    expect(isCloudAppGroupAttribute("faas.name")).toBe(false);
    expect(isCloudAppGroupAttribute("service.name")).toBe(false);
  });

  test("each attribute is named as the app's telemetry chips name it", () => {
    expect(
      getCloudAppAttributeNoun({
        key: "aws.ecs.task.family",
        cloudPlatform: "aws_ecs",
      }),
    ).toBe("App");
    expect(
      getCloudAppAttributeNoun({
        key: "aws.ecs.cluster.arn",
        cloudPlatform: "aws_ecs",
      }),
    ).toBe("Cluster");
    expect(
      getCloudAppAttributeNoun({
        key: "deployment.environment.name",
        cloudPlatform: "azure_app_service",
      }),
    ).toBe("Slot");
    expect(
      getCloudAppAttributeNoun({
        key: "deployment.environment.name",
        cloudPlatform: "aws_elastic_beanstalk",
      }),
    ).toBe("Environment");
    // A platform that keeps no two apps apart has no noun of its own.
    expect(
      getCloudAppAttributeNoun({
        key: "deployment.environment",
        cloudPlatform: "gcp_cloud_run",
      }),
    ).toBe("Group");
  });

  test("Details lists the attributes that name the app before the one that keeps it apart", () => {
    expect(
      getCloudAppDetailAttributeKeys({
        telemetryAttributes: {
          "aws.ecs.cluster.arn": CLUSTER_ARN,
          "aws.ecs.task.family": "checkout",
        },
      }),
    ).toEqual(["aws.ecs.task.family", "aws.ecs.cluster.arn"]);
    expect(
      getCloudAppDetailAttributeKeys({
        telemetryAttributes: {
          "service.name": "web",
          "deployment.environment.name": "staging",
        },
      }),
    ).toEqual(["service.name", "deployment.environment.name"]);
    // Empty or unset values are not attributes.
    expect(
      getCloudAppDetailAttributeKeys({
        telemetryAttributes: { "faas.name": "api", "service.name": "  " },
      }),
    ).toEqual(["faas.name"]);
    expect(getCloudAppDetailAttributeKeys(null)).toEqual([]);
  });

  test("the group reads 'cluster production', its noun cased as each language cases it, and is empty where there is none", () => {
    expect(
      getCloudAppGroupLabel({
        groupName: "production",
        cloudPlatform: "aws_ecs",
        translator: ENGLISH,
      }),
    ).toBe("cluster production");
    // A German noun keeps its capital in the middle of a line.
    expect(
      getCloudAppGroupLabel({
        groupName: "production",
        cloudPlatform: "aws_ecs",
        translator: GERMAN,
      }),
    ).toBe("Cluster production");
    expect(
      getCloudAppGroupLabel({
        groupName: " blue ",
        cloudPlatform: "azure_app_service",
        translator: GERMAN,
      }),
    ).toBe("Bereitstellungsslot blue");
    expect(
      getCloudAppGroupLabel({
        groupName: "blue",
        cloudPlatform: "azure_app_service",
        translator: ENGLISH,
      }),
    ).toBe("slot blue");
    // No group, or a platform whose app names are unique: nothing to say.
    expect(
      getCloudAppGroupLabel({
        groupName: "",
        cloudPlatform: "aws_ecs",
        translator: ENGLISH,
      }),
    ).toBe("");
    expect(
      getCloudAppGroupLabel({
        groupName: "production",
        cloudPlatform: "gcp_cloud_run",
        translator: ENGLISH,
      }),
    ).toBe("");
  });
});

describe("the telemetry scope of an app", () => {
  test("is its environment's cloud attributes and its own, under resource.", () => {
    expect(
      getCloudAppTelemetryFilters({
        environment: ECS_ENVIRONMENT,
        app: CHECKOUT,
      }),
    ).toEqual({
      "resource.cloud.platform": "aws_ecs",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
      "resource.aws.ecs.cluster.arn": CLUSTER_ARN,
      "resource.aws.ecs.task.family": "checkout-api",
    });
  });

  test("an app with no attribute it can be told apart by is not scoped", () => {
    expect(isCloudAppScoped(CHECKOUT)).toBe(true);
    expect(isCloudAppScoped({ telemetryAttributes: {} })).toBe(false);
    expect(isCloudAppScoped({ telemetryAttributes: null })).toBe(false);
    expect(isCloudAppScoped(null)).toBe(false);
    // Blank keys and values, and values that are not text, are no attribute.
    expect(
      getCloudAppAttributes({
        telemetryAttributes: { " ": "x", "service.name": "  ", n: 4 },
      }),
    ).toEqual({});
  });

  test("its chips read App and what its platform calls its group, never a raw key", () => {
    const filters: Record<string, string> = getCloudAppTelemetryFilters({
      environment: ECS_ENVIRONMENT,
      app: CHECKOUT,
    });

    expect(
      getCloudAppTelemetryDisplayKeys({
        filters,
        environmentDisplayKeys:
          getCloudResourceAttributeDisplayKeys(ECS_ENVIRONMENT),
        cloudPlatform: "aws_ecs",
      }),
    ).toEqual(
      expect.objectContaining({
        "resource.aws.ecs.task.family": "App",
        "resource.aws.ecs.cluster.arn": "Cluster",
      }),
    );
    expect(
      getCloudAppTelemetryDisplayKeys({
        filters: {
          "resource.service.name": "web",
          "resource.deployment.environment.name": "blue",
        },
        environmentDisplayKeys: {},
        cloudPlatform: "gcp_cloud_run",
      }),
    ).toEqual({
      "resource.service.name": "App",
      "resource.deployment.environment.name": "Group",
    });
  });

  test("an ECS cluster's chip shows its name, not its ARN", () => {
    expect(
      getCloudAppTelemetryDisplayValues(
        getCloudAppTelemetryFilters({
          environment: ECS_ENVIRONMENT,
          app: CHECKOUT,
        }),
      ),
    ).toEqual({ "resource.aws.ecs.cluster.arn": "production" });
    expect(
      getCloudAppTelemetryDisplayValues({ "resource.service.name": "web" }),
    ).toEqual({});
  });
});

describe("one grouped read per environment for a list's signals", () => {
  const API: {
    _id: string;
    cloudResourceId: string;
    telemetryAttributes: Record<string, string>;
  } = {
    _id: "app-api",
    cloudResourceId: "env-2",
    telemetryAttributes: { "faas.name": "api" },
  };
  const WORKER: {
    _id: string;
    cloudResourceId: string;
    telemetryAttributes: Record<string, string>;
  } = {
    _id: "app-worker",
    cloudResourceId: "env-2",
    telemetryAttributes: { "faas.name": "worker" },
  };

  test("apps of one environment named by the same attributes are read together", () => {
    const reads: Array<CloudAppSignalRead> = getCloudAppSignalReads([
      CHECKOUT,
      API,
      WORKER,
      // No attributes: nothing to group by, so not read.
      { _id: "app-x", cloudResourceId: "env-2", telemetryAttributes: {} },
      // No id or no environment: cannot be matched back.
      { cloudResourceId: "env-2", telemetryAttributes: { "faas.name": "y" } },
      { _id: "app-z", telemetryAttributes: { "faas.name": "z" } },
    ]);

    expect(reads).toEqual([
      {
        environmentId: "env-1",
        groupBy: [
          "resource.aws.ecs.cluster.arn",
          "resource.aws.ecs.task.family",
        ],
        appIds: ["app-checkout"],
      },
      {
        environmentId: "env-2",
        groupBy: ["resource.faas.name"],
        appIds: ["app-api", "app-worker"],
      },
    ]);
  });

  test(`an app named by more than ${MAX_SIGNAL_GROUP_BY_KEYS} attributes cannot be grouped, so is not read`, () => {
    expect(
      getCloudAppSignalReads([
        {
          _id: "app-wide",
          cloudResourceId: "env-1",
          telemetryAttributes: { a: "1", b: "2", c: "3" },
        },
      ]),
    ).toEqual([]);
  });

  test("each app takes the row of its own attribute values; one with no row sent nothing", () => {
    const signals: Map<string, CloudAppSignals> = matchCloudAppSignals({
      apps: [
        API,
        WORKER,
        {
          ...API,
          _id: "app-quiet",
          telemetryAttributes: { "faas.name": "quiet" },
        },
      ],
      rows: [
        {
          groupValues: { "resource.faas.name": "api" },
          count: 200,
          errorCount: 5,
          p95DurationMs: 182.5,
        },
        {
          groupValues: { "resource.faas.name": "worker" },
          count: "40",
          errorCount: "0",
          p95DurationMs: "1200",
        },
      ],
    });

    expect(signals.get("app-api")).toEqual({
      requests: 200,
      errors: 5,
      errorRatePercent: 2.5,
      p95Ms: 182.5,
    });
    expect(signals.get("app-worker")).toEqual({
      requests: 40,
      errors: 0,
      errorRatePercent: 0,
      p95Ms: 1200,
    });
    // Zero requests: its error rate and p95 are unknown, not zero.
    expect(signals.get("app-quiet")).toEqual({
      requests: 0,
      errors: 0,
      errorRatePercent: null,
      p95Ms: null,
    });
  });

  test("an app named by two attributes matches whatever order the row's values come in", () => {
    const signals: Map<string, CloudAppSignals> = matchCloudAppSignals({
      apps: [CHECKOUT],
      rows: [
        {
          groupValues: {
            "resource.aws.ecs.task.family": "checkout-api",
            "resource.aws.ecs.cluster.arn": CLUSTER_ARN,
          },
          count: 10,
          errorCount: 1,
          p95DurationMs: 90,
        },
        // Another cluster's checkout-api is another app.
        {
          groupValues: {
            "resource.aws.ecs.cluster.arn":
              "arn:aws:ecs:us-east-1:123456789012:cluster/staging",
            "resource.aws.ecs.task.family": "checkout-api",
          },
          count: 99,
        },
      ],
    });

    expect(signals.get("app-checkout")).toEqual({
      requests: 10,
      errors: 1,
      errorRatePercent: 10,
      p95Ms: 90,
    });
  });

  test("a row's numbers that are not numbers read as zero", () => {
    const signals: Map<string, CloudAppSignals> = matchCloudAppSignals({
      apps: [API],
      rows: [
        {
          groupValues: { "resource.faas.name": "api" },
          count: "lots",
          errorCount: null,
        },
      ],
    });

    expect(signals.get("app-api")).toEqual({
      requests: 0,
      errors: 0,
      errorRatePercent: null,
      p95Ms: null,
    });
  });
});

describe("an error rate's tone", () => {
  test(`amber from ${CLOUD_APP_ERROR_RATE_WARNING_PERCENT}%, red from ${CLOUD_APP_ERROR_RATE_DANGER_PERCENT}%, as the environment's tile`, () => {
    expect(getCloudAppErrorRateTone(null)).toBe(CloudAppErrorRateTone.Unknown);
    expect(getCloudAppErrorRateTone(Number.NaN)).toBe(
      CloudAppErrorRateTone.Unknown,
    );
    expect(getCloudAppErrorRateTone(0)).toBe(CloudAppErrorRateTone.Healthy);
    expect(getCloudAppErrorRateTone(0.99)).toBe(CloudAppErrorRateTone.Healthy);
    expect(getCloudAppErrorRateTone(1)).toBe(CloudAppErrorRateTone.Warning);
    expect(getCloudAppErrorRateTone(4.99)).toBe(CloudAppErrorRateTone.Warning);
    expect(getCloudAppErrorRateTone(5)).toBe(CloudAppErrorRateTone.Danger);
  });
});

describe("live instances", () => {
  const INSTANCES: Array<{
    cloudAppId: string;
    revision: string;
    lastSeenAt: Date;
  }> = [
    { cloudAppId: "app-a", revision: "43", lastSeenAt: minutesAgo(1) },
    { cloudAppId: "app-a", revision: "43", lastSeenAt: minutesAgo(3) },
    { cloudAppId: "app-a", revision: "42", lastSeenAt: minutesAgo(4) },
    // Stale: not counted.
    { cloudAppId: "app-a", revision: "41", lastSeenAt: minutesAgo(40) },
    { cloudAppId: "app-b", revision: "7", lastSeenAt: minutesAgo(2) },
  ];

  test("are counted per app, and per revision, only while live", () => {
    expect(countLiveInstancesByApp(INSTANCES, NOW)).toEqual(
      new Map([
        ["app-a", 3],
        ["app-b", 1],
      ]),
    );
    expect(
      countLiveInstancesByRevision(
        INSTANCES.filter((instance: { cloudAppId: string }): boolean => {
          return instance.cloudAppId === "app-a";
        }),
        NOW,
      ),
    ).toEqual(
      new Map([
        ["43", 2],
        ["42", 1],
      ]),
    );
    // An instance without an app or a revision names none.
    expect(
      countLiveInstancesByApp([{ lastSeenAt: minutesAgo(1) }], NOW).size,
    ).toBe(0);
    expect(
      countLiveInstancesByRevision([{ lastSeenAt: minutesAgo(1) }], NOW).size,
    ).toBe(0);
  });

  test("a revision is the app's current one, still running on some instances, or retired", () => {
    expect(
      getCloudAppRevisionState({
        revision: "43",
        currentRevision: "43",
        liveInstances: 0,
      }),
    ).toBe(CloudAppRevisionState.Current);
    expect(
      getCloudAppRevisionState({
        revision: "42",
        currentRevision: "43",
        liveInstances: 1,
      }),
    ).toBe(CloudAppRevisionState.Running);
    expect(
      getCloudAppRevisionState({
        revision: "41",
        currentRevision: "43",
        liveInstances: 0,
      }),
    ).toBe(CloudAppRevisionState.Retired);
  });
});

describe("the deploys and rollbacks an app's charts mark", () => {
  const START: Date = minutesAgo(60);
  const END: Date = NOW;

  test("each revision that replaced another is a deploy at when it was first seen; the first one seen is not", () => {
    const markers: Array<CloudAppChangeMarker> = getCloudAppChangeMarkers({
      revisions: [
        { revision: "43", previousRevision: "42", firstSeenAt: minutesAgo(25) },
        { revision: "42", previousRevision: "41", firstSeenAt: minutesAgo(50) },
        // Before the window.
        { revision: "41", previousRevision: "40", firstSeenAt: minutesAgo(90) },
        // The baseline: no revision before it.
        { revision: "40", previousRevision: null, firstSeenAt: minutesAgo(55) },
      ],
      currentRevision: "43",
      currentRevisionSince: minutesAgo(25),
      previousRevision: "42",
      start: START,
      end: END,
    });

    expect(markers).toEqual([
      {
        kind: CloudAppChangeMarkerKind.Deployed,
        time: minutesAgo(50),
        revision: "42",
        previousRevision: "41",
      },
      {
        kind: CloudAppChangeMarkerKind.Deployed,
        time: minutesAgo(25),
        revision: "43",
        previousRevision: "42",
      },
    ]);
  });

  test("going back to an older revision is a rollback at when it became current again", () => {
    const markers: Array<CloudAppChangeMarker> = getCloudAppChangeMarkers({
      revisions: [
        { revision: "43", previousRevision: "42", firstSeenAt: minutesAgo(40) },
        {
          revision: "42",
          previousRevision: "41",
          firstSeenAt: minutesAgo(600),
        },
      ],
      currentRevision: "42",
      currentRevisionSince: minutesAgo(10),
      previousRevision: "43",
      start: START,
      end: END,
    });

    expect(markers).toEqual([
      {
        kind: CloudAppChangeMarkerKind.Deployed,
        time: minutesAgo(40),
        revision: "43",
        previousRevision: "42",
      },
      {
        kind: CloudAppChangeMarkerKind.RolledBack,
        time: minutesAgo(10),
        revision: "42",
        previousRevision: "43",
      },
    ]);
  });

  test("taking a newer revision back again is a deploy, and a deploy's own first sighting is not a second change", () => {
    const rollForward: Array<CloudAppChangeMarker> = getCloudAppChangeMarkers({
      revisions: [
        {
          revision: "43",
          previousRevision: "42",
          firstSeenAt: minutesAgo(300),
        },
        {
          revision: "42",
          previousRevision: null,
          firstSeenAt: minutesAgo(600),
        },
      ],
      currentRevision: "43",
      currentRevisionSince: minutesAgo(5),
      previousRevision: "42",
      start: START,
      end: END,
    });

    expect(rollForward).toEqual([
      {
        kind: CloudAppChangeMarkerKind.Deployed,
        time: minutesAgo(5),
        revision: "43",
        previousRevision: "42",
      },
    ]);

    // currentRevisionSince within a minute of the deploy itself: one marker.
    expect(
      getCloudAppChangeMarkers({
        revisions: [
          {
            revision: "43",
            previousRevision: "42",
            firstSeenAt: minutesAgo(20),
          },
        ],
        currentRevision: "43",
        currentRevisionSince: new Date(minutesAgo(20).getTime() + 30 * 1000),
        previousRevision: "42",
        start: START,
        end: END,
      }),
    ).toHaveLength(1);
  });

  /*
   * The header and the Revisions row of the revision an app went back to
   * say "Rolled back 40 minutes ago", not "Deployed": over all time, not a
   * chart's window - the rollback may be a week old.
   */
  test("whether the revision an app runs is one it went back to, over all time", () => {
    const history: Array<{
      revision: string;
      previousRevision: string | null;
      firstSeenAt: Date;
    }> = [
      { revision: "43", previousRevision: "42", firstSeenAt: minutesAgo(40) },
      { revision: "42", previousRevision: "41", firstSeenAt: minutesAgo(600) },
      { revision: "41", previousRevision: null, firstSeenAt: minutesAgo(900) },
    ];

    // Back on 42 after 43 stopped: a rollback, however long ago.
    expect(
      isCloudAppRolledBack({
        revisions: history,
        currentRevision: "42",
        currentRevisionSince: minutesAgo(10),
        previousRevision: "43",
      }),
    ).toBe(true);
    // A week-old rollback is still the way the app came to run 42.
    const DAY: number = 24 * 60;
    expect(
      isCloudAppRolledBack({
        revisions: [
          {
            revision: "43",
            previousRevision: "42",
            firstSeenAt: minutesAgo(8 * DAY),
          },
          {
            revision: "42",
            previousRevision: null,
            firstSeenAt: minutesAgo(10 * DAY),
          },
        ],
        currentRevision: "42",
        currentRevisionSince: minutesAgo(7 * DAY),
        previousRevision: "43",
      }),
    ).toBe(true);

    // 43 deployed and still running: a deploy.
    expect(
      isCloudAppRolledBack({
        revisions: history,
        currentRevision: "43",
        currentRevisionSince: minutesAgo(40),
        previousRevision: "42",
      }),
    ).toBe(false);

    // Taking the newer 43 back again is a roll forward, not a rollback.
    expect(
      isCloudAppRolledBack({
        revisions: history,
        currentRevision: "43",
        currentRevisionSince: minutesAgo(5),
        previousRevision: "42",
      }),
    ).toBe(false);

    // The first revision seen, no revision, or revisions not read: no.
    expect(
      isCloudAppRolledBack({
        revisions: [history[2]!],
        currentRevision: "41",
        currentRevisionSince: minutesAgo(900),
      }),
    ).toBe(false);
    expect(
      isCloudAppRolledBack({
        revisions: history,
        currentRevision: null,
        currentRevisionSince: minutesAgo(10),
        previousRevision: "43",
      }),
    ).toBe(false);
    expect(
      isCloudAppRolledBack({
        revisions: [],
        currentRevision: "42",
        currentRevisionSince: minutesAgo(10),
        previousRevision: "43",
      }),
    ).toBe(false);
  });

  test("a change outside the window is not marked", () => {
    expect(
      getCloudAppChangeMarkers({
        revisions: [
          {
            revision: "42",
            previousRevision: "41",
            firstSeenAt: minutesAgo(600),
          },
          {
            revision: "41",
            previousRevision: null,
            firstSeenAt: minutesAgo(900),
          },
        ],
        currentRevision: "41",
        currentRevisionSince: minutesAgo(120),
        previousRevision: "42",
        start: START,
        end: END,
      }),
    ).toEqual([]);
  });
});
