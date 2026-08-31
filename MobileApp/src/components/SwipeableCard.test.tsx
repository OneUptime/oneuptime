import React from "react";
import { View, Text } from "react-native";
import { render, screen, act } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import SwipeableCard from "./SwipeableCard";

/*
 * Swipe-to-acknowledge is the fastest way a woken responder can say "I have
 * this", so the question these tests ask is not "does a swipe do something" but
 * "does it do what the row means TODAY".
 *
 * That distinction is the defect. The PanResponder has to be built once - a
 * responder rebuilt part-way through a drag abandons the gesture - so its
 * handlers close over the props of the render that built it. AlertsScreen and
 * IncidentsScreen hand this component a freshly built `rightAction` on every
 * render, assembled from the row and the acknowledge state they look up in
 * `statesMap`; on the very first render `statesMap` is empty because the state
 * queries have not answered, so that first action is `undefined`. A frozen
 * responder answers every swipe for the rest of the list's life with that.
 *
 * Hence the shape of the tests below: render the way the screens really do
 * (nothing first, then an action), and only then swipe.
 */

const mockMediumImpact: jest.Mock = jest.fn();

/*
 * Haptics are a native call. The `mock` prefix is what lets jest.mock's
 * factory reach this despite hoisting.
 */
jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: jest.fn(),
        mediumImpact: mockMediumImpact,
        selectionFeedback: jest.fn(),
      };
    },
  };
});

type RenderedElement = ReturnType<typeof screen.getByTestId>;

interface PanHandlerProps {
  onResponderGrant?: (event: unknown) => void;
  onResponderMove?: (event: unknown) => void;
  onResponderRelease?: (event: unknown) => void;
}

/*
 * A gesture cannot be delivered here with `fireEvent`. The library refuses to
 * dispatch to a touch responder whose `onMoveShouldSetResponder` answers false,
 * and this component's answers false until the drag is already past 10pt - a
 * condition only a delivered move can create. So the responder's own handlers
 * are called on the rendered host view instead, with the touch history the
 * real responder system would have attached.
 *
 * That history is not decoration: PanResponder does not read the dx off the
 * event, it accumulates it from the centroid of the touches that moved, so a
 * hand-built event without a touch bank produces a gesture of zero distance
 * and a test that passes no matter what the component does.
 */
interface TouchTrack {
  touchActive: boolean;
  startPageX: number;
  startPageY: number;
  startTimeStamp: number;
  currentPageX: number;
  currentPageY: number;
  currentTimeStamp: number;
  previousPageX: number;
  previousPageY: number;
  previousTimeStamp: number;
}

interface TouchEvent {
  touchHistory: {
    touchBank: TouchTrack[];
    numberActiveTouches: number;
    indexOfSingleActiveTouch: number;
    mostRecentTimeStamp: number;
  };
  nativeEvent: { touches: TouchTrack[] };
}

const TOUCH_START_X: number = 200;
const TOUCH_Y: number = 300;

function touchAt(
  currentX: number,
  previousX: number,
  currentTimeStamp: number,
  previousTimeStamp: number,
): TouchEvent {
  const track: TouchTrack = {
    touchActive: true,
    startPageX: TOUCH_START_X,
    startPageY: TOUCH_Y,
    startTimeStamp: 100,
    currentPageX: currentX,
    currentPageY: TOUCH_Y,
    currentTimeStamp: currentTimeStamp,
    previousPageX: previousX,
    previousPageY: TOUCH_Y,
    previousTimeStamp: previousTimeStamp,
  };

  return {
    touchHistory: {
      touchBank: [track],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: currentTimeStamp,
    },
    nativeEvent: { touches: [track] },
  };
}

/**
 * The nearest ancestor (or self) that the PanResponder's handlers were spread
 * onto - the foreground view that actually moves under the finger.
 */
function findPannable(from: RenderedElement): RenderedElement {
  let current: RenderedElement | null = from;

  while (current) {
    const props: PanHandlerProps = current.props as PanHandlerProps;
    if (typeof props.onResponderRelease === "function") {
      return current;
    }
    current = current.parent;
  }

  throw new Error("Nothing in the rendered card carries the pan handlers.");
}

/**
 * One finger down, dragged `dx` points horizontally, lifted. A negative `dx`
 * is a swipe to the left, which is where `rightAction` lives.
 */
async function swipeBy(dx: number): Promise<void> {
  const handlers: PanHandlerProps = findPannable(
    screen.getByTestId("card-body"),
  ).props as PanHandlerProps;

  await act(async (): Promise<void> => {
    handlers.onResponderGrant?.(
      touchAt(TOUCH_START_X, TOUCH_START_X, 100, 100),
    );
    handlers.onResponderMove?.(
      touchAt(TOUCH_START_X + dx, TOUCH_START_X, 200, 100),
    );
    handlers.onResponderRelease?.(
      touchAt(TOUCH_START_X + dx, TOUCH_START_X + dx, 300, 200),
    );
  });

  /*
   * Letting go starts the spring back to centre, and React Native's own jest
   * mock of the native animation driver reports it finished on a 16ms timer.
   * Waiting that out keeps one test's animation from completing in the middle
   * of the next one, and leaves no timer still pending at teardown.
   */
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });
  });
}

function cardBody(): React.JSX.Element {
  return (
    <View testID="card-body">
      <Text>Checkout is down</Text>
    </View>
  );
}

describe("The swipe fires the action the row has now", () => {
  beforeEach(() => {
    mockMediumImpact.mockClear();
  });

  test("an action that only arrived on a later render still fires", async () => {
    /*
     * This is the list's real sequence: the row renders before the incident
     * states have loaded, so there is no acknowledge action to offer yet, and
     * one appears a render or two later when the query answers. A responder
     * swiping after that has every reason to expect it to work.
     */
    const acknowledge: jest.Mock = jest.fn();

    const view: { rerender: (element: React.ReactElement) => Promise<void> } =
      await render(<SwipeableCard>{cardBody()}</SwipeableCard>);

    await view.rerender(
      <SwipeableCard
        rightAction={{
          label: "Acknowledge",
          color: "#22C55E",
          onAction: acknowledge,
        }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    await swipeBy(-120);

    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  test("the callback fired is the current one, not the first one", async () => {
    /*
     * The screens rebuild `onAction` every render because it closes over the
     * row and the state it looked up. Firing the first render's copy would
     * acknowledge against a state the row has since moved on from.
     */
    const firstRenderAction: jest.Mock = jest.fn();
    const currentAction: jest.Mock = jest.fn();

    const view: { rerender: (element: React.ReactElement) => Promise<void> } =
      await render(
        <SwipeableCard
          rightAction={{
            label: "Acknowledge",
            color: "#22C55E",
            onAction: firstRenderAction,
          }}
        >
          {cardBody()}
        </SwipeableCard>,
      );

    await view.rerender(
      <SwipeableCard
        rightAction={{
          label: "Acknowledge",
          color: "#22C55E",
          onAction: currentAction,
        }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    await swipeBy(-120);

    expect(currentAction).toHaveBeenCalledTimes(1);
    expect(firstRenderAction).not.toHaveBeenCalled();
  });

  test("an action withdrawn on a later render is not fired either", async () => {
    /*
     * The other direction, and the more alarming one: once the incident has
     * been acknowledged the screens stop passing an acknowledge action. A row
     * still holding the old one would acknowledge something twice on a stray
     * swipe.
     */
    const acknowledge: jest.Mock = jest.fn();

    const view: { rerender: (element: React.ReactElement) => Promise<void> } =
      await render(
        <SwipeableCard
          rightAction={{
            label: "Acknowledge",
            color: "#22C55E",
            onAction: acknowledge,
          }}
        >
          {cardBody()}
        </SwipeableCard>,
      );

    await view.rerender(<SwipeableCard>{cardBody()}</SwipeableCard>);

    await swipeBy(-120);

    expect(acknowledge).not.toHaveBeenCalled();
  });
});

describe("What an ordinary swipe does", () => {
  beforeEach(() => {
    mockMediumImpact.mockClear();
  });

  test("a full swipe to the left fires the right action", async () => {
    const acknowledge: jest.Mock = jest.fn();

    await render(
      <SwipeableCard
        rightAction={{
          label: "Acknowledge",
          color: "#22C55E",
          onAction: acknowledge,
        }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    await swipeBy(-120);

    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  test("a full swipe to the right fires the left action", async () => {
    const resolve: jest.Mock = jest.fn();

    await render(
      <SwipeableCard
        leftAction={{ label: "Resolve", color: "#3B82F6", onAction: resolve }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    await swipeBy(120);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test("a nudge that never reaches the threshold fires nothing", async () => {
    /*
     * Lists scroll under thumbs all night. An 80pt threshold is what keeps a
     * scroll that drifted sideways from acknowledging an incident.
     */
    const acknowledge: jest.Mock = jest.fn();

    await render(
      <SwipeableCard
        rightAction={{
          label: "Acknowledge",
          color: "#22C55E",
          onAction: acknowledge,
        }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    await swipeBy(-40);

    expect(acknowledge).not.toHaveBeenCalled();
  });

  test("swiping towards an action the row does not offer fires nothing", async () => {
    const resolve: jest.Mock = jest.fn();

    await render(
      <SwipeableCard
        leftAction={{ label: "Resolve", color: "#3B82F6", onAction: resolve }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    await swipeBy(-120);

    expect(resolve).not.toHaveBeenCalled();
  });

  test("crossing the threshold buzzes once, so the hand knows before the eye", async () => {
    await render(
      <SwipeableCard
        rightAction={{
          label: "Acknowledge",
          color: "#22C55E",
          onAction: jest.fn(),
        }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    await swipeBy(-120);

    expect(mockMediumImpact).toHaveBeenCalledTimes(1);
  });

  test("a swipe that stays short of the threshold does not buzz", async () => {
    await render(
      <SwipeableCard
        rightAction={{
          label: "Acknowledge",
          color: "#22C55E",
          onAction: jest.fn(),
        }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    await swipeBy(-40);

    expect(mockMediumImpact).not.toHaveBeenCalled();
  });
});

describe("What the card shows", () => {
  test("the row it was given is rendered", async () => {
    await render(<SwipeableCard>{cardBody()}</SwipeableCard>);

    expect(screen.getByText("Checkout is down")).toBeTruthy();
  });

  test("each action it was given is labelled behind the row", async () => {
    await render(
      <SwipeableCard
        leftAction={{ label: "Resolve", color: "#3B82F6", onAction: jest.fn() }}
        rightAction={{
          label: "Acknowledge",
          color: "#22C55E",
          onAction: jest.fn(),
        }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    expect(screen.getByText("Resolve")).toBeTruthy();
    expect(screen.getByText("Acknowledge")).toBeTruthy();
  });

  test("no label is drawn for an action the row does not have", async () => {
    await render(
      <SwipeableCard
        rightAction={{
          label: "Acknowledge",
          color: "#22C55E",
          onAction: jest.fn(),
        }}
      >
        {cardBody()}
      </SwipeableCard>,
    );

    expect(screen.queryByText("Resolve")).toBeNull();
  });
});
