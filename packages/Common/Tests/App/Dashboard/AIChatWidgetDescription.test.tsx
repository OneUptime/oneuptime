import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import { formatEvidenceLabel } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import { AIChatWidget, AIChatWidgetType } from "../../../Types/AI/AIChatTypes";

/*
 * A widget the AI draws - in Ask AI, in an investigation's evidence - is
 * dated by the window its tool read. Tools write that window as ISO instants
 * ("2026-09-14T17:49:05.000Z – 2026-09-14T18:04:05.000Z"), which a person
 * reads as noise. The widget's header draws them as the evidence list does,
 * in the reader's own time, and keeps the exact window as its tooltip.
 */

const WINDOW: string = "2026-09-14T17:49:05.000Z – 2026-09-14T18:04:05.000Z";

function tableWidget(description: string | undefined): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.Table,
    title: "Containers of Docker host web-1",
    description,
    data: {
      columns: [
        { key: "container", title: "Container" },
        { key: "status", title: "Status" },
      ],
      rows: [{ container: "api", status: "Reporting" }],
    },
  };
}

afterEach(() => {
  cleanup();
});

describe("a widget's description", () => {
  test("a window of ISO instants reads in the reader's time, the exact window kept as its tooltip", () => {
    render(<WidgetRenderer widgets={[tableWidget(WINDOW)]} />);

    const description: HTMLElement = screen.getByText(
      formatEvidenceLabel(WINDOW),
    );

    expect(formatEvidenceLabel(WINDOW)).not.toContain("T17:49");
    expect(description.textContent).not.toContain("2026-09-14T");
    expect(description).toHaveAttribute("title", WINDOW);
    expect(description).toHaveClass("truncate");
  });

  test("words are drawn as written", () => {
    render(
      <WidgetRenderer
        widgets={[tableWidget("Ranked by p95 · checkout-api")]}
      />,
    );

    expect(screen.getByText("Ranked by p95 · checkout-api")).toHaveAttribute(
      "title",
      "Ranked by p95 · checkout-api",
    );
  });

  test("no description, no line", () => {
    render(<WidgetRenderer widgets={[tableWidget(undefined)]} />);

    const title: HTMLElement = screen.getByText(
      "Containers of Docker host web-1",
    );

    expect(title).toBeVisible();
    // The title is the header's only line.
    expect(title.parentElement!.children).toHaveLength(1);
  });
});
