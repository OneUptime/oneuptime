import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  SECURITY_ENTITY_CHIP_VALUE_CLASS_NAME,
  SECURITY_ENTITY_CHIP_WRAPPED_VALUE_CLASS_NAME,
  SecurityEntityChip,
  getCorrelateRouteForEntity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityEntityChips";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import IsolatedText from "../../../UI/Components/IsolatedText/IsolatedText";
import { routeFor } from "./SideMenuHarness";

/*
 * THE SECURITY ENTITY CHIP ON A PAGE THAT READS RIGHT TO LEFT.
 *
 * An entity's value - an account, a host, an address - is someone's data,
 * written in their language whatever the page's. In a plain span on a
 * Persian page (#5312) a long value was cut at its START: Entity Risk's
 * list read "...morgan@acme-commerce.example", the account's own first
 * letters gone. In an isolate that reads the way most of its letters do
 * (IsolatedText), the isolate is what cuts it short - at its own end -
 * and keeps its title: the value whole, or what the chip opens. Entity
 * Risk's list, a case's Entities, its Detections and Look Up an Entity
 * draw this one chip.
 *
 * And where a chip's Correlate opens over: the hours a page that read the
 * value's activity read (Look Up an Entity's 30 days), else Correlate's own.
 */

afterEach(() => {
  cleanup();
});

function drawChip(
  value: string,
  options: { isLink?: boolean; isValueWrapped?: boolean } = {},
): HTMLElement {
  render(
    <MemoryRouter>
      <SecurityEntityChip
        entity={{ type: SecurityEntityType.User, value }}
        isLink={options.isLink}
        isValueWrapped={options.isValueWrapped}
      />
    </MemoryRouter>,
  );

  return screen.getByText(value);
}

describe("a chip's value", () => {
  test("is an isolate that reads the way it is written, and cuts itself short", () => {
    const value: HTMLElement = drawChip("k.morgan@acme-commerce.example", {
      isLink: false,
    });

    expect(value.tagName).toBe("BDI");
    expect(value).toHaveAttribute("dir", "ltr");
    // The isolate is the box that cuts it: at its own end, on any page.
    expect(value.className).toBe(SECURITY_ENTITY_CHIP_VALUE_CLASS_NAME);
    expect(SECURITY_ENTITY_CHIP_VALUE_CLASS_NAME.split(" ")).toContain(
      "truncate",
    );
    // Whole under the pointer.
    expect(value).toHaveAttribute("title", "k.morgan@acme-commerce.example");
  });

  test("a value written right to left reads so on any page; one with no letters is left to the isolate's own reading", () => {
    expect(drawChip("سرور-پرداخت-۲", { isLink: false })).toHaveAttribute(
      "dir",
      "rtl",
    );
    cleanup();

    const address: HTMLElement = drawChip("203.0.113.47", { isLink: false });
    expect(address.tagName).toBe("BDI");
    expect(address).not.toHaveAttribute("dir");
  });

  test("a chip that opens Correlate says so under the pointer, on the value", () => {
    const value: HTMLElement = drawChip("fin-ws-112");

    expect(value.tagName).toBe("BDI");
    expect(value).toHaveAttribute(
      "title",
      "User: fin-ws-112 - open it in Correlate",
    );
    expect(value.closest("a")).toHaveAttribute(
      "href",
      getCorrelateRouteForEntity("fin-ws-112").toString(),
    );
  });

  test("a wrapped value is an isolate too, broken where it must be rather than cut", () => {
    const value: HTMLElement = drawChip(
      "svc-payments-reconciliation-nightly@acme-commerce-holdings.example",
      { isLink: false, isValueWrapped: true },
    );

    expect(value.tagName).toBe("BDI");
    expect(value.className).toBe(SECURITY_ENTITY_CHIP_WRAPPED_VALUE_CLASS_NAME);
    expect(value.className).not.toContain("truncate");
  });
});

describe("IsolatedText's title", () => {
  test("is on the isolate when given, and absent when not", () => {
    render(
      <div>
        <IsolatedText text="web-03" title="Host: web-03" />
        <IsolatedText text="web-04" />
      </div>,
    );

    expect(screen.getByText("web-03")).toHaveAttribute("title", "Host: web-03");
    expect(screen.getByText("web-04")).not.toHaveAttribute("title");
  });
});

describe("where a chip's Correlate opens over", () => {
  test("Correlate's own window, unless a page read the value over hours of its own", () => {
    const own: URL = new URL(
      getCorrelateRouteForEntity("fin-ws-112").toString(),
      "https://oneuptime.example",
    );

    expect(own.pathname).toBe(routeFor(PageMap.SECURITY_EVENTS_CORRELATE));
    expect(own.searchParams.get("observable")).toBe("fin-ws-112");
    expect(own.searchParams.has("hours")).toBe(false);

    const month: URL = new URL(
      getCorrelateRouteForEntity("fin-ws-112", 720).toString(),
      "https://oneuptime.example",
    );

    expect(month.searchParams.get("observable")).toBe("fin-ws-112");
    expect(month.searchParams.get("hours")).toBe("720");

    // Never a window that is not one.
    for (const hours of [0, -24, 1.5, Number.NaN]) {
      expect([
        hours,
        new URL(
          getCorrelateRouteForEntity("fin-ws-112", hours).toString(),
          "https://oneuptime.example",
        ).searchParams.has("hours"),
      ]).toEqual([hours, false]);
    }
  });
});
