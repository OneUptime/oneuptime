import { describe, expect, test } from "@jest/globals";
import DashboardMonitorListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardComponentsUtil from "../../../../Utils/Dashboard/Components/Index";
import DashboardMonitorListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardMonitorListComponent";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../../Types/JSON";
import {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "../../../../Types/Monitor/MonitorType";
import {
  MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS,
  MonitorStateTimelineTooltipFieldProps,
} from "../../../../Types/Dashboard/MonitorStateTimelineTooltipField";

/*
 * DashboardMonitorListComponentUtil is a pure factory with two
 * responsibilities: getDefaultComponent() produces the widget the editor
 * drops on the canvas when a user adds a "Monitor List", and
 * getComponentConfigArguments() declares the fields its settings form renders.
 *
 * Nothing here touches the network, a database, the clock, or Math.random —
 * componentId is the one non-deterministic field and comes from
 * ObjectID.generate(), which only needs to be distinct per call, never a
 * specific value. So this suite pins the machine-readable contract that the
 * rest of the dashboard silently depends on: the persisted argument `id`s and
 * their order, which editor each `type` renders, the exact dropdown `value`s
 * the rendering code later switches on, the entity-model bindings, and the
 * alphabetical monitor-type option list built from MonitorTypeHelper. If any
 * of those drift, the widget misbehaves at runtime with no compiler error to
 * catch it.
 */

type MonitorListArgument = ComponentArgument<DashboardMonitorListComponent>;

type ArgumentId = keyof DashboardMonitorListComponent["arguments"];

interface OptionShape {
  label: unknown;
  value: unknown;
}

/*
 * The declared argument ids, in the exact order the source pushes them. The
 * order is not cosmetic — it is the top-to-bottom field order of the settings
 * form.
 */
const EXPECTED_ARGUMENT_IDS: Array<ArgumentId> = [
  "title",
  "maxRows",
  "viewMode",
  "timelineTooltipFields",
  "statusFilter",
  "monitorStatusIds",
  "monitorTypes",
  "labelIds",
];

const DISPLAY_SECTION_ARGUMENT_IDS: Array<ArgumentId> = [
  "title",
  "maxRows",
  "viewMode",
  "timelineTooltipFields",
];

const FILTER_SECTION_ARGUMENT_IDS: Array<ArgumentId> = [
  "statusFilter",
  "monitorStatusIds",
  "monitorTypes",
  "labelIds",
];

const VALID_INPUT_TYPES: Set<string> = new Set<string>(
  Object.values(ComponentInputType),
);

function getArguments(): Array<MonitorListArgument> {
  return DashboardMonitorListComponentUtil.getComponentConfigArguments();
}

function getArgumentById(id: ArgumentId): MonitorListArgument {
  const found: MonitorListArgument | undefined = getArguments().find(
    (arg: MonitorListArgument) => {
      return arg.id === id;
    },
  );

  if (!found) {
    throw new Error(`No monitor-list argument declared with id "${id}"`);
  }

  return found;
}

function getOptions(id: ArgumentId): Array<OptionShape> {
  return (getArgumentById(id).dropdownOptions ?? []) as Array<OptionShape>;
}

describe("DashboardMonitorListComponentUtil", () => {
  describe("getDefaultComponent", () => {
    test("declares its componentType as MonitorList so the renderer dispatch matches", () => {
      expect(
        DashboardMonitorListComponentUtil.getDefaultComponent().componentType,
      ).toBe(DashboardComponentType.MonitorList);
    });

    test("marks itself as a dashboard component so it survives config serialization", () => {
      expect(
        DashboardMonitorListComponentUtil.getDefaultComponent()._type,
      ).toBe(ObjectType.DashboardComponent);
    });

    test("defaults to a 6x4 tile placed at the canvas origin", () => {
      const component: DashboardMonitorListComponent =
        DashboardMonitorListComponentUtil.getDefaultComponent();

      expect(component.widthInDashboardUnits).toBe(6);
      expect(component.heightInDashboardUnits).toBe(4);
      expect(component.topInDashboardUnits).toBe(0);
      expect(component.leftInDashboardUnits).toBe(0);
    });

    test("cannot be resized below its 6x3 minimum, and the minimum fits inside the default", () => {
      const component: DashboardMonitorListComponent =
        DashboardMonitorListComponentUtil.getDefaultComponent();

      expect(component.minWidthInDashboardUnits).toBe(6);
      expect(component.minHeightInDashboardUnits).toBe(3);

      /*
       * A minimum larger than the default size would make the widget
       * un-shrinkable from the moment it is dropped, so the two must be
       * consistent.
       */
      expect(component.minWidthInDashboardUnits).toBeLessThanOrEqual(
        component.widthInDashboardUnits,
      );
      expect(component.minHeightInDashboardUnits).toBeLessThanOrEqual(
        component.heightInDashboardUnits,
      );
    });

    test("defaults maxRows to 25 and leaves every filter unset", () => {
      const component: DashboardMonitorListComponent =
        DashboardMonitorListComponentUtil.getDefaultComponent();

      expect(component.arguments.maxRows).toBe(25);

      /*
       * A freshly dropped widget must show all monitors — none of the optional
       * filters may be pre-populated, or the user sees a mysteriously empty
       * list they never asked to narrow.
       */
      expect(component.arguments.title).toBeUndefined();
      expect(component.arguments.viewMode).toBeUndefined();
      expect(component.arguments.timelineTooltipFields).toBeUndefined();
      expect(component.arguments.statusFilter).toBeUndefined();
      expect(component.arguments.monitorStatusIds).toBeUndefined();
      expect(component.arguments.monitorTypes).toBeUndefined();
      expect(component.arguments.labelIds).toBeUndefined();
    });

    test("uses the same default row count that the maxRows field shows as its placeholder", () => {
      /*
       * The 25 in getDefaultComponent and the "25" placeholder on the maxRows
       * field are the same promise made twice; if they drift, the form hints a
       * default the widget does not actually use.
       */
      const component: DashboardMonitorListComponent =
        DashboardMonitorListComponentUtil.getDefaultComponent();
      const maxRowsArgument: MonitorListArgument = getArgumentById("maxRows");

      expect(String(component.arguments.maxRows)).toBe(
        maxRowsArgument.placeholder,
      );
    });

    test("generates a well-formed, distinct componentId per call so two widgets never collide", () => {
      const first: DashboardMonitorListComponent =
        DashboardMonitorListComponentUtil.getDefaultComponent();
      const second: DashboardMonitorListComponent =
        DashboardMonitorListComponentUtil.getDefaultComponent();

      expect(first.componentId.toString().length).toBeGreaterThan(0);
      expect(first.componentId.toString()).not.toBe(
        second.componentId.toString(),
      );
    });
  });

  describe("getComponentConfigArguments", () => {
    test("declares exactly the eight documented arguments, in form order", () => {
      expect(
        getArguments().map((arg: MonitorListArgument) => {
          return arg.id;
        }),
      ).toEqual(EXPECTED_ARGUMENT_IDS);
    });

    test("gives every argument a name, description, valid input type and boolean required flag", () => {
      for (const arg of getArguments()) {
        expect(typeof arg.name).toBe("string");
        expect(arg.name.length).toBeGreaterThan(0);
        expect(typeof arg.description).toBe("string");
        expect(arg.description.length).toBeGreaterThan(0);
        expect(VALID_INPUT_TYPES.has(arg.type)).toBe(true);
        expect(typeof arg.required).toBe("boolean");
      }
    });

    test("marks every argument optional so the widget renders with no configuration", () => {
      /*
       * Nothing about a monitor-list widget is mandatory to configure — it
       * works with defaults — so a required field here would block the form
       * from ever validating.
       */
      for (const arg of getArguments()) {
        expect(arg.required).toBe(false);
      }
    });

    test("declares no duplicate argument ids", () => {
      const ids: Array<ArgumentId> = getArguments().map(
        (arg: MonitorListArgument) => {
          return arg.id;
        },
      );

      /*
       * A duplicate id means the second field silently overwrites the first
       * field's stored value.
       */
      expect(new Set<ArgumentId>(ids).size).toBe(ids.length);
    });

    test("puts every argument in a section so the settings panel can group them", () => {
      for (const arg of getArguments()) {
        expect(arg.section).toBeDefined();
        expect((arg.section?.name.length ?? 0) > 0).toBe(true);
        expect(typeof arg.section?.order).toBe("number");
      }
    });

    test("returns a fresh, equivalent array on each call so one rendering cannot corrupt another", () => {
      const first: Array<MonitorListArgument> = getArguments();
      const second: Array<MonitorListArgument> = getArguments();

      expect(second).toEqual(first);
      expect(second).not.toBe(first);
    });
  });

  describe("Display Options section", () => {
    test("groups the title, maxRows, viewMode and tooltip fields under 'Display Options' at order 1", () => {
      for (const id of DISPLAY_SECTION_ARGUMENT_IDS) {
        const arg: MonitorListArgument = getArgumentById(id);
        expect(arg.section?.name).toBe("Display Options");
        expect(arg.section?.order).toBe(1);
      }
    });

    test("renders the title as an optional free-text field", () => {
      const arg: MonitorListArgument = getArgumentById("title");

      expect(arg.type).toBe(ComponentInputType.Text);
      expect(arg.required).toBe(false);
      expect(arg.entityFilterModelType).toBeUndefined();
    });

    test("renders maxRows as a Number field hinting the default of 25", () => {
      const arg: MonitorListArgument = getArgumentById("maxRows");

      expect(arg.type).toBe(ComponentInputType.Number);
      expect(arg.placeholder).toBe("25");
    });

    test("wires in the shared viewMode dropdown, opting in to the state timeline", () => {
      const arg: MonitorListArgument = getArgumentById("viewMode");

      /*
       * The monitor list is the one list widget whose entries have a stored
       * status HISTORY (MonitorStatusTimeline), so it is the one that opts in
       * to the third mode. The exact strings are what the renderer switches
       * on and what a saved dashboard persists.
       */
      expect(arg.type).toBe(ComponentInputType.Dropdown);
      expect(
        getOptions("viewMode").map((option: OptionShape) => {
          return option.value;
        }),
      ).toEqual(["list", "honeycomb", "timeline"]);
    });

    test("offers the timeline tooltip rows as a multi-select", () => {
      const arg: MonitorListArgument = getArgumentById("timelineTooltipFields");

      expect(arg.type).toBe(ComponentInputType.MultiSelectDropdown);
      expect(arg.required).toBe(false);
      expect(arg.entityFilterModelType).toBeUndefined();
    });

    test("offers exactly one tooltip option per known field, in display order", () => {
      /*
       * Order is not cosmetic here: the tooltip renders its rows in the
       * canonical order regardless of the order they were ticked, so a picker
       * that sorted them differently would misrepresent the result.
       */
      expect(getOptions("timelineTooltipFields")).toEqual(
        MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.map(
          (props: MonitorStateTimelineTooltipFieldProps): OptionShape => {
            return { label: props.title, value: props.field };
          },
        ),
      );
    });

    test("gives every tooltip option a distinct, non-empty value", () => {
      const values: Array<string> = getOptions("timelineTooltipFields").map(
        (option: OptionShape): string => {
          return String(option.value);
        },
      );

      expect(values.length).toBeGreaterThan(0);
      expect(new Set<string>(values).size).toBe(values.length);
      for (const value of values) {
        expect(value.length).toBeGreaterThan(0);
      }
    });

    test("hints the default tooltip rows in its placeholder", () => {
      /*
       * The field is optional and an unset value falls back to a default set;
       * the placeholder is the only place a viewer learns what that default
       * is before touching the control.
       */
      expect(getArgumentById("timelineTooltipFields").placeholder).toBe(
        "Status, Started, Ended, Duration",
      );
    });
  });

  describe("Filters section", () => {
    test("groups every filter under 'Filters' at order 2, collapsed by default", () => {
      for (const id of FILTER_SECTION_ARGUMENT_IDS) {
        const arg: MonitorListArgument = getArgumentById(id);
        expect(arg.section?.name).toBe("Filters");
        expect(arg.section?.order).toBe(2);
        expect(arg.section?.defaultCollapsed).toBe(true);
      }
    });

    test("orders the Filters section after the Display Options section", () => {
      const displayOrder: number = getArgumentById("title").section?.order ?? 0;
      const filterOrder: number =
        getArgumentById("statusFilter").section?.order ?? 0;

      expect(filterOrder).toBeGreaterThan(displayOrder);
    });

    test("offers the operational quick-filter with an empty 'All' sentinel first", () => {
      const arg: MonitorListArgument = getArgumentById("statusFilter");

      expect(arg.type).toBe(ComponentInputType.Dropdown);
      expect(getOptions("statusFilter")).toEqual([
        { label: "All", value: "" },
        { label: "Operational only", value: "operational" },
        { label: "Not operational only", value: "non-operational" },
      ]);

      /*
       * The first option's empty-string value is the deliberate "no filter"
       * sentinel; it is the one dropdown value in this widget that is allowed
       * to be falsy, so a generic truthiness check must not be applied to it.
       */
      const firstOption: OptionShape | undefined =
        getOptions("statusFilter")[0];
      expect(firstOption?.value).toBe("");
    });

    test("binds the status filter to the MonitorStatus entity model", () => {
      const arg: MonitorListArgument = getArgumentById("monitorStatusIds");

      expect(arg.type).toBe(ComponentInputType.EntityMultiSelectDropdown);
      expect(arg.entityFilterModelType).toBe(
        EntityFilterModelType.MonitorStatus,
      );
      expect(arg.placeholder).toBe("All statuses");
      expect(arg.dropdownOptions).toBeUndefined();
    });

    test("binds the label filter to the Label entity model", () => {
      const arg: MonitorListArgument = getArgumentById("labelIds");

      expect(arg.type).toBe(ComponentInputType.EntityMultiSelectDropdown);
      expect(arg.entityFilterModelType).toBe(EntityFilterModelType.Label);
      expect(arg.placeholder).toBe("All labels");
      expect(arg.dropdownOptions).toBeUndefined();
    });

    test("renders the monitor-type filter as a static multi-select, not an entity lookup", () => {
      const arg: MonitorListArgument = getArgumentById("monitorTypes");

      expect(arg.type).toBe(ComponentInputType.MultiSelectDropdown);
      expect(arg.placeholder).toBe("All monitor types");

      /*
       * Monitor types are a fixed enum, not a project-scoped model, so this
       * field must carry a static option list and no entity binding.
       */
      expect(arg.entityFilterModelType).toBeUndefined();
      expect(Array.isArray(arg.dropdownOptions)).toBe(true);
    });
  });

  describe("monitor-type dropdown options", () => {
    test("offers exactly one option per known monitor type", () => {
      const options: Array<OptionShape> = getOptions("monitorTypes");

      expect(options.length).toBe(
        MonitorTypeHelper.getAllMonitorTypeProps().length,
      );
      expect(options.length).toBeGreaterThan(0);
    });

    test("labels each option with the type title and stores the monitor-type value", () => {
      const propsByType: Map<string, MonitorTypeProps> = new Map<
        string,
        MonitorTypeProps
      >(
        MonitorTypeHelper.getAllMonitorTypeProps().map(
          (props: MonitorTypeProps): [string, MonitorTypeProps] => {
            return [String(props.monitorType), props];
          },
        ),
      );

      for (const option of getOptions("monitorTypes")) {
        const matched: MonitorTypeProps | undefined = propsByType.get(
          String(option.value),
        );

        /*
         * Every option value must be a real monitor type, and its label must
         * be that type's own title — otherwise the picker shows a name that
         * stores an unrelated (or invalid) filter value.
         */
        expect(matched).toBeDefined();
        expect(option.label).toBe(matched?.title);
      }
    });

    test("sorts the options alphabetically by label", () => {
      const labels: Array<string> = getOptions("monitorTypes").map(
        (option: OptionShape): string => {
          return String(option.label);
        },
      );

      const sortedLabels: Array<string> = [...labels].sort(
        (a: string, b: string) => {
          return a.localeCompare(b);
        },
      );

      expect(labels).toEqual(sortedLabels);
    });

    test("contains no duplicate values so two options never map to the same filter", () => {
      const values: Array<string> = getOptions("monitorTypes").map(
        (option: OptionShape): string => {
          return String(option.value);
        },
      );

      expect(new Set<string>(values).size).toBe(values.length);
    });

    test("gives every option a non-empty string label and a truthy value", () => {
      for (const option of getOptions("monitorTypes")) {
        expect(typeof option.label).toBe("string");
        expect((option.label as string).length).toBeGreaterThan(0);
        expect(option.value).toBeTruthy();
      }
    });
  });

  /*
   * These go through the registry's public lookup rather than the util
   * directly, so forgetting to wire DashboardComponentType.MonitorList into
   * Common/Utils/Dashboard/Components/Index.ts would fail the suite.
   */
  describe("registration in DashboardComponentsUtil", () => {
    test("resolves DashboardComponentType.MonitorList instead of throwing", () => {
      expect(() => {
        return DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.MonitorList,
        );
      }).not.toThrow();
    });

    test("returns the monitor-list widget's own arguments through the registry", () => {
      const fromRegistry: Array<ComponentArgument<DashboardBaseComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.MonitorList,
        );

      expect(
        fromRegistry.map(
          (arg: ComponentArgument<DashboardBaseComponent>): unknown => {
            return arg.id;
          },
        ),
      ).toEqual(
        getArguments().map((arg: MonitorListArgument): unknown => {
          return arg.id;
        }),
      );
    });
  });
});
