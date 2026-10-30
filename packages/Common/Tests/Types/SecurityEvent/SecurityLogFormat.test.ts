import { describe, expect, test } from "@jest/globals";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  SECURITY_LOG_FORMAT_GROUPS,
  SecurityLogFormatDefinition,
  SecurityLogFormatGroup,
  getSecurityLogFormatDefinition,
  getSecurityLogFormatsInGroup,
  readLastFoundAtByFormat,
} from "../../../Types/SecurityEvent/SecurityLogFormat";

/*
 * The kinds of security record Your logs recognizes, as every list of them
 * reads them: grouped by where they come from, the groups in one order, and
 * - for each kind - when the checks last found one, read back from what the
 * scan stored.
 */

describe("SecurityLogFormat - groups", () => {
  test("every kind belongs to a group, and the list runs group by group", () => {
    const groupOrder: Array<number> = SECURITY_LOG_FORMATS.map(
      (definition: SecurityLogFormatDefinition): number => {
        return SECURITY_LOG_FORMAT_GROUPS.indexOf(definition.group);
      },
    );

    expect(
      groupOrder.every((index: number) => {
        return index >= 0;
      }),
    ).toBe(true);
    expect(groupOrder).toEqual(
      [...groupOrder].sort((a: number, b: number) => {
        return a - b;
      }),
    );
  });

  test("each group lists its kinds in the list's order, and every kind once", () => {
    const fromGroups: Array<SecurityLogFormat> =
      SECURITY_LOG_FORMAT_GROUPS.flatMap(
        (group: SecurityLogFormatGroup): Array<SecurityLogFormat> => {
          return getSecurityLogFormatsInGroup(group).map(
            (definition: SecurityLogFormatDefinition) => {
              return definition.format;
            },
          );
        },
      );

    expect(fromGroups).toEqual(
      SECURITY_LOG_FORMATS.map((definition: SecurityLogFormatDefinition) => {
        return definition.format;
      }),
    );
    expect(
      getSecurityLogFormatsInGroup(SecurityLogFormatGroup.SecurityDevices).map(
        (definition: SecurityLogFormatDefinition) => {
          return definition.format;
        },
      ),
    ).toEqual([SecurityLogFormat.Cef, SecurityLogFormat.Leef]);
  });

  test("no group is empty", () => {
    for (const group of SECURITY_LOG_FORMAT_GROUPS) {
      expect({
        group,
        empty: getSecurityLogFormatsInGroup(group).length === 0,
      }).toEqual({ group, empty: false });
    }
  });

  test("a format is found by its value, and nothing by another", () => {
    expect(getSecurityLogFormatDefinition("leef")?.title).toBe("LEEF");
    expect(getSecurityLogFormatDefinition("windows-events")?.group).toBe(
      SecurityLogFormatGroup.Servers,
    );
    expect(getSecurityLogFormatDefinition("syslog")).toBeUndefined();
    expect(getSecurityLogFormatDefinition(undefined)).toBeUndefined();
  });
});

describe("SecurityLogFormat - when each kind was last found", () => {
  test("reads each known kind's time from the stored result", () => {
    expect(
      readLastFoundAtByFormat({
        logsRead: 10,
        lastFoundAtByFormat: {
          cef: "2026-10-30T09:00:00.000Z",
          "windows-events": "2026-10-29T18:30:00.000Z",
        },
      }),
    ).toEqual({
      cef: new Date("2026-10-30T09:00:00.000Z"),
      "windows-events": new Date("2026-10-29T18:30:00.000Z"),
    });
  });

  test("leaves out kinds it does not know and times it cannot read", () => {
    // Parsed, as a stored result is: an own "__proto__" key, not a prototype.
    const stored: unknown = JSON.parse(
      '{"lastFoundAtByFormat":{"syslog":"2026-10-30T09:00:00.000Z","cef":"yesterday","leef":1730278800000,"sudo":"","__proto__":"2026-10-30T09:00:00.000Z"}}',
    );

    expect(readLastFoundAtByFormat(stored)).toEqual({});
  });

  test("a result without the map, or no result at all, has nothing", () => {
    expect(readLastFoundAtByFormat(undefined)).toEqual({});
    expect(readLastFoundAtByFormat(null)).toEqual({});
    expect(readLastFoundAtByFormat({ logsRead: 3 })).toEqual({});
    expect(readLastFoundAtByFormat({ lastFoundAtByFormat: [] })).toEqual({});
    expect(readLastFoundAtByFormat("text")).toEqual({});
  });
});
