import React from "react";
import { StyleSheet, Text } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  jest,
} from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ResponseActions,
  ResponseDetailHeader,
  ResponseDetailSkeleton,
  ResponseGuidance,
  ResponseInfoRow,
  ResponseSection,
  describeResponseAge,
  formatResponseTimestamp,
  getResponseStage,
  getResponseStageAppearance,
  type ResponseAction,
  type ResponseStage,
} from "./ResponseDetailLayout";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius, typography } from "../theme/tokens";

let mockSystemScheme: "light" | "dark" | null = "light";

/*
 * react-native exposes useColorScheme through a getter, which cannot be spied
 * on, so the module behind it is replaced instead.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" | null => {
      return mockSystemScheme;
    },
  };
});

type Rendered = ReturnType<typeof screen.getByText>;

function flat(element: Rendered): Record<string, unknown> {
  return StyleSheet.flatten(element.props.style) as Record<string, unknown>;
}

const NOW: number = Date.parse("2026-09-14T12:00:00.000Z");

beforeEach(async () => {
  mockSystemScheme = "light";
  await AsyncStorage.clear();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("The detail header", () => {
  test("the problem is a readable heading with server-defined state and severity names", async () => {
    await render(
      <ResponseDetailHeader
        title="Checkout unavailable"
        kind="Incident"
        number="INC-42"
        state="Investigating"
        stateColor="#FACC15"
        severity="Urgent"
      />,
    );
    expect(
      screen.getByRole("header", { name: "Checkout unavailable" }),
    ).toHaveStyle({
      fontSize: typography.title.fontSize,
      lineHeight: typography.title.lineHeight,
      color: lightColors.textPrimary,
    });
    expect(screen.getByText("Incident")).toHaveStyle({
      color: lightColors.actionPrimary,
      textTransform: "uppercase",
    });
    expect(screen.getByText("INC-42")).toHaveStyle({
      color: lightColors.textSecondary,
    });
    expect(screen.getByText("Investigating")).toHaveStyle({
      color: lightColors.textPrimary,
      fontWeight: "700",
    });
    expect(screen.getByText("Urgent")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });

  test("the state pill carries the server colour as a dot, not as text colour", async () => {
    await render(
      <ResponseDetailHeader
        title="Checkout unavailable"
        kind="Incident"
        state="Investigating"
        stateColor="#facc15"
      />,
    );
    expect(screen.getByTestId("detail-state-dot")).toHaveStyle({
      backgroundColor: "#facc15",
      width: 10,
      height: 10,
    });
    expect(screen.getByTestId("detail-state-pill")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderSubtle,
      borderRadius: radius.pill,
    });
  });

  test("each fact renders once, so rows elsewhere can repeat a kind or state", async () => {
    await render(
      <ResponseDetailHeader
        title="Checkout API"
        kind="Website"
        state="Operational"
        stateColor="#16a34a"
      />,
    );
    expect(screen.getAllByText("Website")).toHaveLength(1);
    expect(screen.getAllByText("Operational")).toHaveLength(1);
  });

  test("an optional meta line says how long the response has been open", async () => {
    await render(
      <ResponseDetailHeader
        title="Checkout unavailable"
        kind="Incident"
        stateColor="#FFFFFF"
        meta="Declared 2h ago"
      />,
    );
    expect(screen.getByText("Declared 2h ago")).toHaveStyle({
      color: lightColors.textTertiary,
    });
  });

  test("missing status metadata never invents a healthy state", async () => {
    await render(
      <ResponseDetailHeader
        title="New monitor"
        kind="API"
        stateColor="#FFFFFF"
      />,
    );
    expect(screen.queryByText(/healthy|operational|resolved/i)).toBeNull();
    expect(screen.queryByTestId("detail-state-pill")).toBeNull();
    expect(screen.queryByTestId("detail-severity-pill")).toBeNull();
    expect(screen.getByRole("header", { name: "New monitor" })).toBeTruthy();
  });
});

describe("Response guidance", () => {
  const stageCases: Array<[boolean, boolean, ResponseStage]> = [
    [false, false, "open"],
    [false, true, "acknowledged"],
    [true, false, "resolved"],
    [true, true, "resolved"],
  ];

  test.each(stageCases)(
    "resolved=%s acknowledged=%s is the %s stage",
    (isResolved: boolean, isAcknowledged: boolean, stage: ResponseStage) => {
      expect(getResponseStage(isResolved, isAcknowledged)).toBe(stage);
    },
  );

  test("each stage has its own title, and none reuses a server state name", () => {
    const titles: string[] = (
      ["open", "acknowledged", "resolved"] as const
    ).map((stage: "open" | "acknowledged" | "resolved") => {
      return getResponseStageAppearance(stage).title;
    });
    expect(titles).toEqual([
      "Needs a responder",
      "Response in progress",
      "Response complete",
    ]);
    for (const title of titles) {
      expect(title).not.toMatch(/^(Acknowledged|Resolved|Created)$/);
    }
  });

  const toneCases: Array<[ResponseStage, string]> = [
    ["open", lightColors.statusWarningBg],
    ["acknowledged", lightColors.statusInfoBg],
    ["resolved", lightColors.statusSuccessBg],
  ];

  test.each(toneCases)(
    "the %s stage tints its icon with the matching status tokens",
    async (stage: ResponseStage, background: string) => {
      await render(
        <ResponseGuidance
          {...getResponseStageAppearance(stage)}
          message="What to do next."
        />,
      );
      expect(screen.getByTestId("response-guidance-icon")).toHaveStyle({
        backgroundColor: background,
      });
    },
  );

  test("the title and message are announced politely and sit on a card", async () => {
    await render(
      <ResponseGuidance
        {...getResponseStageAppearance("open")}
        message="Acknowledge to let your team know you are responding."
      />,
    );
    const message: Rendered = screen.getByText(
      "Acknowledge to let your team know you are responding.",
    );
    expect(message).toHaveStyle({ color: lightColors.textSecondary });
    expect(
      screen.getByTestId("response-guidance-content").props
        .accessibilityLiveRegion,
    ).toBe("polite");
    expect(screen.getByText("Needs a responder")).toHaveStyle({
      color: lightColors.textPrimary,
      fontSize: typography.headline.fontSize,
    });
    expect(screen.getByTestId("response-guidance")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderRadius: radius.lg,
      borderColor: lightColors.borderSubtle,
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("actions passed as children render inside the card", async () => {
    await render(
      <ResponseGuidance {...getResponseStageAppearance("open")} message="Next">
        <ResponseActions
          actions={[
            {
              label: "Acknowledge",
              accessibilityLabel: "Acknowledge incident",
              onPress: jest.fn<() => void>(),
              primary: true,
            },
          ]}
          busy={false}
          style={{ marginBottom: 0 }}
        />
      </ResponseGuidance>,
    );
    expect(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    ).toBeTruthy();
  });
});

describe("Response actions", () => {
  test("two large actions have explicit names and distinct primary emphasis", async () => {
    const acknowledge: jest.Mock<() => void> = jest.fn<() => void>();
    const resolve: jest.Mock<() => void> = jest.fn<() => void>();
    const actions: ResponseAction[] = [
      {
        label: "Acknowledge",
        accessibilityLabel: "Acknowledge incident",
        onPress: acknowledge,
        primary: true,
        icon: "eye-outline",
      },
      {
        label: "Resolve",
        accessibilityLabel: "Resolve incident",
        onPress: resolve,
        icon: "checkmark-circle-outline",
      },
    ];
    await render(<ResponseActions actions={actions} busy={false} />);
    expect(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    ).toHaveStyle({
      minHeight: 54,
      minWidth: 128,
      borderRadius: radius.md,
      backgroundColor: lightColors.actionPrimary,
    });
    expect(screen.getByText("Acknowledge")).toHaveStyle({
      color: lightColors.textInverse,
    });
    expect(
      screen.getByRole("button", { name: "Resolve incident" }),
    ).toHaveStyle({
      minHeight: 54,
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderDefault,
      borderWidth: 1,
    });
    expect(screen.getByText("Resolve")).toHaveStyle({
      color: lightColors.textPrimary,
    });
    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve incident" }),
    );
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test("a caller can drop the bottom margin when actions sit inside a card", async () => {
    await render(
      <ResponseActions
        actions={[
          {
            label: "Resolve",
            accessibilityLabel: "Resolve incident",
            onPress: jest.fn<() => void>(),
          },
        ]}
        busy={false}
        style={{ marginBottom: 0 }}
      />,
    );
    expect(flat(screen.getByTestId("response-actions")).marginBottom).toBe(0);
  });

  test("busy actions cannot send duplicate mutations and announce their progress", async () => {
    const onPress: jest.Mock<() => void> = jest.fn<() => void>();
    await render(
      <ResponseActions
        actions={[
          {
            label: "Resolve",
            accessibilityLabel: "Resolve episode",
            busyAccessibilityLabel: "Resolve episode, state change in progress",
            onPress,
            primary: true,
          },
        ]}
        busy
      />,
    );
    const button: Rendered = screen.getByRole("button", {
      name: "Resolve episode, state change in progress",
    });
    expect(button).toBeDisabled();
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByRole("button").props.accessibilityState.disabled).toBe(
      true,
    );
    expect(screen.getByRole("button").props.accessibilityState.busy).toBe(true);
    expect(screen.queryByText("Resolve")).toBeNull();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("Sections and rows", () => {
  test("context sits in a named section card with aligned label and value columns", async () => {
    await render(
      <ResponseSection title="Details" iconName="information-circle-outline">
        <ResponseInfoRow
          label="Monitor"
          value="Checkout API — Europe production"
        />
      </ResponseSection>,
    );
    expect(screen.getByRole("header", { name: "Details" })).toBeTruthy();
    expect(screen.getByText("Monitor")).toHaveStyle({
      width: 96,
      flexShrink: 0,
      color: lightColors.textSecondary,
    });
    expect(screen.getByText("Checkout API — Europe production")).toHaveStyle({
      flex: 1,
      lineHeight: typography.subhead.lineHeight,
      color: lightColors.textPrimary,
    });
  });

  test("the section card keeps its surface, radius and hairline border", async () => {
    await render(
      <ResponseSection title="Root Cause">
        <Text>Disk filled</Text>
      </ResponseSection>,
    );
    expect(screen.getByTestId("response-section-card")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: lightColors.borderSubtle,
    });
  });

  test("rows after the first are separated by a hairline", async () => {
    await render(
      <ResponseSection title="Details">
        <ResponseInfoRow label="Created" value="Today" />
        <ResponseInfoRow label="Monitor" value="Checkout" />
      </ResponseSection>,
    );
    const rows: Rendered[] = screen.container.queryAll((node: Rendered) => {
      return (
        node.type === "View" &&
        flat(node).borderTopColor === lightColors.borderSubtle
      );
    });
    expect(rows).toHaveLength(2);
    expect(flat(rows[0]).borderTopWidth).toBe(0);
    expect(flat(rows[1]).borderTopWidth).toBe(1);
    expect(flat(rows[1]).borderTopColor).toBe(lightColors.borderSubtle);
  });

  test("a section can show a count beside its title", async () => {
    await render(
      <ResponseSection title="Activity Feed" count={4}>
        <Text>Entry</Text>
      </ResponseSection>,
    );
    expect(screen.getByText("4")).toBeTruthy();
  });
});

describe("Loading placeholder", () => {
  test("announces progress with the same label every list uses", async () => {
    await render(<ResponseDetailSkeleton />);
    expect(screen.getByLabelText("Loading content")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });
});

describe("Timestamps", () => {
  test("a response time pairs relative and absolute time", () => {
    const label: string = formatResponseTimestamp("2026-09-14T10:00:00.000Z");
    expect(label).toMatch(/^2h ago · /);
    expect(label).toMatch(/2026/);
  });

  test("a missing time is a single em dash, not a sentence about nothing", () => {
    expect(formatResponseTimestamp(undefined as unknown as string)).toBe("—");
    expect(formatResponseTimestamp("not a date")).toBe("—");
  });

  test("the header age line is left off when there is no usable time", () => {
    expect(describeResponseAge("Declared", "2026-09-14T11:30:00.000Z")).toBe(
      "Declared 30m ago",
    );
    expect(describeResponseAge("Created", undefined)).toBeUndefined();
  });
});

describe("Dark mode", () => {
  beforeEach(() => {
    mockSystemScheme = "dark";
  });

  test("the header, guidance, actions and section cards use the dark palette", async () => {
    await render(
      <ThemeProvider>
        <ResponseDetailHeader
          title="Checkout unavailable"
          kind="Incident"
          number="INC-42"
          state="Investigating"
          stateColor="#facc15"
          severity="Urgent"
        />
        <ResponseGuidance
          {...getResponseStageAppearance("acknowledged")}
          message="Resolve it once recovery is confirmed."
        >
          <ResponseActions
            actions={[
              {
                label: "Resolve",
                accessibilityLabel: "Resolve incident",
                onPress: jest.fn<() => void>(),
                primary: true,
              },
            ]}
            busy={false}
            style={{ marginBottom: 0 }}
          />
        </ResponseGuidance>
        <ResponseSection title="Details">
          <ResponseInfoRow label="Created" value="Today" />
        </ResponseSection>
      </ThemeProvider>,
    );

    expect(
      screen.getByRole("header", { name: "Checkout unavailable" }),
    ).toHaveStyle({ color: darkColors.textPrimary });
    expect(screen.getByTestId("detail-state-pill")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
    });
    expect(screen.getByTestId("response-guidance")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
    });
    expect(screen.getByTestId("response-guidance-icon")).toHaveStyle({
      backgroundColor: darkColors.statusInfoBg,
    });
    expect(
      screen.getByRole("button", { name: "Resolve incident" }),
    ).toHaveStyle({ backgroundColor: darkColors.actionPrimary });
    expect(screen.getByText("Resolve")).toHaveStyle({
      color: darkColors.textInverse,
    });
    expect(screen.getByTestId("response-section-card")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
      borderRadius: radius.lg,
    });
    expect(screen.getByText("Created")).toHaveStyle({
      color: darkColors.textSecondary,
    });
  });

  test("the loading placeholder draws its blocks from the dark palette", async () => {
    await render(
      <ThemeProvider>
        <ResponseDetailSkeleton />
      </ThemeProvider>,
    );
    const blocks: Rendered[] = screen.container.queryAll((node: Rendered) => {
      return (
        node.type === "View" &&
        flat(node).backgroundColor === darkColors.backgroundTertiary
      );
    });
    expect(blocks.length).toBeGreaterThan(5);
    const lightBlocks: Rendered[] = screen.container.queryAll(
      (node: Rendered) => {
        return (
          node.type === "View" &&
          flat(node).backgroundColor === lightColors.backgroundTertiary
        );
      },
    );
    expect(lightBlocks).toHaveLength(0);
  });
});
