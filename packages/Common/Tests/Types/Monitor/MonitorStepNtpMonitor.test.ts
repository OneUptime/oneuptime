import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import { describe, expect, test } from "@jest/globals";

/*
 * An NTP step needs the time server and nothing else: the port is optional
 * (123 when empty), and the timeout and retries fall back to the probe's
 * NTP defaults. What it must refuse is a destination the probe cannot send
 * a UDP request to - a URL - and a port no request can go to.
 */

function ntpStep(): MonitorStep {
  return MonitorStep.getDefaultMonitorStep({
    monitorName: "GPS clock",
    monitorType: MonitorType.NTP,
    onlineMonitorStatusId: new ObjectID("100000000000000000000021"),
    offlineMonitorStatusId: new ObjectID("100000000000000000000022"),
    defaultIncidentSeverityId: new ObjectID("100000000000000000000023"),
    defaultAlertSeverityId: new ObjectID("100000000000000000000024"),
  });
}

describe("an NTP monitor step", () => {
  test("a new step starts without a server, and says the server is required", () => {
    const step: MonitorStep = ntpStep();

    expect(step.data!.monitorDestination).toBeUndefined();
    expect(step.data!.monitorDestinationPort).toBeUndefined();
    expect(MonitorStep.getValidationError(step, MonitorType.NTP)).toBe(
      "NTP server is required",
    );
  });

  test("a new step starts with the offline and online criteria", () => {
    const names: Array<string | undefined> = (
      ntpStep().data!.monitorCriteria.data!.monitorCriteriaInstanceArray || []
    ).map((instance: MonitorCriteriaInstance) => {
      return instance.data?.name;
    });

    expect(names).toEqual([
      "Check if GPS clock is not serving good time",
      "Check if GPS clock serves good time",
    ]);
  });

  test("a host name is all it needs", () => {
    const step: MonitorStep = ntpStep().setMonitorDestination(
      new Hostname("time.example.com"),
    );

    expect(MonitorStep.getValidationError(step, MonitorType.NTP)).toBeNull();
  });

  test("an IPv4 address works", () => {
    const step: MonitorStep = ntpStep().setMonitorDestination(
      new IP("192.168.1.10"),
    );

    expect(MonitorStep.getValidationError(step, MonitorType.NTP)).toBeNull();
  });

  test("an IPv6 address works", () => {
    const step: MonitorStep = ntpStep().setMonitorDestination(
      new IP("2001:db8::123"),
    );

    expect(MonitorStep.getValidationError(step, MonitorType.NTP)).toBeNull();
  });

  test("a URL is refused, with what to type instead", () => {
    const step: MonitorStep = ntpStep().setMonitorDestination(
      URL.fromString("https://time.example.com"),
    );

    expect(MonitorStep.getValidationError(step, MonitorType.NTP)).toBe(
      "Enter the NTP server as a host name or IP address, without a scheme like udp://",
    );
  });

  test.each([1, 123, 1123, 65535])("port %i is accepted", (port: number) => {
    const step: MonitorStep = ntpStep()
      .setMonitorDestination(new Hostname("time.example.com"))
      .setPort(new Port(port));

    expect(MonitorStep.getValidationError(step, MonitorType.NTP)).toBeNull();
  });

  test("port 0 is refused", () => {
    const step: MonitorStep = ntpStep()
      .setMonitorDestination(new Hostname("time.example.com"))
      .setPort(new Port(0));

    expect(MonitorStep.getValidationError(step, MonitorType.NTP)).toBe(
      "NTP port must be a number from 1 to 65535",
    );
  });

  test("an emptied port goes back to the default instead of keeping the old one", () => {
    const step: MonitorStep = ntpStep()
      .setMonitorDestination(new Hostname("time.example.com"))
      .setPort(new Port(1123));

    step.setPort(undefined);

    expect(step.data!.monitorDestinationPort).toBeUndefined();
    expect(MonitorStep.getValidationError(step, MonitorType.NTP)).toBeNull();
  });

  test("a Port monitor still requires its port", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: "Web",
      monitorType: MonitorType.Port,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    }).setMonitorDestination(new Hostname("example.com"));

    expect(MonitorStep.getValidationError(step, MonitorType.Port)).toBe(
      "Port is required",
    );
  });

  test("the server, port, timeout and retries survive a JSON round trip", () => {
    const step: MonitorStep = ntpStep()
      .setMonitorDestination(new Hostname("time.example.com"))
      .setPort(new Port(1123))
      .setRequestTimeoutInMs(2000)
      .setRetryCount(2);

    const json: JSONObject = step.toJSON();
    const restored: MonitorStep = MonitorStep.fromJSON(json);

    expect(restored.data!.monitorDestination).toBeInstanceOf(Hostname);
    expect(restored.data!.monitorDestination!.toString()).toBe(
      "time.example.com",
    );
    expect(restored.data!.monitorDestinationPort!.toNumber()).toBe(1123);
    expect(restored.data!.requestTimeoutInMs).toBe(2000);
    expect(restored.data!.retryCount).toBe(2);
    expect(MonitorStep.getValidationError(restored, MonitorType.NTP)).toBe(
      null,
    );
  });

  test("a step without a port round-trips without one", () => {
    const restored: MonitorStep = MonitorStep.fromJSON(
      ntpStep().setMonitorDestination(new IP("192.0.2.10")).toJSON(),
    );

    expect(restored.data!.monitorDestination).toBeInstanceOf(IP);
    expect(restored.data!.monitorDestinationPort).toBeUndefined();
  });
});
