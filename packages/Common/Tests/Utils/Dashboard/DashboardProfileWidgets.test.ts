import { describe, expect, test } from "@jest/globals";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardProfileFlameGraphComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProfileFlameGraphComponent";
import DashboardProfileTopFunctionsComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProfileTopFunctionsComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES,
  getPublicDashboardWidgetSettings,
  getPublicDashboardWidgetSettingsDecision,
  isPublicDashboardUndrawnWidgetType,
} from "../../../Types/Dashboard/PublicDashboardServedSettings";
import { ObjectType } from "../../../Types/JSON";
import DashboardComponentsUtil from "../../../Utils/Dashboard/Components/Index";
import DashboardProfileFlameGraphComponentUtil from "../../../Utils/Dashboard/Components/DashboardProfileFlameGraphComponent";
import DashboardProfileTopFunctionsComponentUtil from "../../../Utils/Dashboard/Components/DashboardProfileTopFunctionsComponent";
import {
  PROFILE_WIDGET_DATA_SECTION,
  PROFILE_WIDGET_DEFAULT_KIND,
  PROFILE_WIDGET_DEFAULT_RANK,
  PROFILE_WIDGET_DEFAULT_ROWS,
  PROFILE_WIDGET_DISPLAY_SECTION,
  PROFILE_WIDGET_KINDS,
  PROFILE_WIDGET_KIND_OPTIONS,
  PROFILE_WIDGET_MAX_ROWS,
  PROFILE_WIDGET_RANKS,
  PROFILE_WIDGET_RANK_OPTIONS,
  readProfileWidgetKind,
  readProfileWidgetRank,
  readProfileWidgetRows,
  readProfileWidgetServiceId,
} from "../../../Utils/Dashboard/Components/DashboardProfileWidgetShared";
import {
  DEFAULT_PROFILE_CATEGORY,
  ProfileCategory,
} from "../../../Utils/Profiles/ProfileTypes";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * THE DASHBOARD'S PROFILE WIDGETS: WHAT THEY ARE SEEDED WITH, WHAT THEIR
 * SETTINGS OFFER, AND HOW A STORED SETTING IS READ.
 *
 * A widget's settings are JSON anyone can write - the editor, the API,
 * Terraform, a workflow - so every reader settles what it is handed: a kind,
 * a ranking, a row count or a service id this version does not know reads as
 * the default, never as a request the server would refuse. A public
 * dashboard draws neither widget, and is served nothing of what they read.
 */

const CHECKOUT: string = "60000000-0000-4000-8000-0000000000a1";

function argumentIds(
  componentArguments: Array<ComponentArgument<DashboardBaseComponent>>,
): Array<string> {
  return componentArguments.map(
    (argument: ComponentArgument<DashboardBaseComponent>): string => {
      return String(argument.id);
    },
  );
}

describe("the Flame Graph widget", () => {
  test("is seeded as the board's full width, four rows high, reading CPU time", () => {
    const component: DashboardProfileFlameGraphComponent =
      DashboardProfileFlameGraphComponentUtil.getDefaultComponent();

    expect(component._type).toBe(ObjectType.DashboardComponent);
    expect(component.componentType).toBe(
      DashboardComponentType.ProfileFlameGraph,
    );
    expect(component.widthInDashboardUnits).toBe(12);
    expect(component.heightInDashboardUnits).toBe(4);
    expect(component.minWidthInDashboardUnits).toBe(6);
    expect(component.minHeightInDashboardUnits).toBe(3);
    expect(component.arguments).toEqual({ profileKind: ProfileCategory.Cpu });
    // No service pinned: every profiled service, or the toolbar's pick.
    expect(component.arguments.serviceId).toBeUndefined();
  });

  test("offers whose profiles, what to analyze, then a title", () => {
    const componentArguments: Array<
      ComponentArgument<DashboardProfileFlameGraphComponent>
    > = DashboardProfileFlameGraphComponentUtil.getComponentConfigArguments();

    expect(
      componentArguments.map(
        (
          argument: ComponentArgument<DashboardProfileFlameGraphComponent>,
        ) => {
          return [argument.id, argument.type, argument.required];
        },
      ),
    ).toEqual([
      ["serviceId", ComponentInputType.ProfiledService, false],
      ["profileKind", ComponentInputType.Dropdown, true],
      ["title", ComponentInputType.Text, false],
    ]);

    expect(componentArguments[0]?.section).toBe(PROFILE_WIDGET_DATA_SECTION);
    expect(componentArguments[1]?.section).toBe(PROFILE_WIDGET_DATA_SECTION);
    expect(componentArguments[2]?.section).toBe(
      PROFILE_WIDGET_DISPLAY_SECTION,
    );
    expect(componentArguments[1]?.dropdownOptions).toEqual([
      ...PROFILE_WIDGET_KIND_OPTIONS,
    ]);
  });

  test("is found through the settings registry", () => {
    expect(
      argumentIds(
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.ProfileFlameGraph,
        ),
      ),
    ).toEqual(["serviceId", "profileKind", "title"]);
  });
});

describe("the Top Functions widget", () => {
  test("is seeded half the board wide, six rows high, ten functions by Self", () => {
    const component: DashboardProfileTopFunctionsComponent =
      DashboardProfileTopFunctionsComponentUtil.getDefaultComponent();

    expect(component._type).toBe(ObjectType.DashboardComponent);
    expect(component.componentType).toBe(
      DashboardComponentType.ProfileTopFunctions,
    );
    expect(component.widthInDashboardUnits).toBe(6);
    expect(component.heightInDashboardUnits).toBe(6);
    expect(component.minWidthInDashboardUnits).toBe(4);
    expect(component.minHeightInDashboardUnits).toBe(3);
    expect(component.arguments).toEqual({
      profileKind: ProfileCategory.Cpu,
      rankBy: "self",
      maxRows: 10,
    });
  });

  test("offers whose profiles, what to analyze, the ranking and the rows, then a title", () => {
    const componentArguments: Array<
      ComponentArgument<DashboardProfileTopFunctionsComponent>
    > = DashboardProfileTopFunctionsComponentUtil.getComponentConfigArguments();

    expect(
      componentArguments.map(
        (
          argument: ComponentArgument<DashboardProfileTopFunctionsComponent>,
        ) => {
          return [argument.id, argument.type, argument.required];
        },
      ),
    ).toEqual([
      ["serviceId", ComponentInputType.ProfiledService, false],
      ["profileKind", ComponentInputType.Dropdown, true],
      ["rankBy", ComponentInputType.Dropdown, true],
      ["maxRows", ComponentInputType.Number, false],
      ["title", ComponentInputType.Text, false],
    ]);

    expect(
      componentArguments.find(
        (
          argument: ComponentArgument<DashboardProfileTopFunctionsComponent>,
        ) => {
          return argument.id === "rankBy";
        },
      )?.dropdownOptions,
    ).toEqual([...PROFILE_WIDGET_RANK_OPTIONS]);

    expect(
      componentArguments.find(
        (
          argument: ComponentArgument<DashboardProfileTopFunctionsComponent>,
        ) => {
          return argument.id === "maxRows";
        },
      )?.placeholder,
    ).toBe("10");
  });

  test("is found through the settings registry", () => {
    expect(
      argumentIds(
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.ProfileTopFunctions,
        ),
      ),
    ).toEqual(["serviceId", "profileKind", "rankBy", "maxRows", "title"]);
  });
});

describe("both widgets' settings", () => {
  test("read the data first, then how the widget looks", () => {
    expect(PROFILE_WIDGET_DATA_SECTION.order).toBeLessThan(
      PROFILE_WIDGET_DISPLAY_SECTION.order,
    );
    // The section the settings dialog draws its query editors in, by name.
    expect(PROFILE_WIDGET_DATA_SECTION.name).toBe("Data Source");
  });

  test("offer every kind of profile but Other, CPU time first and by default", () => {
    expect([...PROFILE_WIDGET_KINDS]).toEqual([
      ProfileCategory.Cpu,
      ProfileCategory.Wall,
      ProfileCategory.Memory,
      ProfileCategory.Allocations,
      ProfileCategory.Locks,
      ProfileCategory.Goroutines,
    ]);
    expect(PROFILE_WIDGET_DEFAULT_KIND).toBe(DEFAULT_PROFILE_CATEGORY);

    for (const option of PROFILE_WIDGET_KIND_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect((option.description || "").length).toBeGreaterThan(0);
    }
  });

  test("offer the Profiler's three rankings, Self by default", () => {
    expect([...PROFILE_WIDGET_RANKS]).toEqual(["self", "total", "own"]);
    expect(PROFILE_WIDGET_DEFAULT_RANK).toBe("self");
    expect(
      PROFILE_WIDGET_RANK_OPTIONS.map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual(["self", "total", "own"]);
  });
});

describe("a stored setting, as both widgets read it", () => {
  test("a kind is one of the kinds, whatever its case or spaces", () => {
    expect(readProfileWidgetKind("memory")).toBe(ProfileCategory.Memory);
    expect(readProfileWidgetKind(" Locks ")).toBe(ProfileCategory.Locks);
    expect(readProfileWidgetKind("GOROUTINES")).toBe(
      ProfileCategory.Goroutines,
    );
  });

  test("anything else is CPU time: nothing, Other, a raw type, a misspelling, another type", () => {
    for (const value of [
      undefined,
      null,
      "",
      "other",
      "alloc_objects",
      "memroy",
      7,
      { kind: "memory" },
      ["memory"],
    ]) {
      expect(readProfileWidgetKind(value)).toBe(ProfileCategory.Cpu);
    }
  });

  test("a ranking is Self, Total or Your code, and Self for anything else", () => {
    expect(readProfileWidgetRank("total")).toBe("total");
    expect(readProfileWidgetRank(" OWN ")).toBe("own");

    for (const value of [undefined, "", "selfValue", "ownValue", 1, null]) {
      expect(readProfileWidgetRank(value)).toBe("self");
    }
  });

  test("rows are a whole number from 1 to 50, as a number or as text", () => {
    expect(readProfileWidgetRows(25)).toBe(25);
    expect(readProfileWidgetRows("25")).toBe(25);
    expect(readProfileWidgetRows(" 7 ")).toBe(7);
    expect(readProfileWidgetRows(7.9)).toBe(7);
    expect(readProfileWidgetRows(1)).toBe(1);
    expect(readProfileWidgetRows(50)).toBe(50);
    expect(readProfileWidgetRows(51)).toBe(PROFILE_WIDGET_MAX_ROWS);
    expect(readProfileWidgetRows(100000)).toBe(50);
  });

  test("rows that are none, zero, negative or no number are ten", () => {
    for (const value of [
      undefined,
      null,
      "",
      "  ",
      0,
      -3,
      0.5,
      "ten",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
    ]) {
      expect(readProfileWidgetRows(value)).toBe(PROFILE_WIDGET_DEFAULT_ROWS);
    }
  });

  test("a service is an id, trimmed; anything else pins no service", () => {
    expect(readProfileWidgetServiceId(CHECKOUT)).toBe(CHECKOUT);
    expect(readProfileWidgetServiceId(` ${CHECKOUT} `)).toBe(CHECKOUT);

    for (const value of [
      undefined,
      null,
      "",
      "checkout",
      "service-1",
      42,
      [CHECKOUT],
    ]) {
      expect(readProfileWidgetServiceId(value)).toBeNull();
    }
  });
});

describe("on a public dashboard", () => {
  test("neither widget is drawn: each says so in its place", () => {
    expect(PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES).toContain(
      DashboardComponentType.ProfileFlameGraph,
    );
    expect(PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES).toContain(
      DashboardComponentType.ProfileTopFunctions,
    );
    expect(
      isPublicDashboardUndrawnWidgetType(
        DashboardComponentType.ProfileFlameGraph,
      ),
    ).toBe(true);
    expect(isPublicDashboardUndrawnWidgetType(" ProfileFlameGraph ")).toBe(
      false,
    );
  });

  test("each is served its title alone: never whose profiles it reads, or how", () => {
    expect(
      getPublicDashboardWidgetSettingsDecision(
        DashboardComponentType.ProfileFlameGraph,
      ),
    ).toEqual({ served: ["title"], withheld: ["serviceId", "profileKind"] });

    expect(
      getPublicDashboardWidgetSettingsDecision(
        DashboardComponentType.ProfileTopFunctions,
      ),
    ).toEqual({
      served: ["title"],
      withheld: ["serviceId", "profileKind", "rankBy", "maxRows"],
    });

    expect(
      getPublicDashboardWidgetSettings(
        DashboardComponentType.ProfileTopFunctions,
        {
          title: "Checkout hot paths",
          serviceId: CHECKOUT,
          profileKind: "memory",
          rankBy: "own",
          maxRows: 25,
          leftOver: "never served",
        },
      ),
    ).toEqual({ title: "Checkout hot paths" });
  });
});
