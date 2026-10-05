import { describe, expect, test } from "@jest/globals";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import {
  getMonitorDestinationFieldCopy,
  MONITOR_PORT_FIELD_DESCRIPTION,
  MonitorDestinationFieldCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorDestinationFieldCopy";
import MonitorDestinationUtil, {
  ParsedMonitorDestination,
} from "../../../Utils/Monitor/MonitorDestinationUtil";

/*
 * The address field of a probe check: the first thing a new website, API,
 * ping, IP, port or certificate monitor's criteria step asks.
 *
 * Its help used to ask questions with a typo in them ("Whats the URL of the
 * website you want to monitor?"), a Port monitor's said it would ping the
 * host, and an SSL Certificate monitor's field was a bare "URL" with no help.
 * Each now says what to type, with an example - and the example is one the
 * field itself accepts.
 */

const DESTINATION_TYPES: Array<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.SSLCertificate,
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
];

function copyFor(monitorType: MonitorType): MonitorDestinationFieldCopy {
  const copy: MonitorDestinationFieldCopy | null =
    getMonitorDestinationFieldCopy(monitorType);

  if (!copy) {
    throw new Error(`${monitorType} has no destination field copy`);
  }

  return copy;
}

describe("the address field of a probe check", () => {
  test.each(DESTINATION_TYPES)("%s says what to type, with an example", (
    monitorType: MonitorType,
  ) => {
    const copy: MonitorDestinationFieldCopy = copyFor(monitorType);

    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.description).toMatch(/, like .+\.$/);
    expect(copy.placeholder.length).toBeGreaterThan(0);
  });

  test.each(DESTINATION_TYPES)(
    "%s no longer asks a question with a typo in it",
    (monitorType: MonitorType) => {
      const copy: MonitorDestinationFieldCopy = copyFor(monitorType);

      expect(copy.description).not.toMatch(/whats/i);
      expect(copy.description).not.toMatch(/\?$/);
    },
  );

  /*
   * The example in the box is one the field accepts as it stands: typing it
   * in saves a monitor, it does not raise the error under the field.
   */
  test.each(DESTINATION_TYPES)(
    "%s shows an example the field accepts",
    (monitorType: MonitorType) => {
      const parsed: ParsedMonitorDestination = MonitorDestinationUtil.parse({
        value: copyFor(monitorType).placeholder,
        monitorType: monitorType,
      });

      expect(parsed.error).toBeFalsy();
      expect(parsed.destination).toBeTruthy();
    },
  );

  test("a Port monitor's host field no longer says it pings the host", () => {
    expect(copyFor(MonitorType.Port).description).not.toMatch(/ping/i);
    expect(copyFor(MonitorType.Port).title).toBe("Hostname or IP Address");
  });

  test("an SSL Certificate monitor's field has a name and help of its own", () => {
    expect(copyFor(MonitorType.SSLCertificate)).toEqual({
      title: "Website URL",
      description: "The site whose certificate to check, like https://example.com.",
      placeholder: "https://example.com",
    });
  });

  test("the fields are named as people say them", () => {
    expect(copyFor(MonitorType.Website).title).toBe("Website URL");
    expect(copyFor(MonitorType.API).title).toBe("API URL");
    expect(copyFor(MonitorType.Ping).title).toBe("Hostname or IP Address");
    expect(copyFor(MonitorType.IP).title).toBe("IP Address");
  });

  test("a Port monitor's port field says what to type, with an example", () => {
    expect(MONITOR_PORT_FIELD_DESCRIPTION).toBe(
      "The TCP or UDP port to check, like 443.",
    );
  });

  test("every type a probe checks at an address has copy, and no other type does", () => {
    for (const monitorType of Object.values(MonitorType)) {
      const copy: MonitorDestinationFieldCopy | null =
        getMonitorDestinationFieldCopy(monitorType);

      if (DESTINATION_TYPES.includes(monitorType)) {
        expect(copy).not.toBeNull();
      } else {
        expect({ monitorType, copy }).toEqual({ monitorType, copy: null });
      }
    }

    for (const monitorType of DESTINATION_TYPES) {
      expect(MonitorTypeHelper.isProbableMonitor(monitorType)).toBe(true);
    }
  });
});
