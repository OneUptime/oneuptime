import SnmpOid from "../../../../Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil, {
  MAX_DEVICE_SPECIFIC_OIDS,
  MAX_EFFECTIVE_OIDS_PER_DEVICE,
  MAX_OID_METRIC_SERIES,
  MAX_OID_NAME_LENGTH,
  MAX_OIDS_PER_TEMPLATE,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import { describe, expect, it } from "@jest/globals";

function oid(value: string, name?: string): SnmpOid {
  return name === undefined
    ? { oid: value }
    : { oid: value, name: name, description: `desc-${name}` };
}

function oidStrings(list: Array<SnmpOid>): Array<string> {
  return list.map((entry: SnmpOid) => {
    return entry.oid;
  });
}

describe("SnmpOidListUtil.normalizeOid", () => {
  it("strips exactly one leading dot", () => {
    expect(SnmpOidListUtil.normalizeOid(".1.3.6.1.2.1.1.3.0")).toBe(
      "1.3.6.1.2.1.1.3.0",
    );
  });

  it("leaves an already-canonical OID untouched", () => {
    expect(SnmpOidListUtil.normalizeOid("1.3.6.1.2.1.1.3.0")).toBe(
      "1.3.6.1.2.1.1.3.0",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(SnmpOidListUtil.normalizeOid("  1.3.6.1  ")).toBe("1.3.6.1");
  });

  it("returns an empty string for undefined and for blank input", () => {
    expect(SnmpOidListUtil.normalizeOid(undefined)).toBe("");
    expect(SnmpOidListUtil.normalizeOid("   ")).toBe("");
  });

  /*
   * A second dot is not stripped: "..1.3" is malformed, and quietly turning
   * it into a valid OID would hide a typo rather than surface it.
   */
  it("strips only the first leading dot", () => {
    expect(SnmpOidListUtil.normalizeOid("..1.3.6.1")).toBe(".1.3.6.1");
    expect(SnmpOidListUtil.isValidOid("..1.3.6.1")).toBe(false);
  });
});

describe("SnmpOidListUtil.isValidOid", () => {
  it("accepts dotted numeric OIDs with and without a leading dot", () => {
    expect(SnmpOidListUtil.isValidOid("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1")).toBe(
      true,
    );
    expect(SnmpOidListUtil.isValidOid(".1.3.6.1")).toBe(true);
  });

  it("rejects symbolic names, empty strings and trailing dots", () => {
    expect(SnmpOidListUtil.isValidOid("sysUpTime.0")).toBe(false);
    expect(SnmpOidListUtil.isValidOid("")).toBe(false);
    expect(SnmpOidListUtil.isValidOid("1.3.6.")).toBe(false);
    expect(SnmpOidListUtil.isValidOid("1")).toBe(false);
  });
});

describe("SnmpOidListUtil.validateOidList", () => {
  const options: { max: number; label: string } = {
    max: MAX_OIDS_PER_TEMPLATE,
    label: "OID Collection Template",
  };

  it("returns the list with every OID normalized", () => {
    const result: Array<SnmpOid> = SnmpOidListUtil.validateOidList(
      [oid(".1.3.6.1.2.1.1.3.0", "uptime"), oid("1.3.6.1.4.1.9.1", "cisco")],
      options,
    );

    expect(oidStrings(result)).toEqual([
      "1.3.6.1.2.1.1.3.0",
      "1.3.6.1.4.1.9.1",
    ]);
    expect(result[0]!.name).toBe("uptime");
    expect(result[0]!.description).toBe("desc-uptime");
  });

  it("accepts an undefined or empty list", () => {
    expect(SnmpOidListUtil.validateOidList(undefined, options)).toEqual([]);
    expect(SnmpOidListUtil.validateOidList([], options)).toEqual([]);
  });

  /*
   * Blank rows and duplicates are DROPPED, not refused, and that asymmetry is
   * load-bearing. SnmpOidEditor's "Add OID" button persists
   * {oid: "", name: "", description: ""} for a click somebody thought better
   * of, and duplicates exist in data written before any validation did. If
   * either threw, a device carrying one legacy artifact could never be linked
   * to a template until somebody hunted the row down.
   */
  it("drops a blank row instead of refusing the save", () => {
    const result: Array<SnmpOid> = SnmpOidListUtil.validateOidList(
      [
        oid("1.3.6.1.2.1.1.3.0", "uptime"),
        { oid: "", name: "", description: "" },
      ],
      options,
    );

    expect(oidStrings(result)).toEqual(["1.3.6.1.2.1.1.3.0"]);
  });

  it("drops a duplicate, keeping the first spelling", () => {
    const result: Array<SnmpOid> = SnmpOidListUtil.validateOidList(
      [oid("1.3.6.1.2.1.1.3.0", "first"), oid(".1.3.6.1.2.1.1.3.0", "second")],
      options,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("first");
  });

  it("rejects a malformed OID and quotes the offending string", () => {
    expect(() => {
      return SnmpOidListUtil.validateOidList([oid("sysUpTime.0")], options);
    }).toThrow(/"sysUpTime.0" is not a numeric OID/);
  });

  it("rejects a list over the cap and names the count and the limit", () => {
    const tooMany: Array<SnmpOid> = Array.from(
      { length: MAX_OIDS_PER_TEMPLATE + 1 },
      (_unused: unknown, index: number) => {
        return oid(`1.3.6.1.4.1.${index}`);
      },
    );

    expect(() => {
      return SnmpOidListUtil.validateOidList(tooMany, options);
    }).toThrow(
      new RegExp(
        `${MAX_OIDS_PER_TEMPLATE + 1} OIDs is more than the limit of ${MAX_OIDS_PER_TEMPLATE}`,
      ),
    );
  });

  it("counts the cap AFTER sanitizing, so blanks cannot push a list over it", () => {
    const atCapPlusBlanks: Array<SnmpOid> = [
      ...Array.from(
        { length: MAX_OIDS_PER_TEMPLATE },
        (_unused: unknown, index: number) => {
          return oid(`1.3.6.1.4.1.${index}`);
        },
      ),
      { oid: "", name: "", description: "" },
      { oid: "   " },
    ];

    expect(
      SnmpOidListUtil.validateOidList(atCapPlusBlanks, options),
    ).toHaveLength(MAX_OIDS_PER_TEMPLATE);
  });

  it("truncates an over-long name rather than shipping it to every device", () => {
    const result: Array<SnmpOid> = SnmpOidListUtil.validateOidList(
      [oid("1.3.6.1.4.1.9.1", "x".repeat(MAX_OID_NAME_LENGTH + 50))],
      options,
    );

    expect(result[0]!.name).toHaveLength(MAX_OID_NAME_LENGTH);
  });

  it("accepts a list exactly at the cap", () => {
    const exactly: Array<SnmpOid> = Array.from(
      { length: MAX_OIDS_PER_TEMPLATE },
      (_unused: unknown, index: number) => {
        return oid(`1.3.6.1.4.1.${index}`);
      },
    );

    expect(SnmpOidListUtil.validateOidList(exactly, options)).toHaveLength(
      MAX_OIDS_PER_TEMPLATE,
    );
  });
});

describe("SnmpOidListUtil.mergeOidLists", () => {
  it("returns the device list when there is no template", () => {
    const merged: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(undefined, [
      oid("1.3.6.1.4.1.1"),
      oid("1.3.6.1.4.1.2"),
    ]);

    expect(oidStrings(merged)).toEqual(["1.3.6.1.4.1.1", "1.3.6.1.4.1.2"]);
  });

  it("returns the template list when the device has none", () => {
    const merged: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(
      [oid("1.3.6.1.4.1.1")],
      undefined,
    );

    expect(oidStrings(merged)).toEqual(["1.3.6.1.4.1.1"]);
  });

  it("returns an empty list when neither side has anything", () => {
    expect(SnmpOidListUtil.mergeOidLists(undefined, undefined)).toEqual([]);
  });

  /*
   * Template-first ordering is not cosmetic. resolveEffectiveOids truncates
   * from the END, so the shared items a whole device type depends on have to
   * be the stable prefix — otherwise one device-local addition could push a
   * template OID off the end.
   */
  it("puts template entries first, in template order, then device additions", () => {
    const merged: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(
      [oid("1.3.6.1.4.1.9.1", "cpu"), oid("1.3.6.1.4.1.9.2", "memory")],
      [oid("1.3.6.1.4.1.99.1", "local-sensor")],
    );

    expect(oidStrings(merged)).toEqual([
      "1.3.6.1.4.1.9.1",
      "1.3.6.1.4.1.9.2",
      "1.3.6.1.4.1.99.1",
    ]);
  });

  it("collapses a duplicate to one entry, keeping the device's name at the template's position", () => {
    const merged: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(
      [
        oid("1.3.6.1.4.1.9.1", "template-cpu"),
        oid("1.3.6.1.4.1.9.2", "template-memory"),
      ],
      [oid("1.3.6.1.4.1.9.1", "device-cpu")],
    );

    expect(merged).toHaveLength(2);
    // The template's POSITION survives...
    expect(merged[0]!.oid).toBe("1.3.6.1.4.1.9.1");
    // ...and the DEVICE's content wins.
    expect(merged[0]!.name).toBe("device-cpu");
    expect(merged[0]!.description).toBe("desc-device-cpu");
    expect(merged[1]!.name).toBe("template-memory");
  });

  it("dedupes across normalization, so a leading dot is not a second entry", () => {
    const merged: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(
      [oid(".1.3.6.1", "template")],
      [oid("1.3.6.1", "device")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]!.oid).toBe("1.3.6.1");
    expect(merged[0]!.name).toBe("device");
  });

  it("normalizes every surviving entry so criteria can compare with equality", () => {
    const merged: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(
      [oid(".1.3.6.1.4.1.9.1")],
      [oid("  1.3.6.1.4.1.9.2  ")],
    );

    expect(oidStrings(merged)).toEqual(["1.3.6.1.4.1.9.1", "1.3.6.1.4.1.9.2"]);
  });

  /*
   * Persisted data can predate validation, and one bad row must not stop a
   * device polling the other ninety-nine. Rejection belongs to the write
   * path; the poll path drops.
   */
  it("drops blank and malformed rows instead of throwing", () => {
    const merged: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(
      [oid(""), oid("1.3.6.1.4.1.9.1", "good")],
      [oid("not.an.oid"), oid("1.3.6.1.4.1.9.2", "also-good")],
    );

    expect(oidStrings(merged)).toEqual(["1.3.6.1.4.1.9.1", "1.3.6.1.4.1.9.2"]);
  });

  it("does not mutate either input list", () => {
    const templateOids: Array<SnmpOid> = [oid(".1.3.6.1.4.1.9.1", "cpu")];
    const deviceOids: Array<SnmpOid> = [oid("1.3.6.1.4.1.99.1", "local")];

    SnmpOidListUtil.mergeOidLists(templateOids, deviceOids);

    expect(templateOids[0]!.oid).toBe(".1.3.6.1.4.1.9.1");
    expect(deviceOids).toHaveLength(1);
  });
});

describe("SnmpOidListUtil.resolveEffectiveOids", () => {
  it("reports no truncation for a list within the cap", () => {
    const resolution: {
      oids: Array<SnmpOid>;
      truncatedCount: number;
    } = SnmpOidListUtil.resolveEffectiveOids({
      templateOids: [oid("1.3.6.1.4.1.9.1")],
      deviceOids: [oid("1.3.6.1.4.1.99.1")],
    });

    expect(resolution.truncatedCount).toBe(0);
    expect(resolution.oids).toHaveLength(2);
  });

  it("truncates to the cap and keeps every template entry", () => {
    const templateOids: Array<SnmpOid> = Array.from(
      { length: MAX_EFFECTIVE_OIDS_PER_DEVICE },
      (_unused: unknown, index: number) => {
        return oid(`1.3.6.1.4.1.9.${index}`, `template-${index}`);
      },
    );
    const deviceOids: Array<SnmpOid> = [
      oid("1.3.6.1.4.1.99.1", "device-extra"),
    ];

    const resolution: {
      oids: Array<SnmpOid>;
      truncatedCount: number;
    } = SnmpOidListUtil.resolveEffectiveOids({
      templateOids: templateOids,
      deviceOids: deviceOids,
    });

    expect(resolution.oids).toHaveLength(MAX_EFFECTIVE_OIDS_PER_DEVICE);
    expect(resolution.truncatedCount).toBe(1);
    // The device addition is what got dropped, not a template OID.
    expect(oidStrings(resolution.oids)).not.toContain("1.3.6.1.4.1.99.1");
    expect(resolution.oids[0]!.name).toBe("template-0");
  });

  it("returns an empty list when nothing is configured on either side", () => {
    expect(
      SnmpOidListUtil.resolveEffectiveOids({
        templateOids: undefined,
        deviceOids: undefined,
      }),
    ).toEqual({ oids: [], truncatedCount: 0 });
  });
});

describe("SnmpOidListUtil.getAlreadyCollectedBy", () => {
  /*
   * The advisory that exists because of issue #3507: the reporter was about
   * to hand-type a hundred per-port OIDs the interface walk already collects.
   */
  it("flags ifInOctets and ifOutOctets", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.2.1.10.3"),
    ).toContain("inbound bits/second");
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.2.1.16.3"),
    ).toContain("outbound bits/second");
  });

  it("flags ifOperStatus", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy(".1.3.6.1.2.1.2.2.1.8.1"),
    ).toContain("up/down");
  });

  it("flags the 64-bit ifXTable octet counters", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.31.1.1.1.6.3"),
    ).toContain("inbound bits/second");
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.31.1.1.1.10.3"),
    ).toContain("outbound bits/second");
  });

  /*
   * The half of ifTable the advisory must stay quiet about. These columns
   * ARE parsed by the walk but never become a series a user can chart or
   * alert on — in/out errors collapse into one combined rate, discards are
   * thrown away, and speed and admin status stop at an inventory column. For
   * these, hand-typing the OID is the only thing that works today, so
   * claiming "already collected" would be a lie that costs the operator
   * their data.
   */
  it("stays quiet about ifInErrors and ifOutErrors, which exist only as a combined rate", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.2.1.14.3"),
    ).toBeUndefined();
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.2.1.20.3"),
    ).toBeUndefined();
  });

  it("stays quiet about discards, which are parsed and dropped", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.2.1.13.3"),
    ).toBeUndefined();
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.2.1.19.3"),
    ).toBeUndefined();
  });

  it("stays quiet about ifSpeed and ifAdminStatus, which stop at an inventory column", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.2.1.5.3"),
    ).toBeUndefined();
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.2.1.7.3"),
    ).toBeUndefined();
  });

  /*
   * The system group is offered by the editor's own built-in quick-add list,
   * so warning about it would have the product contradict itself.
   */
  it("stays quiet about the system group, which the editor itself offers", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.1.3.0"),
    ).toBeUndefined();
  });

  it("does not flag ifNumber, which is a scalar outside the walked tables", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.2.1.2.1.0"),
    ).toBeUndefined();
  });

  it("does not flag a vendor CPU OID, which is exactly what templates are for", () => {
    expect(
      SnmpOidListUtil.getAlreadyCollectedBy("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1"),
    ).toBeUndefined();
  });
});

describe("SnmpOidListUtil caps", () => {
  /*
   * This equality is the promise the design makes: everything you are
   * allowed to configure is everything that gets charted. Before it, the
   * device had no configuration cap at all and the metric writer silently
   * kept the first 50.
   */
  it("charts every OID a device is allowed to collect", () => {
    expect(MAX_OID_METRIC_SERIES).toBe(MAX_EFFECTIVE_OIDS_PER_DEVICE);
  });

  /*
   * The property that makes the poll-time truncation unreachable. Without it
   * a full template plus a full device-local list merges past the effective
   * cap, and the entries sliced off are always the operator's own - lost
   * because somebody else grew the shared template.
   */
  it("composes: a full template plus a full device list still fits", () => {
    expect(MAX_OIDS_PER_TEMPLATE + MAX_DEVICE_SPECIFIC_OIDS).toBe(
      MAX_EFFECTIVE_OIDS_PER_DEVICE,
    );
  });
});
