import InfoCard, {
  INFO_CARD_VALUE_WRAP_CLASS_NAME,
} from "../../../UI/Components/InfoCard/InfoCard";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Follow-up of #5076: a Swarm task's 64-character Container ID ran out of
 * its card, and out of the grid the cards sit in, on a phone. A value with
 * no place to break now breaks anywhere it has to - which also lets the
 * card shrink to its grid column - while text that fits is drawn as
 * before. Every InfoCard draws its value this way: the stat tiles, the
 * Kubernetes, Proxmox, Docker Swarm, Ceph and VMware summaries, the
 * network strips. jsdom cannot measure, so this holds the value to the
 * classes; the offline browser suite measures a phone's width.
 */

const CONTAINER_ID: string =
  "6f3c2a91d8b74e05a1c9f0e7b2d4a6c8e1f3b5d7a9c0e2f4b6d8a0c2e4f6a8b0";

function valueOf(): HTMLElement {
  return screen.getByTestId("info-card-value");
}

function classesOf(element: HTMLElement): Array<string> {
  return element.className.split(" ").filter(Boolean);
}

afterEach(() => {
  cleanup();
});

describe("an InfoCard value with no place to break", () => {
  test("breaks anywhere it has to, and may shrink to its column", () => {
    expect(INFO_CARD_VALUE_WRAP_CLASS_NAME).toBe(
      "min-w-0 [overflow-wrap:anywhere]",
    );

    render(<InfoCard title="Container ID" value={CONTAINER_ID} />);

    expect(valueOf()).toHaveTextContent(CONTAINER_ID);
    for (const className of INFO_CARD_VALUE_WRAP_CLASS_NAME.split(" ")) {
      expect(classesOf(valueOf())).toContain(className);
    }
  });

  test("the same on a card that navigates and has an (i)", () => {
    render(
      <InfoCard
        title="Container ID"
        value={CONTAINER_ID}
        tooltip="The task's container on its node."
        onClick={(): void => {}}
      />,
    );

    for (const className of INFO_CARD_VALUE_WRAP_CLASS_NAME.split(" ")) {
      expect(classesOf(valueOf())).toContain(className);
    }
  });

  test("the same on a card that toggles", () => {
    render(
      <InfoCard
        title="Container ID"
        value={CONTAINER_ID}
        onClick={(): void => {}}
        isSelected={false}
      />,
    );

    for (const className of INFO_CARD_VALUE_WRAP_CLASS_NAME.split(" ")) {
      expect(classesOf(valueOf())).toContain(className);
    }
  });

  test("a page's own text style is kept beside it", () => {
    render(
      <InfoCard
        title="State"
        value="Running"
        textClassName="text-2xl font-semibold text-emerald-700"
      />,
    );

    expect(classesOf(valueOf())).toEqual(
      expect.arrayContaining([
        "min-w-0",
        "[overflow-wrap:anywhere]",
        "text-2xl",
        "font-semibold",
        "text-emerald-700",
      ]),
    );
    // A page's style replaces the default text colour, as it always did.
    expect(classesOf(valueOf())).not.toContain("text-gray-900");
  });

  test("without a page's style the value keeps its default colour", () => {
    render(<InfoCard title="Restarts" value="0" />);

    expect(classesOf(valueOf())).toContain("text-gray-900");
  });

  test("an element value is drawn inside the same wrapper", () => {
    render(
      <InfoCard
        title="State"
        value={<span data-testid="state-badge">Running</span>}
      />,
    );

    expect(valueOf()).toContainElement(screen.getByTestId("state-badge"));
  });
});

/*
 * #5298's UI review: left to overflow-wrap alone, a value that names
 * something broke at whatever letter filled the line - a Swarm task's image
 * read "registry.acme-swarm.example/shop/checkout:2.7." / "0" on a phone. A
 * text value is drawn through BreakableName now: it may break after its own
 * dots and slashes first, and anywhere only where a part is still too long
 * for its line (the container ID above).
 */
describe("an InfoCard text value that names something", () => {
  const IMAGE: string = "registry.acme-swarm.example/shop/checkout:2.7.0";

  // The text between the <wbr>s of the value.
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

  test("breaks after its registry and its path's slashes, never inside its version", () => {
    render(<InfoCard title="Image" value={IMAGE} />);

    expect(partsOf(valueOf())).toEqual([
      "registry.",
      "acme-swarm.",
      "example/",
      "shop/",
      "checkout:2.7.0",
    ]);
    // Read, copied and found as written: a <wbr> adds no character.
    expect(valueOf().textContent).toBe(IMAGE);
    expect(screen.getByText(IMAGE)).toBe(valueOf());
  });

  test("the same on a card that navigates and has an (i), whose button still reads the value", () => {
    render(
      <InfoCard
        title="Image"
        value={IMAGE}
        tooltip="What the task runs."
        onClick={(): void => {}}
      />,
    );

    expect(valueOf().querySelectorAll("wbr").length).toBeGreaterThan(0);
    expect(valueOf().textContent).toBe(IMAGE);
    expect(screen.getByRole("button", { name: `Image ${IMAGE}` })).toBeTruthy();
  });

  test("a task's id breaks after its kind", () => {
    render(
      <InfoCard title="External ID" value="task/x7k2m9p4q1r8s5t3v6w0y2z4a" />,
    );

    expect(partsOf(valueOf())).toEqual(["task/", "x7k2m9p4q1r8s5t3v6w0y2z4a"]);
  });

  test("a value with nowhere to break, a number or a short word gets no breaks", () => {
    for (const value of [CONTAINER_ID, "3.4%", "175 MiB / 512 MiB", "shop"]) {
      render(<InfoCard title="Value" value={value} />);
      expect(valueOf().querySelectorAll("wbr")).toHaveLength(0);
      expect(valueOf().textContent).toBe(value);
      cleanup();
    }
  });

  test("an element value is the page's to draw: no breaks are added to it", () => {
    render(
      <InfoCard
        title="Image"
        value={<span data-testid="image-link">{IMAGE}</span>}
      />,
    );

    expect(valueOf().querySelectorAll("wbr")).toHaveLength(0);
    expect(screen.getByTestId("image-link").textContent).toBe(IMAGE);
  });
});
