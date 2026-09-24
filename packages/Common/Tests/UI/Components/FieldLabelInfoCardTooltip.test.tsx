import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import FieldLabelElement from "../../../UI/Components/Detail/FieldLabel";
import InfoCard from "../../../UI/Components/InfoCard/InfoCard";
import Route from "../../../Types/API/Route";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The (i) beside a summary card's title: FieldLabel draws it when given a
 * `tooltip`, and InfoCard - the stat card on every Kubernetes, Proxmox and
 * Ceph detail page - hands its own `tooltip` to FieldLabel.
 *
 * Some InfoCards are clickable (the card is a role="button" that navigates
 * or toggles a filter). Asking what a number means must not activate the
 * card: a click on the (i) is swallowed, and so are Enter and Space.
 */

const READY: string =
  "Pods that passed their readiness check and receive traffic, out of the pods the workload wants.";

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
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

describe("FieldLabel tooltip", () => {
  test("without a tooltip there is no (i)", () => {
    render(<FieldLabelElement title="Ready" />);

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test.each([
    ["empty", ""],
    ["whitespace", "   "],
  ])("an %s tooltip draws no (i)", (_: string, tooltip: string) => {
    render(<FieldLabelElement title="Ready" tooltip={tooltip} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("with a tooltip, an (i) named after the title sits beside it", () => {
    render(<FieldLabelElement title="Ready" tooltip={READY} />);

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Ready",
    });

    expect(info).toBeInTheDocument();
    expect(info.closest("label")).toHaveTextContent("Ready");
    // The label is uppercase and tracked; the (i) resets both.
    expect(info).toHaveClass("normal-case", "tracking-normal");
  });

  test("the text is not in the page until someone reaches for it", () => {
    render(<FieldLabelElement title="Ready" tooltip={READY} />);

    expect(screen.queryByText(READY)).not.toBeInTheDocument();
  });

  test("hovering the (i) shows the text", async () => {
    render(<FieldLabelElement title="Ready" tooltip={READY} />);

    await hover(screen.getByRole("button", { name: "About Ready" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(READY);
  });

  test("keyboard focus shows the text too", async () => {
    render(<FieldLabelElement title="Ready" tooltip={READY} />);

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Ready",
    });

    act(() => {
      info.focus();
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent(READY);
  });

  test("a visible description and a tooltip can sit together", () => {
    render(
      <FieldLabelElement
        title="Ready"
        description="Shown under the title."
        tooltip={READY}
      />,
    );

    expect(screen.getByText("Shown under the title.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About Ready" }),
    ).toBeInTheDocument();
  });

  test("no title means no label and so no (i)", () => {
    render(<FieldLabelElement tooltip={READY} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("the (i) is not inside the side link", () => {
    render(
      <FieldLabelElement
        title="Ready"
        tooltip={READY}
        sideLink={{ text: "View pods", url: new Route("/pods") }}
      />,
    );

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Ready",
    });

    expect(info.closest("a")).toBeNull();
  });
});

describe("InfoCard tooltip", () => {
  test("a card without a tooltip draws no (i)", () => {
    render(<InfoCard title="Ready" value="3/3" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("a card passes its tooltip to the title", async () => {
    render(<InfoCard title="Ready" value="3/3" tooltip={READY} />);

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Ready",
    });

    await hover(info);

    expect(screen.getByRole("tooltip")).toHaveTextContent(READY);
    expect(screen.getByText("3/3")).toBeInTheDocument();
  });

  test("an inert card stays inert - the (i) is the only control", () => {
    const { container } = render(
      <InfoCard title="Ready" value="3/3" tooltip={READY} />,
    );
    const card: HTMLElement = container.firstElementChild as HTMLElement;

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(card).not.toHaveAttribute("role");
    expect(card).not.toHaveAttribute("tabindex");
  });

  test("the card's value can be an element and still sits beside the (i)", () => {
    render(
      <InfoCard
        title="CPU"
        value={<span data-testid="cpu-value">42%</span>}
        tooltip="Processor time the pod used, as a share of one core."
      />,
    );

    expect(screen.getByTestId("cpu-value")).toHaveTextContent("42%");
    expect(
      screen.getByRole("button", { name: "About CPU" }),
    ).toBeInTheDocument();
  });
});

describe("a clickable InfoCard with a tooltip", () => {
  interface Rendered {
    card: HTMLElement;
    info: HTMLElement;
    onClick: MockFunction;
  }

  function renderClickable(isSelected?: boolean): Rendered {
    const onClick: MockFunction = getJestMockFunction();

    render(
      <InfoCard
        title="Ready"
        value="3/3"
        tooltip={READY}
        onClick={onClick}
        isSelected={isSelected}
        ariaLabel="Show ready pods"
      />,
    );

    return {
      card: screen.getByRole("button", { name: "Show ready pods" }),
      info: screen.getByRole("button", { name: "About Ready" }),
      onClick,
    };
  }

  /*
   * A button's children are presentational, so an (i) inside the card's own
   * button would be unreachable for a screen reader. The card is a plain
   * container with a real button laid over it, and the (i) is a sibling of
   * that button, lifted above it.
   */
  test("the (i) is its own button, never nested in the card's button", () => {
    const { card, info } = renderClickable();

    expect(card).not.toContainElement(info);
    expect(info.closest("[role='button']")).toBeNull();
    expect(card.tagName).toBe("BUTTON");
    expect(card).toHaveAttribute("type", "button");
    expect(info.tagName).toBe("BUTTON");
    expect(info).toHaveAttribute("type", "button");
    expect(card.parentElement).toContainElement(info);
  });

  test("the card's button covers the whole card and the (i) sits above it", () => {
    const { card, info } = renderClickable();

    expect(card).toHaveClass("absolute", "inset-0");
    expect(card.parentElement).toHaveClass("relative");
    expect(info).toHaveClass("relative", "z-10");
  });

  test("clicking the (i) does not activate the card", () => {
    const { info, onClick } = renderClickable();

    fireEvent.click(info);

    expect(onClick).not.toHaveBeenCalled();
  });

  test.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])(
    "pressing %s on the (i) does not activate the card",
    (_: string, key: string) => {
      const { info, onClick } = renderClickable();

      fireEvent.keyDown(info, { key });

      expect(onClick).not.toHaveBeenCalled();
    },
  );

  test.each([["{Enter}"], ["[Space]"]])(
    "a real keyboard %s on the focused (i) does not activate the card",
    async (keys: string) => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        advanceTimers: (ms: number) => {
          jest.advanceTimersByTime(ms);
        },
      });
      const { info, onClick } = renderClickable();

      act(() => {
        info.focus();
      });
      await user.keyboard(keys);

      expect(onClick).not.toHaveBeenCalled();
    },
  );

  test("clicking the card itself still activates it", () => {
    const { card, onClick } = renderClickable();

    fireEvent.click(card);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("the title and value are not inside the card's button - they stay readable text", () => {
    const { card } = renderClickable();

    expect(card).not.toContainElement(screen.getByText("Ready"));
    expect(card).not.toContainElement(screen.getByText("3/3"));
    expect(card).toBeEmptyDOMElement();
  });

  test.each([["{Enter}"], ["[Space]"]])(
    "a real keyboard %s on the focused card activates it",
    async (keys: string) => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        advanceTimers: (ms: number) => {
          jest.advanceTimersByTime(ms);
        },
      });
      const { card, onClick } = renderClickable();

      act(() => {
        card.focus();
      });
      await user.keyboard(keys);

      expect(onClick).toHaveBeenCalledTimes(1);
    },
  );

  test("Tab reaches the card first and then its (i)", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      advanceTimers: (ms: number) => {
        jest.advanceTimersByTime(ms);
      },
    });
    const { card, info } = renderClickable();

    await user.tab();
    expect(card).toHaveFocus();

    await user.tab();
    expect(info).toHaveFocus();
  });

  test("other keys on the (i) still reach the card and are ignored by it", () => {
    const { info, onClick } = renderClickable();

    fireEvent.keyDown(info, { key: "a" });
    fireEvent.keyDown(info, { key: "Tab" });

    expect(onClick).not.toHaveBeenCalled();
  });

  test("hovering the (i) of a clickable card shows the text without activating it", async () => {
    const { info, onClick } = renderClickable();

    await hover(info);

    expect(screen.getByRole("tooltip")).toHaveTextContent(READY);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("a toggle card keeps its pressed state when it gains a tooltip", () => {
    const { card } = renderClickable(true);

    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  test("the card keeps its own accessible name when it has one", () => {
    const { card } = renderClickable();

    expect(card).toHaveAttribute("aria-label", "Show ready pods");
  });

  test("without an aria-label, the card is named by its title and value - the (i)'s 'About' name does not leak in", () => {
    render(
      <InfoCard title="Ready" value="3/3" tooltip={READY} onClick={() => {}} />,
    );

    expect(
      screen.getByRole("button", { name: "Ready 3/3" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About Ready" }),
    ).toBeInTheDocument();
  });

  test("an element value has no text to borrow, so the card is named by its title", () => {
    render(
      <InfoCard
        title="Ready"
        value={<span>3 of 3</span>}
        tooltip={READY}
        onClick={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Ready" })).toBeInTheDocument();
  });

  test("a whitespace-only tooltip leaves a clickable card exactly as it was", () => {
    render(
      <InfoCard title="Ready" value="3/3" tooltip="   " onClick={() => {}} />,
    );

    const card: HTMLElement = screen.getByRole("button");

    expect(card.tagName).toBe("DIV");
    expect(card).toHaveAttribute("tabindex", "0");
    expect(
      screen.queryByRole("button", { name: /About/ }),
    ).not.toBeInTheDocument();
  });
});
