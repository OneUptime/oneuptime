import { describe, expect, test } from "@jest/globals";
import { isRowAtWidth, resolveFlex } from "./ResponsiveFlexLayout";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
} from "./ResponsiveVisibility";

describe("resolveFlex", () => {
  test("a property no utility sets keeps its initial value", () => {
    expect(resolveFlex("flex gap-2", PHONE_WIDTH_IN_PX, "flex-direction")).toBe(
      "row",
    );
    expect(resolveFlex("flex", PHONE_WIDTH_IN_PX, "flex-wrap")).toBe("nowrap");
    expect(resolveFlex("flex", PHONE_WIDTH_IN_PX, "justify-content")).toBe(
      "normal",
    );
    expect(resolveFlex("flex", PHONE_WIDTH_IN_PX, "align-items")).toBe(
      "stretch",
    );
    expect(resolveFlex(null, PHONE_WIDTH_IN_PX, "flex-wrap")).toBe("nowrap");
  });

  test("a screen variant takes over from its width up", () => {
    const className: string = "flex flex-col md:flex-row";

    expect(resolveFlex(className, PHONE_WIDTH_IN_PX, "flex-direction")).toBe(
      "column",
    );
    expect(resolveFlex(className, TABLET_WIDTH_IN_PX, "flex-direction")).toBe(
      "row",
    );
    expect(resolveFlex(className, LAPTOP_WIDTH_IN_PX, "flex-direction")).toBe(
      "row",
    );
  });

  test("a max- variant applies only below its width", () => {
    const className: string = "flex flex-row max-md:flex-col";

    expect(resolveFlex(className, PHONE_WIDTH_IN_PX, "flex-direction")).toBe(
      "column",
    );
    expect(resolveFlex(className, TABLET_WIDTH_IN_PX, "flex-direction")).toBe(
      "row",
    );
  });

  test("inside one screen the later utility of the family wins, in either order", () => {
    expect(
      resolveFlex("flex-nowrap flex-wrap", PHONE_WIDTH_IN_PX, "flex-wrap"),
    ).toBe("nowrap");
    expect(
      resolveFlex("flex-wrap flex-nowrap", PHONE_WIDTH_IN_PX, "flex-wrap"),
    ).toBe("nowrap");
    expect(
      resolveFlex(
        "justify-center justify-end",
        PHONE_WIDTH_IN_PX,
        "justify-content",
      ),
    ).toBe("center");
  });

  test("the wider screen wins over the narrower one", () => {
    const className: string =
      "items-center md:items-start lg:items-end flex-wrap md:flex-nowrap";

    expect(resolveFlex(className, PHONE_WIDTH_IN_PX, "align-items")).toBe(
      "center",
    );
    expect(resolveFlex(className, TABLET_WIDTH_IN_PX, "align-items")).toBe(
      "flex-start",
    );
    expect(resolveFlex(className, LAPTOP_WIDTH_IN_PX, "align-items")).toBe(
      "flex-end",
    );
    expect(resolveFlex(className, PHONE_WIDTH_IN_PX, "flex-wrap")).toBe("wrap");
    expect(resolveFlex(className, LAPTOP_WIDTH_IN_PX, "flex-wrap")).toBe(
      "nowrap",
    );
  });

  test("state and arbitrary variants cannot answer a layout question", () => {
    const className: string =
      "flex-row hover:flex-col dark:flex-col [&>div]:flex-col group-hover:flex-col";

    expect(resolveFlex(className, PHONE_WIDTH_IN_PX, "flex-direction")).toBe(
      "row",
    );
  });

  test("!important beats a later screen", () => {
    expect(
      resolveFlex(
        "!justify-start md:justify-end",
        LAPTOP_WIDTH_IN_PX,
        "justify-content",
      ),
    ).toBe("flex-start");
  });

  test("isRowAtWidth reads the direction of an element", () => {
    const element: HTMLDivElement = document.createElement("div");
    element.className = "flex flex-col lg:flex-row";

    expect(isRowAtWidth(element, TABLET_WIDTH_IN_PX)).toBe(false);
    expect(isRowAtWidth(element, LAPTOP_WIDTH_IN_PX)).toBe(true);
    expect(isRowAtWidth(null, LAPTOP_WIDTH_IN_PX)).toBe(false);
  });
});
