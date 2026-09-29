import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import RootCauseCard from "./RootCauseCard";
import { ResponseSection } from "./ResponseDetailLayout";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius } from "../theme/tokens";

let mockSystemScheme: "light" | "dark" | null = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" | null => {
      return mockSystemScheme;
    },
  };
});

beforeEach(async () => {
  mockSystemScheme = "light";
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The root cause is the one part of an incident written by a person, and it
 * arrives late: the card is on the detail screen from the first render, long
 * before anybody has typed anything into it. So the card spends most of its
 * life empty, and the question worth asking of it is whether an empty one
 * still says something - a card that rendered blank would look like a
 * half-loaded screen rather than an unanswered question.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

const PLACEHOLDER: string = "No root cause documented yet.";

function styleOf(element: RenderedElement): Record<string, unknown> {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

describe("A root cause that has been written", () => {
  test("it is shown instead of the placeholder", async () => {
    await render(
      <RootCauseCard rootCauseText="The primary volume filled with debug logs." />,
    );

    expect(
      screen.getByText("The primary volume filled with debug logs."),
    ).toBeTruthy();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  test("it is rendered as markdown, not printed with its syntax showing", async () => {
    /*
     * Root causes are written in the web app's markdown editor, so they arrive
     * full of asterisks and backticks. Printing them raw would put "**disk**"
     * in front of the responder, which is both ugly and, in a post-mortem
     * someone will paste elsewhere, wrong.
     */
    await render(<RootCauseCard rootCauseText="The **disk** filled up." />);

    expect(screen.getByText("disk")).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  test("a multi-line root cause keeps all of its lines", async () => {
    await render(
      <RootCauseCard
        rootCauseText={"First the disk filled.\n\nThen the pod was evicted."}
      />,
    );

    expect(screen.getByText("First the disk filled.")).toBeTruthy();
    expect(screen.getByText("Then the pod was evicted.")).toBeTruthy();
  });
});

describe("A root cause nobody has written yet", () => {
  test("an absent root cause says so in words", async () => {
    await render(<RootCauseCard />);

    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
  });

  test("an empty string is treated as nothing written, not as an empty answer", async () => {
    /*
     * The field comes back as "" from an incident whose root cause box was
     * opened and left blank, which means the same thing to a responder as the
     * field never having existed.
     */
    await render(<RootCauseCard rootCauseText="" />);

    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
  });

  test("the placeholder is drawn in the muted text colour, so it does not read as content", async () => {
    await render(<RootCauseCard />);

    const placeholder: RenderedElement = screen.getByText(PLACEHOLDER);
    const style: Record<string, unknown> = placeholder.props.style as Record<
      string,
      unknown
    >;

    expect(style.color).toBe(lightColors.textTertiary);
  });

  test("the empty context sits inside the section card without nesting another card", async () => {
    /*
     * The section header above this says "Root Cause", and the section draws
     * the card. A second surface in here would be a card inside a card; a
     * placeholder that vanished would leave that heading hanging over the next
     * section's content.
     */
    await render(
      <ResponseSection title="Root Cause">
        <RootCauseCard />
      </ResponseSection>,
    );

    const empty: Record<string, unknown> = styleOf(
      screen.getByTestId("root-cause-empty"),
    );
    expect(empty.backgroundColor).toBeUndefined();
    expect(empty.borderWidth).toBeUndefined();
    expect(empty.flexDirection).toBe("row");
    expect(screen.getByTestId("response-section-card")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderRadius: radius.lg,
    });
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
  });

  test("a written root cause draws no surface of its own either", async () => {
    await render(<RootCauseCard rootCauseText="The disk filled up." />);

    expect(
      styleOf(screen.getByTestId("root-cause-content")).backgroundColor,
    ).toBeUndefined();
    expect(screen.queryByTestId("root-cause-empty")).toBeNull();
  });
});

describe("In dark mode", () => {
  beforeEach(() => {
    mockSystemScheme = "dark";
  });

  test("the placeholder is muted with the dark palette's tertiary text", async () => {
    await render(
      <ThemeProvider>
        <RootCauseCard />
      </ThemeProvider>,
    );

    expect(screen.getByText(PLACEHOLDER)).toHaveStyle({
      color: darkColors.textTertiary,
    });
  });

  test("a written root cause is readable on the dark card", async () => {
    await render(
      <ThemeProvider>
        <RootCauseCard rootCauseText="The disk filled up." />
      </ThemeProvider>,
    );

    expect(screen.getByText("The disk filled up.")).toHaveStyle({
      color: darkColors.textPrimary,
    });
  });
});
