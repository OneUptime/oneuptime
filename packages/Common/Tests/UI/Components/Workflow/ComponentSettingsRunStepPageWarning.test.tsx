import ComponentSettingsModal from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import {
  PAGE_STEP_RUN_WARNING,
  getPageStepRunWarning,
} from "../../../../UI/Components/Workflow/OnCall/PageStepRunWarning";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import OnCallComponents from "../../../../Types/Workflow/Components/OnCall";
import ObjectID from "../../../../Types/ObjectID";
import { loadComponentsAndCategories } from "../../../../UI/Components/Workflow/Utils";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React, { ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * "Run just this step" runs a step for real, and its confirmation says so.
 * For a Page step "for real" is a phone ringing - at night, if it is night
 * where the person is - so its confirmation says that in so many words
 * before the button is pressed, and says what to do about it: name yourself
 * while you test.
 *
 * Every Page step says it; no other step does, and what the dialog already
 * said of every step is still said first.
 *
 * The settings form and the "How to use" help are stubbed, as in the
 * confirmation's own suite: neither has anything to do with the dialog.
 */
jest.mock("../../../../UI/Components/Workflow/ArgumentsForm", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="arguments-form" />;
    },
  };
});

jest.mock("../../../../UI/Components/Workflow/DocumentationViewer", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="documentation-viewer" />;
    },
  };
});

const PAGE_STEP_IDS: Array<ComponentID> = [
  ComponentID.PageUsers,
  ComponentID.PageTeam,
  ComponentID.PageOnCall,
  ComponentID.PageOnCallPolicy,
];

function metadataOf(id: string): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  })!;
}

function stepOf(id: string): NodeDataProp {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    id: `${id}-1`,
    internalId: `runner-${id}-1`,
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: metadata,
    error: "",
    arguments: {},
    returnValues: {},
  };
}

interface Opened {
  confirmation: HTMLElement;
  onRunStep: MockFunction;
}

// The step's settings, with "Run just this step" pressed.
function openRunStepConfirmation(id: string): Opened {
  const onRunStep: MockFunction = getJestMockFunction();
  const component: NodeDataProp = stepOf(id);

  render(
    <ComponentSettingsModal
      title={component.metadata.title}
      description={component.metadata.description}
      onClose={getJestMockFunction()}
      onSave={getJestMockFunction()}
      onDelete={getJestMockFunction()}
      onRunStep={onRunStep}
      component={component}
      graphComponents={[component]}
      workflowId={new ObjectID("11111111-1111-4111-8111-111111111111")}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Run just this step" }));

  return {
    confirmation: screen.getByRole("dialog", { name: "Run this step now?" }),
    onRunStep: onRunStep,
  };
}

afterEach(() => {
  cleanup();
});

describe("which steps the warning is for", () => {
  test("the four Page steps, and they are every step of the On-Call category", () => {
    expect(
      OnCallComponents.map((component: ComponentMetadata): string => {
        return component.id;
      }).sort(),
    ).toEqual([...PAGE_STEP_IDS].map(String).sort());

    for (const id of PAGE_STEP_IDS) {
      expect(getPageStepRunWarning(id)).toBe(PAGE_STEP_RUN_WARNING);
    }
  });

  test("no other step in the catalog", () => {
    // Every step the Builder offers: the hand-written ones and each database model's.
    const catalog: Array<ComponentMetadata> =
      loadComponentsAndCategories().components;
    const others: Array<ComponentMetadata> = catalog.filter(
      (component: ComponentMetadata): boolean => {
        return !PAGE_STEP_IDS.map(String).includes(component.id);
      },
    );

    expect(others.length).toBeGreaterThan(1500);
    expect(catalog.length - others.length).toBe(PAGE_STEP_IDS.length);

    for (const component of others) {
      expect(getPageStepRunWarning(component.id)).toBeNull();
    }
  });

  test("none for a step that is not there", () => {
    expect(getPageStepRunWarning(undefined)).toBeNull();
    expect(getPageStepRunWarning(null)).toBeNull();
    expect(getPageStepRunWarning("")).toBeNull();
    expect(getPageStepRunWarning("page")).toBeNull();
  });

  test("the sentence says what happens and what to do about it", () => {
    expect(PAGE_STEP_RUN_WARNING).toContain("pages people");
    expect(PAGE_STEP_RUN_WARNING).toContain("called, texted or notified");
    expect(PAGE_STEP_RUN_WARNING).toContain("Name yourself while you test.");
  });
});

describe("the 'Run this step now?' confirmation of a Page step", () => {
  test.each(PAGE_STEP_IDS.map(String))(
    "%s: says that the step pages people, after what it says of every step",
    (id: string) => {
      const { confirmation } = openRunStepConfirmation(id);
      const said: string = confirmation.textContent || "";
      const title: string = metadataOf(id).title;

      const everyStep: string = `This runs "${title}" for real, on its own.`;

      expect(said).toContain(everyStep);
      expect(said).toContain(PAGE_STEP_RUN_WARNING);
      // In that order, as two sentences with a space between them.
      expect(said.indexOf(everyStep)).toBeLessThan(
        said.indexOf(PAGE_STEP_RUN_WARNING),
      );
      expect(said).toContain(`nothing else runs. ${PAGE_STEP_RUN_WARNING}`);
    },
  );

  test("still runs the step when confirmed, and nothing when cancelled", () => {
    const first: Opened = openRunStepConfirmation(ComponentID.PageUsers);

    fireEvent.click(
      within(first.confirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(first.onRunStep).not.toHaveBeenCalled();

    cleanup();

    const second: Opened = openRunStepConfirmation(ComponentID.PageUsers);

    fireEvent.click(
      within(second.confirmation).getByRole("button", {
        name: "Run this step",
      }),
    );
    expect(second.onRunStep).toHaveBeenCalledTimes(1);
    expect(
      (second.onRunStep.mock.calls[0]![0] as NodeDataProp).metadataId,
    ).toBe(ComponentID.PageUsers);
  });
});

describe("the confirmation of any other step", () => {
  test.each([ComponentID.Log, ComponentID.SlackSendMessageToChannel])(
    "%s: says what it always said, and nothing about paging",
    (id: ComponentID) => {
      const { confirmation } = openRunStepConfirmation(id);
      const said: string = confirmation.textContent || "";

      expect(said).toContain(
        `This runs "${metadataOf(id).title}" for real, on its own.`,
      );
      expect(said).not.toContain(PAGE_STEP_RUN_WARNING);
      expect(said).not.toContain("pages people");
      // Its last sentence is the last thing the description says: no stray space after it.
      expect(said).toContain("because nothing else runs.");
      expect(said).not.toContain("nothing else runs. ");
    },
  );
});
