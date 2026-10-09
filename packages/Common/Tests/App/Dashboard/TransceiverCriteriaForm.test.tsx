import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { TransceiverReadingKind } from "../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The transceiver criteria in the monitor form, RENDERED: which reading a
 * "Transceiver Reading" criteria compares, the port scope every transceiver
 * check shares with the interface checks, and the reading a new criteria
 * starts on - a reading criteria saved without one would never evaluate.
 *
 * Assertions stay on plain DOM text: jest-dom's matchers do not typecheck
 * repo-wide.
 */

function renderFilter(criteriaFilter: CriteriaFilter): {
  onChange: MockFunction;
} {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <CriteriaFilterElement
      monitorType={MonitorType.NetworkDevice}
      monitorStep={new MonitorStep()}
      value={criteriaFilter}
      onChange={onChange as unknown as (value: CriteriaFilter) => void}
    />,
  );

  return { onChange: onChange };
}

function lastFilterFrom(onChange: MockFunction): CriteriaFilter {
  expect(onChange.mock.calls.length).toBeGreaterThan(0);

  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as CriteriaFilter;
}

describe("the transceiver criteria in the monitor form", () => {
  test("a reading criteria shows which reading it compares, with its unit", () => {
    renderFilter({
      checkOn: CheckOn.SnmpTransceiverReading,
      filterType: FilterType.LessThan,
      value: "-14",
      snmpMonitorOptions: {
        transceiverReading: TransceiverReadingKind.RxPower,
        interfaceName: "*",
      },
    });

    expect(screen.getByTestId("transceiver-reading-picker")).not.toBeNull();
    expect(screen.getAllByText("Transceiver Reading").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("RX Power (dBm)").length).toBeGreaterThan(0);
  });

  test("picking another reading keeps the port scope", async () => {
    const { onChange } = renderFilter({
      checkOn: CheckOn.SnmpTransceiverReading,
      filterType: FilterType.GreaterThan,
      value: "70",
      snmpMonitorOptions: {
        transceiverReading: TransceiverReadingKind.RxPower,
        interfaceName: "Te1/1/1",
      },
    });
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    const picker: HTMLElement = screen.getByTestId("transceiver-reading-picker");
    await user.click(picker.querySelector("input")!);
    await user.click(await screen.findByText("Temperature (°C)"));

    expect(lastFilterFrom(onChange).snmpMonitorOptions).toEqual({
      transceiverReading: TransceiverReadingKind.Temperature,
      interfaceName: "Te1/1/1",
    });
  });

  test("a new reading criteria starts on received power", async () => {
    const { onChange } = renderFilter({
      checkOn: CheckOn.SnmpInterfaceIsDown,
      filterType: FilterType.True,
      value: undefined,
    });
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(screen.getAllByRole("combobox")[0]!);
    await user.click(await screen.findByText(CheckOn.SnmpTransceiverReading));

    expect(lastFilterFrom(onChange)).toMatchObject({
      checkOn: CheckOn.SnmpTransceiverReading,
      snmpMonitorOptions: {
        transceiverReading: TransceiverReadingKind.RxPower,
      },
    });
  });

  test("other checks start without a reading", async () => {
    const { onChange } = renderFilter({
      checkOn: CheckOn.SnmpInterfaceIsDown,
      filterType: FilterType.True,
      value: undefined,
    });
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(screen.getAllByRole("combobox")[0]!);
    await user.click(
      await screen.findByText(CheckOn.SnmpTransceiverNotDetected),
    );

    expect(lastFilterFrom(onChange).snmpMonitorOptions).toBeUndefined();
  });

  test("every transceiver check is scoped by port, like the interface checks", () => {
    for (const checkOn of [
      CheckOn.SnmpTransceiverNotDetected,
      CheckOn.SnmpTransceiverPastAlarmThreshold,
      CheckOn.SnmpTransceiverRxPowerDrop,
    ]) {
      const { unmount } = render(
        <CriteriaFilterElement
          monitorType={MonitorType.NetworkDevice}
          monitorStep={new MonitorStep()}
          value={{
            checkOn: checkOn,
            filterType: FilterType.True,
            value: undefined,
          }}
          onChange={() => {
            return undefined;
          }}
        />,
      );

      expect(screen.getAllByText("Interface (Optional)").length).toBe(1);
      // Only the reading criteria asks which reading.
      expect(screen.queryByTestId("transceiver-reading-picker")).toBeNull();
      unmount();
    }
  });
});
