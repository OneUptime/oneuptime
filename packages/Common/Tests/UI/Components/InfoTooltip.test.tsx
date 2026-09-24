import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import InfoTooltip from "../../../UI/Components/Tooltip/InfoTooltip";

/*
 * The (i) that sits beside a metric's title and says what the metric means.
 *
 * Asserting tippy under jsdom (see DisabledButtonTooltip.test.tsx): the
 * popup is portalled to document.body, so it is queried through `screen`;
 * its box never finishes animating, so presence is asserted rather than
 * data-state.
 */

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

async function focus(trigger: HTMLElement): Promise<void> {
  act(() => {
    trigger.focus();
  });
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

const P95: string =
  "95% of page loads finished faster than this; the slowest 5% took longer.";

describe("InfoTooltip", () => {
  test("renders a button named after what it explains", () => {
    render(<InfoTooltip label="p95 duration" text={P95} />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "About p95 duration",
    });

    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "button");
  });

  test("does not create the tooltip until someone reaches for it", () => {
    render(<InfoTooltip label="p95 duration" text={P95} />);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByText(P95)).not.toBeInTheDocument();
  });

  test("shows the explanation on hover", async () => {
    render(<InfoTooltip label="p95 duration" text={P95} />);

    await hover(screen.getByRole("button", { name: "About p95 duration" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(P95);
  });

  test("shows the explanation on keyboard focus", async () => {
    render(
      <InfoTooltip label="Error rate" text="Share of events that failed." />,
    );

    await focus(screen.getByRole("button", { name: "About Error rate" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Share of events that failed.",
    );
  });

  test("links the explanation to the button for assistive technology once shown", async () => {
    render(<InfoTooltip label="p95 duration" text={P95} />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "About p95 duration",
    });

    await focus(button);
    await act(async () => {
      jest.advanceTimersByTime(50);
    });

    const describedBy: string | null = button.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      P95,
    );
  });

  test("does not mark the trigger as expandable (it is not a disclosure)", async () => {
    render(<InfoTooltip label="p95 duration" text={P95} />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "About p95 duration",
    });

    await hover(button);

    expect(button).not.toHaveAttribute("aria-expanded");
  });

  test.each([
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   \n "],
  ])(
    "renders nothing when the explanation is %s",
    (_: string, text?: string) => {
      const { container } = render(
        <InfoTooltip label="p95 duration" text={text} />,
      );

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  test("trims the explanation it shows", async () => {
    render(<InfoTooltip label="Clients" text={"  Platforms seen.  "} />);

    await hover(screen.getByRole("button", { name: "About Clients" }));

    expect(screen.getByRole("tooltip").textContent).toBe("Platforms seen.");
  });

  test("a click does not bubble, so an (i) inside a link does not navigate", () => {
    const onParentClick: jest.Mock<(event: React.MouseEvent) => void> =
      jest.fn<(event: React.MouseEvent) => void>();

    render(
      <div onClick={onParentClick}>
        <InfoTooltip label="Clients" text="Platforms seen." />
      </div>,
    );

    const notCancelled: boolean = fireEvent.click(
      screen.getByRole("button", { name: "About Clients" }),
    );

    expect(onParentClick).not.toHaveBeenCalled();
    /* fireEvent returns false when preventDefault() was called. */
    expect(notCancelled).toBe(false);
  });

  test("a click inside an anchor does not follow the link", () => {
    render(
      <a href="#/somewhere-else" data-testid="card-link">
        <span>Clients</span>
        <InfoTooltip label="Clients" text="Platforms seen." />
      </a>,
    );

    const notCancelled: boolean = fireEvent.click(
      screen.getByRole("button", { name: "About Clients" }),
    );

    expect(notCancelled).toBe(false);
  });

  test("the icon is decorative - the button's name comes from the label alone", () => {
    render(<InfoTooltip label="CPU" text="Processor time in use." />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "About CPU",
    });
    const svg: SVGElement | null = button.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector("[role='img']")).toBeNull();
  });

  test("passes the test id, extra classes and icon size through", () => {
    render(
      <InfoTooltip
        label="CPU"
        text="Processor time in use."
        dataTestId="cpu-help"
        className="ml-1"
        iconClassName="h-4 w-4"
      />,
    );

    const button: HTMLElement = screen.getByTestId("cpu-help");

    expect(button).toHaveClass("ml-1");
    expect(button.querySelector("svg")).toHaveClass("h-4", "w-4");
  });

  test("uses a small icon by default and shows a visible focus ring", () => {
    render(<InfoTooltip label="CPU" text="Processor time in use." />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "About CPU",
    });

    expect(button.querySelector("svg")).toHaveClass("h-3.5", "w-3.5");
    expect(button.className).toContain("focus-visible:ring-2");
  });

  test("two tooltips on one page each show their own text", async () => {
    render(
      <div>
        <InfoTooltip label="p95 duration" text={P95} />
        <InfoTooltip label="Error rate" text="Share of events that failed." />
      </div>,
    );

    await hover(screen.getByRole("button", { name: "About Error rate" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Share of events that failed.",
    );
    expect(screen.queryByText(P95)).not.toBeInTheDocument();
  });
});
