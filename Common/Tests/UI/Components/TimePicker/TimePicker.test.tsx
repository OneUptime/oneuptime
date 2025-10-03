/** @jest-environment jsdom */
/*
 * Ensure deterministic timezone for Date#getHours() etc.
 * This must be set before importing the component under test.
 */
// eslint-disable-next-line no-undef
process.env.TZ = "UTC";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import TimePicker from "../../../../UI/Components/TimePicker/TimePicker";
import DateUtilities from "../../../../Types/Date";

type DateModule = typeof import("../../../../Types/Date");
type DateLib = DateModule["default"];
type MockedDateLib = jest.Mocked<DateLib>;
type UserEventInstance = ReturnType<typeof userEvent.setup>;
type ChangeHandler = jest.Mock<void, [string | undefined]>;
type VoidHandler = jest.Mock<void, []>;
type DialogElement = HTMLElement;
type ButtonElement = HTMLButtonElement;
type InputElement = HTMLInputElement;
type HourMinuteMock = {
  getHours: () => number;
  getMinutes: () => number;
};

// Mock OneUptimeDate utilities used by the component
jest.mock("../../../../Types/Date", () => {
  const real: DateModule = jest.requireActual("../../../../Types/Date");
  // Helper to create a minimal date-like object with getHours/getMinutes
  const makeHM: (h: number, m: number) => HourMinuteMock = (
    h: number,
    m: number,
  ): HourMinuteMock => {
    return {
      getHours: () => {
        return h;
      },
      getMinutes: () => {
        return m;
      },
    };
  };
  return {
    __esModule: true,
    default: {
      ...real.default,
      getUserPrefers12HourFormat: jest.fn(() => {
        return false;
      }), // default to 24h; tests can override per test
      getCurrentDate: jest.fn(() => {
        return makeHM(13, 45) as unknown as Date;
      }),
      fromString: jest.fn((v: string | Date) => {
        if (!v) {
          return undefined as unknown as Date;
        }
        if (typeof v === "string") {
          const match: RegExpMatchArray | null = v.match(/T(\d{2}):(\d{2})/);
          const hh: number = match ? parseInt(match[1] as string, 10) : 0;
          const mm: number = match ? parseInt(match[2] as string, 10) : 0;
          return makeHM(hh, mm) as unknown as Date;
        }
        // If a Date instance is provided, prefer UTC to avoid env timezone
        const d: Date = v;
        const hasUtcHours: (() => number) | undefined = (
          d as { getUTCHours?: () => number }
        ).getUTCHours;
        const hasUtcMinutes: (() => number) | undefined = (
          d as { getUTCMinutes?: () => number }
        ).getUTCMinutes;
        const hh: number = hasUtcHours ? hasUtcHours.call(d) : d.getHours();
        const mm: number = hasUtcMinutes
          ? hasUtcMinutes.call(d)
          : d.getMinutes();
        return makeHM(hh, mm) as unknown as Date;
      }),
      toString: jest.fn((d: Date) => {
        return d.toISOString();
      }),
      getDateWithCustomTime: jest.fn(
        ({
          hours,
          minutes,
        }: {
          hours: number;
          minutes: number;
          seconds?: number;
        }) => {
          const base: Date = new Date("2024-05-15T00:00:00.000Z");
          base.setUTCHours(hours, minutes, 0, 0);
          return base;
        },
      ),
      getCurrentTimezoneString: jest.fn(() => {
        return "UTC";
      }),
      getCurrentTimezone: jest.fn(() => {
        return "Etc/UTC";
      }),
    },
  };
});

// Mock Icon to avoid SVG complexity
jest.mock("../../../../UI/Components/Icon/Icon", () => {
  return {
    __esModule: true,
    default: ({ className }: { className?: string }) => {
      return <i data-testid="icon" className={className} />;
    },
  };
});

// Mock Modal to render children immediately and expose submit/close
jest.mock("../../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    default: ({
      title,
      description,
      onClose,
      onSubmit,
      children,
      submitButtonText,
    }: any) => {
      return (
        <div role="dialog" aria-label={title}>
          <div>{description}</div>
          <div>{children}</div>
          <button onClick={onSubmit}>{submitButtonText ?? "Apply"}</button>
          <button onClick={onClose}>Close</button>
        </div>
      );
    },
    ModalWidth: { Medium: "Medium" },
  };
});

const getDateLib: () => MockedDateLib = () => {
  return DateUtilities as MockedDateLib;
};

describe("TimePicker", () => {
  beforeEach(() => {
    // Do not reset implementations provided by jest.mock factory; only clear call history
    jest.clearAllMocks();
  });

  it("renders in 24h by default and shows current time", () => {
    const onChange: ChangeHandler = jest.fn();
    render(<TimePicker value="2024-05-15T08:05:00.000Z" onChange={onChange} />);

    // Should display HH:mm based on value prop
    expect(screen.getByLabelText("Hours")).toHaveValue("08");
    expect(screen.getByLabelText("Minutes")).toHaveValue("05");

    // AM/PM buttons are not shown in 24h
    expect(
      screen.queryByRole("button", { name: "AM" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "PM" }),
    ).not.toBeInTheDocument();
  });

  it("opens modal on click when enabled", async () => {
    const user: UserEventInstance = userEvent.setup();
    render(<TimePicker value="2024-05-15T10:20:00.000Z" />);

    // Click the field container by clicking on hours input
    await user.click(screen.getByLabelText("Hours"));

    // Modal should appear
    expect(
      screen.getByRole("dialog", { name: "Select time" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/your UTC/i)).toBeInTheDocument();
  });

  it("does not open modal when readOnly or disabled", async () => {
    const user: UserEventInstance = userEvent.setup();
    const { rerender } = render(
      <TimePicker value="2024-05-15T10:20:00.000Z" readOnly />,
    );

    await user.click(screen.getByLabelText("Hours"));
    expect(
      screen.queryByRole("dialog", { name: "Select time" }),
    ).not.toBeInTheDocument();

    rerender(<TimePicker value="2024-05-15T10:20:00.000Z" disabled />);
    await user.click(screen.getByLabelText("Minutes"));
    expect(
      screen.queryByRole("dialog", { name: "Select time" }),
    ).not.toBeInTheDocument();
  });

  it("applies changes from modal and emits ISO via onChange (24h)", async () => {
    const user: UserEventInstance = userEvent.setup();
    const onChange: ChangeHandler = jest.fn();
    render(<TimePicker value="2024-05-15T08:05:00.000Z" onChange={onChange} />);

    // Open modal
    await user.click(screen.getByLabelText("Hours"));
    const dialog: DialogElement = screen.getByRole("dialog", {
      name: "Select time",
    });

    // Increase hours and minutes using the chevrons
    const incHour: ButtonElement = within(dialog).getByLabelText(
      "Increase hours",
    ) as HTMLButtonElement;
    const incMin: ButtonElement = within(dialog).getByLabelText(
      "Increase minutes",
    ) as HTMLButtonElement;

    await user.click(incHour); // 08 -> 09
    await user.click(incMin); // 05 -> 06

    // Apply
    await user.click(
      within(dialog).getByRole("button", {
        name: "Apply",
      }),
    );

    // onChange should be called with ISO string
    expect(onChange).toHaveBeenCalledTimes(1);
    const emittedCall: [string | undefined] | undefined =
      onChange.mock.calls[0];
    expect(emittedCall).toBeDefined();
    const emitted: string = (emittedCall as [string])[0];
    expect(typeof emitted).toBe("string");

    const lib: MockedDateLib = getDateLib();
    // getDateWithCustomTime uses UTC hours in our mock; 9:06 maps to 09:06:00Z on the chosen date
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({
      hours: 9,
      minutes: 6,
      seconds: 0,
    });
  });

  it("supports decrement wrapping for hours and minutes (24h)", async () => {
    const user: UserEventInstance = userEvent.setup();
    const onChange: ChangeHandler = jest.fn();
    render(<TimePicker value="2024-05-15T00:00:00.000Z" onChange={onChange} />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog: DialogElement = screen.getByRole("dialog", {
      name: "Select time",
    });

    const decHour: ButtonElement = within(dialog).getByLabelText(
      "Decrease hours",
    ) as HTMLButtonElement;
    const decMin: ButtonElement = within(dialog).getByLabelText(
      "Decrease minutes",
    ) as HTMLButtonElement;

    // Minutes 00 -> 59 and hours 00 -> 23 when decreasing
    await user.click(decMin);
    await user.click(decHour);

    await user.click(
      within(dialog).getByRole("button", {
        name: "Apply",
      }),
    );

    const lib: MockedDateLib = getDateLib();
    // dec minute first -> 00 -> 59, hours 0->23, then dec hour -> 22
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({
      hours: 22,
      minutes: 59,
      seconds: 0,
    });
  });

  it("renders and operates in 12h mode with AM/PM toggles", async () => {
    const user: UserEventInstance = userEvent.setup();
    const lib: MockedDateLib = getDateLib();
    lib.getUserPrefers12HourFormat.mockReturnValue(true);

    const onChange: ChangeHandler = jest.fn();
    render(<TimePicker value="2024-05-15T13:45:00.000Z" onChange={onChange} />);

    // Displays 01:45 PM
    expect(screen.getByLabelText("Hours")).toHaveValue("01");
    const apButtons: HTMLElement[] = screen.getAllByRole("button", {
      name: "Open time selector for AM/PM",
    });
    expect(apButtons).toHaveLength(2);

    await user.click(screen.getByLabelText("Hours"));
    const dialog: DialogElement = screen.getByRole("dialog", {
      name: "Select time",
    });

    // Modal description should reflect 12h mode
    expect(
      within(dialog).getByText(/choose hours, minutes, and AM\/PM/i),
    ).toBeInTheDocument();

    // Toggle to AM and change hour input to 12 to map to 00
    await user.click(
      within(dialog).getByRole("button", { name: /^AM$/ }) as HTMLButtonElement,
    );
    const hourInput: InputElement = within(dialog).getByLabelText(
      "Hours",
    ) as InputElement;
    // Change to 12
    await user.clear(hourInput);
    await user.type(hourInput, "12");

    await user.click(
      within(dialog).getByRole("button", {
        name: "Apply",
      }),
    );

    // Should map to hours 0 in 24h
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({
      hours: 0,
      minutes: 45,
      seconds: 0,
    });
  });

  it("AM/PM button mapping inside modal", async () => {
    const user: UserEventInstance = userEvent.setup();
    const lib: MockedDateLib = getDateLib();
    lib.getUserPrefers12HourFormat.mockReturnValue(true);

    render(<TimePicker value="2024-05-15T01:10:00.000Z" />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog: DialogElement = screen.getByRole("dialog", {
      name: "Select time",
    });
    // Click PM, should add 12 hours (1 -> 13)
    await user.click(
      within(dialog).getByRole("button", { name: /^PM$/ }) as HTMLButtonElement,
    );

    // Increase minutes to 11 to ensure state changed
    await user.click(
      within(dialog).getByLabelText("Increase minutes") as HTMLButtonElement,
    );

    await user.click(
      within(dialog).getByRole("button", {
        name: "Apply",
      }),
    );

    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({
      hours: 13,
      minutes: 11,
      seconds: 0,
    });
  });

  it("quick minutes buttons set minutes", async () => {
    const user: UserEventInstance = userEvent.setup();
    const onChange: ChangeHandler = jest.fn();
    render(<TimePicker value="2024-05-15T08:05:00.000Z" onChange={onChange} />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog: DialogElement = screen.getByRole("dialog", {
      name: "Select time",
    });

    await user.click(
      within(dialog).getByRole("button", { name: "05" }) as HTMLButtonElement,
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "Apply",
      }) as HTMLButtonElement,
    );

    const lib: MockedDateLib = getDateLib();
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({
      hours: 8,
      minutes: 5,
      seconds: 0,
    });
  });

  it("respects placeholder in 24h and 12h modes", () => {
    const lib: MockedDateLib = getDateLib();
    lib.getUserPrefers12HourFormat.mockReturnValue(false);
    const { unmount } = render(<TimePicker placeholder="HH" />);
    expect(screen.getByLabelText("Hours")).toHaveAttribute("placeholder", "HH");

    lib.getUserPrefers12HourFormat.mockReturnValue(true);
    unmount();
    render(<TimePicker />);
    expect(screen.getByLabelText("Hours")).toHaveAttribute("placeholder", "hh");
  });

  it("shows error icon and message when error prop is set", () => {
    render(<TimePicker error="Required" />);

    expect(screen.getByTestId("error-message")).toHaveTextContent("Required");
    // Error icon rendered
    expect(
      screen.getAllByTestId("icon").some((iconEl: HTMLElement) => {
        return iconEl.className?.includes("text-red-500");
      }),
    ).toBeTruthy();
  });

  it("calls onFocus and onBlur from the hours input", async () => {
    const user: UserEventInstance = userEvent.setup();
    const onFocus: VoidHandler = jest.fn();
    const onBlur: VoidHandler = jest.fn();

    render(<TimePicker onFocus={onFocus} onBlur={onBlur} />);

    const hours: InputElement = screen.getByLabelText("Hours") as InputElement;
    await user.click(hours);
    expect(onFocus).toHaveBeenCalled();

    hours.blur();
    expect(onBlur).toHaveBeenCalled();
  });

  it("updates when value prop changes", () => {
    // Force 24h mode for this test to avoid bleed from prior tests
    const lib: MockedDateLib = getDateLib();
    lib.getUserPrefers12HourFormat.mockReturnValue(false);

    const { rerender } = render(
      <TimePicker value="2024-05-15T02:03:00.000Z" />,
    );
    expect(screen.getByLabelText("Hours")).toHaveValue("02");
    expect(screen.getByLabelText("Minutes")).toHaveValue("03");

    rerender(<TimePicker value="2024-05-15T21:59:00.000Z" />);
    expect(screen.getByLabelText("Hours")).toHaveValue("21");
    expect(screen.getByLabelText("Minutes")).toHaveValue("59");
  });

  it("clamps and maps hour text edits inside modal for 12h", async () => {
    const user: UserEventInstance = userEvent.setup();
    const lib: MockedDateLib = getDateLib();
    lib.getUserPrefers12HourFormat.mockReturnValue(true);

    render(<TimePicker value="2024-05-15T12:00:00.000Z" />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog: DialogElement = screen.getByRole("dialog", {
      name: "Select time",
    });

    const hourInput: InputElement = within(dialog).getByLabelText(
      "Hours",
    ) as InputElement;
    await user.clear(hourInput);
    await user.type(hourInput, "99"); // should clamp to 12 in 12h mode

    await user.click(
      within(dialog).getByRole("button", {
        name: "Apply",
      }),
    );

    // 12 PM stays 12 (i.e., 12 in 24h), with minutes from initial value 00
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({
      hours: 12,
      minutes: 0,
      seconds: 0,
    });
  });

  it("minute text edits clamp to 0-59", async () => {
    const user: UserEventInstance = userEvent.setup();
    render(<TimePicker value="2024-05-15T10:10:00.000Z" />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog: DialogElement = screen.getByRole("dialog", {
      name: "Select time",
    });

    const minInput: InputElement = within(dialog).getByLabelText(
      "Minutes",
    ) as InputElement;
    await user.clear(minInput);
    await user.type(minInput, "99");

    await user.click(
      within(dialog).getByRole("button", {
        name: "Apply",
      }),
    );

    const lib: MockedDateLib = getDateLib();
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({
      hours: 10,
      minutes: 59,
      seconds: 0,
    });
  });

  it("modal Close does not emit change or update main display", async () => {
    const user: UserEventInstance = userEvent.setup();
    const onChange: ChangeHandler = jest.fn();
    render(<TimePicker value="2024-05-15T08:05:00.000Z" onChange={onChange} />);

    // Open modal, change something, then close
    await user.click(screen.getByLabelText("Hours"));
    const dialog: DialogElement = screen.getByRole("dialog", {
      name: "Select time",
    });
    await user.click(
      within(dialog).getByLabelText("Increase hours") as HTMLButtonElement,
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "Close",
      }) as HTMLButtonElement,
    );

    // No onChange called
    expect(onChange).not.toHaveBeenCalled();

    // Still shows original value
    expect(screen.getByLabelText("Hours")).toHaveValue("08");
  });
});
