import React from "react";
import { Text, type LayoutChangeEvent } from "react-native";
import { act, render } from "@testing-library/react-native";
import { describe, expect, jest, test } from "@jest/globals";
import {
  PaneStateScope,
  opensAtFirstRow,
  usePaneScrollRestoration,
  type PaneScrollRestoration,
} from "./paneState";
import { PaneProvider, type PaneLayout } from "../layout/WindowLayout";

/*
 * Below a tabletop fold the list has half a screen, and its own header - the
 * view switch, the search, the filters - fills it. So there the list opens at
 * its first row, the header a short scroll up, as a phone's mail list keeps
 * its search. Everywhere else, and for a list that has a position of its own,
 * nothing changes.
 */

const STACKED_LIST: PaneLayout = {
  kind: "list",
  arrangement: "stacked",
  width: 1104,
  height: 430,
  insetLeft: 0,
  insetRight: 0,
  insetTop: 0,
};

const ROW_LIST: PaneLayout = {
  kind: "list",
  width: 362,
  insetLeft: 0,
  insetRight: 0,
};

function Scroller({
  scrollTo,
  probe,
  headerTop,
}: {
  scrollTo: (offsetY: number) => void;
  probe: { current: PaneScrollRestoration | null };
  headerTop?: number;
}): React.JSX.Element {
  probe.current = usePaneScrollRestoration(
    "list.scroll",
    scrollTo,
    headerTop === undefined ? {} : { headerTop },
  );
  return <Text>list</Text>;
}

function inPane(
  pane: PaneLayout | null,
  children: React.ReactNode,
): React.JSX.Element {
  return (
    <PaneStateScope scope="list-1">
      {pane ? <PaneProvider pane={pane}>{children}</PaneProvider> : children}
    </PaneStateScope>
  );
}

function headerLayout(y: number, height: number): LayoutChangeEvent {
  return {
    nativeEvent: { layout: { x: 0, y, width: 400, height } },
  } as unknown as LayoutChangeEvent;
}

function scrollEvent(
  offsetY: number,
): Parameters<PaneScrollRestoration["onScroll"]>[0] {
  return {
    nativeEvent: { contentOffset: { x: 0, y: offsetY } },
  } as unknown as Parameters<PaneScrollRestoration["onScroll"]>[0];
}

describe("opensAtFirstRow", () => {
  test("only the list below a tabletop fold opens past its header", () => {
    expect(opensAtFirstRow({ ...STACKED_LIST, height: 430 })).toBe(true);
    expect(opensAtFirstRow({ ...ROW_LIST, height: 1104 })).toBe(false);
    expect(
      opensAtFirstRow({
        ...STACKED_LIST,
        kind: "detail",
        height: 430,
      }),
    ).toBe(false);
    expect(
      opensAtFirstRow({
        kind: "full",
        width: 412,
        height: 914,
        insetLeft: 0,
        insetRight: 0,
      }),
    ).toBe(false);
  });
});

describe("The list below a tabletop fold opens at its first row", () => {
  test("once the rows are there, the list scrolls past its header, top padding and all", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> = jest.fn();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    await render(
      inPane(
        STACKED_LIST,
        <Scroller scrollTo={scrollTo} probe={probe} headerTop={20} />,
      ),
    );

    probe.current?.onHeaderLayout(headerLayout(0, 260));
    // The rows have not arrived: nothing to scroll to yet.
    probe.current?.onContentSizeChange(400, 270);
    expect(scrollTo).not.toHaveBeenCalled();

    probe.current?.onContentSizeChange(400, 1800);
    probe.current?.onContentSizeChange(400, 2000);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(280);
  });

  test("rows that are already there are scrolled to as soon as the header is measured", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> = jest.fn();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    await render(
      inPane(STACKED_LIST, <Scroller scrollTo={scrollTo} probe={probe} />),
    );

    probe.current?.onContentSizeChange(400, 2000);
    probe.current?.onHeaderLayout(headerLayout(4, 250));

    expect(scrollTo).toHaveBeenCalledWith(254);
  });

  test("while the header settles - its rows' count arriving, a filter wrapping - the first row stays at the top", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> = jest.fn();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    await render(
      inPane(STACKED_LIST, <Scroller scrollTo={scrollTo} probe={probe} />),
    );

    probe.current?.onContentSizeChange(400, 2000);
    probe.current?.onHeaderLayout(headerLayout(0, 250));
    // The list reports the scroll this hook asked for.
    await act(async () => {
      probe.current?.onScroll(scrollEvent(250));
    });
    probe.current?.onHeaderLayout(headerLayout(0, 300));
    // Measured again at the same size: nothing to do.
    probe.current?.onHeaderLayout(headerLayout(0, 300));
    probe.current?.onContentSizeChange(400, 2400);

    expect(scrollTo.mock.calls).toEqual([[250], [300]]);
  });

  test("once the reader scrolls, the header can settle without moving the list", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> = jest.fn();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    await render(
      inPane(STACKED_LIST, <Scroller scrollTo={scrollTo} probe={probe} />),
    );

    probe.current?.onContentSizeChange(400, 2000);
    probe.current?.onHeaderLayout(headerLayout(0, 250));
    await act(async () => {
      probe.current?.onScroll(scrollEvent(250));
      // The reader pulls the search back into view.
      probe.current?.onScroll(scrollEvent(120));
    });
    probe.current?.onHeaderLayout(headerLayout(0, 320));

    expect(scrollTo.mock.calls).toEqual([[250]]);
  });

  test("a reader who scrolled before the header was measured keeps their own position", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> = jest.fn();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    await render(
      inPane(STACKED_LIST, <Scroller scrollTo={scrollTo} probe={probe} />),
    );

    await act(async () => {
      probe.current?.onScroll(scrollEvent(40));
    });
    probe.current?.onContentSizeChange(400, 2000);
    probe.current?.onHeaderLayout(headerLayout(0, 250));

    expect(scrollTo).not.toHaveBeenCalled();
  });

  test("a list drawn again keeps the position it had, header or not", async () => {
    const scrollTo: jest.Mock<(offsetY: number) => void> = jest.fn();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    const view: Awaited<ReturnType<typeof render>> = await render(
      inPane(STACKED_LIST, <Scroller scrollTo={scrollTo} probe={probe} />),
    );
    await act(async () => {
      probe.current?.onScroll(scrollEvent(0));
    });

    // Unfolded and folded again: the list is drawn afresh in the same pane.
    await view.rerender(inPane(STACKED_LIST, null));
    await view.rerender(
      inPane(STACKED_LIST, <Scroller scrollTo={scrollTo} probe={probe} />),
    );
    probe.current?.onContentSizeChange(400, 2000);
    probe.current?.onHeaderLayout(headerLayout(0, 250));

    // The reader had it at the very top, header showing: so it stays.
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("Everywhere else, the header stays where it is", () => {
  test.each([
    ["a list beside its detail", ROW_LIST],
    [
      "the detail above the fold",
      { ...STACKED_LIST, kind: "detail" } as PaneLayout,
    ],
    ["a screen with no pane at all", null],
  ])("%s", async (_name: string, pane: PaneLayout | null) => {
    const scrollTo: jest.Mock<(offsetY: number) => void> = jest.fn();
    const probe: { current: PaneScrollRestoration | null } = { current: null };
    await render(
      inPane(pane, <Scroller scrollTo={scrollTo} probe={probe} headerTop={20} />),
    );

    probe.current?.onContentSizeChange(400, 2000);
    probe.current?.onHeaderLayout(headerLayout(0, 250));

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
