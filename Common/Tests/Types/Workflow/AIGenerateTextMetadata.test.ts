import Components, { Categories } from "../../../Types/Workflow/Components";
import AIComponents from "../../../Types/Workflow/Components/AI";
import ComponentID from "../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  ComponentCategory,
  ComponentInputType,
  ComponentType,
  Port,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

function byId<T extends { id: string }>(items: Array<T>, id: string): T {
  const item: T | undefined = items.find((candidate: T) => {
    return candidate.id === id;
  });

  if (!item) {
    throw new Error(`Expected item with id ${id}`);
  }

  return item;
}

describe("Generate Text with AI workflow metadata", () => {
  const metadata: ComponentMetadata = byId(
    AIComponents,
    ComponentID.AIGenerateText,
  );

  test("uses the stable persisted component id", () => {
    expect(ComponentID.AIGenerateText).toBe("ai-generate-text");
    expect(metadata.id).toBe("ai-generate-text");
  });

  test("is a discoverable AI component", () => {
    expect(metadata.title).toBe("Generate Text with AI");
    expect(metadata.category).toBe("AI");
    expect(metadata.componentType).toBe(ComponentType.Component);
    expect(metadata.description).toMatch(/AI|LLM/i);
    expect(metadata.iconProp).toBeDefined();

    expect(
      Components.filter((component: ComponentMetadata) => {
        return component.id === ComponentID.AIGenerateText;
      }),
    ).toHaveLength(1);
    expect(
      Categories.some((category: ComponentCategory) => {
        return category.name === "AI";
      }),
    ).toBe(true);
  });

  test("publishes the complete, stable argument contract", () => {
    expect(
      metadata.arguments.map((argument: Argument) => {
        return argument.id;
      }),
    ).toEqual([
      "system-prompt",
      "prompt",
      "context",
      "temperature",
      "max-output-tokens",
    ]);

    expect(byId(metadata.arguments, "prompt")).toMatchObject({
      required: true,
      type: ComponentInputType.Markdown,
    });
    expect(byId(metadata.arguments, "system-prompt")).toMatchObject({
      required: false,
      type: ComponentInputType.LongText,
    });
    expect(byId(metadata.arguments, "context")).toMatchObject({
      required: false,
      type: ComponentInputType.JSON,
    });
    expect(byId(metadata.arguments, "temperature")).toMatchObject({
      required: false,
      type: ComponentInputType.Decimal,
    });
    expect(byId(metadata.arguments, "max-output-tokens")).toMatchObject({
      required: false,
      type: ComponentInputType.Number,
    });
  });

  test("does not expose provider credentials or arbitrary endpoints as inputs", () => {
    const argumentIds: Array<string> = metadata.arguments.map(
      (argument: Argument) => {
        return argument.id.toLowerCase();
      },
    );

    expect(argumentIds).not.toContain("api-key");
    expect(argumentIds).not.toContain("provider");
    expect(argumentIds).not.toContain("provider-id");
    expect(argumentIds).not.toContain("model");
    expect(argumentIds).not.toContain("base-url");
  });

  test("marks prompt-bearing inputs as sensitive workflow-log data", () => {
    for (const id of ["prompt", "system-prompt", "context"]) {
      expect(byId(metadata.arguments, id).isSensitive).toBe(true);
    }

    expect(byId(metadata.arguments, "temperature").isSensitive).not.toBe(true);
    expect(byId(metadata.arguments, "max-output-tokens").isSensitive).not.toBe(
      true,
    );
  });

  test("publishes typed usage and diagnostic return values", () => {
    expect(
      metadata.returnValues.map((returnValue: ReturnValue) => {
        return returnValue.id;
      }),
    ).toEqual([
      "response",
      "provider",
      "model",
      "total-tokens",
      "completion-tokens",
      "llm-log-id",
      "error",
    ]);

    expect(byId(metadata.returnValues, "response").type).toBe(
      ComponentInputType.LongText,
    );
    expect(byId(metadata.returnValues, "provider").type).toBe(
      ComponentInputType.Text,
    );
    expect(byId(metadata.returnValues, "model").type).toBe(
      ComponentInputType.Text,
    );
    expect(byId(metadata.returnValues, "total-tokens").type).toBe(
      ComponentInputType.Number,
    );
    expect(byId(metadata.returnValues, "completion-tokens").type).toBe(
      ComponentInputType.Number,
    );
    expect(byId(metadata.returnValues, "llm-log-id").type).toBe(
      ComponentInputType.Text,
    );
    expect(byId(metadata.returnValues, "error").type).toBe(
      ComponentInputType.Text,
    );
  });

  test("redacts model-generated content while leaving usage metadata loggable", () => {
    expect(byId(metadata.returnValues, "response").isSensitive).toBe(true);

    for (const id of [
      "provider",
      "model",
      "total-tokens",
      "completion-tokens",
      "llm-log-id",
    ]) {
      expect(byId(metadata.returnValues, id).isSensitive).not.toBe(true);
    }
  });

  test("has one input port and explicit success and error branches", () => {
    expect(
      metadata.inPorts.map((port: Port) => {
        return port.id;
      }),
    ).toEqual(["in"]);
    expect(
      metadata.outPorts.map((port: Port) => {
        return port.id;
      }),
    ).toEqual(["success", "error"]);
  });
});
