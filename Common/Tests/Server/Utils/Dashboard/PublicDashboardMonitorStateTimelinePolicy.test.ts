import PublicDashboardMonitorStateTimelinePolicy, {
  MAX_PUBLIC_STATE_TIMELINE_ROWS,
  MAX_PUBLIC_STATE_TIMELINE_WINDOW_IN_DAYS,
  PUBLIC_STATE_TIMELINE_SELECT,
} from "../../../../Server/Utils/Dashboard/PublicDashboardMonitorStateTimelinePolicy";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * The state-timeline route is unauthenticated. Which monitors it reads comes
 * from the stored widget and the project comes from the dashboard, so the time
 * window is the ONLY thing a caller still controls — and this policy is the
 * whole boundary around it. Everything below is written from that angle: what
 * a caller can move, what it provably cannot, and what the response may carry.
 */

const RANGE_START: Date = new Date("2026-08-09T00:00:00.000Z");
const RANGE_END: Date = new Date("2026-08-09T06:00:00.000Z");

const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

type SerializedRangeFunction = (
  startValue: unknown,
  endValue: unknown,
) => JSONObject;

/*
 * The wire form of an InBetween, exactly as JSONFunctions.serialize produces
 * it on the browser side — dates as ISO strings, not Date instances.
 */
const serializedRange: SerializedRangeFunction = (
  startValue: unknown,
  endValue: unknown,
): JSONObject => {
  return {
    _type: ObjectType.InBetween,
    startValue: startValue,
    endValue: endValue,
  } as JSONObject;
};

describe("PublicDashboardMonitorStateTimelinePolicy", () => {
  describe("assertWidgetDrawsTimeline", () => {
    type WidgetFunction = (viewMode?: unknown) => JSONObject;

    const widget: WidgetFunction = (viewMode?: unknown): JSONObject => {
      return {
        componentType: "MonitorList",
        arguments: viewMode === undefined ? {} : ({ viewMode } as JSONObject),
      } as JSONObject;
    };

    it("accepts a widget that is actually in timeline mode", () => {
      expect(() => {
        return PublicDashboardMonitorStateTimelinePolicy.assertWidgetDrawsTimeline(
          widget("timeline"),
        );
      }).not.toThrow();
    });

    it.each([
      ["list", "list"],
      ["honeycomb", "honeycomb"],
      ["an unset view mode", undefined],
      ["a mode from a newer version", "heatmap"],
      ["a non-string", 7],
      ["null", null],
    ])("refuses a widget in %s", (_label: string, viewMode: unknown) => {
      /*
       * A Monitor List in list or honeycomb mode publishes each monitor's
       * name, type and CURRENT status and nothing more. Serving 92 days of
       * every status change for one would hand out history its author never
       * put on the page — adding the widget is the owner's ONLY opt-in, and
       * the view mode is part of what they opted into.
       */
      expect(() => {
        return PublicDashboardMonitorStateTimelinePolicy.assertWidgetDrawsTimeline(
          widget(viewMode),
        );
      }).toThrow(BadDataException);
    });

    it.each([
      ["no arguments object at all", {}],
      ["a null arguments object", { arguments: null }],
      ["an arguments array", { arguments: [] }],
      ["a string arguments value", { arguments: "timeline" }],
    ])(
      "refuses a widget with %s rather than reading through it",
      (_label: string, malformed: JSONObject) => {
        expect(() => {
          return PublicDashboardMonitorStateTimelinePolicy.assertWidgetDrawsTimeline(
            { componentType: "MonitorList", ...malformed } as JSONObject,
          );
        }).toThrow(BadDataException);
      },
    );
  });

  describe("resolveWindow", () => {
    it("accepts a well-formed range sent as ISO strings", () => {
      const window: InBetween<Date> =
        PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(RANGE_START.toISOString(), RANGE_END.toISOString()),
        );

      expect(window.startValue).toEqual(RANGE_START);
      expect(window.endValue).toEqual(RANGE_END);
    });

    it("accepts a range that already carries real Dates", () => {
      /*
       * The deserializer may hand back either shape depending on how the body
       * was encoded, so both have to work.
       */
      const window: InBetween<Date> =
        PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(RANGE_START, RANGE_END),
        );

      expect(window.startValue).toEqual(RANGE_START);
      expect(window.endValue).toEqual(RANGE_END);
    });

    it("returns a copy rather than the caller's Date objects", () => {
      const mutableStart: Date = new Date(RANGE_START.getTime());

      const window: InBetween<Date> =
        PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(mutableStart, RANGE_END),
        );

      mutableStart.setFullYear(1999);

      expect(window.startValue.getFullYear()).toBe(2026);
    });

    it("rejects a body that is not a range at all", () => {
      expect(() => {
        return PublicDashboardMonitorStateTimelinePolicy.resolveWindow({
          startValue: RANGE_START.toISOString(),
          endValue: RANGE_END.toISOString(),
        } as JSONObject);
      }).toThrow(BadDataException);
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a bare string", "2026-08-09"],
      ["a number", 1754697600000],
      ["an array", []],
    ])("rejects %s in place of a range", (_label: string, value: unknown) => {
      expect(() => {
        return PublicDashboardMonitorStateTimelinePolicy.resolveWindow(value);
      }).toThrow(BadDataException);
    });

    it.each([
      ["an unparseable string", "not-a-date"],
      ["a number", 1754697600000],
      ["null", null],
      ["an object", {}],
    ])(
      "rejects a range whose start is %s",
      (_label: string, value: unknown) => {
        expect(() => {
          return PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
            serializedRange(value, RANGE_END.toISOString()),
          );
        }).toThrow(BadDataException);
      },
    );

    it("rejects a range whose end is unparseable", () => {
      expect(() => {
        return PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(RANGE_START.toISOString(), "not-a-date"),
        );
      }).toThrow(BadDataException);
    });

    it("rejects an absurdly long date string rather than parsing it", () => {
      /*
       * Date parsing is the one place a caller controls the length of a string
       * this route will work on, so it is bounded before it reaches the parser.
       */
      expect(() => {
        return PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(
            "2026-08-09T00:00:00.000Z".padEnd(200, " "),
            RANGE_END,
          ),
        );
      }).toThrow(BadDataException);
    });

    it("rejects an inverted range", () => {
      expect(() => {
        return PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(RANGE_END.toISOString(), RANGE_START.toISOString()),
        );
      }).toThrow(BadDataException);
    });

    it("rejects a zero-length range", () => {
      expect(() => {
        return PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(RANGE_START.toISOString(), RANGE_START.toISOString()),
        );
      }).toThrow(BadDataException);
    });

    it("leaves a range at the ceiling exactly as it is", () => {
      const start: Date = new Date(
        RANGE_END.getTime() -
          MAX_PUBLIC_STATE_TIMELINE_WINDOW_IN_DAYS * MS_PER_DAY,
      );

      const window: InBetween<Date> =
        PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(start.toISOString(), RANGE_END.toISOString()),
        );

      expect(window.startValue).toEqual(start);
      expect(window.endValue).toEqual(RANGE_END);
    });

    it("clamps a range longer than the ceiling instead of rejecting it", () => {
      /*
       * A wall display asking for too much should draw a shorter range, not an
       * error card. The END is what the viewer is looking at, so the START is
       * the side that moves.
       */
      const window: InBetween<Date> =
        PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(
            new Date("2020-01-01T00:00:00.000Z").toISOString(),
            RANGE_END.toISOString(),
          ),
        );

      expect(window.endValue).toEqual(RANGE_END);
      expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
        MAX_PUBLIC_STATE_TIMELINE_WINDOW_IN_DAYS * MS_PER_DAY,
      );
    });

    it("bounds the window a caller can reach however far back it asks", () => {
      const window: InBetween<Date> =
        PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
          serializedRange(
            new Date("1970-01-01T00:00:00.000Z").toISOString(),
            RANGE_END.toISOString(),
          ),
        );

      expect(
        window.endValue.getTime() - window.startValue.getTime(),
      ).toBeLessThanOrEqual(
        MAX_PUBLIC_STATE_TIMELINE_WINDOW_IN_DAYS * MS_PER_DAY,
      );
    });
  });

  describe("resolveWindowFromBody", () => {
    it("reads the range out of the startAndEndDate key", () => {
      const window: InBetween<Date> =
        PublicDashboardMonitorStateTimelinePolicy.resolveWindowFromBody({
          componentId: "ignored",
          startAndEndDate: serializedRange(
            RANGE_START.toISOString(),
            RANGE_END.toISOString(),
          ),
        } as JSONObject);

      expect(window.startValue).toEqual(RANGE_START);
      expect(window.endValue).toEqual(RANGE_END);
    });

    it.each([
      ["an absent body", undefined],
      ["an empty body", {}],
      ["a body with no range", { componentId: "abc" }],
    ])(
      "refuses to guess a window given %s",
      (_label: string, body: JSONObject | undefined) => {
        /*
         * Defaulting the window here would mean an anonymous request with no
         * range at all still produced a read; the route requires one.
         */
        expect(() => {
          return PublicDashboardMonitorStateTimelinePolicy.resolveWindowFromBody(
            body,
          );
        }).toThrow(BadDataException);
      },
    );
  });

  describe("the response projection", () => {
    it("selects only what the timeline draws", () => {
      expect(PUBLIC_STATE_TIMELINE_SELECT).toEqual({
        monitorId: true,
        startsAt: true,
        endsAt: true,
        monitorStatus: {
          _id: true,
          name: true,
          color: true,
          isOperationalState: true,
          priority: true,
        },
      });
    });

    it("never exposes the operator-facing columns of a timeline row", () => {
      /*
       * This read runs as root after only a dashboard read-access check, so
       * this projection is the only thing keeping the rest of the row out of
       * an anonymous response. rootCause and statusChangeLog carry probe
       * output and internal error detail.
       */
      for (const column of [
        "rootCause",
        "statusChangeLog",
        "isOwnerNotified",
        "createdByUserId",
        "createdByUser",
        "projectId",
      ]) {
        expect(
          Object.prototype.hasOwnProperty.call(
            PUBLIC_STATE_TIMELINE_SELECT,
            column,
          ),
        ).toBe(false);
      }
    });

    it("selects the status id the uptime math keys off", () => {
      /*
       * UptimeUtil matches an event against the downtime statuses by
       * monitorStatus.id. Without _id every segment collapses into one
       * indistinguishable status and the lane reports 100% uptime through an
       * outage.
       */
      expect(
        (PUBLIC_STATE_TIMELINE_SELECT.monitorStatus as JSONObject)["_id"],
      ).toBe(true);
    });
  });

  describe("the row ceiling", () => {
    it("bounds a single response well below the project list limit", () => {
      expect(MAX_PUBLIC_STATE_TIMELINE_ROWS).toBeGreaterThan(0);
      expect(MAX_PUBLIC_STATE_TIMELINE_ROWS).toBeLessThan(10000);
    });
  });
});
