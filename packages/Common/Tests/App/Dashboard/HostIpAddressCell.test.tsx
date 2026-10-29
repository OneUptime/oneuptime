import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import { IpAddressCell } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Hosts";

/*
 * The Hosts list's IP Addresses cell: the address most likely to be the one
 * people mean first, the rest folded under "+N more". "+N more" and Show
 * less used to be two buttons, one drawn per state, so a press unmounted the
 * button it was made on and focus fell back to the page, and neither said
 * whether the rest was open (issue #5364's sweep of show-mores). It is one
 * button now, under the addresses, whose words follow the state.
 */

const ADDRESSES: string = "10.0.0.12, 192.168.1.20, fe80::1, 127.0.0.1";

afterEach(() => {
  cleanup();
});

describe("a host's IP addresses", () => {
  test("shows the first address, the rest folded behind one button that says so", () => {
    render(<IpAddressCell ipString={ADDRESSES} />);

    expect(screen.getByText("10.0.0.12")).toBeInTheDocument();
    expect(screen.queryByText("192.168.1.20")).not.toBeInTheDocument();

    const toggle: HTMLElement = screen.getByTestId("host-ip-addresses-toggle");

    expect(toggle).toHaveTextContent("+3 more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
  });

  test("opens the rest above the button, which becomes Show less and keeps focus", () => {
    render(<IpAddressCell ipString={ADDRESSES} />);

    const toggle: HTMLElement = screen.getByTestId("host-ip-addresses-toggle");

    toggle.focus();
    fireEvent.click(toggle);

    const rest: HTMLElement = screen.getByTestId("host-ip-addresses-rest");

    expect(rest).toHaveTextContent("192.168.1.20");
    expect(rest).toHaveTextContent("fe80::1");
    expect(rest).toHaveTextContent("127.0.0.1");

    expect(screen.getByTestId("host-ip-addresses-toggle")).toBe(toggle);
    expect(toggle).toHaveTextContent("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", rest.id);
    expect(toggle).toHaveFocus();

    // The rest is listed above the button that folds it.
    expect(
      rest.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Show less folds the rest away again, focus still on the button", () => {
    render(<IpAddressCell ipString={ADDRESSES} />);

    const toggle: HTMLElement = screen.getByTestId("host-ip-addresses-toggle");

    toggle.focus();
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(
      screen.queryByTestId("host-ip-addresses-rest"),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveTextContent("+3 more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  // The cell sits in a clickable table row: the button must not open the host.
  test("a press stays with the button, not the row it sits in", () => {
    let rowClicks: number = 0;

    render(
      <div
        onClick={() => {
          rowClicks++;
        }}
      >
        <IpAddressCell ipString={ADDRESSES} />
      </div>,
    );

    fireEvent.click(screen.getByTestId("host-ip-addresses-toggle"));
    fireEvent.click(screen.getByTestId("host-ip-addresses-toggle"));

    expect(rowClicks).toBe(0);
  });

  /*
   * A keyboard reaches it in a table of hosts: its focus ring is the
   * product's link ring, with room around the words, not the browser's
   * outline drawn tight on them - and the words stay in line with the
   * addresses above them.
   */
  test("draws the product's focus ring, its words in line with the addresses", () => {
    render(<IpAddressCell ipString={ADDRESSES} />);

    const toggle: HTMLElement = screen.getByTestId("host-ip-addresses-toggle");

    expect(toggle).toHaveClass(
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
      "rounded-sm",
      "-mx-1",
      "px-1",
    );

    fireEvent.click(toggle);

    expect(toggle).toHaveClass("focus-visible:ring-2", "-mx-1", "px-1");
  });

  test("one address draws no button", () => {
    render(<IpAddressCell ipString="10.0.0.12" />);

    expect(screen.getByText("10.0.0.12")).toBeInTheDocument();
    expect(
      screen.queryByTestId("host-ip-addresses-toggle"),
    ).not.toBeInTheDocument();
  });
});
