import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import AlertCard from "./AlertCard";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius, spacing } from "../theme/tokens";
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

/**
 * The resolved style of a host element. Styles may arrive as arrays, so they
 * are flattened rather than read as a plain object.
 */
function styleOf(element: RenderedElement): Record<string, unknown> {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

let mockColorScheme: "light" | "dark" = "light";

/*
 * react-native exposes useColorScheme through a getter that cannot be spied
 * on, so the module behind it is replaced. Light unless a test says otherwise.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

beforeEach(() => {
  mockColorScheme = "light";
});

function cardSurface(): RenderedElement {
  return screen.getByRole("button");
}

/**
 * The dot drawn to the left of a pill's text, which is painted separately from
 * the text and so can drift away from it.
 */
function statusMarker(): RenderedElement {
  return screen.getByTestId("response-status-marker");
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
    /* The number and the kind share one meta line under the title. */
    expect(screen.getByText("#12 · Alert")).toBeTruthy();
  });

  test("the current state and the severity, by name", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  test("the monitor the alert came from, under a caption saying what it is", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(screen.getByText("Linked monitor: api.example.com")).toBeTruthy();
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

describe("State markers preserve server colours while text stays readable", () => {
  test("the marker uses the server colour and its label uses high-contrast text", async () => {
    const alert: AlertItem = makeAlert({
      currentAlertState: makeNamedEntityWithColor({
        name: "Acknowledged",
        color: { r: 245, g: 158, b: 11 },
      }),
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    const label: RenderedElement = screen.getByText("Acknowledged");
    expect(styleOf(label).color).toBe(lightColors.textPrimary);
    expect(styleOf(statusMarker()).backgroundColor).toBe(
      rgbToHex({ r: 245, g: 158, b: 11 }),
    );
  });

  test("a bright severity colour cannot make its label unreadable", async () => {
    const alert: AlertItem = makeAlert({
      alertSeverity: makeNamedEntityWithColor({
        name: "Warning",
        color: { r: 250, g: 204, b: 21 },
      }) as AlertItem["alertSeverity"],
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(styleOf(screen.getByText("Warning")).color).toBe(
      lightColors.textSecondary,
    );
  });

  test("a colour object with no channels in it comes out neutral, never black", async () => {
    /*
     * An empty colour object is what a project that never picked a colour for
     * one of its own states sends. Reading each missing channel as zero would
     * paint the label #000000 - black text on a surface, so
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
    expect(styleOf(label).color).toBe(lightColors.textPrimary);
    expect(styleOf(label).color).not.toBe("#000000");
  });

  test("a state carrying no colour field retains a high-contrast label", async () => {
    const alert: AlertItem = makeAlert({
      currentAlertState: makeNamedEntityWithColor({
        name: "Triaged",
        color: undefined as unknown as ColorField,
      }),
    });

    await render(<AlertCard alert={alert} onPress={noop} />);

    expect(styleOf(screen.getByText("Triaged")).color).toBe(
      lightColors.textPrimary,
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
    expect(screen.queryByText(/Linked monitor/)).toBeNull();
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

    expect(screen.getByText("#12 · Alert")).toBeTruthy();
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

  test("a resolved row stays readable and still opens", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<AlertCard alert={makeAlert()} onPress={onPress} muted />);

    expect(styleOf(cardSurface()).backgroundColor).toBe(
      lightColors.backgroundElevated,
    );

    await fireEvent.press(screen.getByText("Disk almost full"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("an ordinary row is drawn at full strength", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(styleOf(cardSurface()).backgroundColor).toBe(
      lightColors.backgroundElevated,
    );
  });

  test("holding a finger on the row provides visible touch feedback", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    await holdDown(cardSurface());

    expect(styleOf(cardSurface()).backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
  });

  test("a resolved row still answers a touch", async () => {
    /*
     * Resolved rows are muted, and a muted row that did not visibly react to
     * being touched would read as disabled - the responder taps again, harder,
     * on a row that was already opening.
     */
    await render(<AlertCard alert={makeAlert()} onPress={noop} muted />);

    await holdDown(cardSurface());

    expect(styleOf(cardSurface()).backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
  });
});

describe("The card surface", () => {
  test("it is a rounded, padded, bordered card on the elevated surface", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    expect(cardSurface()).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderSubtle,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: spacing.lg,
      marginBottom: spacing.md,
    });
  });

  test("pressing keeps the shape and only changes the fill", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} />);

    await holdDown(cardSurface());

    expect(cardSurface()).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
  });

  test("a resolved alert drops the shadow but keeps the card", async () => {
    await render(<AlertCard alert={makeAlert()} onPress={noop} muted />);

    expect(styleOf(cardSurface()).boxShadow).toBeUndefined();
    expect(styleOf(statusMarker()).opacity).toBe(0.6);
    expect(screen.getByText("Disk almost full")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });
});

describe("In dark mode", () => {
  beforeEach(() => {
    mockColorScheme = "dark";
  });

  async function renderDark(muted?: boolean): Promise<void> {
    await render(
      <ThemeProvider>
        <AlertCard alert={makeAlert()} onPress={noop} muted={muted} />
      </ThemeProvider>,
    );
  }

  test("the card surface uses the dark elevated surface and subtle border", async () => {
    await renderDark();

    expect(cardSurface()).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
  });

  test("title, state, severity, time and context use dark text tokens", async () => {
    await renderDark();

    expect(screen.getByText("Disk almost full")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Created")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Critical")).toHaveStyle({
      color: darkColors.textSecondary,
    });
    expect(screen.getByText("#12 · Alert")).toHaveStyle({
      color: darkColors.textSecondary,
    });
    expect(screen.getByText("Linked monitor: api.example.com")).toHaveStyle({
      color: darkColors.textSecondary,
    });
  });

  test("the server colour on the status dot is kept in dark mode", async () => {
    await renderDark();

    expect(styleOf(statusMarker()).backgroundColor).toBe(
      rgbToHex(makeAlert().currentAlertState.color),
    );
  });

  test("a pressed dark card uses the dark tertiary fill, not the light one", async () => {
    await renderDark();

    await holdDown(cardSurface());

    expect(styleOf(cardSurface()).backgroundColor).toBe(
      darkColors.backgroundTertiary,
    );
    expect(styleOf(cardSurface()).backgroundColor).not.toBe(
      lightColors.backgroundTertiary,
    );
  });

  test("a resolved dark card quiets its title with the dark secondary text", async () => {
    await renderDark(true);

    expect(screen.getByText("Disk almost full")).toHaveStyle({
      color: darkColors.textSecondary,
    });
  });
});
