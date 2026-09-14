import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import AddNoteModal from "./AddNoteModal";
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
 * A note on an incident is often the only written record of what a responder
 * did at three in the morning - "restarted the checkout pods, watching" - and
 * it is typed with one thumb on a phone that may or may not have signal. So
 * the thing this modal must never do is throw the draft away on a failure the
 * responder did not cause.
 *
 * The screens that host it (IncidentDetailScreen and the three like it) all
 * behave the same way: they POST the note, and on success they close the modal
 * while on failure they leave it open and raise their own alert. That makes
 * `visible` going false the only signal down here that the note actually
 * landed - which is why these tests drive success and failure by re-rendering
 * with a different `visible`, exactly as those screens do.
 */

const PLACEHOLDER: string = "Write a note...";

function noop(): void {
  return undefined;
}

describe("Typing and submitting a note", () => {
  test("the box starts empty", async () => {
    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    expect(screen.getByPlaceholderText(PLACEHOLDER).props.value).toBe("");
  });

  test("what was typed is handed to the caller, trimmed", async () => {
    const onSubmit: jest.Mock = jest.fn();

    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    );

    await fireEvent.changeText(
      screen.getByPlaceholderText(PLACEHOLDER),
      "  Restarted the checkout pods.  ",
    );
    await fireEvent.press(screen.getByText("Submit"));

    expect(onSubmit).toHaveBeenCalledWith("Restarted the checkout pods.");
  });

  test("a note of nothing but spaces is not submitted", async () => {
    const onSubmit: jest.Mock = jest.fn();

    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    );

    await fireEvent.changeText(screen.getByPlaceholderText(PLACEHOLDER), "   ");
    await fireEvent.press(screen.getByText("Submit"));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("cancelling asks the parent to close and keeps nothing", async () => {
    const onClose: jest.Mock = jest.fn();

    await render(
      <AddNoteModal
        visible={true}
        onClose={onClose}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    await fireEvent.changeText(
      screen.getByPlaceholderText(PLACEHOLDER),
      "Never mind.",
    );
    await fireEvent.press(screen.getByText("Cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText(PLACEHOLDER).props.value).toBe("");
  });

  test("the box is locked while a submit is in flight", async () => {
    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={true}
      />,
    );

    expect(screen.getByPlaceholderText(PLACEHOLDER).props.editable).toBe(false);
  });
});

describe("A submit that fails", () => {
  test("the note survives, because the screen stays open on failure", async () => {
    /*
     * This is the regression. `onSubmit` used to be followed immediately by a
     * clear, so by the time the POST came back with an error the responder was
     * looking at a "Failed to add note" alert over an empty box, with nothing
     * to retry from and no copy of what they had typed anywhere.
     */
    const onSubmit: jest.Mock = jest.fn();

    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    );

    await fireEvent.changeText(
      screen.getByPlaceholderText(PLACEHOLDER),
      "Failed over to the replica at 03:12.",
    );
    await fireEvent.press(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(PLACEHOLDER).props.value).toBe(
        "Failed over to the replica at 03:12.",
      );
    });
  });

  test("the surviving note can be submitted again as-is", async () => {
    const onSubmit: jest.Mock = jest.fn();

    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    );

    await fireEvent.changeText(
      screen.getByPlaceholderText(PLACEHOLDER),
      "Paged the database team.",
    );
    await fireEvent.press(screen.getByText("Submit"));
    await fireEvent.press(screen.getByText("Submit"));

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith("Paged the database team.");
  });

  test("it survives the modal being told a submit is in flight and back again", async () => {
    /*
     * The host screen flips `isSubmitting` on for the length of the request and
     * off again in a `finally`, so the draft has to live through a re-render
     * with the box disabled and one with it enabled.
     */
    const view: { rerender: (element: React.ReactElement) => Promise<void> } =
      await render(
        <AddNoteModal
          visible={true}
          onClose={noop}
          onSubmit={noop}
          isSubmitting={false}
        />,
      );

    await fireEvent.changeText(
      screen.getByPlaceholderText(PLACEHOLDER),
      "Rolled back release 4021.",
    );

    await view.rerender(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={true}
      />,
    );
    await view.rerender(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    expect(screen.getByPlaceholderText(PLACEHOLDER).props.value).toBe(
      "Rolled back release 4021.",
    );
  });
});

describe("A submit that succeeds", () => {
  test("the draft is dropped once the screen closes the modal", async () => {
    /*
     * Success is the parent hiding us. If the draft outlived that, the next
     * Add Note would open pre-filled with a note that has already been filed,
     * and the obvious thing to do with a pre-filled box is press Submit again.
     */
    const view: { rerender: (element: React.ReactElement) => Promise<void> } =
      await render(
        <AddNoteModal
          visible={true}
          onClose={noop}
          onSubmit={noop}
          isSubmitting={false}
        />,
      );

    await fireEvent.changeText(
      screen.getByPlaceholderText(PLACEHOLDER),
      "Scaled the workers to 12.",
    );
    await fireEvent.press(screen.getByText("Submit"));

    await view.rerender(
      <AddNoteModal
        visible={false}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );
    await view.rerender(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    expect(screen.getByPlaceholderText(PLACEHOLDER).props.value).toBe("");
  });
});

describe("The submit button", () => {
  test("is disabled until there is something to file", async () => {
    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();

    await fireEvent.changeText(screen.getByPlaceholderText(PLACEHOLDER), "   ");
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();

    await fireEvent.changeText(
      screen.getByPlaceholderText(PLACEHOLDER),
      "Restarted the checkout pods.",
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Submit" })).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
    });
  });

  test("while submitting it is busy, keeps its name, and Cancel cannot close the sheet", async () => {
    const onClose: jest.Mock = jest.fn();
    const onSubmit: jest.Mock = jest.fn();

    await render(
      <AddNoteModal
        visible={true}
        onClose={onClose}
        onSubmit={onSubmit}
        isSubmitting={true}
      />,
    );

    const submit: ReturnType<typeof screen.getByRole> = screen.getByRole(
      "button",
      { name: "Submit" },
    );
    expect(submit).toBeDisabled();
    expect(submit.props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    await fireEvent.press(submit);

    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("Cancel is the outlined secondary action beside it", async () => {
    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderDefault,
      borderWidth: 1,
    });
  });
});

describe("The sheet", () => {
  test("is titled, explains itself and labels the text area", async () => {
    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    expect(screen.getByRole("header", { name: "Add Note" })).toBeTruthy();
    expect(
      screen.getByText(
        "Share an update with your team. Markdown is supported.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Note")).toBe(
      screen.getByPlaceholderText(PLACEHOLDER),
    );
    expect(screen.getByLabelText("Note").props.multiline).toBe(true);
  });

  test("dims the screen with the overlay token and rounds its top corners", async () => {
    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    expect(screen.getByTestId("add-note-backdrop")).toHaveStyle({
      backgroundColor: lightColors.overlay,
    });
    expect(screen.getByTestId("add-note-sheet")).toHaveStyle({
      backgroundColor: lightColors.backgroundSecondary,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    });
  });

  test("the text area shows a focus ring while it is being typed into", async () => {
    await render(
      <AddNoteModal
        visible={true}
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    const input: ReturnType<typeof screen.getByPlaceholderText> =
      screen.getByPlaceholderText(PLACEHOLDER);
    expect(input).toHaveStyle({
      borderColor: lightColors.borderDefault,
      borderWidth: 1,
      minHeight: 148,
    });

    await fireEvent(input, "focus");
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveStyle({
      borderColor: lightColors.actionPrimary,
      borderWidth: 2,
    });

    await fireEvent(screen.getByPlaceholderText(PLACEHOLDER), "blur");
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveStyle({
      borderWidth: 1,
    });
  });

  test("tapping outside an empty sheet closes it", async () => {
    const onClose: jest.Mock = jest.fn();

    await render(
      <AddNoteModal
        visible={true}
        onClose={onClose}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    await fireEvent.press(
      screen.getByTestId("add-note-dismiss-area", {
        includeHiddenElements: true,
      }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("tapping outside never throws away a half-written note", async () => {
    const onClose: jest.Mock = jest.fn();

    await render(
      <AddNoteModal
        visible={true}
        onClose={onClose}
        onSubmit={noop}
        isSubmitting={false}
      />,
    );

    await fireEvent.changeText(
      screen.getByPlaceholderText(PLACEHOLDER),
      "Failed over to the replica",
    );
    await fireEvent.press(
      screen.getByTestId("add-note-dismiss-area", {
        includeHiddenElements: true,
      }),
    );

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(PLACEHOLDER).props.value).toBe(
      "Failed over to the replica",
    );
  });
});

describe("In dark mode", () => {
  beforeEach(() => {
    mockSystemScheme = "dark";
  });

  test("the scrim, sheet, text area and buttons use the dark palette", async () => {
    await render(
      <ThemeProvider>
        <AddNoteModal
          visible={true}
          onClose={noop}
          onSubmit={noop}
          isSubmitting={false}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("add-note-backdrop")).toHaveStyle({
      backgroundColor: darkColors.overlay,
    });
    expect(screen.getByTestId("add-note-sheet")).toHaveStyle({
      backgroundColor: darkColors.backgroundSecondary,
      borderColor: darkColors.borderSubtle,
    });
    const input: ReturnType<typeof screen.getByPlaceholderText> =
      screen.getByPlaceholderText(PLACEHOLDER);
    expect(input).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
      color: darkColors.textPrimary,
    });
    expect(input.props.placeholderTextColor).toBe(darkColors.textTertiary);
    expect(input.props.keyboardAppearance).toBe("dark");
    expect(screen.getByRole("header", { name: "Add Note" })).toHaveStyle({
      color: darkColors.textPrimary,
    });

    await fireEvent.changeText(input, "Scaled the workers to 12.");
    expect(screen.getByRole("button", { name: "Submit" })).toHaveStyle({
      backgroundColor: darkColors.actionPrimary,
    });
    expect(screen.getByText("Submit")).toHaveStyle({
      color: darkColors.textInverse,
    });
  });
});
