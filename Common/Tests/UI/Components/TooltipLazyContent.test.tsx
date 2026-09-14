import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { ReferenceElement } from "tippy.js";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";

type ContentRenderMock = ReturnType<typeof jest.fn<() => void>>;

function ObservedContent(props: {
  onRender: ContentRenderMock;
  text: string;
}): ReactElement {
  props.onRender();
  return <div>{props.text}</div>;
}

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(150);
  });
}

async function focus(trigger: HTMLElement): Promise<void> {
  act(() => {
    trigger.focus();
  });
  await act(async () => {
    jest.advanceTimersByTime(150);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Tooltip - deferred history content", () => {
  test("a collection does not render unopened tooltip content", () => {
    const onRender: ContentRenderMock = jest.fn<() => void>();

    render(
      <div>
        {Array.from({ length: 90 }, (_value: unknown, index: number) => {
          return (
            <Tooltip
              key={index}
              lazy={true}
              richContent={
                <ObservedContent onRender={onRender} text={`Day ${index}`} />
              }
            >
              <button type="button">Read day {index}</button>
            </Tooltip>
          );
        })}
      </div>,
    );

    expect(screen.getAllByRole("button")).toHaveLength(90);
    for (const trigger of screen.getAllByRole("button")) {
      /*
       * Deferring only portal content still creates ninety Popper/Tippy
       * instances when a search opens one resource's history.
       */
      expect((trigger as ReferenceElement)._tippy).toBeUndefined();
    }
    expect(onRender).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  test("hover renders the requested tooltip without replacing its trigger", async () => {
    const onRender: ContentRenderMock = jest.fn<() => void>();
    render(
      <Tooltip
        lazy={true}
        richContent={<ObservedContent onRender={onRender} text="75% uptime" />}
      >
        <button type="button">Read uptime</button>
      </Tooltip>,
    );
    const trigger: HTMLElement = screen.getByRole("button");

    await hover(trigger);

    expect(onRender).toHaveBeenCalled();
    expect(screen.getByRole("tooltip")).toHaveTextContent("75% uptime");
    expect(screen.getByRole("button")).toBe(trigger);
  });

  test("keyboard focus opens deferred content and remains on the original button", async () => {
    const onRender: ContentRenderMock = jest.fn<() => void>();
    render(
      <Tooltip
        lazy={true}
        richContent={
          <ObservedContent onRender={onRender} text="No incidents" />
        }
      >
        <button type="button">Read uptime</button>
      </Tooltip>,
    );
    const trigger: HTMLElement = screen.getByRole("button");

    await focus(trigger);

    expect(screen.getByRole("tooltip")).toHaveTextContent("No incidents");
    expect(screen.getByRole("button")).toBe(trigger);
    expect(trigger).toHaveFocus();
  });

  test("only the opened tooltip in a collection renders its content", async () => {
    const firstRender: ContentRenderMock = jest.fn<() => void>();
    const secondRender: ContentRenderMock = jest.fn<() => void>();
    render(
      <div>
        <Tooltip
          lazy={true}
          richContent={
            <ObservedContent onRender={firstRender} text="First day" />
          }
        >
          <button type="button">First</button>
        </Tooltip>
        <Tooltip
          lazy={true}
          richContent={
            <ObservedContent onRender={secondRender} text="Second day" />
          }
        >
          <button type="button">Second</button>
        </Tooltip>
      </div>,
    );

    await hover(screen.getByRole("button", { name: "Second" }));

    expect(
      (screen.getByRole("button", { name: "First" }) as ReferenceElement)
        ._tippy,
    ).toBeUndefined();
    expect(
      (screen.getByRole("button", { name: "Second" }) as ReferenceElement)
        ._tippy,
    ).toBeDefined();
    expect(firstRender).not.toHaveBeenCalled();
    expect(secondRender).toHaveBeenCalled();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Second day");
  });

  test("a refresh before opening shows the newest content without rendering the old content", async () => {
    const oldRender: ContentRenderMock = jest.fn<() => void>();
    const newRender: ContentRenderMock = jest.fn<() => void>();
    const { rerender } = render(
      <Tooltip
        lazy={true}
        richContent={
          <ObservedContent onRender={oldRender} text="Old reading" />
        }
      >
        <button type="button">Read uptime</button>
      </Tooltip>,
    );

    rerender(
      <Tooltip
        lazy={true}
        richContent={
          <ObservedContent onRender={newRender} text="Current reading" />
        }
      >
        <button type="button">Read uptime</button>
      </Tooltip>,
    );

    expect(oldRender).not.toHaveBeenCalled();
    expect(newRender).not.toHaveBeenCalled();

    await hover(screen.getByRole("button"));

    expect(oldRender).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Current reading");
  });

  test("an open tooltip receives updated content without moving focus", async () => {
    const onRender: ContentRenderMock = jest.fn<() => void>();
    const { rerender } = render(
      <Tooltip
        lazy={true}
        richContent={<ObservedContent onRender={onRender} text="75% uptime" />}
      >
        <button type="button">Read uptime</button>
      </Tooltip>,
    );
    const trigger: HTMLElement = screen.getByRole("button");
    await focus(trigger);

    rerender(
      <Tooltip
        lazy={true}
        richContent={<ObservedContent onRender={onRender} text="100% uptime" />}
      >
        <button type="button">Read uptime</button>
      </Tooltip>,
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent("100% uptime");
    expect(screen.getByRole("tooltip")).not.toHaveTextContent("75% uptime");
    expect(screen.getByRole("button")).toBe(trigger);
    expect(trigger).toHaveFocus();
  });

  test("blur hides the tooltip and refocusing opens it again", async () => {
    render(
      <div>
        <Tooltip lazy={true} richContent={<div>No incidents</div>}>
          <button type="button">Read uptime</button>
        </Tooltip>
        <button type="button">Next resource</button>
      </div>,
    );
    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Read uptime",
    });
    await focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("No incidents");

    await focus(screen.getByRole("button", { name: "Next resource" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("No incidents");
    expect(trigger).toHaveFocus();
  });

  test("hovering again after leaving reopens a lazy text tooltip", async () => {
    render(
      <Tooltip lazy={true} text="Resource details">
        <button type="button">Read details</button>
      </Tooltip>,
    );
    const trigger: HTMLElement = screen.getByRole("button");
    await hover(trigger);

    fireEvent.mouseLeave(trigger);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await hover(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Resource details");
  });

  test("the trigger's existing event handlers still receive hover and focus", async () => {
    const onMouseEnter: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();
    const onFocus: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();
    render(
      <Tooltip lazy={true} text="Resource details">
        <button type="button" onMouseEnter={onMouseEnter} onFocus={onFocus}>
          Read details
        </button>
      </Tooltip>,
    );
    const trigger: HTMLElement = screen.getByRole("button");

    await hover(trigger);
    await focus(trigger);

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Resource details");
  });

  test("a disabled trigger cannot open a lazy tooltip", async () => {
    const onRender: ContentRenderMock = jest.fn<() => void>();
    render(
      <Tooltip
        lazy={true}
        richContent={
          <ObservedContent onRender={onRender} text="Resource details" />
        }
      >
        <button type="button" disabled={true}>
          Read details
        </button>
      </Tooltip>,
    );
    const trigger: HTMLElement = screen.getByRole("button");

    await hover(trigger);
    await focus(trigger);

    expect(onRender).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });
});

describe("Tooltip - existing callers", () => {
  test("ordinary rich tooltips continue rendering content before opening", async () => {
    const onRender: ContentRenderMock = jest.fn<() => void>();
    render(
      <Tooltip
        richContent={
          <ObservedContent onRender={onRender} text="Resource details" />
        }
      >
        <button type="button">Read details</button>
      </Tooltip>,
    );

    expect(onRender).toHaveBeenCalled();
    await hover(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Resource details");
  });

  test.each([undefined, true])(
    "plain text tooltips open with lazy=%p",
    async (lazy: boolean | undefined) => {
      render(
        <Tooltip text="Resource details" lazy={lazy}>
          <button type="button">Read details</button>
        </Tooltip>,
      );

      await hover(screen.getByRole("button"));

      expect(screen.getByRole("tooltip")).toHaveTextContent("Resource details");
    },
  );

  test("without content the child remains unwrapped and interactive", async () => {
    const onClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();
    const { container } = render(
      <Tooltip lazy={true}>
        <button type="button" onClick={onClick}>
          Read uptime
        </button>
      </Tooltip>,
    );
    const trigger: HTMLElement = screen.getByRole("button");

    await focus(trigger);
    fireEvent.click(trigger);

    expect(container.firstElementChild).toBe(trigger);
    expect(trigger).toHaveFocus();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
