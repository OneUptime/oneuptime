import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import * as React from "react";
import TelemetryDetailPanel, {
  TelemetryDetailPanelProps,
  TelemetryDetailPanelTab,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryDetailPanel";
import getJestMockFunction, { MockFunction } from "../../MockType";

const tabs: Array<TelemetryDetailPanelTab> = [
  { id: "session", label: "Session", content: <p>Session content</p> },
  { id: "privacy", label: "Privacy", content: <p>Privacy content</p> },
  {
    id: "fidelity",
    label: "Fidelity",
    badge: 2,
    content: <p>Fidelity content</p>,
  },
];

function makeProps(
  overrides?: Partial<TelemetryDetailPanelProps>,
): TelemetryDetailPanelProps {
  return {
    isOpen: true,
    title: "Session details",
    subtitle: "Session abc123",
    onClose: (): void => {
      // asserted by individual tests
    },
    tabs,
    activeTabId: "session",
    onTabChange: (): void => {
      // asserted by individual tests
    },
    ...overrides,
  };
}

describe("TelemetryDetailPanel accessibility", () => {
  it("renders a named modal dialog with its header content", () => {
    render(
      <TelemetryDetailPanel
        {...makeProps({
          headerActions: <button type="button">Copy ID</button>,
        })}
      />,
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Session details",
    });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("Session abc123")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Copy ID" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Close details panel" }),
    ).toHaveAttribute("title", "Close (Esc)");
  });

  it("associates every tab with a panel while exposing only the active one", () => {
    render(<TelemetryDetailPanel {...makeProps()} />);

    const tabList: HTMLElement = screen.getByRole("tablist", {
      name: "Detail sections",
    });
    const sessionTab: HTMLElement = within(tabList).getByRole("tab", {
      name: "Session",
    });
    const fidelityTab: HTMLElement = within(tabList).getByRole("tab", {
      name: /Fidelity/,
    });
    const panel: HTMLElement = screen.getByRole("tabpanel", {
      name: "Session",
    });

    expect(sessionTab).toHaveAttribute("aria-selected", "true");
    expect(sessionTab).toHaveAttribute("tabindex", "0");
    expect(fidelityTab).toHaveAttribute("aria-selected", "false");
    expect(fidelityTab).toHaveAttribute("tabindex", "-1");
    expect(sessionTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", sessionTab.id);
    expect(panel).toHaveTextContent("Session content");
    expect(sessionTab).toHaveFocus();
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(3);

    for (const tab of within(tabList).getAllByRole("tab")) {
      const controlledPanelId: string | null =
        tab.getAttribute("aria-controls");

      expect(controlledPanelId).not.toBeNull();
      expect(
        document.getElementById(controlledPanelId as string),
      ).not.toBeNull();
    }

    expect(screen.queryByText("Privacy content")).not.toBeInTheDocument();
    expect(screen.queryByText("Fidelity content")).not.toBeInTheDocument();
  });

  it("keeps tab selection controlled by the host", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    render(
      <TelemetryDetailPanel
        {...makeProps({ onTabChange: onTabChange as (id: string) => void })}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Privacy" }));

    expect(onTabChange).toHaveBeenCalledWith("privacy");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Session content");
    expect(screen.getByRole("tab", { name: "Session" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("supports arrow, Home and End navigation across tabs", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    render(
      <TelemetryDetailPanel
        {...makeProps({ onTabChange: onTabChange as (id: string) => void })}
      />,
    );

    const session: HTMLElement = screen.getByRole("tab", { name: "Session" });
    const privacy: HTMLElement = screen.getByRole("tab", { name: "Privacy" });
    const fidelity: HTMLElement = screen.getByRole("tab", {
      name: /Fidelity/,
    });

    session.focus();
    fireEvent.keyDown(session, { key: "ArrowRight" });
    expect(onTabChange).toHaveBeenLastCalledWith("privacy");
    expect(privacy).toHaveFocus();

    fireEvent.keyDown(privacy, { key: "End" });
    expect(onTabChange).toHaveBeenLastCalledWith("fidelity");
    expect(fidelity).toHaveFocus();

    fireEvent.keyDown(fidelity, { key: "ArrowRight" });
    expect(onTabChange).toHaveBeenLastCalledWith("session");
    expect(session).toHaveFocus();

    fireEvent.keyDown(session, { key: "ArrowLeft" });
    expect(onTabChange).toHaveBeenLastCalledWith("fidelity");
    expect(fidelity).toHaveFocus();

    fireEvent.keyDown(fidelity, { key: "Home" });
    expect(onTabChange).toHaveBeenLastCalledWith("session");
    expect(session).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab focus inside a floating panel", () => {
    render(<TelemetryDetailPanel {...makeProps()} />);

    const closeButton: HTMLElement = screen.getByRole("button", {
      name: "Close details panel",
    });
    const activePanel: HTMLElement = screen.getByRole("tabpanel", {
      name: "Session",
    });

    activePanel.focus();
    fireEvent.keyDown(activePanel, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(activePanel).toHaveFocus();
  });

  it("returns focus to the opener after the floating panel closes", () => {
    const FocusHarness: React.FunctionComponent = () => {
      const [isOpen, setIsOpen] = React.useState<boolean>(false);

      return (
        <React.Fragment>
          <button
            type="button"
            onClick={(): void => {
              setIsOpen(true);
            }}
          >
            Open session details
          </button>
          <TelemetryDetailPanel
            {...makeProps({
              isOpen,
              onClose: (): void => {
                setIsOpen(false);
              },
            })}
          />
        </React.Fragment>
      );
    };

    render(<FocusHarness />);

    const opener: HTMLElement = screen.getByRole("button", {
      name: "Open session details",
    });

    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("tab", { name: "Session" })).toHaveFocus();

    fireEvent.click(
      screen.getByRole("button", { name: "Close details panel" }),
    );

    expect(opener).toHaveFocus();
  });
});

describe("TelemetryDetailPanel dismissal and variants", () => {
  it("calls onClose from both the close button and Escape", () => {
    const onClose: MockFunction = getJestMockFunction();

    render(
      <TelemetryDetailPanel
        {...makeProps({ onClose: onClose as () => void })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Close details panel" }),
    );
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes from the floating backdrop", () => {
    const onClose: MockFunction = getJestMockFunction();
    const { container } = render(
      <TelemetryDetailPanel
        {...makeProps({ onClose: onClose as () => void })}
      />,
    );
    const backdrop: Element | null = container.querySelector(
      'div.fixed.inset-0[aria-hidden="true"]',
    );

    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an embedded region without modal or backdrop semantics", () => {
    const { container } = render(
      <TelemetryDetailPanel
        {...makeProps({
          variant: "embedded",
          tabs: [tabs[0] as TelemetryDetailPanelTab],
        })}
      />,
    );

    const region: HTMLElement = screen.getByRole("region", {
      name: "Session details",
    });

    expect(region).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(screen.getByText("Session content")).toBeInTheDocument();
    expect(
      container.querySelector('div.fixed.inset-0[aria-hidden="true"]'),
    ).not.toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    render(<TelemetryDetailPanel {...makeProps({ isOpen: false })} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Session details")).not.toBeInTheDocument();
  });
});

describe("TelemetryDetailPanel width", () => {
  it("caps the default 38rem drawer at the viewport so phones can reach its left edge", () => {
    render(<TelemetryDetailPanel {...makeProps()} />);

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Session details",
    });

    expect(dialog).toHaveClass("fixed", "right-0", "w-[38rem]", "max-w-full");
  });

  it("uses a caller's width classes in place of the default, cap included", () => {
    render(
      <TelemetryDetailPanel
        {...makeProps({ widthClassName: "w-[64rem] max-w-[95vw]" })}
      />,
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Session details",
    });

    expect(dialog).toHaveClass("w-[64rem]", "max-w-[95vw]");
    expect(dialog).not.toHaveClass("w-[38rem]");
    expect(dialog).not.toHaveClass("max-w-full");
  });
});
