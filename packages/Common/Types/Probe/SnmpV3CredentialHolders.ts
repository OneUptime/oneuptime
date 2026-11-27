import ObjectID from "../ObjectID";

/*
 * WHO HOLDS AN SNMPv3 CREDENTIAL A PROBE IS HANDED (OneUptime issues #11172,
 * #11174).
 *
 * A probe's trap receiver takes an SNMPv3 trap only when it is signed with
 * a credential OneUptime handed it (Types/Probe/SnmpTrapReceiver), and the
 * credential says more than the address the trap came from: it belongs to
 * certain records. OneUptime hands each credential over with the records
 * that hold it, the probe keeps them beside the user without reading them,
 * and sends back those of the credential a trap was authenticated with
 * (SnmpTrap.signedBy). That is how OneUptime knows:
 *
 *   - which projects the trap may be kept in: one whose devices or sites
 *     hold the credential, and never another (projectIds);
 *   - which of the devices that share the trap's address sent it: the ones
 *     that carry that credential - their own, their credential profile's or
 *     their site's default (deviceIds);
 *   - which site a device that is not added yet belongs to: the site whose
 *     default credential profile signed its trap (siteIds).
 *
 * IDs only, never a secret. Each list is left out whole, never cut short,
 * when it would be longer than its limit: a list cut short would tell a
 * device that carries the credential from one that does not wrongly. Left
 * out means "not known", and OneUptime then matches by address alone, as it
 * did before probes sent this.
 *
 * Only an authenticated trap is sent back with them: a noAuthNoPriv trap
 * carries no key, so anyone can send one as any user name, and its user
 * name proves nothing about whose it is.
 */
export interface SnmpV3CredentialHolders {
  // The projects whose devices or sites hold the credential. Never empty.
  projectIds: Array<string>;
  // The devices that carry it, while there are at most MAX_..._DEVICES.
  deviceIds?: Array<string> | undefined;
  /*
   * The sites whose default credential profile it is, and whose default
   * probe is the probe it was handed to, while there are at most MAX_..._SITES.
   */
  siteIds?: Array<string> | undefined;
}

/*
 * The longest each list may be. A credential held by more devices than
 * this is one that devices of a whole site or fleet share: it cannot tell
 * them apart anyway, so it is sent with no device list rather than a long
 * one every thirty seconds.
 */
export const MAX_SNMP_V3_CREDENTIAL_HOLDER_PROJECTS: number = 1000;
export const MAX_SNMP_V3_CREDENTIAL_HOLDER_DEVICES: number = 256;
export const MAX_SNMP_V3_CREDENTIAL_HOLDER_SITES: number = 64;

export default class SnmpV3CredentialHolderUtil {
  /*
   * Holders as a probe or a server takes them from the wire: IDs only, each
   * once, in lower case, each list no longer than its limit or left out.
   * Null when they name no project, or more projects than the limit: then
   * nothing about the credential is known, and nothing is narrowed by it.
   */
  public static sanitize(value: unknown): SnmpV3CredentialHolders | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    const projectIds: Array<string> | undefined = SnmpV3CredentialHolderUtil.readIds(
      record["projectIds"],
      MAX_SNMP_V3_CREDENTIAL_HOLDER_PROJECTS,
    );

    if (!projectIds || projectIds.length === 0) {
      return null;
    }

    const holders: SnmpV3CredentialHolders = { projectIds: projectIds };

    const deviceIds: Array<string> | undefined =
      SnmpV3CredentialHolderUtil.readIds(
        record["deviceIds"],
        MAX_SNMP_V3_CREDENTIAL_HOLDER_DEVICES,
      );

    if (deviceIds) {
      holders.deviceIds = deviceIds;
    }

    const siteIds: Array<string> | undefined =
      SnmpV3CredentialHolderUtil.readIds(
        record["siteIds"],
        MAX_SNMP_V3_CREDENTIAL_HOLDER_SITES,
      );

    if (siteIds) {
      holders.siteIds = siteIds;
    }

    return holders;
  }

  /*
   * One credential held by two sets of records - two devices with the same
   * user and keys, or a device and a site's default - is held by both. A
   * list either side does not know is not known; one that grows past its
   * limit is left out. Null when the projects grow past theirs.
   */
  public static merge(
    a: SnmpV3CredentialHolders,
    b: SnmpV3CredentialHolders,
  ): SnmpV3CredentialHolders | null {
    const projectIds: Array<string> | undefined =
      SnmpV3CredentialHolderUtil.union(
        a.projectIds,
        b.projectIds,
        MAX_SNMP_V3_CREDENTIAL_HOLDER_PROJECTS,
      );

    if (!projectIds || projectIds.length === 0) {
      return null;
    }

    const merged: SnmpV3CredentialHolders = { projectIds: projectIds };

    const deviceIds: Array<string> | undefined =
      SnmpV3CredentialHolderUtil.union(
        a.deviceIds,
        b.deviceIds,
        MAX_SNMP_V3_CREDENTIAL_HOLDER_DEVICES,
      );

    if (deviceIds) {
      merged.deviceIds = deviceIds;
    }

    const siteIds: Array<string> | undefined = SnmpV3CredentialHolderUtil.union(
      a.siteIds,
      b.siteIds,
      MAX_SNMP_V3_CREDENTIAL_HOLDER_SITES,
    );

    if (siteIds) {
      merged.siteIds = siteIds;
    }

    return merged;
  }

  // Whether the credential is a project's: one of its devices or sites holds it.
  public static isHeldByProject(
    holders: SnmpV3CredentialHolders,
    projectId: string,
  ): boolean {
    return holders.projectIds.includes(projectId.toLowerCase());
  }

  /*
   * IDs as one list: each a UUID, in lower case, each once. Undefined when
   * the value is not a list, holds anything that is not an ID, or is longer
   * than `limit`: a list that cannot be read whole is not known.
   */
  private static readIds(
    value: unknown,
    limit: number,
  ): Array<string> | undefined {
    if (!Array.isArray(value) || value.length > limit) {
      return undefined;
    }

    const ids: Array<string> = [];

    for (const entry of value) {
      if (typeof entry !== "string" || !ObjectID.isValidUUID(entry.trim())) {
        return undefined;
      }

      const id: string = entry.trim().toLowerCase();

      if (!ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  private static union(
    a: Array<string> | undefined,
    b: Array<string> | undefined,
    limit: number,
  ): Array<string> | undefined {
    if (!a || !b) {
      return undefined;
    }

    const ids: Array<string> = [...a];
    const seen: Set<string> = new Set(a);

    for (const id of b) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }

    return ids.length > limit ? undefined : ids;
  }
}
