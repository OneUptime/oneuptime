import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import GradientButton from "./GradientButton";

/*
 * The primary action on the login, backup-code and home screens - the button a
 * responder presses and then waits on.
 *
 * The waiting is the interesting part. While `loading` the label is replaced
 * by a spinner, and a spinner has no text, so the button's accessible NAME
 * disappears at the exact moment the user is most likely to ask what is
 * happening: they press "Sign In", the screen goes quiet, they swipe back to
 * the control and hear "button" with nothing after it. The tests below hold
 * the name in place across every state, and hold the press closed while the
 * button is busy or disabled - a second submit is a second login attempt, a
 * second set of backup codes, a second page.
 */

type Rendered = ReturnType<typeof screen.getByText>;

/**
 * The spinner has no text and no label, so there is nothing to query it by
 * except the host element React Native renders it as.
 */
function spinnerCount(): number {
  return screen.container.queryAll((node: Rendered) => {
    return node.type === "ActivityIndicator";
  }).length;
}

describe("The ordinary button", () => {
  test("shows its label", async () => {
    await render(<GradientButton label="Sign In" onPress={jest.fn()} />);

    expect(screen.getByText("Sign In")).toBeTruthy();
  });

  test("is a button with that label as its name", async () => {
    await render(<GradientButton label="Sign In" onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
  });

  test("pressing it runs the action once", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<GradientButton label="Sign In" onPress={onPress} />);

    await fireEvent.press(screen.getByRole("button", { name: "Sign In" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("shows no spinner while it is idle", async () => {
    await render(<GradientButton label="Sign In" onPress={jest.fn()} />);

    expect(spinnerCount()).toBe(0);
  });

  test("an icon is not read out as part of the name", async () => {
    /*
     * Ionicons renders its glyph as a Text node holding a private-use
     * character. Left to compose its name from its children, the button is
     * announced as that character followed by the label - a screen reader
     * says something unpronounceable and then "Sign In".
     */
    await render(
      <GradientButton
        label="Sign In"
        icon="log-in-outline"
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
    expect(screen.getByText("Sign In")).toBeTruthy();
  });

  test("a testID is carried through, for the callers whose label changes", async () => {
    await render(
      <GradientButton
        label="Generate Backup Codes"
        testID="generate-backup-codes"
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByTestId("generate-backup-codes")).toBeTruthy();
  });
});

describe("While the action is in flight", () => {
  test("the spinner replaces the label on screen", async () => {
    await render(
      <GradientButton label="Sign In" loading={true} onPress={jest.fn()} />,
    );

    expect(spinnerCount()).toBe(1);
    expect(screen.queryByText("Sign In")).toBeNull();
  });

  test("but the button keeps its name", async () => {
    /*
     * The regression this guards. With the label gone from the tree there is
     * nothing left for a screen reader to read out, and the control the user
     * is waiting on becomes an unlabelled button - findable here only because
     * the name is stated on the Pressable rather than left to its children.
     */
    await render(
      <GradientButton label="Sign In" loading={true} onPress={jest.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
  });

  test("and it cannot be pressed again", async () => {
    /*
     * A second press is a second login attempt, or a second set of backup
     * codes that invalidates the set the user is looking at.
     */
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton label="Sign In" loading={true} onPress={onPress} />,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Sign In" }));

    expect(onPress).not.toHaveBeenCalled();
  });

  test("it is announced as disabled while it is busy", async () => {
    await render(
      <GradientButton label="Sign In" loading={true} onPress={jest.fn()} />,
    );

    expect(
      screen.getByRole("button", { name: "Sign In", disabled: true }),
    ).toBeTruthy();
  });
});

describe("When the button is disabled", () => {
  test("it still shows and is still named", async () => {
    await render(
      <GradientButton label="Continue" disabled={true} onPress={jest.fn()} />,
    );

    expect(screen.getByText("Continue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  test("it is announced as disabled rather than merely dimmed", async () => {
    /*
     * The visual signal is opacity, which no screen reader reports.
     */
    await render(
      <GradientButton label="Continue" disabled={true} onPress={jest.fn()} />,
    );

    expect(
      screen.getByRole("button", { name: "Continue", disabled: true }),
    ).toBeTruthy();
  });

  test("pressing it does nothing", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton label="Continue" disabled={true} onPress={onPress} />,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));

    expect(onPress).not.toHaveBeenCalled();
  });

  test("pressing it twice still does nothing", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton label="Continue" disabled={true} onPress={onPress} />,
    );

    const button: Rendered = screen.getByRole("button", { name: "Continue" });
    await fireEvent.press(button);
    await fireEvent.press(button);

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("The secondary variant", () => {
  test("shows its label and runs its action", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton
        label="Use a backup code"
        variant="secondary"
        onPress={onPress}
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Use a backup code" }),
    );

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("keeps its name while loading, just as the primary does", async () => {
    await render(
      <GradientButton
        label="Use a backup code"
        variant="secondary"
        loading={true}
        onPress={jest.fn()}
      />,
    );

    expect(screen.queryByText("Use a backup code")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Use a backup code" }),
    ).toBeTruthy();
  });

  test("is closed to presses while loading", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <GradientButton
        label="Use a backup code"
        variant="secondary"
        loading={true}
        onPress={onPress}
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Use a backup code" }),
    );

    expect(onPress).not.toHaveBeenCalled();
  });
});
