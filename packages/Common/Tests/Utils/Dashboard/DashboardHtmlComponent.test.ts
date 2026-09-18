import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardHtmlComponent from "../../../Types/Dashboard/DashboardComponents/DashboardHtmlComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import DashboardComponentsUtil from "../../../Utils/Dashboard/Components/Index";
import DashboardHtmlComponentUtil from "../../../Utils/Dashboard/Components/DashboardHtmlComponent";

type ArgumentIds = keyof DashboardHtmlComponent["arguments"];

function getArguments(): Array<ComponentArgument<DashboardHtmlComponent>> {
  return DashboardHtmlComponentUtil.getComponentConfigArguments();
}

function getArgumentById(
  id: ArgumentIds,
): ComponentArgument<DashboardHtmlComponent> {
  const found: ComponentArgument<DashboardHtmlComponent> | undefined =
    getArguments().find((arg: ComponentArgument<DashboardHtmlComponent>) => {
      return arg.id === id;
    });

  if (!found) {
    throw new Error(`No HTML widget argument declared with id "${id}"`);
  }

  return found;
}

describe("DashboardHtmlComponentUtil", () => {
  describe("getDefaultComponent", () => {
    it("declares its componentType as Html so the renderer dispatch matches", () => {
      expect(
        DashboardHtmlComponentUtil.getDefaultComponent().componentType,
      ).toBe(DashboardComponentType.Html);
    });

    it("marks itself as a dashboard component so it survives config serialization", () => {
      expect(DashboardHtmlComponentUtil.getDefaultComponent()._type).toBe(
        ObjectType.DashboardComponent,
      );
    });

    it("places a 6x3 tile at the canvas origin", () => {
      const component: DashboardHtmlComponent =
        DashboardHtmlComponentUtil.getDefaultComponent();

      expect(component.widthInDashboardUnits).toBe(6);
      expect(component.heightInDashboardUnits).toBe(3);
      expect(component.topInDashboardUnits).toBe(0);
      expect(component.leftInDashboardUnits).toBe(0);
    });

    it("cannot be resized below its own minimum", () => {
      const component: DashboardHtmlComponent =
        DashboardHtmlComponentUtil.getDefaultComponent();

      expect(component.minWidthInDashboardUnits).toBeLessThanOrEqual(
        component.widthInDashboardUnits,
      );
      expect(component.minHeightInDashboardUnits).toBeLessThanOrEqual(
        component.heightInDashboardUnits,
      );
    });

    it("gives every widget its own id", () => {
      expect(
        DashboardHtmlComponentUtil.getDefaultComponent().componentId.toString(),
      ).not.toBe(
        DashboardHtmlComponentUtil.getDefaultComponent().componentId.toString(),
      );
    });

    it("ships starter markup and CSS so a new widget renders something", () => {
      const component: DashboardHtmlComponent =
        DashboardHtmlComponentUtil.getDefaultComponent();

      expect(component.arguments.html).toBeTruthy();
      expect(component.arguments.css).toBeTruthy();
    });

    /*
     * Scripts default on because the widget exists to run pasted JS, and the
     * sandbox — not this flag — is what contains it. Forms default off
     * because nothing about pasting markup implies wanting to submit to a
     * third party.
     */
    it("defaults to running scripts and opening links, but not submitting forms", () => {
      const component: DashboardHtmlComponent =
        DashboardHtmlComponentUtil.getDefaultComponent();

      expect(component.arguments.allowScripts).toBe(true);
      expect(component.arguments.allowPopups).toBe(true);
      expect(component.arguments.allowForms).toBe(false);
    });
  });

  describe("getComponentConfigArguments", () => {
    it("declares an argument for each of HTML, CSS, and JavaScript", () => {
      expect(getArgumentById("html").type).toBe(ComponentInputType.Html);
      expect(getArgumentById("css").type).toBe(ComponentInputType.Css);
      expect(getArgumentById("javascript").type).toBe(
        ComponentInputType.JavaScript,
      );
    });

    it("declares each permission as a toggle", () => {
      expect(getArgumentById("allowScripts").type).toBe(
        ComponentInputType.Boolean,
      );
      expect(getArgumentById("allowForms").type).toBe(
        ComponentInputType.Boolean,
      );
      expect(getArgumentById("allowPopups").type).toBe(
        ComponentInputType.Boolean,
      );
    });

    it("gives every argument a name, a description, and a section", () => {
      for (const arg of getArguments()) {
        expect(arg.name).toBeTruthy();
        expect(arg.description).toBeTruthy();
        expect(arg.section).toBeTruthy();
        expect(arg.section?.name).toBeTruthy();
      }
    });

    it("declares no duplicate argument ids", () => {
      const ids: Array<unknown> = getArguments().map(
        (arg: ComponentArgument<DashboardHtmlComponent>) => {
          return arg.id;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
    });

    /*
     * ComponentArgument.id is typed as keyof T["arguments"], but the default
     * component is a separate object literal — a field renamed in one and
     * not the other still compiles and produces a settings field that writes
     * to an argument the renderer never reads.
     */
    it("only declares arguments the default component actually carries", () => {
      const defaultArgumentKeys: Array<string> = Object.keys(
        DashboardHtmlComponentUtil.getDefaultComponent().arguments,
      );

      for (const arg of getArguments()) {
        expect(defaultArgumentKeys).toContain(String(arg.id));
      }
    });

    it("orders its sections so the markup editor comes first", () => {
      const orders: Array<number> = getArguments().map(
        (arg: ComponentArgument<DashboardHtmlComponent>): number => {
          return arg.section?.order ?? 0;
        },
      );

      expect(getArgumentById("html").section?.order).toBe(Math.min(...orders));
    });

    /*
     * Nothing blocks saving a widget with an empty required field — the
     * settings modal does not consume ArgumentsForm's validation callback —
     * so marking these required would only promise an enforcement that does
     * not exist.
     */
    it("marks nothing as required, because empty is a renderable state", () => {
      for (const arg of getArguments()) {
        expect(arg.required).toBe(false);
      }
    });
  });

  /*
   * Through the registry's public lookup rather than the util directly, so
   * forgetting to wire DashboardComponentType.Html into
   * Common/Utils/Dashboard/Components/Index.ts fails the suite. Without that
   * entry the settings modal throws BadDataException the moment a user opens
   * it.
   */
  describe("registration in DashboardComponentsUtil", () => {
    it("resolves DashboardComponentType.Html instead of throwing", () => {
      expect(() => {
        return DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.Html,
        );
      }).not.toThrow();
    });

    it("returns the HTML widget's own arguments", () => {
      const fromRegistry: Array<ComponentArgument<DashboardBaseComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.Html,
        );

      expect(
        fromRegistry.map(
          (arg: ComponentArgument<DashboardBaseComponent>): unknown => {
            return arg.id;
          },
        ),
      ).toEqual(
        getArguments().map(
          (arg: ComponentArgument<DashboardHtmlComponent>): unknown => {
            return arg.id;
          },
        ),
      );
    });
  });
});
