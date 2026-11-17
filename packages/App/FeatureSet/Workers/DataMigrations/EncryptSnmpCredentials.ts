import DataMigrationBase from "./DataMigrationBase";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * Encrypts the SNMP credentials of network devices and discovery scans
 * stored before their columns were kept encrypted at rest (#9014), as a
 * credential profile's are:
 *
 *   - NetworkDevice.snmpCommunityString, .snmpV3AuthKey and .snmpV3PrivKey,
 *     and the authKey and privKey of the deprecated snmpV3Auth object that
 *     devices created before those columns still carry;
 *   - NetworkDeviceDiscoveryScan.snmpCommunityString, .snmpV3AuthKey and
 *     .snmpV3PrivKey, and the community string and v3 keys inside each entry
 *     of its snmpConfigs list.
 *
 * All of them together: a scan's credentials are copied into the devices
 * it imports and mirrored between its list and its own columns, so one
 * left as written would keep the very secret encrypted beside it. The text
 * columns are encrypted whole, the JSON ones field by field, keeping their
 * shape (EncryptColumnInPlace, jsonFields).
 *
 * THE UPGRADE CHANGES NO CREDENTIAL (#9266). A server of the release
 * before, still running while the upgrade rolls out, reads each column as
 * it is stored: it would hand its probes a ciphertext for a community
 * string, and the polls and sweeps would fail. So this runs at the upgrade
 * and changes nothing, and when it ran starts the wait: a day later, once
 * no server of the release before can still be running, the
 * CredentialsAtRest:EncryptInPlace job encrypts each value still stored as
 * written - those it saved meanwhile too - in place, only while the row
 * still holds the value read (CredentialsAtRest). An install that ran this
 * when it still encrypted at once (builds of main) has its credentials
 * encrypted already: the job encrypts what is left, and never a ciphertext
 * again.
 *
 * Every reader of this release reads the same credentials before, during
 * and after: DatabaseService decrypts our ciphertext and hands back a value
 * that is not one as it is, so the probes keep polling devices and sweeping
 * scans with them, and the imports keep creating devices with them.
 */
export default class EncryptSnmpCredentials extends DataMigrationBase {
  public constructor() {
    super("EncryptSnmpCredentials");
  }

  // Leaves every credential as written: see the top of this file.
  public override async migrate(): Promise<void> {
    return;
  }

  /*
   * Every column whose values are encrypted in place a day after this ran,
   * in that order (CredentialsAtRest).
   */
  public static getTargets(): Array<ColumnToEncrypt> {
    const devices: ModelRepository =
      NetworkDeviceService.getRepository() as unknown as ModelRepository;
    const scans: ModelRepository =
      NetworkDeviceDiscoveryScanService.getRepository() as unknown as ModelRepository;

    return [
      {
        kind: "network device",
        repository: devices,
        column: "snmpCommunityString",
      },
      {
        kind: "network device",
        repository: devices,
        column: "snmpV3AuthKey",
      },
      {
        kind: "network device",
        repository: devices,
        column: "snmpV3PrivKey",
      },
      {
        kind: "network device",
        repository: devices,
        column: "snmpV3Auth",
        jsonFields: EncryptSnmpCredentials.getEncryptedFields(
          new NetworkDevice(),
          "snmpV3Auth",
        ),
      },
      {
        kind: "discovery scan",
        repository: scans,
        column: "snmpCommunityString",
      },
      {
        kind: "discovery scan",
        repository: scans,
        column: "snmpV3AuthKey",
      },
      {
        kind: "discovery scan",
        repository: scans,
        column: "snmpV3PrivKey",
      },
      {
        kind: "discovery scan",
        repository: scans,
        column: "snmpConfigs",
        jsonFields: EncryptSnmpCredentials.getEncryptedFields(
          new NetworkDeviceDiscoveryScan(),
          "snmpConfigs",
        ),
      },
    ];
  }

  // The fields a JSON column keeps encrypted, as its model declares them.
  private static getEncryptedFields(
    model: NetworkDevice | NetworkDeviceDiscoveryScan,
    column: string,
  ): Array<string> {
    return [...(model.getTableColumnMetadata(column).encryptedFields || [])];
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
