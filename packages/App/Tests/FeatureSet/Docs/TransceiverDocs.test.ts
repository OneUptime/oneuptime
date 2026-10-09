import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CheckOn,
  CriteriaFilterUtil,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import NetworkDeviceAlertPackUtil, {
  NetworkDeviceAlertPackItem,
} from "Common/Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import {
  TRANSCEIVER_READING_KINDS,
  TRANSCEIVER_READING_METRIC_NAMES,
  TransceiverMibSource,
  TransceiverReadingKind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import {
  TRANSCEIVER_MISSING_CONFIRMATION_POLLS,
  TRANSCEIVER_RX_BASELINE_DAYS,
  TRANSCEIVER_RX_DROP_ALERT_DB,
} from "Common/Utils/NetworkDevice/TransceiverHealthUtil";

/*
 * The Network Device guide documents transceiver health as the product
 * builds it. Markdown is not compiled, so this reads the product's own
 * definitions - the CheckOns, the alert pack, the MIBs the probe reads, the
 * metric names, the rule's numbers - and checks the guide, in English and in
 * Persian, says the same.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PROBE_WALKER: string = path.resolve(
  __dirname,
  "../../../../Probe/Utils/Snmp/TransceiverWalker.ts",
);

const BUDGET_LINE: RegExp = /TRANSCEIVER_WALK_BUDGET_MS: number = (\d+);/;

function readGuide(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "monitor/network-device-monitor.md"),
    "utf8",
  );
}

const TRANSCEIVER_CHECK_ONS: Array<CheckOn> = Object.values(CheckOn).filter(
  (checkOn: CheckOn) => {
    return CriteriaFilterUtil.isTransceiverCheckOn(checkOn);
  },
);

const TRANSCEIVER_PACK_ITEMS: Array<NetworkDeviceAlertPackItem> =
  NetworkDeviceAlertPackUtil.getPackItems().filter(
    (item: NetworkDeviceAlertPackItem) => {
      return item.filters.some((filter: { checkOn: CheckOn }) => {
        return CriteriaFilterUtil.isTransceiverCheckOn(filter.checkOn);
      });
    },
  );

describe.each(["en", "fa"])(
  "the %s Network Device guide",
  (language: string) => {
    const guide: string = readGuide(language);

    test("lists every transceiver criteria in the filter table", () => {
      expect(TRANSCEIVER_CHECK_ONS).toHaveLength(5);

      for (const checkOn of TRANSCEIVER_CHECK_ONS) {
        expect(guide).toContain(`| ${checkOn}`);
      }
    });

    test("lists every transceiver item of the recommended alert pack", () => {
      expect(TRANSCEIVER_PACK_ITEMS).toHaveLength(3);

      for (const item of TRANSCEIVER_PACK_ITEMS) {
        expect(guide).toContain(`| ${item.name}`);
      }
    });

    test("names every MIB the probe reads optics from", () => {
      for (const source of Object.values(TransceiverMibSource)) {
        expect(guide).toContain(source);
      }
    });

    test("names every transceiver metric series", () => {
      for (const kind of TRANSCEIVER_READING_KINDS) {
        const metricName: MonitorMetricType =
          TRANSCEIVER_READING_METRIC_NAMES[kind as TransceiverReadingKind];
        expect(guide).toContain(`\`${metricName}\``);
      }
    });

    test("links to its own transceivers section", () => {
      const anchor: string =
        language === "en" ? "transceivers" : "فرستندهگیرندهها";

      expect(guide).toContain(`](#${anchor})`);
    });
  },
);

describe("the English guide states the rules as the product applies them", () => {
  const guide: string = readGuide("en");

  test("the section exists, with the troubleshooting entry", () => {
    expect(guide).toContain("\n### Transceivers\n");
    expect(guide).toContain("### The Transceivers card does not appear");
  });

  test("the drop the recommended alert fires at, and the baseline window", () => {
    expect(TRANSCEIVER_RX_DROP_ALERT_DB).toBe(2);
    expect(TRANSCEIVER_RX_BASELINE_DAYS).toBe(30);
    expect(guide).toContain(
      `at least ${TRANSCEIVER_RX_DROP_ALERT_DB} dB less light than on its best day of the last ${TRANSCEIVER_RX_BASELINE_DAYS}`,
    );
    expect(guide).toContain(
      `the weakest lane over the last ${TRANSCEIVER_RX_BASELINE_DAYS} days`,
    );
  });

  test("an optic counts as missing after the polls the product waits for", () => {
    expect(TRANSCEIVER_MISSING_CONFIRMATION_POLLS).toBe(2);
    expect(guide).toContain("after two polls in a row");
  });

  test("the read's own budget is the probe's", () => {
    const match: RegExpMatchArray | null = fs
      .readFileSync(PROBE_WALKER, "utf8")
      .match(BUDGET_LINE);

    expect(match).not.toBeNull();
    expect(guide).toContain(
      `its own ${Number(match![1]) / 1000}-second budget`,
    );
  });
});
