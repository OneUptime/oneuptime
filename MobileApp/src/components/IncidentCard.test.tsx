import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import IncidentCard from "./IncidentCard";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius, spacing } from "../theme/tokens";
import { rgbToHex } from "../utils/color";
import {
  makeIncident,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import type { IncidentItem } from "../api/types";

/*
 * This card is a row in a list, which is what makes its failure mode so
 * expensive: anything it throws during render is thrown inside the list, so
 * one bad incident blanks the whole page and every OTHER incident with it. A
 * responder who opens the app to a blank Incidents tab has no way to tell
 * whether they are looking at an empty rota or a crash.
 *
 * `monitors` is the field that does it. The type says it is always there, the
 * payload disagrees - an incident declared by hand has no monitor, and
 * detaching the last one from an existing incident leaves the field off - and
 * the card was reading it unguarded one line after guarding it.
 */

type IncidentMonitors = IncidentItem["monitors"];
type RenderedElement = ReturnType<typeof screen.getByText>;

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

/** Styles may be arrays or callbacks' results; read them flattened. */
function styleOf(element: RenderedElement): Record<string, unknown> {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

function cardSurface(): RenderedElement {
  return screen.getByRole("button");
}

function noop(): void {
  return undefined;
}

/** Hold a finger on the card without lifting it (see AlertCard.test.tsx). */
async function holdDown(element: RenderedElement): Promise<void> {
  const handlers: { onResponderGrant?: (event: unknown) => void } =
    element.props as { onResponderGrant?: (event: unknown) => void };

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

describe("An incident with no monitors at all", () => {
  test("a missing monitors field renders the row instead of throwing", async () => {
    const incident: IncidentItem = makeIncident({
      monitors: undefined as unknown as IncidentMonitors,
    });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Checkout is down")).toBeTruthy();
  });

  test("the monitor strip is simply left off", async () => {
    const incident: IncidentItem = makeIncident({
      monitors: undefined as unknown as IncidentMonitors,
    });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.queryByText(/monitor/i)).toBeNull();
  });

  test("an empty monitor list is treated the same way", async () => {
    const incident: IncidentItem = makeIncident({ monitors: [] });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Checkout is down")).toBeTruthy();
    expect(screen.queryByText(/monitor/i)).toBeNull();
  });

  test("it is still pressable, so the responder can open it and find out why", async () => {
    const onPress: jest.Mock = jest.fn();
    const incident: IncidentItem = makeIncident({
      monitors: undefined as unknown as IncidentMonitors,
    });

    await render(<IncidentCard incident={incident} onPress={onPress} />);

    await fireEvent.press(screen.getByText("Checkout is down"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("What an ordinary incident row shows", () => {
  test("the title, the number and the times it was declared", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Checkout is down")).toBeTruthy();
    /* The number and the kind share one meta line under the title. */
    expect(screen.getByText("#7 · Incident")).toBeTruthy();
  });

  test("the current state and the severity, by name", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  test("a single attached monitor is named and counted in the singular", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    /* The count captions the names on one context line. */
    expect(screen.getByText("1 monitor: api.example.com")).toBeTruthy();
  });

  test("several monitors are listed together and counted in the plural", async () => {
    const incident: IncidentItem = makeIncident({
      monitors: [
        { _id: "monitor-1", name: "api.example.com" },
        { _id: "monitor-2", name: "checkout.example.com" },
      ] as unknown as IncidentMonitors,
    });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(
      screen.getByText("2 monitors: api.example.com, checkout.example.com"),
    ).toBeTruthy();
  });

  test("the project name is shown when one is given", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
        projectName="Acme Production"
      />,
    );

    expect(screen.getByText("Acme Production")).toBeTruthy();
  });

  test("pressing the row hands the press straight up", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<IncidentCard incident={makeIncident()} onPress={onPress} />);

    await fireEvent.press(screen.getByText("Checkout is down"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("the row announces itself with number, title, state and severity", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(
      screen.getByLabelText(
        "Incident #7, Checkout is down. State: Created. Severity: Critical.",
      ),
    ).toBeTruthy();
  });
});

describe("An incident missing its state or severity", () => {
  /*
   * The same payload that drops `monitors` drops these, and the card already
   * copes; the test is here so a future tidy-up of the monitors guard does not
   * take the neighbouring ones with it.
   */
  test("no state badge is drawn, and the label says so", async () => {
    const incident: IncidentItem = makeIncident({
      currentIncidentState: undefined,
      incidentSeverity: makeNamedEntityWithColor({
        _id: "severity-1",
        name: "Critical",
      }) as IncidentItem["incidentSeverity"],
    });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.queryByText("Created")).toBeNull();
    expect(
      screen.getByLabelText(
        "Incident #7, Checkout is down. State: unknown. Severity: Critical.",
      ),
    ).toBeTruthy();
  });
});

describe("The card surface", () => {
  test("it is a rounded, padded, bordered card on the elevated surface", async () => {
    await render(<IncidentCard incident={makeIncident()} onPress={noop} />);

    expect(cardSurface()).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderSubtle,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: spacing.lg,
      marginBottom: spacing.md,
    });
  });

  test("an active incident casts the card shadow and a resolved one does not", async () => {
    const view: { unmount: () => Promise<void> } = await render(
      <IncidentCard incident={makeIncident()} onPress={noop} />,
    );
    expect(styleOf(cardSurface()).boxShadow).toEqual(expect.any(String));
    await view.unmount();

    await render(
      <IncidentCard incident={makeIncident()} onPress={noop} muted />,
    );
    expect(styleOf(cardSurface()).boxShadow).toBeUndefined();
    /* Muting is visual weight only: the surface is the same card. */
    expect(cardSurface()).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
  });

  test("the status dot carries the state's own colour", async () => {
    const incident: IncidentItem = makeIncident({
      currentIncidentState: makeNamedEntityWithColor({
        name: "Investigating",
        color: { r: 180, g: 35, b: 24 },
      }),
    });

    await render(<IncidentCard incident={incident} onPress={noop} />);

    expect(screen.getByTestId("response-status-marker")).toHaveStyle({
      backgroundColor: rgbToHex({ r: 180, g: 35, b: 24 }),
    });
  });

  test("a state with no colour gets a neutral dot rather than black", async () => {
    const incident: IncidentItem = makeIncident({
      currentIncidentState: undefined,
    });

    await render(<IncidentCard incident={incident} onPress={noop} />);

    expect(screen.getByTestId("response-status-marker")).toHaveStyle({
      backgroundColor: lightColors.textTertiary,
    });
  });
});

describe("In dark mode", () => {
  beforeEach(() => {
    mockColorScheme = "dark";
  });

  test("the card, title, state and meta line read from the dark palette", async () => {
    await render(
      <ThemeProvider>
        <IncidentCard incident={makeIncident()} onPress={noop} />
      </ThemeProvider>,
    );

    expect(cardSurface()).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
    expect(screen.getByText("Checkout is down")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Created")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Critical")).toHaveStyle({
      color: darkColors.textSecondary,
    });
    expect(screen.getByText("#7 · Incident")).toHaveStyle({
      color: darkColors.textSecondary,
    });
  });

  test("no light-palette surface leaks into the dark card", async () => {
    await render(
      <ThemeProvider>
        <IncidentCard incident={makeIncident()} onPress={noop} />
      </ThemeProvider>,
    );

    expect(styleOf(cardSurface()).backgroundColor).not.toBe(
      lightColors.backgroundElevated,
    );
    expect(styleOf(screen.getByText("Checkout is down")).color).not.toBe(
      lightColors.textPrimary,
    );
  });

  test("holding a finger on a dark card uses the dark pressed fill", async () => {
    await render(
      <ThemeProvider>
        <IncidentCard incident={makeIncident()} onPress={noop} />
      </ThemeProvider>,
    );

    await holdDown(cardSurface());

    expect(cardSurface()).toHaveStyle({
      backgroundColor: darkColors.backgroundTertiary,
    });
  });

  test("a resolved dark card keeps its surface and quiets its title", async () => {
    await render(
      <ThemeProvider>
        <IncidentCard incident={makeIncident()} onPress={noop} muted />
      </ThemeProvider>,
    );

    expect(cardSurface()).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
    });
    expect(screen.getByText("Checkout is down")).toHaveStyle({
      color: darkColors.textSecondary,
    });
  });
});
