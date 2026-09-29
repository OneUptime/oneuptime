import { describe, expect, test } from "@jest/globals";
import {
  DashboardListViewMode,
  getViewModeArgument,
} from "../../../../Utils/Dashboard/Components/DashboardListSharedArgs";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";

/*
 * getViewModeArgument is a pure factory: given the section a dashboard list
 * widget's config form belongs to, it returns the single "viewMode" dropdown
 * argument that lets an operator switch a list widget between the default table
 * view and the status-colored honeycomb view.
 *
 * The contract that matters at runtime is machine-readable, not cosmetic. The
 * `id` is the key the chosen value is persisted under, the `type` decides which
 * editor the form renders, and the dropdown option `value`s are the exact
 * strings ("list" / "honeycomb") the rendering code later switches on. If any
 * of those drift, a widget silently renders the wrong view or stores a value no
 * consumer understands, with no compiler error to catch it. This suite pins
 * that contract, and also verifies the factory passes the caller's section
 * through untouched and hands back independent objects on every call.
 */

/*
 * A representative, fully-populated section. The factory should place exactly
 * this reference on the returned argument without cloning or mutating it.
 */
const SAMPLE_SECTION: ComponentArgumentSection = {
  name: "Appearance",
  description: "How the widget looks.",
  icon: "eye",
  defaultCollapsed: false,
  order: 3,
};

/*
 * The complete set of view modes the DashboardListViewMode union permits. Each
 * dropdown option value must be one of these and, together, the options must
 * cover all of them.
 */
const VALID_VIEW_MODES: Set<DashboardListViewMode> =
  new Set<DashboardListViewMode>(["list", "honeycomb"]);

describe("getViewModeArgument", () => {
  describe("static argument contract", () => {
    test("uses the persisted key 'viewMode' as the argument id", () => {
      /*
       * The id is the key the selected value is stored under; if it is not
       * exactly "viewMode" the value lands somewhere the widget never reads.
       */
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      expect(arg.id).toBe("viewMode");
    });

    test("renders as a Dropdown editor", () => {
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      expect(arg.type).toBe(ComponentInputType.Dropdown);
    });

    test("is optional, expressed as a real boolean false", () => {
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      /*
       * `required` drives form validation, so it must be an actual boolean and
       * specifically false — not undefined coerced as falsy.
       */
      expect(typeof arg.required).toBe("boolean");
      expect(arg.required).toBe(false);
    });

    test("has a non-empty human label", () => {
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      expect(arg.name).toBe("View Mode");
      expect(arg.name.length).toBeGreaterThan(0);
    });

    test("describes both the list and honeycomb views", () => {
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      /*
       * The description is what the operator reads to understand the toggle;
       * it should mention both modes rather than pin exact prose.
       */
      expect(typeof arg.description).toBe("string");
      expect(arg.description.length).toBeGreaterThan(0);

      const lowerDescription: string = arg.description.toLowerCase();
      expect(lowerDescription).toContain("list");
      expect(lowerDescription).toContain("honeycomb");
    });
  });

  describe("dropdown options", () => {
    test("offers exactly the List and Honeycomb options, in that order", () => {
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      expect(arg.dropdownOptions).toEqual([
        { label: "List", value: "list" },
        { label: "Honeycomb", value: "honeycomb" },
      ]);
    });

    test("every option value is a valid DashboardListViewMode", () => {
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      const options: Array<{ label: unknown; value: unknown }> =
        (arg.dropdownOptions ?? []) as Array<{
          label: unknown;
          value: unknown;
        }>;

      /*
       * Guard against a vacuous pass: there must actually be options to check.
       */
      expect(options.length).toBeGreaterThan(0);

      for (const option of options) {
        expect(typeof option.label).toBe("string");
        expect((option.label as string).length).toBeGreaterThan(0);
        expect(
          VALID_VIEW_MODES.has(option.value as DashboardListViewMode),
        ).toBe(true);
      }
    });

    test("covers all view modes with no duplicate values", () => {
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      const values: Array<string> = (arg.dropdownOptions ?? []).map(
        (option: { value: unknown }): string => {
          return String(option.value);
        },
      );

      /*
       * A duplicate value would make two options indistinguishable to the
       * consumer; a missing one would strand a supported view behind no
       * selectable option.
       */
      const uniqueValues: Set<string> = new Set<string>(values);
      expect(uniqueValues.size).toBe(values.length);
      expect(uniqueValues).toEqual(
        new Set<string>(Array.from(VALID_VIEW_MODES)),
      );
    });
  });

  describe("section handling", () => {
    test("attaches the caller's section by reference, unmodified", () => {
      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      /*
       * The factory must not clone the section — the editor relies on the same
       * section instance being shared across the arguments that belong to it.
       */
      expect(arg.section).toBe(SAMPLE_SECTION);
    });

    test("does not mutate a frozen section", () => {
      const frozenSection: ComponentArgumentSection = Object.freeze({
        name: "Layout",
        order: 0,
      });

      /*
       * Passing a frozen section proves the factory never writes back into it;
       * any attempted mutation would throw here in strict mode.
       */
      expect(() => {
        return getViewModeArgument<DashboardBaseComponent>(frozenSection);
      }).not.toThrow();

      const arg: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(frozenSection);
      expect(arg.section).toBe(frozenSection);
    });

    test.each([
      ["zero order boundary", 0],
      ["negative order", -5],
      ["large order", 999999],
    ])(
      "passes through a minimal section with %s",
      (_label: string, order: number) => {
        const minimalSection: ComponentArgumentSection = {
          name: "",
          order: order,
        };

        const arg: ComponentArgument<DashboardBaseComponent> =
          getViewModeArgument<DashboardBaseComponent>(minimalSection);

        /*
         * The factory does not inspect or normalize the section, so even an
         * empty name or an out-of-range order is forwarded verbatim.
         */
        expect(arg.section).toBe(minimalSection);
        expect(arg.section?.order).toBe(order);
        expect(arg.section?.name).toBe("");
      },
    );
  });

  describe("purity and independence", () => {
    test("is deterministic for the same section", () => {
      const first: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);
      const second: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      expect(second).toEqual(first);
    });

    test("returns a fresh argument object and options array each call", () => {
      const first: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);
      const second: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      /*
       * Each rendering must get its own object and its own options array, so
       * mutating one form's arguments cannot corrupt another's.
       */
      expect(second).not.toBe(first);
      expect(second.dropdownOptions).not.toBe(first.dropdownOptions);
    });

    test("mutating a returned argument does not affect later calls", () => {
      const first: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      first.name = "Mutated";
      first.dropdownOptions?.push({ label: "Injected", value: "list" });

      const second: ComponentArgument<DashboardBaseComponent> =
        getViewModeArgument<DashboardBaseComponent>(SAMPLE_SECTION);

      expect(second.name).toBe("View Mode");
      expect(second.dropdownOptions).toHaveLength(2);
    });
  });
});
