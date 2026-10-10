import { IsBillingEnabled } from "../../EnvironmentConfig";
import ProbeService from "../../Services/ProbeService";
import VMwareVCenterFeedService from "../../Services/VMwareVCenterFeedService";
import CreateBy from "../../Types/Database/CreateBy";
import UpdateBy from "../../Types/Database/UpdateBy";
import RelationIdUtil from "../Database/RelationIdUtil";
import logger from "../Logger";
import Probe from "../../../Models/DatabaseModels/Probe";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import { VMwareVCenterFeedEventType } from "../../../Models/DatabaseModels/VMwareVCenterFeed";
import { Blue500, Gray500, Yellow500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import VMwareCollectionMethod, {
  VMwareCollectionMethodUtil,
} from "../../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "../../../Types/VMware/VMwareCollectionStatus";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";
import VMwareCollectionSettings, {
  MAX_VMWARE_PASSWORD_LENGTH,
  MAX_VMWARE_USERNAME_LENGTH,
  VMwarePasswordBinding,
} from "../../../Utils/VMware/VMwareCollectionSettings";
import VMwareVCenterAddress, {
  VCenterAddressResult,
} from "../../../Utils/VMware/VMwareVCenterAddress";

/*
 * The rules of a vCenter's probe collection settings, applied by
 * VMwareVCenterService's create and update hooks:
 *
 *   - the address is normalized (VMwareVCenterAddress) and a name is made
 *     from it when none was typed;
 *   - a probe-collected vCenter has an address, a user name, a password and
 *     a probe that may collect it (VMwareCollectionSettings.getProbeRefusal:
 *     the project's own, or the instance's own on a self-hosted install);
 *   - the password is write-only and bound to where it was entered for: an
 *     update that keeps it may not change the address, the probe, or trust a
 *     different certificate (getPasswordRebindRefusal) - except trusting the
 *     very certificate the probe found at the saved address, which is what
 *     "Trust this certificate" on a failed collection does;
 *   - switching to the VMware agent forgets the password.
 *
 * What the hooks decide that only the server writes - whether a password is
 * saved, when the credentials changed, that the probe should collect with
 * the new settings now - is written after the save, as OneUptime
 * (afterWrite), with a feed line that says what changed and who changed it.
 */

// The settings a person writes to set up probe collection.
export const VMWARE_CONNECTION_SETTING_COLUMNS: Array<string> = [
  "collectionMethod",
  "vcenterUrl",
  "vcenterUsername",
  "vcenterPassword",
  "collectionProbeId",
  "collectionProbe",
  "trustedCertificateFingerprint",
  "collectionIntervalInMinutes",
];

const PROBE_KEYS: Array<string> = ["collectionProbeId", "collectionProbe"];

/*
 * What a create or an update decided for one vCenter, handed from the
 * before-hook to afterWrite.
 */
export interface VMwareConnectionChange {
  vmwareVCenterId: ObjectID | null;
  projectId: ObjectID | null;
  // The settings changed in a way the probe must try again (status -> Pending).
  isConnectionChanged: boolean;
  // The user name or the password changed.
  isCredentialChanged: boolean;
  // Whether a password is saved after the write; null when unchanged.
  isPasswordSet: boolean | null;
  // The vCenter now uses the VMware agent: forget the probe's status.
  isSwitchedToAgent: boolean;
  feedLines: Array<MarkdownText>;
  feedColor: Color;
}

// The saved row an update is checked against.
interface SavedConnection {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
  collectionMethod?: VMwareCollectionMethod | undefined;
  vcenterUrl?: string | undefined;
  vcenterUsername?: string | undefined;
  isVCenterPasswordSet?: boolean | undefined;
  collectionProbeId?: ObjectID | undefined;
  trustedCertificateFingerprint?: string | undefined;
  presentedCertificate?: { fingerprint256?: string | undefined } | undefined;
}

export const VMWARE_CONNECTION_SAVED_SELECT: Record<string, true> = {
  _id: true,
  projectId: true,
  collectionMethod: true,
  vcenterUrl: true,
  vcenterUsername: true,
  isVCenterPasswordSet: true,
  collectionProbeId: true,
  trustedCertificateFingerprint: true,
  presentedCertificate: true,
};

type DataRecord = Record<string, unknown>;

export default class VMwareVCenterConnection {
  // Whether a write sets any of the probe collection settings.
  public static isConnectionWrite(data: DataRecord | undefined): boolean {
    if (!data) {
      return false;
    }

    return VMWARE_CONNECTION_SETTING_COLUMNS.some((column: string): boolean => {
      return data[column] !== undefined;
    });
  }

  /*
   * Check and normalize a new vCenter's collection settings in place, and
   * say what afterWrite has to do once it is saved. Null for a vCenter that
   * names no probe collection setting at all - one registered for the agent,
   * or by ingest.
   */
  public static async prepareCreate(
    createBy: CreateBy<VMwareVCenter>,
  ): Promise<VMwareConnectionChange | null> {
    const data: DataRecord = createBy.data as unknown as DataRecord;

    if (!VMwareVCenterConnection.isConnectionWrite(data)) {
      return null;
    }

    const method: VMwareCollectionMethod =
      VMwareVCenterConnection.readMethod(data["collectionMethod"]) ||
      VMwareCollectionMethod.Agent;

    data["collectionMethod"] = method;

    VMwareVCenterConnection.normalizeOptionalSettings(data);

    const projectId: ObjectID | null =
      (createBy.data.projectId as ObjectID | undefined) ||
      createBy.props.tenantId ||
      null;

    if (method === VMwareCollectionMethod.Agent) {
      if (VMwareVCenterConnection.isPasswordGiven(data["vcenterPassword"])) {
        throw new BadDataException(
          "A password is only saved for a vCenter a probe collects. Set the collection method to Probe, or leave the password out.",
        );
      }

      delete data["vcenterPassword"];

      return {
        vmwareVCenterId: null,
        projectId: projectId,
        isConnectionChanged: false,
        isCredentialChanged: false,
        isPasswordSet: false,
        isSwitchedToAgent: false,
        feedLines: [],
        feedColor: Gray500,
      };
    }

    // Probe collection: everything it needs, checked.
    VMwareVCenterConnection.requireProbeSettings(data, {
      hasSavedPassword: false,
    });

    if (!projectId) {
      throw new BadDataException("The vCenter's project is missing.");
    }

    const probeId: ObjectID = RelationIdUtil.readIntoIdColumn(
      data,
      PROBE_KEYS,
      "Collection Probe",
    ) as ObjectID;

    await VMwareVCenterConnection.assertProbeCanCollect({
      probeId: probeId,
      projectId: projectId,
    });

    // A vCenter nobody named is named after its address.
    const name: unknown = data["name"];

    if (typeof name !== "string" || !name.trim()) {
      data["name"] = VMwareVCenterAddress.getDefaultName(
        data["vcenterUrl"] as string,
      );
    }

    return {
      vmwareVCenterId: null,
      projectId: projectId,
      isConnectionChanged: true,
      isCredentialChanged: true,
      isPasswordSet: true,
      isSwitchedToAgent: false,
      feedLines: [
        mdText`It is collected by a OneUptime probe from ${FeedMarkdown.code(
          data["vcenterUrl"] as string,
        )}, as ${FeedMarkdown.code(data["vcenterUsername"] as string)}.`,
      ],
      feedColor: Blue500,
    };
  }

  /*
   * Check and normalize an update of a vCenter's collection settings in
   * place, against the saved row, and say what afterWrite has to do. Empty
   * for an update that names no setting.
   *
   * `saved` is the row the update writes, read by the caller with
   * VMWARE_CONNECTION_SAVED_SELECT (findRowsAndHoldUpdateToThem). A settings
   * change names one vCenter: the password rules compare with that one.
   */
  public static async prepareUpdate(data: {
    updateBy: UpdateBy<VMwareVCenter>;
    saved: Array<SavedConnection>;
  }): Promise<Array<VMwareConnectionChange>> {
    const update: DataRecord = data.updateBy.data as unknown as DataRecord;

    if (!VMwareVCenterConnection.isConnectionWrite(update)) {
      return [];
    }

    if (data.saved.length === 0) {
      return [];
    }

    if (data.saved.length > 1) {
      throw new BadDataException(
        "Change the collection settings of one vCenter at a time.",
      );
    }

    const saved: SavedConnection = data.saved[0]!;

    const savedMethod: VMwareCollectionMethod =
      VMwareVCenterConnection.readMethod(saved.collectionMethod) ||
      VMwareCollectionMethod.Agent;

    const requestedMethod: VMwareCollectionMethod | null =
      update["collectionMethod"] === undefined
        ? null
        : VMwareVCenterConnection.readMethod(update["collectionMethod"]);

    if (update["collectionMethod"] !== undefined && !requestedMethod) {
      throw new BadDataException(
        `Collection method must be one of ${VMwareCollectionMethodUtil.getAll().join(", ")}.`,
      );
    }

    const method: VMwareCollectionMethod = requestedMethod || savedMethod;

    VMwareVCenterConnection.normalizeOptionalSettings(update);

    /*
     * An empty password in an update is "keep the saved one" - the
     * dashboard's edit form sends its empty field - never "clear it".
     */
    const isPasswordGiven: boolean = VMwareVCenterConnection.isPasswordGiven(
      update["vcenterPassword"],
    );

    if (!isPasswordGiven) {
      delete update["vcenterPassword"];
    }

    const projectId: ObjectID | null =
      saved.projectId || data.updateBy.props.tenantId || null;

    const change: VMwareConnectionChange = {
      vmwareVCenterId: saved._id ? new ObjectID(saved._id.toString()) : null,
      projectId: projectId,
      isConnectionChanged: false,
      isCredentialChanged: false,
      isPasswordSet: null,
      isSwitchedToAgent: false,
      feedLines: [],
      feedColor: Gray500,
    };

    if (method === VMwareCollectionMethod.Agent) {
      if (isPasswordGiven) {
        throw new BadDataException(
          "A password is only saved for a vCenter a probe collects. Set the collection method to Probe, or leave the password out.",
        );
      }

      if (savedMethod === VMwareCollectionMethod.Probe) {
        // The agent has its own credentials: OneUptime forgets this one.
        update["vcenterPassword"] = null;
        change.isSwitchedToAgent = true;
        change.isPasswordSet = false;
        change.isCredentialChanged = true;
        change.feedLines.push(
          mdText`Its data now comes from the VMware agent. OneUptime forgot the saved vCenter password, and its probe stopped collecting.`,
        );
        change.feedColor = Yellow500;
      }

      return [change];
    }

    // Probe collection, as it will be once the update is saved.
    const next: DataRecord = {
      vcenterUrl:
        update["vcenterUrl"] !== undefined
          ? update["vcenterUrl"]
          : saved.vcenterUrl,
      vcenterUsername:
        update["vcenterUsername"] !== undefined
          ? update["vcenterUsername"]
          : saved.vcenterUsername,
      vcenterPassword: isPasswordGiven ? update["vcenterPassword"] : undefined,
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
      collectionIntervalInMinutes: update["collectionIntervalInMinutes"],
    };

    const hasSavedPassword: boolean =
      savedMethod === VMwareCollectionMethod.Probe &&
      saved.isVCenterPasswordSet === true;

    VMwareVCenterConnection.requireProbeSettings(next, {
      hasSavedPassword: hasSavedPassword,
    });

    if (!projectId) {
      throw new BadDataException("The vCenter's project is missing.");
    }

    const nextProbeId: ObjectID = next["collectionProbeId"] as ObjectID;

    await VMwareVCenterConnection.assertProbeCanCollect({
      probeId: nextProbeId,
      projectId: projectId,
    });

    const savedBinding: VMwarePasswordBinding =
      VMwareVCenterConnection.getBinding({
        vcenterUrl: saved.vcenterUrl,
        probeId: saved.collectionProbeId,
        trustedCertificateFingerprint: saved.trustedCertificateFingerprint,
      });

    const nextBinding: VMwarePasswordBinding =
      VMwareVCenterConnection.getBinding({
        vcenterUrl: next["vcenterUrl"] as string | undefined,
        probeId: nextProbeId,
        trustedCertificateFingerprint: next["trustedCertificateFingerprint"] as
          | string
          | undefined,
      });

    if (!isPasswordGiven) {
      const refusal: string | null = VMwareVCenterConnection.getRebindRefusal({
        saved: savedBinding,
        next: nextBinding,
        presentedFingerprint: saved.presentedCertificate?.fingerprint256,
      });

      if (refusal) {
        throw new BadDataException(refusal);
      }
    }

    const isMethodSwitched: boolean =
      savedMethod !== VMwareCollectionMethod.Probe;
    const isEndpointChanged: boolean =
      savedBinding.endpointKey !== nextBinding.endpointKey;
    const isProbeChanged: boolean =
      savedBinding.probeId !== nextBinding.probeId;
    const isFingerprintChanged: boolean =
      (savedBinding.trustedCertificateFingerprint || null) !==
      (nextBinding.trustedCertificateFingerprint || null);
    const isUsernameChanged: boolean =
      update["vcenterUsername"] !== undefined &&
      update["vcenterUsername"] !== saved.vcenterUsername;

    change.isCredentialChanged = isPasswordGiven || isUsernameChanged;
    change.isPasswordSet = isPasswordGiven ? true : null;
    change.isConnectionChanged =
      isMethodSwitched ||
      isEndpointChanged ||
      isProbeChanged ||
      isFingerprintChanged ||
      change.isCredentialChanged;

    if (isMethodSwitched) {
      change.feedLines.push(
        mdText`It is now collected by a OneUptime probe from ${FeedMarkdown.code(
          next["vcenterUrl"] as string,
        )}, instead of the VMware agent. Stop the agent once the first collection succeeds, or every metric arrives twice.`,
      );
      change.feedColor = Blue500;
    } else {
      if (isEndpointChanged) {
        change.feedLines.push(
          mdText`Its address changed to ${FeedMarkdown.code(
            next["vcenterUrl"] as string,
          )}.`,
        );
      }

      if (isProbeChanged) {
        change.feedLines.push(mdText`Another probe collects it now.`);
      }

      if (change.isCredentialChanged) {
        change.feedLines.push(
          isUsernameChanged
            ? mdText`Its vCenter account changed to ${FeedMarkdown.code(
                next["vcenterUsername"] as string,
              )}.`
            : mdText`Its vCenter password changed.`,
        );
      }

      if (isFingerprintChanged) {
        change.feedLines.push(
          nextBinding.trustedCertificateFingerprint
            ? mdText`The certificate with SHA-256 fingerprint ${FeedMarkdown.code(
                nextBinding.trustedCertificateFingerprint,
              )} is trusted for it now.`
            : mdText`It no longer trusts a certificate of its own: vCenter's certificate must come from an authority the probe trusts.`,
        );
      }
    }

    if (
      update["collectionIntervalInMinutes"] !== undefined &&
      !isMethodSwitched
    ) {
      change.feedLines.push(
        mdText`It is collected every ${String(
          update["collectionIntervalInMinutes"],
        )} minutes now.`,
      );
    }

    return [change];
  }

  /*
   * Once the write is saved: the columns only the server writes, and the
   * feed line. As OneUptime - the person's own write already went through
   * their permission checks, and these columns are nobody's to write.
   */
  public static async afterWrite(data: {
    change: VMwareConnectionChange;
    userId?: ObjectID | undefined;
    /*
     * Writes `values` to the vCenter, hook-free, adding one to
     * collectionSettingsVersion in the same statement when
     * bumpSettingsVersion is set.
     */
    writeServerColumns: (write: {
      vmwareVCenterId: ObjectID;
      values: DataRecord;
      bumpSettingsVersion: boolean;
    }) => Promise<void>;
  }): Promise<void> {
    const change: VMwareConnectionChange = data.change;

    if (!change.vmwareVCenterId) {
      return;
    }

    const values: DataRecord = {};

    if (change.isPasswordSet !== null) {
      values["isVCenterPasswordSet"] = change.isPasswordSet;
    }

    if (change.isCredentialChanged) {
      values["vcenterCredentialsUpdatedAt"] = OneUptimeDate.getCurrentDate();
    }

    if (change.isSwitchedToAgent) {
      values["collectionStatus"] = null;
      values["collectionErrorCode"] = null;
      values["collectionError"] = null;
      values["presentedCertificate"] = null;
      values["nextCollectionAt"] = null;
    } else if (change.isConnectionChanged) {
      values["collectionStatus"] = VMwareCollectionStatus.Pending;
      values["collectionErrorCode"] = null;
      values["collectionError"] = null;
      values["presentedCertificate"] = null;
      // Collect with the new settings at once, not an interval from now.
      values["nextCollectionAt"] = OneUptimeDate.getCurrentDate();
    }

    const bumpSettingsVersion: boolean =
      change.isConnectionChanged || change.isSwitchedToAgent;

    try {
      if (Object.keys(values).length > 0 || bumpSettingsVersion) {
        await data.writeServerColumns({
          vmwareVCenterId: change.vmwareVCenterId,
          values: values,
          bumpSettingsVersion: bumpSettingsVersion,
        });
      }
    } catch (error) {
      logger.error(
        `Could not record the collection settings of vCenter ${change.vmwareVCenterId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    if (change.feedLines.length > 0 && change.projectId) {
      await VMwareVCenterFeedService.createVMwareVCenterFeedItem({
        vmwareVCenterId: change.vmwareVCenterId,
        projectId: change.projectId,
        vmwareVCenterFeedEventType:
          VMwareVCenterFeedEventType.VMwareVCenterUpdated,
        displayColor: change.feedColor,
        feedInfoInMarkdown: FeedMarkdown.join(
          [mdText`🔌 Data collection changed.`, ...change.feedLines],
          " ",
        ).toString(),
        userId: data.userId,
      });
    }
  }

  /*
   * Refuse a probe that may not collect a vCenter of this project. An id of
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

    const refusal: string | null = VMwareCollectionSettings.getProbeRefusal({
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
   * The rebind rule (VMwareCollectionSettings.getPasswordRebindRefusal), with
   * the one exception "Trust this certificate" needs: trusting exactly the
   * certificate the probe found at the saved address, through the saved
   * probe, keeps the password - that certificate is not one an editor
   * chose.
   */
  public static getRebindRefusal(data: {
    saved: VMwarePasswordBinding;
    next: VMwarePasswordBinding;
    presentedFingerprint?: string | null | undefined;
  }): string | null {
    const isOnlyTrustingWhatWasPresented: boolean =
      data.saved.endpointKey === data.next.endpointKey &&
      data.saved.probeId === data.next.probeId &&
      data.next.trustedCertificateFingerprint !== null &&
      VMwareCertificateFingerprint.areEqual(
        data.next.trustedCertificateFingerprint,
        data.presentedFingerprint,
      );

    if (isOnlyTrustingWhatWasPresented) {
      return null;
    }

    return VMwareCollectionSettings.getPasswordRebindRefusal({
      saved: data.saved,
      next: data.next,
    });
  }

  public static getBinding(data: {
    vcenterUrl: string | null | undefined;
    probeId: ObjectID | string | null | undefined;
    trustedCertificateFingerprint: string | null | undefined;
  }): VMwarePasswordBinding {
    return {
      endpointKey: VMwareVCenterAddress.getEndpointKey(data.vcenterUrl),
      probeId: data.probeId ? data.probeId.toString().toLowerCase() : null,
      trustedCertificateFingerprint: VMwareCertificateFingerprint.normalize(
        data.trustedCertificateFingerprint,
      ),
    };
  }

  private static readMethod(value: unknown): VMwareCollectionMethod | null {
    return VMwareCollectionMethodUtil.isValid(value) ? value : null;
  }

  private static isPasswordGiven(value: unknown): boolean {
    return typeof value === "string" && value.length > 0;
  }

  /*
   * Normalize what the write sets of the address, user name, fingerprint and
   * interval, refusing what cannot be normalized. Settings the write leaves
   * out are left alone.
   */
  private static normalizeOptionalSettings(data: DataRecord): void {
    if (data["vcenterUrl"] !== undefined && data["vcenterUrl"] !== null) {
      const result: VCenterAddressResult = VMwareVCenterAddress.normalize(
        String(data["vcenterUrl"]),
      );

      if (!result.address) {
        throw new BadDataException(result.error);
      }

      data["vcenterUrl"] = result.address.url;
    }

    if (
      data["vcenterUsername"] !== undefined &&
      data["vcenterUsername"] !== null
    ) {
      const username: string = String(data["vcenterUsername"]).trim();

      if (username.length > MAX_VMWARE_USERNAME_LENGTH) {
        throw new BadDataException(
          `The vCenter user name may be at most ${MAX_VMWARE_USERNAME_LENGTH} characters.`,
        );
      }

      data["vcenterUsername"] = username || null;
    }

    if (
      typeof data["vcenterPassword"] === "string" &&
      (data["vcenterPassword"] as string).length > MAX_VMWARE_PASSWORD_LENGTH
    ) {
      throw new BadDataException(
        `The vCenter password may be at most ${MAX_VMWARE_PASSWORD_LENGTH} characters.`,
      );
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
      const refusal: string | null =
        VMwareCollectionSettings.getIntervalRefusal(
          typeof interval === "string" ? Number(interval) : interval,
        );

      if (refusal) {
        throw new BadDataException(refusal);
      }

      data["collectionIntervalInMinutes"] = Number(interval);
    }
  }

  /*
   * A probe-collected vCenter needs an address, a user name, a password (a
   * new one, or the one saved) and a probe.
   */
  private static requireProbeSettings(
    data: DataRecord,
    options: { hasSavedPassword: boolean },
  ): void {
    if (!data["vcenterUrl"]) {
      throw new BadDataException(
        "Enter vCenter's address, such as https://vcsa.example.com.",
      );
    }

    if (!data["vcenterUsername"]) {
      throw new BadDataException(
        "Enter the vCenter user name, such as oneuptime@vsphere.local.",
      );
    }

    if (
      !VMwareVCenterConnection.isPasswordGiven(data["vcenterPassword"]) &&
      !options.hasSavedPassword
    ) {
      throw new BadDataException("Enter the vCenter password.");
    }

    if (!RelationIdUtil.readConsistent(data, PROBE_KEYS, "Collection Probe")) {
      throw new BadDataException(
        "Pick the probe that collects this vCenter: one in a network that can reach vCenter on TCP 443.",
      );
    }
  }
}
