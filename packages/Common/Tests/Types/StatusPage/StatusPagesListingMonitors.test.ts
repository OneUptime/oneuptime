import { JSONObject } from "../../../Types/JSON";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors, {
  StatusPageListingMonitors,
  StatusPagesListingMonitorsResult,
} from "../../../Types/StatusPage/StatusPagesListingMonitors";
import { describe, expect, test } from "@jest/globals";

/*
 * The status pages that list some monitors, as the server answers and the
 * dashboard reads them (POST /status-page/listing-monitors). The suggestion
 * under a status page picker is advisory, so the dashboard reads the answer
 * defensively: anything malformed reads as nothing to suggest, never as a
 * broken form.
 */

const PAGE_A: string = "b0000000-0000-4000-8000-00000000000a";
const PAGE_B: string = "b0000000-0000-4000-8000-00000000000b";

describe("StatusPagesListingMonitors", () => {
  test("lives under the status page API, and caps what one request names", () => {
    expect(StatusPagesListingMonitors.apiPath).toBe(
      "/status-page/listing-monitors",
    );
    expect(StatusPagesListingMonitors.maxIdsPerRequest).toBe(1000);
  });

  test("asks about scheduled maintenance events and announcements, not incidents", () => {
    expect(StatusPagesListingMonitors.eventTypes).toEqual([
      StatusPageEventType.ScheduledEvent,
      StatusPageEventType.Announcement,
    ]);

    expect(
      StatusPagesListingMonitors.isEventType(
        StatusPageEventType.ScheduledEvent,
      ),
    ).toBe(true);
    expect(
      StatusPagesListingMonitors.isEventType(StatusPageEventType.Announcement),
    ).toBe(true);
    expect(
      StatusPagesListingMonitors.isEventType(StatusPageEventType.Incident),
    ).toBe(false);

    for (const value of [
      "",
      "Scheduled Maintenance",
      "scheduled event",
      1,
      null,
      undefined,
      {},
      ["Announcement"],
    ]) {
      expect(StatusPagesListingMonitors.isEventType(value)).toBe(false);
    }
  });

  test("round-trips an answer", () => {
    const result: StatusPagesListingMonitorsResult = {
      statusPages: [
        { statusPageId: PAGE_A, name: "Acme Public" },
        { statusPageId: PAGE_B, name: "EU Status" },
      ],
    };

    const json: JSONObject = StatusPagesListingMonitors.toJSON(result);

    expect(json).toEqual({
      statusPages: [
        { statusPageId: PAGE_A, name: "Acme Public" },
        { statusPageId: PAGE_B, name: "EU Status" },
      ],
    });
    expect(
      StatusPagesListingMonitors.fromJSON(
        JSON.parse(JSON.stringify(json)) as JSONObject,
      ),
    ).toEqual(result);
  });

  test("an answer without a list, or with a list of the wrong things, suggests nothing", () => {
    for (const json of [
      {},
      { statusPages: null },
      { statusPages: "Acme" },
      { statusPages: { statusPageId: PAGE_A } },
      { statusPages: [null, 1, "Acme", [PAGE_A], true] },
    ]) {
      expect(
        StatusPagesListingMonitors.fromJSON(json as unknown as JSONObject),
      ).toEqual({ statusPages: [] });
    }
  });

  test("drops a page without an id and a second mention of one, and lower-cases ids", () => {
    expect(
      StatusPagesListingMonitors.fromJSON({
        statusPages: [
          { name: "No id" },
          { statusPageId: "   ", name: "Blank id" },
          { statusPageId: PAGE_A.toUpperCase(), name: "  Acme Public  " },
          { statusPageId: PAGE_A, name: "Acme again" },
          { statusPageId: PAGE_B },
        ],
      }),
    ).toEqual({
      statusPages: [
        { statusPageId: PAGE_A, name: "Acme Public" },
        { statusPageId: PAGE_B, name: "" },
      ],
    });
  });

  test("orders by name the way people read names", () => {
    const pages: Array<StatusPageListingMonitors> = [
      { statusPageId: "4", name: "Site 10" },
      { statusPageId: "3", name: "site 2" },
      { statusPageId: "1", name: "Acme" },
      { statusPageId: "2", name: "acme" },
    ];

    expect(
      [...pages]
        .sort(StatusPagesListingMonitors.compareByName)
        .map((page: StatusPageListingMonitors): string => {
          return page.statusPageId;
        }),
    ).toEqual(["1", "2", "3", "4"]);
  });

  test("puts a page without a name last", () => {
    const pages: Array<StatusPageListingMonitors> = [
      { statusPageId: "9", name: "" },
      { statusPageId: "5", name: "  " },
      { statusPageId: "2", name: "Zulu" },
      { statusPageId: "1", name: "Alpha" },
    ];

    expect(
      [...pages]
        .sort(StatusPagesListingMonitors.compareByName)
        .map((page: StatusPageListingMonitors): string => {
          return page.statusPageId;
        }),
    ).toEqual(["1", "2", "5", "9"]);
  });
});
