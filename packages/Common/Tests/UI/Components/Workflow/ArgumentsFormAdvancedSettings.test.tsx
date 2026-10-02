/*
 * A workflow step's advanced settings start folded away.
 *
 * "Please always collapse the advanced section by default. Please do this for
 * entire project." In a step's settings, the arguments a component flags
 * isAdvanced (request headers, an AI step's temperature, ...) sit behind a
 * "Show N advanced settings" disclosure. A step just added to the canvas has
 * nothing in them, so every one of them starts folded. A step whose advanced
 * settings already hold a value opens them on load, on purpose: a choice the
 * user made is never hidden from the person who comes back to read it.
 *
 * Every built-in component with advanced settings is rendered from its real
 * definition. (The two "Pick this value" dialogs it once stood in for are
 * gone: every setting has the value picker in it now.)
 */

/*
 * Utils.ts imports the whole database-model registry for
 * loadComponentsAndCategories, which nothing here calls.
 */
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import Components from "../../../../Types/Workflow/Components";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

function step(
  metadata: ComponentMetadata,
  args: JSONObject = {},
): NodeDataProp {
  return {
    error: "",
    id: `${metadata.id}-1`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${metadata.id}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
}

function renderStep(node: NodeDataProp): void {
  render(
    <ArgumentsForm
      component={node}
      workflowId={ObjectID.generate()}
      graphComponents={[node]}
      onHasFormValidationErrors={(): void => {}}
      onFormChange={(): void => {}}
    />,
  );
}

// The arguments the disclosure folds away: advanced and not required.
function foldedArgumentsOf(metadata: ComponentMetadata): Array<Argument> {
  return metadata.arguments.filter((arg: Argument): boolean => {
    return Boolean(arg.isAdvanced) && !arg.required;
  });
}

const WITH_ADVANCED_SETTINGS: Array<ComponentMetadata> = Components.filter(
  (metadata: ComponentMetadata): boolean => {
    return foldedArgumentsOf(metadata).length > 0;
  },
);

function disclosure(): HTMLElement {
  return screen.getByRole("button", {
    name: /^(Show \d+ advanced settings?|Hide advanced settings)$/,
  });
}

// A field's label starts with the argument's name.
function fieldLabelled(name: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("label")).find(
      (label: HTMLElement): boolean => {
        return (label.textContent || "").trim().startsWith(name);
      },
    ) || null
  );
}

function metadataOf(id: ComponentID): ComponentMetadata {
  const metadata: ComponentMetadata | undefined = Components.find(
    (component: ComponentMetadata): boolean => {
      return component.id === id;
    },
  );

  if (!metadata) {
    throw new Error(`No component ${id}`);
  }

  return metadata;
}

afterEach(() => {
  cleanup();
});

describe("a workflow step's advanced settings", () => {
  // Guards the sweep below: the HTTP request steps alone have headers here.
  test("the sweep covers the steps that have advanced settings", () => {
    expect(
      WITH_ADVANCED_SETTINGS.map((metadata: ComponentMetadata): string => {
        return metadata.id;
      }),
    ).toEqual(
      expect.arrayContaining([
        ComponentID.ApiGet,
        ComponentID.ApiPost,
        ComponentID.AIGenerateText,
      ]),
    );
  });

  test.each(
    WITH_ADVANCED_SETTINGS.map(
      (metadata: ComponentMetadata): [string, ComponentMetadata] => {
        return [metadata.title, metadata];
      },
    ),
  )(
    "%s: start folded away on a step just added",
    (_title: string, metadata: ComponentMetadata) => {
      renderStep(step(metadata));

      const folded: Array<Argument> = foldedArgumentsOf(metadata);

      expect(disclosure()).toHaveAttribute("aria-expanded", "false");
      expect(disclosure()).toHaveTextContent(
        `Show ${folded.length} advanced setting${folded.length === 1 ? "" : "s"}`,
      );

      for (const arg of folded) {
        expect({
          setting: arg.name,
          shown: fieldLabelled(arg.name) !== null,
        }).toEqual({ setting: arg.name, shown: false });
      }
    },
  );

  test("open on a click, and fold away again", () => {
    renderStep(step(metadataOf(ComponentID.ApiGet)));

    expect(fieldLabelled("Request Headers")).toBeNull();

    fireEvent.click(disclosure());

    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    expect(disclosure()).toHaveTextContent("Hide advanced settings");
    expect(fieldLabelled("Request Headers")).not.toBeNull();

    fireEvent.click(disclosure());

    expect(disclosure()).toHaveAttribute("aria-expanded", "false");
    expect(fieldLabelled("Request Headers")).toBeNull();
  });

  test("open on load when one of them already holds a value", () => {
    renderStep(
      step(metadataOf(ComponentID.ApiGet), {
        "request-headers": {
          Authorization: "Bearer {{local.variables.TOKEN}}",
        },
      }),
    );

    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    expect(fieldLabelled("Request Headers")).not.toBeNull();
  });

  test.each([
    ["an empty string", ""],
    ["blank text", "   "],
    ["an empty object", {}],
  ])(
    "stay folded when the stored value is %s",
    (_name: string, value: string | JSONObject) => {
      renderStep(
        step(metadataOf(ComponentID.ApiGet), { "request-headers": value }),
      );

      expect(disclosure()).toHaveAttribute("aria-expanded", "false");
    },
  );
});
