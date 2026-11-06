import { afterEach, describe, expect, test } from "@jest/globals";
import {
  FACET_SIDEBAR_NAME_ATTRIBUTE,
  getFacetNameShortfalls,
  getFacetSidebarDrawnWidth,
  getFacetSidebarRoomWidth,
  isFacetSidebarRightToLeft,
} from "../../../../UI/Components/TelemetryViewer/FacetSidebarMeasure";

/*
 * What the filters sidebar reads off the page when a person asks it to fit
 * its names (a double-click on its edge, End or Enter): how much each name
 * it lists lacks, or has to spare, at the width it is drawn at - and the
 * room it shares with the list. jsdom lays nothing out, so each box here is
 * given the place a browser would give it: a facet row's button (the
 * name's box, padded 6px at each end) holding a 14px check box and the
 * name, as TelemetryFacetValueRow draws it.
 */

interface Box {
  left: number;
  width: number;
}

// Give an element the box a browser would lay it out in.
const layOut: (
  element: HTMLElement,
  box: Box,
  extra?: { scrollWidth?: number; clientWidth?: number; isDrawn?: boolean },
) => void = (
  element: HTMLElement,
  box: Box,
  extra: { scrollWidth?: number; clientWidth?: number; isDrawn?: boolean } = {},
): void => {
  const rect: DOMRect = {
    x: box.left,
    y: 0,
    left: box.left,
    top: 0,
    width: box.width,
    height: 20,
    right: box.left + box.width,
    bottom: 20,
    toJSON: (): unknown => {
      return {};
    },
  } as DOMRect;

  element.getBoundingClientRect = (): DOMRect => {
    return rect;
  };

  element.getClientRects = (): DOMRectList => {
    const rects: Array<DOMRect> = extra.isDrawn === false ? [] : [rect];

    return Object.assign(rects, {
      item: (index: number): DOMRect | null => {
        return rects[index] || null;
      },
    }) as unknown as DOMRectList;
  };

  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: extra.clientWidth ?? Math.round(box.width),
  });
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    value: extra.scrollWidth ?? Math.round(box.width),
  });
};

interface Row {
  button: HTMLElement;
  checkBox: HTMLElement;
  name: HTMLElement;
}

/*
 * One facet row's button, starting at the sidebar's left edge: 6px of
 * padding, the check box, an 8px gap, the name, then the room left over.
 */
const addRow: (
  panel: HTMLElement,
  data: {
    buttonWidth: number;
    nameWidth: number;
    // The name whole: wider than its box when it is cut short.
    nameFullWidth?: number;
    isRightToLeft?: boolean;
    isDrawn?: boolean;
    isMarked?: boolean;
  },
) => Row = (
  panel: HTMLElement,
  data: {
    buttonWidth: number;
    nameWidth: number;
    nameFullWidth?: number;
    isRightToLeft?: boolean;
    isDrawn?: boolean;
    isMarked?: boolean;
  },
): Row => {
  const button: HTMLElement = document.createElement("button");
  button.style.paddingLeft = "6px";
  button.style.paddingRight = "6px";
  button.style.borderLeftWidth = "0px";
  button.style.borderRightWidth = "0px";

  const checkBox: HTMLElement = document.createElement("span");
  const name: HTMLElement = document.createElement("bdi");

  if (data.isMarked !== false) {
    name.setAttribute(FACET_SIDEBAR_NAME_ATTRIBUTE, "true");
  }

  button.appendChild(checkBox);
  button.appendChild(name);
  panel.appendChild(button);

  const buttonLeft: number = 10;

  layOut(button, { left: buttonLeft, width: data.buttonWidth });

  if (data.isRightToLeft) {
    // From the right: padding, the check box, the gap, then the name.
    const checkBoxLeft: number = buttonLeft + data.buttonWidth - 6 - 14;
    layOut(checkBox, { left: checkBoxLeft, width: 14 });
    layOut(
      name,
      { left: checkBoxLeft - 8 - data.nameWidth, width: data.nameWidth },
      {
        scrollWidth: data.nameFullWidth ?? data.nameWidth,
        isDrawn: data.isDrawn,
      },
    );
  } else {
    layOut(checkBox, { left: buttonLeft + 6, width: 14 });
    layOut(
      name,
      { left: buttonLeft + 6 + 14 + 8, width: data.nameWidth },
      {
        scrollWidth: data.nameFullWidth ?? data.nameWidth,
        isDrawn: data.isDrawn,
      },
    );
  }

  return { button, checkBox, name };
};

const newPanel: (data?: { isRightToLeft?: boolean }) => HTMLElement = (
  data: { isRightToLeft?: boolean } = {},
): HTMLElement => {
  const room: HTMLElement = document.createElement("div");
  const panel: HTMLElement = document.createElement("div");

  if (data.isRightToLeft) {
    panel.style.direction = "rtl";
  }

  room.appendChild(panel);
  document.body.appendChild(room);

  return panel;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getFacetNameShortfalls", () => {
  test("a name cut short lacks what it would take whole, less what it is given", () => {
    const panel: HTMLElement = newPanel();
    // A 180px button: 6 + 14 + 8 + 146 + 6. The name takes 260px whole.
    addRow(panel, { buttonWidth: 180, nameWidth: 146, nameFullWidth: 260 });

    expect(getFacetNameShortfalls(panel)).toEqual([260 - 146]);
  });

  test("a name shown whole has to spare the room its button has left after it", () => {
    const panel: HTMLElement = newPanel();
    // 6 + 14 + 8 + 60 = 88 used, of 180 less its 6px end padding: 86 to spare.
    addRow(panel, { buttonWidth: 180, nameWidth: 60 });

    expect(getFacetNameShortfalls(panel)).toEqual([-(180 - 6 - 88)]);
  });

  test("a name that just fits has nothing to spare and lacks nothing", () => {
    const panel: HTMLElement = newPanel();
    addRow(panel, { buttonWidth: 180, nameWidth: 146 });

    expect(getFacetNameShortfalls(panel)).toEqual([0]);
  });

  test("every name the sidebar lists, in order", () => {
    const panel: HTMLElement = newPanel();
    addRow(panel, { buttonWidth: 180, nameWidth: 146, nameFullWidth: 300 });
    addRow(panel, { buttonWidth: 180, nameWidth: 40 });
    addRow(panel, { buttonWidth: 180, nameWidth: 146, nameFullWidth: 150 });

    expect(getFacetNameShortfalls(panel)).toEqual([154, -106, 4]);
  });

  test("on a page read right to left, the room to spare is at the button's left", () => {
    const panel: HTMLElement = newPanel({ isRightToLeft: true });
    addRow(panel, { buttonWidth: 180, nameWidth: 60, isRightToLeft: true });
    addRow(panel, {
      buttonWidth: 180,
      nameWidth: 146,
      nameFullWidth: 200,
      isRightToLeft: true,
    });

    expect(isFacetSidebarRightToLeft(panel)).toBe(true);
    expect(getFacetNameShortfalls(panel)).toEqual([-86, 54]);
  });

  test("what is drawn over the row takes no room in it: a screen reader's 'Excluded'", () => {
    const panel: HTMLElement = newPanel();
    const row: Row = addRow(panel, { buttonWidth: 180, nameWidth: 60 });

    // sr-only is absolutely positioned: wherever its box is, it is no child in the line.
    const excluded: HTMLElement = document.createElement("span");
    excluded.style.position = "absolute";
    row.button.appendChild(excluded);
    layOut(excluded, { left: 170, width: 1 });

    expect(getFacetNameShortfalls(panel)).toEqual([-86]);
  });

  test("what is left out of the row takes no room in it", () => {
    const panel: HTMLElement = newPanel();
    const row: Row = addRow(panel, { buttonWidth: 180, nameWidth: 60 });

    const hidden: HTMLElement = document.createElement("span");
    hidden.style.display = "none";
    row.button.appendChild(hidden);
    layOut(hidden, { left: 175, width: 0 });

    expect(getFacetNameShortfalls(panel)).toEqual([-86]);
  });

  test("a name not drawn (a folded section's) is left out", () => {
    const panel: HTMLElement = newPanel();
    addRow(panel, {
      buttonWidth: 180,
      nameWidth: 0,
      nameFullWidth: 400,
      isDrawn: false,
    });
    addRow(panel, { buttonWidth: 180, nameWidth: 146, nameFullWidth: 170 });

    expect(getFacetNameShortfalls(panel)).toEqual([24]);
  });

  test("only the names the rows mark are read: a section's title is as wide as it is", () => {
    const panel: HTMLElement = newPanel();
    addRow(panel, {
      buttonWidth: 180,
      nameWidth: 146,
      nameFullWidth: 900,
      isMarked: false,
    });

    expect(getFacetNameShortfalls(panel)).toEqual([]);
  });

  test("a sidebar with no names has nothing to read", () => {
    expect(getFacetNameShortfalls(newPanel())).toEqual([]);
  });

  test("a name whose box is out of room reads as a plain 0, never -0", () => {
    const panel: HTMLElement = newPanel();
    // The name ends past its box's padding: no room left, and none lacking.
    addRow(panel, { buttonWidth: 180, nameWidth: 150 });

    expect(Object.is(getFacetNameShortfalls(panel)[0], 0)).toBe(true);
  });
});

describe("getFacetSidebarRoomWidth: the room the sidebar shares with the list", () => {
  test("is its parent's content box", () => {
    const panel: HTMLElement = newPanel();
    const room: HTMLElement = panel.parentElement as HTMLElement;
    room.style.paddingLeft = "16px";
    room.style.paddingRight = "16px";
    Object.defineProperty(room, "clientWidth", {
      configurable: true,
      value: 1232,
    });

    expect(getFacetSidebarRoomWidth(panel)).toBe(1200);
  });

  test("is nothing for a sidebar not on the page", () => {
    expect(getFacetSidebarRoomWidth(document.createElement("div"))).toBe(0);
  });

  test("is never less than nothing", () => {
    const panel: HTMLElement = newPanel();
    const room: HTMLElement = panel.parentElement as HTMLElement;
    room.style.paddingLeft = "40px";
    Object.defineProperty(room, "clientWidth", {
      configurable: true,
      value: 10,
    });

    expect(getFacetSidebarRoomWidth(panel)).toBe(0);
  });
});

describe("the sidebar as drawn", () => {
  test("its width is its box's", () => {
    const panel: HTMLElement = newPanel();
    layOut(panel, { left: 0, width: 318.5 });

    expect(getFacetSidebarDrawnWidth(panel)).toBe(318.5);
  });

  test("a page read left to right is not read right to left", () => {
    expect(isFacetSidebarRightToLeft(newPanel())).toBe(false);
  });
});
