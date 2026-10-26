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
