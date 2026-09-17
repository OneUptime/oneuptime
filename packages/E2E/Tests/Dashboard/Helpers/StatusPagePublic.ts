import { APIRequestContext, APIResponse, Page, expect } from "@playwright/test";
import { buildUrl, JSONish, toId } from "./MonitorAlerting";

/*
 * Helpers for the public status page e2e spec (StatusPagePublic.spec.ts).
 *
 * The dashboard side (creating the page, attaching resources, publishing an
 * announcement) goes through the authenticated CRUD API via MonitorAlerting's
 * helpers. The public side is fetched through whichever request context the
 * caller passes in — the spec uses a cookie-free one, because a status page
 * that only renders for its own project's session is broken and a
 * same-session request would never catch that.
 *
 * These endpoints take no tenant headers: the status page id in the path is
 * the only scoping there is.
 */

type PublicPostFunction = (data: {
  request: APIRequestContext;
  path: string;
  body?: JSONish | undefined;
}) => Promise<JSONish>;

// POSTs to a public status page endpoint and returns the parsed body.
export const publicPost: PublicPostFunction = async (data: {
  request: APIRequestContext;
  path: string;
  body?: JSONish | undefined;
}): Promise<JSONish> => {
  const response: APIResponse = await data.request.post(buildUrl(data.path), {
    headers: { "content-type": "application/json" },
    data: data.body || {},
  });

  expect(
    response.ok(),
    `POST ${data.path} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);

  const text: string = await response.text();
  return text ? (JSON.parse(text) as JSONish) : {};
};

type PublicPostStatusFunction = (data: {
  request: APIRequestContext;
  path: string;
  body?: JSONish | undefined;
}) => Promise<number>;

/*
 * Same as publicPost but returns the status code instead of asserting on it,
 * for the cases where being rejected is the expected outcome.
 */
export const publicPostStatus: PublicPostStatusFunction = async (data: {
  request: APIRequestContext;
  path: string;
  body?: JSONish | undefined;
}): Promise<number> => {
  const response: APIResponse = await data.request.post(buildUrl(data.path), {
    headers: { "content-type": "application/json" },
    data: data.body || {},
  });

  return response.status();
};

type FindResourceFunction = (data: {
  overview: JSONish;
  displayName: string;
}) => JSONish | null;

/*
 * Pulls one resource out of the /overview response by its display name.
 * Returns null rather than throwing so callers can poll on it.
 */
export const findResourceByDisplayName: FindResourceFunction = (data: {
  overview: JSONish;
  displayName: string;
}): JSONish | null => {
  const resources: Array<JSONish> =
    (data.overview["statusPageResources"] as Array<JSONish>) || [];

  return (
    resources.find((resource: JSONish) => {
      return resource["displayName"] === data.displayName;
    }) || null
  );
};

type StatusNameForResourceFunction = (data: {
  overview: JSONish;
  resource: JSONish;
}) => string;

type ReadDateFunction = (value: unknown) => number;

/*
 * Dates come back as { _type: "DateTime", value: "..." }. Anything
 * unparseable sorts oldest so it never wins the "latest entry" pick.
 */
const readDate: ReadDateFunction = (value: unknown): number => {
  if (!value) {
    return 0;
  }

  const raw: string =
    typeof value === "string"
      ? value
      : String((value as JSONish)["value"] || "");

  const parsed: number = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/*
 * Resolves the human-readable monitor status the public page is reporting for
 * a resource.
 *
 * The overview embeds the status on each timeline entry as `monitorStatus`,
 * but also ships a separate `monitorStatuses` catalog; fall back to joining
 * through `monitorStatusId` so a change in either shape still resolves.
 * A monitor accumulates one timeline entry per status change, so pick the
 * most recent one. Returns "" when the monitor has no timeline entry yet,
 * which is the normal state for the first seconds after a monitor is created.
 */
export const statusNameForResource: StatusNameForResourceFunction = (data: {
  overview: JSONish;
  resource: JSONish;
}): string => {
  const monitorId: string = toId(data.resource["monitorId"]);

  const timelines: Array<JSONish> =
    (data.overview["monitorStatusTimelines"] as Array<JSONish>) || [];

  const statuses: Array<JSONish> =
    (data.overview["monitorStatuses"] as Array<JSONish>) || [];

  const forMonitor: Array<JSONish> = timelines
    .filter((timeline: JSONish) => {
      return toId(timeline["monitorId"]) === monitorId;
    })
    .sort((a: JSONish, b: JSONish) => {
      return readDate(a["startsAt"]) - readDate(b["startsAt"]);
    });

  const latest: JSONish | undefined = forMonitor[forMonitor.length - 1];

  if (!latest) {
    return "";
  }

  const embedded: JSONish | undefined = latest["monitorStatus"] as
    | JSONish
    | undefined;

  if (embedded && embedded["name"]) {
    return String(embedded["name"]);
  }

  const statusId: string = toId(latest["monitorStatusId"]);

  const status: JSONish | undefined = statuses.find((row: JSONish) => {
    return toId(row["_id"]) === statusId;
  });

  return status ? String(status["name"] || "") : "";
};

type WaitForStatusPageHtmlFunction = (data: {
  page: Page;
  statusPageId: string;
}) => Promise<void>;

/*
 * Loads the status page in the browser and waits for the SPA to render its
 * overview. Asserts the page actually mounted rather than just that the HTML
 * shell was served, so a broken bundle or a failing overview call fails here.
 */
export const waitForStatusPageToRender: WaitForStatusPageHtmlFunction =
  async (data: { page: Page; statusPageId: string }): Promise<void> => {
    await data.page.goto(buildUrl(`/status-page/${data.statusPageId}`), {
      waitUntil: "domcontentloaded",
    });

    await data.page
      .locator('[data-testid="status-page-overview"]')
      .waitFor({ state: "visible", timeout: 120000 });
  };
