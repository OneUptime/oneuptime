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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent } from "react";
import { MemoryRouter } from "react-router-dom";
import EditInSettingsLink, {
  EDIT_IN_SETTINGS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/EditInSettingsLink";
import { isResourceColumnEditable } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceDetailsCard";
import HostSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Settings";
import KubernetesClusterSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Settings";
import ProxmoxClusterSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Settings";
import RumApplicationSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Settings";
import ServiceSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../Models/DatabaseModels/Service";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { subscribeToModelHeaderChanged } from "../../../UI/Components/Page/ModelHeaderEvents";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import {
  getByTextOutsideFoldedHeaders,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

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

/*
 * A resource's name, description, labels and identity are edited in one
 * place: the details card at the top of its Settings page
 * (ResourceDetailsCard). These render the real Settings pages against a fake
 * API: what the card shows, what its Edit dialog asks for - the name and
 * description open, the identifier a person may change and the labels
 * folded under Advanced - and that a save tells the page header to read the
 * record again.
 */

const WAIT_TIMEOUT: number = 20000;

const MODEL_ID: ObjectID = new ObjectID("44444444-0000-4000-8000-000000000001");

const PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

function grantAdmin(): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(PERMISSIONS);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: PERMISSIONS.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function label(name: string): Label {
  const item: Label = new Label();
  item._id = ObjectID.generate().toString();
  item.name = name;
  item.color = undefined as never;
  return item;
}

let stored: BaseModel | null = null;
let createOrUpdate: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grantAdmin();

  jest.spyOn(ModelAPI, "getItem").mockImplementation(async () => {
    return stored as never;
  });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<BaseModel>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });

  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);

  createOrUpdate = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function openSettings(
  Page: FunctionComponent<PageComponentProps>,
  key: PageMap,
): void {
  const path: string = RouteUtil.populateRouteParams(RouteMap[key] as Route, {
    modelId: MODEL_ID,
  }).toString();

  goTo(path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Page
        pageRoute={RouteMap[key] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function card(title: string): HTMLElement {
  const heading: HTMLElement = screen.getByRole("heading", { name: title });
  const found: HTMLElement | null = heading.closest(
    "[data-testid='card'], .shadow, section, div.rounded-lg",
  );
  return (found || heading.parentElement!.parentElement!) as HTMLElement;
}

async function openEditDialog(): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: "Edit Details" },
      { timeout: WAIT_TIMEOUT },
    ),
  );

  const dialog: HTMLElement = await screen.findByRole(
    "dialog",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  await within(dialog).findByText("Description", {}, { timeout: WAIT_TIMEOUT });
  return dialog;
}

/*
 * Whether a field's title sits inside a folded (hidden) section - the field's
 * own label, not the name the folded header lists.
 */
function isFolded(dialog: HTMLElement, title: string): boolean {
  const titleElement: HTMLElement = getByTextOutsideFoldedHeaders(
    dialog,
    title,
  );
  return titleElement.closest("[hidden]") !== null;
}

function openAdvanced(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole("button", { name: "More fields" }));
}

describe("a host's details card", () => {
  beforeEach(() => {
    const host: Host = new Host();
    host._id = MODEL_ID.toString();
    host.name = "Front end";
    host.description = "Serves the storefront";
    host.hostIdentifier = "web-01";
    host.labels = [];
    stored = host;
  });

  test("is the first card on the Settings page, with the display name, description, host name and labels", async () => {
    openSettings(HostSettings, PageMap.HOST_VIEW_SETTINGS);

    expect(
      await screen.findByText("Front end", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();

    const headings: Array<string> = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });
    expect(headings[0]).toBe("Host Details");

    const details: HTMLElement = card("Host Details");
    expect(within(details).getByText("Display Name")).toBeInTheDocument();
    expect(within(details).getByText("Serves the storefront")).toBeVisible();
    expect(
      within(details).getByText("Host Name (host.name)"),
    ).toBeInTheDocument();
    expect(within(details).getByText("web-01")).toBeInTheDocument();
    expect(within(details).getByText("No labels attached.")).toBeVisible();
  });

  test("edits the display name and description open, and folds the host name and labels under Advanced", async () => {
    openSettings(HostSettings, PageMap.HOST_VIEW_SETTINGS);
    await screen.findByText("Front end", {}, { timeout: WAIT_TIMEOUT });

    const dialog: HTMLElement = await openEditDialog();

    expect(isFolded(dialog, "Display Name")).toBe(false);
    expect(isFolded(dialog, "Description")).toBe(false);
    expect(isFolded(dialog, "Host Name (host.name)")).toBe(true);
    expect(isFolded(dialog, "Labels")).toBe(true);

    // One page: no steps.
    expect(
      within(dialog).queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();

    // The identity always holds a value; only labels make it "Configured".
    expect(setChips(dialog)).toEqual([]);

    openAdvanced(dialog);

    expect(isFolded(dialog, "Host Name (host.name)")).toBe(false);
    expect(
      within(dialog).getByText(
        "Telemetry is matched by this host name. Change it only when the host reports a new one: telemetry that still reports the old name creates a new host.",
      ),
    ).toBeVisible();
  });

  test("saves and tells the page header to read the host again", async () => {
    const headerChanges: Array<string> = [];
    const unsubscribe: () => void = subscribeToModelHeaderChanged({
      modelType: Host,
      modelId: MODEL_ID,
      onChanged: (): void => {
        headerChanges.push("changed");
      },
    });

    openSettings(HostSettings, PageMap.HOST_VIEW_SETTINGS);
    await screen.findByText("Front end", {}, { timeout: WAIT_TIMEOUT });

    const dialog: HTMLElement = await openEditDialog();
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(createOrUpdate).toHaveBeenCalledTimes(1);
        expect(headerChanges).toEqual(["changed"]);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const posted: Host = (createOrUpdate.mock.calls[0]![0] as { model: Host })
      .model;
    expect(posted.name).toBe("Front end");
    expect(posted.hostIdentifier).toBe("web-01");

    unsubscribe();
  });

  test("shows the labels as set on the folded section when the host has some, and only them", async () => {
    (stored as Host).labels = [label("production")];

    openSettings(HostSettings, PageMap.HOST_VIEW_SETTINGS);
    await screen.findByText("Front end", {}, { timeout: WAIT_TIMEOUT });

    const dialog: HTMLElement = await openEditDialog();

    await waitFor(
      () => {
        expect(setChips(dialog)).toEqual(["Labels: 1"]);
      },
      { timeout: WAIT_TIMEOUT },
    );
    // The host name is named, never called out: telemetry reports it.
    expect(listedNames(dialog)).toEqual(["Host Name (host.name)", "Labels: 1"]);
  });
});

describe("a Kubernetes cluster's details card", () => {
  test("folds the cluster name the agent reports, with what changing it does", async () => {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster._id = MODEL_ID.toString();
    cluster.name = "Production";
    cluster.clusterIdentifier = "production-us-east-1";
    stored = cluster;

    openSettings(
      KubernetesClusterSettings,
      PageMap.KUBERNETES_CLUSTER_VIEW_SETTINGS,
    );
    await screen.findByText("Production", {}, { timeout: WAIT_TIMEOUT });

    const details: HTMLElement = card("Cluster Details");
    expect(
      within(details).getByText("Cluster Name (clusterName)"),
    ).toBeInTheDocument();

    const dialog: HTMLElement = await openEditDialog();
    expect(isFolded(dialog, "Cluster Name (clusterName)")).toBe(true);
    openAdvanced(dialog);
    expect(dialog).toHaveTextContent(
      "telemetry that still reports the old name creates a new cluster",
    );
  });
});

describe("a RUM application's details card", () => {
  test("shows the service.name it is matched on, and never offers to change it", async () => {
    const app: RumApplication = new RumApplication();
    app._id = MODEL_ID.toString();
    app.name = "Storefront";
    app.appIdentifier = "storefront-web";
    app.isArchived = false;
    stored = app;

    openSettings(RumApplicationSettings, PageMap.RUM_APPLICATION_VIEW_SETTINGS);
    await screen.findByText("Storefront", {}, { timeout: WAIT_TIMEOUT });

    const details: HTMLElement = card("Application Details");
    expect(
      within(details).getByText("App Name (service.name)"),
    ).toBeInTheDocument();
    expect(within(details).getByText("storefront-web")).toBeInTheDocument();

    const dialog: HTMLElement = await openEditDialog();
    expect(isFolded(dialog, "Display Name")).toBe(false);
    expect(
      within(dialog).queryByText("App Name (service.name)", { exact: true }),
    ).not.toBeInTheDocument();
    expect(isFolded(dialog, "Labels")).toBe(true);
  });
});

describe("a resource matched on its name", () => {
  test("a Proxmox cluster's Name says it must match the agent, and its Ceph link stays", async () => {
    const cluster: ProxmoxCluster = new ProxmoxCluster();
    cluster._id = MODEL_ID.toString();
    cluster.name = "pve-production";
    stored = cluster;

    openSettings(ProxmoxClusterSettings, PageMap.PROXMOX_CLUSTER_VIEW_SETTINGS);
    await screen.findAllByText("pve-production", {}, { timeout: WAIT_TIMEOUT });

    expect(screen.getByText("Ceph Storage Link")).toBeInTheDocument();

    const dialog: HTMLElement = await openEditDialog();
    expect(isFolded(dialog, "Name")).toBe(false);
    expect(dialog).toHaveTextContent(
      "Must match the proxmox.cluster.name the Proxmox Agent reports.",
    );
    expect(isFolded(dialog, "Labels")).toBe(true);
  });

  test("a service's details come first; its color and tech stack keep their own card", async () => {
    const service: Service = new Service();
    service._id = MODEL_ID.toString();
    service.name = "checkout";
    stored = service;

    openSettings(ServiceSettings, PageMap.SERVICE_VIEW_SETTINGS);
    await screen.findAllByText("checkout", {}, { timeout: WAIT_TIMEOUT });

    const headings: Array<string> = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });
    expect(headings.slice(0, 2)).toEqual([
      "Service Details",
      "Service Settings",
    ]);
  });
});

describe("which identifiers a person may change", () => {
  test("follows each column's update permissions", () => {
    expect(isResourceColumnEditable(Host, "hostIdentifier")).toBe(true);
    expect(
      isResourceColumnEditable(KubernetesCluster, "clusterIdentifier"),
    ).toBe(true);
    expect(isResourceColumnEditable(RumApplication, "appIdentifier")).toBe(
      false,
    );
    expect(
      isResourceColumnEditable(ServerlessFunction, "functionIdentifier"),
    ).toBe(false);
    for (const column of ["cloudPlatform", "cloudAccountId", "cloudRegion"]) {
      expect(isResourceColumnEditable(CloudResource, column)).toBe(false);
    }
  });
});

describe("the Overview's Edit in Settings link", () => {
  test("is a real link to the Settings page", () => {
    const settings: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW_SETTINGS] as Route,
      { modelId: MODEL_ID },
    );

    render(
      <MemoryRouter>
        <EditInSettingsLink to={settings} />
      </MemoryRouter>,
    );

    const link: HTMLElement = within(
      screen.getByTestId(EDIT_IN_SETTINGS_TEST_ID),
    ).getByRole("link", { name: "Edit in Settings" });
    expect(link).toHaveAttribute("href", settings.toString());
  });
});
