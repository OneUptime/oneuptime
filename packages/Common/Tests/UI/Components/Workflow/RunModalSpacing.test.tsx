import { ComponentProps as CodeEditorProps } from "../../../../UI/Components/CodeEditor/CodeEditor";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

// Monaco does not run under jsdom; the field only has to hold text.
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      const raw: unknown = props.value ?? props.initialValue ?? "";

      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          value={typeof raw === "string" ? raw : JSON.stringify(raw)}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

import RunModal from "../../../../UI/Components/Workflow/RunModal";
import BuiltInComponents from "../../../../Types/Workflow/Components";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";
import { resolveSpaceBelowInPx } from "../../../ResponsiveSpacing";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
} from "../../../ResponsiveVisibility";

/*
 * The workflow builder's other side panel: Run Workflow. SideOver now leaves
 * 24px under its content at every width - it used to leave none from the sm
 * breakpoint up, which is what put the component picker's last row on the
 * footer. The run form made up for it with bottom margins of its own, which
 * on top of SideOver's padding would end this panel on twice the room of
 * every other; it now leaves the bottom to SideOver.
 */

const WIDTHS: Array<number> = [
  PHONE_WIDTH_IN_PX,
  639,
  640,
  TABLET_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

const BOTTOM_SPACE_IN_PX: number = 24;

type TriggerNodeFunction = (componentId: string) => NodeDataProp;

// A trigger as the canvas holds it, from the real catalog.
const triggerNode: TriggerNodeFunction = (
  componentId: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = BuiltInComponents.find(
    (component: ComponentMetadata): boolean => {
      return component.id === componentId;
    },
  )!;

  return {
    id: `${componentId}-1`,
    internalId: `runner-${componentId}-1`,
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: { ...metadata },
    error: "",
    arguments: {},
    returnValues: {},
  };
};

type RenderRunModalFunction = (trigger: NodeDataProp) => void;

const renderRunModal: RenderRunModalFunction = (
  trigger: NodeDataProp,
): void => {
  render(<RunModal trigger={trigger} onClose={jest.fn()} onRun={jest.fn()} />);
};

type ScrollContainerFunction = () => HTMLElement;

const scrollContainer: ScrollContainerFunction = (): HTMLElement => {
  return screen.getByTestId("side-over-content");
};

describe("the Run Workflow panel", () => {
  beforeEach(() => {
    resetPageScrollLockForTesting();
  });

  afterEach(() => {
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  test.each(WIDTHS)(
    "ends a manual trigger's form 24px above the footer, like every side panel, at %ipx",
    (width: number) => {
      renderRunModal(triggerNode(ComponentID.Manual));

      // The form's own content: its heading, description and fields.
      const form: HTMLElement = screen.getByRole("heading", {
        name: "Run Manual",
      }).parentElement!;

      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(resolveSpaceBelowInPx(form, scrollContainer(), width)).toBe(
        BOTTOM_SPACE_IN_PX,
      );
    },
  );

  test("keeps the room above the form it always had", () => {
    renderRunModal(triggerNode(ComponentID.Manual));

    const form: HTMLElement = screen.getByRole("heading", {
      name: "Run Manual",
    }).parentElement!;

    // mt-3 and mt-5 collapse into one 20px margin; neither changed.
    expect(form).toHaveClass("mt-5");
    expect(form.parentElement).toHaveClass("mt-3");
    expect(form.className).not.toMatch(/(^|\s)m[by]-/);
    expect(form.parentElement!.className).not.toMatch(/(^|\s)m[by]-/);
  });

  test("with no trigger yet, its message is not flush on the footer either", () => {
    renderRunModal({
      ...triggerNode(ComponentID.Manual),
      nodeType: NodeType.PlaceholderNode,
    });

    const message: HTMLElement = screen.getByText(
      "No trigger added. Please add a trigger in order to run this workflow",
    );

    for (const width of WIDTHS) {
      expect(
        resolveSpaceBelowInPx(
          message.closest("[class]") as HTMLElement,
          scrollContainer(),
          width,
        ),
      ).toBeGreaterThanOrEqual(BOTTOM_SPACE_IN_PX);
    }
  });
});
