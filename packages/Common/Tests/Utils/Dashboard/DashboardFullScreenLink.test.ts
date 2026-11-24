/**
 * A dashboard shown full screen is named by its address
 * (Common/Utils/Dashboard/DashboardFullScreenLink.ts, issue #10409):
 * ?view=full-screen, beside the dashboard's own range, refresh and
 * var-<name>.
 *
 *   - A link that names it is read leniently: any case, spaces around it,
 *     and the spellings fullscreen and full_screen.
 *   - It is written one way only, and putting it in or taking it out
 *     touches nothing else in the query string.
 *   - A view the parameter names that is not full screen is not ours to
 *     take away.
 */

import {
  DASHBOARD_FULL_SCREEN_VIEW,
  DASHBOARD_VIEW_LINK_PARAMETER,
  applyDashboardFullScreenToSearch,
  getDashboardFullScreenAddress,
  getDashboardFullScreenLinkQuery,
  isDashboardFullScreenInSearch,
  isDashboardFullScreenView,
} from "../../../Utils/Dashboard/DashboardFullScreenLink";
import { describe, expect, test } from "@jest/globals";

describe("the parameter", () => {
  test("is ?view=full-screen", () => {
    expect(DASHBOARD_VIEW_LINK_PARAMETER).toBe("view");
    expect(DASHBOARD_FULL_SCREEN_VIEW).toBe("full-screen");
    expect(getDashboardFullScreenLinkQuery()).toEqual({
      view: "full-screen",
    });
  });
});

describe("reading a value", () => {
  test.each([
    "full-screen",
    "FULL-SCREEN",
    "Full-Screen",
    " full-screen ",
    "fullscreen",
    "FullScreen",
    "full_screen",
  ])("names the full-screen view: %p", (value: string) => {
    expect(isDashboardFullScreenView(value)).toBe(true);
  });

  test.each(["", "full", "screen", "full screen", "kiosk", "tv", "1", "true"])(
    "names no full-screen view: %p",
    (value: string) => {
      expect(isDashboardFullScreenView(value)).toBe(false);
    },
  );

  test("anything but a string names none", () => {
    for (const value of [undefined, null, 1, true, {}, ["full-screen"]]) {
      expect(isDashboardFullScreenView(value)).toBe(false);
    }
  });
});

describe("reading an address", () => {
  test("finds the view beside the dashboard's other parameters, with or without its ?", () => {
    expect(
      isDashboardFullScreenInSearch(
        "?range=1d&view=full-screen&refresh=1m&var-service=checkout",
      ),
    ).toBe(true);
    expect(isDashboardFullScreenInSearch("view=fullscreen")).toBe(true);
    expect(isDashboardFullScreenInSearch("?view=Full_Screen")).toBe(true);
  });

  test("an address without it, or with another view, is not full screen", () => {
    expect(isDashboardFullScreenInSearch("")).toBe(false);
    expect(isDashboardFullScreenInSearch("?")).toBe(false);
    expect(isDashboardFullScreenInSearch("?range=1d&refresh=1m")).toBe(false);
    expect(isDashboardFullScreenInSearch("?view=kiosk")).toBe(false);
    // Another parameter holding the word is not the view.
    expect(isDashboardFullScreenInSearch("?var-view=full-screen")).toBe(false);
    expect(isDashboardFullScreenInSearch("?fullscreen=true")).toBe(false);
  });

  test("the view named twice, once full screen, is full screen", () => {
    expect(isDashboardFullScreenInSearch("?view=kiosk&view=full-screen")).toBe(
      true,
    );
  });

  test("an escaped value is read as it was meant", () => {
    expect(isDashboardFullScreenInSearch("?view=full%2Dscreen")).toBe(true);
  });
});

describe("writing an address", () => {
  test("puts the view in, after what the address already names", () => {
    expect(
      applyDashboardFullScreenToSearch(
        "?range=1d&refresh=1m&var-service=checkout",
        true,
      ),
    ).toBe("range=1d&refresh=1m&var-service=checkout&view=full-screen");
  });

  test("on an address with nothing, it is the only parameter", () => {
    expect(applyDashboardFullScreenToSearch("", true)).toBe("view=full-screen");
    expect(applyDashboardFullScreenToSearch("?", true)).toBe(
      "view=full-screen",
    );
  });

  test("writes it one way, whatever spelling the address had", () => {
    expect(applyDashboardFullScreenToSearch("?view=FullScreen", true)).toBe(
      "view=full-screen",
    );
  });

  test("putting it in twice leaves it named once", () => {
    const once: string = applyDashboardFullScreenToSearch("?range=1d", true);

    expect(applyDashboardFullScreenToSearch(once, true)).toBe(once);
  });

  test("takes it out, and only it", () => {
    expect(
      applyDashboardFullScreenToSearch(
        "?range=1d&view=full-screen&refresh=1m&var-service=checkout",
        false,
      ),
    ).toBe("range=1d&refresh=1m&var-service=checkout");
  });

  test("takes out every spelling of it", () => {
    expect(
      applyDashboardFullScreenToSearch(
        "?view=fullscreen&range=1d&view=FULL_SCREEN",
        false,
      ),
    ).toBe("range=1d");
  });

  test("leaves the address empty when it was all there was", () => {
    expect(applyDashboardFullScreenToSearch("?view=full-screen", false)).toBe(
      "",
    );
  });

  test("an address without it is left exactly as it was", () => {
    expect(
      applyDashboardFullScreenToSearch("?var-service=checkout&range=1d", false),
    ).toBe("var-service=checkout&range=1d");
    expect(applyDashboardFullScreenToSearch("", false)).toBe("");
  });

  test("another view the address names is not ours to take away", () => {
    expect(applyDashboardFullScreenToSearch("?view=kiosk", false)).toBe(
      "view=kiosk",
    );
    expect(
      applyDashboardFullScreenToSearch("?view=kiosk&view=full-screen", false),
    ).toBe("view=kiosk");
  });

  test("a variable's value with spaces or a comma keeps them", () => {
    expect(
      applyDashboardFullScreenToSearch(
        "?var-region=us%20east&var-pods=a%2Cb",
        true,
      ),
    ).toBe("var-region=us+east&var-pods=a%2Cb&view=full-screen");
  });
});

describe("the whole address", () => {
  test("keeps the path and the fragment, the view put in", () => {
    expect(
      getDashboardFullScreenAddress(
        {
          pathname: "/dashboard/p/dashboards/d",
          search: "?range=1d",
          hash: "#top",
        },
        true,
      ),
    ).toBe("/dashboard/p/dashboards/d?range=1d&view=full-screen#top");
  });

  test("taken out, an address with nothing left has no ?", () => {
    expect(
      getDashboardFullScreenAddress(
        { pathname: "/dashboard/p/dashboards/d", search: "?view=full-screen" },
        false,
      ),
    ).toBe("/dashboard/p/dashboards/d");
  });
});
