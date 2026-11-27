import { IsBillingEnabled } from "../../EnvironmentConfig";
import ProbeService from "../../Services/ProbeService";
import CreateBy from "../../Types/Database/CreateBy";
import UpdateBy from "../../Types/Database/UpdateBy";
import RelationIdUtil from "../Database/RelationIdUtil";
import logger from "../Logger";
import Probe from "../../../Models/DatabaseModels/Probe";
import XcpNgConnection from "../../../Models/DatabaseModels/XcpNgConnection";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import XcpNgCollectionStatus from "../../../Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionType, {
  XcpNgConnectionTypeUtil,
} from "../../../Types/XcpNg/XcpNgConnectionType";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";
import XcpNgCollectionSettings, {
  MAX_XCP_NG_PASSWORD_LENGTH,
  MAX_XCP_NG_SECRET_LENGTH,
  MAX_XCP_NG_USERNAME_LENGTH,
  XcpNgSecretBinding,
} from "../../../Utils/XcpNg/XcpNgCollectionSettings";
import XcpNgConnectionAddress, {
  XcpNgAddressResult,
} from "../../../Utils/XcpNg/XcpNgConnectionAddress";

/*
 * The rules of an XCP-ng connection's settings, applied by
 * XcpNgConnectionService's create and update hooks - a vCenter's probe
 * collection rules (VMwareVCenterConnection), rule for rule:
 *
 *   - the address is normalized (XcpNgConnectionAddress) and the name made
 *     from it when none was typed;
 *   - a Xen Orchestra connection has its OpenMetrics plugin's secret (and
 *     may have an API token); an XAPI connection has a user name and a
 *     password; each takes only its own secrets;
 *   - the probe is one that may read it (XcpNgCollectionSettings.
 *     getProbeRefusal: the project's own, or the instance's own on a
 *     self-hosted install);
 *   - the secrets are write-only and bound to where they were entered for:
 *     an update that keeps them may not change the address, the probe, or
 *     trust a different certificate (getSecretRebindRefusal) - except
 *     trusting the very certificate the probe found at the saved address,
 *     which is what "Trust this certificate" on a failed read does. A saved
 *     API token that is not entered again when its binding moves is
 *     forgotten, not sent somewhere new.
 *
 * What only the server writes - whether each secret is saved, when the
 * credentials changed, that the probe should read with the new settings
 * now - is written after the save, as OneUptime (afterWrite).
 */

// The settings a person writes to set up a connection.
export const XCP_NG_CONNECTION_SETTING_COLUMNS: Array<string> = [
  "connectionType",
  "address",
  "openMetricsSecret",
  "apiToken",
  "username",
  "password",
  "collectionProbeId",
  "collectionProbe",
  "trustedCertificateFingerprint",
  "collectionIntervalInMinutes",
];

const PROBE_KEYS: Array<string> = ["collectionProbeId", "collectionProbe"];

/*
 * What a create or an update decided for one connection, handed from the
 * before-hook to afterWrite.
 */
export interface XcpNgConnectionChange {
  xcpNgConnectionId: ObjectID | null;
  projectId: ObjectID | null;
  // The settings changed in a way the probe must try again (status -> Pending).
  isConnectionChanged: boolean;
  // A secret, the token or the account changed.
  isCredentialChanged: boolean;
  // Whether each secret is saved after the write; null when unchanged.
  isOpenMetricsSecretSet: boolean | null;
  isApiTokenSet: boolean | null;
  isPasswordSet: boolean | null;
  // The address moved: what was learned of the old one is forgotten.
  isAddressChanged: boolean;
}

// The saved row an update is checked against.
export interface SavedXcpNgConnection {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
  connectionType?: XcpNgConnectionType | undefined;
  address?: string | undefined;
  username?: string | undefined;
  isOpenMetricsSecretSet?: boolean | undefined;
  isApiTokenSet?: boolean | undefined;
  isPasswordSet?: boolean | undefined;
  collectionProbeId?: ObjectID | undefined;
  trustedCertificateFingerprint?: string | undefined;
  presentedCertificate?: { fingerprint256?: string | undefined } | undefined;
}

export const XCP_NG_CONNECTION_SAVED_SELECT: Record<string, true> = {
  _id: true,
  projectId: true,
  connectionType: true,
  address: true,
  username: true,
  isOpenMetricsSecretSet: true,
  isApiTokenSet: true,
  isPasswordSet: true,
  collectionProbeId: true,
  trustedCertificateFingerprint: true,
  presentedCertificate: true,
};

type DataRecord = Record<string, unknown>;

function isGiven(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

// What a person calls the secret a connection of this type needs.
export function getRequiredSecretName(type: XcpNgConnectionType): string {
  return type === XcpNgConnectionType.Xapi
    ? "the XAPI password"
    : "the OpenMetrics secret";
}

export default class XcpNgConnectionRules {
  // Whether a write sets any of the connection's settings.
  public static isConnectionWrite(data: DataRecord | undefined): boolean {
    if (!data) {
      return false;
    }

    return XCP_NG_CONNECTION_SETTING_COLUMNS.some((column: string): boolean => {
      return data[column] !== undefined;
    });
  }

  /*
   * Check and normalize a new connection in place, and say what afterWrite
   * has to do once it is saved.
   */
  public static async prepareCreate(
    createBy: CreateBy<XcpNgConnection>,
  ): Promise<XcpNgConnectionChange> {
    const data: DataRecord = createBy.data as unknown as DataRecord;

    const type: unknown = data["connectionType"];

    if (!XcpNgConnectionTypeUtil.isValid(type)) {
      throw new BadDataException(
        `Say what the connection reads: connectionType is one of ${XcpNgConnectionTypeUtil.getAll().join(", ")}.`,
      );
    }

    XcpNgConnectionRules.normalizeOptionalSettings(data, type);

    if (!data["address"]) {
      throw new BadDataException(
        XcpNgConnectionAddress.normalize("", type).error ||
          "Enter the address.",
      );
    }

    XcpNgConnectionRules.requireSecrets(data, type, {
      hasSavedRequiredSecret: false,
      savedUsername: null,
    });

    const projectId: ObjectID | null =
      (createBy.data.projectId as ObjectID | undefined) ||
      createBy.props.tenantId ||
      null;

    if (!projectId) {
      throw new BadDataException("The connection's project is missing.");
    }

    const probeId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      PROBE_KEYS,
      "Collection Probe",
    );

    if (!probeId) {
      throw new BadDataException(
        "Pick the probe that reads this connection: one in a network that reaches it on its HTTPS port.",
      );
    }

    await XcpNgConnectionRules.assertProbeCanCollect({
      probeId: probeId,
      projectId: projectId,
    });

    // A connection nobody named is named after its address.
    const name: unknown = data["name"];

    if (typeof name !== "string" || !name.trim()) {
      data["name"] = XcpNgConnectionAddress.getDefaultName(
        data["address"] as string,
        type,
      );
    }

    return {
      xcpNgConnectionId: null,
      projectId: projectId,
      isConnectionChanged: true,
      isCredentialChanged: true,
      isOpenMetricsSecretSet:
        type === XcpNgConnectionType.XenOrchestra &&
        isGiven(data["openMetricsSecret"]),
      isApiTokenSet:
        type === XcpNgConnectionType.XenOrchestra && isGiven(data["apiToken"]),
      isPasswordSet:
        type === XcpNgConnectionType.Xapi && isGiven(data["password"]),
      isAddressChanged: true,
    };
  }

  /*
   * Check and normalize an update in place, against the saved row, and say
   * what afterWrite has to do. Empty for an update that names no setting.
   */
  public static async prepareUpdate(data: {
    updateBy: UpdateBy<XcpNgConnection>;
    saved: Array<SavedXcpNgConnection>;
  }): Promise<Array<XcpNgConnectionChange>> {
    const update: DataRecord = data.updateBy.data as unknown as DataRecord;

    if (!XcpNgConnectionRules.isConnectionWrite(update)) {
      return [];
    }

    if (data.saved.length === 0) {
      return [];
    }

    if (data.saved.length > 1) {
      throw new BadDataException(
        "Change the settings of one XCP-ng connection at a time.",
      );
    }

    const saved: SavedXcpNgConnection = data.saved[0]!;
    const type: XcpNgConnectionType = XcpNgConnectionTypeUtil.isValid(
      saved.connectionType,
    )
      ? saved.connectionType
      : XcpNgConnectionType.XenOrchestra;

    if (
      update["connectionType"] !== undefined &&
      update["connectionType"] !== type
    ) {
      throw new BadDataException(
        "A connection reads what it was made for. To read the pools another way, connect them again and remove this connection.",
      );
    }

    delete update["connectionType"];

    XcpNgConnectionRules.normalizeOptionalSettings(update, type);

    /*
     * An empty secret in an update is "keep the saved one" - the edit form
     * sends its empty field - never "clear it". Only the API token, which a
     * connection may go without, is cleared, by sending null.
     */
    const isOpenMetricsSecretGiven: boolean = isGiven(
      update["openMetricsSecret"],
    );
    const isApiTokenGiven: boolean = isGiven(update["apiToken"]);
    const isApiTokenCleared: boolean = update["apiToken"] === null;
    const isPasswordGiven: boolean = isGiven(update["password"]);

    for (const [column, given] of [
      ["openMetricsSecret", isOpenMetricsSecretGiven],
      ["password", isPasswordGiven],
    ] as Array<[string, boolean]>) {
      if (!given) {
        delete update[column];
      }
    }

    if (!isApiTokenGiven && !isApiTokenCleared) {
      delete update["apiToken"];
    }

    const projectId: ObjectID | null =
      saved.projectId || data.updateBy.props.tenantId || null;

    if (!projectId) {
      throw new BadDataException("The connection's project is missing.");
    }

    const next: DataRecord = {
      address:
        update["address"] !== undefined ? update["address"] : saved.address,
      username:
        update["username"] !== undefined ? update["username"] : saved.username,
      openMetricsSecret: isOpenMetricsSecretGiven
        ? update["openMetricsSecret"]
        : undefined,
      apiToken: isApiTokenGiven ? update["apiToken"] : undefined,
      password: isPasswordGiven ? update["password"] : undefined,
      collectionProbeId: RelationIdUtil.isPresent(update, PROBE_KEYS)
        ? RelationIdUtil.readIntoIdColumn(
            update,
            PROBE_KEYS,
            "Collection Probe",
          )
        : saved.collectionProbeId,
      trustedCertificateFingerprint:
        update["trustedCertificateFingerprint"] !== undefined
          ? update["trustedCertificateFingerprint"]
          : saved.trustedCertificateFingerprint,
    };

    if (!next["address"]) {
      throw new BadDataException(
        XcpNgConnectionAddress.normalize("", type).error ||
          "Enter the address.",
      );
    }

    const hasSavedRequiredSecret: boolean =
      type === XcpNgConnectionType.Xapi
        ? saved.isPasswordSet === true
        : saved.isOpenMetricsSecretSet === true;

    XcpNgConnectionRules.requireSecrets(next, type, {
      hasSavedRequiredSecret: hasSavedRequiredSecret,
      savedUsername: saved.username || null,
    });

    const nextProbeId: ObjectID | null =
      (next["collectionProbeId"] as ObjectID | null | undefined) || null;

    if (!nextProbeId) {
      throw new BadDataException(
        "Pick the probe that reads this connection: one in a network that reaches it on its HTTPS port.",
      );
    }

    await XcpNgConnectionRules.assertProbeCanCollect({
      probeId: nextProbeId,
      projectId: projectId,
    });

    const savedBinding: XcpNgSecretBinding = XcpNgConnectionRules.getBinding({
      address: saved.address,
      type: type,
      probeId: saved.collectionProbeId,
      trustedCertificateFingerprint: saved.trustedCertificateFingerprint,
    });

    const nextBinding: XcpNgSecretBinding = XcpNgConnectionRules.getBinding({
      address: next["address"] as string,
      type: type,
      probeId: nextProbeId,
      trustedCertificateFingerprint: next["trustedCertificateFingerprint"] as
        | string
        | null
        | undefined,
    });

    const isRequiredSecretGiven: boolean =
      type === XcpNgConnectionType.Xapi
        ? isPasswordGiven
        : isOpenMetricsSecretGiven;

    const isBindingKept: boolean =
      XcpNgCollectionSettings.isSameBinding(savedBinding, nextBinding) ||
      XcpNgConnectionRules.isOnlyTrustingWhatWasPresented({
        saved: savedBinding,
        next: nextBinding,
        presentedFingerprint: saved.presentedCertificate?.fingerprint256,
      });

    if (!isRequiredSecretGiven && !isBindingKept) {
      const refusal: string | null = XcpNgConnectionRules.getRebindRefusal({
        saved: savedBinding,
        next: nextBinding,
        presentedFingerprint: saved.presentedCertificate?.fingerprint256,
        secretName: getRequiredSecretName(type),
      });

      if (refusal) {
        throw new BadDataException(refusal);
      }
    }

    const change: XcpNgConnectionChange = {
      xcpNgConnectionId: saved._id ? new ObjectID(saved._id.toString()) : null,
      projectId: projectId,
      isConnectionChanged: false,
      isCredentialChanged: false,
      isOpenMetricsSecretSet: isOpenMetricsSecretGiven ? true : null,
      isApiTokenSet: isApiTokenGiven ? true : isApiTokenCleared ? false : null,
      isPasswordSet: isPasswordGiven ? true : null,
      isAddressChanged: savedBinding.endpointKey !== nextBinding.endpointKey,
    };

    /*
     * A saved API token goes only where it was entered for: a binding that
     * moves forgets it, unless it was entered again.
     */
    if (
      !isBindingKept &&
      saved.isApiTokenSet === true &&
      !isApiTokenGiven &&
      !isApiTokenCleared
    ) {
      update["apiToken"] = null;
      change.isApiTokenSet = false;
    }

    const isUsernameChanged: boolean =
      update["username"] !== undefined &&
      (update["username"] || null) !== (saved.username || null);

    change.isCredentialChanged =
      isOpenMetricsSecretGiven ||
      isApiTokenGiven ||
      isApiTokenCleared ||
      isPasswordGiven ||
      isUsernameChanged ||
      change.isApiTokenSet === false;

    change.isConnectionChanged =
      !XcpNgCollectionSettings.isSameBinding(savedBinding, nextBinding) ||
      change.isCredentialChanged;

    return [change];
  }

  /*
   * Once the write is saved: the columns only the server writes. As
   * OneUptime - the person's own write already went through their
   * permission checks, and these columns are nobody's to write.
   */
  public static async afterWrite(data: {
    change: XcpNgConnectionChange;
    writeServerColumns: (write: {
      xcpNgConnectionId: ObjectID;
      values: DataRecord;
      bumpSettingsVersion: boolean;
    }) => Promise<void>;
  }): Promise<void> {
    const change: XcpNgConnectionChange = data.change;

    if (!change.xcpNgConnectionId) {
      return;
    }

    const values: DataRecord = {};

    if (change.isOpenMetricsSecretSet !== null) {
      values["isOpenMetricsSecretSet"] = change.isOpenMetricsSecretSet;
    }

    if (change.isApiTokenSet !== null) {
      values["isApiTokenSet"] = change.isApiTokenSet;
      // A new token's expiry, or none's, is read again.
      values["apiTokenExpiresAt"] = null;
      values["apiTokenExpiryWarnedAt"] = null;
    }

    if (change.isPasswordSet !== null) {
      values["isPasswordSet"] = change.isPasswordSet;
    }

    if (change.isCredentialChanged) {
      values["credentialsUpdatedAt"] = OneUptimeDate.getCurrentDate();
    }

    if (change.isAddressChanged) {
      /*
       * Another address may be another pool: what was learned of the old
       * one - its hosts and their certificates, its master, where reading
       * its messages stood - is not carried over.
       */
      values["xapiPoolId"] = null;
      values["xapiMasterAddress"] = null;
      values["xapiPoolHosts"] = null;
      values["messageWatermark"] = null;
      values["xapiAccountKind"] = null;
    }

    if (change.isConnectionChanged) {
      values["collectionStatus"] = XcpNgCollectionStatus.Pending;
      values["collectionErrorCode"] = null;
      values["collectionError"] = null;
      values["presentedCertificate"] = null;
      // Read with the new settings at once, not an interval from now.
      values["nextCollectionAt"] = OneUptimeDate.getCurrentDate();
    }

    try {
      if (Object.keys(values).length > 0 || change.isConnectionChanged) {
        await data.writeServerColumns({
          xcpNgConnectionId: change.xcpNgConnectionId,
          values: values,
          bumpSettingsVersion: change.isConnectionChanged,
        });
      }
    } catch (error) {
      logger.error(
        `Could not record the settings of XCP-ng connection ${change.xcpNgConnectionId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /*
   * Refuse a probe that may not read a connection of this project. An id of
   * another project's probe gets the answer an id that matches nothing gets.
   */
  public static async assertProbeCanCollect(data: {
    probeId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const probe: Probe | null = await ProbeService.findOneById({
      id: data.probeId,
      select: {
        _id: true,
        projectId: true,
        isGlobalProbe: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!probe) {
      throw new BadDataException(
        "Probe not found. Pick one of this project's probes.",
      );
    }

    const refusal: string | null = XcpNgCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe: probe.isGlobalProbe,
        projectId: probe.projectId?.toString() || null,
      },
      projectId: data.projectId.toString(),
      isBillingEnabled: IsBillingEnabled,
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }

  /*
   * "Trust this certificate": trusting exactly the certificate the probe
   * found at the saved address, through the saved probe, keeps the secrets
   * - that certificate is not one an editor chose.
   */
  public static isOnlyTrustingWhatWasPresented(data: {
    saved: XcpNgSecretBinding;
    next: XcpNgSecretBinding;
    presentedFingerprint?: string | null | undefined;
  }): boolean {
    return (
      data.saved.endpointKey === data.next.endpointKey &&
      data.saved.probeId === data.next.probeId &&
      data.next.trustedCertificateFingerprint !== null &&
      VMwareCertificateFingerprint.areEqual(
        data.next.trustedCertificateFingerprint,
        data.presentedFingerprint,
      )
    );
  }

  // The rebind rule, with the one exception "Trust this certificate" needs.
  public static getRebindRefusal(data: {
    saved: XcpNgSecretBinding;
    next: XcpNgSecretBinding;
    presentedFingerprint?: string | null | undefined;
    secretName: string;
  }): string | null {
    if (XcpNgConnectionRules.isOnlyTrustingWhatWasPresented(data)) {
      return null;
    }

    return XcpNgCollectionSettings.getSecretRebindRefusal({
      saved: data.saved,
      next: data.next,
      secretName: data.secretName,
    });
  }

  public static getBinding(data: {
    address: string | null | undefined;
    type: XcpNgConnectionType;
    probeId: ObjectID | string | null | undefined;
    trustedCertificateFingerprint: string | null | undefined;
  }): XcpNgSecretBinding {
    return {
      endpointKey: XcpNgConnectionAddress.getEndpointKey(
        data.address,
        data.type,
      ),
      probeId: data.probeId ? data.probeId.toString().toLowerCase() : null,
      trustedCertificateFingerprint: VMwareCertificateFingerprint.normalize(
        data.trustedCertificateFingerprint,
      ),
    };
  }

  /*
   * Normalize what the write sets of the address, the account, the secrets'
   * lengths, the fingerprint and the interval, refusing what cannot be
   * normalized. Settings the write leaves out are left alone.
   */
  private static normalizeOptionalSettings(
    data: DataRecord,
    type: XcpNgConnectionType,
  ): void {
    if (data["address"] !== undefined && data["address"] !== null) {
      const result: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
        String(data["address"]),
        type,
      );

      if (!result.address) {
        throw new BadDataException(result.error);
      }

      data["address"] = result.address.url;
    }

    if (data["username"] !== undefined && data["username"] !== null) {
      const username: string = String(data["username"]).trim();

      if (username.length > MAX_XCP_NG_USERNAME_LENGTH) {
        throw new BadDataException(
          `The XAPI user name may be at most ${MAX_XCP_NG_USERNAME_LENGTH} characters.`,
        );
      }

      data["username"] = username || null;
    }

    for (const [column, max, what] of [
      ["openMetricsSecret", MAX_XCP_NG_SECRET_LENGTH, "OpenMetrics secret"],
      ["apiToken", MAX_XCP_NG_SECRET_LENGTH, "API token"],
      ["password", MAX_XCP_NG_PASSWORD_LENGTH, "XAPI password"],
    ] as Array<[string, number, string]>) {
      const value: unknown = data[column];

      if (typeof value === "string" && value.length > max) {
        throw new BadDataException(
          `The ${what} may be at most ${max} characters.`,
        );
      }

      // Pasted with a stray newline or space: never part of a secret here.
      if (typeof value === "string" && column !== "password") {
        data[column] = value.trim();
      }
    }

    if (data["trustedCertificateFingerprint"] !== undefined) {
      const raw: unknown = data["trustedCertificateFingerprint"];

      if (raw === null || (typeof raw === "string" && !raw.trim())) {
        data["trustedCertificateFingerprint"] = null;
      } else {
        const fingerprint: string | null =
          VMwareCertificateFingerprint.normalize(String(raw));

        if (!fingerprint) {
          throw new BadDataException(
            "The trusted certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
          );
        }

        data["trustedCertificateFingerprint"] = fingerprint;
      }
    }

    if (data["collectionIntervalInMinutes"] !== undefined) {
      const interval: unknown = data["collectionIntervalInMinutes"];
      const refusal: string | null = XcpNgCollectionSettings.getIntervalRefusal(
        typeof interval === "string" ? Number(interval) : interval,
      );

      if (refusal) {
        throw new BadDataException(refusal);
      }

      data["collectionIntervalInMinutes"] = Number(interval);
    }
  }

  /*
   * A Xen Orchestra connection needs the plugin's secret (a new one, or the
   * one saved) and takes no XAPI account; an XAPI connection needs a user
   * name and a password and takes none of Xen Orchestra's secrets.
   */
  private static requireSecrets(
    data: DataRecord,
    type: XcpNgConnectionType,
    options: { hasSavedRequiredSecret: boolean; savedUsername: string | null },
  ): void {
    if (type === XcpNgConnectionType.XenOrchestra) {
      if (isGiven(data["password"]) || isGiven(data["username"])) {
        throw new BadDataException(
          "A Xen Orchestra connection takes no XAPI account: leave the user name and password out.",
        );
      }

      if (
        !isGiven(data["openMetricsSecret"]) &&
        !options.hasSavedRequiredSecret
      ) {
        throw new BadDataException(
          "Enter the OpenMetrics plugin's secret, from Settings, then Plugins, then openmetrics in Xen Orchestra.",
        );
      }

      return;
    }

    if (isGiven(data["openMetricsSecret"]) || isGiven(data["apiToken"])) {
      throw new BadDataException(
        "An XAPI connection takes no Xen Orchestra secret: leave the OpenMetrics secret and the API token out.",
      );
    }

    if (!data["username"] && !options.savedUsername) {
      throw new BadDataException(
        "Enter the XAPI user name: root, or an Active Directory user with the read-only role.",
      );
    }

    if (!isGiven(data["password"]) && !options.hasSavedRequiredSecret) {
      throw new BadDataException("Enter the XAPI password.");
    }
  }
}
