import {
  QueryStatusPageAnnouncementsTool,
  QueryStatusPagesTool,
} from "../../../../Server/Utils/AI/Toolbox/StatusPageTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageAnnouncementService from "../../../../Server/Services/StatusPageAnnouncementService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_status_pages / query_status_page_announcements close the gap where
 * chat could post public status updates but could not see which status pages
 * exist or what they already say. These tests lock in what the model relies
 * on: list mode shows every page (with visibility and public URL) and pages
 * honestly, detail mode shows the public blast radius (resources shown) and
 * the reach of a post (active subscriber count), and citations deep-link to
 * the right dashboard page.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const PAGE_ID: ObjectID = ObjectID.generate();

function buildStatusPage(data?: {
  id?: ObjectID;
  name?: string;
  isPublic?: boolean;
}): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = (data?.id ?? PAGE_ID).toString();
  statusPage.name = data?.name ?? "Acme Status";
  statusPage.description = "Customer-facing status page.";
  statusPage.isPublicStatusPage = data?.isPublic ?? true;
  return statusPage;
}

function buildResource(
  displayName: string,
  monitorName?: string,
): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = displayName;

  if (monitorName) {
    const monitor: Monitor = new Monitor();
    monitor.name = monitorName;
    resource.monitor = monitor;
  }

  return resource;
}

function buildAnnouncement(data?: {
  title?: string;
  pages?: Array<string>;
}): StatusPageAnnouncement {
  const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
  announcement._id = ObjectID.generate().toString();
  announcement.title = data?.title ?? "Elevated error rates";
  announcement.description = "We are investigating elevated error rates.";
  announcement.showAnnouncementAt = new Date("2026-08-01T10:00:00Z");

  announcement.statusPages = (data?.pages ?? ["Acme Status"]).map(
    (name: string): StatusPage => {
      const statusPage: StatusPage = new StatusPage();
      statusPage.name = name;
      return statusPage;
    },
  );

  return announcement;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_status_pages — list mode", () => {
  test("lists status pages with visibility and public URL, with a list citation", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(StatusPageService, "findBy")
      .mockResolvedValue([
        buildStatusPage(),
        buildStatusPage({
          id: ObjectID.generate(),
          name: "Internal Status",
          isPublic: false,
        }),
      ] as never);
    jest
      .spyOn(StatusPageService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.acme.dev" as never);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Acme Status");
    expect(result.dataForLlm).toContain("Internal Status");
    expect(result.dataForLlm).toContain("https://status.acme.dev");
    expect(result.dataForLlm).toContain("Private");
    // All rows returned: no paging banner.
    expect(result.dataForLlm).not.toContain("Showing rows");
    expect(result.citationLabel).toBe("Status pages (2 total)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.StatusPages,
    });
    expect(result.widget).toBeDefined();

    // The query must run under the requesting user's props, never as root+.
    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
    expect(callArgs["skip"]).toBe(0);
  });

  test("marks a paged slice honestly and puts the total in the citation", async () => {
    jest
      .spyOn(StatusPageService, "findBy")
      .mockResolvedValue([
        buildStatusPage(),
        buildStatusPage({ id: ObjectID.generate(), name: "EU Status" }),
      ] as never);
    jest
      .spyOn(StatusPageService, "countBy")
      .mockResolvedValue(new PositiveNumber(5) as never);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.acme.dev" as never);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      {},
      ctx,
    );

    expect(result.dataForLlm.startsWith("Showing rows 1–2 of 5 total.")).toBe(
      true,
    );
    expect(result.citationLabel).toBe("Status pages (5 total)");
  });

  test("clamps limit and skip; an empty project is honest", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(StatusPageService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      { limit: 999, skip: 99999 },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
    expect(callArgs["skip"]).toBe(500);
  });

  test("a public URL lookup failure degrades to no URL, not a tool error", async () => {
    jest
      .spyOn(StatusPageService, "findBy")
      .mockResolvedValue([buildStatusPage()] as never);
    jest
      .spyOn(StatusPageService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockRejectedValue(new Error("global config unavailable") as never);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Acme Status");
    expect(result.dataForLlm).not.toContain("publicUrl=");
  });
});

describe("query_status_pages — detail mode", () => {
  test("returns the page's public resources and active subscriber count with a view citation", async () => {
    jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(buildStatusPage() as never);
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([
        buildResource("Checkout", "checkout-api"),
        buildResource("CDN"),
      ] as never);
    const countBySpy: jest.SpyInstance = jest
      .spyOn(StatusPageSubscriberService, "countBy")
      .mockResolvedValue(new PositiveNumber(42) as never);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.acme.dev" as never);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      { statusPageId: PAGE_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Checkout (monitor: checkout-api)");
    expect(result.dataForLlm).toContain("CDN");
    expect(result.dataForLlm).toContain("activeSubscriberCount=42");
    expect(result.dataForLlm).toContain("https://status.acme.dev");
    expect(result.citationLabel).toBe('Status page "Acme Status"');
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.StatusPageView,
      params: { statusPageId: PAGE_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    /*
     * The subscriber count must be the real reach of a post: scoped to this
     * page and to confirmed, still-subscribed recipients — under the
     * requesting user's props, pinned to the tenant (statusPageId is an
     * untrusted model argument).
     */
    const countArgs: JSONObject = countBySpy.mock.calls[0]?.[0] as JSONObject;
    const countQuery: JSONObject = countArgs["query"] as JSONObject;
    expect(countQuery["statusPageId"]?.toString()).toBe(PAGE_ID.toString());
    expect(countQuery["projectId"]).toBe(ctx.projectId);
    expect(countQuery["isUnsubscribed"]).toBe(false);
    expect(countQuery["isSubscriptionConfirmed"]).toBe(true);
    expect(countArgs["props"]).toBe(ctx.props);
  });

  test("a missing page is honest: zero rows, no widget, no follow-up queries", async () => {
    jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(null as never);
    const resourcesSpy: jest.SpyInstance = jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([] as never);
    const subscribersSpy: jest.SpyInstance = jest
      .spyOn(StatusPageSubscriberService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      { statusPageId: PAGE_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(resourcesSpy).not.toHaveBeenCalled();
    expect(subscribersSpy).not.toHaveBeenCalled();
  });
});

describe("query_status_page_announcements", () => {
  test("lists recent announcements with the pages they appear on", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(StatusPageAnnouncementService, "findBy")
      .mockResolvedValue([
        buildAnnouncement(),
        buildAnnouncement({
          title: "Maintenance window scheduled",
          pages: ["Acme Status", "EU Status"],
        }),
      ] as never);
    jest
      .spyOn(StatusPageAnnouncementService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult =
      await QueryStatusPageAnnouncementsTool.execute({}, ctx);

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Elevated error rates");
    expect(result.dataForLlm).toContain("Maintenance window scheduled");
    expect(result.dataForLlm).toContain("Acme Status, EU Status");
    expect(result.dataForLlm).toContain("2026-08-01");
    expect(result.citationLabel).toBe(
      "Status page announcements, last 30d (2 total)",
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.StatusPages,
    });
    expect(result.widget).toBeDefined();

    // Unfiltered call: window filter present, no relation filter, user props.
    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;
    expect(query["showAnnouncementAt"]).toBeDefined();
    expect(query["statusPages"]).toBeUndefined();
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
  });

  test("statusPageId filter reaches the relation query and switches the citation", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(StatusPageAnnouncementService, "findBy")
      .mockResolvedValue([buildAnnouncement()] as never);
    jest
      .spyOn(StatusPageAnnouncementService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: ToolExecutionResult =
      await QueryStatusPageAnnouncementsTool.execute(
        { statusPageId: PAGE_ID.toString() },
        ctx,
      );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;
    expect(query["statusPages"]?.toString()).toBe(PAGE_ID.toString());
    // The untrusted id filter must come pinned to the tenant from ctx.
    expect(query["projectId"]).toBe(ctx.projectId);

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.StatusPageView,
      params: { statusPageId: PAGE_ID.toString() },
    });
  });

  test("clamps withinDays and limit", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(StatusPageAnnouncementService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageAnnouncementService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult =
      await QueryStatusPageAnnouncementsTool.execute(
        { withinDays: 99999, limit: 500 },
        ctx,
      );

    expect(result.citationLabel).toBe(
      "Status page announcements, last 365d (0 total)",
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
  });

  test("an empty window is honest: zero rows and no widget", async () => {
    jest
      .spyOn(StatusPageAnnouncementService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageAnnouncementService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult =
      await QueryStatusPageAnnouncementsTool.execute({}, ctx);

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
  });
});

describe("status page tools — permissions", () => {
  test("required permissions derive from the model read ACLs", () => {
    expect(QueryStatusPagesTool.requiredPermissions.length).toBeGreaterThan(0);
    expect(
      QueryStatusPageAnnouncementsTool.requiredPermissions.length,
    ).toBeGreaterThan(0);
  });
});
