import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

import CollapsibleSection from "../../../UI/Components/CollapsibleSection/CollapsibleSection";

/*
 * The monitor criteria form is built out of these, and the tall ones -
 * Actions, with two incident templates, their owners and their on-call
 * policies - used to have their last fields cut off: the expanded panel
 * carried `max-h-[5000px] overflow-hidden`, so anything past that height
 * was clipped with no scrollbar and nothing on screen saying so.
 */

function panelOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector("div.transition-all");
}

describe("CollapsibleSection", () => {
  afterEach(() => {
    cleanup();
  });

  test("an expanded section puts no height cap on its content", () => {
    const rendered: { container: HTMLElement } = render(
      <CollapsibleSection title="Actions">
        <div>Body</div>
      </CollapsibleSection>,
    );

    const panel: HTMLElement | null = panelOf(rendered.container);

    expect(panel).not.toBeNull();
    expect(panel?.className).not.toContain("max-h-");
    expect(panel?.className).not.toContain("overflow-hidden");
  });

  test("a collapsed section is still collapsed to nothing", () => {
    const rendered: { container: HTMLElement } = render(
      <CollapsibleSection title="Actions" defaultCollapsed={true}>
        <div>Body</div>
      </CollapsibleSection>,
    );

    const panel: HTMLElement | null = panelOf(rendered.container);

    expect(panel?.className).toContain("max-h-0");
    expect(panel?.className).toContain("overflow-hidden");
  });

  test("clicking the header toggles the section", () => {
    const rendered: { container: HTMLElement } = render(
      <CollapsibleSection title="Actions">
        <div>Body</div>
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByText("Actions"));

    expect(panelOf(rendered.container)?.className).toContain("max-h-0");

    fireEvent.click(screen.getByText("Actions"));

    expect(panelOf(rendered.container)?.className).not.toContain("max-h-0");
  });

  test("the badge summarises a section only while it is closed", () => {
    render(
      <CollapsibleSection title="Filters" badge="2 filters">
        <div>Body</div>
      </CollapsibleSection>,
    );

    expect(screen.queryByText("2 filters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Filters"));

    expect(screen.getByText("2 filters")).toBeInTheDocument();
  });
});
