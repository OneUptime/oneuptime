/** @timezone UTC */

import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardClockComponent, {
  ClockWidgetFace,
  ClockWidgetHourFormat,
} from "../../../Types/Dashboard/DashboardComponents/DashboardClockComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import DashboardClockComponentUtil from "../../../Utils/Dashboard/Components/DashboardClockComponent";
import DashboardComponentsUtil from "../../../Utils/Dashboard/Components/Index";
import {
  ClockWidgetDisplay,
  getClockWidgetDisplay,
  isSupportedClockTimezone,
} from "../../../Utils/Dashboard/ClockWidgetFormat";

type ArgumentIds = keyof DashboardClockComponent["arguments"];

function getArguments(): Array<ComponentArgument<DashboardClockComponent>> {
  return DashboardClockComponentUtil.getComponentConfigArguments();
}

function getArgumentById(
  id: ArgumentIds,
): ComponentArgument<DashboardClockComponent> {
  const found: ComponentArgument<DashboardClockComponent> | undefined =
    getArguments().find((arg: ComponentArgument<DashboardClockComponent>) => {
      return arg.id === id;
    });

  if (!found) {
    throw new Error(`No Clock widget argument declared with id "${id}"`);
  }

  return found;
}

describe("DashboardClockComponentUtil", () => {
  describe("getDefaultComponent", () => {
    it("declares its componentType as Clock so the renderer dispatch matches", () => {
      expect(
        DashboardClockComponentUtil.getDefaultComponent().componentType,
      ).toBe(DashboardComponentType.Clock);
    });

    it("marks itself as a dashboard component so it survives config serialization", () => {
      expect(DashboardClockComponentUtil.getDefaultComponent()._type).toBe(
        ObjectType.DashboardComponent,
      );
    });

    it("defaults to a 3x3 tile placed at the canvas origin", () => {
      const component: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();

      expect(component.widthInDashboardUnits).toBe(3);
      expect(component.heightInDashboardUnits).toBe(3);
      expect(component.topInDashboardUnits).toBe(0);
      expect(component.leftInDashboardUnits).toBe(0);
    });

    it("declares a minimum no larger than its default size", () => {
      const component: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();

      expect(component.minWidthInDashboardUnits).toBeLessThanOrEqual(
        component.widthInDashboardUnits,
      );
      expect(component.minHeightInDashboardUnits).toBeLessThanOrEqual(
        component.heightInDashboardUnits,
      );
    });

    it("can be squeezed down to a single-row strip for a header of clocks", () => {
      const component: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();

      expect(component.minHeightInDashboardUnits).toBe(1);
      expect(component.minWidthInDashboardUnits).toBe(2);
    });

    it("fits within the dashboard's 12-unit width", () => {
      const component: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();

      expect(component.widthInDashboardUnits).toBeLessThanOrEqual(12);
    });

    it("leaves the timezone blank so a freshly dropped clock shows the viewer's own time", () => {
      expect(
        DashboardClockComponentUtil.getDefaultComponent().arguments.timezone,
      ).toBe("");
    });

    it("defaults to a digital face on the viewer's own time format", () => {
      const component: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();

      expect(component.arguments.clockFace).toBe(ClockWidgetFace.Digital);
      expect(component.arguments.hourFormat).toBe(ClockWidgetHourFormat.Auto);
    });

    it("shows the date and zone but not seconds by default", () => {
      const component: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();

      expect(component.arguments.showDate).toBe(true);
      expect(component.arguments.showTimezoneAbbreviation).toBe(true);
      expect(component.arguments.showSeconds).toBe(false);
    });

    it("gives every new clock its own component id", () => {
      const first: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();
      const second: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();

      expect(first.componentId.toString()).not.toBe(
        second.componentId.toString(),
      );
    });

    it("renders a real time straight out of the box, before any configuration", () => {
      const component: DashboardClockComponent =
        DashboardClockComponentUtil.getDefaultComponent();

      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: new Date("2026-08-03T18:07:09.500Z"),
        timezone: component.arguments.timezone,
        label: component.arguments.label,
        hourFormat: component.arguments.hourFormat,
        showSeconds: component.arguments.showSeconds,
        showDate: component.arguments.showDate,
        showTimezoneAbbreviation: component.arguments.showTimezoneAbbreviation,
      });

      expect(display.time).toMatch(/^\d{1,2}:\d{2}$/);
      expect(display.label.length).toBeGreaterThan(0);
      expect(display.dateText).not.toBeNull();
      expect(display.zoneAbbreviation).not.toBeNull();
      expect(display.seconds).toBeNull();
      // A blank zone is a deliberate "use the viewer's", not a broken config.
      expect(display.isFallbackTimezone).toBe(false);
    });
  });

  describe("getComponentConfigArguments", () => {
    it("exposes exactly the arguments the widget interface declares", () => {
      const ids: Array<unknown> = getArguments().map(
        (arg: ComponentArgument<DashboardClockComponent>): unknown => {
          return arg.id;
        },
      );

      expect(ids.sort()).toEqual(
        [
          "clockFace",
          "hourFormat",
          "label",
          "showDate",
          "showSeconds",
          "showTimezoneAbbreviation",
          "timezone",
        ].sort(),
      );
    });

    it("gives every argument a name and a description for the settings form", () => {
      for (const arg of getArguments()) {
        expect(arg.name.length).toBeGreaterThan(0);
        expect(arg.description.length).toBeGreaterThan(0);
      }
    });

    it("puts every argument in a section so none float above the form", () => {
      for (const arg of getArguments()) {
        expect(arg.section).toBeDefined();
        expect(arg.section?.name.length).toBeGreaterThan(0);
      }
    });

    it("orders the timezone section ahead of the display options", () => {
      const timezoneOrder: number =
        getArgumentById("timezone").section?.order ?? 0;
      const clockFaceOrder: number =
        getArgumentById("clockFace").section?.order ?? 0;

      expect(timezoneOrder).toBeLessThan(clockFaceOrder);
    });

    it("requires nothing, because an unconfigured clock is already useful", () => {
      for (const arg of getArguments()) {
        expect(arg.required).toBe(false);
      }
    });

    it("gives every dropdown a non-empty option list", () => {
      const dropdowns: Array<ComponentArgument<DashboardClockComponent>> =
        getArguments().filter(
          (arg: ComponentArgument<DashboardClockComponent>): boolean => {
            return arg.type === ComponentInputType.Dropdown;
          },
        );

      expect(dropdowns.length).toBeGreaterThan(0);

      for (const arg of dropdowns) {
        expect(arg.dropdownOptions?.length).toBeGreaterThan(0);
      }
    });

    describe("timezone argument", () => {
      it("is a dropdown rather than free text, so no one can type an invalid zone", () => {
        expect(getArgumentById("timezone").type).toBe(
          ComponentInputType.Dropdown,
        );
      });

      it("offers the whole IANA catalogue", () => {
        expect(
          getArgumentById("timezone").dropdownOptions?.length,
        ).toBeGreaterThan(100);
      });

      it("offers only zones the widget can actually resolve", () => {
        const options: Array<DropdownOption> =
          getArgumentById("timezone").dropdownOptions || [];

        for (const option of options) {
          expect(isSupportedClockTimezone(String(option.value))).toBe(true);
        }
      });

      it("labels each zone with its GMT offset so the list is scannable", () => {
        const options: Array<DropdownOption> =
          getArgumentById("timezone").dropdownOptions || [];

        for (const option of options) {
          expect(String(option.label)).toMatch(/^GMT[+-]/);
        }
      });

      it("tells the author that leaving it blank means the viewer's zone", () => {
        expect(getArgumentById("timezone").placeholder).toBe(
          "Viewer's timezone",
        );
      });

      it("builds the option list once and reuses it, so typing in the form stays fast", () => {
        /*
         * ArgumentsForm re-derives the arguments on every render — i.e. on
         * every keystroke — and this list costs a ~556-entry sort with two
         * moment.tz() calls per comparison. Same array identity proves the
         * module-level cache is doing its job.
         */
        expect(getArgumentById("timezone").dropdownOptions).toBe(
          getArgumentById("timezone").dropdownOptions,
        );
      });
    });

    describe("clockFace argument", () => {
      it("offers exactly the faces the renderer knows how to draw", () => {
        const values: Array<unknown> = (
          getArgumentById("clockFace").dropdownOptions || []
        ).map((option: DropdownOption): unknown => {
          return option.value;
        });

        expect(values).toEqual(
          Object.values(ClockWidgetFace) as Array<unknown>,
        );
      });
    });

    describe("hourFormat argument", () => {
      it("offers exactly the formats the resolver handles", () => {
        const values: Array<unknown> = (
          getArgumentById("hourFormat").dropdownOptions || []
        ).map((option: DropdownOption): unknown => {
          return option.value;
        });

        expect(values).toEqual(
          Object.values(ClockWidgetHourFormat) as Array<unknown>,
        );
      });

      it("leads with Auto, which is also the default", () => {
        expect(getArgumentById("hourFormat").dropdownOptions?.[0]?.value).toBe(
          ClockWidgetHourFormat.Auto,
        );
      });
    });

    describe("toggles", () => {
      it("renders each show/hide option as a boolean toggle", () => {
        for (const id of [
          "showSeconds",
          "showDate",
          "showTimezoneAbbreviation",
        ] as Array<ArgumentIds>) {
          expect(getArgumentById(id).type).toBe(ComponentInputType.Boolean);
        }
      });

      it("renders the label as plain text", () => {
        expect(getArgumentById("label").type).toBe(ComponentInputType.Text);
      });
    });
  });

  /*
   * The registry is the seam between the widget and the settings form: a
   * widget that is not wired in throws BadDataException the moment its
   * settings panel opens.
   */
  describe("registration in DashboardComponentsUtil", () => {
    it("resolves DashboardComponentType.Clock instead of throwing for an unknown type", () => {
      expect(() => {
        return DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.Clock,
        );
      }).not.toThrow();
    });

    it("returns the Clock widget's own arguments for DashboardComponentType.Clock", () => {
      const fromRegistry: Array<ComponentArgument<DashboardBaseComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.Clock,
        );

      expect(
        fromRegistry.map(
          (arg: ComponentArgument<DashboardBaseComponent>): unknown => {
            return arg.id;
          },
        ),
      ).toEqual(
        getArguments().map(
          (arg: ComponentArgument<DashboardClockComponent>): unknown => {
            return arg.id;
          },
        ),
      );
    });

    it("still throws for a component type that is not registered", () => {
      expect(() => {
        return DashboardComponentsUtil.getComponentSettingsArguments(
          "NotARealWidget" as DashboardComponentType,
        );
      }).toThrow();
    });
  });
});
