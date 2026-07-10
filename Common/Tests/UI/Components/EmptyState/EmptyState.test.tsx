import EmptyState from "../../../../UI/Components/EmptyState/EmptyState";
import {
  SurfaceStyle,
  SurfaceStyleProvider,
} from "../../../../UI/Contexts/SurfaceStyleContext";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import IconProp from "../../../../Types/Icon/IconProp";
import React from "react";

describe("EmptyState", () => {
  test("renders correctly with all props", () => {
    const { container } = render(
      <EmptyState
        id="empty-state"
        title="Empty State Title"
        description="This is an empty state description"
        icon={IconProp.User}
        footer={<div>This is a footer element</div>}
      />,
    );
    const titleElement: HTMLElement = screen.getByText("Empty State Title");
    const descriptionElement: HTMLElement =
      screen.getByText("Empty State Title");
    // The icon renders an inline <svg> (no invalid role="icon"; WCAG 4.1.2).
    const iconElement: Element | null = container.querySelector("svg");
    const footerElement: HTMLElement = screen.getByText(
      "This is a footer element",
    );
    expect(titleElement).toBeInTheDocument();
    expect(descriptionElement).toBeInTheDocument();
    expect(iconElement).not.toBeNull();
    expect(footerElement).toBeInTheDocument();
  });
  test("renders without an icon", () => {
    render(
      <EmptyState
        id="empty-state"
        icon={undefined}
        title="Title"
        description="Description"
      />,
    );
    const title: HTMLElement = screen.getByText("Title");
    const description: HTMLElement = screen.getByText("Description");
    expect(title).toBeInTheDocument();
    expect(description).toBeInTheDocument();
  });

  test("renders a compact quiet surface with its content intact", () => {
    render(
      <SurfaceStyleProvider style={SurfaceStyle.Quiet}>
        <EmptyState
          id="quiet-empty-state"
          icon={IconProp.User}
          title="Nothing here yet"
          description="New items will appear here."
          footer={<button type="button">Create item</button>}
          showSolidBackground={true}
        />
      </SurfaceStyleProvider>,
    );

    const emptyState: HTMLElement = document.getElementById(
      "quiet-empty-state",
    ) as HTMLElement;

    expect(emptyState).toHaveClass(
      "min-h-64",
      "px-6",
      "py-16",
      "rounded-lg",
      "border",
      "border-slate-200",
      "bg-white",
    );
    expect(emptyState).not.toHaveClass("shadow");
    expect(screen.getByText("Nothing here yet")).toHaveClass("text-slate-900");
    expect(screen.getByText("New items will appear here.")).toHaveClass(
      "text-slate-500",
    );
    expect(
      screen.getByRole("button", { name: "Create item" }),
    ).toBeInTheDocument();
  });
});
