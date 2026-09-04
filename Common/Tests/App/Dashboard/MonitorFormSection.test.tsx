import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MonitorFormSection from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorFormSection";

afterEach(cleanup);

describe("Monitor editor disclosures", () => {
  test("closed sections expose their summary but hide their controls from assistive technology", () => {
    render(
      <MonitorFormSection
        title="Advanced settings"
        description="Timeout and retries"
        badge="Customized"
      >
        <input aria-label="Timeout" defaultValue="30" />
      </MonitorFormSection>,
    );
    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Advanced settings",
    });
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Customized")).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Timeout" }),
    ).not.toBeInTheDocument();
    expect(
      document.getElementById(toggle.getAttribute("aria-controls")!),
    ).toHaveAttribute("hidden");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Timeout" })).toHaveValue("30");
  });

  test("collapsing and reopening preserves an unsaved input and never submits its surrounding form", () => {
    const submit: (event: React.FormEvent) => void = jest.fn(
      (event: React.FormEvent): void => {
        event.preventDefault();
      },
    );
    render(
      <form onSubmit={submit}>
        <MonitorFormSection title="Details" defaultCollapsed={false}>
          <input aria-label="Draft" defaultValue="Saved text" />
        </MonitorFormSection>
      </form>,
    );
    const input: HTMLElement = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.change(input, { target: { value: "Unsaved text" } });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
    expect(input).toHaveValue("Unsaved text");
    expect(submit).not.toHaveBeenCalled();
  });

  test("controlled sections report the next state without overriding the parent", () => {
    const onToggle: jest.Mock = jest.fn();
    const { rerender } = render(
      <MonitorFormSection
        title="Actions"
        isCollapsed={true}
        onToggle={onToggle}
      >
        <input aria-label="Action" />
      </MonitorFormSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    rerender(
      <MonitorFormSection
        title="Actions"
        isCollapsed={false}
        onToggle={onToggle}
      >
        <input aria-label="Action" />
      </MonitorFormSection>,
    );
    expect(screen.getByRole("textbox")).toBeVisible();
  });

  test("each disclosure controls its own unique region and auxiliary controls do not toggle it", () => {
    render(
      <>
        <MonitorFormSection
          title="First"
          rightElement={<button type="button">Help</button>}
        >
          <input aria-label="First input" />
        </MonitorFormSection>
        <MonitorFormSection title="Second">
          <input aria-label="Second input" />
        </MonitorFormSection>
      </>,
    );
    const first: HTMLElement = screen.getByRole("button", { name: "First" });
    const second: HTMLElement = screen.getByRole("button", { name: "Second" });
    expect(first.getAttribute("aria-controls")).not.toBe(
      second.getAttribute("aria-controls"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(first).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("textbox", { name: "Second input" })).toBeVisible();
  });
});
