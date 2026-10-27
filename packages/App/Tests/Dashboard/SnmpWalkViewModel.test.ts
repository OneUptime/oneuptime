import { describe, expect, test } from "@jest/globals";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_ALREADY_RUNNING_MESSAGE,
  SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
  SNMP_WALK_DEFAULT_ROOT_OID,
  SNMP_WALK_NO_CREDENTIALS_MESSAGE,
  SNMP_WALK_PROBE_UPGRADE_MESSAGE,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailureKind,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
/*
 * Static import on purpose: the module is React-free and window-free, so it
 * loads in the App suite's plain Node environment. SnmpWalkWiring pins that
 * it stays so.
 */
import {
  SNMP_WALK_MAX_MONITOR_VALUE_LENGTH,
  SNMP_WALK_MAX_POLL_ATTEMPTS,
  SNMP_WALK_POLL_INTERVAL_IN_MS,
  SNMP_WALK_SERVER_MESSAGES,
  SNMP_WALK_START_POINTS,
  SNMP_WALK_UPTIME_RESTART_THRESHOLD,
  SNMP_WALK_WAIT_IN_MS,
  SnmpWalkAlertPrefill,
  SnmpWalkAlertThreshold,
  SnmpWalkHistoryEntry,
  SnmpWalkMessage,
  SnmpWalkPage,
  SnmpWalkRowLabels,
  SnmpWalkRowView,
  addWalkedOid,
  buildSnmpWalkAlertQuery,
  chainSnmpWalkPages,
  describeSnmpWalkFailure,
  describeSnmpWalkSummary,
  filterSnmpWalkRows,
  formatSnmpTimeTicks,
  getCollectedOids,
  getSelectedStartPoint,
  getSnmpWalkAlertCondition,
  getSnmpWalkAlertCriteria,
  getSnmpWalkContinueAfter,
  getSnmpWalkRowLabels,
  getSnmpWalkRows,
  getSnmpWalkTypeLabel,
  isNumericSnmpWalkRow,
  isWalkableStart,
  parseSnmpWalkAlertQuery,
  snmpWalkTimeoutMessage,
  toSnmpWalkRowView,
  toWalkRoot,
  translateSnmpWalkServerMessage,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkViewModel";

/*
 * Issue #5184: how a device's SNMP walk reads on its page - names from the
 * MIBs OneUptime knows, types as snmpwalk prints them, values a person can
 * read, what each failure means and what to fix, which OIDs are already
 * collected, a walk read in pages put back together, and the monitor
 * "Alert on it" starts. Pinned here because every one of them is a sentence
 * or a choice a type checker cannot see go wrong.
 */

const translator: Translator = createTranslator(undefined, "en");

function row(
  oid: string,
  type: SnmpDataType,
  value: string | number | null,
  extra: Partial<SnmpWalkRow> = {},
): SnmpWalkRow {
  return { oid: oid, type: type, value: value, ...extra };
}

function result(
  overrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): NetworkDeviceDiagnosticSnmpWalkResult {
  return {
    rootOid: "1.3.6.1",
    rows: [row("1.3.6.1.2.1.1.5.0", SnmpDataType.OctetString, "edge-sw-01")],
    stopReason: SnmpWalkStopReason.Complete,
    requestCount: 1,
    durationInMs: 5,
    ...overrides,
  };
}

function page(
  id: string,
  overrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): SnmpWalkPage {
  return { diagnosticId: id, result: result(overrides) };
}

describe("the polling bounds", () => {
  test("wait two minutes, reading every three seconds, like Ping and Traceroute", () => {
    expect(SNMP_WALK_POLL_INTERVAL_IN_MS).toBe(3000);
    expect(SNMP_WALK_WAIT_IN_MS).toBe(120000);
    expect(SNMP_WALK_MAX_POLL_ATTEMPTS).toBe(40);
  });
});

describe("where a walk can start", () => {
  test("offers everything, the system group, interfaces, host resources and the vendor's branch", () => {
    expect(
      SNMP_WALK_START_POINTS.map((point: { oid: string }) => {
        return point.oid;
      }),
    ).toEqual([
      SNMP_WALK_DEFAULT_ROOT_OID,
      "1.3.6.1.2.1.1",
      "1.3.6.1.2.1.2",
      "1.3.6.1.2.1.25",
      "1.3.6.1.4.1",
    ]);
  });

  test("an empty start walks everything", () => {
    expect(isWalkableStart("")).toBe(true);
    expect(toWalkRoot("")).toBe("1.3.6.1");
    expect(toWalkRoot("  ")).toBe("1.3.6.1");
  });

  test("a numeric OID is walkable, with or without a leading dot", () => {
    expect(isWalkableStart("1.3.6.1.4.1.9")).toBe(true);
    expect(isWalkableStart(".1.3.6.1.4.1.9")).toBe(true);
    expect(toWalkRoot(".1.3.6.1.4.1.9")).toBe("1.3.6.1.4.1.9");
  });

  test.each(["IF-MIB::ifTable", "ifTable", "1.3.6.1.", "1.3.x"])(
    "%s is not walkable",
    (value: string) => {
      expect(isWalkableStart(value)).toBe(false);
    },
  );

  test("the chip of the typed start is drawn as chosen, the empty start being Everything", () => {
    expect(getSelectedStartPoint("")?.label).toBe("Everything");
    expect(getSelectedStartPoint("1.3.6.1.2.1.2")?.label).toBe("Interfaces");
    expect(getSelectedStartPoint(".1.3.6.1.4.1")?.label).toBe(
      "Vendor-specific",
    );
    expect(getSelectedStartPoint("1.3.6.1.2.1.2.2")).toBeUndefined();
  });
});

describe("how a walked OID reads", () => {
  test("types read as snmpwalk prints them", () => {
    expect(
      getSnmpWalkTypeLabel(row("1.3", SnmpDataType.OctetString, "a")),
    ).toBe("STRING");
    expect(
      getSnmpWalkTypeLabel(
        row("1.3", SnmpDataType.OctetString, "00 1A", { isHex: true }),
      ),
    ).toBe("Hex-STRING");
    expect(getSnmpWalkTypeLabel(row("1.3", SnmpDataType.Integer, 1))).toBe(
      "INTEGER",
    );
    expect(
      getSnmpWalkTypeLabel(row("1.3", SnmpDataType.ObjectIdentifier, "1.3")),
    ).toBe("OID");
    expect(getSnmpWalkTypeLabel(row("1.3", SnmpDataType.TimeTicks, 1))).toBe(
      "Timeticks",
    );
    expect(getSnmpWalkTypeLabel(row("1.3", SnmpDataType.Counter64, "1"))).toBe(
      "Counter64",
    );
    expect(getSnmpWalkTypeLabel(row("1.3", SnmpDataType.Null, null))).toBe(
      "NULL",
    );
  });

  test("timeticks read as the time they add up to", () => {
    expect(formatSnmpTimeTicks(104524500, translator)).toBe(
      "12 days, 02:20:45",
    );
    expect(formatSnmpTimeTicks(8640000, translator)).toBe("1 day, 00:00:00");
    expect(formatSnmpTimeTicks(4500, translator)).toBe("00:00:45");
    expect(formatSnmpTimeTicks("360000", translator)).toBe("01:00:00");
  });

  test("timeticks that are not a count of ticks read as nothing", () => {
    expect(formatSnmpTimeTicks(null, translator)).toBeUndefined();
    expect(formatSnmpTimeTicks(-1, translator)).toBeUndefined();
    expect(formatSnmpTimeTicks("soon", translator)).toBeUndefined();
  });

  test("a standard object reads by its MIB name, with its module", () => {
    const view: SnmpWalkRowView = toSnmpWalkRowView(
      row("1.3.6.1.2.1.2.2.1.2.3", SnmpDataType.OctetString, "Vlan100"),
      translator,
    );

    expect(view.name).toBe("ifDescr.3");
    expect(view.module).toBe("IF-MIB");
    expect(view.typeLabel).toBe("STRING");
    expect(view.valueText).toBe("Vlan100");
    expect(view.isMonospace).toBe(false);

    expect(getSnmpWalkRowLabels(view, translator)).toEqual({
      title: "ifDescr.3",
      isTitleTheOid: false,
      titleModule: "IF-MIB",
      source: undefined,
    });
  });

  test("a vendor template's value reads by the template's name, the MIB name under it", () => {
    const labels: SnmpWalkRowLabels = getSnmpWalkRowLabels(
      toSnmpWalkRowView(
        row("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", SnmpDataType.Gauge32, 7),
        translator,
      ),
      translator,
    );

    expect(labels.title).toBe("CPU 5-min %");
    expect(labels.isTitleTheOid).toBe(false);
    expect(labels.source).toBe("In the Cisco IOS / IOS-XE template");
  });

  test("a standard object a template names keeps its MIB name too", () => {
    const labels: SnmpWalkRowLabels = getSnmpWalkRowLabels(
      toSnmpWalkRowView(
        row("1.3.6.1.4.1.2021.4.6.0", SnmpDataType.Integer, 17208),
        translator,
      ),
      translator,
    );

    expect(labels.mibName).toBe("memAvailReal.0 · UCD-SNMP-MIB");
  });

  test("an OID only a group covers reads by the OID itself, and its vendor", () => {
    const labels: SnmpWalkRowLabels = getSnmpWalkRowLabels(
      toSnmpWalkRowView(
        row("1.3.6.1.4.1.9.9.999.1.0", SnmpDataType.OctetString, "x"),
        translator,
      ),
      translator,
    );

    expect(labels).toEqual({
      title: "1.3.6.1.4.1.9.9.999.1.0",
      isTitleTheOid: true,
      source: "Cisco MIB",
    });
  });

  test("a cell of a template's table names the table it belongs to", () => {
    expect(
      getSnmpWalkRowLabels(
        toSnmpWalkRowView(
          row("1.3.6.1.2.1.25.3.3.1.2.196608", SnmpDataType.Integer, 12),
          translator,
        ),
        translator,
      ).source,
    ).toContain("CPU Cores table");
  });

  test("a per-port interface counter says the interface walk charts it already", () => {
    expect(
      getSnmpWalkRowLabels(
        toSnmpWalkRowView(
          row("1.3.6.1.2.1.2.2.1.10.4", SnmpDataType.Counter32, 1),
          translator,
        ),
        translator,
      ).source,
    ).toBe("The interface walk already charts this for every port.");
  });

  test("hex octets and OID values are drawn fixed-width; a NULL is no value", () => {
    expect(
      toSnmpWalkRowView(
        row("1.3.6.1.2.1.2.2.1.6.1", SnmpDataType.OctetString, "00 1A", {
          isHex: true,
        }),
        translator,
      ).isMonospace,
    ).toBe(true);
    expect(
      toSnmpWalkRowView(
        row(
          "1.3.6.1.2.1.1.2.0",
          SnmpDataType.ObjectIdentifier,
          "1.3.6.1.4.1.9",
        ),
        translator,
      ).isMonospace,
    ).toBe(true);

    const nullView: SnmpWalkRowView = toSnmpWalkRowView(
      row("1.3.6.1.2.1.1.9.0", SnmpDataType.Null, null),
      translator,
    );
    expect(nullView.isNull).toBe(true);
    expect(nullView.valueText).toBe("");
  });

  test("a timeticks row carries its duration; a cut value says so", () => {
    expect(
      toSnmpWalkRowView(
        row("1.3.6.1.2.1.1.3.0", SnmpDataType.TimeTicks, 104524500),
        translator,
      ).durationText,
    ).toBe("12 days, 02:20:45");
    expect(
      toSnmpWalkRowView(
        row("1.3.6.1.2.1.1.1.0", SnmpDataType.OctetString, "abc", {
          isCut: true,
        }),
        translator,
      ).isCut,
    ).toBe(true);
  });

  test("numbers a poll can chart are told from text it can only compare", () => {
    expect(isNumericSnmpWalkRow(row("1.3", SnmpDataType.Gauge32, 1))).toBe(
      true,
    );
    expect(isNumericSnmpWalkRow(row("1.3", SnmpDataType.Counter64, "1"))).toBe(
      true,
    );
    expect(isNumericSnmpWalkRow(row("1.3", SnmpDataType.TimeTicks, 1))).toBe(
      true,
    );
    expect(
      isNumericSnmpWalkRow(row("1.3", SnmpDataType.OctetString, "1")),
    ).toBe(false);
    expect(
      isNumericSnmpWalkRow(row("1.3", SnmpDataType.IpAddress, "10.0.0.1")),
    ).toBe(false);
  });
});

describe("the filter box", () => {
  const views: Array<SnmpWalkRowView> = [
    row("1.3.6.1.2.1.1.5.0", SnmpDataType.OctetString, "edge-sw-01"),
    row(
      "1.3.6.1.2.1.2.2.1.2.1",
      SnmpDataType.OctetString,
      "GigabitEthernet1/0/1",
    ),
    row("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", SnmpDataType.Gauge32, 7),
  ].map((entry: SnmpWalkRow): SnmpWalkRowView => {
    return toSnmpWalkRowView(entry, translator);
  });

  function oids(list: Array<SnmpWalkRowView>): Array<string> {
    return list.map((view: SnmpWalkRowView) => {
      return view.oid;
    });
  }

  test("an empty filter keeps every row", () => {
    expect(filterSnmpWalkRows(views, "  ")).toBe(views);
  });

  test("matches the OID, the MIB name, the template name, the type and the value, ignoring case", () => {
    expect(oids(filterSnmpWalkRows(views, "1.3.6.1.2.1.1.5"))).toEqual([
      "1.3.6.1.2.1.1.5.0",
    ]);
    expect(oids(filterSnmpWalkRows(views, "IFDESCR"))).toEqual([
      "1.3.6.1.2.1.2.2.1.2.1",
    ]);
    expect(oids(filterSnmpWalkRows(views, "cpu"))).toEqual([
      "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
    ]);
    expect(oids(filterSnmpWalkRows(views, "gauge32"))).toEqual([
      "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
    ]);
    expect(oids(filterSnmpWalkRows(views, "gigabit"))).toEqual([
      "1.3.6.1.2.1.2.2.1.2.1",
    ]);
  });

  test("every word must match, in any order", () => {
    expect(oids(filterSnmpWalkRows(views, "string edge"))).toEqual([
      "1.3.6.1.2.1.1.5.0",
    ]);
    expect(oids(filterSnmpWalkRows(views, "edge gigabit"))).toEqual([]);
  });

  test("a filter that reads like a pattern is plain text", () => {
    expect(filterSnmpWalkRows(views, ".*")).toEqual([]);
    expect(filterSnmpWalkRows(views, "(")).toEqual([]);
  });
});

describe("what a failure means", () => {
  function message(
    kind: SnmpWalkFailureKind,
    options: {
      reason?: SnmpWalkAuthenticationReason;
      version?: string;
      rowsRead?: number;
      text?: string;
    } = {},
  ): SnmpWalkMessage {
    return describeSnmpWalkFailure(
      {
        kind: kind,
        message: options.text || "raw",
        ...(options.reason ? { authenticationReason: options.reason } : {}),
      },
      options.version,
      options.rowsRead || 0,
      translator,
    );
  }

  test.each([
    [
      SnmpWalkAuthenticationReason.UnknownUser,
      "The device does not know this SNMPv3 user name.",
    ],
    [
      SnmpWalkAuthenticationReason.WrongDigest,
      "The authentication password or protocol does not match the device's.",
    ],
    [
      SnmpWalkAuthenticationReason.UnsupportedSecurityLevel,
      "The device does not accept this security level for this user.",
    ],
    [
      SnmpWalkAuthenticationReason.Decryption,
      "The privacy password or protocol does not match the device's.",
    ],
    [
      SnmpWalkAuthenticationReason.AccessDenied,
      "The device's access control does not let these credentials read this part of the tree.",
    ],
  ])(
    "an authentication failure for %s says what to fix, and where",
    (reason: SnmpWalkAuthenticationReason, detail: string) => {
      expect(
        message(SnmpWalkFailureKind.Authentication, { reason: reason }),
      ).toEqual({
        title: "The device refused the credentials",
        detail: detail,
        isFixedInSettings: true,
      });
    },
  );

  test("an engine clock or id the device refused says to walk again", () => {
    expect(
      message(SnmpWalkFailureKind.Authentication, {
        reason: SnmpWalkAuthenticationReason.NotInTimeWindow,
      }).detail,
    ).toContain("Walk again");
    expect(
      message(SnmpWalkFailureKind.Authentication, {
        reason: SnmpWalkAuthenticationReason.UnknownEngineId,
      }).detail,
    ).toContain("Walk again");
  });

  test("an authentication failure with no reason points at the device's settings", () => {
    expect(message(SnmpWalkFailureKind.Authentication).detail).toBe(
      "Check the SNMP user, passwords and protocols in the device's Settings.",
    );
  });

  test("silence from a v1 or v2c device names the community string first", () => {
    const silence: SnmpWalkMessage = message(SnmpWalkFailureKind.Timeout, {
      version: SnmpVersion.V2c,
    });

    expect(silence.title).toBe("The device did not answer");
    expect(silence.detail).toContain(
      "A wrong community string looks exactly like this",
    );
    expect(silence.isFixedInSettings).toBe(true);
  });

  test("silence from a v3 device does not blame a community it does not have", () => {
    const silence: SnmpWalkMessage = message(SnmpWalkFailureKind.Timeout, {
      version: SnmpVersion.V3,
    });

    expect(silence.detail).not.toContain("community");
    expect(silence.detail).toContain("UDP port 161");
  });

  test("silence after the device answered is not blamed on credentials that worked", () => {
    const quiet: SnmpWalkMessage = message(SnmpWalkFailureKind.Timeout, {
      version: SnmpVersion.V2c,
      rowsRead: 12,
    });

    expect(quiet.title).toBe("The device stopped answering");
    /*
     * How much it read is the summary's to say, right above the box: the
     * box says why it stopped and what to do.
     */
    expect(quiet.detail).toBe(
      "A busy device sometimes goes quiet part of the way. Continue walking to read the rest.",
    );
    expect(quiet.detail).not.toContain("community");
    expect(quiet.isFixedInSettings).toBe(false);
  });

  test("a probe that cannot reach the device says so in the probe's words", () => {
    expect(
      message(SnmpWalkFailureKind.Unreachable, {
        text: "getaddrinfo ENOTFOUND switch.invalid",
      }),
    ).toEqual({
      title: "The probe could not reach the device",
      detail: "getaddrinfo ENOTFOUND switch.invalid",
      isFixedInSettings: false,
    });
  });

  test("an agent error and incomplete credentials keep the agent's or probe's words", () => {
    expect(
      message(SnmpWalkFailureKind.AgentError, { text: "GeneralError" }),
    ).toEqual({
      title: "The device answered with an error",
      detail: "GeneralError",
      isFixedInSettings: false,
    });
    expect(
      message(SnmpWalkFailureKind.Configuration, { text: "no user" }),
    ).toEqual({
      title: "The device's SNMP credentials are incomplete",
      detail: "no user",
      isFixedInSettings: true,
    });
    expect(message(SnmpWalkFailureKind.Unknown).title).toBe(
      "The walk stopped with an error",
    );
  });

  test("a probe that never reported is named when known", () => {
    expect(snmpWalkTimeoutMessage("Rack 3", translator)).toBe(
      'The probe "Rack 3" did not report the walk within two minutes. Check that the probe is online and runs a version that can walk SNMP.',
    );
    expect(snmpWalkTimeoutMessage(undefined, translator)).toContain(
      "This device's probe did not report the walk",
    );
  });
});

describe("the server's own refusals", () => {
  /*
   * The server words a refused walk in English. The page knows those
   * sentences as locale keys, so a reader sees them in their language - as
   * long as the two wordings stay the same, which this holds.
   */
  test("are the sentences the server writes, word for word", () => {
    expect([...SNMP_WALK_SERVER_MESSAGES].sort()).toEqual(
      [
        SNMP_WALK_NO_CREDENTIALS_MESSAGE,
        SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
        SNMP_WALK_ALREADY_RUNNING_MESSAGE,
        SNMP_WALK_PROBE_UPGRADE_MESSAGE,
      ].sort(),
    );
  });

  test("read in the reader's language, and anything else as written", () => {
    const german: Translator = createTranslator((text: string | undefined) => {
      return text === SNMP_WALK_ALREADY_RUNNING_MESSAGE
        ? "Für dieses Gerät läuft bereits ein Walk."
        : text;
    }, "de");

    expect(
      translateSnmpWalkServerMessage(SNMP_WALK_ALREADY_RUNNING_MESSAGE, german),
    ).toBe("Für dieses Gerät läuft bereits ein Walk.");
    // Not one of the walk's sentences: never looked up, never reworded.
    expect(
      translateSnmpWalkServerMessage("Server Error. Please try again", german),
    ).toBe("Server Error. Please try again");
    // English, or a language without the key, keeps the server's words.
    expect(
      translateSnmpWalkServerMessage(
        SNMP_WALK_NO_CREDENTIALS_MESSAGE,
        translator,
      ),
    ).toBe(SNMP_WALK_NO_CREDENTIALS_MESSAGE);
  });
});

describe("a walk read in pages", () => {
  function entry(
    id: string,
    resultOverrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> | null,
    status: string = NetworkDeviceDiagnosticStatus.Completed,
  ): SnmpWalkHistoryEntry {
    return {
      diagnosticId: id,
      status: status,
      result: resultOverrides ? result(resultOverrides) : undefined,
    };
  }

  test("comes back as one walk, oldest page first, when each page continued the one before", () => {
    const pages: Array<SnmpWalkPage> = chainSnmpWalkPages([
      entry("third", {
        afterOid: "1.3.6.1.2.1.2.2.1.10.40",
        rows: [row("1.3.6.1.2.1.2.2.1.10.41", SnmpDataType.Counter32, 3)],
      }),
      entry("second", {
        afterOid: "1.3.6.1.2.1.2.2.1.10.20",
        nextOid: "1.3.6.1.2.1.2.2.1.10.40",
        stopReason: SnmpWalkStopReason.OidLimit,
        rows: [row("1.3.6.1.2.1.2.2.1.10.21", SnmpDataType.Counter32, 2)],
      }),
      entry("first", {
        nextOid: "1.3.6.1.2.1.2.2.1.10.20",
        stopReason: SnmpWalkStopReason.OidLimit,
        rows: [row("1.3.6.1.2.1.2.2.1.10.1", SnmpDataType.Counter32, 1)],
      }),
    ]);

    expect(
      pages.map((item: SnmpWalkPage) => {
        return item.diagnosticId;
      }),
    ).toEqual(["first", "second", "third"]);
    expect(
      getSnmpWalkRows(pages).map((item: SnmpWalkRow) => {
        return item.oid;
      }),
    ).toEqual([
      "1.3.6.1.2.1.2.2.1.10.1",
      "1.3.6.1.2.1.2.2.1.10.21",
      "1.3.6.1.2.1.2.2.1.10.41",
    ]);
  });

  test("a fresh walk stands alone: an older walk is not joined to it", () => {
    const pages: Array<SnmpWalkPage> = chainSnmpWalkPages([
      entry("fresh", {}),
      entry("older", {
        nextOid: "1.3.6.1.2.1.1.5.0",
        stopReason: SnmpWalkStopReason.OidLimit,
      }),
    ]);

    expect(pages).toHaveLength(1);
    expect(pages[0]!.diagnosticId).toBe("fresh");
  });

  test("a page is joined only where the one before stopped, under the same root", () => {
    const pages: Array<SnmpWalkPage> = chainSnmpWalkPages([
      entry("continued", {
        rootOid: "1.3.6.1.2.1.2",
        afterOid: "1.3.6.1.2.1.2.2.1.10.20",
      }),
      // Another subtree that happened to stop at the same OID: not joined.
      entry("other-root", {
        rootOid: "1.3.6.1",
        nextOid: "1.3.6.1.2.1.2.2.1.10.20",
        stopReason: SnmpWalkStopReason.OidLimit,
      }),
      entry("real", {
        rootOid: "1.3.6.1.2.1.2",
        nextOid: "1.3.6.1.2.1.2.2.1.10.20",
        stopReason: SnmpWalkStopReason.OidLimit,
      }),
    ]);

    expect(
      pages.map((item: SnmpWalkPage) => {
        return item.diagnosticId;
      }),
    ).toEqual(["real", "continued"]);
  });

  test("walks still running, or that the probe could not run, are not shown as results", () => {
    expect(
      chainSnmpWalkPages([
        entry("running", null, NetworkDeviceDiagnosticStatus.InProgress),
        entry("failed", null, NetworkDeviceDiagnosticStatus.Failed),
      ]),
    ).toEqual([]);
    expect(
      chainSnmpWalkPages([
        entry("running", null, NetworkDeviceDiagnosticStatus.InProgress),
        entry("done", {}),
      ])[0]!.diagnosticId,
    ).toBe("done");
  });

  test("an OID read twice across pages is listed once", () => {
    expect(
      getSnmpWalkRows([
        page("a", {
          rows: [row("1.3.6.1.2.1.1.5.0", SnmpDataType.OctetString, "a")],
        }),
        page("b", {
          rows: [row("1.3.6.1.2.1.1.5.0", SnmpDataType.OctetString, "a")],
        }),
      ]),
    ).toHaveLength(1);
  });

  test("continues after where the last page stopped short, never after a complete one", () => {
    expect(
      getSnmpWalkContinueAfter([
        page("a", {
          stopReason: SnmpWalkStopReason.OidLimit,
          nextOid: "1.3.6.1.2.1.2.2.1.10.20",
        }),
      ]),
    ).toBe("1.3.6.1.2.1.2.2.1.10.20");
    expect(
      getSnmpWalkContinueAfter([
        page("a", {
          stopReason: SnmpWalkStopReason.TimeLimit,
          nextOid: "1.3.6.1.4.1.9.2",
        }),
      ]),
    ).toBe("1.3.6.1.4.1.9.2");
    expect(
      getSnmpWalkContinueAfter([
        page("a", {
          stopReason: SnmpWalkStopReason.Failed,
          nextOid: "1.3.6.1.4.1.9.2",
        }),
      ]),
    ).toBe("1.3.6.1.4.1.9.2");
    expect(getSnmpWalkContinueAfter([page("a", {})])).toBeUndefined();
    expect(
      getSnmpWalkContinueAfter([
        page("a", { stopReason: SnmpWalkStopReason.Failed }),
      ]),
    ).toBeUndefined();
    expect(getSnmpWalkContinueAfter([])).toBeUndefined();
  });
});

describe("the summary over the results", () => {
  test("counts the OIDs under the root", () => {
    expect(
      describeSnmpWalkSummary({
        pages: [page("a", {})],
        translator: translator,
      }),
    ).toBe("1 OID under 1.3.6.1.");
  });

  test("says there is more to read when a page stopped at a limit", () => {
    expect(
      describeSnmpWalkSummary({
        pages: [
          page("a", {
            stopReason: SnmpWalkStopReason.OidLimit,
            nextOid: "1.3.6.1.2.1.1.5.0",
            rows: [
              row("1.3.6.1.2.1.1.1.0", SnmpDataType.OctetString, "a"),
              row("1.3.6.1.2.1.1.5.0", SnmpDataType.OctetString, "b"),
            ],
          }),
        ],
        translator: translator,
      }),
    ).toBe("2 OIDs read under 1.3.6.1 so far. There is more to read.");
  });

  test("a complete walk that read nothing says why that can be", () => {
    expect(
      describeSnmpWalkSummary({
        pages: [page("a", { rootOid: "1.3.6.1.2.1.25", rows: [] })],
        translator: translator,
      }),
    ).toBe(
      "Nothing under 1.3.6.1.2.1.25. The device may not implement it, or the SNMP view of its credentials may not include it.",
    );
  });

  test("a failed walk that read nothing says nothing: its failure explains it", () => {
    expect(
      describeSnmpWalkSummary({
        pages: [
          page("a", {
            rows: [],
            stopReason: SnmpWalkStopReason.Failed,
            failure: { kind: SnmpWalkFailureKind.Timeout, message: "" },
          }),
        ],
        translator: translator,
      }),
    ).toBeUndefined();
  });

  test("a failed walk that read something says so", () => {
    expect(
      describeSnmpWalkSummary({
        pages: [
          page("a", {
            stopReason: SnmpWalkStopReason.Failed,
            failure: { kind: SnmpWalkFailureKind.Timeout, message: "" },
          }),
        ],
        translator: translator,
      }),
    ).toBe("1 OID read under 1.3.6.1 before the walk stopped.");
  });
});

describe("collecting what a walk found", () => {
  test("the device collects its template's OIDs and its own", () => {
    const collected: Set<string> = getCollectedOids({
      deviceOids: [{ oid: ".1.3.6.1.2.1.1.5.0" }],
      templateOids: [{ oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime" }],
    });

    expect(Array.from(collected).sort()).toEqual([
      "1.3.6.1.2.1.1.3.0",
      "1.3.6.1.2.1.1.5.0",
    ]);
    expect(
      getCollectedOids({ deviceOids: undefined, templateOids: undefined }).size,
    ).toBe(0);
  });

  test("adds a walked OID named as the walk names it", () => {
    expect(addWalkedOid(undefined, "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1")).toEqual([
      { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", name: "CPU 5-min %" },
    ]);
    expect(addWalkedOid([], ".1.3.6.1.2.1.25.3.3.1.2.196608")).toEqual([
      { oid: "1.3.6.1.2.1.25.3.3.1.2.196608", name: "hrProcessorLoad.196608" },
    ]);
  });

  test("keeps the list as it was, its own names included, when the OID is on it already", () => {
    const list: Array<SnmpOid> = [
      { oid: "1.3.6.1.2.1.1.5.0", name: "Hostname", description: "mine" },
    ];

    expect(addWalkedOid(list, ".1.3.6.1.2.1.1.5.0")).toBe(list);
  });

  test("appends after the OIDs already there, keeping their order", () => {
    expect(
      addWalkedOid([{ oid: "1.3.6.1.2.1.1.5.0" }], "1.3.6.1.2.1.1.3.0").map(
        (entry: SnmpOid) => {
          return entry.oid;
        },
      ),
    ).toEqual(["1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.3.0"]);
  });
});

describe("Alert on it", () => {
  test.each([
    [SnmpDataType.Gauge32, FilterType.GreaterThan],
    [SnmpDataType.Counter32, FilterType.GreaterThan],
    [SnmpDataType.Counter64, FilterType.GreaterThan],
    [SnmpDataType.TimeTicks, FilterType.LessThan],
    [SnmpDataType.Integer, FilterType.NotEqualTo],
    [SnmpDataType.OctetString, FilterType.NotEqualTo],
    [SnmpDataType.IpAddress, FilterType.NotEqualTo],
    [SnmpDataType.Unknown, FilterType.NotEqualTo],
  ])("a %s starts with %s", (type: SnmpDataType, condition: FilterType) => {
    expect(getSnmpWalkAlertCondition(type)).toBe(condition);
  });

  test("carries the device, the OID, its type and the value the walk read", () => {
    const query: URLSearchParams = new URLSearchParams(
      buildSnmpWalkAlertQuery({
        networkDeviceId: "6a2f0c0e-2222-4d2e-9b2e-000000000002",
        row: row(".1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", SnmpDataType.Gauge32, 7),
      }),
    );

    expect(query.get("networkDeviceId")).toBe(
      "6a2f0c0e-2222-4d2e-9b2e-000000000002",
    );
    expect(query.get("snmpOid")).toBe("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1");
    expect(query.get("snmpOidType")).toBe(SnmpDataType.Gauge32);
    expect(query.get("snmpOidValue")).toBe("7");
  });

  test("encodes text values, and leaves out values that make no threshold", () => {
    expect(
      new URLSearchParams(
        buildSnmpWalkAlertQuery({
          networkDeviceId: "x",
          row: row(
            "1.3.6.1.2.1.1.6.0",
            SnmpDataType.OctetString,
            "Raum 3 & 4?",
          ),
        }),
      ).get("snmpOidValue"),
    ).toBe("Raum 3 & 4?");

    for (const unusable of [
      row("1.3", SnmpDataType.OctetString, "00 1A", { isHex: true }),
      row("1.3", SnmpDataType.OctetString, "a", { isCut: true }),
      row(
        "1.3",
        SnmpDataType.OctetString,
        "y".repeat(SNMP_WALK_MAX_MONITOR_VALUE_LENGTH + 1),
      ),
      row("1.3", SnmpDataType.Null, null),
    ]) {
      expect(
        new URLSearchParams(
          buildSnmpWalkAlertQuery({ networkDeviceId: "x", row: unusable }),
        ).has("snmpOidValue"),
      ).toBe(false);
    }
  });

  /*
   * Issue #5215. The criteria starts from what holds whatever the walk read,
   * and leaves a threshold the person has to choose blank. "Above the walked
   * value" on a counter fired at the very next poll - a counter only grows -
   * and stayed fired until the device restarted; on a gauge it fired at the
   * next rise; "below the walked uptime" held the alert open until the
   * uptime passed it again.
   */
  test.each([
    [
      SnmpDataType.Counter,
      CheckOn.SnmpOidRatePerSecond,
      FilterType.GreaterThan,
      SnmpWalkAlertThreshold.None,
    ],
    [
      SnmpDataType.Counter32,
      CheckOn.SnmpOidRatePerSecond,
      FilterType.GreaterThan,
      SnmpWalkAlertThreshold.None,
    ],
    [
      SnmpDataType.Counter64,
      CheckOn.SnmpOidRatePerSecond,
      FilterType.GreaterThan,
      SnmpWalkAlertThreshold.None,
    ],
    [
      SnmpDataType.Gauge,
      CheckOn.SnmpOidValue,
      FilterType.GreaterThan,
      SnmpWalkAlertThreshold.None,
    ],
    [
      SnmpDataType.Gauge32,
      CheckOn.SnmpOidValue,
      FilterType.GreaterThan,
      SnmpWalkAlertThreshold.None,
    ],
    [
      SnmpDataType.TimeTicks,
      CheckOn.SnmpOidValue,
      FilterType.LessThan,
      SnmpWalkAlertThreshold.RecentRestart,
    ],
    [
      SnmpDataType.Integer,
      CheckOn.SnmpOidValue,
      FilterType.NotEqualTo,
      SnmpWalkAlertThreshold.WalkedValue,
    ],
    [
      SnmpDataType.OctetString,
      CheckOn.SnmpOidValue,
      FilterType.NotEqualTo,
      SnmpWalkAlertThreshold.WalkedValue,
    ],
    [
      SnmpDataType.Unknown,
      CheckOn.SnmpOidValue,
      FilterType.NotEqualTo,
      SnmpWalkAlertThreshold.WalkedValue,
    ],
  ])(
    "a %s is alerted on by %s, %s, threshold %s",
    (
      type: SnmpDataType,
      checkOn: CheckOn,
      filterType: FilterType,
      threshold: SnmpWalkAlertThreshold,
    ) => {
      expect(getSnmpWalkAlertCriteria(type)).toEqual({
        checkOn: checkOn,
        filterType: filterType,
        threshold: threshold,
      });
      expect(getSnmpWalkAlertCondition(type)).toBe(filterType);
    },
  );

  test("the create page reads a gauge back: OID, name, condition, and a threshold left to the person", () => {
    const prefill: SnmpWalkAlertPrefill | null = parseSnmpWalkAlertQuery({
      snmpOid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
      snmpOidType: SnmpDataType.Gauge32,
      snmpOidValue: "7",
    });

    expect(prefill).toEqual({
      oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
      oidName: "CPU 5-min %",
      checkOn: CheckOn.SnmpOidValue,
      filterType: FilterType.GreaterThan,
      value: undefined,
      description:
        "The value the device reports for CPU 5-min % (1.3.6.1.4.1.9.9.109.1.1.1.1.8.1).",
    });
  });

  test("a counter is alerted on by how fast it grows, never by the value the walk read", () => {
    for (const type of [SnmpDataType.Counter32, SnmpDataType.Counter64]) {
      expect(
        parseSnmpWalkAlertQuery({
          snmpOid: "1.3.6.1.2.1.2.2.1.14.3",
          snmpOidType: type,
          snmpOidValue: "1200",
        }),
      ).toEqual({
        oid: "1.3.6.1.2.1.2.2.1.14.3",
        oidName: "ifInErrors.3",
        checkOn: CheckOn.SnmpOidRatePerSecond,
        filterType: FilterType.GreaterThan,
        value: undefined,
        description:
          "How fast the counter ifInErrors.3 (1.3.6.1.2.1.2.2.1.14.3) grows, per second, between polls.",
      });
    }
  });

  test("an uptime alerts when the device restarted in the last ten minutes, whatever the walk read", () => {
    expect(SNMP_WALK_UPTIME_RESTART_THRESHOLD).toBe(10 * 60 * 100);

    for (const walked of ["8640000", "12", null]) {
      expect(
        parseSnmpWalkAlertQuery({
          snmpOid: "1.3.6.1.2.1.1.3.0",
          snmpOidType: SnmpDataType.TimeTicks,
          snmpOidValue: walked,
        }),
      ).toEqual({
        oid: "1.3.6.1.2.1.1.3.0",
        oidName: "sysUpTime.0",
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.LessThan,
        value: SNMP_WALK_UPTIME_RESTART_THRESHOLD,
        description:
          "How long the device has been up, from sysUpTime.0 (1.3.6.1.2.1.1.3.0), in hundredths of a second: below 60000 (ten minutes), it restarted.",
      });
    }
  });

  test("a text value stays text, and an OID OneUptime cannot name is named by itself", () => {
    expect(
      parseSnmpWalkAlertQuery({
        snmpOid: "1.3.6.1.4.1.99999.1.0",
        snmpOidType: SnmpDataType.Integer,
        snmpOidValue: "1",
      }),
    ).toEqual({
      oid: "1.3.6.1.4.1.99999.1.0",
      oidName: "1.3.6.1.4.1.99999.1.0",
      checkOn: CheckOn.SnmpOidValue,
      filterType: FilterType.NotEqualTo,
      value: "1",
      description: "The value the device reports for 1.3.6.1.4.1.99999.1.0.",
    });
  });

  test("nothing usable in the query is no prefill, and junk is not trusted", () => {
    expect(
      parseSnmpWalkAlertQuery({
        snmpOid: null,
        snmpOidType: null,
        snmpOidValue: null,
      }),
    ).toBeNull();
    expect(
      parseSnmpWalkAlertQuery({
        snmpOid: "IF-MIB::ifDescr.1",
        snmpOidType: SnmpDataType.OctetString,
        snmpOidValue: "x",
      }),
    ).toBeNull();

    const junk: SnmpWalkAlertPrefill | null = parseSnmpWalkAlertQuery({
      snmpOid: "1.3.6.1.2.1.1.5.0",
      snmpOidType: "<script>",
      snmpOidValue: "z".repeat(SNMP_WALK_MAX_MONITOR_VALUE_LENGTH + 1),
    });

    expect(junk?.filterType).toBe(FilterType.NotEqualTo);
    expect(junk?.value).toBeUndefined();
  });
});
