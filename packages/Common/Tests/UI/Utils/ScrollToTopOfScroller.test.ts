import { scrollToTopOfScroller } from "../../../UI/Utils/ScrollToTopOfScroller";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Utils/ScrollToTopOfScroller: the box an element scrolls in brought back to
 * its top - the first box around it that scrolls and has more than it shows.
 * Shared by the discovery import dialog's steps and the Traffic pages' whole
 * lists (issue #5762), whose next page opened at the foot it was asked for
 * from.
 */

function box(overflowY: string, scrollHeight: number): HTMLDivElement {
  const element: HTMLDivElement = document.createElement("div");

  element.style.overflowY = overflowY;
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: 600,
  });

  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("scrollToTopOfScroller", () => {
  test("the dialog's body that scrolls goes back to its top", () => {
    const body: HTMLDivElement = box("auto", 2400);
    const list: HTMLDivElement = document.createElement("div");

    body.appendChild(list);
    document.body.appendChild(body);
    body.scrollTop = 1800;

    scrollToTopOfScroller(list);

    expect(body.scrollTop).toBe(0);
  });

  test("a scroll box counts as one too", () => {
    const body: HTMLDivElement = box("scroll", 2400);
    const list: HTMLDivElement = document.createElement("div");

    body.appendChild(list);
    document.body.appendChild(body);
    body.scrollTop = 900;

    scrollToTopOfScroller(list);

    expect(body.scrollTop).toBe(0);
  });

  test("only the nearest one that scrolls: a box that does not is passed over, one further out is left alone", () => {
    const page: HTMLDivElement = box("auto", 5000);
    const body: HTMLDivElement = box("auto", 2400);
    const between: HTMLDivElement = box("visible", 2400);
    const list: HTMLDivElement = document.createElement("div");

    page.appendChild(body);
    body.appendChild(between);
    between.appendChild(list);
    document.body.appendChild(page);
    page.scrollTop = 300;
    body.scrollTop = 1800;
    between.scrollTop = 0;

    scrollToTopOfScroller(list);

    expect(body.scrollTop).toBe(0);
    expect(page.scrollTop).toBe(300);
  });

  test("a box with nothing more than it shows is no scroller: the next one out is", () => {
    const page: HTMLDivElement = box("auto", 5000);
    const short: HTMLDivElement = box("auto", 600);
    const list: HTMLDivElement = document.createElement("div");

    page.appendChild(short);
    short.appendChild(list);
    document.body.appendChild(page);
    page.scrollTop = 1200;

    scrollToTopOfScroller(list);

    expect(page.scrollTop).toBe(0);
  });

  test("the element's own scroll is never touched - only what it scrolls in", () => {
    const body: HTMLDivElement = box("auto", 2400);
    const list: HTMLDivElement = box("auto", 3000);

    body.appendChild(list);
    document.body.appendChild(body);
    body.scrollTop = 500;
    list.scrollTop = 700;

    scrollToTopOfScroller(list);

    expect(list.scrollTop).toBe(700);
    expect(body.scrollTop).toBe(0);
  });

  test("nothing to scroll, or nothing at all: nothing happens, nothing throws", () => {
    expect(() => {
      scrollToTopOfScroller(null);
      scrollToTopOfScroller(document.createElement("div"));
    }).not.toThrow();
  });
});
