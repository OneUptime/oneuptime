import { describe, expect, test } from "@jest/globals";
import JsonComponents from "../../../../Types/Workflow/Components/JSON";
import AllComponents from "../../../../Types/Workflow/Components";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  Port,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * The JSON workflow block catalog. The server-side runners
 * (Server/Types/Workflow/Components/JSON/*) look their metadata up here by
 * ComponentID and then read args / emit return values / choose ports by the
 * ids declared below, so a renamed id silently breaks saved workflows.
 */

const findComponent: (id: ComponentID) => ComponentMetadata = (
  id: ComponentID,
): ComponentMetadata => {
  const component: ComponentMetadata | undefined = JsonComponents.find(
    (item: ComponentMetadata) => {
      return item.id === id;
    },
  );
  if (!component) {
    throw new Error(`Component ${id} not found`);
  }
  return component;
};

const argumentIds: (component: ComponentMetadata) => Array<string> = (
  component: ComponentMetadata,
): Array<string> => {
  return component.arguments.map((argument: Argument) => {
    return argument.id;
  });
};

const returnValueIds: (component: ComponentMetadata) => Array<string> = (
  component: ComponentMetadata,
): Array<string> => {
  return component.returnValues.map((returnValue: ReturnValue) => {
    return returnValue.id;
  });
};

const portIds: (ports: Array<Port>) => Array<string> = (
  ports: Array<Port>,
): Array<string> => {
  return ports.map((port: Port) => {
    return port.id;
  });
};

describe("Workflow JSON components", () => {
  test("exports exactly the three JSON blocks in order", () => {
    expect(
      JsonComponents.map((component: ComponentMetadata) => {
        return component.id;
      }),
    ).toEqual([
      ComponentID.JsonToText,
      ComponentID.TextToJson,
      ComponentID.MergeJson,
    ]);
  });

  test("ids resolve to the expected stable string values", () => {
    expect(ComponentID.JsonToText).toBe("json-to-text");
    expect(ComponentID.TextToJson).toBe("text-to-json");
    expect(ComponentID.MergeJson).toBe("merge-json");
  });

  test("component ids are unique", () => {
    const ids: Array<string> = JsonComponents.map(
      (component: ComponentMetadata) => {
        return component.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(JsonComponents)(
    "$id shares the JSON category, icon and component type",
    (component: ComponentMetadata) => {
      expect(component.category).toBe("JSON");
      expect(component.iconProp).toBe(IconProp.JSON);
      expect(component.componentType).toBe(ComponentType.Component);
      expect(component.title.trim().length).toBeGreaterThan(0);
      expect(component.description.trim().length).toBeGreaterThan(0);
    },
  );

  test.each(JsonComponents)(
    "$id has a single 'in' port and success / error out ports",
    (component: ComponentMetadata) => {
      expect(portIds(component.inPorts)).toEqual(["in"]);
      expect(portIds(component.outPorts)).toEqual(["success", "error"]);
      for (const port of [...component.inPorts, ...component.outPorts]) {
        expect(port.title.length).toBeGreaterThan(0);
        expect(port.description.length).toBeGreaterThan(0);
      }
    },
  );

  test.each(JsonComponents)(
    "$id marks every argument and return value as required",
    (component: ComponentMetadata) => {
      for (const argument of component.arguments) {
        expect(argument.required).toBe(true);
      }
      for (const returnValue of component.returnValues) {
        expect(returnValue.required).toBe(true);
      }
    },
  );

  test.each(JsonComponents)(
    "$id has unique argument and return value ids",
    (component: ComponentMetadata) => {
      const args: Array<string> = argumentIds(component);
      const returns: Array<string> = returnValueIds(component);
      expect(new Set(args).size).toBe(args.length);
      expect(new Set(returns).size).toBe(returns.length);
    },
  );

  test("JSON to Text takes JSON 'json' and returns Text 'text'", () => {
    const component: ComponentMetadata = findComponent(ComponentID.JsonToText);
    expect(component.title).toBe("JSON to Text");
    expect(argumentIds(component)).toEqual(["json"]);
    expect(component.arguments[0]!.type).toBe(ComponentInputType.JSON);
    expect(returnValueIds(component)).toEqual(["text"]);
    expect(component.returnValues[0]!.type).toBe(ComponentInputType.Text);
  });

  test("Text to JSON takes Text 'text' and returns JSON 'json'", () => {
    const component: ComponentMetadata = findComponent(ComponentID.TextToJson);
    expect(component.title).toBe("Text to JSON");
    expect(argumentIds(component)).toEqual(["text"]);
    expect(component.arguments[0]!.type).toBe(ComponentInputType.Text);
    expect(returnValueIds(component)).toEqual(["json"]);
    expect(component.returnValues[0]!.type).toBe(ComponentInputType.JSON);
  });

  test("Merge JSON takes two JSON args 'json1' / 'json2' and returns JSON 'json'", () => {
    const component: ComponentMetadata = findComponent(ComponentID.MergeJson);
    expect(component.title).toBe("Merge JSON");
    expect(argumentIds(component)).toEqual(["json1", "json2"]);
    for (const argument of component.arguments) {
      expect(argument.type).toBe(ComponentInputType.JSON);
    }
    expect(
      component.arguments.map((argument: Argument) => {
        return argument.name;
      }),
    ).toEqual(["JSON 1", "JSON 2"]);
    expect(returnValueIds(component)).toEqual(["json"]);
    expect(component.returnValues[0]!.type).toBe(ComponentInputType.JSON);
  });

  test("every JSON block is registered in the global component catalog", () => {
    for (const component of JsonComponents) {
      expect(AllComponents).toContain(component);
    }
  });

  test("no other workflow block reuses a JSON block id", () => {
    for (const component of JsonComponents) {
      const matches: Array<ComponentMetadata> = AllComponents.filter(
        (item: ComponentMetadata) => {
          return item.id === component.id;
        },
      );
      expect(matches).toHaveLength(1);
    }
  });
});
