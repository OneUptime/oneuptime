import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import PacketCaptureFilterInput from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureFilterInput";
import {
  getDefaultFilterValue,
  PacketCaptureFilterMode,
  PacketCaptureFilterValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureViewModel";
import { PacketCaptureProtocol } from "../../../Types/PacketCapture/PacketCaptureFilter";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Which packets a capture keeps. Most people fill in a host, a port and a
 * protocol and never see BPF: the expression they make is shown under the
 * boxes, and "Write a BPF filter instead" starts from it. A mistake is said
 * in words, as an alert, before anything is sent - the same words the
 * server would answer with.
 */

function renderInput(
  props: {
    initialValue?: PacketCaptureFilterValue;
    error?: string;
  } = {},
): MockFunction {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <PacketCaptureFilterInput
      initialValue={props.initialValue}
      onChange={
        onChange as unknown as (value: PacketCaptureFilterValue) => void
      }
      interfaceLabel="eth0"
      error={props.error}
    />,
  );

  return onChange;
}

function preview(): HTMLElement {
  return screen.getByTestId("packet-capture-filter-preview");
}

function lastValue(onChange: MockFunction): PacketCaptureFilterValue {
  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as PacketCaptureFilterValue;
}

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value: value } });
}

async function pickProtocol(name: string): Promise<void> {
  const picker: HTMLElement = screen.getByRole("combobox", {
    name: "Protocol",
  });

  fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });

  await act(async () => {
    fireEvent.click(await screen.findByRole("option", { name: name }));
  });
}

afterEach(() => {
  cleanup();
});

describe("the host, port and protocol boxes", () => {
  test("start empty, keeping every packet on the interface picked above", () => {
    const onChange: MockFunction = renderInput();

    expect(screen.getByTestId("packet-capture-filter-host")).toHaveValue("");
    expect(screen.getByTestId("packet-capture-filter-port")).toHaveValue("");
    expect(preview()).toHaveTextContent(
      "No filter: every packet on eth0 is kept.",
    );

    // The starting value is reported once, so the form holds it before any edit.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastValue(onChange)).toEqual(getDefaultFilterValue());
  });

  test("start from the device's address on a device's page", () => {
    renderInput({ initialValue: getDefaultFilterValue("10.0.0.5") });

    expect(screen.getByTestId("packet-capture-filter-host")).toHaveValue(
      "10.0.0.5",
    );
    expect(preview()).toHaveTextContent("Filter: host 10.0.0.5");
  });

  test("show the expression they make as they are filled in", async () => {
    const onChange: MockFunction = renderInput();

    type("packet-capture-filter-host", "10.0.0.0/24");
    expect(preview()).toHaveTextContent("Filter: net 10.0.0.0/24");

    type("packet-capture-filter-port", "443");
    expect(preview()).toHaveTextContent("Filter: net 10.0.0.0/24 and port 443");

    await pickProtocol("TCP");
    expect(preview()).toHaveTextContent(
      "Filter: net 10.0.0.0/24 and tcp port 443",
    );

    expect(lastValue(onChange)).toEqual({
      mode: PacketCaptureFilterMode.Simple,
      host: "10.0.0.0/24",
      port: "443",
      protocol: PacketCaptureProtocol.TCP,
      expression: "",
    });
  });

  test("a host with its subnet's prefix length is shown as the network it is in", () => {
    renderInput();

    type("packet-capture-filter-host", "10.0.0.5/24");

    expect(preview()).toHaveTextContent("Filter: net 10.0.0.0/24");
  });

  test("say what is wrong, as an alert, in the server's words", async () => {
    renderInput();

    type("packet-capture-filter-port", "70000");

    expect(preview()).toHaveAttribute("role", "alert");
    expect(preview()).toHaveTextContent(
      "The port must be a number from 1 to 65535, or a range such as 8000-8080.",
    );

    type("packet-capture-filter-port", "53");
    expect(preview()).not.toHaveAttribute("role");

    await pickProtocol("ICMP");
    expect(preview()).toHaveTextContent(
      "ICMP has no ports. Clear the port, or pick TCP or UDP.",
    );
  });

  test("a host that is a word of the filter language is refused", () => {
    renderInput();

    type("packet-capture-filter-host", "port");

    expect(preview()).toHaveTextContent(
      '"port" is a word of the filter language, not a host.',
    );
  });
});

describe("writing a BPF filter", () => {
  test("starts from what the boxes made, and checks it as it is written", () => {
    const onChange: MockFunction = renderInput({
      initialValue: getDefaultFilterValue("10.0.0.5"),
    });

    fireEvent.click(screen.getByTestId("packet-capture-filter-mode"));

    const expression: HTMLElement = screen.getByTestId(
      "packet-capture-filter-expression",
    );

    expect(expression).toHaveValue("host 10.0.0.5");
    expect(screen.queryByTestId("packet-capture-filter-host")).toBeNull();

    type("packet-capture-filter-expression", "host 10.0.0.5 and (udp port 53");
    expect(preview()).toHaveAttribute("role", "alert");
    expect(preview()).toHaveTextContent(
      'The filter has a "(" that is never closed.',
    );

    type("packet-capture-filter-expression", "host 10.0.0.5 and (udp port 53)");
    expect(preview()).toHaveTextContent(
      "Filter: host 10.0.0.5 and (udp port 53)",
    );
    expect(lastValue(onChange)).toMatchObject({
      mode: PacketCaptureFilterMode.Expression,
      expression: "host 10.0.0.5 and (udp port 53)",
    });
  });

  test("refuses what a shell would read, by name", () => {
    renderInput({
      initialValue: {
        ...getDefaultFilterValue(),
        mode: PacketCaptureFilterMode.Expression,
      },
    });

    type("packet-capture-filter-expression", "port 53; reboot");

    expect(preview()).toHaveTextContent('The filter can\'t contain ";"');
  });

  test("goes back to the boxes, which kept what was in them", () => {
    renderInput({ initialValue: getDefaultFilterValue("10.0.0.5") });

    fireEvent.click(screen.getByTestId("packet-capture-filter-mode"));
    fireEvent.click(screen.getByTestId("packet-capture-filter-mode"));

    expect(screen.getByTestId("packet-capture-filter-host")).toHaveValue(
      "10.0.0.5",
    );
    expect(preview()).toHaveTextContent("Filter: host 10.0.0.5");
  });

  test("the switch says where it goes", () => {
    renderInput();

    const toggle: HTMLElement = screen.getByTestId(
      "packet-capture-filter-mode",
    );

    expect(toggle).toHaveTextContent("Write a BPF filter instead");

    fireEvent.click(toggle);

    expect(screen.getByTestId("packet-capture-filter-mode")).toHaveTextContent(
      "Use host, port and protocol",
    );
  });
});

describe("the form's own error", () => {
  test("is shown when it says something the preview does not", () => {
    renderInput({ error: "Something the form found." });

    expect(screen.getByText("Something the form found.")).toBeInTheDocument();
  });
});
