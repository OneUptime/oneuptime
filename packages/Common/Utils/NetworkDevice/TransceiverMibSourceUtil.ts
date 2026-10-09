import { TransceiverMibSource } from "../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import SnmpOidListUtil from "../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";

/*
 * Which MIBs a device's optics are read from, in the order they are tried.
 *
 * The probe reads the first source that answers and stops there, so a
 * device costs one extra request per poll for each source that has nothing
 * - a switch without the vendor table answers its first column with the
 * next object outside it, and the walk ends.
 *
 * The vendor's own table comes first where it carries what the standard
 * one does not (thresholds, identity, lanes). ENTITY-SENSOR-MIB (RFC 3433)
 * is the fallback everywhere, and the only source for every vendor not
 * listed here.
 *
 * This is deliberately independent of the vendor OID templates: a device
 * gets its optics read whether or not anyone applied a template to it.
 */

const ENTERPRISES_ARC: string = "1.3.6.1.4.1.";

// Cambium cnMatrix switches report sysObjectIDs under this arc.
const CAMBIUM_CNMATRIX_ARC: string = "1.3.6.1.4.1.17713.24";

const SOURCES_BY_ENTERPRISE: Record<number, Array<TransceiverMibSource>> = {
  // Cisco
  9: [TransceiverMibSource.CiscoEntitySensor, TransceiverMibSource.EntitySensor],
  // HPE Aruba ProCurve / ArubaOS-Switch
  11: [
    TransceiverMibSource.HpIcfTransceiver,
    TransceiverMibSource.EntitySensor,
  ],
  // Aricent ISS, the platform cnMatrix firmware is built on
  2076: [
    TransceiverMibSource.CambiumTransceiver,
    TransceiverMibSource.EntitySensor,
  ],
  // Juniper
  2636: [TransceiverMibSource.JuniperDom, TransceiverMibSource.EntitySensor],
  // MikroTik RouterOS
  14988: [TransceiverMibSource.MikroTik],
  // HPE Comware and H3C
  25506: [
    TransceiverMibSource.H3cTransceiver,
    TransceiverMibSource.EntitySensor,
  ],
  // Arista: RFC 3433 sensors, with Arista's thresholds beside them
  30065: [TransceiverMibSource.AristaEntitySensor],
};

export default class TransceiverMibSourceUtil {
  public static getSourcesForDevice(
    sysObjectId: string | undefined,
  ): Array<TransceiverMibSource> {
    const normalized: string = SnmpOidListUtil.normalizeOid(sysObjectId);

    if (
      normalized === CAMBIUM_CNMATRIX_ARC ||
      normalized.startsWith(`${CAMBIUM_CNMATRIX_ARC}.`)
    ) {
      return [
        TransceiverMibSource.CambiumTransceiver,
        TransceiverMibSource.EntitySensor,
      ];
    }

    if (normalized.startsWith(ENTERPRISES_ARC)) {
      const enterprise: number = parseInt(
        normalized.substring(ENTERPRISES_ARC.length).split(".")[0] || "",
        10,
      );

      const sources: Array<TransceiverMibSource> | undefined =
        SOURCES_BY_ENTERPRISE[enterprise];

      if (sources) {
        return [...sources];
      }
    }

    return [TransceiverMibSource.EntitySensor];
  }
}
