import React from "react";
import { StyleSheet } from "react-native";
import {
  render,
  screen,
  fireEvent,
  within,
} from "@testing-library/react-native";
import { describe, expect, test, jest as jestGlobal } from "@jest/globals";
import UserPickerModal, { filterUsers } from "./UserPickerModal";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { getScreenBottomPadding } from "../theme/layout";
import { radius } from "../theme/tokens";
import type { ProjectUserItem } from "../api/types";

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

const USERS: ProjectUserItem[] = [
  { userId: "user-me", name: "Ada Lovelace", email: "ada@example.com" },
  { userId: "user-2", name: "Priya Rao", email: "priya@example.com" },
  { userId: "user-3", name: "", email: "sam@example.com" },
];

/*
 * The picker's only real rule: the signed-in user must not be offered. The
 * server refuses an override that routes somebody's pages to themselves, so an
 * option that can only ever produce an error is not an option - and at 2am,
 * an inline error is a delay nobody has.
 */

describe("filterUsers", () => {
  test("hides the excluded user entirely", () => {
    expect(
      filterUsers(USERS, "", "user-me").map((user: ProjectUserItem) => {
        return user.userId;
      }),
    ).toEqual(["user-2", "user-3"]);
  });

  test("matches on name, case-insensitively", () => {
    expect(filterUsers(USERS, "priya", null)).toHaveLength(1);
    expect(filterUsers(USERS, "PRIYA", null)).toHaveLength(1);
  });

  test("matches on email too, for members with no name set", () => {
    expect(
      filterUsers(USERS, "sam@", null).map((user: ProjectUserItem) => {
        return user.userId;
      }),
    ).toEqual(["user-3"]);
  });

  test("an empty or whitespace search returns everyone still eligible", () => {
    expect(filterUsers(USERS, "   ", "user-me")).toHaveLength(2);
  });

  test("the exclusion wins over a search that would have matched", () => {
    expect(filterUsers(USERS, "ada", "user-me")).toEqual([]);
  });
});

describe("UserPickerModal", () => {
  test("selected teammate buttons use valid pressed semantics on web while retaining native selection", async () => {
    await render(
      <UserPickerModal
        visible
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId="user-2"
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Select Priya Rao", selected: true }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^Select /, selected: false }),
    ).toHaveLength(2);
  });

  test("keeps long headings flexible without shrinking the close target", async () => {
    await render(
      <UserPickerModal
        visible
        title="Choose a teammate to take over your on-call pages"
        users={USERS}
        isLoading={false}
        selectedUserId={null}
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );
    const title: ReturnType<typeof screen.getByRole> =
      screen.getByRole("header");
    const close: ReturnType<typeof screen.getByRole> = screen.getByRole(
      "button",
      { name: "Close user picker" },
    );
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({
      flex: 1,
      minWidth: 0,
    });
    expect(StyleSheet.flatten(close.props.style)).toMatchObject({
      minWidth: 48,
      minHeight: 48,
      flexShrink: 0,
    });
  });

  test("email-only and duplicate-name entries remain readable and distinguishable", async () => {
    const duplicateUsers: ProjectUserItem[] = [
      {
        userId: "first",
        name: "Alex Morgan",
        email: "alex.engineering@example.test",
      },
      {
        userId: "second",
        name: "Alex Morgan",
        email: "alex.operations@example.test",
      },
      {
        userId: "email-only",
        name: "",
        email: "teammate.with.a.long.email@example.test",
      },
    ];
    await render(
      <UserPickerModal
        visible
        title="Route my pages to"
        users={duplicateUsers}
        isLoading={false}
        selectedUserId={null}
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );
    expect(
      screen.getByTestId("user-option-first").props.accessibilityHint,
    ).toBe("alex.engineering@example.test");
    expect(
      screen.getByTestId("user-option-second").props.accessibilityHint,
    ).toBe("alex.operations@example.test");
    for (const user of duplicateUsers) {
      const option: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
        `user-option-${user.userId}`,
      );
      expect(
        StyleSheet.flatten(option.props.style).minHeight,
      ).toBeGreaterThanOrEqual(48);
      expect(screen.getByText(user.email).props.numberOfLines).toBe(2);
    }
  });

  test("lists the eligible teammates and reports a selection", async (): Promise<void> => {
    const onSelect: (user: ProjectUserItem) => void = jestGlobal.fn();

    await render(
      <UserPickerModal
        visible={true}
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId={null}
        excludeUserId="user-me"
        onSelect={onSelect}
        onClose={jestGlobal.fn()}
      />,
    );

    expect(screen.queryByTestId("user-option-user-me")).toBeNull();

    await fireEvent.press(screen.getByTestId("user-option-user-2"));

    expect(onSelect).toHaveBeenCalledWith(USERS[1]);
  });

  test("filters as the user types", async (): Promise<void> => {
    await render(
      <UserPickerModal
        visible={true}
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId={null}
        excludeUserId="user-me"
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );

    await fireEvent.changeText(
      screen.getByTestId("user-picker-search"),
      "priya",
    );

    expect(screen.getByTestId("user-option-user-2")).toBeTruthy();
    expect(screen.queryByTestId("user-option-user-3")).toBeNull();
  });

  test("distinguishes an empty project from an empty search", async (): Promise<void> => {
    /*
     * "No teammates in this project" is a configuration problem; "no teammates
     * match that search" is a typo. Collapsing them sends people to the wrong
     * fix.
     */
    await render(
      <UserPickerModal
        visible={true}
        title="Route my pages to"
        users={[]}
        isLoading={false}
        selectedUserId={null}
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );

    expect(
      screen.getByText("No teammates found in this project."),
    ).toBeTruthy();
  });

  test("says nothing matched when the project does have members", async (): Promise<void> => {
    await render(
      <UserPickerModal
        visible={true}
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId={null}
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );

    await fireEvent.changeText(
      screen.getByTestId("user-picker-search"),
      "nobody-by-this-name",
    );

    expect(screen.getByText("No teammates match that search.")).toBeTruthy();
  });
});

describe("UserPickerModal sheet", () => {
  test("rows show avatar initials, with the email as the second line", async (): Promise<void> => {
    await render(
      <UserPickerModal
        visible
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId={null}
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );

    expect(
      within(screen.getByTestId("user-avatar-user-me")).getByText("AL"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("user-avatar-user-2")).getByText("PR"),
    ).toBeTruthy();
    /* An email-only member gets the first letter of the address. */
    expect(
      within(screen.getByTestId("user-avatar-user-3")).getByText("S"),
    ).toBeTruthy();
    expect(screen.getByText("priya@example.com")).toBeTruthy();
    expect(screen.getAllByText("sam@example.com")).toHaveLength(1);
  });

  test("search matches email, and clearing it brings everyone back", async (): Promise<void> => {
    await render(
      <UserPickerModal
        visible
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId={null}
        excludeUserId="user-me"
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );

    await fireEvent.changeText(
      screen.getByTestId("user-picker-search"),
      "SAM@",
    );
    expect(screen.getByTestId("user-option-user-3")).toBeTruthy();
    expect(screen.queryByTestId("user-option-user-2")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByTestId("user-option-user-2")).toBeTruthy();
    expect(screen.getByTestId("user-option-user-3")).toBeTruthy();
    expect(screen.queryByTestId("user-option-user-me")).toBeNull();
  });

  test("a search is forgotten when the sheet closes", async (): Promise<void> => {
    const props: React.ComponentProps<typeof UserPickerModal> = {
      visible: true,
      title: "Route my pages to",
      users: USERS,
      isLoading: false,
      selectedUserId: null,
      onSelect: jestGlobal.fn(),
      onClose: jestGlobal.fn(),
    };
    const view: Awaited<ReturnType<typeof render>> = await render(
      <UserPickerModal {...props} />,
    );

    await fireEvent.changeText(
      screen.getByTestId("user-picker-search"),
      "priya",
    );
    expect(screen.queryByTestId("user-option-user-3")).toBeNull();

    await view.rerender(<UserPickerModal {...props} visible={false} />);
    await view.rerender(<UserPickerModal {...props} visible />);

    expect(screen.getByTestId("user-picker-search").props.value).toBe("");
    expect(screen.getByTestId("user-option-user-3")).toBeTruthy();
  });

  test("the selected teammate is tinted and ticked", async (): Promise<void> => {
    await render(
      <UserPickerModal
        visible
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId="user-2"
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );

    expect(flatStyle("user-option-user-2").backgroundColor).toBe(
      lightColors.cardAccent,
    );
    expect(flatStyle("user-option-user-3").backgroundColor).toBe("transparent");
    expect(flatStyle("user-avatar-user-2").backgroundColor).toBe(
      lightColors.actionPrimary,
    );
    expect(flatStyle("user-avatar-user-3").backgroundColor).toBe(
      lightColors.cardAccent,
    );
  });

  test("closing from the header calls onClose", async (): Promise<void> => {
    const onClose: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;

    await render(
      <UserPickerModal
        visible
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId={null}
        onSelect={jestGlobal.fn()}
        onClose={onClose}
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Close user picker" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("while loading, it says so and offers no rows", async (): Promise<void> => {
    await render(
      <UserPickerModal
        visible
        title="Route my pages to"
        users={USERS}
        isLoading
        selectedUserId={null}
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );

    expect(screen.getByTestId("user-picker-loading")).toBeTruthy();
    expect(screen.getByText("Loading teammates…")).toBeTruthy();
    expect(screen.queryByTestId("user-option-user-2")).toBeNull();
  });

  test("the sheet uses the scrim token, sheet surface and bottom padding", async (): Promise<void> => {
    await render(
      <UserPickerModal
        visible
        title="Route my pages to"
        users={USERS}
        isLoading={false}
        selectedUserId={null}
        onSelect={jestGlobal.fn()}
        onClose={jestGlobal.fn()}
      />,
    );

    expect(flatStyle("user-picker-overlay").backgroundColor).toBe(
      lightColors.overlay,
    );
    const sheet: Record<string, unknown> = flatStyle("user-picker-sheet");
    expect(sheet.backgroundColor).toBe(lightColors.backgroundSecondary);
    expect(sheet.borderTopLeftRadius).toBe(radius.xl);
    expect(sheet.borderTopRightRadius).toBe(radius.xl);
    /* No tab bar under a modal: the inset plus the shared end space. */
    expect(sheet.paddingBottom).toBe(getScreenBottomPadding(0, false));
    const list: Record<string, unknown> = flatStyle("user-picker-list");
    expect(list.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(list.borderRadius).toBe(radius.lg);
  });

  test("dark mode swaps the scrim and sheet for the dark tokens", async (): Promise<void> => {
    mockColorScheme = "dark";
    try {
      await render(
        <ThemeProvider>
          <UserPickerModal
            visible
            title="Route my pages to"
            users={USERS}
            isLoading={false}
            selectedUserId="user-2"
            onSelect={jestGlobal.fn()}
            onClose={jestGlobal.fn()}
          />
        </ThemeProvider>,
      );

      expect(flatStyle("user-picker-overlay").backgroundColor).toBe(
        darkColors.overlay,
      );
      expect(flatStyle("user-picker-sheet").backgroundColor).toBe(
        darkColors.backgroundSecondary,
      );
      expect(flatStyle("user-option-user-2").backgroundColor).toBe(
        darkColors.cardAccent,
      );
      expect(screen.getByText("Priya Rao")).toHaveStyle({
        color: darkColors.textPrimary,
      });
    } finally {
      mockColorScheme = "light";
    }
  });
});

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}
