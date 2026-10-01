/*
 * The audit behind the step settings dialog's layout, as tests: every kind of
 * step, trigger and action, opens on what it is for, shows a section only when
 * it has something in it, and keeps the same order.
 *
 * The settings form itself is stubbed. What it renders for each argument type
 * has suites of its own; here only its place in the dialog matters.
 */

import React from "react";

jest.mock("../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  );
  const URLType: { fromString: (url: string) => unknown } = jest.requireActual(
    "../../../../Types/API/URL",
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
  };
});

jest.mock("../../../../UI/Components/Workflow/ArgumentsForm", () => {
  return {
    __esModule: true,
    default: (props: {
      component: { metadata: { arguments: Array<{ name: string }> } };
    }) => {
      return (
        <div data-testid="arguments-form">
          {props.component.metadata.arguments
            .map((argument: { name: string }) => {
              return argument.name;
            })
            .join(", ")}
        </div>
      );
    },
  };
});

jest.mock("../../../../UI/Components/Workflow/DocumentationViewer", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="documentation-viewer">Documentation</div>;
    },
  };
});

import ComponentSettingsModal from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import { loadComponentsAndCategories } from "../../../../UI/Components/Workflow/Utils";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../Types/Workflow/Components/BaseModel";
import getJestMockFunction from "../../../MockType";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";

/*
 * The steps opened for something that is not one of their settings, and the
 * section each one opens on. ComponentPrimaryPanel draws these.
 */
const PRIMARY_SECTION_BY_COMPONENT: Record<string, string> = {
  [ComponentID.Webhook]: "webhook-url",
  [ComponentID.Manual]: "how-to-run",
};

const COMPACT_ROW_SECTIONS: Array<string> = ["id", "inputs", "outputs"];

// A sentence that opens with Required or Optional, as ArgumentsForm's prefix does.
const SAYS_REQUIRED_OR_OPTIONAL: RegExp = /(^|\.\s)(Optional|Required)\b/;

type IsDatabaseDeleteTriggerFunction = (metadata: ComponentMetadata) => boolean;

/*
 * The one kind of step with neither settings nor a primary panel. A database
 * On Delete trigger has nothing to set - the record is already gone - and
 * nothing to show beyond the record it hands on. Its dialog is the identifier
 * and its one output, the reference to that record right below them, and the
 * documentation: short enough to take in at once, so there is nothing to put
 * above it.
 */
const isDatabaseDeleteTrigger: IsDatabaseDeleteTriggerFunction = (
  metadata: ComponentMetadata,
): boolean => {
  return (
    Boolean(metadata.tableName) &&
    metadata.componentType === ComponentType.Trigger &&
    metadata.id.endsWith("-on-delete")
  );
};

/*
 * Every non-database component, and all eleven database components of one
 * model (Incident has all four of create, read, update and delete on, so it
 * has every kind: the three triggers, find, create, update and delete).
 */
const COMPONENTS_TO_RENDER: Array<ComponentMetadata> = [
  ...Components,
  ...BaseModelComponentFactory.getComponents(new Incident()),
];

type ExpectedSectionsFunction = (metadata: ComponentMetadata) => Array<string>;

// What the dialog should show for a step, worked out from its metadata alone.
const expectedSections: ExpectedSectionsFunction = (
  metadata: ComponentMetadata,
): Array<string> => {
  const sections: Array<string> = [];
  const primary: string | undefined = PRIMARY_SECTION_BY_COMPONENT[metadata.id];

  if (primary) {
    sections.push(primary);
  }

  if (metadata.arguments.length > 0) {
    sections.push("settings");
  }

  sections.push("id");

  if (metadata.inPorts.length > 0) {
    sections.push("inputs");
  }

  if (metadata.outPorts.length > 0) {
    sections.push("outputs");
  }

  if (metadata.returnValues.length > 0) {
    sections.push("returns");
  }

  if (metadata.documentationLink) {
    sections.push("documentation");
  }

  return sections;
};

type RenderStepFunction = (metadata: ComponentMetadata) => void;

const renderStep: RenderStepFunction = (metadata: ComponentMetadata): void => {
  const node: NodeDataProp = {
    error: "",
    id: "step-1",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: "internal-step-1",
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };

  render(
    <ComponentSettingsModal
      title={metadata.title}
      description={metadata.description}
      onClose={getJestMockFunction()}
      onSave={getJestMockFunction()}
      onDelete={getJestMockFunction()}
      component={node}
      graphComponents={[node]}
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      webhookSecretKey="6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b"
    />,
  );
};

type SectionOrderFunction = () => Array<string>;

const sectionOrder: SectionOrderFunction = (): Array<string> => {
  return Array.from(
    document.querySelectorAll('[data-testid^="workflow-component-section-"]'),
  ).map((section: Element) => {
    return (section.getAttribute("data-testid") || "").replace(
      "workflow-component-section-",
      "",
    );
  });
};

describe.each(
  COMPONENTS_TO_RENDER.map((metadata: ComponentMetadata) => {
    return [metadata.id, metadata] as [string, ComponentMetadata];
  }),
)("%s", (_id: string, metadata: ComponentMetadata) => {
  test("shows exactly the sections it has content for, in the dialog's order", () => {
    renderStep(metadata);

    expect(sectionOrder()).toEqual(expectedSections(metadata));

    cleanup();
  });

  test("opens on what it is for: its primary panel, else its settings", () => {
    renderStep(metadata);

    const first: string = sectionOrder()[0] as string;

    if (isDatabaseDeleteTrigger(metadata)) {
      // See isDatabaseDeleteTrigger: the whole dialog is four short sections.
      expect(sectionOrder()).toEqual([
        "id",
        "outputs",
        "returns",
        "documentation",
      ]);
    } else {
      expect(first).toBe(
        PRIMARY_SECTION_BY_COMPONENT[metadata.id] || "settings",
      );
    }
    expect(
      screen.queryByText("This step does not need any settings."),
    ).not.toBeInTheDocument();

    cleanup();
  });

  test("the identifier and its connections share one row, and nothing else does", () => {
    renderStep(metadata);

    const row: HTMLElement = screen.getByTestId(
      "workflow-component-settings-compact-row",
    );
    const inRow: Array<string> = Array.from(
      row.querySelectorAll('[data-testid^="workflow-component-section-"]'),
    ).map((section: Element) => {
      return (section.getAttribute("data-testid") || "").replace(
        "workflow-component-section-",
        "",
      );
    });

    expect(inRow).toEqual(
      expectedSections(metadata).filter((name: string) => {
        return COMPACT_ROW_SECTIONS.includes(name);
      }),
    );

    cleanup();
  });

  test("no section is an empty card", () => {
    renderStep(metadata);

    for (const name of sectionOrder()) {
      const section: HTMLElement = screen.getByTestId(
        `workflow-component-section-${name}`,
      );
      // The heading block, then something under it.
      expect(section.children.length).toBeGreaterThan(1);

      const heading: string =
        section.querySelector("h4")?.textContent?.trim() || "";
      const text: string = (section.textContent || "").trim();

      expect(text.length).toBeGreaterThan(heading.length);
    }

    cleanup();
  });

  test("every return value has its reference and a copy button", () => {
    renderStep(metadata);

    if (metadata.returnValues.length === 0) {
      expect(
        screen.queryByTestId("workflow-component-section-returns"),
      ).not.toBeInTheDocument();
      cleanup();
      return;
    }

    const returns: HTMLElement = screen.getByTestId(
      "workflow-component-section-returns",
    );

    expect(
      within(returns)
        .getAllByTestId("workflow-return-value-reference")
        .map((reference: HTMLElement) => {
          return reference.textContent;
        }),
    ).toEqual(
      metadata.returnValues.map((returnValue: { id: string }) => {
        return `{{local.components.step-1.returnValues.${returnValue.id}}}`;
      }),
    );
    expect(
      within(returns).getAllByRole("button", {
        name: /^Copy the reference to /,
      }),
    ).toHaveLength(metadata.returnValues.length);

    cleanup();
  });

  test("every port is listed under Inputs or Outputs", () => {
    renderStep(metadata);

    const portsIn: (name: string) => number = (name: string): number => {
      const section: HTMLElement | null = screen.queryByTestId(
        `workflow-component-section-${name}`,
      );

      return section
        ? within(section).queryAllByTestId("workflow-port").length
        : 0;
    };

    expect(portsIn("inputs")).toBe(metadata.inPorts.length);
    expect(portsIn("outputs")).toBe(metadata.outPorts.length);

    cleanup();
  });

  test("a trigger has no Inputs section, since nothing runs before it", () => {
    renderStep(metadata);

    expect(
      Boolean(screen.queryByTestId("workflow-component-section-inputs")),
    ).toBe(metadata.componentType !== ComponentType.Trigger);

    cleanup();
  });
});

describe("every registered step, database steps of all models included", () => {
  const all: Array<ComponentMetadata> =
    loadComponentsAndCategories().components;

  test("the registry is the size this audit expects, so the guard below is not vacuous", () => {
    expect(all.length).toBeGreaterThan(COMPONENTS_TO_RENDER.length);
  });

  /*
   * A step with no settings and no primary panel opens on its identifier,
   * which is not what anyone opens a step for. When a new step has no settings
   * and is opened for something - an inbound address, a URL - give it a panel
   * in ComponentPrimaryPanel and list it in PRIMARY_SECTION_BY_COMPONENT above.
   */
  test("every step opens on its settings or on a primary panel, database On Delete triggers aside", () => {
    const opensOnIdentifier: Array<string> = all
      .filter((metadata: ComponentMetadata) => {
        return (
          metadata.arguments.length === 0 &&
          !PRIMARY_SECTION_BY_COMPONENT[metadata.id] &&
          !isDatabaseDeleteTrigger(metadata)
        );
      })
      .map((metadata: ComponentMetadata) => {
        return metadata.id;
      });

    expect(opensOnIdentifier).toEqual([]);
  });

  test("the On Delete exception is what it says: one output, one record, no settings", () => {
    const deleteTriggers: Array<ComponentMetadata> = all.filter(
      isDatabaseDeleteTrigger,
    );

    // One per model with delete enabled, so the exception is not vacuous.
    expect(deleteTriggers.length).toBeGreaterThan(10);

    for (const metadata of deleteTriggers) {
      expect({
        id: metadata.id,
        settings: metadata.arguments.length,
        outputs: metadata.outPorts.length,
        returns: metadata.returnValues.length,
        hasDocumentation: Boolean(metadata.documentationLink),
      }).toEqual({
        id: metadata.id,
        settings: 0,
        outputs: 1,
        returns: 1,
        hasDocumentation: true,
      });
    }
  });

  test("no port or return value describes itself with someone else's sentence", () => {
    const pasted: Array<string> = [];

    for (const metadata of all) {
      for (const port of [...metadata.inPorts, ...metadata.outPorts]) {
        if (
          port.description.includes("after the value has been logged") &&
          metadata.id !== ComponentID.Log
        ) {
          pasted.push(`${metadata.id}:${port.id}`);
        }

        if (
          port.description.includes("message is successfully posted") &&
          !metadata.title.startsWith("Send Message to")
        ) {
          pasted.push(`${metadata.id}:${port.id}`);
        }

        // A trigger runs no query; that sentence came from Find.
        if (
          metadata.componentType === ComponentType.Trigger &&
          port.description.includes("query executes")
        ) {
          pasted.push(`${metadata.id}:${port.id}`);
        }
      }

      for (const returnValue of metadata.returnValues) {
        if (returnValue.description === returnValue.name) {
          pasted.push(`${metadata.id}:${returnValue.id}`);
        }
      }
    }

    expect(pasted).toEqual([]);
  });

  test("no argument description repeats the Required or Optional the form already shows", () => {
    const repeated: Array<string> = [];

    for (const metadata of all) {
      for (const argument of metadata.arguments) {
        if (SAYS_REQUIRED_OR_OPTIONAL.test(argument.description)) {
          repeated.push(`${metadata.id}:${argument.id}`);
        }
      }
    }

    expect(repeated).toEqual([]);
  });
});
