import { describe, expect, it } from "@jest/globals";
import Hostname from "Common/Types/API/Hostname";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Port from "Common/Types/Port";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import {
  getMonitorStepMoreFieldsItems,
  MonitorMoreFieldsTitles,
} from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorMoreFields";

/*
 * An NTP monitor's form asks for the server and folds the rest under More
 * fields: the port (123 when empty), the request timeout and the retries.
 * The folded header lists them, and shows the ones that are set as chips, so
 * a port someone typed is visible without opening the section.
 */

function ntpStep(): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setMonitorDestination(new Hostname("time.example.com"));
  return step;
}

function itemsOf(step: MonitorStep): Array<FoldedSectionItem> {
  return getMonitorStepMoreFieldsItems({
    monitorType: MonitorType.NTP,
    monitorStep: step,
    usesClientCertificate: false,
  });
}

describe("an NTP monitor's More fields", () => {
  it("folds the port, the timeout and the retries, in that order", () => {
    expect(
      itemsOf(ntpStep()).map((item: FoldedSectionItem) => {
        return item.title;
      }),
    ).toEqual([
      MonitorMoreFieldsTitles.port,
      MonitorMoreFieldsTitles.requestTimeout,
      MonitorMoreFieldsTitles.retries,
    ]);
    expect(MonitorMoreFieldsTitles.port).toBe("Port");
  });

  it("a new step has nothing set, so the section opens on nothing in force", () => {
    expect(
      itemsOf(ntpStep()).map((item: FoldedSectionItem) => {
        return [item.key, item.isSet, item.value];
      }),
    ).toEqual([
      ["monitorDestinationPort", false, undefined],
      ["requestTimeoutInMs", false, undefined],
      ["retryCount", false, undefined],
    ]);
  });

  it("shows a typed port, timeout and retry count as chips", () => {
    const step: MonitorStep = ntpStep()
      .setPort(new Port(1123))
      .setRequestTimeoutInMs(2000)
      .setRetryCount(2);

    expect(
      itemsOf(step).map((item: FoldedSectionItem) => {
        return [item.key, item.isSet, item.value];
      }),
    ).toEqual([
      ["monitorDestinationPort", true, "1123"],
      ["requestTimeoutInMs", true, "2"],
      ["retryCount", true, "2"],
    ]);
  });

  it("an emptied port is unset again", () => {
    const step: MonitorStep = ntpStep().setPort(new Port(1123));
    step.setPort(undefined);

    expect(itemsOf(step)[0]).toMatchObject({
      key: "monitorDestinationPort",
      isSet: false,
    });
  });

  it("offers none of the HTTP options", () => {
    const keys: Array<string> = itemsOf(ntpStep()).map(
      (item: FoldedSectionItem) => {
        return item.key;
      },
    );

    expect(keys).not.toContain("requestHeaders");
    expect(keys).not.toContain("doNotFollowRedirects");
    expect(keys).not.toContain("useClientCertificate");
  });

  it("a Port monitor's port stays a required field, not a folded one", () => {
    expect(
      getMonitorStepMoreFieldsItems({
        monitorType: MonitorType.Port,
        monitorStep: ntpStep(),
        usesClientCertificate: false,
      }).map((item: FoldedSectionItem) => {
        return item.key;
      }),
    ).toEqual(["requestTimeoutInMs", "retryCount"]);
  });
});
