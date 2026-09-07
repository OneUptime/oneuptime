import Button from "../../../UI/Components/Button/Button";
import CheckboxElement from "../../../UI/Components/Checkbox/Checkbox";
import ShortcutKey from "../../../UI/Components/ShortcutKey/ShortcutKey";
import "@testing-library/jest-dom";
import { describe, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, useState } from "react";

describe("Button shortcut availability", () => {
  test.each(["s", "S"])("an enabled button responds to %s", (key: string) => {
    const onClick: ReturnType<typeof jest.fn> = jest.fn();
    render(
      <Button
        title="Save"
        shortcutKey={ShortcutKey.Settings}
        onClick={onClick}
      />,
    );

    fireEvent.keyDown(document.body, { key });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["disabled", true, false],
    ["loading", false, true],
    ["disabled and loading", true, true],
  ])(
    "a %s button cannot be activated by a shortcut or click",
    (_name: string, disabled: boolean, isLoading: boolean) => {
      const onClick: ReturnType<typeof jest.fn> = jest.fn();
      render(
        <Button
          title="Save"
          shortcutKey={ShortcutKey.Settings}
          disabled={disabled}
          isLoading={isLoading}
          onClick={onClick}
        />,
      );

      fireEvent.keyDown(document.body, { key: "s" });
      fireEvent.keyDown(document.body, { key: "S" });
      fireEvent.click(screen.getByRole("button", { name: "Save S" }));

      expect(screen.getByRole("button")).toBeDisabled();
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  test("a stable callback follows disabled and loading state changes", () => {
    const onClick: ReturnType<typeof jest.fn> = jest.fn();
    const { rerender } = render(
      <Button
        title="Save"
        shortcutKey={ShortcutKey.Settings}
        onClick={onClick}
      />,
    );

    fireEvent.keyDown(document.body, { key: "s" });
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button
        title="Save"
        shortcutKey={ShortcutKey.Settings}
        onClick={onClick}
        disabled={true}
      />,
    );
    fireEvent.keyDown(document.body, { key: "s" });
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button
        title="Save"
        shortcutKey={ShortcutKey.Settings}
        onClick={onClick}
        isLoading={true}
      />,
    );
    fireEvent.keyDown(document.body, { key: "s" });
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button
        title="Save"
        shortcutKey={ShortcutKey.Settings}
        onClick={onClick}
      />,
    );
    fireEvent.keyDown(document.body, { key: "s" });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("the latest handler is used when an initially disabled button becomes enabled", () => {
    const originalOnClick: ReturnType<typeof jest.fn> = jest.fn();
    const currentOnClick: ReturnType<typeof jest.fn> = jest.fn();
    const { rerender, unmount } = render(
      <Button
        title="Save"
        shortcutKey={ShortcutKey.Settings}
        onClick={originalOnClick}
        disabled={true}
      />,
    );

    rerender(
      <Button
        title="Save"
        shortcutKey={ShortcutKey.Settings}
        onClick={currentOnClick}
      />,
    );
    fireEvent.keyDown(document.body, { key: "s" });

    expect(originalOnClick).not.toHaveBeenCalled();
    expect(currentOnClick).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(document.body, { key: "s" });

    expect(currentOnClick).toHaveBeenCalledTimes(1);
  });

  test("reenabling repeated loading cycles does not stack shortcut handlers", () => {
    const onClick: ReturnType<typeof jest.fn> = jest.fn();
    const { rerender } = render(
      <Button
        title="Save"
        shortcutKey={ShortcutKey.Settings}
        onClick={onClick}
      />,
    );

    for (let cycle: number = 0; cycle < 3; cycle++) {
      rerender(
        <Button
          title="Save"
          shortcutKey={ShortcutKey.Settings}
          onClick={onClick}
          isLoading={true}
        />,
      );
      fireEvent.keyDown(document.body, { key: "s" });
      expect(onClick).toHaveBeenCalledTimes(cycle);

      rerender(
        <Button
          title="Save"
          shortcutKey={ShortcutKey.Settings}
          onClick={onClick}
        />,
      );
      fireEvent.keyDown(document.body, { key: "s" });
      expect(onClick).toHaveBeenCalledTimes(cycle + 1);
    }
  });

  test("unrelated keys and typing in a field do not activate page shortcuts", () => {
    const onClick: ReturnType<typeof jest.fn> = jest.fn();
    render(
      <>
        <input aria-label="Incident title" />
        <Button
          title="Save"
          shortcutKey={ShortcutKey.Settings}
          onClick={onClick}
        />
      </>,
    );

    fireEvent.keyDown(document.body, { key: "n" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "s" });

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Checkbox and button availability integration", () => {
  test("a label enables an action and repeated shortcuts cannot resubmit while saving", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onSave: ReturnType<typeof jest.fn> = jest.fn();

    const NotificationPreferences: () => ReactElement = (): ReactElement => {
      const [enabled, setEnabled] = useState<boolean>(false);
      const [saving, setSaving] = useState<boolean>(false);

      return (
        <>
          <CheckboxElement
            title="Enable incident notifications"
            value={enabled}
            onChange={setEnabled}
          />
          <Button
            title="Save preferences"
            shortcutKey={ShortcutKey.Settings}
            disabled={!enabled}
            isLoading={saving}
            onClick={() => {
              onSave();
              setSaving(true);
            }}
          />
          <button
            type="button"
            onClick={() => {
              setSaving(false);
            }}
          >
            Finish saving
          </button>
        </>
      );
    };

    render(<NotificationPreferences />);

    fireEvent.keyDown(document.body, { key: "s" });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await user.click(screen.getByText("Enable incident notifications"));
    });
    fireEvent.keyDown(document.body, { key: "s" });
    fireEvent.keyDown(document.body, { key: "s" });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Save preferences S" }),
    ).toBeDisabled();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Finish saving" }));
    });
    fireEvent.keyDown(document.body, { key: "s" });

    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
