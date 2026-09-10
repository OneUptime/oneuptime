import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, jest as jestGlobal } from "@jest/globals";
import UserPickerModal, { filterUsers } from "./UserPickerModal";
import type { ProjectUserItem } from "../api/types";

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
