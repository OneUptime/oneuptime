import ScanModeUtil, {
  DiscoveryScanMode,
  ScanMethodLabel,
  ScanModeUtil as NamedScanModeUtil,
} from "../../../Utils/NetworkDiscovery/ScanModeUtil";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test: what a Network Device Discovery Scan probes each
 * address with (issue #3445 — "SNMP Version is marked required even when
 * performing an ICMP-only scan").
 *
 * `isSnmpEnabled` is a new column on a model that has been shipping for a
 * while, and this module is the ONE place it is read. Four layers ask the
 * question and every one of them has to get the same answer, or the product
 * contradicts itself in a way nobody can see from any single file:
 *
 *   - the create wizard, which hides the SNMP step when the answer is "no"
 *   - the server's create hook, which nulls the SNMP credentials out
 *   - the probe, which decides whether to send an SNMP GET at all
 *   - the results dialog, which must not offer SNMP import for hosts that
 *     were never asked an SNMP question
 *
 * The single most important rule below is that an ABSENT value means "SNMP",
 * not "no SNMP". Three real callers hand this predicate a scan with no
 * `isSnmpEnabled` on it — a row written before the column existed, a `select`
 * that does not list the column, and a probe polling a server too old to send
 * it — and every one of them is describing a scan that DOES do SNMP. A
 * `Boolean(scan.isSnmpEnabled)` reading would silently turn SNMP discovery off
 * for every scan in a project, and nothing would fail; the scans would just
 * quietly stop finding managed devices. That is the regression this file
 * exists to catch, so it is pinned from several directions on purpose.
 */

/*
 * A scan row carrying an arbitrary value in the column.
 *
 * The cast through `unknown` is deliberate and is the point of several tests
 * below: the value arrives from Postgres, from request JSON, and from a form's
 * value bag, so the runtime value is genuinely not guaranteed to honour the
 * declared type, and the tests have to be able to say so.
 */
function scanWith(value: unknown): DiscoveryScanMode {
  return { isSnmpEnabled: value as boolean | null | undefined };
}

interface ScanModeCase {
  readonly label: string;
  readonly scan: DiscoveryScanMode | null | undefined;
  readonly isSnmpEnabled: boolean;
}

/*
 * Every shape a real caller can produce, with the one answer the whole product
 * has to agree on. isIcmpOnly and getMethodLabel are both driven off this same
 * table rather than restating their own expectations, so the three readings can
 * never drift apart: if the negation or the label ever stops tracking
 * isSnmpEnabled, the table makes it a failure rather than a subtlety.
 */
const SCAN_MODE_CASES: Array<ScanModeCase> = [
  {
    label: "an explicit true",
    scan: { isSnmpEnabled: true },
    isSnmpEnabled: true,
  },
  {
    label: "an explicit false",
    scan: { isSnmpEnabled: false },
    isSnmpEnabled: false,
  },
  {
    label: "an explicit undefined",
    scan: scanWith(undefined),
    isSnmpEnabled: true,
  },
  { label: "an explicit null", scan: scanWith(null), isSnmpEnabled: true },
  { label: "a row with no isSnmpEnabled key", scan: {}, isSnmpEnabled: true },
  { label: "a null scan", scan: null, isSnmpEnabled: true },
  { label: "an undefined scan", scan: undefined, isSnmpEnabled: true },
  { label: 'the string "false"', scan: scanWith("false"), isSnmpEnabled: true },
  { label: 'the string "true"', scan: scanWith("true"), isSnmpEnabled: true },
  { label: "an empty string", scan: scanWith(""), isSnmpEnabled: true },
  { label: "the number 0", scan: scanWith(0), isSnmpEnabled: true },
  { label: "the number 1", scan: scanWith(1), isSnmpEnabled: true },
  { label: "NaN", scan: scanWith(NaN), isSnmpEnabled: true },
  { label: "an empty object", scan: scanWith({}), isSnmpEnabled: true },
  { label: "an empty array", scan: scanWith([]), isSnmpEnabled: true },
];

/*
 * The shape the dashboard passes around: a `showIf` on a form step is handed
 * the predicate itself, so the predicate has to survive being detached from
 * the class. See "reads correctly when detached from the class" below.
 */
type ScanModePredicateFunction = (
  scan: DiscoveryScanMode | null | undefined,
) => boolean;

describe("ScanModeUtil.isSnmpEnabled", () => {
  it("is true for a scan that asks for SNMP", () => {
    expect(ScanModeUtil.isSnmpEnabled({ isSnmpEnabled: true })).toBe(true);
  });

  /*
   * The ONLY input that turns SNMP off. Everything else in this file is a
   * restatement of that sentence from a different angle.
   */
  it("is false for an explicit false, and for nothing else", () => {
    expect(ScanModeUtil.isSnmpEnabled({ isSnmpEnabled: false })).toBe(false);

    const disabling: Array<ScanModeCase> = SCAN_MODE_CASES.filter(
      (testCase: ScanModeCase) => {
        return !testCase.isSnmpEnabled;
      },
    );

    expect(
      disabling.map((testCase: ScanModeCase) => {
        return testCase.label;
      }),
    ).toEqual(["an explicit false"]);
  });

  describe("a scan that does not say", () => {
    /*
     * The migration is NOT NULL DEFAULT true, so a scan on disk always has a
     * value — but a scan in flight does not. Each of the four tests here names
     * the caller that produces its shape, because the shapes look identical in
     * a debugger and arrive from completely different places.
     */

    /*
     * The probe-ingest payload. `/probe/discovery-scan/list` returns exactly
     * the columns its `select` lists; a probe built against a newer server and
     * pointed at an older one gets a scan with no `isSnmpEnabled` on it at all.
     * Reading that as "SNMP is off" would disable SNMP discovery across the
     * whole fleet on a partial upgrade, and every scan would still report
     * success.
     */
    it("reads a row selected without the column as an SNMP scan", () => {
      expect(ScanModeUtil.isSnmpEnabled({})).toBe(true);
    });

    /*
     * A direct API create that simply omits the field, and a form value bag
     * before the toggle has been touched. Both mean "I did not express a
     * preference", which is the pre-#3445 behaviour: an SNMP scan.
     */
    it("reads an undefined value as an SNMP scan", () => {
      expect(ScanModeUtil.isSnmpEnabled({ isSnmpEnabled: undefined })).toBe(
        true,
      );
      expect(ScanModeUtil.isSnmpEnabled(scanWith(undefined))).toBe(true);
    });

    /*
     * A hand-written row, or a JSON payload with an explicit `null`. The
     * column cannot be null in Postgres, so this can only reach the predicate
     * from outside the write path — and the safe direction for an unexpected
     * value is "keep doing what discovery did before", not "stop probing".
     */
    it("reads a null value as an SNMP scan", () => {
      expect(ScanModeUtil.isSnmpEnabled(scanWith(null))).toBe(true);
    });

    /*
     * Callers legitimately have no scan: the Review dialog reads
     * `scanToReview` before a row is chosen, so the predicate is asked the
     * question with nothing to answer it about. It answers rather than
     * throwing, and it answers the way it answers every other absence.
     */
    it("reads a missing scan as an SNMP scan rather than throwing", () => {
      expect(ScanModeUtil.isSnmpEnabled(null)).toBe(true);
      expect(ScanModeUtil.isSnmpEnabled(undefined)).toBe(true);
    });
  });

  describe("values that are not booleans", () => {
    /*
     * The gate is a strict `!== false`, so ONLY the boolean false disables
     * SNMP. Two consequences are pinned here because they cut in opposite
     * directions and both are intentional:
     *
     *   1. Falsy non-booleans (0, "") do NOT disable SNMP. A `!scan.isSnmpEnabled`
     *      or `Boolean(...)` reading would have disabled it for both, and 0 is
     *      exactly what a driver that maps Postgres booleans to integers would
     *      hand back.
     *   2. The STRING "false" does not disable SNMP either — it is not the
     *      boolean false. Nothing in the product produces it today (the column
     *      is boolean, the toggle writes a boolean, and the API validates the
     *      type), but a future caller reading a query string or a CSV cell
     *      would, and this test is here so that whoever adds such a caller
     *      finds the coercion requirement written down rather than discovering
     *      that their "false" quietly ran an SNMP sweep.
     *
     * Fail-open is the right default for both: an unrecognised value must
     * never be the thing that silently stops SNMP discovery.
     */
    it('treats the string "false" as an SNMP scan, because the gate is strict', () => {
      expect(ScanModeUtil.isSnmpEnabled(scanWith("false"))).toBe(true);
      expect(ScanModeUtil.isSnmpEnabled(scanWith("true"))).toBe(true);
      expect(ScanModeUtil.isSnmpEnabled(scanWith("0"))).toBe(true);
    });

    it("does not let a falsy non-boolean disable SNMP", () => {
      expect(ScanModeUtil.isSnmpEnabled(scanWith(0))).toBe(true);
      expect(ScanModeUtil.isSnmpEnabled(scanWith(""))).toBe(true);
      expect(ScanModeUtil.isSnmpEnabled(scanWith(NaN))).toBe(true);
    });

    it("reads a truthy non-boolean as an SNMP scan too", () => {
      expect(ScanModeUtil.isSnmpEnabled(scanWith(1))).toBe(true);
      expect(ScanModeUtil.isSnmpEnabled(scanWith("yes"))).toBe(true);
      expect(ScanModeUtil.isSnmpEnabled(scanWith({}))).toBe(true);
      expect(ScanModeUtil.isSnmpEnabled(scanWith([]))).toBe(true);
    });
  });

  /*
   * The scan handed to this predicate is a whole row — the server hook passes
   * the create payload, the probe passes its selected columns — so it has to
   * accept an object that carries far more than the one property, and read
   * only that one.
   */
  it("reads only its own column out of a full scan row", () => {
    const icmpOnlyRow: DiscoveryScanMode & {
      cidr: string;
      snmpVersion: string;
    } = {
      cidr: "10.20.30.0/24",
      snmpVersion: "V2c",
      isSnmpEnabled: false,
    };

    /*
     * A leftover snmpVersion does not make it an SNMP scan: the wizard leaves
     * the version at its default when the toggle goes off, and the server's
     * create hook is what clears the credentials afterwards.
     */
    expect(ScanModeUtil.isSnmpEnabled(icmpOnlyRow)).toBe(false);
  });

  /*
   * `showIf` on a form step is given a function, and the field mapping in
   * Discovery.tsx hands these predicates around by reference. A rewrite from
   * `ScanModeUtil.isSnmpEnabled(...)` to `this.isSnmpEnabled(...)` inside the
   * class would still compile and still pass every call made through the class,
   * and would throw the moment a predicate was passed as a value.
   */
  it("reads correctly when detached from the class", () => {
    const isSnmpEnabled: ScanModePredicateFunction = ScanModeUtil.isSnmpEnabled;
    const isIcmpOnly: ScanModePredicateFunction = ScanModeUtil.isIcmpOnly;

    expect(isSnmpEnabled({ isSnmpEnabled: false })).toBe(false);
    expect(isSnmpEnabled({})).toBe(true);
    expect(isIcmpOnly({ isSnmpEnabled: false })).toBe(true);
    expect(isIcmpOnly({})).toBe(false);
  });

  it("is a pure read that leaves the scan alone", () => {
    const scan: DiscoveryScanMode = { isSnmpEnabled: false };

    ScanModeUtil.isSnmpEnabled(scan);
    ScanModeUtil.isIcmpOnly(scan);
    ScanModeUtil.getMethodLabel(scan);

    /*
     * toStrictEqual, not toEqual: toEqual ignores properties whose value is
     * `undefined`, so a predicate that wrote `scan.snmpVersion = undefined`
     * onto the row it was handed would pass a toEqual comparison unnoticed.
     */
    expect(scan).toStrictEqual({ isSnmpEnabled: false });
  });

  it.each(SCAN_MODE_CASES)(
    "answers $isSnmpEnabled for $label",
    (testCase: ScanModeCase) => {
      expect(ScanModeUtil.isSnmpEnabled(testCase.scan)).toBe(
        testCase.isSnmpEnabled,
      );
    },
  );
});

describe("ScanModeUtil.isIcmpOnly", () => {
  it("is true for a scan that turned SNMP off", () => {
    expect(ScanModeUtil.isIcmpOnly({ isSnmpEnabled: false })).toBe(true);
  });

  /*
   * The invariant restated as its negative, and the one that would break the
   * probe hardest: an ICMP-only sweep is the sweep that sends no SNMP at all,
   * so anything that wrongly reads as ICMP-only stops SNMP discovery dead.
   */
  it("is false for every scan that did not explicitly turn SNMP off", () => {
    expect(ScanModeUtil.isIcmpOnly({ isSnmpEnabled: true })).toBe(false);
    expect(ScanModeUtil.isIcmpOnly({ isSnmpEnabled: undefined })).toBe(false);
    expect(ScanModeUtil.isIcmpOnly(scanWith(null))).toBe(false);
    expect(ScanModeUtil.isIcmpOnly({})).toBe(false);
    expect(ScanModeUtil.isIcmpOnly(null)).toBe(false);
    expect(ScanModeUtil.isIcmpOnly(undefined)).toBe(false);
  });

  /*
   * Driven off the same table as isSnmpEnabled, and off the table's own
   * expectation rather than off a call to isSnmpEnabled: comparing the two
   * predicates to each other would restate the implementation, which is
   * literally `!ScanModeUtil.isSnmpEnabled(scan)`. The table is what makes the
   * pairing an assertion — the wizard hides the SNMP step on one reading and
   * the probe skips the SNMP GET on the other, and a scan whose form said one
   * thing while its sweep did another is the exact failure #3445 is about.
   */
  it.each(SCAN_MODE_CASES)(
    "is the exact negation of isSnmpEnabled for $label",
    (testCase: ScanModeCase) => {
      expect(ScanModeUtil.isIcmpOnly(testCase.scan)).toBe(
        !testCase.isSnmpEnabled,
      );
    },
  );
});

describe("ScanModeUtil.getMethodLabel", () => {
  it("calls an SNMP scan Ping + SNMP", () => {
    expect(ScanModeUtil.getMethodLabel({ isSnmpEnabled: true })).toBe(
      ScanMethodLabel.PingAndSnmp,
    );
  });

  it("calls a scan with SNMP turned off Ping only", () => {
    expect(ScanModeUtil.getMethodLabel({ isSnmpEnabled: false })).toBe(
      ScanMethodLabel.PingOnly,
    );
  });

  /*
   * A label is what an operator reads on a list row, so labelling a legacy
   * scan "Ping only" would tell them a sweep that did query SNMP did not.
   */
  it("labels every scan that does not say as Ping + SNMP", () => {
    expect(ScanModeUtil.getMethodLabel({})).toBe(ScanMethodLabel.PingAndSnmp);
    expect(ScanModeUtil.getMethodLabel(scanWith(undefined))).toBe(
      ScanMethodLabel.PingAndSnmp,
    );
    expect(ScanModeUtil.getMethodLabel(scanWith(null))).toBe(
      ScanMethodLabel.PingAndSnmp,
    );
    expect(ScanModeUtil.getMethodLabel(null)).toBe(ScanMethodLabel.PingAndSnmp);
    expect(ScanModeUtil.getMethodLabel(undefined)).toBe(
      ScanMethodLabel.PingAndSnmp,
    );
  });

  it.each(SCAN_MODE_CASES)(
    "agrees with isSnmpEnabled for $label",
    (testCase: ScanModeCase) => {
      expect(ScanModeUtil.getMethodLabel(testCase.scan)).toBe(
        testCase.isSnmpEnabled
          ? ScanMethodLabel.PingAndSnmp
          : ScanMethodLabel.PingOnly,
      );
    },
  );
});

/*
 * The enum members are product copy, not identifiers. `ScanMethodLabel.PingOnly`
 * is rendered as-is into the badge on the Scan column of the discovery scans
 * list (App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery.tsx), so
 * editing either string here edits what an operator reads there.
 */
describe("ScanMethodLabel", () => {
  it("spells the two methods the way the wizard does", () => {
    expect(ScanMethodLabel.PingAndSnmp).toBe("Ping + SNMP");
    expect(ScanMethodLabel.PingOnly).toBe("Ping only");
  });

  /*
   * A scan is one of exactly two things today. A third member added without a
   * corresponding branch in getMethodLabel would be unreachable, so this is
   * the reminder to wire it up rather than a rule against ever adding one.
   */
  it("has exactly the two methods getMethodLabel can return", () => {
    expect(Object.values(ScanMethodLabel)).toEqual([
      "Ping + SNMP",
      "Ping only",
    ]);
  });
});

describe("ScanModeUtil module boundaries", () => {
  /*
   * The probe imports this module (Probe/Jobs/Discovery/FetchScans.ts), and the
   * probe has no database, no TypeORM connection and no React. That is why the
   * module takes a structural `DiscoveryScanMode` instead of the
   * NetworkDeviceDiscoveryScan model: one `import` of the model would drag the
   * whole DatabaseModels graph — and typeorm's decorators with it — into the
   * probe bundle, which is the sort of thing that is only noticed when a
   * container fails to start.
   *
   * Proven by LOADING the module in a registry of its own, with a tripwire
   * mocked in front of each thing it must not pull behind it. Grepping the
   * source for the word `import` was the wrong instrument in both directions:
   * an `import type` is erased by the compiler and costs the probe nothing,
   * while a require three modules deep never appears in this file's text at
   * all.
   */
  const FORBIDDEN_DEPENDENCIES: Array<string> = [
    "typeorm",
    "react",
    "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan",
  ];

  type LoadedScanModeUtilModule = {
    default: typeof ScanModeUtil;
    ScanMethodLabel: typeof ScanMethodLabel;
  };

  it("loads with no database, no typeorm and no React behind it", () => {
    const dragged: Array<string> = [];
    const loaded: Array<LoadedScanModeUtilModule> = [];
    const loadFailures: Array<string> = [];

    jest.isolateModules(() => {
      for (const dependency of FORBIDDEN_DEPENDENCIES) {
        jest.doMock(dependency, () => {
          dragged.push(dependency);
          return {};
        });
      }

      try {
        /* eslint-disable @typescript-eslint/no-var-requires */
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const required: unknown = require("../../../Utils/NetworkDiscovery/ScanModeUtil");
        /* eslint-enable @typescript-eslint/no-var-requires */

        loaded.push(required as LoadedScanModeUtilModule);
      } catch (error) {
        loadFailures.push(String(error));
      }
    });

    for (const dependency of FORBIDDEN_DEPENDENCIES) {
      jest.dontMock(dependency);
    }

    expect(loadFailures).toEqual([]);
    expect(dragged).toEqual([]);

    /*
     * ...and what came back is the real module rather than an empty stub,
     * which would otherwise make both assertions above true by accident.
     */
    const isolated: LoadedScanModeUtilModule = loaded[0]!;

    expect(isolated.default.isSnmpEnabled({ isSnmpEnabled: false })).toBe(
      false,
    );
    expect(isolated.default.isSnmpEnabled({})).toBe(true);
    expect(isolated.ScanMethodLabel.PingOnly).toBe(ScanMethodLabel.PingOnly);
  });

  /*
   * Every production caller imports the default (Discovery.tsx, FetchScans.ts,
   * DiscoveryScan.ts, DiscoveryScanFormValidation.ts); this file and the model
   * test read the named class. A default export that stopped being the class —
   * an object literal wrapper, say — would leave those two sets of callers
   * reading different code while every test here still passed.
   */
  it("exports one class, as both its default and its named export", () => {
    expect(ScanModeUtil).toBe(NamedScanModeUtil);
  });
});
