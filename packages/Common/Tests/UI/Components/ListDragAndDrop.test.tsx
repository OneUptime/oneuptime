import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import List, { ComponentProps } from "../../../UI/Components/List/List";
import { DRAG_HANDLE_USAGE_INSTRUCTIONS } from "../../../UI/Components/Table/Table";
import FieldType from "../../../UI/Components/Types/FieldType";

/*
 * The card layout of a drag-ordered list (ModelTable showAs List - the
 * incoming call policy's escalation rules). Same contract as the table:
 * one named, focusable grip per card; a drop reports positions on screen,
 * the top included; nothing for a drop back home; disabled grips stay and
 * say why. Driven from the keyboard, which react-beautiful-dnd supports in
 * jsdom.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Rule {
  _id: string;
  name: string;
  order: number;
}

const RULES: Array<Rule> = [
  { _id: "first", name: "Primary on-call", order: 1 },
  { _id: "second", name: "Secondary on-call", order: 3 },
  { _id: "third", name: "Engineering manager", order: 4 },
];

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};

let onDragDrop: ReturnType<typeof jest.fn>;

const renderList: (props?: Partial<ComponentProps<Rule>>) => void = (
  props?: Partial<ComponentProps<Rule>>,
): void => {
  render(
    <List<Rule>
      data={RULES}
      id="escalation-rules"
      fields={[{ title: "Name", key: "name", fieldType: FieldType.Text }]}
      onNavigateToPage={() => {}}
      currentPageNumber={1}
      totalItemsCount={RULES.length}
      itemsOnPage={50}
      error=""
      isLoading={false}
      singularLabel="Rule"
      pluralLabel="Rules"
      enableDragAndDrop={true}
      dragDropIdField="_id"
      dragDropIndexField="order"
      onDragDrop={onDragDrop as never}
      itemToString={(rule: Rule): string => {
        return `Rule: ${rule.name}`;
      }}
      {...(props || {})}
    />,
  );
};

const wait: (ms: number) => Promise<void> = async (
  ms: number,
): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  });
};

const press: (
  element: HTMLElement,
  key: { keyCode: number; key: string },
) => Promise<void> = async (
  element: HTMLElement,
  key: { keyCode: number; key: string },
): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(element, key);
  });
  await wait(30);
};

const moveUp: (from: number, steps: number) => Promise<void> = async (
  from: number,
  steps: number,
): Promise<void> => {
  const grip: HTMLElement = screen.getAllByTestId("drag-handle")[from]!;
  grip.focus();

  await press(grip, SPACE);

  for (let i: number = 0; i < steps; i++) {
    await press(grip, ARROW_UP);
  }

  await press(grip, SPACE);
  await wait(400);
};

beforeEach(() => {
  onDragDrop = jest.fn();
});

afterEach(() => {
  cleanup();
});

describe("a drag-ordered list of cards", () => {
  test("has one named, focusable grip per card", () => {
    renderList();

    const grips: Array<HTMLElement> = screen.getAllByTestId("drag-handle");

    expect(grips).toHaveLength(RULES.length);
    expect(grips[2]!).toHaveAccessibleName(
      "Drag to reorder Rule: Engineering manager",
    );
    expect(grips[2]!).toHaveAttribute("tabindex", "0");
  });

  test("tells a screen reader how to use the grips", () => {
    renderList();

    expect(document.body.textContent).toContain(DRAG_HANDLE_USAGE_INSTRUCTIONS);
  });

  test("reports a card moved to the top by its position on screen", async () => {
    renderList();

    await moveUp(2, 2);

    expect(onDragDrop.mock.calls).toEqual([["third", 0, 2]]);
  });

  test("reports a card moved up one place", async () => {
    renderList();

    await moveUp(1, 1);

    expect(onDragDrop.mock.calls).toEqual([["second", 0, 1]]);
  });

  test("reports nothing for a card put back where it was", async () => {
    renderList();

    await moveUp(1, 0);

    expect(onDragDrop).not.toHaveBeenCalled();
  });

  test("while reordering is off, the grips stay, say why, and do not pick a card up", async () => {
    renderList({
      isDragDisabled: true,
      dragDisabledReason: "Saving the new order...",
    });

    for (const grip of screen.getAllByTestId("drag-handle")) {
      expect(grip).toHaveAttribute("aria-disabled", "true");
      expect(grip).toHaveAttribute("title", "Saving the new order...");
    }

    await moveUp(2, 1);

    expect(onDragDrop).not.toHaveBeenCalled();
  });

  test("a list that cannot be reordered has no grips", () => {
    renderList({ enableDragAndDrop: false });

    expect(screen.queryAllByTestId("drag-handle")).toHaveLength(0);
  });
});
