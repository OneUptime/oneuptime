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
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import RumSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Settings";
import CloudSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Settings";
import ServerlessSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Settings";
import RumSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SideMenu";
import CloudSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/SideMenu";
import ServerlessSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/SideMenu";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getRumBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/RumBreadcrumbs";
import { getCloudBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CloudBreadcrumbs";
import { getServerlessBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ServerlessBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  setViewportWidth,
} from "./SideMenuHarness";

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

// The recommendation badge fetch is unrelated to resource Settings navigation.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem",
  () => {
    return {
      __esModule: true,
      default: (props: { link: Link }): ReactElement => {
        return <SideMenuItem link={props.link} />;
      },
    };
  },
);

const MODEL_ID: ObjectID = new ObjectID(
  "22222222-0000-4000-8000-000000000001",
);

interface ResourceSettingsCase {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  SideMenu: FunctionComponent<{ modelId: ObjectID }>;
  modelType: new () => BaseModel;
  singularName: string;
  settingsKey: PageMap;
  overviewKey: PageMap;
  productPath: string;
  getBreadcrumbs: (path: string) => Array<Link> | undefined;
  breadcrumbTitles: Array<string>;
}

const RESOURCES: Array<ResourceSettingsCase> = [
  {
    name: "RUM application",
    Page: RumSettings,
    SideMenu: RumSideMenu,
    modelType: RumApplication,
    singularName: "application",
    settingsKey: PageMap.RUM_APPLICATION_VIEW_SETTINGS,
    overviewKey: PageMap.RUM_APPLICATION_VIEW,
    productPath: "rum",
    getBreadcrumbs: getRumBreadcrumbs,
    breadcrumbTitles: [
      "Project",
      "Real User Monitoring",
      "View Application",
      "Settings",
    ],
  },
  {
    name: "Cloud environment",
    Page: CloudSettings,
    SideMenu: CloudSideMenu,
    modelType: CloudResource,
    singularName: "cloud environment",
    settingsKey: PageMap.CLOUD_RESOURCE_VIEW_SETTINGS,
    overviewKey: PageMap.CLOUD_RESOURCE_VIEW,
    productPath: "cloud",
    getBreadcrumbs: getCloudBreadcrumbs,
    breadcrumbTitles: ["Project", "Cloud", "View Resource", "Settings"],
  },
  {
    name: "Serverless function",
    Page: ServerlessSettings,
    SideMenu: ServerlessSideMenu,
    modelType: ServerlessFunction,
    singularName: "function",
    settingsKey: PageMap.SERVERLESS_FUNCTION_VIEW_SETTINGS,
    overviewKey: PageMap.SERVERLESS_FUNCTION_VIEW,
    productPath: "serverless",
    getBreadcrumbs: getServerlessBreadcrumbs,
    breadcrumbTitles: [
      "Project",
      "Serverless Functions",
      "View Function",
      "Settings",
    ],
  },
];

function resourceRoute(key: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[key] as Route, {
    modelId: MODEL_ID,
  }).toString();
}

function openSettings(
  resource: ResourceSettingsCase,
  suffix: string = "",
): void {
  const path: string = resourceRoute(resource.settingsKey) + suffix;
  goTo(path);

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
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  const resource: RumApplication = new RumApplication();
  resource.isArchived = false;
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(resource);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * These render the real Settings page and archive card on its real route.
 * Params and project resolution read the actual URL, catching an easy
 * relocation bug: taking a fixed segment from /:id/settings/ reads "settings"
 * as the model id instead of the id React Router matched.
 * The shared card suite covers its permission, cancellation and failure cases.
 */
describe.each(RESOURCES)("$name Settings", (resource: ResourceSettingsCase) => {
  test.each([
    { name: "canonical", suffix: "" },
    { name: "trailing slash", suffix: "/" },
    { name: "query string", suffix: "?source=overview" },
    { name: "trailing slash and query string", suffix: "/?source=overview" },
  ])("loads the routed resource on the $name URL", async ({ suffix }: { suffix: string }) => {
    openSettings(resource, suffix);

    expect(
      await screen.findByText(`Archive ${resource.singularName}`),
    ).toBeInTheDocument();
    expect(ModelAPI.getItem).toHaveBeenCalledWith({
      modelType: resource.modelType,
      id: MODEL_ID,
      select: { isArchived: true },
    });
    expect(
      screen.getByText(
        `Archive this ${resource.singularName} to hide it from lists while it keeps collecting telemetry. You can unarchive it anytime.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeEnabled();
  });

  test("archives the current resource and returns to its current project's list", async () => {
    const update: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(new resource.modelType());
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    openSettings(resource);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(`Archive ${resource.singularName}`);
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor((): void => {
      expect(update).toHaveBeenCalledWith({
        modelType: resource.modelType,
        id: MODEL_ID,
        data: { isArchived: true },
      });
      expect(navigate).toHaveBeenCalledTimes(1);
    });
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/${resource.productPath}`,
    );
  });

  test("has one Settings link for this resource and marks it active", async () => {
    const settingsPath: string = resourceRoute(resource.settingsKey);
    expect(settingsPath).toBe(
      `${resourceRoute(resource.overviewKey)}/settings`,
    );
    expect(RouteUtil.getLastPathForKey(resource.settingsKey)).toBe("settings");
    goTo(settingsPath);

    await renderMenu(<resource.SideMenu modelId={MODEL_ID} />);

    expect(
      linksIn("Settings").filter((link: { title: string }): boolean => {
        return link.title === "Settings";
      }),
    ).toEqual([{ title: "Settings", href: settingsPath }]);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveClass(
      "bg-indigo-50",
    );
    expect(isExpanded("Settings")).toBe(true);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      resourceRoute(resource.overviewKey),
    );
  });

  test("identifies Settings when the resource menu is collapsed on mobile", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(resourceRoute(resource.settingsKey));

    await renderMenu(<resource.SideMenu modelId={MODEL_ID} />);

    expect(mobileSummaryText()).toContain("Settings / Settings");
  });

  test("has concrete breadcrumbs back to the resource and its product", () => {
    const settingsPath: string = resourceRoute(resource.settingsKey);
    goTo(settingsPath);

    const breadcrumbs: Array<Link> | undefined = resource.getBreadcrumbs(
      RouteUtil.getRouteString(resource.settingsKey),
    );

    expect(breadcrumbs?.map((link: Link): string => link.title)).toEqual(
      resource.breadcrumbTitles,
    );
    expect(breadcrumbs?.map((link: Link): string => String(link.to))).toEqual([
      `/dashboard/${PROJECT_ID}`,
      `/dashboard/${PROJECT_ID}/${resource.productPath}`,
      resourceRoute(resource.overviewKey),
      settingsPath,
    ]);
  });
});

test("RUM keeps Replay Policy alongside the application Settings destination", async () => {
  goTo(resourceRoute(PageMap.RUM_APPLICATION_VIEW_SETTINGS));

  await renderMenu(<RumSideMenu modelId={MODEL_ID} />);

  expect(linksIn("Settings")).toEqual([
    {
      title: "Settings",
      href: resourceRoute(PageMap.RUM_APPLICATION_VIEW_SETTINGS),
    },
    {
      title: "Replay Policy",
      href: resourceRoute(PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS),
    },
  ]);
});
