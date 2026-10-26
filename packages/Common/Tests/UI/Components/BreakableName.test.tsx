import BreakableName from "../../../UI/Components/BreakableName/BreakableName";
import { splitAtNameBreaks } from "../../../Utils/NameBreaks";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React from "react";

/*
 * BreakableName draws text that may hold a long name - a metric, an image,
 * an id - with a <wbr> after each of the name's own dots and slashes
 * (Utils/NameBreaks), so a box narrower than the name breaks it there
 * first: "registry.example/shop/" / "checkout:2.7.0", never
 * "checkout:2.7." / "0", and "container.blockio." /
 * "io_service_bytes_recursive", never "io_service_b" / "ytes". The text is
 * unchanged - a <wbr> adds no character - so a copy, a search and a screen
 * reader read it as written. It is the one place InfoCard values, the
 * metrics list's names, ResourceOverview's Details values, a finding's
 * title and Markdown's inline code get their breaks from.
 */

// The text between the <wbr>s of what was drawn inside `holder`.
function partsOf(holder: HTMLElement): Array<string> {
  const parts: Array<string> = [""];

  for (const node of Array.from(holder.childNodes)) {
    if (node.nodeName === "WBR") {
      parts.push("");
      continue;
    }
    parts[parts.length - 1] += node.textContent || "";
  }

  return parts;
}

function draw(text: string): HTMLElement {
  render(
    <span data-testid="holder">
      <BreakableName text={text} />
    </span>,
  );
  return screen.getByTestId("holder");
}

afterEach(() => {
  cleanup();
});

describe("BreakableName", () => {
  test("an image breaks after its registry, its path's slashes, never inside its version", () => {
    const image: string = "registry.acme-swarm.example/shop/checkout:2.7.0";
    const holder: HTMLElement = draw(image);

    expect(partsOf(holder)).toEqual([
      "registry.",
      "acme-swarm.",
      "example/",
      "shop/",
      "checkout:2.7.0",
    ]);
    expect(holder.textContent).toBe(image);
  });

  test("a metric's name breaks after each dot before a word", () => {
    const holder: HTMLElement = draw(
      "container.blockio.io_service_bytes_recursive",
    );

    expect(partsOf(holder)).toEqual([
      "container.",
      "blockio.",
      "io_service_bytes_recursive",
    ]);
  });

  test("a task's id breaks after its kind", () => {
    const holder: HTMLElement = draw("task/x7k2m9p4q1r8s5t3v6w0y2z4a");

    expect(partsOf(holder)).toEqual(["task/", "x7k2m9p4q1r8s5t3v6w0y2z4a"]);
  });

  test("a value with nowhere to break is drawn whole, with no <wbr>", () => {
    const containerId: string =
      "6f3c2a91d8b74e05a1c9f0e7b2d4a6c8e1f3b5d7a9c0e2f4b6d8a0c2e4f6a8b0";
    const holder: HTMLElement = draw(containerId);

    expect(holder.querySelectorAll("wbr")).toHaveLength(0);
    expect(holder.textContent).toBe(containerId);
  });

  test("short names and plain sentences are drawn as written", () => {
    for (const text of [
      "user.id",
      "2.7.0",
      "Session replay is switched off for this project",
      "4.8 GB of 16 GB",
      "",
    ]) {
      const holder: HTMLElement = draw(text);

      expect(holder.querySelectorAll("wbr")).toHaveLength(0);
      expect(holder.textContent).toBe(text);
      cleanup();
    }
  });

  test("a sentence keeps its spaces and breaks only inside its long names", () => {
    const sentence: string =
      "Reads http.server.request.duration from checkout every minute";
    const holder: HTMLElement = draw(sentence);

    expect(holder.textContent).toBe(sentence);
    expect(partsOf(holder)).toEqual([
      "Reads http.",
      "server.",
      "request.",
      "duration from checkout every minute",
    ]);
  });

  test("draws exactly the parts NameBreaks splits the text into", () => {
    for (const text of [
      "com.acme-commerce.inventory.reservations",
      "arn:aws:lambda:eu-west-1:123456789012:function:resize-product-images",
      "https://registry.acme.example/v2/shop/checkout/manifests/2.7.0",
      "POST /api/orders/{id}/items",
    ]) {
      const holder: HTMLElement = draw(text);

      expect(partsOf(holder)).toEqual(
        splitAtNameBreaks(text).length > 1 ? splitAtNameBreaks(text) : [text],
      );
      expect(holder.textContent).toBe(text);
      cleanup();
    }
  });

  test("adds no element of its own around the text: the holder sets how it wraps", () => {
    const holder: HTMLElement = draw("container.network.io.usage.rx_bytes");

    for (const child of Array.from(holder.children)) {
      expect(child.tagName).toBe("WBR");
    }
  });
});
