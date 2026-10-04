/*
 * A workflow step's rarely needed settings are folded under More fields.
 *
 * "Please always collapse the advanced section by default. Please do this for
 * entire project." And later: "The advanced section in the form should be
 * called something better ... show what things are inside it when
 * collapsed." In a step's settings, the arguments a component flags
 * isAdvanced (request headers, an AI step's temperature, ...) are folded
 * under More fields, like every form's rarely needed fields - once a "Show N
 * advanced settings" link. Folded, its header names them; one that holds a
 * value is a chip, so a choice the user made is never hidden from the person
 * who comes back to read it, and the section stays folded all the same.
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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
  return screen.getByRole("button", { name: "More fields" });
}

/*
 * A field's label starts with the argument's name - one the reader can see:
 * a folded field stays mounted, out of sight.
 */
function fieldLabelled(name: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("label")).find(
      (label: HTMLElement): boolean => {
        return (
          (label.textContent || "").trim().startsWith(name) &&
          !label.closest("[hidden]")
        );
      },
    ) || null
  );
}

// What the folded header lists, as read on screen.
function listed(): Array<string> {
  return screen
    .queryAllByTestId("folded-section-item")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
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
    "%s: folded under More fields on a step just added, naming what is inside",
    async (_title: string, metadata: ComponentMetadata) => {
      renderStep(step(metadata));

      const folded: Array<Argument> = foldedArgumentsOf(metadata);

      expect(await screen.findByRole("button", { name: "More fields" }))
        .toHaveAttribute("aria-expanded", "false");

      // The folded header names them (a long list says how many more).
      const names: Array<string> = listed();

      expect(names.length).toBeGreaterThan(0);
      expect(names.length).toBeLessThanOrEqual(folded.length);
      for (const name of names) {
        expect(
          folded.some((arg: Argument): boolean => {
            return arg.name.trim() === name;
          }),
        ).toBe(true);
      }

      for (const arg of folded) {
        expect({
          setting: arg.name,
          shown: fieldLabelled(arg.name) !== null,
        }).toEqual({ setting: arg.name, shown: false });
      }
    },
  );

  test("open on a click, and fold away again", async () => {
    renderStep(step(metadataOf(ComponentID.ApiGet)));

    await screen.findByRole("button", { name: "More fields" });
    expect(fieldLabelled("Request Headers")).toBeNull();
    expect(listed()).toContain("Request Headers");

    fireEvent.click(disclosure());

    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    expect(fieldLabelled("Request Headers")).not.toBeNull();

    fireEvent.click(disclosure());

    expect(disclosure()).toHaveAttribute("aria-expanded", "false");
    expect(fieldLabelled("Request Headers")).toBeNull();
  });

  test("a setting that already holds a value is a chip on the folded header", async () => {
    renderStep(
      step(metadataOf(ComponentID.ApiGet), {
        "request-headers": {
          Authorization: "Bearer {{local.variables.TOKEN}}",
        },
      }),
    );

    const header: HTMLElement = await screen.findByRole("button", {
      name: "More fields",
    });

    // Folded, like every More fields section: the chip says it is set.
    expect(header).toHaveAttribute("aria-expanded", "false");

    const chip: HTMLElement | undefined = within(header)
      .queryAllByTestId("folded-section-item")
      .find((item: HTMLElement): boolean => {
        return item.getAttribute("data-item-set") === "true";
      });

    expect(chip).toBeDefined();
    expect(chip!).toHaveTextContent(/^Request Headers/);
  });

  test.each([
    ["an empty string", ""],
    ["blank text", "   "],
    ["an empty object", {}],
  ])(
    "count nothing as set when the stored value is %s",
    async (_name: string, value: string | JSONObject) => {
      renderStep(
        step(metadataOf(ComponentID.ApiGet), { "request-headers": value }),
      );

      expect(
        await screen.findByRole("button", { name: "More fields" }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(
        screen
          .queryAllByTestId("folded-section-item")
          .filter((item: HTMLElement): boolean => {
            return item.getAttribute("data-item-set") === "true";
          }),
      ).toEqual([]);
    },
  );
});
