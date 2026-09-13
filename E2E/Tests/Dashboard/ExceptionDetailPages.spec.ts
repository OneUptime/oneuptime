import { BASE_URL } from "../../Config";
import { JSONish, createItem, requestJson } from "./Helpers/MonitorAlerting";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

interface ExceptionDetailPage {
  title: string;
  suffix: string;
  section: string;
}

interface ExceptionFixtureContext {
  page: Page;
  projectId: string;
  serviceId: string;
  exceptionId: string;
  occurrenceId: string;
}

interface StoredExceptionTriage {
  isArchived: boolean;
  isResolved: boolean;
}

const DETAIL_PAGES: ReadonlyArray<ExceptionDetailPage> = [
  { title: "Overview", suffix: "", section: "Investigate" },
  {
    title: "Stack Trace",
    suffix: "/stack-trace",
    section: "Investigate",
  },
  {
    title: "Occurrences",
    suffix: "/occurrences",
    section: "Investigate",
  },
  { title: "Context", suffix: "/context", section: "Investigate" },
  {
    title: "AI Assistance",
    suffix: "/ai-assistance",
    section: "Resolve",
  },
  { title: "Settings", suffix: "/settings", section: "Manage" },
];

const EXCEPTION_TYPE: string = "CheckoutCapacityError";
const EXCEPTION_MESSAGE: string =
  "Inventory reservation failed for the checkout request";
const EXCEPTION_FINGERPRINT: string =
  "e2e-checkout-capacity-exception-detail-pages";
const EXCEPTION_STACK_TRACE: string = [
  `${EXCEPTION_TYPE}: ${EXCEPTION_MESSAGE}`,
  "    at reserveInventory (/srv/checkout/src/checkout.ts:84:11)",
  "    at submitOrder (/srv/checkout/src/order.ts:132:9)",
  "    at processCheckout (/srv/checkout/src/handler.ts:27:5)",
].join("\n");
const SERVICE_NAME: string = "E2E Checkout API";
const SPAN_NAME: string = "checkout.request";
const RELEASE: string = "2026.09.13-e2e";
const ENVIRONMENT: string = "e2e";
const TRACE_ID: string = "01a09ba3359b71e2b03cc15131c1910e";
const SPAN_ID: string = "c15131c1910e359b";

const ctx: ExceptionFixtureContext = {
  page: undefined as unknown as Page,
  projectId: "",
  serviceId: "",
  exceptionId: "",
  occurrenceId: "",
};

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

const idFromCreatedItem: (item: JSONish, description: string) => string = (
  item: JSONish,
  description: string,
): string => {
  const rawId: unknown = item["_id"];
  const id: string =
    typeof rawId === "string"
      ? rawId
      : String((rawId as JSONish | undefined)?.["value"] || "");

  expect(id, `${description} should have an id`).not.toBe("");
  return id;
};

const detailBasePath: () => string = (): string => {
  return `/dashboard/${ctx.projectId}/exceptions/${ctx.exceptionId}`;
};

const desktopMenu: () => Locator = (): Locator => {
  return ctx.page.locator(
    "aside[role='navigation'][aria-label='Main navigation']",
  );
};

const summary: () => Locator = (): Locator => {
  return ctx.page.getByTestId("exception-summary");
};

const readExceptionTriage: () => Promise<StoredExceptionTriage> =
  async (): Promise<StoredExceptionTriage> => {
    const body: JSONish = await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/telemetry-exception/get-list",
      body: {
        query: { _id: ctx.exceptionId, projectId: ctx.projectId },
        select: { _id: true, isArchived: true, isResolved: true },
        limit: 2,
        skip: 0,
        sort: {},
      },
    });

    const exceptions: Array<StoredExceptionTriage> = (body["data"] ||
      []) as Array<StoredExceptionTriage>;
    expect(exceptions, "the exception fixture should still exist").toHaveLength(
      1,
    );

    return exceptions[0]!;
  };

const assertPageSpecificContent: (
  detailPage: ExceptionDetailPage,
) => Promise<void> = async (detailPage: ExceptionDetailPage): Promise<void> => {
  if (detailPage.title === "Overview") {
    await expect(
      ctx.page.getByRole("heading", {
        name: "Exception Metadata",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      ctx.page.getByText(SERVICE_NAME, { exact: true }),
    ).toBeVisible();
    await expect(
      ctx.page.getByText(EXCEPTION_FINGERPRINT, { exact: true }),
    ).toBeVisible();
    return;
  }

  if (detailPage.title === "Stack Trace") {
    await expect(
      ctx.page.getByRole("heading", { name: "Stack Trace", exact: true }),
    ).toBeVisible();
    await expect(
      ctx.page.getByText("Raw Stack Trace", { exact: true }),
    ).toBeVisible();
    await expect(ctx.page.getByText(/reserveInventory/)).toBeVisible();
    return;
  }

  if (detailPage.title === "Occurrences") {
    await expect(
      ctx.page.getByRole("heading", {
        name: "Exception Occurrences",
        exact: true,
      }),
    ).toBeVisible();
    await expect(ctx.page.getByText(SPAN_NAME, { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(ctx.page.getByText(RELEASE, { exact: true })).toBeVisible();
    return;
  }

  if (detailPage.title === "Context") {
    await expect(
      ctx.page.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible();
    await expect(
      ctx.page.getByRole("button", { name: "Show Logs", exact: true }),
    ).toBeVisible();
    return;
  }

  if (detailPage.title === "AI Assistance") {
    /*
     * A fresh project normally shows the setup checklist. An environment
     * with global AI defaults may instead be ready immediately, so assert
     * the real unresolved-exception action surface in either valid state.
     */
    await expect(
      ctx.page
        .getByRole("heading")
        .filter({
          hasText:
            /Set up AI for this exception|Fix this exception with AI|AI Fix Task Status/,
        })
        .first(),
    ).toBeVisible({ timeout: 30000 });
    return;
  }

  await expect(
    ctx.page.getByRole("heading", {
      name: "Mark as Resolved",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    ctx.page.getByRole("heading", {
      name: "Archive Exception",
      exact: true,
    }),
  ).toBeVisible();
};

const confirmSettingsAction: (data: {
  actionName: string;
  expectedNextAction: string;
  expectedStatus: string;
  expectedStoredState: StoredExceptionTriage;
}) => Promise<void> = async (data: {
  actionName: string;
  expectedNextAction: string;
  expectedStatus: string;
  expectedStoredState: StoredExceptionTriage;
}): Promise<void> => {
  await ctx.page
    .getByRole("button", { name: data.actionName, exact: true })
    .click();

  const modal: Locator = ctx.page.getByTestId("modal");
  await expect(
    modal.getByRole("heading", {
      name: `Confirm ${data.actionName}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(modal.getByTestId("confirm-modal-description")).toContainText(
    `Are you sure you want to ${data.actionName}?`,
  );
  await modal.getByTestId("modal-footer-submit-button").click();

  await expect(
    ctx.page.getByRole("button", {
      name: data.expectedNextAction,
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(summary()).toContainText(data.expectedStatus);

  await expect
    .poll(
      async (): Promise<string> => {
        const stored: StoredExceptionTriage = await readExceptionTriage();
        return `${stored.isResolved}:${stored.isArchived}`;
      },
      { timeout: 30000 },
    )
    .toBe(
      `${data.expectedStoredState.isResolved}:${data.expectedStoredState.isArchived}`,
    );
};

test.describe("Exception detail pages", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(420000);

    ctx.page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Exception Detail Pages",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    const service: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/service",
      item: {
        name: SERVICE_NAME,
        projectId: ctx.projectId,
      },
    });
    ctx.serviceId = idFromCreatedItem(service, "exception service fixture");

    const occurredAt: Date = new Date();
    const firstSeenAt: Date = new Date(occurredAt.getTime() - 90_000);
    const retentionDate: Date = new Date(
      occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );

    /*
     * Seed through the same authenticated APIs the dashboard uses. The
     * Postgres record supplies group/triage state; the ClickHouse record is a
     * real occurrence that exercises the Stack Trace, Occurrences and Context
     * pages instead of merely mounting their empty states.
     */
    const exception: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/telemetry-exception",
      item: {
        projectId: ctx.projectId,
        primaryEntityId: ctx.serviceId,
        primaryEntityType: "OpenTelemetry",
        exceptionType: EXCEPTION_TYPE,
        message: EXCEPTION_MESSAGE,
        stackTrace: EXCEPTION_STACK_TRACE,
        fingerprint: EXCEPTION_FINGERPRINT,
        firstSeenAt: firstSeenAt.toISOString(),
        lastSeenAt: occurredAt.toISOString(),
        occuranceCount: 3,
        firstSeenInRelease: "2026.09.12-e2e",
        lastSeenInRelease: RELEASE,
        environment: ENVIRONMENT,
        isResolved: false,
        isArchived: false,
      },
    });
    ctx.exceptionId = idFromCreatedItem(exception, "exception group fixture");

    const occurrence: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/exceptions",
      item: {
        projectId: ctx.projectId,
        primaryEntityId: ctx.serviceId,
        primaryEntityType: "OpenTelemetry",
        time: occurredAt.toISOString(),
        timeUnixNano: occurredAt.getTime() * 1_000_000,
        exceptionType: EXCEPTION_TYPE,
        stackTrace: EXCEPTION_STACK_TRACE,
        message: EXCEPTION_MESSAGE,
        spanStatusCode: 2,
        escaped: true,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        sessionId: "",
        fingerprint: EXCEPTION_FINGERPRINT,
        spanName: SPAN_NAME,
        release: RELEASE,
        environment: ENVIRONMENT,
        attributes: {
          "checkout.stage": "reserve-inventory",
          "exception.fixture": "exception-detail-pages",
        },
        attributeKeys: ["checkout.stage", "exception.fixture"],
        entityKeys: [`service:${ctx.serviceId}`],
        retentionDate: retentionDate.toISOString(),
      },
    });
    ctx.occurrenceId = idFromCreatedItem(
      occurrence,
      "exception occurrence fixture",
    );

    /* Prove both stores accepted the fixture before exercising the UI. */
    await expect
      .poll(
        async (): Promise<number> => {
          const response: JSONish = await requestJson({
            page: ctx.page,
            projectId: ctx.projectId,
            path: "/api/exceptions/get-list",
            body: {
              query: {
                projectId: ctx.projectId,
                _id: ctx.occurrenceId,
              },
              select: { _id: true, fingerprint: true },
              limit: 2,
              skip: 0,
              sort: {},
            },
          });

          return ((response["data"] || []) as Array<JSONish>).length;
        },
        { timeout: 30000 },
      )
      .toBe(1);
    await expect
      .poll(
        async (): Promise<string> => {
          const triage: StoredExceptionTriage = await readExceptionTriage();
          return `${triage.isResolved}:${triage.isArchived}`;
        },
        { timeout: 30000 },
      )
      .toBe("false:false");
  });

  test.afterAll(async () => {
    test.setTimeout(120000);

    if (!ctx.page) {
      return;
    }

    const deleteFixture: (path: string, id: string) => Promise<void> = async (
      path: string,
      id: string,
    ): Promise<void> => {
      if (!id || !ctx.projectId) {
        return;
      }

      const response: APIResponse = await ctx.page.request.delete(
        urlFor(`${path}/${id}`),
        {
          headers: {
            tenantid: ctx.projectId,
            projectid: ctx.projectId,
          },
        },
      );
      expect(
        response.ok() || response.status() === 404,
        `cleanup ${path}/${id} returned ${response.status()}: ${await response.text()}`,
      ).toBe(true);
    };

    await deleteFixture("/api/exceptions", ctx.occurrenceId);
    await deleteFixture("/api/telemetry-exception", ctx.exceptionId);

    if (ctx.projectId) {
      const response: APIResponse = await ctx.page.request.delete(
        urlFor(`/api/project/${ctx.projectId}`),
        { headers: { tenantid: ctx.projectId } },
      );
      expect(
        response.ok() || response.status() === 404,
        `cleanup project returned ${response.status()}: ${await response.text()}`,
      ).toBe(true);
    }

    await ctx.page.close();
  });

  test.beforeEach(() => {
    test.setTimeout(180000);
  });

  test("shows a real exception identity and its overview", async () => {
    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: urlFor(detailBasePath()),
      ready: summary(),
    });

    await expect(
      ctx.page.getByRole("heading", { name: "Exception", exact: true }),
    ).toBeVisible();
    await expect(summary()).toContainText("Unresolved");
    await expect(summary()).toContainText(EXCEPTION_TYPE);
    await expect(summary()).toContainText(EXCEPTION_MESSAGE);
    await expect(summary()).toContainText(ENVIRONMENT);
    await expect(summary()).toContainText(RELEASE);
    await expect(summary()).toContainText("Occurrences");
    await expect(summary()).toContainText("3");

    await assertPageSpecificContent(DETAIL_PAGES[0]!);

    for (const detailPage of DETAIL_PAGES) {
      const expectedPath: string = detailBasePath() + detailPage.suffix;
      await expect(
        desktopMenu().getByRole("link", {
          name: detailPage.title,
          exact: true,
        }),
      ).toHaveAttribute("href", expectedPath);
    }
  });

  test("keeps all six focused pages bookmarkable with distinguishing content", async () => {
    for (const detailPage of DETAIL_PAGES) {
      const expectedPath: string = detailBasePath() + detailPage.suffix;
      const expectedUrl: string = urlFor(expectedPath);
      const link: Locator = desktopMenu().getByRole("link", {
        name: detailPage.title,
        exact: true,
      });

      await link.click();
      await expect(ctx.page).toHaveURL(expectedUrl);
      await expect(link).toHaveClass(/bg-indigo-50/);
      await expect(
        ctx.page
          .getByRole("navigation", { name: "Breadcrumb" })
          .getByText(detailPage.title, { exact: true }),
      ).toBeVisible();
      await assertPageSpecificContent(detailPage);

      await ctx.page.reload({ waitUntil: "domcontentloaded" });
      await expect(ctx.page).toHaveURL(expectedUrl);
      await expect(summary()).toContainText(EXCEPTION_MESSAGE, {
        timeout: 30000,
      });
      await expect(link).toHaveClass(/bg-indigo-50/);
      await expect(
        ctx.page
          .getByRole("navigation", { name: "Breadcrumb" })
          .getByText(detailPage.title, { exact: true }),
      ).toBeVisible();
      await assertPageSpecificContent(detailPage);
    }
  });

  test("resolves, reopens, archives and unarchives from Settings", async () => {
    await ctx.page.goto(urlFor(`${detailBasePath()}/settings`));
    await expect(summary()).toContainText("Unresolved", { timeout: 30000 });

    await confirmSettingsAction({
      actionName: "Mark as Resolved",
      expectedNextAction: "Mark as Unresolved",
      expectedStatus: "Resolved",
      expectedStoredState: { isResolved: true, isArchived: false },
    });
    await confirmSettingsAction({
      actionName: "Mark as Unresolved",
      expectedNextAction: "Mark as Resolved",
      expectedStatus: "Unresolved",
      expectedStoredState: { isResolved: false, isArchived: false },
    });
    await confirmSettingsAction({
      actionName: "Archive",
      expectedNextAction: "Unarchive",
      expectedStatus: "Archived",
      expectedStoredState: { isResolved: false, isArchived: true },
    });
    await confirmSettingsAction({
      actionName: "Unarchive",
      expectedNextAction: "Archive",
      expectedStatus: "Unresolved",
      expectedStoredState: { isResolved: false, isArchived: false },
    });
  });

  test("keeps the side menu usable on a narrow screen", async () => {
    await ctx.page.goto(urlFor(`${detailBasePath()}/settings`));
    await expect(summary()).toContainText(EXCEPTION_MESSAGE, {
      timeout: 30000,
    });
    await ctx.page.setViewportSize({ width: 390, height: 844 });

    const mobileToggle: Locator = ctx.page.getByTestId(
      "mobile-sidemenu-toggle",
    );
    await expect(mobileToggle).toBeVisible();
    await expect(mobileToggle).toHaveAttribute("aria-expanded", "false");
    await expect(mobileToggle).toContainText("Manage / Settings");

    await mobileToggle.click();
    await expect(mobileToggle).toHaveAttribute("aria-expanded", "true");

    const mobileMenu: Locator = ctx.page.locator(
      "div[role='navigation'][aria-label='Main navigation']:visible",
    );
    await expect(mobileMenu).toBeVisible();
    await mobileMenu
      .getByRole("link", { name: "Context", exact: true })
      .click();

    await expect(ctx.page).toHaveURL(urlFor(`${detailBasePath()}/context`));
    await expect(mobileToggle).toHaveAttribute("aria-expanded", "false");
    await expect(mobileToggle).toContainText("Investigate / Context");
    await expect(
      ctx.page.getByRole("heading", { name: "Logs", exact: true }),
    ).toBeVisible({ timeout: 30000 });

    await ctx.page.reload({ waitUntil: "domcontentloaded" });
    await expect(mobileToggle).toBeVisible({ timeout: 30000 });
    await expect(mobileToggle).toContainText("Investigate / Context");

    await mobileToggle.click();
    await ctx.page
      .locator("div[role='navigation'][aria-label='Main navigation']:visible")
      .getByRole("link", { name: "AI Assistance", exact: true })
      .click();
    await expect(ctx.page).toHaveURL(
      urlFor(`${detailBasePath()}/ai-assistance`),
    );
    await expect(mobileToggle).toContainText("Resolve / AI Assistance");
  });
});
