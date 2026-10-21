import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";

/*
 * The retention override cards as the Enterprise image builds the Dashboard:
 * "@oneuptime/ee-dashboard" is the REAL ee/Dashboard/Index here, so every
 * core Settings page renders the real ee cards through its core shell.
 *
 * These are integration tests for the Settings surfaces, not a source-text
 * inventory. They render each real page on its real route and keep the real
 * CardModelDetail -> ModelForm -> BasicForm stack. Only transport,
 * permissions, the license request and the unrelated archive card are
 * replaced.
 *
 * That distinction matters for retention. A field can be present in JSX yet
 * still update the wrong resource, disappear after permission filtering,
 * accept zero days, lose a CustomComponent value before submit, or display a
 * shape that is different from the one the API persists. Each of those bugs
 * can turn into either unexpected data loss or data kept longer than the
 * customer selected.
 *
 * Billing and the edition are pinned (CI's config.env sets
 * BILLING_ENABLED=true): a self-hosted Enterprise Edition unless a test says
 * otherwise, whose license the mocked license request reports.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = true;
let licensePayloadForTest: Record<string, unknown> = {
  status: "valid",
  licenseValid: true,
};

jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
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

  return mocked;
});

const licenseFetchMock: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Utils/API/API",
  ) as Record<string, unknown>;
  const actualDefault: Record<string, unknown> = actual["default"] as Record<
    string,
    unknown
  >;

  return {
    __esModule: true,
    ...actual,
    default: new Proxy(actualDefault, {
      get: (target: Record<string, unknown>, property: string): unknown => {
        if (property === "fetch") {
          return (...args: Array<unknown>): unknown => {
            return licenseFetchMock(...args);
          };
        }

        return target[property];
      },
    }),
  };
});

const getItemMock: jest.Mock = jest.fn();
const createOrUpdateMock: jest.Mock = jest.fn();

interface ItemReadObservation {
  request: {
    modelType: unknown;
    id: ObjectID;
    select?: Record<string, unknown> | undefined;
  };
  returnedModel: BaseModel;
  returnedRetentionInDays: number | undefined;
}

const itemReadObservations: Array<ItemReadObservation> = [];

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("Common/UI/Utils/Permission", () => {
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

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
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
  "@oneuptime/dashboard/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="archive-resource-card" />;
      },
    };
  },
);

import CephSettings from "@oneuptime/dashboard/Pages/Ceph/View/Settings";
import CloudSettings from "@oneuptime/dashboard/Pages/Cloud/View/Settings";
import DatabaseServerSettings, {
  DATABASE_RETENTION_SCOPE_NOTE,
} from "@oneuptime/dashboard/Pages/Database/View/Settings";
import DockerSettings from "@oneuptime/dashboard/Pages/Docker/View/Settings";
import DockerSwarmSettings from "@oneuptime/dashboard/Pages/DockerSwarm/View/Settings";
import HostSettings from "@oneuptime/dashboard/Pages/Host/View/Settings";
import IoTSettings from "@oneuptime/dashboard/Pages/IoT/View/Settings";
import KubernetesSettings from "@oneuptime/dashboard/Pages/Kubernetes/View/Settings";
import PodmanSettings from "@oneuptime/dashboard/Pages/Podman/View/Settings";
import ProxmoxSettings from "@oneuptime/dashboard/Pages/Proxmox/View/Settings";
import RumSettings from "@oneuptime/dashboard/Pages/Rum/View/Settings";
import ServerlessSettings from "@oneuptime/dashboard/Pages/Serverless/View/Settings";
import ServiceSettings from "@oneuptime/dashboard/Pages/Service/View/Settings";
import TelemetrySettings from "@oneuptime/dashboard/Pages/Settings/TelemetrySettings";
import VMwareSettings from "@oneuptime/dashboard/Pages/VMware/View/Settings";
import { getDashboardPlugins } from "@oneuptime/dashboard/Enterprise/Plugins";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import DashboardPlugin from "../../../Dashboard/Index";
import {
  TELEMETRY_RETENTION_GRACE_TITLE,
  TELEMETRY_RETENTION_LAPSED_TITLE,
  TELEMETRY_RETENTION_NOT_INCLUDED_TITLE,
} from "../../../Dashboard/TelemetryRetention/TelemetryRetentionLicenseNotice";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Project from "Common/Models/DatabaseModels/Project";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import Service from "Common/Models/DatabaseModels/Service";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Route from "Common/Types/API/Route";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MODEL_ID: ObjectID = new ObjectID("22222222-0000-4000-8000-000000000001");
const WAIT_TIMEOUT: number = 20000;

interface TelemetryRetentionResourceModel extends BaseModel {
  retainTelemetryDataForDays?: number | undefined;
  telemetryRetentionConfig?: TelemetryRetentionConfig | undefined;
}

interface ResourceSettingsCase<
  TModel extends
    TelemetryRetentionResourceModel = TelemetryRetentionResourceModel,
> {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  modelType: { new (): TModel };
  settingsKey: PageMap;
  detailIdPrefix: string;
  hasSessionReplayRetention: boolean;
  // Which of the resource's telemetry its retention covers, when not all.
  scopeNote?: string | undefined;
}

const RESOURCES: Array<ResourceSettingsCase> = [
  {
    name: "service",
    Page: ServiceSettings,
    modelType: Service,
    settingsKey: PageMap.SERVICE_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-service",
    hasSessionReplayRetention: false,
  },
  {
    name: "host",
    Page: HostSettings,
    modelType: Host,
    settingsKey: PageMap.HOST_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-host",
    hasSessionReplayRetention: false,
  },
  {
    name: "Docker host",
    Page: DockerSettings,
    modelType: DockerHost,
    settingsKey: PageMap.DOCKER_HOST_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-docker-host",
    hasSessionReplayRetention: false,
  },
  {
    name: "Podman host",
    Page: PodmanSettings,
    modelType: PodmanHost,
    settingsKey: PageMap.PODMAN_HOST_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-podman-host",
    hasSessionReplayRetention: false,
  },
  {
    name: "Docker Swarm cluster",
    Page: DockerSwarmSettings,
    modelType: DockerSwarmCluster,
    settingsKey: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-docker-swarm-cluster",
    hasSessionReplayRetention: false,
  },
  {
    name: "Kubernetes cluster",
    Page: KubernetesSettings,
    modelType: KubernetesCluster,
    settingsKey: PageMap.KUBERNETES_CLUSTER_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-kubernetes-cluster",
    hasSessionReplayRetention: false,
  },
  {
    name: "Proxmox cluster",
    Page: ProxmoxSettings,
    modelType: ProxmoxCluster,
    settingsKey: PageMap.PROXMOX_CLUSTER_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-proxmox-cluster",
    hasSessionReplayRetention: false,
  },
  {
    name: "vCenter",
    Page: VMwareSettings,
    modelType: VMwareVCenter,
    settingsKey: PageMap.VMWARE_VCENTER_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-vmware-vcenter",
    hasSessionReplayRetention: false,
  },
  {
    name: "Ceph cluster",
    Page: CephSettings,
    modelType: CephCluster,
    settingsKey: PageMap.CEPH_CLUSTER_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-ceph-cluster",
    hasSessionReplayRetention: false,
  },
  {
    name: "IoT fleet",
    Page: IoTSettings,
    modelType: IoTFleet,
    settingsKey: PageMap.IOT_FLEET_VIEW_SETTINGS,
    detailIdPrefix: "model-detail-iot-fleet",
    hasSessionReplayRetention: false,
  },
  {
    name: "RUM application",
    Page: RumSettings,
    modelType: RumApplication,
    settingsKey: PageMap.RUM_APPLICATION_VIEW_SETTINGS,
    detailIdPrefix: "rum-application",
    hasSessionReplayRetention: true,
  },
  {
    name: "cloud resource",
    Page: CloudSettings,
    modelType: CloudResource,
    settingsKey: PageMap.CLOUD_RESOURCE_VIEW_SETTINGS,
    detailIdPrefix: "cloud-resource",
    hasSessionReplayRetention: false,
  },
  {
    name: "serverless function",
    Page: ServerlessSettings,
    modelType: ServerlessFunction,
    settingsKey: PageMap.SERVERLESS_FUNCTION_VIEW_SETTINGS,
    detailIdPrefix: "serverless-function",
    hasSessionReplayRetention: false,
  },
  {
    name: "database",
    Page: DatabaseServerSettings,
    modelType: DatabaseServer,
    settingsKey: PageMap.DATABASE_SERVER_VIEW_SETTINGS,
    detailIdPrefix: "database-server",
    hasSessionReplayRetention: false,
    scopeNote: DATABASE_RETENTION_SCOPE_NOTE,
  },
];

const resourceNamed: (name: string) => ResourceSettingsCase = (
  name: string,
): ResourceSettingsCase => {
  return RESOURCES.find((resource: ResourceSettingsCase): boolean => {
    return resource.name === name;
  })!;
};

let storedModel: BaseModel;

function resourcePath(resource: ResourceSettingsCase): string {
  return RouteUtil.populateRouteParams(
    RouteMap[resource.settingsKey] as Route,
    { modelId: MODEL_ID },
  ).toString();
}

function modelFor<TModel extends TelemetryRetentionResourceModel>(
  resource: ResourceSettingsCase<TModel>,
  data?: Partial<TModel>,
): TModel {
  const model: TModel = new resource.modelType();
  model.id = MODEL_ID;
  Object.assign(model, data || {});
  return model;
}

// Renders the page and waits for the lazy ee cards and their reads.
async function renderSettings<TModel extends TelemetryRetentionResourceModel>(
  resource: ResourceSettingsCase<TModel>,
  initialModel: TModel,
): Promise<UserEvent> {
  storedModel = initialModel;
  const path: string = resourcePath(resource);

  // Pages that read their id from Navigation rather than the router.
  window.history.pushState({}, "", path);
  Navigation.setLocation(window.location as unknown as never);

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[resource.settingsKey])}
          element={
            <resource.Page
              pageRoute={RouteMap[resource.settingsKey] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole(
    "heading",
    { name: "Telemetry Data Retention" },
    { timeout: WAIT_TIMEOUT },
  );
  await screen.findByRole(
    "heading",
    { name: "Retention by Telemetry Type" },
    { timeout: WAIT_TIMEOUT },
  );
  await waitFor(
    () => {
      expect(
        document.getElementById(
          `${resource.detailIdPrefix}-telemetry-retention`,
        ),
      ).toBeInTheDocument();
      expect(
        document.getElementById(
          `${resource.detailIdPrefix}-telemetry-retention-overrides`,
        ),
      ).toBeInTheDocument();
    },
    { timeout: WAIT_TIMEOUT },
  );

  // Let the license request settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return userEvent.setup({ delay: null });
}

const LICENSE_NOTICE_TEST_IDS: Array<string> = [
  "telemetry-retention-license-lapsed-notice",
  "telemetry-retention-license-not-included-notice",
  "telemetry-retention-license-grace-notice",
];

function expectNoLicenseNotice(): void {
  for (const testId of LICENSE_NOTICE_TEST_IDS) {
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
  }
}

function callsSelecting(field: string): Array<Array<unknown>> {
  return getItemMock.mock.calls.filter((call: Array<unknown>): boolean => {
    const request: {
      select?: Record<string, unknown> | undefined;
    } = call[0] as { select?: Record<string, unknown> | undefined };
    return request.select?.[field] === true;
  });
}

function expectReadFor(resource: ResourceSettingsCase, field: string): void {
  const calls: Array<Array<unknown>> = callsSelecting(field);
  expect(calls.length).toBeGreaterThan(0);

  for (const call of calls) {
    const request: {
      modelType: unknown;
      id: ObjectID;
    } = call[0] as {
      modelType: unknown;
      id: ObjectID;
    };

    expect(request.modelType).toBe(resource.modelType);
    expect(request.id.toString()).toBe(MODEL_ID.toString());
  }
}

function submittedModel<TModel extends BaseModel>(): TModel {
  const request: { model: TModel } = createOrUpdateMock.mock.calls[0]?.[0] as {
    model: TModel;
  };
  return request.model;
}

function editDialog(modelType: { new (): BaseModel }): HTMLElement {
  const singularName: string = new modelType().singularName || "item";
  return screen.getByRole("dialog", { name: `Edit ${singularName}` });
}

async function openEditor(
  modelType: { new (): BaseModel },
  user: UserEvent,
  buttonName: string,
): Promise<HTMLElement> {
  await user.click(
    await screen.findByRole(
      "button",
      { name: buttonName },
      { timeout: WAIT_TIMEOUT },
    ),
  );

  await waitFor(
    () => {
      expect(editDialog(modelType)).toBeVisible();
    },
    { timeout: WAIT_TIMEOUT },
  );

  return editDialog(modelType);
}

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = true;
  licensePayloadForTest = { status: "valid", licenseValid: true };
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  licenseFetchMock.mockReset();
  itemReadObservations.length = 0;

  licenseFetchMock.mockImplementation(async (): Promise<unknown> => {
    return {
      isSuccess: (): boolean => {
        return true;
      },
      data: licensePayloadForTest,
    };
  });

  getItemMock.mockImplementation(
    async (request: ItemReadObservation["request"]): Promise<BaseModel> => {
      const returnedModel: BaseModel = storedModel;
      itemReadObservations.push({
        request,
        returnedModel,
        returnedRetentionInDays: (
          returnedModel as TelemetryRetentionResourceModel
        ).retainTelemetryDataForDays,
      });
      return returnedModel;
    },
  );

  createOrUpdateMock.mockImplementation(
    async (request: {
      model: BaseModel;
    }): Promise<{ data: Record<string, unknown> }> => {
      storedModel = request.model;
      return { data: {} };
    },
  );

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "reload").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test("this suite really runs with the Enterprise plugin", () => {
  expect(getDashboardPlugins()).toBe(DashboardPlugin);
  expect(getDashboardPlugins().TelemetryResourceRetentionSettings).toBe(
    DashboardPlugin.TelemetryResourceRetentionSettings,
  );
});

describe.each(RESOURCES)(
  "$name retention Settings",
  (resource: ResourceSettingsCase) => {
    test("binds both cards to the routed resource and exposes replay retention only where supported", async () => {
      await renderSettings(resource, modelFor(resource));

      expectReadFor(resource, "retainTelemetryDataForDays");
      expectReadFor(resource, "telemetryRetentionConfig");

      expect(
        screen.getByRole("button", { name: "Edit Retention" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit Overrides" }),
      ).toBeInTheDocument();
      expectNoLicenseNotice();

      if (resource.hasSessionReplayRetention) {
        expect(
          await screen.findByRole("heading", {
            name: "Session Replay Retention",
          }),
        ).toBeInTheDocument();
        expectReadFor(resource, "sessionReplayRetentionInDays");
        /*
         * Shown here, edited on the application's Replay Policy: the one
         * button opens it, and no editor of its own is left on this page.
         */
        expect(
          screen.getByRole("button", { name: "Edit on Replay Policy" }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Edit Replay Retention" }),
        ).not.toBeInTheDocument();
      } else {
        expect(
          screen.queryByRole("heading", {
            name: "Session Replay Retention",
          }),
        ).not.toBeInTheDocument();
        expect(callsSelecting("sessionReplayRetentionInDays")).toHaveLength(0);
      }

      // The archive card is still on the page, after the retention cards.
      expect(screen.getByTestId("archive-resource-card")).toBeInTheDocument();

      // A scope note is the first card's to say, and only where one is given.
      if (resource.scopeNote) {
        expect(
          screen.getByTestId("telemetry-retention-scope-note"),
        ).toHaveTextContent(resource.scopeNote);
      } else {
        expect(
          screen.queryByTestId("telemetry-retention-scope-note"),
        ).not.toBeInTheDocument();
      }
    });
  },
);

/*
 * A database's retention covers its engine metrics and logs, not the traces
 * of the queries applications send it. That used to be a blue "Which
 * telemetry this covers." banner above the cards, on every visit; it is the
 * retention card's description now, after the card's own sentence.
 */
describe("database retention scope", () => {
  test("is said in the Telemetry Data Retention card's description, with no banner above the cards", async () => {
    const resource: ResourceSettingsCase = resourceNamed("database");

    await renderSettings(resource, modelFor(resource));

    const note: HTMLElement = screen.getByTestId(
      "telemetry-retention-scope-note",
    );
    const card: HTMLElement = note.closest(
      '[data-testid="card"]',
    ) as HTMLElement;

    expect(
      within(card).getByRole("heading", { name: "Telemetry Data Retention" }),
    ).toBeInTheDocument();
    expect(within(card).getByTestId("card-description")).toHaveTextContent(
      `Set the default retention for telemetry collected from this database. ${DATABASE_RETENTION_SCOPE_NOTE}`,
    );
    expect(note).toHaveTextContent(
      "The traces of the queries your applications send it belong to the calling services and follow their retention.",
    );
    expect(
      screen.queryByText("Which telemetry this covers."),
    ).not.toBeInTheDocument();
  });

  test("leaves the other cards' descriptions as they were", async () => {
    const resource: ResourceSettingsCase = resourceNamed("host");

    await renderSettings(resource, modelFor(resource));

    const heading: HTMLElement = screen.getByRole("heading", {
      name: "Telemetry Data Retention",
    });
    const card: HTMLElement = heading.closest(
      '[data-testid="card"]',
    ) as HTMLElement;

    expect(within(card).getByTestId("card-description")).toHaveTextContent(
      "Set the default retention for telemetry collected from this host.",
    );
    expect(within(card).getByTestId("card-description").textContent).toBe(
      "Set the default retention for telemetry collected from this host.",
    );
  });
});

describe.each([
  resourceNamed("service"),
  resourceNamed("host"),
  resourceNamed("cloud resource"),
])("$name default retention", (resource: ResourceSettingsCase) => {
  test("rejects a zero-day default and persists a valid default on the correct model", async () => {
    const user: UserEvent = await renderSettings(
      resource,
      modelFor(resource, { retainTelemetryDataForDays: 30 }),
    );

    await waitFor(
      () => {
        expect(
          document.getElementById(
            `${resource.detailIdPrefix}-telemetry-retention`,
          ),
        ).toHaveTextContent("30");
      },
      { timeout: WAIT_TIMEOUT },
    );

    const readsBeforeEdit: number = itemReadObservations.length;
    const dialog: HTMLElement = await openEditor(
      resource.modelType,
      user,
      "Edit Retention",
    );
    const modalRead: ItemReadObservation = await waitFor(
      () => {
        const observation: ItemReadObservation | undefined =
          itemReadObservations
            .slice(readsBeforeEdit)
            .find((entry: ItemReadObservation): boolean => {
              return (
                entry.request.select?.["retainTelemetryDataForDays"] === true &&
                entry.request.select?.["_id"] !== true
              );
            });

        expect(observation).toBeDefined();
        return observation as ItemReadObservation;
      },
      { timeout: WAIT_TIMEOUT },
    );

    // The form reads (and so writes) the retention column alone.
    expect(modalRead.request.select).toEqual({
      retainTelemetryDataForDays: true,
    });
    expect(modalRead.request.modelType).toBe(resource.modelType);
    expect(modalRead.request.id.toString()).toBe(MODEL_ID.toString());
    expect(modalRead.returnedRetentionInDays).toBe(30);

    await waitFor(
      () => {
        expect(
          within(editDialog(resource.modelType)).getByRole("spinbutton", {
            name: /^Retain Telemetry Data For \(Days\)/,
          }),
        ).toHaveValue(30);
      },
      { timeout: WAIT_TIMEOUT },
    );
    const input: HTMLElement = within(dialog).getByRole("spinbutton", {
      name: /^Retain Telemetry Data For \(Days\)/,
    });

    await user.clear(input);
    await user.type(input, "0");
    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    expect(
      await within(dialog).findByText(
        "Retain Telemetry Data For (Days) should not be less than 1.",
      ),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "45");
    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const request: { modelType: unknown } = createOrUpdateMock.mock
      .calls[0]?.[0] as { modelType: unknown };
    const submitted: BaseModel & {
      retainTelemetryDataForDays?: number | undefined;
    } = submittedModel();

    expect(request.modelType).toBe(resource.modelType);
    expect(submitted).toBeInstanceOf(resource.modelType);
    expect(submitted._id).toBe(MODEL_ID.toString());
    expect(submitted.retainTelemetryDataForDays).toBe(45);

    await waitFor(
      () => {
        expect(
          document.getElementById(
            `${resource.detailIdPrefix}-telemetry-retention`,
          ),
        ).toHaveTextContent("45");
      },
      { timeout: WAIT_TIMEOUT },
    );
  });
});

const CONFIGURED: TelemetryRetentionConfig = {
  logs: {
    default: 30,
    bySeverity: { [LogSeverity.Error]: 90 },
  },
  traces: {
    default: 14,
    byStatus: { [SpanStatus.Error]: 60 },
  },
  metrics: { default: 15 },
  profiles: { default: 7 },
};

describe.each([
  resourceNamed("cloud resource"),
  resourceNamed("Kubernetes cluster"),
])("$name retention by telemetry type", (resource: ResourceSettingsCase) => {
  const overridesId: string = `${resource.detailIdPrefix}-telemetry-retention-overrides`;

  test("renders every pillar and its specific overrides in the summary", async () => {
    await renderSettings(
      resource,
      modelFor(resource, { telemetryRetentionConfig: CONFIGURED }),
    );

    const detail: HTMLElement = document.getElementById(
      overridesId,
    ) as HTMLElement;

    const expected: Array<{
      name: string;
      defaultDays: number;
      specific?: string | undefined;
    }> = [
      { name: "Logs", defaultDays: 30, specific: "90 days" },
      { name: "Traces", defaultDays: 14, specific: "60 days" },
      { name: "Metrics", defaultDays: 15 },
      { name: "Profiles", defaultDays: 7 },
    ];

    await waitFor(
      () => {
        expect(
          within(detail).getByRole("heading", { name: "Logs" }),
        ).toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );

    for (const pillar of expected) {
      const heading: HTMLElement = within(detail).getByRole("heading", {
        name: pillar.name,
      });
      const card: HTMLElement = heading.closest(".rounded-lg") as HTMLElement;

      expect(card).toHaveTextContent(`${pillar.defaultDays} days`);
      expect(card).toHaveTextContent("Custom");
      if (pillar.specific) {
        expect(card).toHaveTextContent("Specific overrides");
        expect(card).toHaveTextContent(pillar.specific);
      }
    }
  });

  test("loads the stored shape into the real form and collapses fully-cleared overrides to null", async () => {
    const user: UserEvent = await renderSettings(
      resource,
      modelFor(resource, { telemetryRetentionConfig: CONFIGURED }),
    );
    const dialog: HTMLElement = await openEditor(
      resource.modelType,
      user,
      "Edit Overrides",
    );

    await waitFor(
      () => {
        const inputs: Array<HTMLElement> = within(
          editDialog(resource.modelType),
        ).getAllByPlaceholderText("Use default retention");
        expect(inputs).toHaveLength(4);
        expect(inputs[0]).toHaveValue(30);
        expect(inputs[1]).toHaveValue(14);
        expect(inputs[2]).toHaveValue(15);
        expect(inputs[3]).toHaveValue(7);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const pillarInputs: Array<HTMLElement> = within(
      dialog,
    ).getAllByPlaceholderText("Use default retention");
    const severityInputs: Array<HTMLElement> =
      within(dialog).getAllByPlaceholderText("Use logs default");
    const statusInputs: Array<HTMLElement> =
      within(dialog).getAllByPlaceholderText("Use traces default");

    expect(severityInputs).toHaveLength(7);
    expect(severityInputs[1]).toHaveValue(90);
    expect(statusInputs).toHaveLength(3);
    expect(statusInputs[0]).toHaveValue(60);

    // Fatal precedes Error; trace statuses begin with Error.
    fireEvent.change(severityInputs[1] as HTMLElement, {
      target: { value: "" },
    });
    fireEvent.change(statusInputs[0] as HTMLElement, {
      target: { value: "" },
    });
    for (const input of pillarInputs) {
      fireEvent.change(input, { target: { value: "" } });
    }

    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const submitted: TelemetryRetentionResourceModel = submittedModel();
    expect(submitted).toBeInstanceOf(resource.modelType);
    expect(submitted._id).toBe(MODEL_ID.toString());
    expect(submitted.telemetryRetentionConfig).toBeNull();

    await waitFor(
      () => {
        const refreshedDetail: HTMLElement = document.getElementById(
          overridesId,
        ) as HTMLElement;
        expect(
          within(refreshedDetail).getByText("No overrides set."),
        ).toBeVisible();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });
});

describe("the license, on a resource page", () => {
  const resource: ResourceSettingsCase = resourceNamed("host");

  test.each([
    ["expired", { status: "expired", licenseValid: false }],
    ["missing, after the trial", { status: "missing", licenseValid: false }],
    ["invalid", { status: "invalid", licenseValid: false }],
  ])(
    "%s: says the overrides are not applied, and makes both cards read-only",
    async (_label: string, payload: Record<string, unknown>) => {
      licensePayloadForTest = payload;

      await renderSettings(
        resource,
        modelFor(resource, {
          retainTelemetryDataForDays: 30,
          telemetryRetentionConfig: CONFIGURED,
        }),
      );

      expect(
        await screen.findByTestId(
          "telemetry-retention-license-lapsed-notice",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent(TELEMETRY_RETENTION_LAPSED_TITLE);
      await waitFor(
        () => {
          expect(
            screen.queryByRole("button", { name: "Edit Retention" }),
          ).not.toBeInTheDocument();
          expect(
            screen.queryByRole("button", { name: "Edit Overrides" }),
          ).not.toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );

      // What is configured stays visible.
      await waitFor(
        () => {
          expect(
            document.getElementById(
              `${resource.detailIdPrefix}-telemetry-retention`,
            ),
          ).toHaveTextContent("30");
        },
        { timeout: WAIT_TIMEOUT },
      );
    },
  );

  test("a license that leaves retention overrides out: the not-included notice, read-only", async () => {
    licensePayloadForTest = {
      status: "valid",
      licenseValid: true,
      features: ["scim", "audit-logs"],
    };

    await renderSettings(resource, modelFor(resource));

    expect(
      await screen.findByTestId(
        "telemetry-retention-license-not-included-notice",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent(TELEMETRY_RETENTION_NOT_INCLUDED_TITLE);
    await waitFor(
      () => {
        expect(
          screen.queryByRole("button", { name: "Edit Overrides" }),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("a license that includes retention overrides by name: editable, no notice", async () => {
    licensePayloadForTest = {
      status: "valid",
      licenseValid: true,
      features: ["telemetry-retention"],
    };

    await renderSettings(resource, modelFor(resource));

    expect(
      screen.getByRole("button", { name: "Edit Overrides" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("telemetry-retention-license-not-included-notice"),
    ).not.toBeInTheDocument();
  });

  test("the trial or grace period: a warning, and the cards stay editable", async () => {
    licensePayloadForTest = { status: "grace", licenseValid: true };

    await renderSettings(resource, modelFor(resource));

    expect(
      await screen.findByTestId(
        "telemetry-retention-license-grace-notice",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent(TELEMETRY_RETENTION_GRACE_TITLE);
    expect(
      screen.getByRole("button", { name: "Edit Retention" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Overrides" }),
    ).toBeInTheDocument();
  });

  test("an unreadable license answer hides nothing and claims nothing", async () => {
    licenseFetchMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("network down");
    });

    await renderSettings(resource, modelFor(resource));

    expect(
      screen.getByRole("button", { name: "Edit Overrides" }),
    ).toBeInTheDocument();
    expectNoLicenseNotice();
  });

  test("on OneUptime Cloud (Scale plan) there is no license to ask about", async () => {
    billingEnabledForTest = true;
    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue("Scale" as never);

    await renderSettings(resource, modelFor(resource));

    expect(licenseFetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Edit Overrides" }),
    ).toBeInTheDocument();
  });
});

describe("the Enterprise bundle on the Community Edition", () => {
  test("a resource page shows the edition upsell, not the cards", async () => {
    enterpriseEditionForTest = false;
    const resource: ResourceSettingsCase = resourceNamed("service");
    storedModel = modelFor(resource);
    const path: string = resourcePath(resource);

    window.history.pushState({}, "", path);
    Navigation.setLocation(window.location as unknown as never);

    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <PageRoute
            path={String(RouteMap[resource.settingsKey])}
            element={
              <resource.Page
                pageRoute={RouteMap[resource.settingsKey] as Route}
                currentProject={null}
                hasPaymentMethod={true}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole(
        "heading",
        { name: "Retention Overrides", level: 2 },
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Retention by Telemetry Type" }),
    ).not.toBeInTheDocument();
    expect(callsSelecting("telemetryRetentionConfig")).toHaveLength(0);
    expect(licenseFetchMock).not.toHaveBeenCalled();
  });
});

describe("Settings > Telemetry", () => {
  const PAGE_PROPS: PageComponentProps = {
    pageRoute: new Route(
      `/dashboard/${PROJECT_ID.toString()}/settings/telemetry`,
    ),
    currentProject: null,
    hasPaymentMethod: true,
  };

  const renderTelemetrySettings: (
    project: Project,
  ) => Promise<UserEvent> = async (project: Project): Promise<UserEvent> => {
    storedModel = project;

    render(
      <MemoryRouter>
        <TelemetrySettings {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await screen.findByRole(
      "heading",
      { name: "Retention by Telemetry Type" },
      { timeout: WAIT_TIMEOUT },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    return userEvent.setup({ delay: null });
  };

  const projectWith: (config?: TelemetryRetentionConfig) => Project = (
    config?: TelemetryRetentionConfig,
  ): Project => {
    const project: Project = new Project();
    project.id = PROJECT_ID;
    project.defaultTelemetryRetentionInDays = 15;
    if (config) {
      project.telemetryRetentionConfig = config;
    }
    return project;
  };

  test("keeps the project's default retention and adds retention by type for the current project", async () => {
    await renderTelemetrySettings(projectWith(CONFIGURED));

    const detail: HTMLElement = await waitFor(
      () => {
        expect(
          document.getElementById("model-detail-project-telemetry-retention"),
        ).toBeInTheDocument();

        const element: HTMLElement | null = document.getElementById(
          "model-detail-project-telemetry-retention-overrides",
        );

        expect(element).toBeInTheDocument();
        return element as HTMLElement;
      },
      { timeout: WAIT_TIMEOUT },
    );

    const overrideRead: Array<unknown> | undefined = callsSelecting(
      "telemetryRetentionConfig",
    )[0];
    const request: { modelType: unknown; id: ObjectID } = overrideRead![0] as {
      modelType: unknown;
      id: ObjectID;
    };

    expect(request.modelType).toBe(Project);
    expect(request.id.toString()).toBe(PROJECT_ID.toString());

    await waitFor(
      () => {
        expect(
          within(detail).getByRole("heading", { name: "Logs" }),
        ).toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("saves a new logs retention to Project.telemetryRetentionConfig", async () => {
    const user: UserEvent = await renderTelemetrySettings(projectWith());
    const dialog: HTMLElement = await openEditor(
      Project,
      user,
      "Edit Overrides",
    );

    const inputs: Array<HTMLElement> = await within(
      dialog,
    ).findAllByPlaceholderText(
      "Use default retention",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.change(inputs[0] as HTMLElement, { target: { value: "45" } });

    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const submitted: Project = submittedModel<Project>();
    expect(submitted).toBeInstanceOf(Project);
    expect(submitted._id).toBe(PROJECT_ID.toString());
    expect(submitted.telemetryRetentionConfig).toEqual({
      logs: { default: 45 },
    });
    // The default retention is a different card and is not written here.
    expect(submitted.defaultTelemetryRetentionInDays).toBeUndefined();
  });

  test("a lapsed license: the notice, and retention by type is read-only", async () => {
    licensePayloadForTest = { status: "expired", licenseValid: false };

    await renderTelemetrySettings(projectWith(CONFIGURED));

    expect(
      await screen.findByTestId(
        "telemetry-retention-license-lapsed-notice",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    await waitFor(
      () => {
        expect(
          screen.queryByRole("button", { name: "Edit Overrides" }),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    // The default retention is core and stays editable.
    expect(
      screen.getByRole("button", { name: "Edit Retention Settings" }),
    ).toBeInTheDocument();
  });
});
