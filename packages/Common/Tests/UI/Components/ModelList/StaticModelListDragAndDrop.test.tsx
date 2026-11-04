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
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import StaticModelList, {
  MODEL_LIST_ROW_TEST_ID,
} from "../../../../UI/Components/ModelList/StaticModelList";
import { getLoadedDragAndDrop } from "../../../../UI/Components/DragAndDrop/DragAndDropLoader";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A StaticModelList that reorders its rows loads react-beautiful-dnd itself
 * (DragAndDropLoader, issue #5619). It used to import the library, so every
 * page that draws one - a status page's single sign-on page lists its
 * providers with one - downloaded and parsed it before it could draw.
 *
 * In this order (a test file loads the library once): a list whose rows stay
 * where they are never loads it; one that reorders draws its rows at once,
 * the same as they will look, and they drag once it is there.
 */

const mockLibrary: { requires: number } = { requires: 0 };

jest.mock("react-beautiful-dnd", () => {
  mockLibrary.requires++;
  return jest.requireActual("react-beautiful-dnd");
});

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};

const probesOf: (names: Array<string>) => Array<Probe> = (
  names: Array<string>,
): Array<Probe> => {
  return names.map((name: string, index: number) => {
    const probe: Probe = new Probe();
    probe.id = new ObjectID(`11111111-1111-4111-8111-11111111111${index}`);
    probe._id = probe.id.toString();
    probe.name = name;
    probe.description = `${name} probe`;
    return probe;
  });
};

const PROBES: Array<Probe> = probesOf(["Frankfurt", "Ohio", "Mumbai"]);

let onDragDrop: ReturnType<typeof jest.fn>;

const renderList: (enableDragAndDrop: boolean) => HTMLElement = (
  enableDragAndDrop: boolean,
): HTMLElement => {
  return render(
    <StaticModelList<Probe>
      list={PROBES}
      titleField="name"
      descriptionField="description"
      selectedItems={[]}
      onClick={() => {}}
      enableDragAndDrop={enableDragAndDrop}
      dragAndDropScope="probes-dnd"
      dragDropIdField="_id"
      onDragDrop={onDragDrop as never}
    />,
  ).container;
};

// Each row's grip, once react-beautiful-dnd has wired it up.
const wiredGrips: (container: HTMLElement) => Array<HTMLElement> = (
  container: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "[data-rbd-drag-handle-draggable-id]",
    ),
  );
};

/*
 * The rows as drawn, without what react-beautiful-dnd adds to wire them up:
 * its attributes, and the grip's focus stop (this list's grip is a plain box
 * the library makes a control of).
 */
const drawnRows: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByTestId(MODEL_LIST_ROW_TEST_ID)
    .map((row: HTMLElement): string => {
      const copy: HTMLElement = row.cloneNode(true) as HTMLElement;

      for (const grip of Array.from(
        copy.querySelectorAll("[data-rbd-drag-handle-draggable-id]"),
      )) {
        grip.removeAttribute("tabindex");
        grip.removeAttribute("role");
      }

      for (const element of [copy, ...Array.from(copy.querySelectorAll("*"))]) {
        for (const name of element.getAttributeNames()) {
          if (
            name.startsWith("data-rbd-") ||
            name === "aria-describedby" ||
            name === "draggable" ||
            name === "style"
          ) {
            element.removeAttribute(name);
          }
        }
      }

      return copy.outerHTML;
    });
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

beforeEach(() => {
  onDragDrop = jest.fn();
});

afterEach(() => {
  cleanup();
});

describe("a model list whose rows stay where they are", () => {
  test("never loads the drag-and-drop library", async () => {
    renderList(false);

    expect(screen.getAllByTestId(MODEL_LIST_ROW_TEST_ID)).toHaveLength(3);

    await wait(10);

    expect(mockLibrary.requires).toBe(0);
    expect(getLoadedDragAndDrop()).toBeNull();
  });
});

describe("a model list that reorders its rows", () => {
  test("draws its rows at once, as they will look, and they drag once the library is there", async () => {
    const container: HTMLElement = renderList(true);

    // The first frame: every row, in order, not wired up yet.
    expect(getLoadedDragAndDrop()).toBeNull();
    expect(
      screen.getAllByTestId(MODEL_LIST_ROW_TEST_ID).map((row: HTMLElement) => {
        return row.textContent;
      }),
    ).toEqual([
      "FrankfurtFrankfurt probe",
      "OhioOhio probe",
      "MumbaiMumbai probe",
    ]);
    expect(wiredGrips(container)).toHaveLength(0);

    const firstFrame: Array<string> = drawnRows();

    await waitFor(() => {
      expect(wiredGrips(container)).toHaveLength(3);
    });

    expect(drawnRows()).toEqual(firstFrame);
    expect(mockLibrary.requires).toBe(1);

    // Mumbai moves up one place.
    const grip: HTMLElement = wiredGrips(container)[2]!;
    grip.focus();
    await press(grip, SPACE);
    await press(grip, ARROW_UP);
    await press(grip, SPACE);
    await wait(400);

    expect(onDragDrop.mock.calls).toEqual([[PROBES[2]!._id, 1, 2]]);
  });

  test("is wired up from its first frame once a list has loaded the library", () => {
    const container: HTMLElement = renderList(true);

    expect(wiredGrips(container)).toHaveLength(3);
    expect(mockLibrary.requires).toBe(1);
  });
});
