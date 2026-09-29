import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorService from "../../../Server/Services/MonitorService";
import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Port from "../../../Types/Port";
import { describe, expect, test } from "@jest/globals";
import net from "net";

/*
 * The destination string that goes into owner notifications — the "monitor X
 * is down, here is what it was checking" line somebody reads on their phone
 * at 3am and then acts on.
 *
 * For a Port monitor it is host + ":" + port. For IPv4 that is unambiguous.
 * For IPv6 it is not, and the failure is not that it looks odd: appending
 * ":179" to "2001:518:2800:9::2" produces "2001:518:2800:9::2:179", which
 * net.isIP() accepts as a valid IPv6 address — a DIFFERENT host from the one
 * being monitored. The alert named the wrong machine.
 *
 * Pure in-memory models; no database anywhere.
 */

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";
const BGP_PORT: number = 179;

function monitorWithDestination(data: {
  monitorType: MonitorType;
  destination: string;
  port?: number | undefined;
}): Monitor {
  const step: MonitorStep = new MonitorStep();

  step.setMonitorDestination(IP.fromString(data.destination));

  if (data.port !== undefined) {
    step.setPort(new Port(data.port));
  }

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.monitorType = data.monitorType;
  monitor.monitorSteps = steps;

  return monitor;
}

function portMonitor(destination: string, port: number): Monitor {
  return monitorWithDestination({
    monitorType: MonitorType.Port,
    destination: destination,
    port: port,
  });
}

describe("MonitorService.getMonitorDestinationInfo — IPv6 host and port", () => {
  test("brackets an IPv6 host so the port cannot be read as part of the address", () => {
    expect(
      MonitorService.getMonitorDestinationInfo(
        portMonitor(CUSTOMER_ADDRESS, BGP_PORT),
      ).monitorDestination,
    ).toBe(`[${CUSTOMER_ADDRESS}]:${BGP_PORT}`);
  });

  test("the unbracketed form it used to produce is a different, valid host", () => {
    const wrong: string = `${CUSTOMER_ADDRESS}:${BGP_PORT}`;

    // Not malformed — which is exactly why nobody noticed.
    expect(net.isIP(wrong)).toBe(6);
    expect(
      MonitorService.getMonitorDestinationInfo(
        portMonitor(CUSTOMER_ADDRESS, BGP_PORT),
      ).monitorDestination,
    ).not.toBe(wrong);
  });

  test("an IPv4 Port monitor keeps the conventional spelling", () => {
    expect(
      MonitorService.getMonitorDestinationInfo(
        portMonitor("192.0.2.1", BGP_PORT),
      ).monitorDestination,
    ).toBe(`192.0.2.1:${BGP_PORT}`);
  });

  test("an IPv6 Ping monitor with no port is reported as the bare address", () => {
    expect(
      MonitorService.getMonitorDestinationInfo(
        monitorWithDestination({
          monitorType: MonitorType.Ping,
          destination: CUSTOMER_ADDRESS,
        }),
      ).monitorDestination,
    ).toBe(CUSTOMER_ADDRESS);
  });
});
