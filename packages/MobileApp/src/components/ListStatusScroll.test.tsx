import React from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ListStatusScroll from "./ListStatusScroll";
import { PaneStateScope } from "../navigation/paneState";
import { PaneProvider, type PaneLayout } from "../layout/WindowLayout";

/*
 * What stands in for a list's rows while they load or cannot be shown, under
 * the list's header. Below a tabletop fold the header alone fills the pane,
 * so the view opens past it and the skeleton or the error is in sight at
 * once; everywhere else it is a plain scroll view.
 */

const BELOW_THE_FOLD: PaneLayout = {
  kind: "list",
  arrangement: "stacked",
  width: 1104,
  height: 430,
  insetLeft: 0,
  insetRight: 0,
  insetTop: 0,
};

const BESIDE_THE_DETAIL: PaneLayout = {
  kind: "list",
  width: 362,
  insetLeft: 0,
  insetRight: 0,
};

// The scroll view's padding: its header starts this far down its content.
const TOP_PADDING: number = 20;

let scrollTo: jest.SpiedFunction<ScrollView["scrollTo"]> | null = null;

afterEach(() => {
  scrollTo?.mockRestore();
  scrollTo = null;
});

async function renderStatus(pane: PaneLayout): Promise<void> {
  scrollTo = jest
    .spyOn(ScrollView.prototype, "scrollTo")
    .mockImplementation((): void => {
      // The list does not really scroll in a test.
    });
  await render(
    <PaneStateScope scope="list-1">
      <PaneProvider pane={pane}>
        <ListStatusScroll
          scrollKey="incidents.scroll.status"
          header={<Text testID="list-header">Search and filters</Text>}
          testID="response-list-status"
          refreshControl={<RefreshControl refreshing={false} />}
          contentContainerStyle={{ padding: TOP_PADDING }}
        >
          <View testID="list-error">
            <Text>Something went wrong</Text>
          </View>
        </ListStatusScroll>
      </PaneProvider>
    </PaneStateScope>,
  );
}

/*
 * The header's layout as the scroll view reports it: straight inside the
 * padded content, so it starts the top padding down.
 */
async function settle(headerHeight: number): Promise<void> {
  const list: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
    "response-list-status",
  );
  await fireEvent(list, "contentSizeChange", 400, 2000);
  await fireEvent(screen.getByTestId("list-header").parent!, "layout", {
    nativeEvent: {
      layout: {
        x: TOP_PADDING,
        y: TOP_PADDING,
        width: 400,
        height: headerHeight,
      },
    },
  });
}

describe("ListStatusScroll", () => {
  test("draws the list's header above what stands in for its rows, refreshable", async () => {
    await renderStatus(BESIDE_THE_DETAIL);

    const list: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
      "response-list-status",
    );
    expect(list.props.refreshControl).toBeTruthy();
    expect(screen.getByTestId("list-header")).toBeTruthy();
    expect(screen.getByTestId("list-error")).toBeTruthy();
  });

  test("below a tabletop fold it opens past the header, so the error is in sight", async () => {
    await renderStatus(BELOW_THE_FOLD);

    await settle(250);

    /*
     * Where the header ends, the top padding counted once: counted again, the
     * first skeleton card or the error opened with its top cut off.
     */
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({
      x: 0,
      y: TOP_PADDING + 250,
      animated: false,
    });
  });

  test("beside a detail, or on a phone, the header stays where it is", async () => {
    await renderStatus(BESIDE_THE_DETAIL);

    await settle(250);

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
