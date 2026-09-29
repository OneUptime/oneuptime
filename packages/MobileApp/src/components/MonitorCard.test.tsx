import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import MonitorCard from "./MonitorCard";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius, spacing } from "../theme/tokens";
import { rgbToHex } from "../utils/color";
import {
  makeMonitor,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import type { ColorField, MonitorItem } from "../api/types";

/*
 * A row in the Monitors list. Its whole job is to answer "is this thing all
 * right" at a glance, which makes the one state it cannot express in a colour
 * - active monitoring switched off - the interesting one, because a disabled
 * monitor's last known status is frozen at whatever it was when someone turned
 * it off and will never move again.
 *
 * The card knows that: it drops the status pill and shows "Disabled" instead.
 * The accessibility label did not, which is the defect the regression tests in
 * the last describe below cover.
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
 * The 3pt bar across the top of the card, which is the only part of the row
 * visible while scrolling fast.
 */
function statusStripe(): RenderedElement {
  return screen.getByTestId("response-status-marker");
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Hold a finger on the card, without lifting it.
 *
 * Pressable does not pass onPressIn down to the host view it renders - the
 * press lives in the responder handlers Pressability installs there - so
 * `fireEvent(card, "pressIn")` finds no handler and dispatches to nobody,
 * silently. Calling the host's own onResponderGrant is what the touch system
 * does; the touch on the event is what Pressability records to work out later
 * whether the finger slid off the card.
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

describe("What an ordinary monitor row shows", () => {
  test("the monitor's name and its current status", async () => {
    await render(<MonitorCard monitor={makeMonitor()} onPress={noop} />);

    expect(screen.getByText("api.example.com")).toBeTruthy();
    expect(screen.getByText("Operational")).toBeTruthy();
  });

  test("the kind of check it is, in the list's shorthand", async () => {
    await render(<MonitorCard monitor={makeMonitor()} onPress={noop} />);

    expect(screen.getByText("Website")).toBeTruthy();
  });

  test("a long monitor type is shortened to the label the list uses", async () => {
    const monitor: MonitorItem = makeMonitor({
      monitorType: "SSLCertificate",
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(screen.getByText("SSL")).toBeTruthy();
  });

  test("a monitor type nobody anticipated is shown as it came, not dropped", async () => {
    /*
     * The map is a display convenience, not a whitelist. A monitor type added
     * to the server after this build shipped should still say what it is
     * rather than falling back to a generic word that tells the responder
     * nothing.
     */
    const monitor: MonitorItem = makeMonitor({ monitorType: "Kubernetes" });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(screen.getByText("Kubernetes")).toBeTruthy();
  });

  test("a monitor with no type at all is simply a monitor", async () => {
    const monitor: MonitorItem = makeMonitor({ monitorType: undefined });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(screen.getByText("Monitor")).toBeTruthy();
  });

  test("how long the monitor has existed", async () => {
    const monitor: MonitorItem = makeMonitor({ createdAt: hoursAgo(5) });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(screen.getByText("Created 5h ago")).toBeTruthy();
  });

  test("an unusable timestamp shows a dash rather than an invented age", async () => {
    const monitor: MonitorItem = makeMonitor({ createdAt: "not a date" });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(screen.getByText("Created —")).toBeTruthy();
  });

  test("the project it belongs to, when the list spans several", async () => {
    await render(
      <MonitorCard
        monitor={makeMonitor()}
        onPress={noop}
        projectName="Acme Production"
      />,
    );

    expect(screen.getByText("Acme Production")).toBeTruthy();
  });

  test("and no project badge when the caller did not name one", async () => {
    await render(<MonitorCard monitor={makeMonitor()} onPress={noop} />);

    expect(screen.queryByText("Acme Production")).toBeNull();
  });
});

describe("Status markers preserve server colours while text stays readable", () => {
  test("the marker carries the server colour and text remains readable", async () => {
    const monitor: MonitorItem = makeMonitor({
      currentMonitorStatus: makeNamedEntityWithColor({
        name: "Degraded",
        color: { r: 245, g: 158, b: 11 },
      }),
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    const label: RenderedElement = screen.getByText("Degraded");
    const dot: RenderedElement = screen.getByTestId("response-status-marker");

    expect(styleOf(label).color).toBe(lightColors.textPrimary);
    expect(styleOf(dot).backgroundColor).toBe(
      rgbToHex({ r: 245, g: 158, b: 11 }),
    );
  });

  test("the leading status marker carries the server colour", async () => {
    const monitor: MonitorItem = makeMonitor({
      currentMonitorStatus: makeNamedEntityWithColor({
        name: "Offline",
        color: { r: 239, g: 68, b: 68 },
      }),
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(styleOf(statusStripe()).backgroundColor).toBe(
      rgbToHex({ r: 239, g: 68, b: 68 }),
    );
  });

  test("a colour object with no channels comes out neutral, never black", async () => {
    /*
     * Reading each absent channel as zero would paint the status #000000 -
     * black on a surface, so the one word the row exists to
     * show disappears. rgbToHex is what stops that, and asserting through it
     * keeps this test true if the neutral it picks ever changes.
     */
    const monitor: MonitorItem = makeMonitor({
      currentMonitorStatus: makeNamedEntityWithColor({
        name: "Unknown",
        color: {} as ColorField,
      }),
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(styleOf(screen.getByText("Unknown")).color).toBe(
      lightColors.textPrimary,
    );
    expect(styleOf(screen.getByText("Unknown")).color).not.toBe("#000000");
  });

  test("a status carrying no colour field retains a high-contrast label", async () => {
    const monitor: MonitorItem = makeMonitor({
      currentMonitorStatus: makeNamedEntityWithColor({
        name: "Unknown",
        color: undefined as unknown as ColorField,
      }),
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(styleOf(screen.getByText("Unknown")).color).toBe(
      lightColors.textPrimary,
    );
  });
});

describe("A monitor whose status has not arrived", () => {
  test("no status pill is drawn rather than an empty one", async () => {
    const monitor: MonitorItem = makeMonitor({
      currentMonitorStatus: undefined,
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(screen.getByText("api.example.com")).toBeTruthy();
    expect(screen.queryByText("Operational")).toBeNull();
  });

  test("the card still announces itself, saying the status is unknown", async () => {
    const monitor: MonitorItem = makeMonitor({
      currentMonitorStatus: undefined,
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(
      screen.getByLabelText("Monitor api.example.com. Status: unknown."),
    ).toBeTruthy();
  });

  test("and it is still pressable", async () => {
    const onPress: jest.Mock = jest.fn();
    const monitor: MonitorItem = makeMonitor({
      currentMonitorStatus: undefined,
    });

    await render(<MonitorCard monitor={monitor} onPress={onPress} />);

    await fireEvent.press(screen.getByText("api.example.com"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("Pressing the row", () => {
  test("a press is handed straight up to the list", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<MonitorCard monitor={makeMonitor()} onPress={onPress} />);

    await fireEvent.press(screen.getByText("api.example.com"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("two presses are two presses - the row de-duplicates nothing", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<MonitorCard monitor={makeMonitor()} onPress={onPress} />);

    await fireEvent.press(screen.getByText("api.example.com"));
    await fireEvent.press(screen.getByText("api.example.com"));

    expect(onPress).toHaveBeenCalledTimes(2);
  });

  test("an operational monitor stays readable and still opens", async () => {
    /*
     * MonitorsScreen mutes everything in its "Operational" section, which is
     * most of the list on a good day. Muting must stay a visual weight only.
     */
    const onPress: jest.Mock = jest.fn();

    await render(
      <MonitorCard monitor={makeMonitor()} onPress={onPress} muted />,
    );

    expect(styleOf(cardSurface()).backgroundColor).toBe(
      lightColors.backgroundElevated,
    );

    await fireEvent.press(screen.getByText("api.example.com"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("a row in the Issues section is drawn at full strength", async () => {
    await render(<MonitorCard monitor={makeMonitor()} onPress={noop} />);

    expect(styleOf(cardSurface()).backgroundColor).toBe(
      lightColors.backgroundElevated,
    );
  });

  test("holding a finger on a muted row still visibly answers the touch", async () => {
    await render(<MonitorCard monitor={makeMonitor()} onPress={noop} muted />);

    await holdDown(cardSurface());

    expect(styleOf(cardSurface()).backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
  });
});

describe("A monitor with active monitoring switched off", () => {
  /*
   * The defect these cover: the card visibly refuses to repeat a status that
   * is no longer being checked, and the accessibility label repeated it
   * anyway. A blind responder scanning the Issues section was told the
   * disabled monitor was "Operational" - the one claim the sighted version of
   * the same card was written to avoid making, about the one monitor that
   * cannot notice an outage.
   */
  const disabledButOperational: MonitorItem = makeMonitor({
    disableActiveMonitoring: true,
    currentMonitorStatus: makeNamedEntityWithColor({
      name: "Operational",
      color: { r: 34, g: 197, b: 94 },
    }),
  });

  test("the visible pill says Disabled instead of the frozen status", async () => {
    await render(
      <MonitorCard monitor={disabledButOperational} onPress={noop} />,
    );

    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.queryByText("Operational")).toBeNull();
  });

  test("the screen reader is told Disabled too, not the frozen status", async () => {
    await render(
      <MonitorCard monitor={disabledButOperational} onPress={noop} />,
    );

    expect(
      screen.getByLabelText("Monitor api.example.com. Status: Disabled."),
    ).toBeTruthy();
  });

  test("nothing in the label claims the monitor is operational", async () => {
    await render(
      <MonitorCard monitor={disabledButOperational} onPress={noop} />,
    );

    expect(screen.queryByLabelText(/Operational/)).toBeNull();
  });

  test("a disabled monitor that never had a status says Disabled, not unknown", async () => {
    /*
     * "unknown" would be the old label's answer here, and it is the wrong one
     * twice over: it suggests the app failed to fetch something, when in fact
     * the reason is known and deliberate.
     */
    const monitor: MonitorItem = makeMonitor({
      disableActiveMonitoring: true,
      currentMonitorStatus: undefined,
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(
      screen.getByLabelText("Monitor api.example.com. Status: Disabled."),
    ).toBeTruthy();
  });

  test("the stripe goes grey, so the row does not read as healthy at a glance", async () => {
    await render(
      <MonitorCard monitor={disabledButOperational} onPress={noop} />,
    );

    expect(styleOf(statusStripe()).backgroundColor).toBe(
      lightColors.textTertiary,
    );
  });

  test("a monitor left enabled keeps saying its real status", async () => {
    /*
     * The other half of the fix: the label must only change for monitors that
     * really are switched off. `disableActiveMonitoring` is optional and
     * arrives absent far more often than it arrives false.
     */
    await render(<MonitorCard monitor={makeMonitor()} onPress={noop} />);

    expect(
      screen.getByLabelText("Monitor api.example.com. Status: Operational."),
    ).toBeTruthy();
  });

  test("a monitor whose disable flag is missing altogether is treated as enabled", async () => {
    const monitor: MonitorItem = makeMonitor({
      disableActiveMonitoring: undefined,
    });

    await render(<MonitorCard monitor={monitor} onPress={noop} />);

    expect(screen.getByText("Operational")).toBeTruthy();
    expect(
      screen.getByLabelText("Monitor api.example.com. Status: Operational."),
    ).toBeTruthy();
  });

  test("a disabled monitor is still pressable, so it can be turned back on", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <MonitorCard monitor={disabledButOperational} onPress={onPress} />,
    );

    await fireEvent.press(screen.getByText("api.example.com"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("The card surface", () => {
  test("it is a rounded, padded, bordered card on the elevated surface", async () => {
    await render(<MonitorCard monitor={makeMonitor()} onPress={noop} />);

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
    await render(<MonitorCard monitor={makeMonitor()} onPress={noop} />);

    await holdDown(cardSurface());

    expect(cardSurface()).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
  });
});

describe("In dark mode", () => {
  beforeEach(() => {
    mockColorScheme = "dark";
  });

  test("the card, name, status and type read from the dark palette", async () => {
    await render(
      <ThemeProvider>
        <MonitorCard monitor={makeMonitor()} onPress={noop} />
      </ThemeProvider>,
    );

    expect(cardSurface()).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
    expect(screen.getByText("api.example.com")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Operational")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Website")).toHaveStyle({
      color: darkColors.textSecondary,
    });
  });

  test("a disabled monitor's dot uses the dark neutral, not the light one", async () => {
    await render(
      <ThemeProvider>
        <MonitorCard
          monitor={makeMonitor({ disableActiveMonitoring: true })}
          onPress={noop}
        />
      </ThemeProvider>,
    );

    expect(styleOf(statusStripe()).backgroundColor).toBe(
      darkColors.textTertiary,
    );
  });

  test("holding a finger on a dark card uses the dark pressed fill", async () => {
    await render(
      <ThemeProvider>
        <MonitorCard monitor={makeMonitor()} onPress={noop} />
      </ThemeProvider>,
    );

    await holdDown(cardSurface());

    expect(cardSurface()).toHaveStyle({
      backgroundColor: darkColors.backgroundTertiary,
    });
  });
});
