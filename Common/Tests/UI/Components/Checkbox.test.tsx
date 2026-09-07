import CheckboxElement from "../../../UI/Components/Checkbox/Checkbox";
import CheckBoxList from "../../../UI/Components/CategoryCheckbox/CheckboxList";
import "@testing-library/jest-dom";
import { describe, expect, jest, test } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

describe("Checkbox accessibility and interactions", () => {
  test("uses the visible title as its accessible name", () => {
    render(<CheckboxElement title="Notify the on-call team" />);

    expect(
      screen.getByRole("checkbox", { name: "Notify the on-call team" }),
    ).toBe(screen.getByLabelText("Notify the on-call team"));
  });

  test("clicking a rich label toggles its checkbox exactly once", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    render(
      <CheckboxElement
        title={<span>Send an incident notification</span>}
        onChange={onChange}
      />,
    );

    await act(async () => {
      await user.click(screen.getByText("Send an incident notification"));
    });

    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true, undefined);

    await act(async () => {
      await user.click(screen.getByText("Send an incident notification"));
    });

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false, undefined);
  });

  test("supports native keyboard focus and Space activation", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    render(<CheckboxElement title="Email updates" onChange={onChange} />);

    await act(async () => {
      await user.tab();
    });
    expect(
      screen.getByRole("checkbox", { name: "Email updates" }),
    ).toHaveFocus();
    await act(async () => {
      await user.keyboard(" ");
    });

    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true, undefined);
  });

  test("a disabled checkbox stays unchanged when its label is clicked", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    render(
      <CheckboxElement
        title="Email updates"
        disabled={true}
        onChange={onChange}
      />,
    );

    /*
     * Use native label activation here. This user-event version forwards a
     * label click to disabled inputs, bypassing the platform's disabled check.
     */
    act(() => {
      screen.getByText("Email updates").click();
    });
    await act(async () => {
      await user.tab();
    });

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("checkbox")).not.toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("preserves explicit accessible names on checkboxes without a title", () => {
    render(
      <CheckboxElement
        ariaLabel="Select API availability monitor"
        hoverText="Select this monitor"
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "Select API availability monitor" }),
    ).toHaveAttribute("title", "Select this monitor");
  });

  test("keeps an explicit accessible name when there is also a visible title", () => {
    render(
      <CheckboxElement
        title="Select"
        ariaLabel="Select API availability monitor"
      />,
    );

    expect(screen.getByRole("checkbox")).toHaveAccessibleName(
      "Select API availability monitor",
    );
  });

  test("connects every checkbox only to its own description and error", () => {
    render(
      <>
        <CheckboxElement
          title="Email updates"
          description="Receive incident summaries by email."
          error="Verify your email before enabling updates."
        />
        <CheckboxElement
          title="SMS updates"
          description="Receive urgent incident notifications by SMS."
          error="Add a phone number before enabling SMS."
        />
      </>,
    );

    const email: HTMLElement = screen.getByRole("checkbox", {
      name: "Email updates",
    });
    const sms: HTMLElement = screen.getByRole("checkbox", {
      name: "SMS updates",
    });

    expect(email.id).not.toBe(sms.id);
    expect(email).toHaveAccessibleDescription(
      "Receive incident summaries by email. Verify your email before enabling updates.",
    );
    expect(sms).toHaveAccessibleDescription(
      "Receive urgent incident notifications by SMS. Add a phone number before enabling SMS.",
    );
    expect(email.getAttribute("aria-describedby")).not.toBe(
      sms.getAttribute("aria-describedby"),
    );
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(sms).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  test("associates a description without marking a valid checkbox invalid", () => {
    render(
      <CheckboxElement
        title="Email updates"
        description="Receive incident summaries by email."
      />,
    );

    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(
      "Receive incident summaries by email.",
    );
    expect(screen.getByRole("checkbox")).not.toHaveAttribute("aria-invalid");
  });

  test("associates validation errors even when there is no description", () => {
    render(
      <CheckboxElement
        title="Accept the terms"
        error="Accept the terms to continue."
      />,
    );

    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(
      "Accept the terms to continue.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Accept the terms to continue.",
    );
  });

  test("keeps ids stable while descriptions and errors are added and removed", () => {
    const { rerender } = render(<CheckboxElement title="Email updates" />);
    const checkbox: HTMLElement = screen.getByRole("checkbox");
    const inputId: string = checkbox.id;

    expect(checkbox).not.toHaveAttribute("aria-describedby");

    rerender(
      <CheckboxElement
        title="Email updates"
        description="Receive email notifications."
        error="Verify your email."
      />,
    );

    expect(checkbox.id).toBe(inputId);
    expect(checkbox).toHaveAccessibleDescription(
      "Receive email notifications. Verify your email.",
    );

    rerender(
      <CheckboxElement
        title="Email updates"
        description="Receive email notifications."
      />,
    );

    expect(checkbox).toHaveAccessibleDescription(
      "Receive email notifications.",
    );
    expect(checkbox).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(<CheckboxElement title="Email updates" />);

    expect(checkbox.id).toBe(inputId);
    expect(checkbox).not.toHaveAttribute("aria-describedby");
  });

  test("preserves initial and controlled checked values", () => {
    const { rerender } = render(
      <CheckboxElement title="Email updates" initialValue={true} />,
    );
    const checkbox: HTMLElement = screen.getByRole("checkbox");

    expect(checkbox).toBeChecked();

    rerender(<CheckboxElement title="Email updates" value={false} />);
    expect(checkbox).not.toBeChecked();

    rerender(<CheckboxElement title="Email updates" value={true} />);
    expect(checkbox).toBeChecked();
  });

  test("preserves indeterminate state and the label change callback", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const { rerender } = render(
      <CheckboxElement
        title="Select all monitors"
        isIndeterminate={true}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("checkbox")).toBePartiallyChecked();

    await act(async () => {
      await user.click(screen.getByText("Select all monitors"));
    });

    expect(onChange).toHaveBeenCalledWith(true, true);

    rerender(
      <CheckboxElement title="Select all monitors" isIndeterminate={false} />,
    );

    expect(screen.getByRole("checkbox")).not.toBePartiallyChecked();
  });
});

describe("Checkbox list label integration", () => {
  test("clicking one option label selects only that option and preserves other selections", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const onChecked: ReturnType<typeof jest.fn> = jest.fn();
    const onUnchecked: ReturnType<typeof jest.fn> = jest.fn();
    render(
      <CheckBoxList
        options={[
          { label: "Email", value: "email" },
          { label: "SMS", value: "sms" },
        ]}
        initialValue={["email"]}
        onChange={onChange}
        onChecked={onChecked}
        onUnchecked={onUnchecked}
      />,
    );

    await act(async () => {
      await user.click(screen.getByText("SMS"));
    });

    expect(screen.getByRole("checkbox", { name: "Email" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SMS" })).toBeChecked();
    expect(onChecked).toHaveBeenCalledTimes(1);
    expect(onChecked).toHaveBeenCalledWith("sms");
    expect(onChange).toHaveBeenLastCalledWith(["email", "sms"]);

    await act(async () => {
      await user.click(screen.getByText("Email"));
    });

    expect(screen.getByRole("checkbox", { name: "Email" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SMS" })).toBeChecked();
    expect(onUnchecked).toHaveBeenCalledTimes(1);
    expect(onUnchecked).toHaveBeenCalledWith("email");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(["sms"]);
  });

  test("keyboard navigation reaches and changes each named option", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    render(
      <CheckBoxList
        options={[
          { label: "Email", value: "email" },
          { label: "SMS", value: "sms" },
        ]}
        onChange={onChange}
      />,
    );

    await act(async () => {
      await user.tab();
    });
    expect(screen.getByRole("checkbox", { name: "Email" })).toHaveFocus();
    await act(async () => {
      await user.keyboard(" ");
      await user.tab();
    });
    expect(screen.getByRole("checkbox", { name: "SMS" })).toHaveFocus();
    await act(async () => {
      await user.keyboard(" ");
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(["email", "sms"]);
  });
});
