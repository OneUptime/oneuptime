import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectPicker, {
  PROJECT_PICKER_BUTTON_CLASS_NAME,
  PROJECT_PICKER_ICON_CLASS_NAME,
  PROJECT_PICKER_NAME_CLASS_NAME,
  PROJECT_PICKER_WIDTH_CLASS_NAME,
} from "../../../UI/Components/Header/ProjectPicker/ProjectPicker";
import {
  getProjectPickerMenuPlacement,
  PROJECT_PICKER_MENU_GUTTER_IN_PX,
  PROJECT_PICKER_MENU_MAX_WIDTH_IN_PX,
  ProjectPickerMenuPlacement,
  ProjectPickerMenuPlacementInput,
} from "../../../UI/Components/Header/ProjectPicker/ProjectPickerMenuPlacement";
import getJestMockFunction from "../../MockType";
import {
  describeVisibility,
  isVisibleAtWidth,
} from "../../ResponsiveVisibility";

/*
 * THE PROJECT PICKER ON A PHONE (#7236).
 *
 * The picker is the header's one entry that gives way when the header is
 * tight, and on a 390px phone it gave the project's name 17px: "A." for
 * "Acme Production", so someone with several projects could not tell which
 * one they were in. Below sm it now spends nothing on decoration - no
 * folder icon, the arrows' room only. Its list was as narrow as the picker
 * (names cut, Create New Project on two lines, on a phone and on a 768px
 * tablet alike): it opens 20rem wide at every width, or as wide as a phone
 * allows, inside the window, on either reading direction. From sm the
 * picker itself is as it was.
 *
 * The widths the browser gives are measured by the offline header suite
 * (E2E NavigationSearch HeaderOnPhones.spec.ts); this pins the rules.
 */

function project(id: string, name: string): Project {
  const item: Project = new Project();
  item._id = id;
  item.name = name;
  return item;
}

const PROJECTS: Array<Project> = [
  project("b7000000-0000-4000-8000-0000000000b1", "Acme Production"),
  project("b7000000-0000-4000-8000-0000000000b2", "Acme Staging"),
];

const ORIGINAL_INNER_WIDTH: number = window.innerWidth;
const ORIGINAL_BOUNDING_RECT: () => DOMRect =
  // eslint-disable-next-line @typescript-eslint/unbound-method
  HTMLElement.prototype.getBoundingClientRect;

function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

// Where the picker's button sits, as getBoundingClientRect would say.
function placeButtons(left: number, right: number): void {
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("aria-haspopup") === "listbox") {
      return {
        left: left,
        right: right,
        x: left,
        y: 12,
        top: 12,
        bottom: 52,
        width: right - left,
        height: 40,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    }

    return ORIGINAL_BOUNDING_RECT.call(this);
  };
}

function renderPicker(): HTMLElement {
  render(
    <ProjectPicker
      projects={PROJECTS}
      selectedProjectIcon={IconProp.Folder}
      selectedProjectName="Acme Production"
      onCreateProjectButtonClicked={getJestMockFunction()}
      onProjectSelected={getJestMockFunction()}
    />,
  );

  return screen.getByRole("button", { name: /Acme Production/ });
}

function menu(): HTMLElement {
  return screen.getByTestId("project-picker-menu");
}

// The list as wide as the picker (w-full): no width or offset of its own.
function expectListAsWideAsThePicker(): void {
  expect({
    width: menu().style.width,
    left: menu().style.left,
    right: menu().style.right,
  }).toEqual({ width: "", left: "", right: "" });
  expect(menu().className.split(/\s+/)).toContain("w-full");
}

// The class attribute's tokens.
function tokens(className: string): Array<string> {
  return className.split(/\s+/).filter(Boolean);
}

afterEach(() => {
  cleanup();
  setWindowWidth(ORIGINAL_INNER_WIDTH);
  HTMLElement.prototype.getBoundingClientRect = ORIGINAL_BOUNDING_RECT;
});

describe("where the list opens", () => {
  function place(
    input: ProjectPickerMenuPlacementInput,
  ): ProjectPickerMenuPlacement | null {
    return getProjectPickerMenuPlacement(input);
  }

  // The list's left and right edges in the window.
  function edges(
    input: ProjectPickerMenuPlacementInput,
    placement: ProjectPickerMenuPlacement,
  ): { left: number; right: number } {
    if (placement.side === "left") {
      const left: number = input.buttonLeft + placement.offsetInPx;
      return { left: left, right: left + placement.widthInPx };
    }

    const right: number = input.buttonRight - placement.offsetInPx;
    return { left: right - placement.widthInPx, right: right };
  }

  test("the list is 20rem wide, with a 1rem gutter from each edge of the window", () => {
    expect(PROJECT_PICKER_MENU_MAX_WIDTH_IN_PX).toBe(320);
    expect(PROJECT_PICKER_MENU_GUTTER_IN_PX).toBe(16);
  });

  test.each([
    // [window, picker's left, picker's right, list's width, offset]
    [320, 60, 167, -44, 288],
    [375, 60, 222, -21, 320],
    [390, 60, 237, -6, 320],
    [480, 60, 316, 0, 320],
    [639, 60, 316, 0, 320],
    // A tablet: the picker squeezed beside Search and Help.
    [768, 172, 378, 0, 320],
    // A laptop: beside Search, Ask AI and Help.
    [1024, 172, 400, 0, 320],
    // A wide screen: the picker at its full 16rem.
    [1280, 172, 428, 0, 320],
  ])(
    "at %ipx, left to right, the list is 20rem or as wide as the phone allows, and starts as far left as it must",
    (
      windowWidth: number,
      buttonLeft: number,
      buttonRight: number,
      offsetInPx: number,
      widthInPx: number,
    ) => {
      const input: ProjectPickerMenuPlacementInput = {
        buttonLeft: buttonLeft,
        buttonRight: buttonRight,
        windowWidth: windowWidth,
        isRightToLeft: false,
      };

      const placement: ProjectPickerMenuPlacement | null = place(input);

      expect(placement).toEqual({
        widthInPx: widthInPx,
        side: "left",
        offsetInPx: offsetInPx,
      });

      const { left, right } = edges(input, placement!);
      expect(left).toBeGreaterThanOrEqual(16);
      expect(right).toBeLessThanOrEqual(windowWidth - 16);
      // Never further from the picker's start than the window makes it.
      expect(left).toBeLessThanOrEqual(buttonLeft);
    },
  );

  test.each([320, 375, 390, 480, 639, 768, 1024, 1280])(
    "at %ipx, right to left, the list mirrors the left-to-right one",
    (windowWidth: number) => {
      // The picker beside the logo on the right: the left-to-right one, mirrored.
      const leftToRight: ProjectPickerMenuPlacementInput = {
        buttonLeft: 60,
        buttonRight: Math.min(60 + 256, windowWidth - 150),
        windowWidth: windowWidth,
        isRightToLeft: false,
      };
      const rightToLeft: ProjectPickerMenuPlacementInput = {
        buttonLeft: windowWidth - leftToRight.buttonRight,
        buttonRight: windowWidth - leftToRight.buttonLeft,
        windowWidth: windowWidth,
        isRightToLeft: true,
      };

      const ltr: ProjectPickerMenuPlacement = place(leftToRight)!;
      const rtl: ProjectPickerMenuPlacement = place(rightToLeft)!;

      expect(rtl).toEqual({
        widthInPx: ltr.widthInPx,
        side: "right",
        offsetInPx: ltr.offsetInPx,
      });

      const { left, right } = edges(rightToLeft, rtl);
      expect(left).toBeGreaterThanOrEqual(16);
      expect(right).toBeLessThanOrEqual(windowWidth - 16);
      // Never further from the picker's start (its right edge) than the window makes it.
      expect(right).toBeGreaterThanOrEqual(rightToLeft.buttonRight);
    },
  );

  test.each([640, 768, 1024, 1280])(
    "at %ipx, a picker narrower than 20rem gets the wider list too, never only below sm",
    (windowWidth: number) => {
      expect(
        place({
          buttonLeft: 200,
          buttonRight: 456,
          windowWidth: windowWidth,
          isRightToLeft: false,
        }),
      ).toEqual({ widthInPx: 320, side: "left", offsetInPx: 0 });
      expect(
        place({
          buttonLeft: windowWidth - 456,
          buttonRight: windowWidth - 200,
          windowWidth: windowWidth,
          isRightToLeft: true,
        }),
      ).toEqual({ widthInPx: 320, side: "right", offsetInPx: 0 });
    },
  );

  test.each([640, 768, 1024, 1280])(
    "at %ipx, a picker 20rem wide or wider keeps a list as wide as itself",
    (windowWidth: number) => {
      for (const isRightToLeft of [false, true]) {
        expect(
          place({
            buttonLeft: 200,
            buttonRight: 520,
            windowWidth: windowWidth,
            isRightToLeft: isRightToLeft,
          }),
        ).toBeNull();
      }
    },
  );

  test("near the window's far edge on a wide screen, the list moves back inside it", () => {
    expect(
      place({
        buttonLeft: 1100,
        buttonRight: 1260,
        windowWidth: 1280,
        isRightToLeft: false,
      }),
    ).toEqual({ widthInPx: 320, side: "left", offsetInPx: -156 });
    expect(
      place({
        buttonLeft: 20,
        buttonRight: 180,
        windowWidth: 1280,
        isRightToLeft: true,
      }),
    ).toEqual({ widthInPx: 320, side: "right", offsetInPx: -156 });
  });

  test("a picker already as wide as the list would be keeps its own list", () => {
    expect(
      place({
        buttonLeft: 16,
        buttonRight: 340,
        windowWidth: 375,
        isRightToLeft: false,
      }),
    ).toBeNull();
  });

  test("a picker's fractional edges give a whole-pixel offset", () => {
    expect(
      place({
        buttonLeft: 60.4,
        buttonRight: 222.7,
        windowWidth: 375,
        isRightToLeft: false,
      }),
    ).toEqual({ widthInPx: 320, side: "left", offsetInPx: -21 });
  });

  test("at every width and wherever the picker is, the list stays inside the window", () => {
    const outside: Array<ProjectPickerMenuPlacementInput> = [];
    const unplaced: Array<ProjectPickerMenuPlacementInput> = [];

    for (let windowWidth: number = 280; windowWidth <= 1440; windowWidth += 7) {
      for (
        let buttonLeft: number = 0;
        buttonLeft < windowWidth;
        buttonLeft += 11
      ) {
        for (const isRightToLeft of [false, true]) {
          const input: ProjectPickerMenuPlacementInput = {
            buttonLeft: buttonLeft,
            buttonRight: Math.min(buttonLeft + 120, windowWidth),
            windowWidth: windowWidth,
            isRightToLeft: isRightToLeft,
          };
          const placement: ProjectPickerMenuPlacement | null = place(input);

          if (!placement) {
            unplaced.push(input);
            continue;
          }

          const { left, right } = edges(input, placement);

          if (left < 15.5 || right > windowWidth - 15.5) {
            outside.push(input);
          }
        }
      }
    }

    // A 120px picker always gets the wider list, and it is always inside.
    expect(unplaced).toEqual([]);
    expect(outside).toEqual([]);
  });
});

describe("the picker's list on a phone, a tablet and a wide screen", () => {
  test("on a 375px phone it opens 320px wide, moved back inside the window", () => {
    setWindowWidth(375);
    placeButtons(60, 222);

    fireEvent.click(renderPicker());

    expect(menu().style.width).toBe("320px");
    expect(menu().style.left).toBe("-21px");
    expect(menu().style.right).toBe("");
    // The names are drawn whole: Create New Project and both projects.
    expect(screen.getByText("Acme Staging")).toBeInTheDocument();
  });

  test("on a 375px phone that reads right to left it opens from the picker's right edge", () => {
    setWindowWidth(375);
    placeButtons(375 - 222, 375 - 60);

    const picker: HTMLElement = renderPicker();
    picker.style.direction = "rtl";

    fireEvent.click(picker);

    expect(menu().style.width).toBe("320px");
    expect(menu().style.right).toBe("-21px");
    expect(menu().style.left).toBe("");
  });

  test("on a 768px tablet, where the picker is squeezed beside Search and Help, it opens 20rem wide from the picker's start", () => {
    setWindowWidth(768);
    placeButtons(172, 378);

    fireEvent.click(renderPicker());

    expect(menu().style.width).toBe("320px");
    expect(menu().style.left).toBe("0px");
    expect(menu().style.right).toBe("");
  });

  test("a picker 20rem wide or wider keeps a list as wide as itself, with no width or offset of its own", () => {
    setWindowWidth(1280);
    placeButtons(200, 530);

    fireEvent.click(renderPicker());

    expectListAsWideAsThePicker();
  });

  test("a phone turned to a tablet's width while it is open: the list is placed again, and back", () => {
    setWindowWidth(390);
    placeButtons(60, 237);

    fireEvent.click(renderPicker());
    expect(menu().style.width).toBe("320px");
    expect(menu().style.left).toBe("-6px");

    act(() => {
      setWindowWidth(800);
      window.dispatchEvent(new Event("resize"));
    });
    // Room for the whole list from the picker's start: no offset now.
    expect(menu().style.width).toBe("320px");
    expect(menu().style.left).toBe("0px");

    act(() => {
      setWindowWidth(320);
      window.dispatchEvent(new Event("resize"));
    });
    expect(menu().style.width).toBe("288px");
    expect(menu().style.left).toBe("-44px");
  });

  test("closed and opened again, it is placed afresh for the window it opens in", () => {
    setWindowWidth(390);
    placeButtons(60, 237);

    const picker: HTMLElement = renderPicker();
    fireEvent.click(picker);
    expect(menu().style.left).toBe("-6px");
    fireEvent.click(picker);
    expect(screen.queryByTestId("project-picker-menu")).toBeNull();

    setWindowWidth(1024);
    placeButtons(200, 530);
    fireEvent.click(picker);
    expectListAsWideAsThePicker();
  });
});

describe("the picker's own room below sm", () => {
  function renderedParts(): {
    width: HTMLElement;
    button: HTMLElement;
    icon: HTMLElement;
    name: HTMLElement;
  } {
    const button: HTMLElement = renderPicker();
    const name: HTMLElement = screen.getByText("Acme Production")
      .parentElement as HTMLElement;
    const icon: HTMLElement = button.querySelector(
      `[class~="max-sm:hidden"]`,
    ) as HTMLElement;

    return {
      width: button.parentElement!.parentElement as HTMLElement,
      button: button,
      icon: icon,
      name: name,
    };
  }

  test("the classes drawn are the ones named, so the browser test and this one read the same rules", () => {
    const { width, button, icon, name } = renderedParts();

    expect(width.className).toBe(PROJECT_PICKER_WIDTH_CLASS_NAME);
    expect(button.className).toBe(PROJECT_PICKER_BUTTON_CLASS_NAME);
    expect(icon.getAttribute("class")).toContain(
      PROJECT_PICKER_ICON_CLASS_NAME,
    );
    expect(name.className).toBe(PROJECT_PICKER_NAME_CLASS_NAME);
  });

  test("the folder icon is off a phone's picker and back from sm, even with a foreign hidden rule", () => {
    const { icon } = renderedParts();

    for (const width of [320, 375, 390, 639]) {
      expect(isVisibleAtWidth(icon, width)).toBe(false);
    }

    for (const width of [640, 768, 1280]) {
      expect(describeVisibility(icon, width)).toBe(`visible at ${width}px`);
      expect(
        describeVisibility(icon, width, { withForeignHiddenRule: true }),
      ).toBe(`visible at ${width}px with a foreign .hidden rule on the page`);
    }

    // Never the bare hidden a foreign rule would take off every screen.
    expect(tokens(PROJECT_PICKER_ICON_CLASS_NAME)).not.toContain("hidden");
  });

  test("the name gives the icon's gap back below sm, and the arrows keep only their own room", () => {
    expect(tokens(PROJECT_PICKER_NAME_CLASS_NAME)).toEqual(
      expect.arrayContaining(["min-w-0", "sm:ml-2.5"]),
    );
    expect(tokens(PROJECT_PICKER_NAME_CLASS_NAME)).not.toContain("ml-2.5");

    expect(tokens(PROJECT_PICKER_BUTTON_CLASS_NAME)).toEqual(
      expect.arrayContaining(["pr-8", "sm:pr-10"]),
    );
    expect(tokens(PROJECT_PICKER_BUTTON_CLASS_NAME)).not.toContain("pr-10");
  });

  test("16rem at most at every width, and the one entry that gives way (min-w-0)", () => {
    expect(tokens(PROJECT_PICKER_WIDTH_CLASS_NAME)).toEqual([
      "w-64",
      "min-w-0",
    ]);
  });
});
