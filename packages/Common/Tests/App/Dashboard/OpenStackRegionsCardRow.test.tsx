/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  describeControl,
  findNestedControls,
} from "../../Helpers/NestedControls";

/*
 * AN OPENSTACK REGION'S HEALTH OPENS WHY, AND ITS ROW STAYS ONE THING TO
 * EACH READER (#9728).
 *
 * The Regions card drew each region's "Degraded" inside the row's link,
 * with its (i) - a button - inside that link too: a control inside a
 * control, which a screen reader reads as the link's name and nothing else,
 * and which a pill that opens why could not be. The row is now a box whose
 * name is its link, stretched over the row so a press anywhere still opens
 * the region, and whose pill and (i) sit beside the name, above the stretch.
 * These tests pin that, rendered: no control inside another, the link named
 * by the region and described by its facts, the pill a button of its own
 * that opens the region's parts and why without leaving the page, and the
 * Tab order a keyboard meets.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
      isOnThisPage: (): boolean => {
        return false;
      },
      getQueryStringByName: (): null => {
        return null;
      },
    },
  };
});

import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import { OpenStackRegionSummary } from "../../../Types/OpenStack/OpenStackOverview";
import OpenStackRegionsCard, {
  OPENSTACK_REGION_HEALTH_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRegionsCard";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  RESOURCE_PART_ROW_CONTROLS_CLASS_NAME,
  RESOURCE_PART_ROW_NAME_LINK_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartRow";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  navigateMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function region(
  regionName: string,
  fields: Partial<OpenStackRegionSummary> = {},
): OpenStackRegionSummary {
  return {
    regionName: regionName,
    apiCount: 2,
    downApiCount: 0,
    serviceCount: 4,
    downServiceCount: 0,
    hypervisorCount: 3,
    instanceCount: 12,
    vcpuCapacity: 100,
    vcpuAllocated: 40,
    memoryCapacityBytes: 0,
    memoryAllocatedBytes: 0,
    storageCapacityBytes: 0,
    storageUsedBytes: 0,
    ...fields,
  };
}

const REGIONS: Array<OpenStackRegionSummary> = [
  region("RegionOne"),
  region("RegionTwo", { downServiceCount: 1 }),
  region("RegionThree", { downApiCount: 1 }),
];

const HEALTH: Record<string, ResourceHealth> = {
  RegionOne: "Healthy",
  RegionTwo: "Degraded",
  RegionThree: "Unhealthy",
};

const ATTENTION: Record<string, Array<ResourceAttentionItem>> = {
  RegionOne: [],
  RegionTwo: [
    {
      key: "Service:nova-scheduler@ctl-2",
      kind: "Service",
      icon: IconProp.Cog,
      name: "nova-scheduler on ctl-2",
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: "Down" }],
      route: new Route("/openstack/services/nova-scheduler@ctl-2"),
    },
  ],
  RegionThree: [
    {
      key: "Api:compute@RegionThree",
      kind: "API",
      icon: IconProp.Globe,
      name: "compute",
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: "Down" }],
      route: new Route("/openstack/apis/compute"),
    },
  ],
};

function regionRoute(regionName: string): Route {
  return new Route(`/openstack/cloud/overview`).addQueryParams({
    region: regionName,
  });
}

function renderCard(selectedRegion: string | null = "RegionTwo"): RenderResult {
  return render(
    <OpenStackRegionsCard
      regions={REGIONS}
      healthByRegion={HEALTH}
      attentionByRegion={ATTENTION}
      selectedRegion={selectedRegion}
      getRegionRoute={regionRoute}
    />,
  );
}

function rowOf(regionName: string): HTMLElement {
  return screen
    .getAllByTestId("openstack-regions-card-item")
    .find((item: HTMLElement): boolean => {
      return item.getAttribute("data-region") === regionName;
    })!;
}

describe("a region's row on the Regions card", () => {
  test("no control is drawn inside another: the (i) and the pill sit beside the link", () => {
    const { container } = renderCard();

    expect(
      findNestedControls(container).map(
        (nesting: { inner: Element; outer: Element }): string => {
          return `${describeControl(nesting.inner)} in ${describeControl(nesting.outer)}`;
        },
      ),
    ).toEqual([]);

    for (const regionName of ["RegionOne", "RegionTwo", "RegionThree"]) {
      const row: HTMLElement = rowOf(regionName);
      // One link per row, and every button outside it.
      expect(within(row).getAllByRole("link")).toHaveLength(1);
      for (const button of within(row).queryAllByRole("button")) {
        expect(button.closest("a")).toBeNull();
      }
    }
  });

  test("its link is named by the region, described by its facts, and opens the region", () => {
    renderCard();

    const link: HTMLElement = screen.getByRole("link", { name: "RegionTwo" });
    expect(link).toHaveAttribute("href", regionRoute("RegionTwo").toString());
    // What the row says besides its name is read after it, not lost.
    const factsId: string = link.getAttribute("aria-describedby") || "";
    expect(factsId).not.toBe("");
    const facts: HTMLElement = document.getElementById(factsId)!;
    expect(facts).toHaveAttribute(
      "data-testid",
      "openstack-regions-card-facts",
    );
    expect(facts).toHaveTextContent("1 worker down");
    expect(
      within(rowOf("RegionTwo")).getByTestId("openstack-regions-card-facts"),
    ).toBe(facts);
  });

  test("the region the page reads says so on its link", () => {
    renderCard("RegionTwo");

    expect(screen.getByRole("link", { name: "RegionTwo" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "RegionOne" })).not.toHaveAttribute(
      "aria-current",
    );
    // Its row keeps the tint it had.
    expect(rowOf("RegionTwo")).toHaveClass("bg-indigo-50");
  });

  test("the link is stretched over the whole row, which keeps its look; the controls sit above it", () => {
    renderCard();

    const row: HTMLElement = rowOf("RegionTwo");
    const link: HTMLElement = within(row).getByRole("link");
    // A press anywhere on the row opens the region, and a keyboard's ring draws round it.
    for (const className of RESOURCE_PART_ROW_NAME_LINK_CLASS_NAME.split(" ")) {
      expect(link).toHaveClass(className);
    }
    expect(link).toHaveClass("after:absolute");
    expect(link).toHaveClass("after:inset-0");
    expect(link).toHaveClass("focus-visible:after:ring-2");

    // The box the stretch covers: placed, tinted under the pointer, a chevron at its end.
    const box: HTMLElement = link.closest("div.relative") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box).toHaveClass("hover:bg-gray-50");
    // Its chevron is a picture, never read.
    expect(
      box.lastElementChild?.querySelector("svg")?.getAttribute("aria-hidden"),
    ).toBe("true");

    /*
     * The controls: placed, after the link, and no stacking context of their own,
     * so the dialog the pill opens is painted over the rows after it.
     */
    const pill: HTMLElement = within(row).getByTestId(
      "openstack-regions-card-health",
    );
    const controls: HTMLElement = pill.parentElement as HTMLElement;
    expect(RESOURCE_PART_ROW_CONTROLS_CLASS_NAME).toBe("relative");
    expect(controls).toHaveClass("relative");
    expect(controls.className).not.toMatch(/(^|\s)z-/);
    expect(
      link.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a keyboard meets each region's link, then its pill when it opens why, then its (i)", () => {
    renderCard();

    // Tab follows the page's order: nothing here sets a tabindex of its own.
    const stops: Array<string> = Array.from(
      document.querySelectorAll("a[href], button"),
    ).map((control: Element): string => {
      if (control.tagName === "A") {
        return `link ${control.textContent}`;
      }
      const label: string | null = control.getAttribute("aria-label");
      return label ? `button ${label}` : `button ${control.textContent}`;
    });
    expect(stops).toEqual([
      "link RegionOne",
      "button About Region health",
      "link RegionTwo",
      "button Degraded",
      "button About Region health",
      "link RegionThree",
      "button Unhealthy",
      "button About Region health",
    ]);
    for (const control of Array.from(
      document.querySelectorAll("a[href], button"),
    )) {
      expect(control.getAttribute("tabindex")).toBeNull();
    }
  });

  test("Degraded is a button that opens the region's parts and why, and leaves the page where it is", () => {
    renderCard();

    const pill: HTMLElement = within(rowOf("RegionTwo")).getByTestId(
      "openstack-regions-card-health",
    );
    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveAttribute("type", "button");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(pill).toHaveAttribute("data-health", "Degraded");
    expect(pill).toHaveAttribute("data-tone", "warning");
    expect(pill).toHaveAccessibleDescription("Show why");

    fireEvent.click(pill);

    expect(pill).toHaveAttribute("aria-expanded", "true");
    // Its title says whose health it is.
    expect(
      screen.getByText("Why region RegionTwo is Degraded"),
    ).toBeInTheDocument();
    const items: Array<HTMLElement> = screen.getAllByTestId(
      "openstack-regions-card-health-dialog-item",
    );
    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("data-key");
      }),
    ).toEqual(["Service:nova-scheduler@ctl-2"]);
    expect(items[0]).toHaveTextContent("nova-scheduler on ctl-2");
    expect(
      within(items[0]!).getByTestId(
        "openstack-regions-card-health-dialog-view",
      ),
    ).toHaveAttribute("href", "/openstack/services/nova-scheduler@ctl-2");
    // The press opened the dialog and nothing else: no step to the region.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("Unhealthy opens its own region's parts, in red", () => {
    renderCard();

    const pill: HTMLElement = within(rowOf("RegionThree")).getByTestId(
      "openstack-regions-card-health",
    );
    expect(pill).toHaveAttribute("data-tone", "danger");
    fireEvent.click(pill);

    expect(
      screen.getByText("Why region RegionThree is Unhealthy"),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("openstack-regions-card-health-dialog-item")
        .map((item: HTMLElement): string | null => {
          return item.getAttribute("data-key");
        }),
    ).toEqual(["Api:compute@RegionThree"]);
  });

  test("Healthy is a word: nothing to open, and no button", () => {
    renderCard();

    const pill: HTMLElement = within(rowOf("RegionOne")).getByTestId(
      "openstack-regions-card-health",
    );
    expect(pill.tagName).toBe("SPAN");
    expect(pill).toHaveTextContent("Healthy");
    expect(pill).toHaveAttribute("data-tone", "positive");
  });

  test("a region whose health is not known yet draws no pill and no (i), and its row is still its link", () => {
    render(
      <OpenStackRegionsCard
        regions={REGIONS}
        healthByRegion={{}}
        attentionByRegion={{}}
        selectedRegion={null}
        getRegionRoute={regionRoute}
      />,
    );

    expect(screen.queryByTestId("openstack-regions-card-health")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  test("the dialog's title is the region's, in the reader's words, its name as written", () => {
    expect(OPENSTACK_REGION_HEALTH_WORDS.degradedTitle).toBe(
      "Why region {{name}} is Degraded",
    );
    expect(OPENSTACK_REGION_HEALTH_WORDS.unhealthyTitle).toBe(
      "Why region {{name}} is Unhealthy",
    );
  });
});
