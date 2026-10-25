import React from "react";
import { Pressable, Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { describe, expect, jest, test } from "@jest/globals";
import {
  ListPaneProvider,
  PaneStateScope,
  useListPane,
  usePaneScrollRestoration,
  usePaneState,
  type ListPaneState,
  type PaneScrollRestoration,
} from "./paneState";

/*
 * The list's memory. A fold draws a list afresh in its new pane; these hooks
 * are how it comes back with its search, its filter and its scroll position,
 * and how its rows know which record is open beside them.
 */

function Counter({ stateKey }: { stateKey: string }): React.JSX.Element {
  const [count, setCount] = usePaneState<number>(stateKey, 0);
  return (
    <Pressable
      testID={`counter-${stateKey}`}
      onPress={(): void => {
        setCount((previous: number): number => {
          return previous + 1;
        });
      }}
    >
      <Text testID={`count-${stateKey}`}>{String(count)}</Text>
    </Pressable>
  );
}

function scoped(scope: string, children: React.ReactNode): React.JSX.Element {
  return <PaneStateScope scope={scope}>{children}</PaneStateScope>;
}

describe("usePaneState", () => {
  test("outside a navigator it is plain component state: drawn again, it starts over", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <Counter stateKey="a" />,
    );
    await fireEvent.press(screen.getByTestId("counter-a"));
    expect(screen.getByTestId("count-a")).toHaveTextContent("1");

    await view.rerender(<Text>gone</Text>);
    await view.rerender(<Counter stateKey="a" />);

    expect(screen.getByTestId("count-a")).toHaveTextContent("0");
  });

  test("inside one, the value comes back when the list is drawn again", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      scoped("list-1", <Counter stateKey="a" />),
    );
    await fireEvent.press(screen.getByTestId("counter-a"));
    await fireEvent.press(screen.getByTestId("counter-a"));

    await view.rerender(scoped("list-1", null));
    await view.rerender(scoped("list-1", <Counter stateKey="a" />));

    expect(screen.getByTestId("count-a")).toHaveTextContent("2");
  });

  test("each key keeps its own value", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      scoped(
        "list-1",
        <>
          <Counter stateKey="a" />
          <Counter stateKey="b" />
        </>,
      ),
    );
    await fireEvent.press(screen.getByTestId("counter-b"));

    await view.rerender(scoped("list-1", null));
    await view.rerender(
      scoped(
        "list-1",
        <>
          <Counter stateKey="a" />
          <Counter stateKey="b" />
        </>,
      ),
    );

    expect(screen.getByTestId("count-a")).toHaveTextContent("0");
    expect(screen.getByTestId("count-b")).toHaveTextContent("1");
  });

  test("a different list - the list route replaced by a reset - starts afresh", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      scoped("list-1", <Counter stateKey="a" />),
    );
    await fireEvent.press(screen.getByTestId("counter-a"));

    await view.rerender(scoped("list-2", <Counter key="new" stateKey="a" />));

    expect(screen.getByTestId("count-a")).toHaveTextContent("0");
  });
});

describe("usePaneScrollRestoration", () => {
  function Scroller({
    scrollTo,
    probe,
  }: {
    scrollTo: (offsetY: number) => void;
    probe: { current: PaneScrollRestoration | null };
  }): React.JSX.Element {
    probe.current = usePaneScrollRestoration("list.scroll", scrollTo);
    return <Text>list</Text>;
  }

  function scrollEvent(offsetY: number): Parameters<
    PaneScrollRestoration["onScroll"]
  >[0] {
    return {
      nativeEvent: { contentOffset: { x: 0, y: offsetY } },
    } as unknown as Parameters<PaneScrollRestoration["onScroll"]>[0];
  }

  test("drawn again, the list is put back where it was scrolled - once, as soon as it is tall enough", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> =
      jest.fn<(offsetY: number) => void>();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    const view: Awaited<ReturnType<typeof render>> = await render(
      scoped("list-1", <Scroller scrollTo={scrollTo} probe={probe} />),
    );
    await act(async (): Promise<void> => {
      probe.current?.onScroll(scrollEvent(640));
    });

    await view.rerender(scoped("list-1", null));
    await view.rerender(
      scoped("list-1", <Scroller scrollTo={scrollTo} probe={probe} />),
    );

    // Not tall enough yet: the rows have not arrived.
    probe.current?.onContentSizeChange(400, 500);
    expect(scrollTo).not.toHaveBeenCalled();

    probe.current?.onContentSizeChange(400, 2400);
    probe.current?.onContentSizeChange(400, 2600);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(640);
  });

  test("a list that was never scrolled is left alone", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> =
      jest.fn<(offsetY: number) => void>();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    await render(
      scoped("list-1", <Scroller scrollTo={scrollTo} probe={probe} />),
    );

    probe.current?.onContentSizeChange(400, 2400);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(probe.current?.scrollEventThrottle).toBeGreaterThan(0);
  });

  test("outside a navigator there is nothing to restore", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> =
      jest.fn<(offsetY: number) => void>();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    const view: Awaited<ReturnType<typeof render>> = await render(
      <Scroller scrollTo={scrollTo} probe={probe} />,
    );
    probe.current?.onScroll(scrollEvent(640));
    await view.rerender(<Text>gone</Text>);
    await view.rerender(<Scroller scrollTo={scrollTo} probe={probe} />);

    probe.current?.onContentSizeChange(400, 2400);

    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("useListPane", () => {
  function Report({
    probe,
  }: {
    probe: { current: ListPaneState | null };
  }): React.JSX.Element {
    probe.current = useListPane();
    return <Text>row</Text>;
  }

  test("on a phone the list is not beside anything, and nothing is open", async () => {
    const probe: { current: ListPaneState | null } = { current: null };
    await render(<Report probe={probe} />);

    expect(probe.current?.besideDetail).toBe(false);
    expect(probe.current?.isOpen("IncidentDetail", { incidentId: "1" })).toBe(
      false,
    );
  });

  test("beside an empty detail pane the list knows where it is, with nothing open", async () => {
    const probe: { current: ListPaneState | null } = { current: null };
    await render(
      <ListPaneProvider selection={null}>
        <Report probe={probe} />
      </ListPaneProvider>,
    );

    expect(probe.current?.besideDetail).toBe(true);
    expect(probe.current?.isOpen("IncidentDetail")).toBe(false);
  });

  test("a row is open when its screen and its own params match what is on the right", async () => {
    const probe: { current: ListPaneState | null } = { current: null };
    await render(
      <ListPaneProvider
        selection={{
          name: "IncidentDetail",
          params: { incidentId: "1", projectId: "p", extra: "kept" },
        }}
      >
        <Report probe={probe} />
      </ListPaneProvider>,
    );

    expect(
      probe.current?.isOpen("IncidentDetail", { incidentId: "1", projectId: "p" }),
    ).toBe(true);
    expect(
      probe.current?.isOpen("IncidentDetail", { incidentId: "2", projectId: "p" }),
    ).toBe(false);
    expect(probe.current?.isOpen("AlertDetail", { incidentId: "1" })).toBe(
      false,
    );
    // A row that opens a screen without params matches it by name alone.
    expect(probe.current?.isOpen("IncidentDetail")).toBe(true);
  });
});
