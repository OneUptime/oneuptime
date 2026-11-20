/**
 * A link that opens a dashboard at one of its widgets
 * (Common/Utils/Dashboard/DashboardWidgetLink.ts, #10084): ?widget=<id>,
 * beside the dashboard's own range, refresh and var-<name>.
 *
 *   - A link's widget is read as people paste links: any case, spaces
 *     around it. A value no widget's id could be is no widget, and the
 *     board opens as it would without it.
 *   - A widget is the one a link names when the id it is drawn under -
 *     an ObjectID, its JSON, text, a number - is the link's, in any case.
 *   - A link is made only for an id a widget could have.
 */

import {
  DASHBOARD_WIDGET_LINK_PARAMETER,
  findDashboardLinkWidget,
  getDashboardLinkWidgetIdFromSearch,
  getDashboardWidgetLinkQuery,
  isDashboardLinkWidget,
  parseDashboardLinkWidgetId,
} from "../../../Utils/Dashboard/DashboardWidgetLink";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

const WIDGET_ID: string = "0192f1a0-0000-7000-8000-0000000e9421";

describe("the widget a link names", () => {
  test("is the address's ?widget=, beside whatever else it names", () => {
    expect(DASHBOARD_WIDGET_LINK_PARAMETER).toBe("widget");
    expect(
      getDashboardLinkWidgetIdFromSearch(
        `?var-service=checkout&range=1d&widget=${WIDGET_ID}&refresh=1m`,
      ),
    ).toBe(WIDGET_ID);
    // Without the "?", as URLSearchParams reads a query.
    expect(getDashboardLinkWidgetIdFromSearch(`widget=${WIDGET_ID}`)).toBe(
      WIDGET_ID,
    );
  });

  test("is read in any case and with spaces around it, as links are pasted", () => {
    expect(
      getDashboardLinkWidgetIdFromSearch(
        `?widget=%20${WIDGET_ID.toUpperCase()}%20`,
      ),
    ).toBe(WIDGET_ID);
    expect(parseDashboardLinkWidgetId(`  ${WIDGET_ID.toUpperCase()}\n`)).toBe(
      WIDGET_ID,
    );
    // A stored id that is a plain name, not a UUID, is an id all the same.
    expect(parseDashboardLinkWidgetId("cpu_chart-2")).toBe("cpu_chart-2");
  });

  test("is none when the address names none, or nothing an id could be", () => {
    expect(getDashboardLinkWidgetIdFromSearch("")).toBe("");
    expect(getDashboardLinkWidgetIdFromSearch("?range=1d")).toBe("");
    expect(getDashboardLinkWidgetIdFromSearch("?widget=")).toBe("");
    expect(getDashboardLinkWidgetIdFromSearch("?widget=%20%20")).toBe("");

    for (const value of [
      "<script>",
      "a b",
      "../../settings",
      "id;drop",
      "x".repeat(129),
    ]) {
      expect(parseDashboardLinkWidgetId(value)).toBe("");
      expect(
        getDashboardLinkWidgetIdFromSearch(
          `?widget=${encodeURIComponent(value)}`,
        ),
      ).toBe("");
    }

    for (const value of [null, undefined, 3, {}, [WIDGET_ID]]) {
      expect(parseDashboardLinkWidgetId(value)).toBe("");
    }
  });

  test("the first one counts, when an address names two", () => {
    expect(
      getDashboardLinkWidgetIdFromSearch(`?widget=${WIDGET_ID}&widget=other`),
    ).toBe(WIDGET_ID);
  });
});

describe("a link to a widget", () => {
  test("names its id in the query, as compared", () => {
    expect(getDashboardWidgetLinkQuery(WIDGET_ID.toUpperCase())).toEqual({
      widget: WIDGET_ID,
    });
    expect(getDashboardWidgetLinkQuery("cpu_chart-2")).toEqual({
      widget: "cpu_chart-2",
    });
  });

  test("names nothing for no widget, or an id no widget could have", () => {
    expect(getDashboardWidgetLinkQuery("")).toEqual({});
    expect(getDashboardWidgetLinkQuery(null)).toEqual({});
    expect(getDashboardWidgetLinkQuery(undefined)).toEqual({});
    expect(getDashboardWidgetLinkQuery("a b")).toEqual({});
  });

  test("read back, names the same widget", () => {
    const query: Record<string, string> =
      getDashboardWidgetLinkQuery(WIDGET_ID);

    expect(
      getDashboardLinkWidgetIdFromSearch(
        `?${new URLSearchParams(query).toString()}`,
      ),
    ).toBe(WIDGET_ID);
  });
});

describe("the widget of a board a link names", () => {
  const components: Array<{ componentId: unknown; title: string }> = [
    {
      componentId: new ObjectID("1c1c1c1c-0000-4000-8000-000000000001"),
      title: "A",
    },
    {
      componentId: {
        _type: ObjectType.ObjectID,
        value: WIDGET_ID.toUpperCase(),
      },
      title: "B",
    },
    { componentId: "  cpu_chart-2 ", title: "C" },
    { componentId: 7, title: "D" },
    { componentId: null, title: "E" },
  ];

  test("is found by the id it is drawn under, in every way one is stored, in any case", () => {
    expect(
      findDashboardLinkWidget(
        components,
        "1c1c1c1c-0000-4000-8000-000000000001",
      )?.title,
    ).toBe("A");
    expect(findDashboardLinkWidget(components, WIDGET_ID)?.title).toBe("B");
    expect(findDashboardLinkWidget(components, "CPU_CHART-2")?.title).toBe("C");
    expect(findDashboardLinkWidget(components, "7")?.title).toBe("D");
    expect(
      isDashboardLinkWidget(
        { _type: ObjectType.ObjectID, value: WIDGET_ID },
        WIDGET_ID.toUpperCase(),
      ),
    ).toBe(true);
  });

  test("is none when the board has no such widget, or the link names none", () => {
    expect(
      findDashboardLinkWidget(
        components,
        "9f9f9f9f-0000-4000-8000-000000000009",
      ),
    ).toBeNull();
    expect(findDashboardLinkWidget(components, "")).toBeNull();
    expect(findDashboardLinkWidget([], WIDGET_ID)).toBeNull();
    // A widget stored without an id is drawn under one of its own, never "".
    expect(isDashboardLinkWidget(null, "")).toBe(false);
    expect(isDashboardLinkWidget("", "")).toBe(false);
    expect(isDashboardLinkWidget(WIDGET_ID, "a b")).toBe(false);
  });
});
