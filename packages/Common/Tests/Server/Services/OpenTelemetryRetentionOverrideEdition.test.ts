import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Server/Services/OpenTelemetryIngestService";
import HostService from "../../../Server/Services/HostService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import ProjectService from "../../../Server/Services/ProjectService";
import ServiceService from "../../../Server/Services/ServiceService";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import Service from "../../../Models/DatabaseModels/Service";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TelemetryRetentionConfig, {
  resolveTelemetryRetentionInDays,
} from "../../../Types/Telemetry/TelemetryRetentionConfig";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";

/*
 * Retention overrides are an Enterprise feature
 * (EnterpriseFeature.TelemetryRetention). Ingest applies them only while the
 * feature is active; otherwise every row gets the project's default
 * retention, and the configured overrides are kept, unused.
 *
 * Every signal (logs, traces, metrics, profiles, security events, change
 * events, syslog, fluent) resolves a row's retention from the
 * TelemetryServiceMetadata built here, with resolveTelemetryRetentionInDays,
 * so this is the one place the edition is decided. Pinned here:
 *
 *   - applyRetentionOverrideEdition, in every billing / edition / license
 *     state: overrides kept exactly while the feature is active;
 *   - a license that leaves retention overrides out drops them, one that
 *     names only them keeps them;
 *   - the real metadata builders, for a Service (per-service retention and
 *     retention by type, plus the project's retention by type) and for a
 *     resource (Host, Kubernetes cluster): on the Community Edition the row
 *     gets the project's default whatever is configured;
 *   - a license change takes effect on the next row, with every cache warm.
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Telemetry/EntityRegistry", () => {
  return {
    __esModule: true,
    reconcileEntityRegistryThrottled: jest.fn(),
  };
});

const PROJECT_DEFAULT_DAYS: number = 15;

const PROJECT_CONFIG: TelemetryRetentionConfig = {
  logs: { default: 20 },
  traces: { default: 21, byStatus: { [SpanStatus.Error]: 120 } },
};

const OVERRIDE_CONFIG: TelemetryRetentionConfig = {
  logs: { default: 45, bySeverity: { [LogSeverity.Error]: 90 } },
  metrics: { default: 60 },
};

const OVERRIDE_DAYS: number = 30;

const metadataWithOverrides: () => TelemetryServiceMetadata =
  (): TelemetryServiceMetadata => {
    return {
      serviceName: "checkout",
      primaryEntityId: ObjectID.generate(),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: OVERRIDE_DAYS,
      serviceRetentionConfig: OVERRIDE_CONFIG,
      serviceRetentionInDays: OVERRIDE_DAYS,
      projectRetentionConfig: PROJECT_CONFIG,
      projectRetentionInDays: PROJECT_DEFAULT_DAYS,
    };
  };

// What a row of each kind would be stamped with.
const retentionOf: (
  metadata: TelemetryServiceMetadata,
) => Record<string, number> = (
  metadata: TelemetryServiceMetadata,
): Record<string, number> => {
  const common: {
    serviceConfig: TelemetryRetentionConfig | null;
    serviceRetentionInDays: number | null;
    projectConfig: TelemetryRetentionConfig | null;
    projectRetentionInDays: number;
  } = {
    serviceConfig: metadata.serviceRetentionConfig,
    serviceRetentionInDays: metadata.serviceRetentionInDays,
    projectConfig: metadata.projectRetentionConfig,
    projectRetentionInDays: metadata.projectRetentionInDays,
  };

  return {
    errorLog: resolveTelemetryRetentionInDays({
      pillar: "logs",
      bucketKey: LogSeverity.Error,
      ...common,
    }),
    infoLog: resolveTelemetryRetentionInDays({
      pillar: "logs",
      bucketKey: LogSeverity.Information,
      ...common,
    }),
    failedSpan: resolveTelemetryRetentionInDays({
      pillar: "traces",
      bucketKey: SpanStatus.Error,
      ...common,
    }),
    metric: resolveTelemetryRetentionInDays({ pillar: "metrics", ...common }),
    profile: resolveTelemetryRetentionInDays({
      pillar: "profiles",
      ...common,
    }),
    securityEvent: resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      ...common,
    }),
    dataRententionInDays: metadata.dataRententionInDays,
  };
};

const EVERYTHING_AT_PROJECT_DEFAULT: Record<string, number> = {
  errorLog: PROJECT_DEFAULT_DAYS,
  infoLog: PROJECT_DEFAULT_DAYS,
  failedSpan: PROJECT_DEFAULT_DAYS,
  metric: PROJECT_DEFAULT_DAYS,
  profile: PROJECT_DEFAULT_DAYS,
  securityEvent: PROJECT_DEFAULT_DAYS,
  dataRententionInDays: PROJECT_DEFAULT_DAYS,
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();

  // Every cache misses unless a test says otherwise; nothing reaches Redis.
  jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    defaultTelemetryRetentionInDays: PROJECT_DEFAULT_DAYS,
    telemetryRetentionConfig: PROJECT_CONFIG,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("applyRetentionOverrideEdition", () => {
  test.each(
    createEditionStateCases().map((state: EditionStateCase) => {
      return [state.label, state] as [string, EditionStateCase];
    }),
  )("%s", (_label: string, state: EditionStateCase) => {
    state.apply();

    const metadata: TelemetryServiceMetadata = metadataWithOverrides();
    const applied: TelemetryServiceMetadata =
      OTelIngestService.applyRetentionOverrideEdition(metadata);

    if (state.isActive) {
      // The same object: nothing is copied on the hot path.
      expect(applied).toBe(metadata);
      return;
    }

    expect(applied).toEqual({
      ...metadata,
      dataRententionInDays: PROJECT_DEFAULT_DAYS,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
    });
    // The input is not mutated: a cached metadata object stays intact.
    expect(metadata.serviceRetentionConfig).toBe(OVERRIDE_CONFIG);
    expect(retentionOf(applied)).toEqual(EVERYTHING_AT_PROJECT_DEFAULT);
  });

  test("keeps the service identity and entity keys when it drops the overrides", () => {
    const metadata: TelemetryServiceMetadata = {
      ...metadataWithOverrides(),
      entityKeys: ["service:abc"],
    };
    const applied: TelemetryServiceMetadata =
      OTelIngestService.applyRetentionOverrideEdition(metadata);

    expect(applied.serviceName).toBe(metadata.serviceName);
    expect(applied.primaryEntityId).toBe(metadata.primaryEntityId);
    expect(applied.primaryEntityType).toBe(metadata.primaryEntityType);
    expect(applied.entityKeys).toEqual(["service:abc"]);
  });

  test("a license that leaves retention overrides out drops them", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [
          EnterpriseFeature.SCIM,
          EnterpriseFeature.AuditLogs,
          EnterpriseFeature.TeamCompliance,
          EnterpriseFeature.InstanceHealth,
        ],
      }),
    });

    expect(
      retentionOf(
        OTelIngestService.applyRetentionOverrideEdition(
          metadataWithOverrides(),
        ),
      ),
    ).toEqual(EVERYTHING_AT_PROJECT_DEFAULT);
  });

  test("a license that names only retention overrides keeps them", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [EnterpriseFeature.TelemetryRetention],
      }),
    });

    expect(
      retentionOf(
        OTelIngestService.applyRetentionOverrideEdition(
          metadataWithOverrides(),
        ),
      ),
    ).toEqual({
      errorLog: 90,
      infoLog: 45,
      failedSpan: OVERRIDE_DAYS,
      metric: 60,
      profile: OVERRIDE_DAYS,
      securityEvent: OVERRIDE_DAYS,
      dataRententionInDays: OVERRIDE_DAYS,
    });
  });
});

describe("a Service's telemetry", () => {
  const serviceWithOverrides: () => Service = (): Service => {
    const service: Service = new Service();
    service._id = ObjectID.generate().toString();
    service.retainTelemetryDataForDays = OVERRIDE_DAYS;
    service.telemetryRetentionConfig = OVERRIDE_CONFIG;
    return service;
  };

  beforeEach(() => {
    jest
      .spyOn(ServiceService, "updateLastSeen")
      .mockResolvedValue(undefined as never);
  });

  const build: () => Promise<TelemetryServiceMetadata> =
    async (): Promise<TelemetryServiceMetadata> => {
      // Fresh names and projects keep the module-level caches cold.
      return OTelIngestService.telemetryServiceFromName({
        serviceName: `svc-${ObjectID.generate().toString()}`,
        projectId: ObjectID.generate(),
      });
    };

  test("Community Edition: the project's default retention for every row, whatever is configured", async () => {
    jest
      .spyOn(ServiceService, "findOneBy")
      .mockResolvedValue(serviceWithOverrides());

    expect(retentionOf(await build())).toEqual(EVERYTHING_AT_PROJECT_DEFAULT);
  });

  test("licensed Enterprise Edition: the service's overrides, then the project's retention by type", async () => {
    installFakeEnterpriseModule();
    jest
      .spyOn(ServiceService, "findOneBy")
      .mockResolvedValue(serviceWithOverrides());

    expect(retentionOf(await build())).toEqual({
      errorLog: 90,
      infoLog: 45,
      failedSpan: OVERRIDE_DAYS,
      metric: 60,
      profile: OVERRIDE_DAYS,
      securityEvent: OVERRIDE_DAYS,
      dataRententionInDays: OVERRIDE_DAYS,
    });
  });

  test("licensed Enterprise Edition, a service with no overrides: the project's retention by type applies", async () => {
    installFakeEnterpriseModule();
    const plain: Service = new Service();
    plain._id = ObjectID.generate().toString();
    jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(plain);

    expect(retentionOf(await build())).toEqual({
      errorLog: 20,
      infoLog: 20,
      failedSpan: 120,
      metric: PROJECT_DEFAULT_DAYS,
      profile: PROJECT_DEFAULT_DAYS,
      securityEvent: PROJECT_DEFAULT_DAYS,
      dataRententionInDays: PROJECT_DEFAULT_DAYS,
    });
  });

  test("Community Edition: the project's retention by type is dropped too", async () => {
    const plain: Service = new Service();
    plain._id = ObjectID.generate().toString();
    jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(plain);

    expect(retentionOf(await build())).toEqual(EVERYTHING_AT_PROJECT_DEFAULT);
  });

  test("a lapsed license drops them, like the Community Edition", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });
    jest
      .spyOn(ServiceService, "findOneBy")
      .mockResolvedValue(serviceWithOverrides());

    expect(retentionOf(await build())).toEqual(EVERYTHING_AT_PROJECT_DEFAULT);
  });

  test("OneUptime Cloud keeps them: the plan gates writes, not ingest", async () => {
    setTestBillingEnabled(true);
    installFakeEnterpriseModule();
    jest
      .spyOn(ServiceService, "findOneBy")
      .mockResolvedValue(serviceWithOverrides());

    expect((await build()).dataRententionInDays).toBe(OVERRIDE_DAYS);
  });
});

describe.each([
  ["Host", ServiceType.Host, HostService],
  [
    "Kubernetes cluster",
    ServiceType.KubernetesCluster,
    KubernetesClusterService,
  ],
])(
  "a %s's telemetry",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_name: string, serviceType: ServiceType, service: any) => {
    let findOneById: jest.SpiedFunction<() => Promise<unknown>>;

    beforeEach(() => {
      findOneById = jest.spyOn(service, "findOneById").mockResolvedValue({
        retainTelemetryDataForDays: OVERRIDE_DAYS,
        telemetryRetentionConfig: OVERRIDE_CONFIG,
      } as never) as unknown as jest.SpiedFunction<() => Promise<unknown>>;
    });

    const build: (
      resourceId: ObjectID,
      projectId: ObjectID,
    ) => Promise<TelemetryServiceMetadata> = (
      resourceId: ObjectID,
      projectId: ObjectID,
    ): Promise<TelemetryServiceMetadata> => {
      return OTelIngestService.buildResourceMetadataForNonService({
        serviceName: "resource-under-test",
        resourceId,
        primaryEntityType: serviceType,
        projectId,
      });
    };

    test("Community Edition: the project's default retention", async () => {
      expect(
        retentionOf(await build(ObjectID.generate(), ObjectID.generate())),
      ).toEqual(EVERYTHING_AT_PROJECT_DEFAULT);
    });

    test("licensed Enterprise Edition: the resource's overrides", async () => {
      installFakeEnterpriseModule();

      const metadata: TelemetryServiceMetadata = await build(
        ObjectID.generate(),
        ObjectID.generate(),
      );

      expect(metadata.dataRententionInDays).toBe(OVERRIDE_DAYS);
      expect(retentionOf(metadata)["errorLog"]).toBe(90);
      expect(retentionOf(metadata)["metric"]).toBe(60);
    });

    test("a license change takes effect on the next row, with every cache warm", async () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
      const resourceId: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();

      expect((await build(resourceId, projectId)).dataRententionInDays).toBe(
        OVERRIDE_DAYS,
      );

      fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));

      expect(retentionOf(await build(resourceId, projectId))).toEqual(
        EVERYTHING_AT_PROJECT_DEFAULT,
      );

      fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

      expect((await build(resourceId, projectId)).dataRententionInDays).toBe(
        OVERRIDE_DAYS,
      );

      /*
       * One Postgres read: the memo served the rest, and the edition was
       * still asked on every row.
       */
      expect(findOneById).toHaveBeenCalledTimes(1);
    });
  },
);
