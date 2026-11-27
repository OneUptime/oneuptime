import { translationKey } from "../../../Translator";

/*
 * What NetApp's platforms share: the vendor, the prefix the OneUptime
 * Storage Array Agent has NetApp Harvest put on every series (Harvest's
 * `global_prefix: netapp_`, agents/StorageArrayAgent/netapp-harvest.yml),
 * and the kinds of object only ONTAP has.
 *
 * NetApp Harvest (github.com/NetApp/harvest, Apache-2.0) reads ONTAP's
 * REST API and serves Prometheus metrics named <object>_<counter>
 * (volume_read_latency), every series labelled with the `cluster` and
 * `datacenter` it came from. ONTAP has no metrics endpoint of its own.
 */

export const NETAPP_VENDOR_NAME: string = "NetApp";

// Every series the agent's Harvest serves starts with it.
export const NETAPP_METRIC_PREFIX: string = "netapp_";

/*
 * The kinds of object only ONTAP has (StorageArrayResourceKind holds the
 * shared ones: an ONTAP volume is a Volume, a node a Controller, a disk a
 * Drive, a shelf and its parts Hardware, a port a NetworkInterface).
 */
export enum OntapKind {
  // The RAID groups of disks a node's volumes are carved from.
  Aggregate = "Aggregate",
  // A storage virtual machine: the tenant that serves volumes and LUNs.
  Svm = "Svm",
  // A block device carved from a volume and mapped to hosts.
  Lun = "Lun",
  // A SnapMirror relationship: a volume replicated to another one.
  SnapMirror = "SnapMirror",
}

/*
 * What the extractor writes as an ONTAP cluster's osName: ONTAP itself,
 * or Amazon FSx for NetApp ONTAP, whose cluster is named after its file
 * system (FsxId and 17 hexadecimal digits) and which runs on hardware AWS
 * runs: it reports no disks, shelves or power supplies.
 */
export const ONTAP_OS_NAME: string = "ONTAP";
export const ONTAP_FSX_OS_NAME: string = "Amazon FSx for NetApp ONTAP";

// An Amazon FSx for NetApp ONTAP file system's cluster name.
export const ONTAP_FSX_CLUSTER_NAME: RegExp = /^FsxId[0-9a-f]{17}$/i;

// The Hardware tab of an FSx file system says this where disks would be.
export const ONTAP_FSX_HARDWARE_NOTE: string = translationKey(
  "Amazon FSx for NetApp ONTAP runs this file system on hardware AWS manages, so it reports no disks, shelves or power supplies. Its nodes and ports are below.",
);
