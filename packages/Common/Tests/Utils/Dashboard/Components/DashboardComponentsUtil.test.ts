import { describe, expect, test } from "@jest/globals";
import DashboardComponentsUtil from "../../../../Utils/Dashboard/Components/Index";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * DashboardComponentsUtil.getComponentSettingsArguments is the single dispatch
 * from a widget's type to the config-form fields the dashboard editor renders
 * for it. It is a long if/else chain that ends in `throw BadDataException`, so
 * the failure mode it invites is a real one: add a widget to the
 * DashboardComponentType enum, ship the component util, and forget the branch
 * here — every attempt to configure that widget then throws at runtime with no
 * compiler warning, because the chain has no exhaustiveness check.
 *
 * This suite is that missing exhaustiveness check. It also validates the shape
 * of what every branch returns, so a malformed argument list (a duplicate id
 * that silently drops a form field, an empty label) fails here instead of in
 * the editor.
 */

const ALL_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
);

const VALID_INPUT_TYPES: Set<string> = new Set<string>(
  Object.values(ComponentInputType),
);

describe("DashboardComponentsUtil.getComponentSettingsArguments", () => {
  // Sanity: the enum is non-trivial, so an empty loop can't vacuously pass.
  test("there is more than one dashboard component type to cover", () => {
    expect(ALL_TYPES.length).toBeGreaterThan(1);
  });

  test.each(ALL_TYPES)(
    "%s is wired into the dispatcher and returns an argument array",
    (type: DashboardComponentType) => {
      // The whole point: no enum member may fall through to BadDataException.
      const args: Array<ComponentArgument<DashboardBaseComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(type);
      expect(Array.isArray(args)).toBe(true);
    },
  );

  test.each(ALL_TYPES)(
    "every config argument for %s is well-formed",
    (type: DashboardComponentType) => {
      const args: Array<ComponentArgument<DashboardBaseComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(type);

      for (const arg of args) {
        // A blank label renders an unlabeled form field.
        expect(typeof arg.name).toBe("string");
        expect(arg.name.length).toBeGreaterThan(0);

        /*
         * id is the key the entered value is stored under; empty means the
         * value has nowhere to go.
         */
        expect(typeof arg.id).toBe("string");
        expect(String(arg.id).length).toBeGreaterThan(0);

        /*
         * required drives validation; it must be an actual boolean, not
         * undefined coerced as falsy.
         */
        expect(typeof arg.required).toBe("boolean");

        // An unknown input type renders no editor at all.
        expect(VALID_INPUT_TYPES.has(arg.type)).toBe(true);
      }
    },
  );

  test.each(ALL_TYPES)(
    "%s has no duplicate argument ids",
    (type: DashboardComponentType) => {
      const args: Array<ComponentArgument<DashboardBaseComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(type);

      const ids: Array<string> = args.map(
        (a: ComponentArgument<DashboardBaseComponent>) => {
          return String(a.id);
        },
      );
      // A duplicate id means the second field overwrites the first's value.
      expect(new Set<string>(ids).size).toBe(ids.length);
    },
  );

  test("an unknown component type is rejected with BadDataException", () => {
    expect(() => {
      return DashboardComponentsUtil.getComponentSettingsArguments(
        "NotARealComponentType" as DashboardComponentType,
      );
    }).toThrow(BadDataException);
  });

  test("calling twice returns equivalent, independent argument arrays", () => {
    /*
     * The editor may request the arguments repeatedly; each call must yield a
     * fresh array so mutating one rendering cannot corrupt the next.
     */
    const first: Array<ComponentArgument<DashboardBaseComponent>> =
      DashboardComponentsUtil.getComponentSettingsArguments(
        DashboardComponentType.Text,
      );
    const second: Array<ComponentArgument<DashboardBaseComponent>> =
      DashboardComponentsUtil.getComponentSettingsArguments(
        DashboardComponentType.Text,
      );
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});
