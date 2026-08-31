import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import AlertCard from "./AlertCard";
import { darkColors } from "../theme";
import { rgbToHex } from "../utils/color";
import { makeAlert, makeNamedEntityWithColor } from "../__tests__/testSupport";
import type { AlertItem, ColorField } from "../api/types";

/*
 * A row in the Alerts list, and the only description of an alert most
 * responders ever read - the detail screen is a second tap, made after the
 * decision to look has already been taken. So the questions worth asking of it
 * are the ones a woken responder asks of the list: which alert, how bad, how
 * old, and what does it touch.
 *
 * Two things make it worth a test file of its own rather than trust. It is
 * rendered inside a list, so anything it throws blanks the whole tab and every
 * other alert with it; and it reads five fields the API is entitled to leave
 * out, each one an optional chain today that a later tidy-up could quietly
 * straighten.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

interface PressHandlers {
  onResponderGrant?: (event: unknown) => void;
}

function styleOf(element: RenderedElement): Record<string, unknown> {
  return element.props.style as Record<string, unknown>;
}

function cardSurface(): RenderedElement {
  return screen.getByRole("button");
}

/**
 * The dot drawn to the left of a pill's text, which is painted separately from
 * the text and so can drift away from it.
 */
function dotBeside(label: RenderedElement): RenderedElement {
  const pill: RenderedElement = label.parent as RenderedElement;
  return pill.children[0] as RenderedElement;
}

/**
 * An ISO timestamp `hours` hours before now.
 *
 * Relative times have to be built against the clock the test runs on. A
 * literal date in a fixture ages every day the suite is not run, and the
 * assertion "3h ago" would start failing on its own some morning for a reason
 * that has nothing to do with the card.
 */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Hold a finger on the card, without lifting it.
 *
 * `fireEvent(card, "pressIn")` cannot do this. Pressable never passes an
 * onPressIn prop down to the host view it renders - the press lives in the
 * responder handlers Pressability installs on that view - so fireEvent finds
 * nothing to call and dispatches to no one, silently, leaving a test that
 * asserts the unpressed style and passes whatever the pressed style is.
 * Calling the host's own onResponderGrant is what the touch system does, so
 * that is what is done here, with the touch a finger landing on the card would
 * have carried: Pressability records the position to decide later whether the
 * finger slid off, and reads it straight off the event.
 */
async function holdDown(element: RenderedElement): Promise<void> {
  const handlers: PressHandlers = element.props as PressHandlers;

  await act(async (): Promise<void> => {
    handlers.onResponderGrant?.({
      nativeEvent: {
        touches: [{ pageX: 100, pageY: 200, identifier: 1 }],
        changedTouches: [],
      },
      currentTarget: 1,
      persist: (): void => {
        return undefined;
      },
    });
  });
}

function noop(): void {
  return undefined;
}

describe("What an ordinary alert row shows", () => {
  test("the alert's title, number and kind", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(screen.getByText("Disk almost full")).toBeTruthy();
    expect(screen.getByText("#12")).toBeTruthy();
    expect(screen.getByText("ALERT")).toBeTruthy();
  });

  test("the current state and the severity, by name", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  test("the monitor the alert came from, under a caption saying what it is", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(screen.getByText("api.example.com")).toBeTruthy();
    expect(screen.getByText("Linked monitor")).toBeTruthy();
  });

  test("how long ago it fired, in the list's shorthand", async () => {
    const alert: AlertItem = makeAlert({ createdAt: hoursAgo(3) });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(screen.getByText("3h ago")).toBeTruthy();
  });

  test("a timestamp the server never sent shows a dash, not an age", async () => {
    /*
     * The point of the dash is that it cannot be mistaken for data. A missing
     * createdAt that came out as "just now" would read as a brand-new alert
     * sitting at the top of the list.
     */
    const alert: AlertItem = makeAlert({
      createdAt: undefined as unknown as string,
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(screen.getByText("—")).toBeTruthy();
  });

  test("the project it belongs to, when the list is showing more than one", async () => {
    await render(
      <AlertCard
        alert={makeAlert()}
        onPress={noop}
        projectName="Acme Production"
      />,
    );

    expect(screen.getByText("Acme Production")).toBeTruthy();
  });

  test("and no project badge at all when the list is already one project's", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(screen.queryByText("Acme Production")).toBeNull();
  });
});

describe("The colours on the pills are the ones the API sent", () => {
  test("the state pill is painted from the state's own colour", async () => {
    const alert: AlertItem = makeAlert({
      currentAlertState: makeNamedEntityWithColor({
        name: "Acknowledged",
        color: { r: 245, g: 158, b: 11 },
      }),
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    const label: RenderedElement = screen.getByText("Acknowledged");
    expect(styleOf(label).color).toBe(rgbToHex({ r: 245, g: 158, b: 11 }));
    expect(styleOf(dotBeside(label)).backgroundColor).toBe(
      rgbToHex({ r: 245, g: 158, b: 11 }),
    );
  });

  test("so is the severity pill", async () => {
    const alert: AlertItem = makeAlert({
      alertSeverity: makeNamedEntityWithColor({
        name: "Warning",
        color: { r: 250, g: 204, b: 21 },
      }) as AlertItem["alertSeverity"],
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(styleOf(screen.getByText("Warning")).color).toBe(
      rgbToHex({ r: 250, g: 204, b: 21 }),
    );
  });

  test("a colour object with no channels in it comes out neutral, never black", async () => {
    /*
     * An empty colour object is what a project that never picked a colour for
     * one of its own states sends. Reading each missing channel as zero would
     * paint the label #000000 - black text on this app's near-black card, so
     * the state name simply vanishes. rgbToHex is what protects against that,
     * and asserting through it is what keeps this test honest if the neutral
     * ever changes.
     */
    const alert: AlertItem = makeAlert({
      currentAlertState: makeNamedEntityWithColor({
        name: "Triaged",
        color: {} as ColorField,
      }),
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    const label: RenderedElement = screen.getByText("Triaged");
    expect(styleOf(label).color).toBe(rgbToHex({} as ColorField));
    expect(styleOf(label).color).not.toBe("#000000");
  });

  test("a state carrying no colour field falls back to the muted text token", async () => {
    const alert: AlertItem = makeAlert({
      currentAlertState: makeNamedEntityWithColor({
        name: "Triaged",
        color: undefined as unknown as ColorField,
      }),
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(styleOf(screen.getByText("Triaged")).color).toBe(
      darkColors.textTertiary,
    );
  });
});

describe("An alert missing the fields the type promises", () => {
  test("an alert with no monitor drops the strip rather than throwing", async () => {
    /*
     * `monitor` is typed `NamedEntity | null` and the null is real: an alert
     * raised by an incoming-request probe or by the API directly has nothing
     * to link to.
     */
    const alert: AlertItem = makeAlert({ monitor: null });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(screen.getByText("Disk almost full")).toBeTruthy();
    expect(screen.queryByText("Linked monitor")).toBeNull();
  });

  test("an alert with no monitor is still pressable", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <AlertCard alert={makeAlert({ monitor: null })} onPress={onPress} />,
    );

    await fireEvent.press(screen.getByText("Disk almost full"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("an absent severity leaves the pill off instead of drawing an empty one", async () => {
    const alert: AlertItem = makeAlert({
      alertSeverity: undefined as unknown as AlertItem["alertSeverity"],
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(screen.queryByText("Critical")).toBeNull();
    expect(screen.getByText("Disk almost full")).toBeTruthy();
  });

  test("an absent state leaves its pill off too", async () => {
    const alert: AlertItem = makeAlert({
      currentAlertState: undefined as unknown as AlertItem["currentAlertState"],
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(screen.queryByText("Created")).toBeNull();
    expect(screen.getByText("Disk almost full")).toBeTruthy();
  });

  test("an alert with no prefixed number falls back to the raw number", async () => {
    const alert: AlertItem = makeAlert({
      alertNumberWithPrefix: undefined as unknown as string,
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(screen.getByText("#12")).toBeTruthy();
  });
});

describe("What the row tells a screen reader", () => {
  test("it is a button, and it names the alert, its state and its severity", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(
      screen.getByRole("button", {
        name: "Alert #12, Disk almost full. State: Created. Severity: Critical.",
      }),
    ).toBeTruthy();
  });

  test("missing state and severity are spoken as unknown rather than skipped", async () => {
    /*
     * Skipping them would run the sentence together as "Alert #12, Disk almost
     * full. State: . Severity: .", which a screen reader reads as a stumble
     * rather than as an absence.
     */
    const alert: AlertItem = makeAlert({
      currentAlertState: undefined as unknown as AlertItem["currentAlertState"],
      alertSeverity: undefined as unknown as AlertItem["alertSeverity"],
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(
      screen.getByLabelText(
        "Alert #12, Disk almost full. State: unknown. Severity: unknown.",
      ),
    ).toBeTruthy();
  });

  test("a muted row says exactly what a full-strength one says", async () => {
    /*
     * Muting is how the list de-emphasises alerts that are already resolved.
     * It is a visual weight, not a change of meaning, so the label must not
     * move with it - a screen-reader user has no opacity to read.
     */
    await render(<AlertCard alert={makeAlert()} onPress={noop} muted />);

    expect(
      screen.getByLabelText(
        "Alert #12, Disk almost full. State: Created. Severity: Critical.",
      ),
    ).toBeTruthy();
  });
});

describe("Pressing the row", () => {
  test("a press is handed straight up to the list", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<AlertCard alert={makeAlert()} onPress={onPress} />);

    await fireEvent.press(screen.getByText("Disk almost full"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("two presses are two presses - the row swallows nothing", async () => {
    /*
     * The navigation this opens is idempotent, so the card deliberately does
     * not de-duplicate. Pinning that down means a future "guard against double
     * taps" cannot land here without someone noticing it also swallows the
     * second of two deliberate visits.
     */
    const onPress: jest.Mock = jest.fn();

    await render(<AlertCard alert={makeAlert()} onPress={onPress} />);

    await fireEvent.press(screen.getByText("Disk almost full"));
    await fireEvent.press(screen.getByText("Disk almost full"));

    expect(onPress).toHaveBeenCalledTimes(2);
  });

  test("a muted row is dimmed but still opens", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<AlertCard alert={makeAlert()} onPress={onPress} muted />);

    expect(styleOf(cardSurface()).opacity).toBe(0.5);

    await fireEvent.press(screen.getByText("Disk almost full"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("an ordinary row is drawn at full strength", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(styleOf(cardSurface()).opacity).toBe(1);
  });

  test("holding a finger on the row dims it further than muting does", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    await holdDown(cardSurface());

    expect(styleOf(cardSurface()).opacity).toBe(0.7);
  });

  test("the press dimming wins over the muted dimming, so a muted row still answers a touch", async () => {
    /*
     * Resolved rows are muted, and a muted row that did not visibly react to
     * being touched would read as disabled - the responder taps again, harder,
     * on a row that was already opening.
     */
    await render(<AlertCard alert={makeAlert()} onPress={noop} muted />);

    await holdDown(cardSurface());

    expect(styleOf(cardSurface()).opacity).toBe(0.7);
  });
});
