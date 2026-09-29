import React from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import OnCallStatusCard from "./OnCallStatusCard";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius, spacing } from "../theme/tokens";
import { withAlpha } from "../utils/color";
import type { OnCallDutySummary } from "../oncall/duty";
import type { OnCallShift } from "../api/types";

/*
 * This card is the answer to "am I on call, and until when". It is allowed to
 * be vague; it is not allowed to be wrong. The tests below are the four ways
 * it could be wrong:
 *
 *   - claiming a handoff for a standing assignment that has none;
 *   - showing a countdown while saying "off call";
 *   - hiding the next shift from somebody who is currently off;
 *   - rendering a NaN or an empty fragment when the roster is incomplete.
 */

let mockColorScheme: "light" | "dark" = "light";

/*
 * react-native exposes useColorScheme through a getter, which cannot be spied
 * on, so the module behind it is replaced - as in ThemeContext.test.tsx.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

const NOW: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();
const HOUR: number = 60 * 60 * 1000;

function shift(overrides: Partial<OnCallShift> = {}): OnCallShift {
  return {
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    projectId: "project-1",
    projectName: "Acme",
    status: "active",
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

function summary(
  overrides: Partial<OnCallDutySummary> = {},
): OnCallDutySummary {
  return {
    isOnCall: false,
    activeShifts: [],
    upcomingShifts: [],
    nextHandoffAt: null,
    nextShiftStartsAt: null,
    standingAssignmentCount: 0,
    scheduleAssignmentCount: 0,
    ...overrides,
  };
}

describe("OnCallStatusCard on duty", () => {
  test("leads with the countdown to the handoff", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: true,
          activeShifts: [
            shift({ endsAt: new Date(NOW + 3 * HOUR).toISOString() }),
          ],
          nextHandoffAt: new Date(NOW + 3 * HOUR).toISOString(),
          scheduleAssignmentCount: 1,
        })}
      />,
    );

    expect(screen.getByText("You're on call")).toBeTruthy();
    expect(screen.getByText("ON CALL")).toBeTruthy();
    expect(screen.getByText("Handoff in 3h")).toBeTruthy();
    expect(screen.getByText("Today 3:00 PM")).toBeTruthy();
  });

  test("a standing assignment says so instead of inventing a handoff", async (): Promise<void> => {
    /*
     * The single most important assertion in this file. A direct escalation
     * rule has no shift window at all; a card that borrowed one would tell a
     * responder they stop carrying the phone at a time that means nothing.
     */
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({ isOnCall: true, standingAssignmentCount: 2 })}
      />,
    );

    expect(screen.getByText("You're on call")).toBeTruthy();
    expect(
      screen.getByText("Standing assignment — no scheduled handoff"),
    ).toBeTruthy();
    expect(screen.queryByText(/Handoff in/)).toBeNull();
  });

  test("an active shift with no computed handoff does not fabricate one", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: true,
          activeShifts: [shift()],
          scheduleAssignmentCount: 1,
        })}
      />,
    );

    expect(screen.getByText("On duty — no scheduled handoff")).toBeTruthy();
  });
});

describe("OnCallStatusCard off duty", () => {
  test("counts down to the next shift", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          upcomingShifts: [
            shift({
              status: "upcoming",
              startsAt: new Date(NOW + 26 * HOUR).toISOString(),
            }),
          ],
          nextShiftStartsAt: new Date(NOW + 26 * HOUR).toISOString(),
        })}
      />,
    );

    expect(screen.getByText("You're not on call")).toBeTruthy();
    expect(screen.getByText("OFF CALL")).toBeTruthy();
    expect(screen.getByText("Next shift starts in 1d 2h")).toBeTruthy();
  });

  test("says there is nothing coming when there is nothing coming", async (): Promise<void> => {
    await render(<OnCallStatusCard now={NOW} summary={summary()} />);

    expect(
      screen.getByText("No upcoming shifts on your schedules"),
    ).toBeTruthy();
  });

  test("renders no handoff row at all when neither timestamp exists", async (): Promise<void> => {
    /*
     * An empty meta row would leave two uppercase labels over blank space,
     * which reads as a failed load rather than as "nothing scheduled".
     */
    await render(<OnCallStatusCard now={NOW} summary={summary()} />);

    expect(screen.queryByText("Handoff")).toBeNull();
    expect(screen.queryByText("Next shift")).toBeNull();
  });
});

describe("OnCallStatusCard while loading", () => {
  test("does not assert a duty state it has not read yet", async (): Promise<void> => {
    /*
     * Rendering "You're not on call" before the answer arrives is the one
     * loading state that could send somebody back to sleep.
     */
    await render(
      <OnCallStatusCard now={NOW} summary={summary()} isLoading={true} />,
    );

    expect(screen.getByText("Checking your duty status")).toBeTruthy();
    expect(screen.queryByText("You're not on call")).toBeNull();
    expect(screen.queryByText("OFF CALL")).toBeNull();
    expect(screen.getByText("CHECKING")).toBeTruthy();
  });

  test("hides stale handoff information while status is being established", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: true,
          nextHandoffAt: new Date(NOW + HOUR).toISOString(),
        })}
        isLoading
      />,
    );
    expect(screen.queryByText("ON CALL")).toBeNull();
    expect(screen.queryByText("Handoff")).toBeNull();
  });
});

describe("OnCallStatusCard accessibility", () => {
  test("the card announces the state and the countdown together", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: true,
          nextHandoffAt: new Date(NOW + 90 * 60 * 1000).toISOString(),
          scheduleAssignmentCount: 1,
        })}
      />,
    );

    expect(
      screen.getByLabelText("You're on call. Handoff in 1h 30m."),
    ).toBeTruthy();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The failed read, and how the card looks in each theme.
 *
 * A failed duty read is "we do not know", which is the opposite of the calm
 * "You're not on call" - so it has its own headline, its own eyebrow and a
 * retry, and it never shows a countdown borrowed from a stale summary.
 *
 * The on-call fill used to be tinted with "#FFFFFF20"-style strings. In dark
 * mode the fill is a light indigo with a dark label, so a white wash vanished
 * into it; every tint is now derived from the label token.
 * ---------------------------------------------------------------------------
 */

describe("OnCallStatusCard when the duty read failed", () => {
  test("says the status is unknown and offers a retry", async (): Promise<void> => {
    const onRetry: jest.Mock = jest.fn();

    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: false,
          nextShiftStartsAt: new Date(NOW + 5 * HOUR).toISOString(),
        })}
        isError
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Could not load your on-call status")).toBeTruthy();
    expect(screen.getByText("STATUS UNKNOWN")).toBeTruthy();
    expect(
      screen.getByText(/could not confirm whether you are on call/i),
    ).toBeTruthy();
    expect(screen.queryByText("You're not on call")).toBeNull();
    expect(screen.queryByText("OFF CALL")).toBeNull();
    expect(screen.queryByText(/Next shift starts in/)).toBeNull();
    expect(screen.queryByText("Next shift")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("offers no retry button when there is nothing to call", async (): Promise<void> => {
    await render(<OnCallStatusCard now={NOW} summary={summary()} isError />);

    expect(screen.getByText("STATUS UNKNOWN")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("loading wins over a stale error while the retry is in flight", async (): Promise<void> => {
    await render(
      <OnCallStatusCard now={NOW} summary={summary()} isLoading isError />,
    );

    expect(screen.getByText("CHECKING")).toBeTruthy();
    expect(screen.queryByText("STATUS UNKNOWN")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("announces the failure and the way out together", async (): Promise<void> => {
    await render(<OnCallStatusCard now={NOW} summary={summary()} isError />);

    expect(
      screen.getByLabelText(
        "Could not load your on-call status. We could not confirm whether you are on call. Pull to refresh or try again..",
      ),
    ).toBeTruthy();
  });
});

describe("OnCallStatusCard surfaces in light mode", () => {
  test("on call is the filled hero, tinted from its label colour", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: true,
          nextHandoffAt: new Date(NOW + 3 * HOUR).toISOString(),
        })}
      />,
    );

    const card: Record<string, unknown> = flatStyle("oncall-status-card");
    expect(card.backgroundColor).toBe(lightColors.actionPrimary);
    expect(card.borderRadius).toBe(radius.lg);
    expect(card.padding).toBe(spacing.xl);
    expect(flatStyle("oncall-status-icon").backgroundColor).toBe(
      withAlpha(lightColors.textInverse, 0.16),
    );
    expect(flatStyle("oncall-status-eyebrow").backgroundColor).toBe(
      withAlpha(lightColors.textInverse, 0.16),
    );
    expect(flatStyle("oncall-status-meta").borderTopColor).toBe(
      withAlpha(lightColors.textInverse, 0.24),
    );
    expect(screen.getByText("You're on call")).toHaveStyle({
      color: lightColors.textInverse,
    });
    expectNoHexAlphaColours();
  });

  test("off call sits on the ordinary elevated card surface", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          nextShiftStartsAt: new Date(NOW + 26 * HOUR).toISOString(),
        })}
      />,
    );

    const card: Record<string, unknown> = flatStyle("oncall-status-card");
    expect(card.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(card.borderColor).toBe(lightColors.borderSubtle);
    expect(card.borderRadius).toBe(radius.lg);
    expect(flatStyle("oncall-status-icon").backgroundColor).toBe(
      lightColors.oncallInactiveBg,
    );
    expect(flatStyle("oncall-status-meta").borderTopColor).toBe(
      lightColors.borderSubtle,
    );
    expect(screen.getByText("You're not on call")).toHaveStyle({
      color: lightColors.textPrimary,
    });
    expectNoHexAlphaColours();
  });

  test("loading and error use neutral and warning tokens", async (): Promise<void> => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <OnCallStatusCard now={NOW} summary={summary()} isLoading />,
    );
    expect(flatStyle("oncall-status-card").backgroundColor).toBe(
      lightColors.backgroundElevated,
    );
    expect(flatStyle("oncall-status-icon").backgroundColor).toBe(
      lightColors.cardAccent,
    );

    await view.rerender(
      <OnCallStatusCard now={NOW} summary={summary()} isError />,
    );
    expect(flatStyle("oncall-status-card").backgroundColor).toBe(
      lightColors.backgroundElevated,
    );
    expect(flatStyle("oncall-status-eyebrow").backgroundColor).toBe(
      lightColors.statusWarningBg,
    );
    expect(screen.getByText("STATUS UNKNOWN")).toHaveStyle({
      color: lightColors.statusWarning,
    });
  });
});

describe("OnCallStatusCard in dark mode", () => {
  beforeEach(() => {
    mockColorScheme = "dark";
  });

  afterEach(() => {
    mockColorScheme = "light";
  });

  test("on call uses the dark fill with a dark label and no white wash", async (): Promise<void> => {
    await render(
      <ThemeProvider>
        <OnCallStatusCard
          now={NOW}
          summary={summary({
            isOnCall: true,
            nextHandoffAt: new Date(NOW + 3 * HOUR).toISOString(),
            nextShiftStartsAt: new Date(NOW + 30 * HOUR).toISOString(),
          })}
        />
      </ThemeProvider>,
    );

    expect(flatStyle("oncall-status-card").backgroundColor).toBe(
      darkColors.actionPrimary,
    );
    expect(screen.getByText("You're on call")).toHaveStyle({
      color: darkColors.textInverse,
    });
    expect(screen.getByText("Handoff in 3h")).toHaveStyle({
      color: darkColors.textInverse,
    });
    expect(flatStyle("oncall-status-icon").backgroundColor).toBe(
      withAlpha(darkColors.textInverse, 0.16),
    );
    expect(flatStyle("oncall-status-eyebrow").backgroundColor).toBe(
      withAlpha(darkColors.textInverse, 0.16),
    );
    expect(flatStyle("oncall-status-meta").borderTopColor).toBe(
      withAlpha(darkColors.textInverse, 0.24),
    );

    const colours: string[] = collectColours(screen.toJSON() as JsonNode);
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) {
      expect(colour.toUpperCase()).not.toContain("#FFFFFF");
      expect(colour).not.toMatch(/rgba\(255, 255, 255/);
    }
    expectNoHexAlphaColours();
  });

  test("off call uses the dark elevated surface and dark text tokens", async (): Promise<void> => {
    await render(
      <ThemeProvider>
        <OnCallStatusCard now={NOW} summary={summary()} />
      </ThemeProvider>,
    );

    const card: Record<string, unknown> = flatStyle("oncall-status-card");
    expect(card.backgroundColor).toBe(darkColors.backgroundElevated);
    expect(card.borderColor).toBe(darkColors.borderSubtle);
    expect(card.borderRadius).toBe(radius.lg);
    expect(screen.getByText("You're not on call")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(
      screen.getByText("No upcoming shifts on your schedules"),
    ).toHaveStyle({ color: darkColors.textSecondary });
    expect(flatStyle("oncall-status-icon").backgroundColor).toBe(
      darkColors.oncallInactiveBg,
    );
    expectNoHexAlphaColours();
  });

  test("loading says nothing about duty and uses dark tokens", async (): Promise<void> => {
    await render(
      <ThemeProvider>
        <OnCallStatusCard
          now={NOW}
          summary={summary({ isOnCall: true })}
          isLoading
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Checking your duty status")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.queryByText("ON CALL")).toBeNull();
    expect(flatStyle("oncall-status-card").backgroundColor).toBe(
      darkColors.backgroundElevated,
    );
    expect(flatStyle("oncall-status-icon").backgroundColor).toBe(
      darkColors.cardAccent,
    );
  });

  test("the failed read uses the dark warning tokens", async (): Promise<void> => {
    await render(
      <ThemeProvider>
        <OnCallStatusCard
          now={NOW}
          summary={summary()}
          isError
          onRetry={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(flatStyle("oncall-status-eyebrow").backgroundColor).toBe(
      darkColors.statusWarningBg,
    );
    expect(screen.getByText("STATUS UNKNOWN")).toHaveStyle({
      color: darkColors.statusWarning,
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expectNoHexAlphaColours();
  });
});

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}

interface JsonElementLike {
  props: { style?: StyleProp<ViewStyle> };
  children: Array<JsonElementLike | string> | null;
}

type JsonNode = JsonElementLike | JsonElementLike[] | string | null;

/** Every colour-valued style on the rendered tree. */
function collectColours(node: JsonNode): string[] {
  if (!node || typeof node === "string") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((child: JsonNode) => {
      return collectColours(child);
    });
  }

  const style: Record<string, unknown> = (StyleSheet.flatten(
    node.props.style,
  ) ?? {}) as Record<string, unknown>;
  const own: string[] = Object.entries(style)
    .filter(([key, value]: [string, unknown]) => {
      return key.toLowerCase().includes("color") && typeof value === "string";
    })
    .map(([, value]: [string, unknown]) => {
      return value as string;
    });

  const children: string[] = (node.children ?? []).flatMap(
    (child: JsonElementLike | string) => {
      return collectColours(child);
    },
  );

  return [...own, ...children];
}

function expectNoHexAlphaColours(): void {
  for (const colour of collectColours(screen.toJSON() as JsonNode)) {
    expect(colour).not.toMatch(/^#[0-9a-f]{8}$/i);
  }
}
