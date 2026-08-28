import SnmpScanConfigUtil, {
  DiscoveryScanSnmpConfig,
  SnmpScanConfigSource,
  LEGACY_SNMP_CONFIG_ID,
  MAX_SNMP_CONFIGS_PER_SCAN,
  MAX_SNMP_CONFIG_NAME_LENGTH,
  MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH,
  MAX_SNMP_CONFIG_KEY_LENGTH,
  MINIMUM_SNMP_PORT,
  MAXIMUM_SNMP_PORT,
} from "../../../Utils/NetworkDiscovery/SnmpScanConfigUtil";
import ScanTargetUtil from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
import ColumnLength from "../../../Types/Database/ColumnLength";
import SnmpAuthProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test: the ordered list of SNMP credential sets a discovery
 * scan tries (OneUptime issue #3458).
 *
 * Four layers read this module and every one of them has to get the SAME
 * answer, in a different process, at a different time:
 *
 *   - the Dashboard form, which collects the list and shows its errors,
 *   - the server's create/update hooks, which validate, normalize and mirror,
 *   - the probe, which sweeps a subnet with the list and stamps onto every
 *     discovered host WHICH entry answered it,
 *   - the import path, which has to rebuild that host's device with THAT
 *     entry's credentials — days later, from a row it re-resolves itself.
 *
 * So the properties pinned below are mostly about determinism and about the
 * two directions credentials can leak:
 *
 *   1. resolve() is never empty and never lossy. A scan written before this
 *      column existed is described by its nine flattened columns, and those
 *      columns ARE its one credential set — resolving them has to produce the
 *      identical config on every read, in every process, forever, because a
 *      stored `snmpConfigId` of "legacy" is looked up against it.
 *   2. resolve() and readStoredList() answer two DIFFERENT questions. Readers
 *      want "what does this scan try?" (never empty); writers want "does this
 *      row have its own list, or is it described by its flattened columns?"
 *      (honestly null). Conflating them is how a row acquires a list nobody
 *      asked for.
 *   3. ids are identity, never position. Duplicate ids are refused and
 *      normalizeForStorage mints real ones, because a host found by config #4
 *      importing with config #1's community string is the exact bug the id
 *      scheme exists to prevent.
 *   4. getConfigLabel() is the ONLY thing about a config that is allowed out
 *      into a log line or the scan's statusMessage, so it must never carry a
 *      community string or a v3 key. That is a security property, and it is
 *      asserted as one below.
 */

/*
 * A UUID as ObjectID.generate() spells it. normalizeForStorage mints these for
 * entries that arrive without an id, and the test below checks the shape
 * rather than the value because the whole point is that it is unpredictable.
 */
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The positional id normalizeConfig falls back to when READING a row.
const POSITIONAL_ID_PATTERN: RegExp = /^config-\d+$/;

/*
 * A scan configured the old way: no `snmpConfigs`, nine flattened columns.
 * Every scan that existed before this feature looks like this, and so does
 * every scan written by an API caller that only knows the old fields.
 */
const LEGACY_SCAN: SnmpScanConfigSource = {
  snmpVersion: "V2c",
  snmpCommunityString: "legacy-community",
  snmpPort: 1161,
  snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
  snmpV3Username: "legacy-user",
  snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
  snmpV3AuthKey: "legacy-auth-key",
  snmpV3PrivProtocol: SnmpPrivProtocol.AES,
  snmpV3PrivKey: "legacy-priv-key",
};

/*
 * The nine flattened columns getMirroredLegacyColumns has to write on every
 * save, present or not. Listed here as data so the "always all nine" test is
 * about the count as much as the names.
 */
const MIRRORED_COLUMN_KEYS: Array<string> = [
  "snmpVersion",
  "snmpCommunityString",
  "snmpPort",
  "snmpV3SecurityLevel",
  "snmpV3Username",
  "snmpV3AuthProtocol",
  "snmpV3AuthKey",
  "snmpV3PrivProtocol",
  "snmpV3PrivKey",
];

/*
 * The credential fields bounded to ColumnLength.ShortText, paired with the
 * words the validation message uses for each, and listed here as data so the
 * length rule is asserted for EVERY one of them rather than for whichever one
 * a hand-written test happened to pick.
 *
 * These are exactly the fields getMirroredLegacyColumns copies onto a
 * varchar(100) column, plus `id`, which is mirrored nowhere but is stored
 * beside them and read back by findById. `name` is deliberately absent: it has
 * its own constant and its own block above.
 */
const SHORT_TEXT_CREDENTIAL_FIELDS: Array<
  [keyof DiscoveryScanSnmpConfig, string]
> = [
  ["id", "id"],
  ["snmpCommunityString", "community string"],
  ["snmpV3Username", "v3 username"],
  ["snmpV3SecurityLevel", "v3 security level"],
  ["snmpV3AuthProtocol", "v3 authentication protocol"],
  ["snmpV3PrivProtocol", "v3 privacy protocol"],
];

/*
 * The two fields mirrored onto a varchar(500) instead. Keys are localized
 * passphrases, not digests, so they are genuinely longer than a community
 * string and must not be squeezed into the ShortText bound.
 */
const KEY_CREDENTIAL_FIELDS: Array<[keyof DiscoveryScanSnmpConfig, string]> = [
  ["snmpV3AuthKey", "v3 authentication key"],
  ["snmpV3PrivKey", "v3 privacy key"],
];

/*
 * A config carrying one field, chosen at runtime from the tables above.
 * Written through a Record cast for the same reason the utility itself does
 * it: a `keyof` index into a struct with mixed value types is not assignable
 * in a literal.
 */
function configWithField(
  key: keyof DiscoveryScanSnmpConfig,
  value: string,
): DiscoveryScanSnmpConfig {
  const config: DiscoveryScanSnmpConfig = {};

  (config as Record<string, unknown>)[key as string] = value;

  return config;
}

/*
 * Builds a scan row whose `snmpConfigs` column holds an arbitrary value. The
 * column is jsonb, so an out-of-band writer really can put a string, a number
 * or an array of nonsense in it — the cast is the point of the helper, not a
 * convenience.
 */
function scanWithConfigs(configs: unknown): SnmpScanConfigSource {
  return {
    snmpConfigs: configs as Array<DiscoveryScanSnmpConfig> | null | undefined,
  };
}

/*
 * Validates a list whose SECOND entry is the interesting one, so every
 * assertion below can check that the message names the offending card by
 * position. With five credential sets on screen, "SNMP v3 Username is
 * required" on its own is not an actionable sentence.
 */
function errorForSecondConfig(config: unknown): string | null {
  return SnmpScanConfigUtil.getValidationError([
    { id: "first-config" },
    config,
  ]);
}

// A v3 config that passes every rule, used as the base for the negative cases.
function validAuthPrivConfig(
  overrides: Partial<DiscoveryScanSnmpConfig> = {},
): DiscoveryScanSnmpConfig {
  return {
    id: "v3-config",
    name: "Core switches",
    snmpVersion: "V3",
    snmpV3Username: "monitor",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
    snmpV3AuthProtocol: SnmpAuthProtocol.SHA256,
    snmpV3AuthKey: "auth-key-value",
    snmpV3PrivProtocol: SnmpPrivProtocol.AES256,
    snmpV3PrivKey: "priv-key-value",
    ...overrides,
  };
}

describe("SnmpScanConfigUtil constants", () => {
  /*
   * The legacy id is a LITERAL, not a minted ObjectID, and it has to stay
   * one: the probe stamps it onto each discovered host and the import path
   * looks it up again in a list resolved separately, in another process,
   * possibly days later. Changing this string orphans every stored result.
   */
  it("uses a stable literal id for the config synthesized from the flattened columns", () => {
    expect(LEGACY_SNMP_CONFIG_ID).toBe("legacy");
  });

  /*
   * The ceiling is a time budget: a host that answers nothing costs one full
   * SNMP timeout PER config, and the probe abandons a sweep at 90 minutes.
   */
  it("caps a scan at ten SNMP configs, which keeps the worst-case sweep inside the probe deadline", () => {
    expect(MAX_SNMP_CONFIGS_PER_SCAN).toBe(10);
  });

  /*
   * The name lives inside a jsonb column with no width of its own, so nothing
   * downstream would ever reject an essay. It is bounded here to the same
   * ShortText width the scan's own name uses, because it is rendered on one
   * line in a card header and inlined into probe log lines.
   */
  it("bounds a config name at the ShortText width the rest of the product uses", () => {
    expect(MAX_SNMP_CONFIG_NAME_LENGTH).toBe(ColumnLength.ShortText);
    expect(MAX_SNMP_CONFIG_NAME_LENGTH).toBe(100);
  });

  /*
   * These two constants are not style choices, they are the widths of two
   * database columns, and they exist only to protect those columns.
   *
   * `snmpConfigs` is jsonb and has no width at all, so on its own it would
   * store a novel in a community string quite happily. But
   * getMirroredLegacyColumns copies the FIRST config onto the flattened
   * snmpCommunityString / snmpV3* columns that every probe older than this
   * feature still reads, and those are varchar(100) and varchar(500).
   * Postgres does not truncate an over-long value on the way in — it throws.
   *
   * So if either constant ever drifts away from the column it mirrors into,
   * validation starts accepting values the write cannot store, and the save
   * fails at the database with an error naming a column the operator can no
   * longer see on the form. Asserted against ColumnLength rather than against
   * a literal alone, so moving the column moves the bound with it.
   */
  it("bounds the short credential fields at the ShortText width of the columns they are mirrored into", () => {
    expect(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH).toBe(ColumnLength.ShortText);
    expect(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH).toBe(100);
  });

  /*
   * The two v3 keys get the wider bound because the columns they mirror into
   * are wider. Pinned as a strict inequality as well as a value, because the
   * cheap way to write this rule — one bound for every credential field — is
   * exactly the mistake that would silently refuse a legitimate 200-character
   * privacy passphrase.
   */
  it("bounds the two v3 keys at the LongText width of the columns they are mirrored into", () => {
    expect(MAX_SNMP_CONFIG_KEY_LENGTH).toBe(ColumnLength.LongText);
    expect(MAX_SNMP_CONFIG_KEY_LENGTH).toBe(500);
    expect(MAX_SNMP_CONFIG_KEY_LENGTH).toBeGreaterThan(
      MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH,
    );
  });

  /*
   * MAX_SNMP_CONFIGS_PER_SCAN is justified in prose by arithmetic over
   * another module's constant — how long a full-range sweep takes per
   * credential set, and therefore how many sets fit inside the probe's
   * deadline. That prose once did its arithmetic against a 4,096-address
   * ceiling that had already moved to 32,768, which made it claim a
   * single-set full-range sweep cost a few minutes when it really costs
   * something like thirty-four of them, and made the ceiling read as though
   * it had been chosen to make the worst case fit. It cannot be: at this
   * scan size THREE sets already cross the probe's 90-minute deadline, and a
   * single-credential sweep of a maximum target has always sat within a
   * factor of three of it.
   *
   * A comment that computes against a constant in another file goes stale in
   * silence, because nothing links the two. This test is that link: it pins
   * the scan ceiling the rationale rests on, and the numbers the rationale
   * quotes, so moving MAX_SCAN_HOSTS again fails here instead of quietly
   * turning the explanation into fiction.
   */
  it("keeps the sweep-cost rationale for the config ceiling tied to the real scan-size ceiling", () => {
    expect(ScanTargetUtil.MAX_SCAN_HOSTS).toBe(32768);

    /*
     * The comment's own formula: hosts x sets x 2s SNMP timeout / 32
     * concurrent probes, expressed in minutes for one set.
     */
    const minutesPerConfig: number =
      (ScanTargetUtil.MAX_SCAN_HOSTS * 2) / 32 / 60;

    expect(Math.round(minutesPerConfig)).toBe(34);

    // Two sets fit inside the probe's 90-minute deadline. Three do not.
    expect(minutesPerConfig * 2).toBeLessThan(90);
    expect(minutesPerConfig * 3).toBeGreaterThan(90);

    // And the ceiling itself is the "some 5.7 hours" the comment quotes.
    const hoursAtTheCeiling: number =
      (minutesPerConfig * MAX_SNMP_CONFIGS_PER_SCAN) / 60;

    expect(Math.round(hoursAtTheCeiling * 10) / 10).toBe(5.7);
  });

  it("bounds the port to the UDP port range", () => {
    expect(MINIMUM_SNMP_PORT).toBe(1);
    expect(MAXIMUM_SNMP_PORT).toBe(65535);
  });
});

describe("SnmpScanConfigUtil.resolve", () => {
  /*
   * The single most important property of this function: the probe sweeps
   * with what it returns, so an empty answer is a scan that tries nothing and
   * reports a confident zero. There is no input that produces one.
   */
  it("never returns an empty list, whatever the column holds", () => {
    const columnValues: Array<unknown> = [
      undefined,
      null,
      [],
      "not-a-list",
      42,
      true,
      { id: "an-object-not-a-list" },
      [null, undefined, "junk", 7, false, ""],
    ];

    for (const value of columnValues) {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(scanWithConfigs(value));

      expect(configs.length).toBeGreaterThan(0);
    }
  });

  describe("when the scan has no usable stored list", () => {
    /*
     * The legacy shape is synthesized on every read rather than migrated into
     * the new column: a data migration over every historical scan buys
     * nothing (this produces the identical config each time) and would have
     * to guess at rows whose columns are half populated.
     */
    it("synthesizes exactly one config from the flattened columns, with the legacy id", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(LEGACY_SCAN);

      expect(configs).toHaveLength(1);
      expect(configs[0]).toEqual({
        id: LEGACY_SNMP_CONFIG_ID,
        snmpVersion: "V2c",
        snmpCommunityString: "legacy-community",
        snmpPort: 1161,
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
        snmpV3Username: "legacy-user",
        snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
        snmpV3AuthKey: "legacy-auth-key",
        snmpV3PrivProtocol: SnmpPrivProtocol.AES,
        snmpV3PrivKey: "legacy-priv-key",
      });
      expect(configs[0]!.id).toBe(LEGACY_SNMP_CONFIG_ID);
    });

    /*
     * Same config for null, undefined, an empty array, a value that is not an
     * array at all, and an array holding nothing usable. Every one of those
     * states means "this row is described by its flattened columns", and the
     * probe must not behave differently for any of them.
     */
    it("falls back to the flattened columns for null, undefined, an empty list, a non-list and a list of junk", () => {
      const columnValues: Array<unknown> = [
        undefined,
        null,
        [],
        "",
        "[]",
        0,
        { snmpCommunityString: "an object is not a list" },
        [null, undefined, "junk", 7, false, "", 0],
      ];

      for (const value of columnValues) {
        const configs: Array<DiscoveryScanSnmpConfig> =
          SnmpScanConfigUtil.resolve({
            ...LEGACY_SCAN,
            snmpConfigs: value as
              | Array<DiscoveryScanSnmpConfig>
              | null
              | undefined,
          });

        expect(configs).toHaveLength(1);
        expect(configs[0]!.id).toBe(LEGACY_SNMP_CONFIG_ID);
        expect(configs[0]!.snmpCommunityString).toBe("legacy-community");
      }
    });

    /*
     * A scan with no SNMP columns set at all is still a scan the probe has to
     * sweep with something: an id, and the version default the column itself
     * carries. Nothing is invented for the credentials — the probe falls back
     * to "public" and port 161 on its own.
     */
    it("still produces one usable config for a scan with no SNMP columns set", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve({});

      expect(configs).toEqual([
        {
          id: LEGACY_SNMP_CONFIG_ID,
          snmpVersion: "V2c",
        },
      ]);
    });

    /*
     * Resolving the same row twice has to produce the same ids, because it
     * happens independently in the probe (which stamps the id onto a host)
     * and in the importer (which looks it up again).
     */
    it("is deterministic, so a stamped config id resolves to the same config in another process", () => {
      expect(SnmpScanConfigUtil.resolve(LEGACY_SCAN)).toEqual(
        SnmpScanConfigUtil.resolve(LEGACY_SCAN),
      );
    });
  });

  describe("when the scan has a stored list", () => {
    it("returns the stored list rather than the flattened columns", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve({
          ...LEGACY_SCAN,
          snmpConfigs: [
            {
              id: "stored-1",
              name: "Access switches",
              snmpVersion: "V2c",
              snmpCommunityString: "stored-community",
            },
          ],
        });

      expect(configs).toHaveLength(1);
      expect(configs[0]!.id).toBe("stored-1");
      expect(configs[0]!.snmpCommunityString).toBe("stored-community");
      // The flattened columns are ignored entirely once a list exists.
      expect(configs[0]!.snmpV3Username).toBeUndefined();
    });

    /*
     * The list is ordered by the operator's own preference and the sweep
     * consumes it in that order (adaptively re-ordered only within a single
     * run), so reordering it here would change which credential set a host
     * answers first.
     */
    it("preserves the operator's order exactly", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            { id: "c", name: "Printers" },
            { id: "a", name: "Core" },
            { id: "b", name: "Access" },
          ]),
        );

      expect(
        configs.map((config: DiscoveryScanSnmpConfig): string | undefined => {
          return config.name;
        }),
      ).toEqual(["Printers", "Core", "Access"]);
      expect(
        configs.map((config: DiscoveryScanSnmpConfig): string | undefined => {
          return config.id;
        }),
      ).toEqual(["c", "a", "b"]);
    });

    /*
     * A jsonb column can hold anything an out-of-band writer put there. Junk
     * entries are dropped rather than turned into empty credential sets,
     * which would otherwise cost the sweep a full timeout per host for a
     * config nobody configured.
     */
    it("drops entries that are not objects and keeps the ones that are", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            null,
            { id: "real-1", name: "Core" },
            "junk",
            42,
            undefined,
            false,
            { id: "real-2", name: "Access" },
          ]),
        );

      expect(configs).toHaveLength(2);
      expect(
        configs.map((config: DiscoveryScanSnmpConfig): string | undefined => {
          return config.id;
        }),
      ).toEqual(["real-1", "real-2"]);
    });

    /*
     * The positional id is a REPAIR for a row written out of band, not the
     * normal path — the form mints an id per card and the write hooks mint
     * one for anything that arrives without. It is index-derived rather than
     * random so that two independent resolves of the same row agree.
     */
    it("assigns index-derived ids only to entries that have none, leaving supplied ids alone", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            { name: "First" },
            { id: "operator-chosen-id", name: "Second" },
            { name: "Third" },
          ]),
        );

      expect(
        configs.map((config: DiscoveryScanSnmpConfig): string | undefined => {
          return config.id;
        }),
      ).toEqual(["config-1", "operator-chosen-id", "config-3"]);
    });

    // A blank id is no id at all, so it gets the positional repair too.
    it("treats a blank id as missing", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            { id: "   ", name: "First" },
            { id: "", name: "Second" },
          ]),
        );

      expect(configs[0]!.id).toBe("config-1");
      expect(configs[1]!.id).toBe("config-2");
    });

    // A supplied id is trimmed, so " abc " and "abc" name the same config.
    it("trims a supplied id", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(scanWithConfigs([{ id: "  spaced-id  " }]));

      expect(configs[0]!.id).toBe("spaced-id");
    });
  });

  describe("version normalization", () => {
    /*
     * Two spellings exist — the stored one ("V3") and the probe-contract enum
     * value ("3") — and a hand-written row can hold either, in any case.
     * Normalizing to the stored spelling is what lets the service compare a
     * saved list against an incoming one without a false difference, and what
     * repairs a row that would otherwise disagree with the sweep.
     */
    it("normalizes every spelling and casing of v3 to the stored spelling", () => {
      const spellings: Array<string> = ["3", "v3", "V3", " V3 ", " v3", "3 "];

      for (const spelling of spellings) {
        const configs: Array<DiscoveryScanSnmpConfig> =
          SnmpScanConfigUtil.resolve(
            scanWithConfigs([{ id: "x", snmpVersion: spelling }]),
          );

        expect(configs[0]!.snmpVersion).toBe("V3");
      }
    });

    it("normalizes every spelling and casing of v1 to the stored spelling", () => {
      const spellings: Array<string> = ["1", "v1", "V1", " V1 "];

      for (const spelling of spellings) {
        const configs: Array<DiscoveryScanSnmpConfig> =
          SnmpScanConfigUtil.resolve(
            scanWithConfigs([{ id: "x", snmpVersion: spelling }]),
          );

        expect(configs[0]!.snmpVersion).toBe("V1");
      }
    });

    /*
     * Anything unrecognized lands on the SAME default the probe would have
     * used, rather than being stored as itself. A config whose stored version
     * says one thing while the sweep does another is unexplainable from the
     * UI.
     */
    it("falls back to the stored v2c spelling for every other value, including nonsense", () => {
      const spellings: Array<unknown> = [
        "2c",
        "V2c",
        "v2C",
        " 2C ",
        "2",
        "banana",
        "",
        "   ",
        undefined,
        null,
      ];

      for (const spelling of spellings) {
        const configs: Array<DiscoveryScanSnmpConfig> =
          SnmpScanConfigUtil.resolve(
            scanWithConfigs([{ id: "x", snmpVersion: spelling }]),
          );

        expect(configs[0]!.snmpVersion).toBe("V2c");
      }
    });

    // The version is the one field that is always present after resolving.
    it("always sets a version, even on a config that carried none", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(scanWithConfigs([{ id: "x" }]));

      expect(Object.keys(configs[0]!)).toContain("snmpVersion");
      expect(configs[0]!.snmpVersion).toBe("V2c");
    });
  });

  describe("string and port cleanup", () => {
    it("trims every string field", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            {
              id: "  x  ",
              name: "  Core switches  ",
              snmpCommunityString: "  public  ",
              snmpV3SecurityLevel: "  authPriv  ",
              snmpV3Username: "  monitor  ",
              snmpV3AuthProtocol: "  SHA256  ",
              snmpV3AuthKey: "  auth-key-value  ",
              snmpV3PrivProtocol: "  AES256  ",
              snmpV3PrivKey: "  priv-key-value  ",
            },
          ]),
        );

      expect(configs[0]).toEqual({
        id: "x",
        name: "Core switches",
        snmpVersion: "V2c",
        snmpCommunityString: "public",
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "monitor",
        snmpV3AuthProtocol: "SHA256",
        snmpV3AuthKey: "auth-key-value",
        snmpV3PrivProtocol: "AES256",
        snmpV3PrivKey: "priv-key-value",
      });
    });

    /*
     * A blank field is dropped rather than stored as "". Downstream every
     * reader asks `config.snmpCommunityString ?? "public"`, and an empty
     * string would defeat that fallback and dial the device with no
     * community at all.
     */
    it("drops blank strings instead of storing empty ones", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            {
              id: "x",
              name: "   ",
              snmpCommunityString: "",
              snmpV3Username: "\t",
              snmpV3AuthKey: "\n",
            },
          ]),
        );

      expect(configs[0]).toEqual({ id: "x", snmpVersion: "V2c" });
      expect(Object.keys(configs[0]!)).not.toContain("name");
      expect(Object.keys(configs[0]!)).not.toContain("snmpCommunityString");
    });

    // Values that are not text at all are dropped, not coerced.
    it("drops fields that are not strings rather than stringifying them", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            {
              id: "x",
              name: 42,
              snmpCommunityString: { nested: true },
              snmpV3Username: ["monitor"],
            },
          ]),
        );

      expect(configs[0]).toEqual({ id: "x", snmpVersion: "V2c" });
    });

    it("keeps a valid port, including one supplied as text by a Number form field", () => {
      expect(
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([{ id: "x", snmpPort: 1161 }]),
        )[0]!.snmpPort,
      ).toBe(1161);
      expect(
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([{ id: "x", snmpPort: "1161" }]),
        )[0]!.snmpPort,
      ).toBe(1161);
      expect(
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([{ id: "x", snmpPort: MINIMUM_SNMP_PORT }]),
        )[0]!.snmpPort,
      ).toBe(1);
      expect(
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([{ id: "x", snmpPort: MAXIMUM_SNMP_PORT }]),
        )[0]!.snmpPort,
      ).toBe(65535);
    });

    /*
     * Out of range is DROPPED, not clamped. Clamping 0 to 1 would have the
     * probe dial a port the operator never chose and never sees; dropping it
     * lets the column default (161) apply, which is the port they meant. The
     * write path refuses the value outright via getPortValidationError — this
     * is only what a READ does with a row that already holds one.
     */
    it("drops an out-of-range or non-integer port rather than clamping it", () => {
      const badPorts: Array<unknown> = [
        0,
        -1,
        65536,
        99999,
        161.5,
        "161.5",
        "abc",
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "",
        "   ",
      ];

      for (const port of badPorts) {
        const configs: Array<DiscoveryScanSnmpConfig> =
          SnmpScanConfigUtil.resolve(
            scanWithConfigs([{ id: "x", snmpPort: port }]),
          );

        expect(configs[0]!.snmpPort).toBeUndefined();
        expect(Object.keys(configs[0]!)).not.toContain("snmpPort");
      }
    });
  });

  describe("credential preservation across a version change", () => {
    /*
     * An operator who switches a card to v2c to try something, then switches
     * it back, must not find their v3 keys gone. The probe reads only what
     * the chosen version needs, so carrying the unused block costs nothing
     * and losing it costs a re-typed key nobody remembers.
     */
    it("keeps the v3 block on a v2c config", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            {
              id: "x",
              snmpVersion: "V2c",
              snmpCommunityString: "public",
              snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
              snmpV3Username: "monitor",
              snmpV3AuthProtocol: SnmpAuthProtocol.SHA256,
              snmpV3AuthKey: "auth-key-value",
              snmpV3PrivProtocol: SnmpPrivProtocol.AES256,
              snmpV3PrivKey: "priv-key-value",
            },
          ]),
        );

      expect(configs[0]!.snmpVersion).toBe("V2c");
      expect(configs[0]!.snmpV3Username).toBe("monitor");
      expect(configs[0]!.snmpV3AuthKey).toBe("auth-key-value");
      expect(configs[0]!.snmpV3PrivKey).toBe("priv-key-value");
      expect(configs[0]!.snmpV3SecurityLevel).toBe(SnmpSecurityLevel.AuthPriv);
    });

    it("keeps the community string on a v3 config", () => {
      const configs: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve(
          scanWithConfigs([
            {
              id: "x",
              snmpVersion: "V3",
              snmpCommunityString: "still-here",
              snmpV3Username: "monitor",
            },
          ]),
        );

      expect(configs[0]!.snmpVersion).toBe("V3");
      expect(configs[0]!.snmpCommunityString).toBe("still-here");
    });
  });
});

describe("SnmpScanConfigUtil.readStoredList", () => {
  /*
   * This is the WRITER's question — "does this row carry its own list?" —
   * and it has to be answered honestly, because "has a list" and "is
   * described by its flattened columns" are two different states of the row
   * and the write hooks branch on which one it is.
   */
  it("returns null for anything that is not a populated list", () => {
    const values: Array<unknown> = [
      undefined,
      null,
      [],
      "",
      "not-a-list",
      "[]",
      0,
      42,
      true,
      false,
      { id: "an object is not a list" },
    ];

    for (const value of values) {
      expect(SnmpScanConfigUtil.readStoredList(value)).toBeNull();
    }
  });

  it("returns null for a list that holds nothing usable", () => {
    expect(
      SnmpScanConfigUtil.readStoredList([
        null,
        undefined,
        "junk",
        7,
        false,
        "",
      ]),
    ).toBeNull();
  });

  it("returns the entries that are objects, dropping the rest", () => {
    const stored: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.readStoredList([
        null,
        { id: "real-1" },
        "junk",
        { id: "real-2" },
      ]);

    expect(stored).toEqual([{ id: "real-1" }, { id: "real-2" }]);
  });

  /*
   * Deliberately NOT normalized: this is what a writer compares against and
   * what it decides to overwrite, so it has to be the row as stored — the
   * same objects, untrimmed, with no ids or versions invented. resolve() is
   * the function that repairs; this one only reports.
   */
  it("hands back the stored entries as they are, without normalizing them", () => {
    const first: DiscoveryScanSnmpConfig = {
      name: "  Core  ",
      snmpVersion: "3",
    };
    const stored: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.readStoredList([first]);

    expect(stored).toHaveLength(1);
    expect(stored![0]).toBe(first);
    expect(stored![0]!.name).toBe("  Core  ");
    expect(stored![0]!.snmpVersion).toBe("3");
    expect(stored![0]!.id).toBeUndefined();
  });

  /*
   * The contrast that matters. Given the same row, resolve() answers "what
   * does the scan try?" and is never empty; readStoredList() answers "does
   * this row have its own list?" and says no when it does not. A writer that
   * used resolve() would materialize a list on a row nobody asked to change.
   */
  it("says null exactly where resolve synthesizes a legacy config", () => {
    const emptyish: Array<unknown> = [undefined, null, [], "junk", ["junk"]];

    for (const value of emptyish) {
      expect(SnmpScanConfigUtil.readStoredList(value)).toBeNull();

      const resolved: Array<DiscoveryScanSnmpConfig> =
        SnmpScanConfigUtil.resolve({
          ...LEGACY_SCAN,
          snmpConfigs: value as
            | Array<DiscoveryScanSnmpConfig>
            | null
            | undefined,
        });

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.id).toBe(LEGACY_SNMP_CONFIG_ID);
    }
  });

  it("and returns the list exactly where resolve returns the stored one", () => {
    const list: Array<DiscoveryScanSnmpConfig> = [
      { id: "a", name: "Core" },
      { id: "b", name: "Access" },
    ];

    expect(SnmpScanConfigUtil.readStoredList(list)).toHaveLength(2);
    expect(SnmpScanConfigUtil.resolve(scanWithConfigs(list))).toHaveLength(2);
  });
});

describe("SnmpScanConfigUtil.findById", () => {
  const configs: Array<DiscoveryScanSnmpConfig> = [
    { id: "config-a", name: "Core", snmpCommunityString: "community-a" },
    { id: "config-b", name: "Access", snmpCommunityString: "community-b" },
  ];

  it("returns the config whose id matches exactly", () => {
    expect(SnmpScanConfigUtil.findById(configs, "config-b")).toBe(configs[1]);
  });

  it("returns undefined when the id names no config in the list", () => {
    expect(
      SnmpScanConfigUtil.findById(configs, "config-that-was-deleted"),
    ).toBeUndefined();
  });

  /*
   * Every result stored before this feature carries no config id at all, and
   * so does every ping-only host. Those are the common case, not the edge
   * case — hence undefined rather than a throw.
   */
  it("returns undefined when there is no id to look up", () => {
    expect(SnmpScanConfigUtil.findById(configs, undefined)).toBeUndefined();
    expect(SnmpScanConfigUtil.findById(configs, null)).toBeUndefined();
    expect(SnmpScanConfigUtil.findById(configs, "")).toBeUndefined();
  });

  /*
   * Ids are compared verbatim: they are minted UUIDs, and being lenient here
   * would let two configs that differ only by case both answer for a host.
   */
  it("matches ids exactly, without trimming or case-folding", () => {
    expect(SnmpScanConfigUtil.findById(configs, "CONFIG-A")).toBeUndefined();
    expect(SnmpScanConfigUtil.findById(configs, " config-a ")).toBeUndefined();
  });

  it("returns undefined against an empty list", () => {
    expect(SnmpScanConfigUtil.findById([], "config-a")).toBeUndefined();
  });
});

describe("SnmpScanConfigUtil.resolveForHost", () => {
  const MULTI_CONFIG_SCAN: SnmpScanConfigSource = {
    ...LEGACY_SCAN,
    snmpConfigs: [
      { id: "first", name: "Access", snmpCommunityString: "community-first" },
      { id: "second", name: "Core", snmpCommunityString: "community-second" },
      { id: "third", name: "Printers", snmpCommunityString: "community-third" },
    ],
  };

  /*
   * The whole point of stamping a config id onto a discovered host: the
   * device is imported with THE credential set that actually answered it,
   * not with the first one in the list.
   */
  it("returns the config that answered the host", () => {
    const config: DiscoveryScanSnmpConfig = SnmpScanConfigUtil.resolveForHost(
      MULTI_CONFIG_SCAN,
      "third",
    );

    expect(config.id).toBe("third");
    expect(config.snmpCommunityString).toBe("community-third");
  });

  /*
   * A device imported with the wrong credentials is repairable on the device
   * form; a device imported with NONE can never poll and gives the operator
   * nothing to correct. So the fallback is the first config, never nothing.
   */
  it("falls back to the first config when the host carries no config id", () => {
    for (const hostConfigId of [undefined, null, ""]) {
      const config: DiscoveryScanSnmpConfig = SnmpScanConfigUtil.resolveForHost(
        MULTI_CONFIG_SCAN,
        hostConfigId,
      );

      expect(config.id).toBe("first");
      expect(config.snmpCommunityString).toBe("community-first");
    }
  });

  // The operator deleted the card that found this host between scan and import.
  it("falls back to the first config when the stamped id no longer exists", () => {
    const config: DiscoveryScanSnmpConfig = SnmpScanConfigUtil.resolveForHost(
      MULTI_CONFIG_SCAN,
      "a-config-that-was-deleted",
    );

    expect(config.id).toBe("first");
    expect(config.snmpCommunityString).toBe("community-first");
  });

  /*
   * The compatibility guarantee, stated as a test: for a scan configured the
   * old way the first (and only) config IS the flattened columns, so every
   * result stored before this feature imports with exactly the credentials it
   * would have imported with before.
   */
  it("resolves a legacy scan's flattened columns for a host with no config id", () => {
    const config: DiscoveryScanSnmpConfig = SnmpScanConfigUtil.resolveForHost(
      LEGACY_SCAN,
      undefined,
    );

    expect(config.id).toBe(LEGACY_SNMP_CONFIG_ID);
    expect(config.snmpCommunityString).toBe("legacy-community");
    expect(config.snmpPort).toBe(1161);
    expect(config.snmpV3Username).toBe("legacy-user");
    expect(config.snmpV3AuthKey).toBe("legacy-auth-key");
    expect(config.snmpV3PrivKey).toBe("legacy-priv-key");
  });

  it("resolves a legacy scan's flattened columns for a host stamped with an unknown id", () => {
    const config: DiscoveryScanSnmpConfig = SnmpScanConfigUtil.resolveForHost(
      LEGACY_SCAN,
      "some-id-from-another-scan",
    );

    expect(config.id).toBe(LEGACY_SNMP_CONFIG_ID);
    expect(config.snmpCommunityString).toBe("legacy-community");
  });

  // The literal id the probe stamps for a legacy scan resolves back to it.
  it("resolves the legacy id itself back to the flattened columns", () => {
    const config: DiscoveryScanSnmpConfig = SnmpScanConfigUtil.resolveForHost(
      LEGACY_SCAN,
      LEGACY_SNMP_CONFIG_ID,
    );

    expect(config.snmpCommunityString).toBe("legacy-community");
  });

  // Never undefined, because resolve() is never empty.
  it("always returns a config, even for a scan with no SNMP columns at all", () => {
    const config: DiscoveryScanSnmpConfig = SnmpScanConfigUtil.resolveForHost(
      {},
      "anything",
    );

    expect(config).toBeDefined();
    expect(config.id).toBe(LEGACY_SNMP_CONFIG_ID);
  });
});

describe("SnmpScanConfigUtil.toStoredVersion", () => {
  it("maps every recognized v1 spelling to the stored one", () => {
    for (const value of ["1", "v1", "V1", " V1 "]) {
      expect(SnmpScanConfigUtil.toStoredVersion(value)).toBe("V1");
    }
  });

  it("maps every recognized v3 spelling to the stored one", () => {
    for (const value of ["3", "v3", "V3", " v3 "]) {
      expect(SnmpScanConfigUtil.toStoredVersion(value)).toBe("V3");
    }
  });

  it("maps every recognized v2c spelling to the stored one", () => {
    for (const value of ["2c", "V2c", "v2C", " 2c "]) {
      expect(SnmpScanConfigUtil.toStoredVersion(value)).toBe("V2c");
    }
  });

  /*
   * Written as a map off the PARSED enum rather than by upper-casing the
   * input, so an unrecognized value lands on the same default the probe would
   * have used instead of being stored as itself and disagreeing with the
   * sweep.
   */
  it("falls back to v2c for anything unrecognized, absent or blank", () => {
    for (const value of ["", "   ", "2", "banana", "v4", undefined, null]) {
      expect(SnmpScanConfigUtil.toStoredVersion(value)).toBe("V2c");
    }
  });

  it("only ever returns one of the three stored spellings", () => {
    const inputs: Array<string | null | undefined> = [
      "1",
      "2c",
      "3",
      "V1",
      "V2c",
      "V3",
      "nonsense",
      "",
      null,
      undefined,
    ];

    for (const value of inputs) {
      expect(["V1", "V2c", "V3"]).toContain(
        SnmpScanConfigUtil.toStoredVersion(value),
      );
    }
  });
});

describe("SnmpScanConfigUtil.getConfigLabel", () => {
  it("uses the operator's name and the version when the config is named", () => {
    expect(
      SnmpScanConfigUtil.getConfigLabel({
        name: "Core switches",
        snmpVersion: "V3",
      }),
    ).toBe("Core switches (V3)");
  });

  // The name wins over the position, which is what makes a five-card list readable.
  it("prefers the name even when a position was supplied", () => {
    expect(
      SnmpScanConfigUtil.getConfigLabel(
        { name: "Printers", snmpVersion: "V1" },
        4,
      ),
    ).toBe("Printers (V1)");
  });

  it("names an unnamed config by its one-based position", () => {
    expect(SnmpScanConfigUtil.getConfigLabel({}, 0)).toBe(
      "SNMP config 1 (V2c)",
    );
    expect(SnmpScanConfigUtil.getConfigLabel({ snmpVersion: "V3" }, 1)).toBe(
      "SNMP config 2 (V3)",
    );
  });

  /*
   * Without a position there is nothing to number, so the label is the
   * version alone — the shape used where only one config is under discussion
   * (buildSnmpV3Auth's "configured for <config label>" message).
   */
  it("falls back to the version alone when there is neither a name nor a position", () => {
    expect(SnmpScanConfigUtil.getConfigLabel({})).toBe("V2c");
    expect(SnmpScanConfigUtil.getConfigLabel({ snmpVersion: "3" })).toBe("V3");
  });

  it("treats a blank name as no name", () => {
    expect(SnmpScanConfigUtil.getConfigLabel({ name: "   " }, 2)).toBe(
      "SNMP config 3 (V2c)",
    );
    expect(SnmpScanConfigUtil.getConfigLabel({ name: "" })).toBe("V2c");
  });

  it("trims the name and normalizes the version it prints", () => {
    expect(
      SnmpScanConfigUtil.getConfigLabel({
        name: "  Core switches  ",
        snmpVersion: "3",
      }),
    ).toBe("Core switches (V3)");
  });

  /*
   * SECURITY PROPERTY, not cosmetics. These labels are written into the
   * probe's log lines and into the scan's statusMessage, which a Viewer can
   * read — a column the credentials themselves are deliberately kept out of
   * (the snmpConfigs column's read access control is the narrow list for
   * exactly this reason). So the label is built from the operator's own name
   * and the version, and from nothing else.
   */
  it("never leaks the community string or either v3 key, whatever is set", () => {
    const community: string = "s3cr3t-community";
    const authKey: string = "s3cr3t-auth-key";
    const privKey: string = "s3cr3t-priv-key";

    const config: DiscoveryScanSnmpConfig = {
      id: "config-id",
      name: "Core switches",
      snmpVersion: "V3",
      snmpCommunityString: community,
      snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
      snmpV3Username: "monitor",
      snmpV3AuthProtocol: SnmpAuthProtocol.SHA512,
      snmpV3AuthKey: authKey,
      snmpV3PrivProtocol: SnmpPrivProtocol.AES256,
      snmpV3PrivKey: privKey,
    };

    const labels: Array<string> = [
      SnmpScanConfigUtil.getConfigLabel(config),
      SnmpScanConfigUtil.getConfigLabel(config, 0),
      SnmpScanConfigUtil.getConfigLabel(config, 7),
      SnmpScanConfigUtil.getConfigLabel({ ...config, name: undefined }),
      SnmpScanConfigUtil.getConfigLabel({ ...config, name: undefined }, 2),
    ];

    for (const label of labels) {
      expect(label).not.toContain(community);
      expect(label).not.toContain(authKey);
      expect(label).not.toContain(privKey);
      // Not even a fragment of one.
      expect(label).not.toContain("s3cr3t");
    }

    expect(labels[0]).toBe("Core switches (V3)");
    expect(labels[4]).toBe("SNMP config 3 (V3)");
  });
});

describe("SnmpScanConfigUtil.getValidationError", () => {
  /*
   * The column is optional: a scan with no list is a scan configured through
   * the flattened columns, which is every scan that existed before this
   * feature. Absence must not be an error anywhere.
   */
  it("accepts an absent list, because the column is optional", () => {
    expect(SnmpScanConfigUtil.getValidationError(undefined)).toBeNull();
    expect(SnmpScanConfigUtil.getValidationError(null)).toBeNull();
  });

  /*
   * Typed unknown because the server hook runs before the model's own type
   * checks, so this is the first thing to see whatever the client actually
   * sent — and for a jsonb column that really can be a string or a number.
   */
  it("refuses a value that is not a list at all", () => {
    for (const value of ["", "not-a-list", "[]", 0, 42, true, { id: "x" }]) {
      expect(SnmpScanConfigUtil.getValidationError(value)).toBe(
        "SNMP configs must be a list.",
      );
    }
  });

  /*
   * An empty list is refused rather than quietly read as "use the flattened
   * columns". The operator got here by deleting every card, and silently
   * falling back to a hidden credential set they can no longer see produces a
   * scan nobody can explain.
   */
  it("refuses an empty list rather than silently falling back to the flattened columns", () => {
    const error: string | null = SnmpScanConfigUtil.getValidationError([]);

    expect(error).toBe(
      "Add at least one SNMP config, or the scan has no credentials to try.",
    );
  });

  it("accepts a list of exactly the maximum length", () => {
    const configs: Array<DiscoveryScanSnmpConfig> = Array.from(
      { length: MAX_SNMP_CONFIGS_PER_SCAN },
      (_unused: unknown, index: number): DiscoveryScanSnmpConfig => {
        return { id: `config-${index}`, name: `Config ${index}` };
      },
    );

    expect(configs).toHaveLength(10);
    expect(SnmpScanConfigUtil.getValidationError(configs)).toBeNull();
  });

  /*
   * One over the ceiling, and the message says WHY the ceiling exists —
   * every extra config is another SNMP timeout on each silent address, and a
   * long list can push a large sweep past the probe's deadline.
   */
  it("refuses one more than the maximum and explains the cost", () => {
    const configs: Array<DiscoveryScanSnmpConfig> = Array.from(
      { length: MAX_SNMP_CONFIGS_PER_SCAN + 1 },
      (_unused: unknown, index: number): DiscoveryScanSnmpConfig => {
        return { id: `config-${index}` };
      },
    );

    const error: string | null = SnmpScanConfigUtil.getValidationError(configs);

    expect(error).toContain(
      `at most ${MAX_SNMP_CONFIGS_PER_SCAN} SNMP configs`,
    );
    expect(error).toContain("This one has 11.");
    expect(error).toContain("Split the range into more scans instead.");
  });

  describe("entry shape", () => {
    /*
     * An entry that is not an object cannot carry credentials, and the
     * message names the card so the operator knows which one to delete.
     */
    it("refuses an entry that is not an object, naming its position", () => {
      for (const entry of [null, undefined, "junk", 42, true, false, 0, ""]) {
        expect(errorForSecondConfig(entry)).toBe("SNMP config 2 is not valid.");
      }
    });

    // An array is an object to `typeof`, so it gets its own rejection here.
    it("refuses an entry that is an array", () => {
      expect(errorForSecondConfig([])).toBe("SNMP config 2 is not valid.");
      expect(errorForSecondConfig([{ id: "nested" }])).toBe(
        "SNMP config 2 is not valid.",
      );
    });

    it("names the FIRST offending config when several are wrong", () => {
      const error: string | null = SnmpScanConfigUtil.getValidationError([
        { id: "ok" },
        { id: "bad-name", name: 42 },
        { id: "bad-port", snmpPort: 0 },
      ]);

      expect(error).toContain("SNMP config 2");
      expect(error).not.toContain("SNMP config 3");
    });
  });

  describe("field types", () => {
    /*
     * Every text field is checked, and each has its own human label, because
     * "SNMP config 2 is not valid" would not tell an operator which box to
     * look at.
     */
    it("refuses a non-string in any text field, naming the field and the position", () => {
      const cases: Array<[string, string]> = [
        ["id", "id"],
        ["name", "name"],
        ["snmpVersion", "version"],
        ["snmpCommunityString", "community string"],
        ["snmpV3SecurityLevel", "v3 security level"],
        ["snmpV3Username", "v3 username"],
        ["snmpV3AuthProtocol", "v3 authentication protocol"],
        ["snmpV3AuthKey", "v3 authentication key"],
        ["snmpV3PrivProtocol", "v3 privacy protocol"],
        ["snmpV3PrivKey", "v3 privacy key"],
      ];

      for (const [key, label] of cases) {
        expect(errorForSecondConfig({ [key]: 42 })).toBe(
          `SNMP config 2: the ${label} must be text.`,
        );
        expect(errorForSecondConfig({ [key]: { nested: true } })).toBe(
          `SNMP config 2: the ${label} must be text.`,
        );
      }
    });

    /*
     * Unset is not the same as wrong. Every one of these fields is optional,
     * and a null arriving from a cleared form field is an absence.
     */
    it("accepts null and undefined in every text field", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          {
            id: null,
            name: null,
            snmpVersion: null,
            snmpCommunityString: null,
            snmpV3SecurityLevel: null,
            snmpV3Username: undefined,
            snmpV3AuthProtocol: undefined,
            snmpV3AuthKey: undefined,
            snmpV3PrivProtocol: undefined,
            snmpV3PrivKey: undefined,
          },
        ]),
      ).toBeNull();
    });

    it("accepts a config with nothing set at all", () => {
      expect(SnmpScanConfigUtil.getValidationError([{}])).toBeNull();
    });
  });

  describe("name length", () => {
    it("accepts a name of exactly the maximum length", () => {
      const name: string = "n".repeat(MAX_SNMP_CONFIG_NAME_LENGTH);

      expect(name).toHaveLength(100);
      expect(
        SnmpScanConfigUtil.getValidationError([{ id: "x", name }]),
      ).toBeNull();
    });

    /*
     * The value lives in a jsonb column with no width of its own, so nothing
     * downstream would ever reject an over-long name — which is exactly why
     * the message has to quote both the ceiling and what they typed.
     */
    it("refuses a name one character over the maximum and quotes both lengths", () => {
      const name: string = "n".repeat(MAX_SNMP_CONFIG_NAME_LENGTH + 1);
      const error: string | null = errorForSecondConfig({
        id: "second",
        name,
      });

      expect(error).toContain("SNMP config 2");
      expect(error).toContain(
        `a name cannot be longer than ${MAX_SNMP_CONFIG_NAME_LENGTH} characters`,
      );
      expect(error).toContain("This one is 101.");
    });

    // The length is measured after trimming, so padding is not what fails.
    it("measures the name after trimming", () => {
      const name: string = `  ${"n".repeat(MAX_SNMP_CONFIG_NAME_LENGTH)}  `;

      expect(
        SnmpScanConfigUtil.getValidationError([{ id: "x", name }]),
      ).toBeNull();
    });
  });

  /*
   * CREDENTIAL FIELD LENGTHS
   *
   * `snmpConfigs` is a jsonb column and jsonb has no width, so on the storage
   * side nothing objects to a novel typed into a community string. The bound
   * comes from somewhere else entirely: getMirroredLegacyColumns copies the
   * FIRST config of the list onto the flattened snmpCommunityString /
   * snmpV3* columns, because a probe is deployed separately from the server
   * and a probe that has never heard of `snmpConfigs` reads those columns and
   * nothing else. They are varchar(100) and varchar(500), and Postgres does
   * not truncate an over-long value on the way in — it raises.
   *
   * Before these bounds existed the defect had two halves and both were bad:
   *
   *   - An over-long community string in card #1 failed the WRITE, and the
   *     error the operator got back named `snmpCommunityString` — a column
   *     that no longer appears anywhere on the multi-config form. They were
   *     told to fix a field they cannot see.
   *   - The IDENTICAL value in card #2 saved without a word, and became a
   *     credential the mirror could never carry. Reordering the cards, or
   *     deleting card #1, then turned a save that had always worked into the
   *     database error above — arbitrarily far from the edit that caused it.
   *
   * So the rule below is one rule, checked on EVERY card, phrased in the
   * words of the field the operator is looking at, and each field gets the
   * width of the column it is actually mirrored into.
   */
  describe("credential field lengths", () => {
    it("accepts every short credential field at exactly the ShortText bound", () => {
      const value: string = "s".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH);

      expect(value).toHaveLength(100);

      for (const [key] of SHORT_TEXT_CREDENTIAL_FIELDS) {
        expect(
          SnmpScanConfigUtil.getValidationError([configWithField(key, value)]),
        ).toBeNull();
      }
    });

    /*
     * One character over, for every field, with the message naming the card
     * by position and quoting BOTH lengths. Position matters because a list
     * of five credential sets makes "the community string is too long" an
     * unactionable sentence; both lengths matter because the operator pasted
     * a value out of a password manager and has no idea how long it is.
     */
    it("refuses every short credential field one character over the bound, naming the card and quoting both lengths", () => {
      const value: string = "s".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH + 1);

      expect(value).toHaveLength(101);

      for (const [key, label] of SHORT_TEXT_CREDENTIAL_FIELDS) {
        expect(errorForSecondConfig(configWithField(key, value))).toBe(
          `SNMP config 2: the ${label} cannot be longer than ` +
            `${MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH} characters. This one is 101.`,
        );
      }
    });

    /*
     * A 400-character key is an ordinary SNMP v3 passphrase, not an abuse
     * case, and it has a varchar(500) waiting for it. Refusing it would be a
     * regression dressed up as a fix.
     */
    it("accepts a four-hundred character v3 key, which is an ordinary passphrase and fits its column", () => {
      const value: string = "k".repeat(400);

      for (const [key] of KEY_CREDENTIAL_FIELDS) {
        expect(
          SnmpScanConfigUtil.getValidationError([configWithField(key, value)]),
        ).toBeNull();
      }
    });

    it("accepts both v3 keys at exactly the LongText bound", () => {
      const value: string = "k".repeat(MAX_SNMP_CONFIG_KEY_LENGTH);

      expect(value).toHaveLength(500);

      for (const [key] of KEY_CREDENTIAL_FIELDS) {
        expect(
          SnmpScanConfigUtil.getValidationError([configWithField(key, value)]),
        ).toBeNull();
      }
    });

    it("refuses both v3 keys one character over the LongText bound, naming the card and quoting both lengths", () => {
      const value: string = "k".repeat(MAX_SNMP_CONFIG_KEY_LENGTH + 1);

      expect(value).toHaveLength(501);

      for (const [key, label] of KEY_CREDENTIAL_FIELDS) {
        expect(errorForSecondConfig(configWithField(key, value))).toBe(
          `SNMP config 2: the ${label} cannot be longer than ` +
            `${MAX_SNMP_CONFIG_KEY_LENGTH} characters. This one is 501.`,
        );
      }
    });

    /*
     * The two bounds have to stay APART. Collapsing them into one number is
     * the obvious simplification and it is wrong in both directions: the
     * ShortText bound applied to a key refuses a legitimate passphrase, and
     * the LongText bound applied to a community string lets through exactly
     * the value that raises on the mirrored varchar(100).
     */
    it("holds the two bounds apart, so 101 characters is fine in a v3 key and refused in a community string", () => {
      const value: string = "x".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH + 1);

      expect(
        SnmpScanConfigUtil.getValidationError([{ snmpV3AuthKey: value }]),
      ).toBeNull();
      expect(
        SnmpScanConfigUtil.getValidationError([{ snmpV3PrivKey: value }]),
      ).toBeNull();
      expect(
        SnmpScanConfigUtil.getValidationError([{ snmpCommunityString: value }]),
      ).toBe(
        `SNMP config 1: the community string cannot be longer than ` +
          `${MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH} characters. This one is 101.`,
      );
    });

    /*
     * Measured after trimming, exactly like the name bound above — and for
     * the same reason: normalizeConfig trims before storing, so what reaches
     * the mirrored column is the trimmed value, and validating the padded
     * one would refuse a value that would have fitted.
     */
    it("measures every credential field after trimming, exactly as the name bound is measured", () => {
      for (const [key] of SHORT_TEXT_CREDENTIAL_FIELDS) {
        const padded: string = `  ${"s".repeat(
          MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH,
        )}  `;

        expect(padded.length).toBeGreaterThan(
          MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH,
        );
        expect(
          SnmpScanConfigUtil.getValidationError([configWithField(key, padded)]),
        ).toBeNull();
      }

      for (const [key] of KEY_CREDENTIAL_FIELDS) {
        const padded: string = `  ${"k".repeat(MAX_SNMP_CONFIG_KEY_LENGTH)}  `;

        expect(padded.length).toBeGreaterThan(MAX_SNMP_CONFIG_KEY_LENGTH);
        expect(
          SnmpScanConfigUtil.getValidationError([configWithField(key, padded)]),
        ).toBeNull();
      }
    });

    // Padding neither rescues an over-long value nor inflates the number quoted back.
    it("quotes the trimmed length when a padded credential is still too long", () => {
      const padded: string = `   ${"c".repeat(
        MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH + 1,
      )}   `;

      expect(padded).toHaveLength(107);
      expect(errorForSecondConfig({ snmpCommunityString: padded })).toBe(
        `SNMP config 2: the community string cannot be longer than ` +
          `${MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH} characters. This one is 101.`,
      );
    });

    /*
     * THE ASYMMETRY THAT WAS THE BUG.
     *
     * Only card #1 is mirrored, so only card #1 used to fail — at the
     * database, in a column's words. The same value anywhere else stored
     * happily and waited to detonate on a reorder. The rule must therefore be
     * identical in every position: same wording, same bound, differing only
     * in the card it names.
     */
    it("refuses an over-long community string in a card the mirror never touches, not only in the first card", () => {
      const communityString: string = "c".repeat(
        MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH + 1,
      );

      const inFirstCard: string | null = SnmpScanConfigUtil.getValidationError([
        { id: "one", snmpCommunityString: communityString },
        { id: "two" },
      ]);
      const inSecondCard: string | null = SnmpScanConfigUtil.getValidationError(
        [{ id: "one" }, { id: "two", snmpCommunityString: communityString }],
      );

      expect(inFirstCard).toContain("SNMP config 1:");
      expect(inSecondCard).toContain("SNMP config 2:");
      expect(inFirstCard!.replace("SNMP config 1", "SNMP config 2")).toBe(
        inSecondCard,
      );
    });

    /*
     * The length check runs BEFORE the v3 recognition checks, so an over-long
     * security level or protocol is reported as too long rather than as
     * unrecognized. It is both, but only one of those sentences tells the
     * operator what to do about a value they pasted by accident.
     */
    it("reports an over-long v3 protocol as too long rather than as unrecognized", () => {
      const error: string | null = errorForSecondConfig(
        validAuthPrivConfig({
          id: "second",
          snmpV3AuthProtocol: "a".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH + 1),
        }),
      );

      expect(error).toBe(
        `SNMP config 2: the v3 authentication protocol cannot be longer than ` +
          `${MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH} characters. This one is 101.`,
      );
      expect(error).not.toContain("not a recognized");
    });

    /*
     * The whole point, stated as one property: anything getValidationError
     * lets through must fit the columns getMirroredLegacyColumns writes it
     * into. This is the assertion that would have caught the original defect
     * even if every bound above were spelled differently.
     */
    it("guarantees that a list which validates mirrors into values that fit their varchar widths", () => {
      const configs: Array<DiscoveryScanSnmpConfig> = [
        {
          id: "i".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH),
          name: "n".repeat(MAX_SNMP_CONFIG_NAME_LENGTH),
          snmpCommunityString: "c".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH),
          snmpV3Username: "u".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH),
          snmpV3SecurityLevel: "l".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH),
          snmpV3AuthProtocol: "a".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH),
          snmpV3PrivProtocol: "p".repeat(MAX_SNMP_CONFIG_SHORT_TEXT_LENGTH),
          snmpV3AuthKey: "k".repeat(MAX_SNMP_CONFIG_KEY_LENGTH),
          snmpV3PrivKey: "v".repeat(MAX_SNMP_CONFIG_KEY_LENGTH),
        },
      ];

      expect(SnmpScanConfigUtil.getValidationError(configs)).toBeNull();

      const mirrored: Record<string, string | number | null> =
        SnmpScanConfigUtil.getMirroredLegacyColumns(configs);

      for (const column of MIRRORED_COLUMN_KEYS) {
        const value: string | number | null | undefined = mirrored[column];

        if (typeof value !== "string") {
          continue;
        }

        const columnWidth: number =
          column === "snmpV3AuthKey" || column === "snmpV3PrivKey"
            ? ColumnLength.LongText
            : ColumnLength.ShortText;

        expect(value.length).toBeLessThanOrEqual(columnWidth);
      }
    });
  });

  describe("port", () => {
    it("accepts a port inside the UDP range, absent, or blank", () => {
      const ports: Array<unknown> = [
        MINIMUM_SNMP_PORT,
        MAXIMUM_SNMP_PORT,
        161,
        1161,
        "161",
        "  161  ",
        "",
        "   ",
        null,
        undefined,
      ];

      for (const snmpPort of ports) {
        expect(
          SnmpScanConfigUtil.getValidationError([{ id: "x", snmpPort }]),
        ).toBeNull();
      }
    });

    it("refuses a port outside the UDP range, naming the position", () => {
      for (const snmpPort of [0, -1, 65536, 99999, "0", "65536"]) {
        expect(errorForSecondConfig({ id: "second", snmpPort })).toBe(
          `SNMP config 2: the SNMP port must be between ${MINIMUM_SNMP_PORT} and ${MAXIMUM_SNMP_PORT}.`,
        );
      }
    });

    /*
     * Checked against the RAW value, not a parsed one. A Number form field
     * posts its contents as text, so "161.5" would parseInt to 161, clear
     * both bounds, and store a port the operator never typed.
     */
    it("refuses a port that is not a whole number, including one that would parseInt cleanly", () => {
      for (const snmpPort of ["161.5", 161.5, "abc", "16a1", Number.NaN]) {
        expect(errorForSecondConfig({ id: "second", snmpPort })).toBe(
          "SNMP config 2: the SNMP port must be a whole number.",
        );
      }
    });
  });

  describe("duplicate ids", () => {
    /*
     * Duplicate ids make findById ambiguous, so a host found by the second of
     * two identically-identified configs could import with the first one's
     * credentials — the precise bug the id scheme exists to prevent. Only
     * reachable through an out-of-band write; the form mints one id per card.
     */
    it("refuses two configs that share an id, quoting the id", () => {
      const error: string | null = SnmpScanConfigUtil.getValidationError([
        { id: "shared-id", name: "Core" },
        { id: "shared-id", name: "Access" },
      ]);

      expect(error).toBe(
        'Two SNMP configs share the id "shared-id". Each config needs its own.',
      );
    });

    // Ids are trimmed before comparison, so " x " and "x" are the same id.
    it("refuses ids that collide only after trimming", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          { id: "  shared-id  " },
          { id: "shared-id" },
        ]),
      ).toContain('share the id "shared-id"');
    });

    // A missing id is not a duplicate of another missing id.
    it("accepts several configs that carry no id at all", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          { name: "Core" },
          { name: "Access" },
          { name: "Printers" },
        ]),
      ).toBeNull();
      expect(
        SnmpScanConfigUtil.getValidationError([{ id: "" }, { id: "   " }]),
      ).toBeNull();
    });

    it("accepts distinct ids", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          { id: "a" },
          { id: "b" },
          { id: "c" },
        ]),
      ).toBeNull();
    });
  });

  describe("v1 and v2c", () => {
    /*
     * The community string is NOT required, even though the device certainly
     * needs one, because the probe falls back to "public" — a real and very
     * common answer for discovery. Requiring it would refuse the single most
     * useful default.
     */
    it("accepts a v1 or v2c config with no community string", () => {
      for (const snmpVersion of ["V1", "V2c", "1", "2c", undefined]) {
        expect(
          SnmpScanConfigUtil.getValidationError([{ id: "x", snmpVersion }]),
        ).toBeNull();
        expect(
          SnmpScanConfigUtil.getValidationError([
            { id: "x", snmpVersion, snmpCommunityString: "" },
          ]),
        ).toBeNull();
      }
    });

    /*
     * The v3 rules apply only to v3 configs. A card left with stale v3 values
     * from a version the operator switched away from must not block the save.
     */
    it("does not apply the v3 rules to a v2c config carrying a stale v3 block", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          {
            id: "x",
            snmpVersion: "V2c",
            snmpCommunityString: "public",
            snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
            snmpV3Username: "",
          },
        ]),
      ).toBeNull();
    });
  });

  describe("v3", () => {
    it("accepts a fully specified authPriv config", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([validAuthPrivConfig()]),
      ).toBeNull();
    });

    // The v3 rules fire on either spelling of the version, in any case.
    it("applies the v3 rules whichever spelling of the version was stored", () => {
      for (const snmpVersion of ["V3", "v3", "3", " V3 "]) {
        expect(errorForSecondConfig({ id: "second", snmpVersion })).toContain(
          "SNMP config 2: SNMP v3 needs a username",
        );
      }
    });

    /*
     * A v3 session with no security name is rejected by every device, host
     * after host, and the scan reports zero. Caught here so it is a sentence
     * on the form instead of a silent zero-result run.
     */
    it("refuses a v3 config with no username, naming the position", () => {
      for (const snmpV3Username of [undefined, null, "", "   "]) {
        expect(
          errorForSecondConfig({
            id: "second",
            snmpVersion: "V3",
            snmpV3Username,
          }),
        ).toBe(
          "SNMP config 2: SNMP v3 needs a username (the security name configured on the device).",
        );
      }
    });

    /*
     * An unrecognized security level is the most consequential of the three
     * to let through: the fallback is not a weaker algorithm, it is no
     * security at all, and the downgrade itself is invisible.
     */
    it("refuses an unrecognized security level and lists the accepted ones", () => {
      const error: string | null = errorForSecondConfig(
        validAuthPrivConfig({
          id: "second",
          snmpV3SecurityLevel: "auth-priv",
        }),
      );

      expect(error).toContain("SNMP config 2");
      expect(error).toContain(
        '"auth-priv" is not a recognized SNMP v3 security level',
      );
      expect(error).toContain(Object.values(SnmpSecurityLevel).join(", "));
    });

    it("refuses an unrecognized authentication protocol and lists the accepted ones", () => {
      const error: string | null = errorForSecondConfig(
        validAuthPrivConfig({ id: "second", snmpV3AuthProtocol: "SHA3" }),
      );

      expect(error).toContain("SNMP config 2");
      expect(error).toContain(
        '"SHA3" is not a recognized SNMP v3 authentication protocol',
      );
      expect(error).toContain(Object.values(SnmpAuthProtocol).join(", "));
    });

    it("refuses an unrecognized privacy protocol and lists the accepted ones", () => {
      const error: string | null = errorForSecondConfig(
        validAuthPrivConfig({ id: "second", snmpV3PrivProtocol: "3DES" }),
      );

      expect(error).toContain("SNMP config 2");
      expect(error).toContain(
        '"3DES" is not a recognized SNMP v3 privacy protocol',
      );
      expect(error).toContain(Object.values(SnmpPrivProtocol).join(", "));
    });

    /*
     * The spellings the UI labels use, and the casing a hand-written row
     * produces, are all accepted — the same tolerance the enums' own parsers
     * have, so the form and the API agree.
     */
    it("accepts the alternate spellings the labels and hand-written rows use", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          validAuthPrivConfig({
            snmpV3SecurityLevel: "AuthPriv",
            snmpV3AuthProtocol: "SHA-256",
            snmpV3PrivProtocol: "AES-256",
          }),
        ]),
      ).toBeNull();
    });

    /*
     * A level that asks for authentication with nothing to authenticate with
     * does not fail loudly — the session is simply rejected, forever.
     */
    it("refuses authNoPriv with no authentication key", () => {
      const error: string | null = errorForSecondConfig({
        id: "second",
        snmpVersion: "V3",
        snmpV3Username: "monitor",
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthNoPriv,
        snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
      });

      expect(error).toBe(
        `SNMP config 2: the "${SnmpSecurityLevel.AuthNoPriv}" security level needs an authentication key.`,
      );
    });

    it("refuses authPriv with no authentication key", () => {
      const error: string | null = errorForSecondConfig(
        validAuthPrivConfig({ id: "second", snmpV3AuthKey: "   " }),
      );

      expect(error).toBe(
        `SNMP config 2: the "${SnmpSecurityLevel.AuthPriv}" security level needs an authentication key.`,
      );
    });

    it("refuses authPriv with no privacy key", () => {
      const privKeys: Array<unknown> = [undefined, null, "", "  "];

      for (const snmpV3PrivKey of privKeys) {
        expect(
          errorForSecondConfig({
            ...validAuthPrivConfig({ id: "second" }),
            snmpV3PrivKey,
          }),
        ).toBe(
          `SNMP config 2: the "${SnmpSecurityLevel.AuthPriv}" security level needs a privacy key.`,
        );
      }
    });

    // noAuthNoPriv needs neither key: there is nothing to authenticate with.
    it("accepts noAuthNoPriv with no keys at all", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          {
            id: "x",
            snmpVersion: "V3",
            snmpV3Username: "monitor",
            snmpV3SecurityLevel: SnmpSecurityLevel.NoAuthNoPriv,
          },
        ]),
      ).toBeNull();
    });

    /*
     * An unset security level is "unset", not "unrecognized" — the probe
     * applies its own default — so a v3 config with only a username saves.
     */
    it("accepts a v3 config with a username and no security level", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          { id: "x", snmpVersion: "V3", snmpV3Username: "monitor" },
        ]),
      ).toBeNull();
    });

    it("accepts authPriv with both keys supplied", () => {
      expect(
        SnmpScanConfigUtil.getValidationError([
          validAuthPrivConfig({
            snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
            snmpV3AuthKey: "auth-key-value",
            snmpV3PrivKey: "priv-key-value",
          }),
        ]),
      ).toBeNull();
    });
  });

  // A realistic mixed subnet: v2c access switches, a v3 core, factory printers.
  it("accepts the mixed list this feature exists to allow", () => {
    expect(
      SnmpScanConfigUtil.getValidationError([
        {
          id: "access",
          name: "Access switches",
          snmpVersion: "V2c",
          snmpCommunityString: "access-community",
          snmpPort: 161,
        },
        validAuthPrivConfig({ id: "core", name: "Core" }),
        {
          id: "printers",
          name: "Printers - factory default",
          snmpVersion: "V1",
        },
      ]),
    ).toBeNull();
  });
});

describe("SnmpScanConfigUtil.getPortValidationError", () => {
  it("accepts an absent or blank port, because the column has a default", () => {
    for (const raw of [undefined, null, "", "   "]) {
      expect(
        SnmpScanConfigUtil.getPortValidationError(raw, "SNMP config 1"),
      ).toBeNull();
    }
  });

  it("accepts the ends of the UDP range and the SNMP default", () => {
    for (const raw of [MINIMUM_SNMP_PORT, MAXIMUM_SNMP_PORT, 161, "161"]) {
      expect(
        SnmpScanConfigUtil.getPortValidationError(raw, "SNMP config 1"),
      ).toBeNull();
    }
  });

  it("refuses a value that is not a whole number", () => {
    expect(
      SnmpScanConfigUtil.getPortValidationError("161.5", "SNMP config 4"),
    ).toBe("SNMP config 4: the SNMP port must be a whole number.");
    expect(
      SnmpScanConfigUtil.getPortValidationError("abc", "SNMP config 4"),
    ).toBe("SNMP config 4: the SNMP port must be a whole number.");
  });

  it("refuses a value outside the UDP range", () => {
    expect(SnmpScanConfigUtil.getPortValidationError(0, "SNMP config 4")).toBe(
      "SNMP config 4: the SNMP port must be between 1 and 65535.",
    );
    expect(
      SnmpScanConfigUtil.getPortValidationError(65536, "SNMP config 4"),
    ).toBe("SNMP config 4: the SNMP port must be between 1 and 65535.");
  });

  // The caller owns the wording of the position, so it is echoed verbatim.
  it("prefixes the message with whatever position the caller named", () => {
    expect(
      SnmpScanConfigUtil.getPortValidationError(0, "The SNMP port"),
    ).toContain("The SNMP port: ");
  });
});

describe("SnmpScanConfigUtil.normalizeForStorage", () => {
  /*
   * Null for an absent list, which is what the column holds for a scan
   * configured the old way — so a write that never mentions `snmpConfigs`
   * leaves the row alone rather than materializing a list nobody asked for.
   */
  it("returns null for an empty or non-list value", () => {
    const values: Array<unknown> = [
      undefined,
      null,
      [],
      "",
      "not-a-list",
      0,
      42,
      true,
      { id: "an object is not a list" },
    ];

    for (const value of values) {
      expect(SnmpScanConfigUtil.normalizeForStorage(value)).toBeNull();
    }
  });

  /*
   * The index-derived id normalizeConfig falls back to is fine for READING a
   * row, but storing it would make the id positional: delete the first card
   * and every id below it now names a different credential set, re-pointing
   * results the probe has already stamped onto hosts.
   */
  it("mints a real unique id for every entry that arrived without one", () => {
    const configs: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([
        { name: "Core" },
        { name: "Access" },
        { id: "   ", name: "Printers" },
      ]);

    expect(configs).toHaveLength(3);

    const ids: Array<string> = configs!.map(
      (config: DiscoveryScanSnmpConfig): string => {
        return config.id as string;
      },
    );

    for (const id of ids) {
      expect(id).toMatch(UUID_PATTERN);
      // The positional form must never reach storage.
      expect(id).not.toMatch(POSITIONAL_ID_PATTERN);
    }

    expect(new Set<string>(ids).size).toBe(3);
  });

  /*
   * Two saves of the same list must not produce the same ids — that is what
   * makes the id an identity rather than a position, and it is why the
   * mint is a real ObjectID and not a hash of the contents.
   */
  it("mints different ids on two separate calls with the same input", () => {
    const first: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([{ name: "Core" }]);
    const second: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([{ name: "Core" }]);

    expect(first![0]!.id).not.toBe(second![0]!.id);
    expect(first![0]!.id).toMatch(UUID_PATTERN);
    expect(second![0]!.id).toMatch(UUID_PATTERN);
  });

  /*
   * An id the form already minted is kept verbatim, because the probe may
   * already have stamped it onto a discovered host.
   */
  it("preserves an id that was supplied, trimming it", () => {
    const configs: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([
        { id: "11111111-1111-4111-8111-111111111111", name: "Core" },
        { id: "  keep-me  ", name: "Access" },
      ]);

    expect(configs![0]!.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(configs![1]!.id).toBe("keep-me");
  });

  it("normalizes the same way resolve does: trims, drops blanks, fixes the version, drops a bad port", () => {
    const configs: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([
        {
          id: "x",
          name: "  Core switches  ",
          snmpVersion: "3",
          snmpCommunityString: "   ",
          snmpPort: "65536",
          snmpV3Username: "  monitor  ",
        },
      ]);

    expect(configs![0]).toEqual({
      id: "x",
      name: "Core switches",
      snmpVersion: "V3",
      snmpV3Username: "monitor",
    });
  });

  it("preserves the operator's order", () => {
    const configs: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([
        { id: "c" },
        { id: "a" },
        { id: "b" },
      ]);

    expect(
      configs!.map((config: DiscoveryScanSnmpConfig): string | undefined => {
        return config.id;
      }),
    ).toEqual(["c", "a", "b"]);
  });

  /*
   * Idempotence is what the service's sweep-value comparison rests on: a
   * no-op Save re-normalizes the stored list and compares it against itself,
   * and any drift there would retire a running scan for no reason. The first
   * pass mints the ids; every pass after that must change nothing.
   */
  it("is idempotent on its own output once the ids have been minted", () => {
    const once: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([
        { name: "  Core  ", snmpVersion: "v3", snmpV3Username: "monitor" },
        { id: "supplied", snmpVersion: "1", snmpPort: "161" },
      ]);

    const twice: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage(once);

    expect(twice).toEqual(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));

    const thrice: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage(twice);

    expect(thrice).toEqual(once);
  });

  /*
   * Two structurally-equal lists have to serialize identically, because the
   * service compares them as JSON to decide whether a save actually changed
   * the scan's sweep configuration.
   */
  it("produces identical JSON for two lists that differ only in whitespace and version spelling", () => {
    const first: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([
        { id: "x", name: "Core", snmpVersion: "V3", snmpV3Username: "monitor" },
      ]);
    const second: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([
        {
          id: "  x  ",
          name: "  Core  ",
          snmpVersion: "3",
          snmpV3Username: " monitor ",
        },
      ]);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  /*
   * Junk entries survive as minimal configs rather than being dropped, which
   * is safe only because getValidationError refuses them first — the service
   * validates before it normalizes. Pinned so that ordering stays a
   * deliberate choice rather than an accident.
   */
  it("turns an entry that is not an object into a minimal config, which validation refuses first", () => {
    expect(SnmpScanConfigUtil.getValidationError([null])).toBe(
      "SNMP config 1 is not valid.",
    );

    const configs: Array<DiscoveryScanSnmpConfig> | null =
      SnmpScanConfigUtil.normalizeForStorage([null]);

    expect(configs).toHaveLength(1);
    expect(configs![0]!.snmpVersion).toBe("V2c");
    expect(configs![0]!.id).toMatch(UUID_PATTERN);
  });
});

describe("SnmpScanConfigUtil.getMirroredLegacyColumns", () => {
  /*
   * The mirror is a compatibility guarantee, not redundancy. A probe is
   * deployed separately from the server and is routinely a version behind; a
   * probe that has never heard of `snmpConfigs` reads the flattened columns
   * and nothing else. Without the mirror, saving a multi-config scan would
   * blank the credentials of every older probe in the fleet.
   */
  it("always returns all nine flattened columns", () => {
    const inputs: Array<Array<DiscoveryScanSnmpConfig>> = [
      [],
      [{}],
      [{ id: "x", snmpVersion: "V3" }],
      [{ id: "x", snmpCommunityString: "public" }],
    ];

    for (const configs of inputs) {
      const mirrored: Record<string, string | number | null> =
        SnmpScanConfigUtil.getMirroredLegacyColumns(configs);

      expect(Object.keys(mirrored).sort()).toEqual(
        [...MIRRORED_COLUMN_KEYS].sort(),
      );
      expect(Object.keys(mirrored)).toHaveLength(9);
    }
  });

  /*
   * Null for "unset", never an omitted key: these values are also what the
   * probe-claim endpoint compares its optimistic-concurrency `expectedData`
   * against, and a key omitted for being empty would read as "unchanged"
   * instead of "cleared".
   */
  it("writes null, not undefined or an absent key, for every unset field", () => {
    const mirrored: Record<string, string | number | null> =
      SnmpScanConfigUtil.getMirroredLegacyColumns([{ id: "x" }]);

    expect(mirrored).toEqual({
      snmpVersion: "V2c",
      snmpCommunityString: null,
      snmpPort: null,
      snmpV3SecurityLevel: null,
      snmpV3Username: null,
      snmpV3AuthProtocol: null,
      snmpV3AuthKey: null,
      snmpV3PrivProtocol: null,
      snmpV3PrivKey: null,
    });

    for (const key of MIRRORED_COLUMN_KEYS) {
      expect(mirrored[key]).not.toBeUndefined();
    }
  });

  it("mirrors every field of a fully populated config", () => {
    const mirrored: Record<string, string | number | null> =
      SnmpScanConfigUtil.getMirroredLegacyColumns([
        {
          id: "x",
          name: "Core switches",
          snmpVersion: "V3",
          snmpCommunityString: "community-value",
          snmpPort: 1161,
          snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
          snmpV3Username: "monitor",
          snmpV3AuthProtocol: SnmpAuthProtocol.SHA256,
          snmpV3AuthKey: "auth-key-value",
          snmpV3PrivProtocol: SnmpPrivProtocol.AES256,
          snmpV3PrivKey: "priv-key-value",
        },
      ]);

    expect(mirrored).toEqual({
      snmpVersion: "V3",
      snmpCommunityString: "community-value",
      snmpPort: 1161,
      snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
      snmpV3Username: "monitor",
      snmpV3AuthProtocol: SnmpAuthProtocol.SHA256,
      snmpV3AuthKey: "auth-key-value",
      snmpV3PrivProtocol: SnmpPrivProtocol.AES256,
      snmpV3PrivKey: "priv-key-value",
    });

    // The operator's label is not a column; it must not leak into the mirror.
    expect(Object.keys(mirrored)).not.toContain("name");
    expect(Object.keys(mirrored)).not.toContain("id");
  });

  /*
   * The FIRST config specifically, because that is the one an older probe
   * would have been given under the old single-config UI, and because the
   * list is ordered by the operator's own preference.
   */
  it("takes every value from the first config and ignores the rest", () => {
    const mirrored: Record<string, string | number | null> =
      SnmpScanConfigUtil.getMirroredLegacyColumns([
        {
          id: "first",
          snmpVersion: "V2c",
          snmpCommunityString: "first-community",
          snmpPort: 161,
        },
        {
          id: "second",
          snmpVersion: "V3",
          snmpCommunityString: "second-community",
          snmpPort: 1161,
          snmpV3Username: "monitor",
          snmpV3AuthKey: "second-auth-key",
        },
      ]);

    expect(mirrored["snmpVersion"]).toBe("V2c");
    expect(mirrored["snmpCommunityString"]).toBe("first-community");
    expect(mirrored["snmpPort"]).toBe(161);
    // Nothing from the second config reaches the flattened columns.
    expect(mirrored["snmpV3Username"]).toBeNull();
    expect(mirrored["snmpV3AuthKey"]).toBeNull();
  });

  /*
   * The version column is read by older probes with SnmpVersionUtil.parse,
   * so it always has to hold a spelling that parses — never a raw "banana"
   * copied out of the list.
   */
  it("always mirrors a stored version spelling, whatever the config held", () => {
    const cases: Array<[string | undefined, string]> = [
      ["V1", "V1"],
      ["1", "V1"],
      ["v3", "V3"],
      ["3", "V3"],
      ["V2c", "V2c"],
      ["2c", "V2c"],
      ["banana", "V2c"],
      ["", "V2c"],
      [undefined, "V2c"],
    ];

    for (const [stored, expected] of cases) {
      expect(
        SnmpScanConfigUtil.getMirroredLegacyColumns([
          { id: "x", snmpVersion: stored },
        ])["snmpVersion"],
      ).toBe(expected);
    }
  });

  /*
   * An empty list should never reach here (validation refuses one), but the
   * mirror still has to produce a complete, storable set of columns rather
   * than throwing inside a write hook.
   */
  it("produces a complete set of columns for an empty list rather than throwing", () => {
    const mirrored: Record<string, string | number | null> =
      SnmpScanConfigUtil.getMirroredLegacyColumns([]);

    expect(mirrored["snmpVersion"]).toBe("V2c");
    expect(mirrored["snmpCommunityString"]).toBeNull();
    expect(mirrored["snmpPort"]).toBeNull();
  });

  /*
   * The round trip the service actually performs on every save: resolve the
   * stored list, mirror its first config onto the flattened columns, and a
   * probe reading only those columns gets the same credentials the first
   * config carries.
   */
  it("round-trips: mirroring a list then resolving the flattened columns yields the first config's credentials", () => {
    const configs: Array<DiscoveryScanSnmpConfig> = SnmpScanConfigUtil.resolve(
      scanWithConfigs([
        {
          id: "first",
          name: "Access switches",
          snmpVersion: "3",
          snmpCommunityString: "first-community",
          snmpPort: 1161,
          snmpV3Username: "monitor",
        },
        { id: "second", snmpCommunityString: "second-community" },
      ]),
    );

    const mirrored: Record<string, string | number | null> =
      SnmpScanConfigUtil.getMirroredLegacyColumns(configs);

    const olderProbeView: Array<DiscoveryScanSnmpConfig> =
      SnmpScanConfigUtil.resolve(mirrored as unknown as SnmpScanConfigSource);

    expect(olderProbeView).toHaveLength(1);
    expect(olderProbeView[0]!.id).toBe(LEGACY_SNMP_CONFIG_ID);
    expect(olderProbeView[0]!.snmpVersion).toBe("V3");
    expect(olderProbeView[0]!.snmpCommunityString).toBe("first-community");
    expect(olderProbeView[0]!.snmpPort).toBe(1161);
    expect(olderProbeView[0]!.snmpV3Username).toBe("monitor");
  });
});
