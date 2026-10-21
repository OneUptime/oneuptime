import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The core shells of the retention overrides.
 *
 * Retention by telemetry type (project-wide and per service or resource) and
 * per-service / per-resource retention are Enterprise code
 * (ee/Dashboard/TelemetryRetention). Every service and telemetry resource
 * Settings page renders them through one core shell
 * (Components/TelemetryResource/TelemetryResourceRetentionSettings), and
 * Settings > Telemetry through the same plugin door, next to the project's
 * default retention, which every edition keeps.
 *
 * Pinned here, on the REAL pages:
 *   - the tier: the Scale plan on the Cloud; the edition when self-hosted;
 *   - on the Community Edition, each page shows the upsell card in place of
 *     the cards and never reads an override column;
 *   - an eligible project on a Community bundle is pointed at the edition,
 *     never told to upgrade its plan;
 *   - the plugin gets each page's own model, record id, resource name and a
 *     DOM id prefix no other page uses, and the database's scope note (which
 *     of its telemetry the retention covers; it used to be a banner above
 *     the cards);
 *   - Settings > Telemetry keeps the project's default retention everywhere;
 *   - on OneUptime Cloud below Scale, a paid feature can always be switched
 *     off: each page reads the record's override columns once, and while
 *     one is set (a Scale trial left it) offers to remove it under the
 *     upsell, writing them back to nothing (RetentionOverrideLeftover).
 *
 * The plugins come from a stand-in for src/Enterprise/Plugins; `null` means
 * "the real module", which in this jest config is the empty Community stub.
 * Billing, edition and plan are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true). Nothing here imports ee/.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;
let currentPlanForTest: string | null = null;
let pluginsForTest: Record<string, unknown> | null = null;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return enterpriseEditionForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins", () => {
  const actual: { getDashboardPlugins: () => Record<string, unknown> } =
    jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins",
    ) as { getDashboardPlugins: () => Record<string, unknown> };

  return {
    __esModule: true,
    getDashboardPlugins: (): Record<string, unknown> => {
      return pluginsForTest === null
        ? actual.getDashboardPlugins()
        : pluginsForTest;
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getList: (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      createOrUpdate: (): Promise<{ data: Record<string, unknown> }> => {
        return Promise.resolve({ data: {} });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner", "Public"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

// Archiving has its own real-page suite; it is deliberately outside scope.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="archive-resource-card" />;
      },
    };
  },
);

import CephSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Settings";
import CloudSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Settings";
import DatabaseServerSettings, {
  DATABASE_RETENTION_SCOPE_NOTE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Settings";
import DockerSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Settings";
import DockerSwarmSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Settings";
import HostSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Settings";
import IoTSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Settings";
import KubernetesSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Settings";
import PodmanSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Settings";
import ProxmoxSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Settings";
import RumSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Settings";
import ServerlessSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Settings";
import ServiceSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Settings";
import TelemetrySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/TelemetrySettings";
import VMwareSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Settings";
import { getTelemetryRetentionUpsell } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/TelemetryResourceRetentionSettings";
import { RETENTION_OVERRIDE_LEFTOVER_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/RetentionOverrideLeftoverCopy";
import { TELEMETRY_RETENTION_REQUIRED_PLAN } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterpriseEligibility";
import { TelemetryResourceRetentionSettingsProps } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePlugins";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Project from "../../../Models/DatabaseModels/Project";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../Models/DatabaseModels/Service";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MODEL_ID: ObjectID = new ObjectID("22222222-0000-4000-8000-000000000001");

interface ResourcePageCase {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  modelType: { new (): BaseModel };
  settingsKey: PageMap;
  resourceName: string;
  detailIdPrefix: string;
  // Which of the resource's telemetry its retention covers, when not all.
  scopeNote?: string | undefined;
}

/*
 * Every Settings page with the two override columns. The resource names and
 * id prefixes are what the pages pass; the prefixes keep the ids the inline
 * cards had before the split ("model-detail-host-telemetry-retention-
 * overrides", ...), so links and tests that find a card by id still do.
 */
const RESOURCE_PAGES: Array<ResourcePageCase> = [
  {
    name: "Service",
    Page: ServiceSettings,
    modelType: Service,
    settingsKey: PageMap.SERVICE_VIEW_SETTINGS,
    resourceName: "service",
    detailIdPrefix: "model-detail-service",
  },
  {
    name: "Host",
    Page: HostSettings,
    modelType: Host,
    settingsKey: PageMap.HOST_VIEW_SETTINGS,
    resourceName: "host",
    detailIdPrefix: "model-detail-host",
  },
  {
    name: "Docker host",
    Page: DockerSettings,
    modelType: DockerHost,
    settingsKey: PageMap.DOCKER_HOST_VIEW_SETTINGS,
    resourceName: "Docker host",
    detailIdPrefix: "model-detail-docker-host",
  },
  {
    name: "Podman host",
    Page: PodmanSettings,
    modelType: PodmanHost,
    settingsKey: PageMap.PODMAN_HOST_VIEW_SETTINGS,
    resourceName: "Podman host",
    detailIdPrefix: "model-detail-podman-host",
  },
  {
    name: "Docker Swarm cluster",
    Page: DockerSwarmSettings,
    modelType: DockerSwarmCluster,
    settingsKey: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SETTINGS,
    resourceName: "Docker Swarm cluster",
    detailIdPrefix: "model-detail-docker-swarm-cluster",
  },
  {
    name: "Kubernetes cluster",
    Page: KubernetesSettings,
    modelType: KubernetesCluster,
    settingsKey: PageMap.KUBERNETES_CLUSTER_VIEW_SETTINGS,
    resourceName: "Kubernetes cluster",
    detailIdPrefix: "model-detail-kubernetes-cluster",
  },
  {
    name: "Proxmox cluster",
    Page: ProxmoxSettings,
    modelType: ProxmoxCluster,
    settingsKey: PageMap.PROXMOX_CLUSTER_VIEW_SETTINGS,
    resourceName: "Proxmox cluster",
    detailIdPrefix: "model-detail-proxmox-cluster",
  },
  {
    name: "vCenter",
    Page: VMwareSettings,
    modelType: VMwareVCenter,
    settingsKey: PageMap.VMWARE_VCENTER_VIEW_SETTINGS,
    resourceName: "vCenter",
    detailIdPrefix: "model-detail-vmware-vcenter",
  },
  {
    name: "Ceph cluster",
    Page: CephSettings,
    modelType: CephCluster,
    settingsKey: PageMap.CEPH_CLUSTER_VIEW_SETTINGS,
    resourceName: "Ceph cluster",
    detailIdPrefix: "model-detail-ceph-cluster",
  },
  {
    name: "IoT fleet",
    Page: IoTSettings,
    modelType: IoTFleet,
    settingsKey: PageMap.IOT_FLEET_VIEW_SETTINGS,
    resourceName: "IoT fleet",
    detailIdPrefix: "model-detail-iot-fleet",
  },
  {
    name: "RUM application",
    Page: RumSettings,
    modelType: RumApplication,
    settingsKey: PageMap.RUM_APPLICATION_VIEW_SETTINGS,
    resourceName: "RUM application",
    detailIdPrefix: "rum-application",
  },
  {
    name: "cloud resource",
    Page: CloudSettings,
    modelType: CloudResource,
    settingsKey: PageMap.CLOUD_RESOURCE_VIEW_SETTINGS,
    resourceName: "cloud resource",
    detailIdPrefix: "cloud-resource",
  },
  {
    name: "serverless function",
    Page: ServerlessSettings,
    modelType: ServerlessFunction,
    settingsKey: PageMap.SERVERLESS_FUNCTION_VIEW_SETTINGS,
    resourceName: "serverless function",
    detailIdPrefix: "serverless-function",
  },
  {
    name: "database",
    Page: DatabaseServerSettings,
    modelType: DatabaseServer,
    settingsKey: PageMap.DATABASE_SERVER_VIEW_SETTINGS,
    resourceName: "database",
    detailIdPrefix: "database-server",
    scopeNote: DATABASE_RETENTION_SCOPE_NOTE,
  },
];

const OVERRIDE_COLUMNS: Array<string> = [
  "retainTelemetryDataForDays",
  "telemetryRetentionConfig",
];

let capturedResourceProps: Array<TelemetryResourceRetentionSettingsProps> = [];
let capturedTelemetryPageProps: Array<PageComponentProps> = [];

const ResourcePluginStub: FunctionComponent<
  TelemetryResourceRetentionSettingsProps
> = (props: TelemetryResourceRetentionSettingsProps): ReactElement => {
  capturedResourceProps.push(props);
  return <div data-testid="resource-retention-plugin" />;
};

const TelemetryPagePluginStub: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  capturedTelemetryPageProps.push(props);
  return <div data-testid="telemetry-retention-by-type-plugin" />;
};

const STUB_PLUGINS: Record<string, unknown> = {
  TelemetryResourceRetentionSettings: ResourcePluginStub,
  SettingsTelemetryRetentionByType: TelemetryPagePluginStub,
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderResourcePage: (
  pageCase: ResourcePageCase,
) => Promise<void> = async (pageCase: ResourcePageCase): Promise<void> => {
  const routePath: string = String(RouteMap[pageCase.settingsKey]);
  const path: string = RouteUtil.populateRouteParams(
    RouteMap[pageCase.settingsKey] as Route,
    { modelId: MODEL_ID },
  ).toString();

  // Pages that read their id from Navigation rather than the router.
  window.history.pushState({}, "", path);
  Navigation.setLocation(window.location as unknown as never);

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={routePath}
          element={
            <pageCase.Page
              pageRoute={RouteMap[pageCase.settingsKey] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  await settle();
};

const TELEMETRY_PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    `/dashboard/${PROJECT_ID.toString()}/settings/telemetry`,
  ),
  currentProject: null,
  hasPaymentMethod: true,
};

const renderTelemetrySettings: () => Promise<void> =
  async (): Promise<void> => {
    render(
      <MemoryRouter>
        <TelemetrySettings {...TELEMETRY_PAGE_PROPS} />
      </MemoryRouter>,
    );

    await settle();
  };

// What the record read holds in its override columns (nothing, by default).
let storedOverrides: Record<string, unknown> = {};

// getItem calls that read a retention override column.
const overrideReads: () => Array<unknown> = (): Array<unknown> => {
  return getItemMock.mock.calls.filter((call: Array<unknown>): boolean => {
    const request: { select?: Record<string, unknown> } = call[0] as {
      select?: Record<string, unknown>;
    };

    return OVERRIDE_COLUMNS.some((column: string): boolean => {
      return request.select?.[column] === true;
    });
  });
};

// The upsell card, pointing at the Enterprise Edition (not at a plan).
const expectEditionUpsell: () => void = (): void => {
  expect(
    screen.getByRole("heading", { name: "Retention Overrides", level: 2 }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText("Learn about Enterprise Edition").length,
  ).toBeGreaterThan(0);
};

const pinCloud: (plan: PlanType) => void = (plan: PlanType): void => {
  billingEnabledForTest = true;
  // The Cloud runs the Enterprise image: its effective edition is true.
  enterpriseEditionForTest = true;
  currentPlanForTest = plan;
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  currentPlanForTest = null;
  pluginsForTest = null;
  capturedResourceProps = [];
  capturedTelemetryPageProps = [];
  getItemMock.mockReset();
  getItemMock.mockImplementation(
    async (request: {
      modelType: { new (): BaseModel };
    }): Promise<BaseModel> => {
      const model: BaseModel = new request.modelType();
      model.id = MODEL_ID;
      Object.assign(model, storedOverrides);
      return model;
    },
  );
  storedOverrides = {};
  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(ProjectUtil, "getCurrentPlan")
    .mockImplementation((): PlanType | null => {
      return currentPlanForTest as PlanType | null;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the retention override tier", () => {
  test("is the Scale plan, like the @ColumnBillingAccessControl on the columns", () => {
    expect(TELEMETRY_RETENTION_REQUIRED_PLAN).toBe(PlanType.Scale);

    for (const modelType of [
      Project,
      ...RESOURCE_PAGES.map((pageCase: ResourcePageCase) => {
        return pageCase.modelType;
      }),
    ]) {
      const model: BaseModel = new modelType();

      for (const column of OVERRIDE_COLUMNS) {
        if (modelType === Project && column === "retainTelemetryDataForDays") {
          continue;
        }

        expect({
          model: model.tableName,
          column,
          billing: model.getColumnBillingAccessControl(column),
        }).toEqual({
          model: model.tableName,
          column,
          billing: {
            read: PlanType.Free,
            create: TELEMETRY_RETENTION_REQUIRED_PLAN,
            update: TELEMETRY_RETENTION_REQUIRED_PLAN,
          },
        });
      }
    }
  });

  test("the project's default retention is not an override: every plan may set it", () => {
    expect(
      new Project().getColumnBillingAccessControl(
        "defaultTelemetryRetentionInDays",
      ),
    ).toBeFalsy();
  });

  test("the upsell names the feature and never offers the default retention", () => {
    const upsell: ReturnType<typeof getTelemetryRetentionUpsell> =
      getTelemetryRetentionUpsell("collected from this host");

    expect(upsell.featureName).toBe("Retention Overrides");
    expect(upsell.description).toBe(
      "Keep telemetry collected from this host for longer or shorter than the project's default retention.",
    );
    expect(upsell.benefits.length).toBeGreaterThan(0);
  });
});

describe.each(RESOURCE_PAGES)(
  "$name Settings",
  (pageCase: ResourcePageCase) => {
    test("on the Community Edition: the upsell card, and no override is read", async () => {
      await renderResourcePage(pageCase);

      expectEditionUpsell();
      expect(
        screen.queryByRole("heading", { name: "Retention by Telemetry Type" }),
      ).not.toBeInTheDocument();
      expect(
        document.getElementById(
          `${pageCase.detailIdPrefix}-telemetry-retention`,
        ),
      ).not.toBeInTheDocument();
      expect(
        document.getElementById(
          `${pageCase.detailIdPrefix}-telemetry-retention-overrides`,
        ),
      ).not.toBeInTheDocument();
      expect(overrideReads()).toEqual([]);
      // The rest of the page is still there.
      expect(screen.getByTestId("archive-resource-card")).toBeInTheDocument();
      // No banner above the retention: a scope note is the cards' to say.
      expect(
        screen.queryByText("Which telemetry this covers."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("database-retention-scope-note"),
      ).not.toBeInTheDocument();
    });

    test("on the Enterprise Edition: the plugin gets this page's model, record, name and id prefix", async () => {
      enterpriseEditionForTest = true;
      pluginsForTest = STUB_PLUGINS;

      await renderResourcePage(pageCase);

      expect(
        screen.getByTestId("resource-retention-plugin"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", {
          name: "Retention Overrides",
          level: 2,
        }),
      ).not.toBeInTheDocument();

      const props: TelemetryResourceRetentionSettingsProps =
        capturedResourceProps[capturedResourceProps.length - 1]!;

      expect(props.modelType).toBe(pageCase.modelType);
      expect(props.modelId.toString()).toBe(MODEL_ID.toString());
      expect(props.resourceName).toBe(pageCase.resourceName);
      expect(props.modelDetailIdPrefix).toBe(pageCase.detailIdPrefix);
      expect(props.scopeNote).toBe(pageCase.scopeNote);
    });

    test("an Enterprise flag on a Community bundle points at the edition, not a plan", async () => {
      enterpriseEditionForTest = true;

      await renderResourcePage(pageCase);

      expectEditionUpsell();
      expect(screen.queryByText("Upgrade to Scale")).not.toBeInTheDocument();
    });

    test("on OneUptime Cloud below Scale: the Scale plan upsell, never the plugin", async () => {
      pinCloud(PlanType.Growth);
      pluginsForTest = STUB_PLUGINS;

      await renderResourcePage(pageCase);

      expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
      expect(
        screen.queryByTestId("resource-retention-plugin"),
      ).not.toBeInTheDocument();

      /*
       * One read, of this record's two override columns only: whether a
       * trial left one to remove. Nothing set, nothing more is drawn.
       */
      expect(overrideReads()).toHaveLength(1);
      expect(overrideReads()[0]).toEqual([
        expect.objectContaining({
          modelType: pageCase.modelType,
          id: MODEL_ID,
          select: {
            retainTelemetryDataForDays: true,
            telemetryRetentionConfig: true,
          },
        }),
      ]);
      expect(
        screen.queryByTestId(RETENTION_OVERRIDE_LEFTOVER_TEST_ID),
      ).not.toBeInTheDocument();
    });

    test("on OneUptime Cloud below Scale: an override a Scale trial left is offered for removal under the upsell, and removing it writes both columns back to nothing", async () => {
      pinCloud(PlanType.Free);
      pluginsForTest = STUB_PLUGINS;
      storedOverrides = { retainTelemetryDataForDays: 90 };

      await renderResourcePage(pageCase);

      expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
      expect(
        screen.getByTestId(RETENTION_OVERRIDE_LEFTOVER_TEST_ID),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Retention Override" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Telemetry from here is kept for its own retention, not the project's. Your plan does not include retention overrides: you can remove this one, but setting one again needs the Scale plan.",
        ),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Remove Override" }),
        );
      });
      await settle();

      await act(async () => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });
      await settle();

      expect(updateByIdMock).toHaveBeenCalledTimes(1);
      expect(updateByIdMock.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          modelType: pageCase.modelType,
          id: MODEL_ID,
          data: {
            retainTelemetryDataForDays: null,
            telemetryRetentionConfig: null,
          },
        }),
      );
    });

    test("on OneUptime Cloud on Scale: no leftover is looked for, the plugin has the cards", async () => {
      pinCloud(PlanType.Scale);
      pluginsForTest = STUB_PLUGINS;
      storedOverrides = { retainTelemetryDataForDays: 90 };

      await renderResourcePage(pageCase);

      expect(
        screen.queryByTestId(RETENTION_OVERRIDE_LEFTOVER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(overrideReads()).toEqual([]);
    });

    test.each([PlanType.Scale, PlanType.Enterprise])(
      "on OneUptime Cloud on %s: the plugin",
      async (plan: PlanType) => {
        pinCloud(plan);
        pluginsForTest = STUB_PLUGINS;

        await renderResourcePage(pageCase);

        expect(
          screen.getByTestId("resource-retention-plugin"),
        ).toBeInTheDocument();
      },
    );
  },
);

describe("the database's scope note", () => {
  test("is one whole note, English in the source, for the card to translate", () => {
    expect(DATABASE_RETENTION_SCOPE_NOTE).toBe(
      "This covers the engine metrics and logs the Database Agent or your OpenTelemetry Collector collects from it. The traces of the queries your applications send it belong to the calling services and follow their retention.",
    );
  });

  test("only the database passes one", () => {
    const withNotes: Array<string> = RESOURCE_PAGES.filter(
      (pageCase: ResourcePageCase): boolean => {
        return Boolean(pageCase.scopeNote);
      },
    ).map((pageCase: ResourcePageCase): string => {
      return pageCase.name;
    });

    expect(withNotes).toEqual(["database"]);
  });
});

describe("the resource pages together", () => {
  test("every page hands the plugin its own DOM id prefix", async () => {
    enterpriseEditionForTest = true;
    pluginsForTest = STUB_PLUGINS;

    for (const pageCase of RESOURCE_PAGES) {
      await renderResourcePage(pageCase);
      cleanup();
    }

    const prefixes: Array<string> = capturedResourceProps.map(
      (props: TelemetryResourceRetentionSettingsProps): string => {
        return props.modelDetailIdPrefix;
      },
    );

    expect(new Set(prefixes).size).toBe(RESOURCE_PAGES.length);
  });
});

describe("Settings > Telemetry", () => {
  test("on the Community Edition: the project's default retention, and the upsell for retention by type", async () => {
    await renderTelemetrySettings();

    expect(
      screen.getByRole("heading", { name: "Telemetry Data Retention" }),
    ).toBeInTheDocument();
    expect(
      document.getElementById("model-detail-project-telemetry-retention"),
    ).toBeInTheDocument();
    expectEditionUpsell();
    expect(
      screen.queryByRole("heading", { name: "Retention by Telemetry Type" }),
    ).not.toBeInTheDocument();

    const selects: Array<Record<string, unknown>> = getItemMock.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { select?: Record<string, unknown> }).select || {};
      },
    );

    expect(
      selects.some((select: Record<string, unknown>): boolean => {
        return select["defaultTelemetryRetentionInDays"] === true;
      }),
    ).toBe(true);
    expect(
      selects.some((select: Record<string, unknown>): boolean => {
        return select["telemetryRetentionConfig"] === true;
      }),
    ).toBe(false);
  });

  test("on the Enterprise Edition: the plugin gets the page's props, below the default retention", async () => {
    enterpriseEditionForTest = true;
    pluginsForTest = STUB_PLUGINS;

    await renderTelemetrySettings();

    expect(
      document.getElementById("model-detail-project-telemetry-retention"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("telemetry-retention-by-type-plugin"),
    ).toBeInTheDocument();
    expect(capturedTelemetryPageProps[0]).toEqual(TELEMETRY_PAGE_PROPS);
  });

  test("on OneUptime Cloud below Scale: the default retention stays, retention by type is upsold", async () => {
    pinCloud(PlanType.Free);
    pluginsForTest = STUB_PLUGINS;

    await renderTelemetrySettings();

    expect(
      document.getElementById("model-detail-project-telemetry-retention"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
    expect(
      screen.queryByTestId("telemetry-retention-by-type-plugin"),
    ).not.toBeInTheDocument();
    // Nothing set: nothing is offered.
    expect(
      screen.queryByTestId(RETENTION_OVERRIDE_LEFTOVER_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("on OneUptime Cloud below Scale: retention by type a Scale trial left is offered for removal, which writes it back to nothing", async () => {
    pinCloud(PlanType.Growth);
    pluginsForTest = STUB_PLUGINS;
    storedOverrides = { telemetryRetentionConfig: { logs: { default: 90 } } };

    await renderTelemetrySettings();

    expect(
      screen.getByTestId(RETENTION_OVERRIDE_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Some types of telemetry are kept for their own retention, not the project's default. Your plan does not include retention by telemetry type: you can remove it, but setting it again needs the Scale plan.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Override" }));
    });
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await settle();

    expect(updateByIdMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: Project,
        id: PROJECT_ID,
        data: { telemetryRetentionConfig: null },
      }),
    );
    expect(
      screen.getByText(
        "Removed. Telemetry is kept for the project's default retention from now on.",
      ),
    ).toBeInTheDocument();
  });
});
