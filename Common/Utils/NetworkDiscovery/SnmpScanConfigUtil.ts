import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import SnmpAuthProtocol, {
  SnmpAuthProtocolUtil,
} from "../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol, {
  SnmpPrivProtocolUtil,
} from "../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpVersion, {
  SnmpVersionUtil,
} from "../../Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * The ordered list of SNMP credential sets a discovery scan tries.
 *
 * WHY IT EXISTS
 *
 * A scan used to carry exactly one credential set, in the flattened
 * snmpVersion / snmpCommunityString / snmpPort / snmpV3* columns on
 * NetworkDeviceDiscoveryScan, and the probe built one SNMP session config from
 * it and reused it for every address in the sweep. Real subnets are not shaped
 * that way: access switches on v2c with one community, the core on v3, a
 * vendor block on a community of its own, printers on the factory default.
 * Scanning such a segment took one scan per credential — separate schedules,
 * separate result sets, the same ping-only hosts offered for import in each of
 * them — or one scan that silently missed every device speaking a version it
 * was not configured for (OneUptime issue #3458).
 *
 * That last failure mode is the expensive one, because it is invisible: a
 * device that rejects the scan's community answers with an authentication
 * error, which the sweep counts but which still lands in the operator's lap as
 * "0 discovered".
 *
 * WHY IT LIVES IN Common
 *
 * Four layers need the same answer to "what credentials does this scan try,
 * and in what order?":
 *
 *   - the Dashboard create/edit form, which collects them,
 *   - the server write hooks, which validate and normalize them,
 *   - the probe, which sweeps with them,
 *   - the import path (manual review and the auto-import rule engine), which
 *     has to build each device with THE credential set that actually answered
 *     for that host.
 *
 * Answering it in one module is what keeps the form's error message identical
 * to the server's, and what makes it impossible for a host found with config
 * #4 to be imported carrying config #1's community string. Same reason
 * ScanTargetUtil and ScanNameUtil sit next door.
 */

/*
 * One credential set.
 *
 * The credential fields are named EXACTLY like the flattened columns they
 * generalize, so a legacy scan row satisfies this interface structurally and
 * `resolve()` below can hand back either shape without a translation table.
 * Common/Tests/Utils/NetworkDiscovery/SnmpScanConfigUtil.test.ts pins that
 * correspondence.
 */
export interface DiscoveryScanSnmpConfig {
  /*
   * Stable identity for this credential set within its scan, so a discovered
   * host can record WHICH config answered it (DiscoveredNetworkDevice
   * .snmpConfigId) and the import path can look the credentials back up.
   *
   * Not the array index: the operator can add, delete and reorder entries, and
   * an index would silently re-point a stored result at a different
   * credential. Minted by the form when a card is added and, for anything that
   * writes the column out of band (a direct API call), by the service's write
   * hooks — so a stored config always has one.
   */
  id?: string | undefined;
  /*
   * Optional operator label ("Core switches", "Printers - factory default").
   * A list of five credential sets is unreadable without one, and it is the
   * only thing that can be shown beside a discovered host to say how it was
   * found — the credentials themselves obviously cannot be.
   */
  name?: string | undefined;
  snmpVersion?: string | undefined;
  snmpCommunityString?: string | undefined;
  snmpPort?: number | undefined;
  snmpV3SecurityLevel?: string | undefined;
  snmpV3Username?: string | undefined;
  snmpV3AuthProtocol?: string | undefined;
  snmpV3AuthKey?: string | undefined;
  snmpV3PrivProtocol?: string | undefined;
  snmpV3PrivKey?: string | undefined;
}

/*
 * The parts of a scan row `resolve()` reads. Structural rather than the model
 * type, so a partially-selected row satisfies it — and so this module stays
 * importable from the Probe without dragging a database model behind it.
 */
export interface SnmpScanConfigSource {
  snmpConfigs?: Array<DiscoveryScanSnmpConfig> | null | undefined;
  snmpVersion?: string | null | undefined;
  snmpCommunityString?: string | null | undefined;
  snmpPort?: number | null | undefined;
  snmpV3SecurityLevel?: string | null | undefined;
  snmpV3Username?: string | null | undefined;
  snmpV3AuthProtocol?: string | null | undefined;
  snmpV3AuthKey?: string | null | undefined;
  snmpV3PrivProtocol?: string | null | undefined;
  snmpV3PrivKey?: string | null | undefined;
}

/*
 * The id given to the single config synthesized from a scan's flattened
 * columns — every scan created before `snmpConfigs` existed, and every scan
 * written by an API caller that only knows the old fields.
 *
 * A literal rather than a minted ObjectID because it has to be STABLE across
 * calls: the probe stamps it onto each discovered host, and the import path
 * looks it up again in a separately resolved list, in a different process,
 * possibly days later.
 */
export const LEGACY_SNMP_CONFIG_ID: string = "legacy";

/*
 * How many credential sets one scan may carry.
 *
 * This is a time budget, not a taste. The sweep tries configs in order and
 * stops at the first that answers, so a host that answers costs the same as it
 * always did — but a host that answers NOTHING costs one full SNMP timeout per
 * config. The probe abandons a sweep at PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS (90
 * minutes by default) and reports it Failed, so the ceiling has to keep the
 * worst case under that:
 *
 *   max hosts (4096) x configs x 2s timeout / 32 concurrent probes
 *
 * which is ~43 minutes at ten configs, against ~4 minutes at one. Ten is
 * therefore comfortably inside the deadline while being far more than any real
 * segment needs — three or four is the realistic shape of a mixed subnet.
 */
export const MAX_SNMP_CONFIGS_PER_SCAN: number = 10;

/*
 * Matches NetworkDeviceDiscoveryScan.name, which is a ShortText column, for
 * the same reason ScanNameUtil bounds that one: these names are rendered on a
 * single line in a card header and inlined into the probe's log messages. The
 * value itself lives inside a jsonb column with no length of its own, so
 * nothing downstream would reject an essay — which is exactly why it is
 * bounded here.
 */
export const MAX_SNMP_CONFIG_NAME_LENGTH: number = ColumnLength.ShortText;

// Matches the UDP port range; see validateSnmpPort in the Dashboard's form.
export const MINIMUM_SNMP_PORT: number = 1;
export const MAXIMUM_SNMP_PORT: number = 65535;

export class SnmpScanConfigUtil {
  /*
   * The credential sets this scan tries, in the order it tries them. NEVER
   * empty: a scan with no `snmpConfigs` is a scan configured the old way, and
   * its flattened columns ARE its one credential set.
   *
   * This is the single reader. The probe sweeps with what it returns, the
   * import path resolves a host's credentials out of it, and the form seeds
   * its editor from it — so "what does this scan actually try?" has exactly
   * one answer no matter who asks.
   */
  public static resolve(
    scan: SnmpScanConfigSource,
  ): Array<DiscoveryScanSnmpConfig> {
    const stored: Array<DiscoveryScanSnmpConfig> = Array.isArray(
      scan.snmpConfigs,
    )
      ? scan.snmpConfigs.filter((config: DiscoveryScanSnmpConfig): boolean => {
          return Boolean(config) && typeof config === "object";
        })
      : [];

    if (stored.length > 0) {
      return stored.map(
        (
          config: DiscoveryScanSnmpConfig,
          index: number,
        ): DiscoveryScanSnmpConfig => {
          return SnmpScanConfigUtil.normalizeConfig(config, index);
        },
      );
    }

    /*
     * The legacy shape. Read straight off the flattened columns rather than
     * migrated into the new column, deliberately: a data migration over every
     * historical scan buys nothing (this synthesizes the identical config on
     * every read) and would have to guess at rows whose columns are half
     * populated.
     */
    return [
      SnmpScanConfigUtil.normalizeConfig(
        {
          id: LEGACY_SNMP_CONFIG_ID,
          snmpVersion: scan.snmpVersion ?? undefined,
          snmpCommunityString: scan.snmpCommunityString ?? undefined,
          snmpPort: scan.snmpPort ?? undefined,
          snmpV3SecurityLevel: scan.snmpV3SecurityLevel ?? undefined,
          snmpV3Username: scan.snmpV3Username ?? undefined,
          snmpV3AuthProtocol: scan.snmpV3AuthProtocol ?? undefined,
          snmpV3AuthKey: scan.snmpV3AuthKey ?? undefined,
          snmpV3PrivProtocol: scan.snmpV3PrivProtocol ?? undefined,
          snmpV3PrivKey: scan.snmpV3PrivKey ?? undefined,
        },
        0,
      ),
    ];
  }

  /*
   * The stored list, when the value really is one, or null.
   *
   * The distinction matters at every WRITE site: "this row has its own
   * credential list" and "this row is described by its flattened columns" are
   * two different states, and a jsonb column can arrive holding neither shape
   * (a string, an object, an empty array) from an out-of-band writer. resolve()
   * papers over all of that for readers; this is the version writers need,
   * which answers the question honestly rather than synthesizing something.
   */
  public static readStoredList(
    value: unknown,
  ): Array<DiscoveryScanSnmpConfig> | null {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }

    const configs: Array<DiscoveryScanSnmpConfig> = value.filter(
      (config: unknown): boolean => {
        return Boolean(config) && typeof config === "object";
      },
    );

    return configs.length > 0 ? configs : null;
  }

  /*
   * The config that found a given host, or undefined when the host carries no
   * config id (every result stored before this feature) or names one that is
   * no longer in the list.
   *
   * Callers fall back to the FIRST config rather than to nothing — see
   * `resolveForHost` — because a device imported with the wrong credentials is
   * repairable on the device form, whereas a device imported with none can
   * never poll and gives the operator nothing to correct.
   */
  public static findById(
    configs: Array<DiscoveryScanSnmpConfig>,
    id: string | null | undefined,
  ): DiscoveryScanSnmpConfig | undefined {
    if (!id) {
      return undefined;
    }

    return configs.find((config: DiscoveryScanSnmpConfig): boolean => {
      return config.id === id;
    });
  }

  /*
   * The credentials to import a discovered host with: the config that actually
   * answered it, falling back to the first config in the list.
   *
   * The fallback is what makes results stored before this feature — and
   * ping-only hosts, which no config found — import exactly as they did
   * before, because for a legacy scan the first (and only) config IS the
   * flattened columns.
   */
  public static resolveForHost(
    scan: SnmpScanConfigSource,
    snmpConfigId: string | null | undefined,
  ): DiscoveryScanSnmpConfig {
    const configs: Array<DiscoveryScanSnmpConfig> =
      SnmpScanConfigUtil.resolve(scan);

    return SnmpScanConfigUtil.findById(configs, snmpConfigId) || configs[0]!;
  }

  /*
   * One config, cleaned up into the shape everything downstream expects:
   * trimmed strings, a numeric port, blanks dropped, and an id guaranteed.
   *
   * The `index` is only used to synthesize an id for a config that has none.
   * That is a repair for out-of-band writers, NOT the normal path — the form
   * mints an id per card and the service's write hooks mint one for anything
   * that arrives without. It is index-derived rather than random so that
   * resolving the same row twice yields the same ids, which matters because
   * this runs independently in the probe and in the importer.
   */
  private static normalizeConfig(
    config: DiscoveryScanSnmpConfig,
    index: number,
  ): DiscoveryScanSnmpConfig {
    const normalized: DiscoveryScanSnmpConfig = {
      id: SnmpScanConfigUtil.readString(config.id) || `config-${index + 1}`,
    };

    const name: string | undefined = SnmpScanConfigUtil.readString(config.name);
    if (name !== undefined) {
      normalized.name = name;
    }

    /*
     * Normalized to the stored spelling ("V1"/"V2c"/"V3") rather than left as
     * typed. SnmpVersionUtil.parse accepts either spelling and defaults to
     * V2c, so this both repairs a hand-written "3" and gives the version an
     * unambiguous value for the comparisons the service does on save.
     */
    normalized.snmpVersion = SnmpScanConfigUtil.toStoredVersion(
      config.snmpVersion,
    );

    const communityString: string | undefined = SnmpScanConfigUtil.readString(
      config.snmpCommunityString,
    );
    if (communityString !== undefined) {
      normalized.snmpCommunityString = communityString;
    }

    const port: number | undefined = SnmpScanConfigUtil.readPort(
      config.snmpPort,
    );
    if (port !== undefined) {
      normalized.snmpPort = port;
    }

    /*
     * The v3 block is carried verbatim (beyond trimming). It is NOT dropped
     * for a v1/v2c config, nor is the community dropped for a v3 one: an
     * operator who switches a card's version to try something and switches it
     * back must not silently lose the keys they had typed. The probe reads
     * only what the chosen version needs.
     */
    const v3Fields: Array<[keyof DiscoveryScanSnmpConfig, string | undefined]> =
      [
        ["snmpV3SecurityLevel", config.snmpV3SecurityLevel],
        ["snmpV3Username", config.snmpV3Username],
        ["snmpV3AuthProtocol", config.snmpV3AuthProtocol],
        ["snmpV3AuthKey", config.snmpV3AuthKey],
        ["snmpV3PrivProtocol", config.snmpV3PrivProtocol],
        ["snmpV3PrivKey", config.snmpV3PrivKey],
      ];

    for (const [key, rawValue] of v3Fields) {
      const value: string | undefined = SnmpScanConfigUtil.readString(rawValue);

      if (value !== undefined) {
        (normalized as Record<string, unknown>)[key as string] = value;
      }
    }

    return normalized;
  }

  /*
   * The stored spelling of a version ("V1" / "V2c" / "V3").
   *
   * Written as an explicit map off the parsed enum rather than by
   * upper-casing the input, so an unrecognized value lands on the same
   * default the probe would have used ("V2c") instead of being stored as
   * itself and disagreeing with the sweep.
   */
  public static toStoredVersion(value: string | null | undefined): string {
    if (SnmpVersionUtil.isV3(value)) {
      return "V3";
    }

    return SnmpVersionUtil.parse(value) === SnmpVersion.V1 ? "V1" : "V2c";
  }

  /*
   * A short, non-secret way to refer to one config in running text — a probe
   * log line, a validation message, the caption under a discovered host.
   *
   * NEVER includes a community string or a key. These strings reach places the
   * credential columns deliberately do not (the probe's log, the scan's
   * statusMessage, which is readable by a Viewer), so the label is built from
   * the operator's own name and the version alone.
   */
  public static getConfigLabel(
    config: DiscoveryScanSnmpConfig,
    index?: number | undefined,
  ): string {
    const name: string | undefined = SnmpScanConfigUtil.readString(config.name);
    const version: string = SnmpScanConfigUtil.toStoredVersion(
      config.snmpVersion,
    );

    if (name) {
      return `${name} (${version})`;
    }

    return index === undefined
      ? version
      : `SNMP config ${index + 1} (${version})`;
  }

  /*
   * The single validation entry point for the whole list, shared by the
   * Dashboard form and the server's create/update hooks — so the sentence the
   * operator reads on the form is the same sentence the API returns.
   *
   * Returns null when the value is storable, INCLUDING when it is absent: the
   * column is optional and a scan with no list is a scan configured through
   * the flattened columns.
   *
   * `value` is typed unknown for the same reason ScanTargetUtil's target is:
   * the server hook runs before the model's own type checks, so it is the
   * first thing to see whatever the client actually sent — which for a jsonb
   * column really can be a string, a number or an object.
   */
  public static getValidationError(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (!Array.isArray(value)) {
      return "SNMP configs must be a list.";
    }

    if (value.length === 0) {
      /*
       * An empty list is refused rather than quietly treated as "use the
       * flattened columns". The operator got here by deleting every card, and
       * silently falling back to a hidden credential set they can no longer
       * see is the kind of behaviour that produces a scan nobody can explain.
       */
      return "Add at least one SNMP config, or the scan has no credentials to try.";
    }

    if (value.length > MAX_SNMP_CONFIGS_PER_SCAN) {
      return (
        `A scan can try at most ${MAX_SNMP_CONFIGS_PER_SCAN} SNMP configs. ` +
        `This one has ${value.length}. Every extra config costs another SNMP ` +
        `timeout on each address that answers nothing, so a long list can push ` +
        `a large sweep past the probe's time limit. Split the range into more scans instead.`
      );
    }

    const seenIds: Set<string> = new Set<string>();

    for (let index: number = 0; index < value.length; index++) {
      const config: unknown = value[index];

      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return `SNMP config ${index + 1} is not valid.`;
      }

      const error: string | null = SnmpScanConfigUtil.getConfigValidationError(
        config as DiscoveryScanSnmpConfig,
        index,
      );

      if (error) {
        return error;
      }

      /*
       * Duplicate ids would make `findById` ambiguous, so a host found by the
       * second of two identically-identified configs could import with the
       * first one's credentials — the precise bug this whole id scheme exists
       * to prevent. Only reachable through an out-of-band write; the form
       * mints one id per card.
       */
      const id: string | undefined = SnmpScanConfigUtil.readString(
        (config as DiscoveryScanSnmpConfig).id,
      );

      if (id) {
        if (seenIds.has(id)) {
          return `Two SNMP configs share the id "${id}". Each config needs its own.`;
        }
        seenIds.add(id);
      }
    }

    return null;
  }

  /*
   * One config's rules. Split out so the message can name WHICH card is wrong
   * — with five credential sets on screen, "SNMP v3 Username is required" on
   * its own is not an actionable sentence.
   */
  private static getConfigValidationError(
    config: DiscoveryScanSnmpConfig,
    index: number,
  ): string | null {
    const position: string = `SNMP config ${index + 1}`;

    for (const [key, label] of [
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
    ] as Array<[keyof DiscoveryScanSnmpConfig, string]>) {
      const raw: unknown = config[key];

      if (raw !== undefined && raw !== null && typeof raw !== "string") {
        return `${position}: the ${label} must be text.`;
      }
    }

    const name: string | undefined = SnmpScanConfigUtil.readString(config.name);

    if (name !== undefined && name.length > MAX_SNMP_CONFIG_NAME_LENGTH) {
      return (
        `${position}: a name cannot be longer than ${MAX_SNMP_CONFIG_NAME_LENGTH} ` +
        `characters. This one is ${name.length}.`
      );
    }

    const portError: string | null = SnmpScanConfigUtil.getPortValidationError(
      config.snmpPort,
      position,
    );

    if (portError) {
      return portError;
    }

    if (!SnmpVersionUtil.isV3(config.snmpVersion)) {
      /*
       * v1/v2c. The community string is NOT required here even though the
       * device certainly needs one, because the probe falls back to "public"
       * — which is a real, and very common, answer for discovery. Requiring it
       * would refuse the single most useful default.
       */
      return null;
    }

    if (!SnmpScanConfigUtil.readString(config.snmpV3Username)) {
      return `${position}: SNMP v3 needs a username (the security name configured on the device).`;
    }

    if (SnmpSecurityLevelUtil.isUnrecognized(config.snmpV3SecurityLevel)) {
      return (
        `${position}: "${config.snmpV3SecurityLevel}" is not a recognized SNMP v3 security level. ` +
        `Expected one of: ${Object.values(SnmpSecurityLevel).join(", ")}.`
      );
    }

    if (SnmpAuthProtocolUtil.isUnrecognized(config.snmpV3AuthProtocol)) {
      return (
        `${position}: "${config.snmpV3AuthProtocol}" is not a recognized SNMP v3 authentication protocol. ` +
        `Expected one of: ${Object.values(SnmpAuthProtocol).join(", ")}.`
      );
    }

    if (SnmpPrivProtocolUtil.isUnrecognized(config.snmpV3PrivProtocol)) {
      return (
        `${position}: "${config.snmpV3PrivProtocol}" is not a recognized SNMP v3 privacy protocol. ` +
        `Expected one of: ${Object.values(SnmpPrivProtocol).join(", ")}.`
      );
    }

    const securityLevel: SnmpSecurityLevel | undefined =
      SnmpSecurityLevelUtil.parse(config.snmpV3SecurityLevel);

    /*
     * A level that asks for authentication with nothing to authenticate with
     * does not fail loudly — the session is simply rejected by every device,
     * host after host, and the scan reports zero. Caught here so it is a
     * sentence on the form instead.
     */
    const needsAuth: boolean =
      securityLevel === SnmpSecurityLevel.AuthNoPriv ||
      securityLevel === SnmpSecurityLevel.AuthPriv;

    if (needsAuth && !SnmpScanConfigUtil.readString(config.snmpV3AuthKey)) {
      return `${position}: the "${securityLevel}" security level needs an authentication key.`;
    }

    if (
      securityLevel === SnmpSecurityLevel.AuthPriv &&
      !SnmpScanConfigUtil.readString(config.snmpV3PrivKey)
    ) {
      return `${position}: the "${SnmpSecurityLevel.AuthPriv}" security level needs a privacy key.`;
    }

    return null;
  }

  /*
   * The port rule, in the same words the single-config form used before this
   * list existed (see validateSnmpPort in the Dashboard's SnmpConfigFormFields
   * — that one still guards the NetworkDevice forms).
   *
   * Checked against the RAW value: a Number form field posts its contents as
   * text, so "161.5" would parseInt to 161, clear both bounds, and then fail
   * the write against a port the probe cannot dial.
   */
  public static getPortValidationError(
    raw: unknown,
    position: string,
  ): string | null {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return null;
    }

    const port: number = Number(String(raw).trim());

    if (!isFinite(port) || !Number.isInteger(port)) {
      return `${position}: the SNMP port must be a whole number.`;
    }

    if (port < MINIMUM_SNMP_PORT || port > MAXIMUM_SNMP_PORT) {
      return `${position}: the SNMP port must be between ${MINIMUM_SNMP_PORT} and ${MAXIMUM_SNMP_PORT}.`;
    }

    return null;
  }

  /*
   * The list as it should be stored: validated by the caller, then normalized
   * and given ids.
   *
   * Returns null for an absent list, which is what the column holds for a scan
   * configured the old way — so a write that never mentions `snmpConfigs`
   * leaves it alone rather than materializing a list nobody asked for.
   */
  public static normalizeForStorage(
    value: unknown,
  ): Array<DiscoveryScanSnmpConfig> | null {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }

    return value.map(
      (config: unknown, index: number): DiscoveryScanSnmpConfig => {
        const normalized: DiscoveryScanSnmpConfig =
          SnmpScanConfigUtil.normalizeConfig(
            (config || {}) as DiscoveryScanSnmpConfig,
            index,
          );

        /*
         * Mint a real id for anything that arrived without one. The
         * index-derived id `normalizeConfig` falls back to is fine for READING
         * a row, but storing it would make the id positional — delete the
         * first card and every id below it now names a different credential
         * set, re-pointing results the probe has already stamped.
         */
        if (
          !SnmpScanConfigUtil.readString(
            (config as DiscoveryScanSnmpConfig | undefined)?.id,
          )
        ) {
          normalized.id = ObjectID.generate().toString();
        }

        return normalized;
      },
    );
  }

  /*
   * The flattened columns that should accompany a stored list, taken from its
   * FIRST config.
   *
   * This mirroring is a compatibility guarantee, not redundancy. A probe is
   * deployed separately from the server and is routinely a version behind; a
   * probe that has never heard of `snmpConfigs` reads the flattened columns
   * and nothing else. Without the mirror, saving a multi-config scan would
   * blank the credentials of every older probe in the fleet — the scan would
   * run with the column defaults (v2c/"public") and report a confident zero.
   *
   * The FIRST config specifically, because that is the one such a probe would
   * have been given under the old single-config UI, and because the list is
   * ordered by the operator's own preference.
   *
   * Every key is always present, with null for "unset": these values are also
   * what the probe-claim endpoint compares its optimistic-concurrency
   * `expectedData` against, and a key omitted for being empty would read as
   * "unchanged" instead of "cleared".
   */
  public static getMirroredLegacyColumns(
    configs: Array<DiscoveryScanSnmpConfig>,
  ): Record<string, string | number | null> {
    const first: DiscoveryScanSnmpConfig | undefined = configs[0];

    return {
      snmpVersion: SnmpScanConfigUtil.toStoredVersion(first?.snmpVersion),
      snmpCommunityString: first?.snmpCommunityString ?? null,
      snmpPort: first?.snmpPort ?? null,
      snmpV3SecurityLevel: first?.snmpV3SecurityLevel ?? null,
      snmpV3Username: first?.snmpV3Username ?? null,
      snmpV3AuthProtocol: first?.snmpV3AuthProtocol ?? null,
      snmpV3AuthKey: first?.snmpV3AuthKey ?? null,
      snmpV3PrivProtocol: first?.snmpV3PrivProtocol ?? null,
      snmpV3PrivKey: first?.snmpV3PrivKey ?? null,
    };
  }

  /*
   * A trimmed string, or undefined for anything that is not usable text.
   * Values arrive straight from request JSON, so "not a string" is a real
   * case rather than a defensive one.
   */
  private static readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed: string = value.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  /*
   * A usable port number, or undefined. Anything out of range is dropped
   * rather than clamped, so the column default (161) applies — callers that
   * want to REFUSE it call getPortValidationError first, exactly like
   * ScanNameUtil.normalize/getValidationError.
   */
  private static readPort(value: unknown): number | undefined {
    if (value === undefined || value === null || String(value).trim() === "") {
      return undefined;
    }

    const port: number = Number(String(value).trim());

    if (
      !isFinite(port) ||
      !Number.isInteger(port) ||
      port < MINIMUM_SNMP_PORT ||
      port > MAXIMUM_SNMP_PORT
    ) {
      return undefined;
    }

    return port;
  }
}

export default SnmpScanConfigUtil;
