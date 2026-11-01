import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import SetupGuideSteps, {
  SetupGuideStepView,
  getAnchoredSetupGuideStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideSteps";
import {
  PAGE_ANCHOR_LANDED_ATTRIBUTE,
  PAGE_ANCHOR_SCROLL_MARGIN_TOP,
} from "../../../UI/Utils/PageAnchor";

/*
 * A guide step with a place of its own on the page. The Proxmox Overview's
 * "Set up notifications" opened the setup guide at its top - step 1 of an
 * install the reader had already done - and left them to scroll to the
 * step that sends Proxmox VE's notifications, the fifth. A link that names
 * a step after its "#" now lands on it: brought under the sticky header,
 * kept there while the key picker above it loads, marked for a moment and
 * given the keyboard's focus, as a link to a settings card is
 * (Common/UI/Utils/PageAnchor).
 */

const STEPS: Array<SetupGuideStepView> = [
  { title: "Choose an ingestion key", content: <p>Key</p> },
  { title: "Install the agent", content: <p>Install</p> },
  {
    title: "Send Proxmox VE's notifications",
    anchor: "send-notifications",
    content: <p>Commands</p>,
  },
];

let scrolled: Array<Element> = [];

function openAt(hash: string): void {
  window.history.replaceState(null, "", `/documentation${hash}`);
}

function renderSteps(): RenderResult {
  return render(<SetupGuideSteps steps={STEPS} />);
}

beforeEach(() => {
  scrolled = [];
  // jsdom draws nothing, so it has no scrollIntoView of its own.
  Element.prototype.scrollIntoView = function (this: Element): void {
    scrolled.push(this);
  };
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  openAt("");
});

describe("a guide step with a place of its own", () => {
  test("is named by its anchor, and lands under the sticky header", () => {
    openAt("");
    const result: RenderResult = renderSteps();

    const step: HTMLElement = result.getByTestId("setup-guide-step-3");
    expect(step).toHaveAttribute("id", "send-notifications");
    expect(step.style.scrollMarginTop).toBe(PAGE_ANCHOR_SCROLL_MARGIN_TOP);
    // Steps without one carry no id and no margin.
    expect(result.getByTestId("setup-guide-step-1")).not.toHaveAttribute("id");
    expect(result.getByTestId("setup-guide-step-1").style.scrollMarginTop).toBe(
      "",
    );
  });

  test("opened at it, the guide brings it into view, marks it and gives it the focus", () => {
    openAt("#send-notifications");
    const result: RenderResult = renderSteps();
    jest.advanceTimersByTime(50);

    const step: HTMLElement = result.getByTestId("setup-guide-step-3");
    expect(scrolled).toContain(step);
    expect(step).toHaveAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE, "true");
    expect(document.activeElement).toBe(step);

    // The mark fades; the step stays where it is.
    jest.advanceTimersByTime(5000);
    expect(step).not.toHaveAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE);
  });

  test("opened at its top, or at a place this guide does not have, nothing moves", () => {
    openAt("");
    const plain: RenderResult = renderSteps();
    jest.advanceTimersByTime(50);
    expect(scrolled).toEqual([]);
    expect(plain.getByTestId("setup-guide-step-3")).not.toHaveAttribute(
      PAGE_ANCHOR_LANDED_ATTRIBUTE,
    );
    cleanup();

    openAt("#runner");
    const other: RenderResult = renderSteps();
    jest.advanceTimersByTime(50);
    expect(scrolled).toEqual([]);
    expect(other.getByTestId("setup-guide-step-3")).not.toHaveAttribute(
      PAGE_ANCHOR_LANDED_ATTRIBUTE,
    );
  });

  test("the anchored step is the guide's own, by its exact name", () => {
    expect(getAnchoredSetupGuideStep(STEPS, "send-notifications")).toBe(
      "send-notifications",
    );
    expect(getAnchoredSetupGuideStep(STEPS, "send-notification")).toBe("");
    expect(getAnchoredSetupGuideStep(STEPS, "")).toBe("");
    expect(
      getAnchoredSetupGuideStep(
        [{ title: "Install the agent", content: <p>Install</p> }],
        "send-notifications",
      ),
    ).toBe("");
  });
});
