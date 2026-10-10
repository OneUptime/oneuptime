import {
  APIRequestContext,
  Browser,
  BrowserContext,
  Locator,
  Page,
  Response,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  createItem,
  getItem,
  JSONish,
  requestJson,
  toId,
} from "./Helpers/MonitorAlerting";
import { publicPost } from "./Helpers/StatusPagePublic";

/*
 * Issue #4571 against a real OneUptime: a dashboard whose config was written
 * through the API in the shape the API reference used to document -
 * `{"_type": "DashboardViewConfig", "value": {"components": [...]}}` - never
 * opened. The server stores a config as it is sent, the widgets sat under
 * `value`, and the page threw "Cannot read properties of undefined (reading
 * 'length')" in DashboardCanvas.
 *
 * Here a dashboard is written that way, beside a widget of a type this
 * version does not draw (HostMetricChart, removed in 2026), and then:
 *
 * - it opens, its widget drawn and the other one saying it could not be
 *   shown, with no error page;
 * - Edit widget opens that widget's settings, Delete Widget takes it off,
 *   and Save Changes stores the board in the shape the editor saves;
 * - on a public dashboard stored the same way, the anonymous visitor's
 *   config carries the widgets but never a Data Source widget's query, and
 *   the public page opens.
 *
 * One test, in steps: each Playwright test gets a page of its own, and every
 * step here needs the signed-in session the first one makes. chromium only:
 * what is under test is the app and the server, not a rendering engine.
 */

test.describe.configure({ mode: "serial", retries: 1 });

/*
 * Sharing a dashboard publicly is sold on the Growth plan
 * (Dashboard.isPublicDashboard), so the billing-enabled run creates its
 * project on Growth.
 */
const PREFERRED_PLAN_NAME: string = "Growth";

const SQL_SECRET: string = "SELECT * FROM e2e_internal_billing_accounts";

type PageUrlFunction = (path: string) => string;

const pageUrl: PageUrlFunction = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

interface Widgets {
  textWidgetId: string;
  unknownWidgetId: string;
  text: string;
}

type NewWidgetsFunction = () => Widgets;

const newWidgets: NewWidgetsFunction = (): Widgets => {
  return {
    textWidgetId: crypto.randomUUID(),
    unknownWidgetId: crypto.randomUUID(),
    text: `Written through the API ${Faker.generateRandomString(6)}`,
  };
};

type EnvelopeFunction = (data: {
  widgets: Widgets;
  extraComponents?: Array<JSONish> | undefined;
}) => JSONish;

// The config as the API reference's example had API users write it.
const envelope: EnvelopeFunction = (data: {
  widgets: Widgets;
  extraComponents?: Array<JSONish> | undefined;
}): JSONish => {
  return {
    _type: "DashboardViewConfig",
    value: {
      components: [
        {
          componentId: data.widgets.textWidgetId,
          componentType: "Text",
          widthInDashboardUnits: 6,
          heightInDashboardUnits: 2,
          topInDashboardUnits: 0,
          leftInDashboardUnits: 0,
          arguments: { text: data.widgets.text },
        },
        {
          componentId: data.widgets.unknownWidgetId,
          componentType: "HostMetricChart",
          widthInDashboardUnits: 6,
          heightInDashboardUnits: 4,
          topInDashboardUnits: 0,
          leftInDashboardUnits: 6,
        },
        ...(data.extraComponents || []),
      ],
    },
  };
};

type CreateDashboardFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
  isPublicDashboard?: boolean | undefined;
}) => Promise<string>;

const createDashboard: CreateDashboardFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
  isPublicDashboard?: boolean | undefined;
}): Promise<string> => {
  const item: JSONish = {
    name: data.name,
    projectId: data.projectId,
  };

  if (data.isPublicDashboard) {
    item["isPublicDashboard"] = true;
  }

  const dashboard: JSONish = await createItem({
    page: data.page,
    projectId: data.projectId,
    path: "/api/dashboard",
    item: item,
  });

  const dashboardId: string = toId(dashboard["_id"]);
  expect(dashboardId, "the dashboard should have been created").not.toBe("");

  return dashboardId;
};

type WriteConfigFunction = (data: {
  page: Page;
  projectId: string;
  dashboardId: string;
  dashboardViewConfig: JSONish;
}) => Promise<void>;

// What an API user, a script or Terraform does: PUT the config.
const writeConfig: WriteConfigFunction = async (data: {
  page: Page;
  projectId: string;
  dashboardId: string;
  dashboardViewConfig: JSONish;
}): Promise<void> => {
  await requestJson({
    page: data.page,
    projectId: data.projectId,
    path: `/api/dashboard/${data.dashboardId}`,
    method: "put",
    body: { data: { dashboardViewConfig: data.dashboardViewConfig } },
  });
};

type ReadConfigFunction = (data: {
  page: Page;
  projectId: string;
  dashboardId: string;
}) => Promise<JSONish>;

const readConfig: ReadConfigFunction = async (data: {
  page: Page;
  projectId: string;
  dashboardId: string;
}): Promise<JSONish> => {
  const dashboard: JSONish = await getItem({
    page: data.page,
    projectId: data.projectId,
    path: "/api/dashboard",
    id: data.dashboardId,
    select: { dashboardViewConfig: true },
  });

  return (dashboard["dashboardViewConfig"] as JSONish) || {};
};

test.describe("a dashboard stored in another shape", () => {
  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "app and server behaviour, one engine is enough");

  test("opens with what it can draw, can be fixed, and is served safely when public", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.setTimeout(900000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "Dashboard Stored Shape E2E",
      preferredPlanName: IS_BILLING_ENABLED ? PREFERRED_PLAN_NAME : undefined,
    });

    await test.step("a dashboard written in the documented envelope opens", async () => {
      const widgets: Widgets = newWidgets();
      const dashboardId: string = await createDashboard({
        page,
        projectId,
        name: `Envelope Dashboard ${Faker.generateRandomString(6)}`,
      });

      await writeConfig({
        page,
        projectId,
        dashboardId,
        dashboardViewConfig: envelope({ widgets }),
      });

      // The server keeps what it was sent (Terraform compares the two).
      const stored: JSONish = await readConfig({
        page,
        projectId,
        dashboardId,
      });
      expect(stored["value"], "the envelope is stored as sent").toBeTruthy();

      await page.goto(
        pageUrl(`/dashboard/${projectId}/dashboards/${dashboardId}`),
        { waitUntil: "domcontentloaded" },
      );

      await expect(page.getByText(widgets.text)).toBeVisible({
        timeout: 60000,
      });
      await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);

      const fallback: Locator = page.getByTestId("dashboard-widget-fallback");
      await expect(fallback).toHaveCount(1);
      await expect(fallback).toContainText("This widget could not be shown");
      await expect(fallback).toContainText(
        'OneUptime has no "HostMetricChart" widget.',
      );

      // Edit widget -> Delete Widget -> Save Changes.
      await fallback.getByTestId("dashboard-widget-fallback-edit").click();

      const settings: Locator = page.getByRole("dialog", {
        name: "Component Settings",
      });
      await expect(settings).toBeVisible({ timeout: 30000 });
      await expect(
        settings.getByTestId("widget-settings-unknown-type"),
      ).toContainText(
        'OneUptime has no "HostMetricChart" widget, so there are no settings to change.',
      );

      await settings.getByRole("button", { name: "Delete Widget" }).click();

      const confirm: Locator = page.getByRole("dialog", {
        name: "Delete Widget?",
      });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Delete Widget" }).click();

      await expect(settings).toHaveCount(0);
      await expect(page.getByTestId("dashboard-widget-fallback")).toHaveCount(
        0,
      );

      const saveChanges: Locator = page.getByRole("button", {
        name: "Save Changes",
      });
      /*
       * Save Changes goes the moment the save starts - the toolbar shows
       * "Saving..." in its place - so its going says nothing about the write,
       * and a read straight after it can beat the write to the database.
       * The editor goes back to view mode only once the server has stored
       * the board: wait for the write's answer and for view mode.
       */
      const written: Promise<Response> = page.waitForResponse(
        (response: Response): boolean => {
          return (
            response.request().method() === "PUT" &&
            response.url().includes(`/api/dashboard/${dashboardId}`)
          );
        },
      );
      await saveChanges.click();
      expect((await written).ok(), "the save is accepted").toBeTruthy();
      await expect(
        page.getByRole("button", { name: "More dashboard options" }),
      ).toBeVisible({ timeout: 30000 });
      await expect(saveChanges).toHaveCount(0);

      // Saved in the shape the editor saves: the widget list at the top.
      const saved: JSONish = await readConfig({ page, projectId, dashboardId });
      expect(saved["value"], "the envelope is gone once saved").toBeFalsy();

      const components: Array<JSONish> = (saved["components"] ||
        []) as Array<JSONish>;
      expect(
        components.map((component: JSONish) => {
          return component["componentType"];
        }),
      ).toEqual(["Text"]);
      expect(JSON.stringify(components[0]?.["componentId"])).toContain(
        widgets.textWidgetId,
      );

      // And it opens again as saved.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(widgets.text)).toBeVisible({
        timeout: 60000,
      });
      await expect(page.getByTestId("dashboard-widget-fallback")).toHaveCount(
        0,
      );
      await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);
    });

    await test.step("a public dashboard stored the same way opens for a visitor, without its Data Source queries", async () => {
      const widgets: Widgets = newWidgets();
      const dashboardId: string = await createDashboard({
        page,
        projectId,
        name: `Public Envelope Dashboard ${Faker.generateRandomString(6)}`,
        isPublicDashboard: true,
      });

      await writeConfig({
        page,
        projectId,
        dashboardId,
        dashboardViewConfig: envelope({
          widgets,
          extraComponents: [
            {
              componentId: crypto.randomUUID(),
              componentType: "DataSourceChart",
              widthInDashboardUnits: 6,
              heightInDashboardUnits: 4,
              topInDashboardUnits: 4,
              leftInDashboardUnits: 0,
              arguments: {
                queries: [
                  { dataSourceId: crypto.randomUUID(), query: SQL_SECRET },
                ],
              },
            },
          ],
        }),
      });

      // A visitor: no session at all.
      const visitor: BrowserContext = await browser.newContext();

      try {
        const anonymous: APIRequestContext = visitor.request;

        const viewConfig: JSONish = await publicPost({
          request: anonymous,
          path: `/public-dashboard-api/view-config/${dashboardId}`,
        });
        const served: string = JSON.stringify(
          viewConfig["dashboardViewConfig"],
        );

        expect(served, "the Text widget is served").toContain(widgets.text);
        expect(served, "the Data Source query never is").not.toContain(
          SQL_SECRET,
        );

        const visitorPage: Page = await visitor.newPage();
        await visitorPage.goto(pageUrl(`/public-dashboard/${dashboardId}`), {
          waitUntil: "domcontentloaded",
        });

        await expect(visitorPage.getByText(widgets.text)).toBeVisible({
          timeout: 60000,
        });
        await expect(
          visitorPage.getByTestId("error-boundary-fallback"),
        ).toHaveCount(0);

        // The widget it cannot draw says so, and no more.
        const fallback: Locator = visitorPage.getByTestId(
          "dashboard-widget-fallback",
        );
        await expect(fallback).toHaveCount(1);
        await expect(fallback).toContainText("This widget could not be shown");
        await expect(fallback).not.toContainText("HostMetricChart");
        await expect(visitorPage.getByText(SQL_SECRET)).toHaveCount(0);
      } finally {
        await visitor.close();
      }
    });
  });
});
