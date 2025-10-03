/** @jest-environment jsdom */
// Ensure deterministic timezone for Date#getHours() etc.
// This must be set before importing the component under test.
// eslint-disable-next-line no-undef
process.env.TZ = "UTC";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import TimePicker from "../../../../UI/Components/TimePicker/TimePicker";

// Mock OneUptimeDate utilities used by the component
jest.mock("../../../../Types/Date", () => {
  const real = jest.requireActual("../../../../Types/Date");
  // Helper to create a minimal date-like object with getHours/getMinutes
  const makeHM = (h: number, m: number) => ({ getHours: () => h, getMinutes: () => m });
  return {
    __esModule: true,
    default: {
      ...real.default,
      getUserPrefers12HourFormat: jest.fn(() => false), // default to 24h; tests can override per test
      getCurrentDate: jest.fn(() => makeHM(13, 45) as any),
      fromString: jest.fn((v: string | Date) => {
        if (!v) { return undefined as any; }
        if (typeof v === "string") {
          const m = v.match(/T(\d{2}):(\d{2})/);
          const hh = m ? parseInt(m[1] as string, 10) : 0;
          const mm = m ? parseInt(m[2] as string, 10) : 0;
          return makeHM(hh, mm) as any;
        }
        // If a Date instance is provided, prefer UTC to avoid env timezone
        const d = v as Date;
        const hh = (d as any).getUTCHours ? (d as any).getUTCHours() : d.getHours();
        const mm = (d as any).getUTCMinutes ? (d as any).getUTCMinutes() : d.getMinutes();
        return makeHM(hh, mm) as any;
      }),
      toString: jest.fn((d: Date) => d.toISOString()),
      getDateWithCustomTime: jest.fn(({ hours, minutes }: { hours: number; minutes: number; seconds?: number }) => {
        const base = new Date("2024-05-15T00:00:00.000Z");
        base.setUTCHours(hours, minutes, 0, 0);
        return base;
      }),
      getCurrentTimezoneString: jest.fn(() => "UTC"),
      getCurrentTimezone: jest.fn(() => "Etc/UTC"),
    },
  };
});

// Mock Icon to avoid SVG complexity
jest.mock("../../../../UI/Components/Icon/Icon", () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => <i data-testid="icon" className={className} />,
}));

// Mock Modal to render children immediately and expose submit/close
jest.mock("../../../../UI/Components/Modal/Modal", () => ({
  __esModule: true,
  default: ({ title, description, onClose, onSubmit, children, submitButtonText }: any) => (
    <div role="dialog" aria-label={title}>
      <div>{description}</div>
      <div>{children}</div>
      <button onClick={onSubmit}>{submitButtonText ?? "Apply"}</button>
      <button onClick={onClose}>Close</button>
    </div>
  ),
  ModalWidth: { Medium: "Medium" },
}));

const getDateLib = () => require("../../../../Types/Date").default;

describe("TimePicker", () => {
  beforeEach(() => {
    // Do not reset implementations provided by jest.mock factory; only clear call history
    jest.clearAllMocks();
  });

  it("renders in 24h by default and shows current time", () => {
    const onChange = jest.fn();
    render(<TimePicker value="2024-05-15T08:05:00.000Z" onChange={onChange} />);

    // Should display HH:mm based on value prop
    expect(screen.getByLabelText("Hours")).toHaveValue("08");
    expect(screen.getByLabelText("Minutes")).toHaveValue("05");

    // AM/PM buttons are not shown in 24h
    expect(screen.queryByRole("button", { name: "AM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PM" })).not.toBeInTheDocument();
  });

  it("opens modal on click when enabled", async () => {
    const user = userEvent.setup();
    render(<TimePicker value="2024-05-15T10:20:00.000Z" />);

    // Click the field container by clicking on hours input
    await user.click(screen.getByLabelText("Hours"));

    // Modal should appear
    expect(screen.getByRole("dialog", { name: "Select time" })).toBeInTheDocument();
    expect(screen.getByText(/your UTC/i)).toBeInTheDocument();
  });

  it("does not open modal when readOnly or disabled", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TimePicker value="2024-05-15T10:20:00.000Z" readOnly />);

    await user.click(screen.getByLabelText("Hours"));
    expect(screen.queryByRole("dialog", { name: "Select time" })).not.toBeInTheDocument();

    rerender(<TimePicker value="2024-05-15T10:20:00.000Z" disabled />);
    await user.click(screen.getByLabelText("Minutes"));
    expect(screen.queryByRole("dialog", { name: "Select time" })).not.toBeInTheDocument();
  });

  it("applies changes from modal and emits ISO via onChange (24h)", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<TimePicker value="2024-05-15T08:05:00.000Z" onChange={onChange} />);

    // Open modal
    await user.click(screen.getByLabelText("Hours"));
    const dialog = screen.getByRole("dialog", { name: "Select time" });

    // Increase hours and minutes using the chevrons
    const incHour = within(dialog).getByLabelText("Increase hours");
    const incMin = within(dialog).getByLabelText("Increase minutes");

    await user.click(incHour); // 08 -> 09
    await user.click(incMin); // 05 -> 06

    // Apply
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    // onChange should be called with ISO string
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as string;
    expect(typeof emitted).toBe("string");

    const lib = getDateLib();
    // getDateWithCustomTime uses UTC hours in our mock; 9:06 maps to 09:06:00Z on the chosen date
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({ hours: 9, minutes: 6, seconds: 0 });
  });

  it("supports decrement wrapping for hours and minutes (24h)", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<TimePicker value="2024-05-15T00:00:00.000Z" onChange={onChange} />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog = screen.getByRole("dialog", { name: "Select time" });

    const decHour = within(dialog).getByLabelText("Decrease hours");
    const decMin = within(dialog).getByLabelText("Decrease minutes");

    // Minutes 00 -> 59 and hours 00 -> 23 when decreasing
    await user.click(decMin);
    await user.click(decHour);

    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    const lib = getDateLib();
    // dec minute first -> 00 -> 59, hours 0->23, then dec hour -> 22
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({ hours: 22, minutes: 59, seconds: 0 });
  });

  it("renders and operates in 12h mode with AM/PM toggles", async () => {
    const user = userEvent.setup();
    const lib = getDateLib();
    (lib.getUserPrefers12HourFormat as jest.Mock).mockReturnValue(true);

    const onChange = jest.fn();
    render(<TimePicker value="2024-05-15T13:45:00.000Z" onChange={onChange} />);

    // Displays 01:45 PM
    expect(screen.getByLabelText("Hours")).toHaveValue("01");
    expect(screen.getByLabelText("Minutes")).toHaveValue("45");
  // Inline AM/PM buttons have aria-label overriding the name
  const apButtons = screen.getAllByRole("button", { name: "Open time selector for AM/PM" });
  expect(apButtons).toHaveLength(2);

    await user.click(screen.getByLabelText("Hours"));
    const dialog = screen.getByRole("dialog", { name: "Select time" });

    // Modal description should reflect 12h mode
    expect(within(dialog).getByText(/choose hours, minutes, and AM\/PM/i)).toBeInTheDocument();

    // Toggle to AM and change hour input to 12 to map to 00
    await user.click(within(dialog).getByRole("button", { name: /^AM$/ }));

    const hourInput = within(dialog).getByLabelText("Hours");
    // Change to 12
    await user.clear(hourInput);
    await user.type(hourInput, "12");

    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    // Should map to hours 0 in 24h
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({ hours: 0, minutes: 45, seconds: 0 });
  });

  it("AM/PM button mapping inside modal", async () => {
    const user = userEvent.setup();
    const lib = getDateLib();
    (lib.getUserPrefers12HourFormat as jest.Mock).mockReturnValue(true);

    render(<TimePicker value="2024-05-15T01:10:00.000Z" />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog = screen.getByRole("dialog", { name: "Select time" });
    // Click PM, should add 12 hours (1 -> 13)
    await user.click(within(dialog).getByRole("button", { name: /^PM$/ }));

    // Increase minutes to 11 to ensure state changed
    await user.click(within(dialog).getByLabelText("Increase minutes"));

    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({ hours: 13, minutes: 11, seconds: 0 });
  });

  it("quick minutes buttons set minutes", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<TimePicker value="2024-05-15T08:05:00.000Z" onChange={onChange} />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog = screen.getByRole("dialog", { name: "Select time" });

    await user.click(within(dialog).getByRole("button", { name: "05" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    const lib = getDateLib();
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({ hours: 8, minutes: 5, seconds: 0 });
  });

  it("respects placeholder in 24h and 12h modes", () => {
    const lib = getDateLib();
    (lib.getUserPrefers12HourFormat as jest.Mock).mockReturnValue(false);
    const { unmount } = render(<TimePicker placeholder="HH" />);
    expect(screen.getByLabelText("Hours")).toHaveAttribute("placeholder", "HH");

    (lib.getUserPrefers12HourFormat as jest.Mock).mockReturnValue(true);
    unmount();
    render(<TimePicker />);
    expect(screen.getByLabelText("Hours")).toHaveAttribute("placeholder", "hh");
  });

  it("shows error icon and message when error prop is set", () => {
    render(<TimePicker error="Required" />);

    expect(screen.getByTestId("error-message")).toHaveTextContent("Required");
    // Error icon rendered
    expect(screen.getAllByTestId("icon").some(i => i.className?.includes("text-red-500"))).toBeTruthy();
  });

  it("calls onFocus and onBlur from the hours input", async () => {
    const user = userEvent.setup();
    const onFocus = jest.fn();
    const onBlur = jest.fn();

    render(<TimePicker onFocus={onFocus} onBlur={onBlur} />);

    const hours = screen.getByLabelText("Hours");
    await user.click(hours);
    expect(onFocus).toHaveBeenCalled();

    hours.blur();
    expect(onBlur).toHaveBeenCalled();
  });

  it("updates when value prop changes", () => {
    // Force 24h mode for this test to avoid bleed from prior tests
    const lib = getDateLib();
    (lib.getUserPrefers12HourFormat as jest.Mock).mockReturnValue(false);

    const { rerender } = render(<TimePicker value="2024-05-15T02:03:00.000Z" />);
    expect(screen.getByLabelText("Hours")).toHaveValue("02");
    expect(screen.getByLabelText("Minutes")).toHaveValue("03");

    rerender(<TimePicker value="2024-05-15T21:59:00.000Z" />);
    expect(screen.getByLabelText("Hours")).toHaveValue("21");
    expect(screen.getByLabelText("Minutes")).toHaveValue("59");
  });

  it("clamps and maps hour text edits inside modal for 12h", async () => {
    const user = userEvent.setup();
    const lib = getDateLib();
    (lib.getUserPrefers12HourFormat as jest.Mock).mockReturnValue(true);

    render(<TimePicker value="2024-05-15T12:00:00.000Z" />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog = screen.getByRole("dialog", { name: "Select time" });

    const hourInput = within(dialog).getByLabelText("Hours");
    await user.clear(hourInput);
    await user.type(hourInput, "99"); // should clamp to 12 in 12h mode

    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    // 12 PM stays 12 (i.e., 12 in 24h), with minutes from initial value 00
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({ hours: 12, minutes: 0, seconds: 0 });
  });

  it("minute text edits clamp to 0-59", async () => {
    const user = userEvent.setup();
    render(<TimePicker value="2024-05-15T10:10:00.000Z" />);

    await user.click(screen.getByLabelText("Hours"));
    const dialog = screen.getByRole("dialog", { name: "Select time" });

    const minInput = within(dialog).getByLabelText("Minutes");
    await user.clear(minInput);
    await user.type(minInput, "99");

    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    const lib = getDateLib();
    expect(lib.getDateWithCustomTime).toHaveBeenCalledWith({ hours: 10, minutes: 59, seconds: 0 });
  });

  it("modal Close does not emit change or update main display", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<TimePicker value="2024-05-15T08:05:00.000Z" onChange={onChange} />);

    // Open modal, change something, then close
    await user.click(screen.getByLabelText("Hours"));
    const dialog = screen.getByRole("dialog", { name: "Select time" });
    await user.click(within(dialog).getByLabelText("Increase hours"));
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    // No onChange called
    expect(onChange).not.toHaveBeenCalled();

    // Still shows original value
    expect(screen.getByLabelText("Hours")).toHaveValue("08");
  });
});
