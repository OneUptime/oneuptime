import { translationKey } from "../../../../Translator";
import StorageArrayResourceKind from "../../../StorageArrayResourceKind";
import {
  StorageArrayKindColumn,
  StorageArrayKindField,
  StorageArrayKindPage,
} from "../../../StorageArrayPlatform";
import { OntapKind } from "../NetApp";

/*
 * What an ONTAP cluster's inventory pages say, list and chart (#11001, on
 * #11122's StorageArrayPlatform.kindPages): its volumes on the shared
 * Volumes page, and its aggregates, SVMs, LUNs and SnapMirror
 * relationships, which only ONTAP has, each a list and a page per object.
 *
 * What each column reads is the extractor's
 * (Common/Server/Utils/Telemetry/StorageArray/NetApp/OntapExtractor.ts):
 * the shared columns where an ONTAP object has the same fact (size, used,
 * data reduction, latency, IOPS, bandwidth, replication lag), and the
 * details it keeps for the rest (an aggregate's free space, a volume's
 * aggregate, a relationship's schedule).
 */

const STATUS_COLUMN: StorageArrayKindColumn = {
  type: "status",
  title: translationKey("Status"),
};

const SIZE_COLUMN: StorageArrayKindColumn = {
  type: "value",
  id: "size",
  title: translationKey("Size"),
  value: { column: "capacityBytes", format: "bytes" },
};

const DATA_REDUCTION_COLUMN: StorageArrayKindColumn = {
  type: "value",
  id: "data-reduction",
  title: translationKey("Data Reduction"),
  description: translationKey(
    "How much less space the data takes after deduplication, compression and compaction: 2.5:1 means two and a half bytes written take one byte.",
  ),
  value: { column: "dataReductionRatio", format: "ratio" },
  hiddenByDefault: true,
};

// The read and write facts every object with performance reports.
const PERFORMANCE_FIELDS: ReadonlyArray<StorageArrayKindField> = [
  {
    title: translationKey("Read Latency"),
    value: { column: "readLatencyUsec", format: "latencyUsec" },
  },
  {
    title: translationKey("Write Latency"),
    value: { column: "writeLatencyUsec", format: "latencyUsec" },
  },
  {
    title: translationKey("Read IOPS"),
    value: { column: "readIops", format: "iops" },
  },
  {
    title: translationKey("Write IOPS"),
    value: { column: "writeIops", format: "iops" },
  },
  {
    title: translationKey("Read Bandwidth"),
    value: { column: "readBytesPerSec", format: "bytesPerSec" },
  },
  {
    title: translationKey("Write Bandwidth"),
    value: { column: "writeBytesPerSec", format: "bytesPerSec" },
  },
];

const ONTAP_KIND_PAGES: Partial<Record<string, StorageArrayKindPage>> = {
  [StorageArrayResourceKind.Volume]: {
    description: translationKey(
      "The volumes of this cluster: the SVM and aggregate each lives in, how full it is and its latest performance. Sort by latency to find the volume clients are waiting on.",
    ),
    noItemsMessage: translationKey(
      "No volumes in the inventory yet. Volumes appear here a few minutes after the Storage Array Agent starts reading the cluster.",
    ),
    tileDescription: translationKey(
      "Volumes the cluster reported in its latest data, with its aggregates below. Volumes hold the data its SVMs share over NFS and SMB, and the LUNs they serve to hosts.",
    ),
    topLists: {
      largestDescription: translationKey("Volumes holding the most data."),
      largestTooltip: translationKey(
        "The five volumes with the most space in use in their latest report, snapshots not counted.",
      ),
    },
    columns: [
      STATUS_COLUMN,
      {
        type: "value",
        id: "svm",
        title: translationKey("SVM"),
        description: translationKey(
          "The storage VM that serves the volume. Volume names are unique within an SVM, not across the cluster.",
        ),
        value: { column: "groupName", format: "text" },
      },
      {
        type: "value",
        id: "aggregate",
        title: translationKey("Aggregate"),
        description: translationKey(
          "The aggregate the volume's space comes from; a FlexGroup lists each of its aggregates.",
        ),
        value: { detail: "aggregate", format: "text" },
      },
      {
        type: "usage",
        title: translationKey("Used"),
        description: translationKey(
          "How much of the volume's size is in use, snapshots not counted, as volume show reports it: amber past 90% and red past 98%, the lines of the Volume Above 90% and 98% alerts.",
        ),
        warningPercent: 90,
        criticalPercent: 98,
      },
      SIZE_COLUMN,
      DATA_REDUCTION_COLUMN,
      { type: "performance" },
      {
        type: "value",
        id: "type",
        title: translationKey("Type"),
        description: translationKey(
          "rw for a volume clients write to, dp for a SnapMirror destination, ls for a load-sharing mirror.",
        ),
        value: { column: "componentType", format: "text" },
        hiddenByDefault: true,
      },
      { type: "lastSeen" },
    ],
    part: {
      labels: [
        { label: "volume", from: "name" },
        { label: "svm", from: "groupName" },
      ],
      charts: [
        {
          metricId: "netapp-volume-read-latency",
          legend: translationKey("Read"),
        },
        {
          metricId: "netapp-volume-write-latency",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "netapp-volume-read-iops", legend: translationKey("Read") },
        {
          metricId: "netapp-volume-write-iops",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        {
          metricId: "netapp-volume-read-bandwidth",
          legend: translationKey("Read"),
        },
        {
          metricId: "netapp-volume-write-bandwidth",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "netapp-volume-used-percent" },
        { metricId: "netapp-volume-snapshot-used" },
      ],
      metricsDescription: translationKey(
        "Latency, IOPS, bandwidth and space of this volume, as ONTAP reports them.",
      ),
      detailsDescription: translationKey(
        "What ONTAP reports about this volume.",
      ),
      storageDescription: translationKey(
        "How much of its size is in use, snapshots not counted, as ONTAP reports it.",
      ),
      fields: [
        {
          title: translationKey("Volume"),
          value: { column: "name", format: "text" },
        },
        {
          title: translationKey("SVM"),
          value: { column: "groupName", format: "text" },
        },
        {
          title: translationKey("State"),
          value: { column: "status", format: "status" },
        },
        {
          title: translationKey("Aggregate"),
          value: { detail: "aggregate", format: "text" },
        },
        {
          title: translationKey("Node"),
          value: { detail: "node", format: "text" },
        },
        {
          title: translationKey("Type"),
          value: { column: "componentType", format: "text" },
        },
        {
          title: translationKey("Style"),
          value: { detail: "style", format: "text" },
        },
        {
          title: translationKey("Size"),
          value: { column: "capacityBytes", format: "bytes" },
        },
        {
          title: translationKey("Used"),
          value: { column: "usedBytes", format: "bytes" },
        },
        {
          title: translationKey("Available"),
          value: { detail: "availableBytes", format: "bytes" },
        },
        {
          title: translationKey("Snapshot Space"),
          value: { detail: "snapshotUsedBytes", format: "bytes" },
        },
        {
          title: translationKey("Data Reduction"),
          value: { column: "dataReductionRatio", format: "ratio" },
        },
        ...PERFORMANCE_FIELDS,
        {
          title: translationKey("Junction Path"),
          value: { detail: "junctionPath", format: "text" },
        },
        {
          title: translationKey("Snapshot Policy"),
          value: { detail: "snapshotPolicy", format: "text" },
        },
      ],
      alerts: {
        title: translationKey("Volume alerts"),
        description: translationKey(
          "The cluster's alerts that watch its volumes, this one included: one monitor each for a volume past 90% or 98% of its size, offline, or reading slower than 20 ms.",
        ),
        templateIds: [
          "netapp-volume-nearly-full",
          "netapp-volume-full",
          "netapp-volume-offline",
          "netapp-volume-latency-high",
        ],
      },
    },
  },

  [OntapKind.Lun]: {
    columns: [
      STATUS_COLUMN,
      {
        type: "value",
        id: "volume",
        title: translationKey("Volume"),
        description: translationKey(
          "The volume the LUN is carved from: a LUN goes offline when its volume runs out of space.",
        ),
        value: { detail: "volume", format: "text" },
      },
      {
        type: "value",
        id: "svm",
        title: translationKey("SVM"),
        value: { column: "groupName", format: "text" },
      },
      {
        type: "usage",
        title: translationKey("Used"),
        description: translationKey(
          "How much of the LUN's size its hosts have written, as ONTAP reports it: amber past 90% and red past 98%.",
        ),
        warningPercent: 90,
        criticalPercent: 98,
      },
      SIZE_COLUMN,
      { type: "performance" },
      { type: "lastSeen" },
    ],
    part: {
      labels: [
        { label: "lun", from: { detail: "lun" } },
        { label: "volume", from: { detail: "volume" } },
        { label: "svm", from: "groupName" },
      ],
      charts: [
        { metricId: "netapp-lun-read-latency", legend: translationKey("Read") },
        {
          metricId: "netapp-lun-write-latency",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "netapp-lun-read-iops", legend: translationKey("Read") },
        {
          metricId: "netapp-lun-write-iops",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        {
          metricId: "netapp-lun-read-bandwidth",
          legend: translationKey("Read"),
        },
        {
          metricId: "netapp-lun-write-bandwidth",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "netapp-lun-used-percent" },
      ],
      metricsDescription: translationKey(
        "Latency, IOPS, bandwidth and space of this LUN, as ONTAP reports them.",
      ),
      detailsDescription: translationKey("What ONTAP reports about this LUN."),
      storageDescription: translationKey(
        "How much of its size its hosts have written, as ONTAP reports it.",
      ),
      fields: [
        {
          title: translationKey("Path"),
          value: { column: "name", format: "text" },
        },
        {
          title: translationKey("SVM"),
          value: { column: "groupName", format: "text" },
        },
        {
          title: translationKey("State"),
          value: { column: "status", format: "status" },
        },
        {
          title: translationKey("Volume"),
          value: { detail: "volume", format: "text" },
        },
        {
          title: translationKey("Qtree"),
          value: { detail: "qtree", format: "text" },
        },
        {
          title: translationKey("Node"),
          value: { detail: "node", format: "text" },
        },
        {
          title: translationKey("Size"),
          value: { column: "capacityBytes", format: "bytes" },
        },
        {
          title: translationKey("Used"),
          value: { column: "usedBytes", format: "bytes" },
        },
        ...PERFORMANCE_FIELDS,
        {
          title: translationKey("Serial Number"),
          value: { detail: "serialHex", format: "text" },
        },
      ],
      alerts: {
        title: translationKey("LUN alerts"),
        description: translationKey(
          "The cluster's alert that watches its LUNs, this one included: one monitor that fires for any LUN that is not online.",
        ),
        templateIds: ["netapp-lun-offline"],
      },
    },
  },

  [OntapKind.Aggregate]: {
    columns: [
      STATUS_COLUMN,
      {
        type: "value",
        id: "node",
        title: translationKey("Node"),
        description: translationKey(
          "The node that owns the aggregate and serves its volumes; its HA partner takes it over if the node fails.",
        ),
        value: { column: "groupName", format: "text" },
      },
      {
        type: "usage",
        title: translationKey("Used"),
        description: translationKey(
          "How much of the aggregate's usable space is in use or reserved: amber past 80% and red past 90%, the lines of the Aggregate Above 80% and 90% alerts.",
        ),
      },
      SIZE_COLUMN,
      {
        type: "value",
        id: "free",
        title: translationKey("Available"),
        value: { detail: "availableBytes", format: "bytes" },
      },
      DATA_REDUCTION_COLUMN,
      { type: "latency" },
      { type: "iops" },
      {
        type: "value",
        id: "disk-type",
        title: translationKey("Disk Type"),
        value: { column: "componentType", format: "text" },
        hiddenByDefault: true,
      },
      { type: "lastSeen" },
    ],
    part: {
      labels: [{ label: "aggr", from: "name" }],
      charts: [
        { metricId: "netapp-aggr-used-percent" },
        { metricId: "netapp-aggr-used" },
        {
          metricId: "netapp-aggr-read-latency",
          legend: translationKey("Read"),
        },
        {
          metricId: "netapp-aggr-write-latency",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "netapp-aggr-read-iops", legend: translationKey("Read") },
        {
          metricId: "netapp-aggr-write-iops",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
      ],
      metricsDescription: translationKey(
        "Space, latency and IOPS of this aggregate, as ONTAP reports them.",
      ),
      detailsDescription: translationKey(
        "What ONTAP reports about this aggregate.",
      ),
      storageDescription: translationKey(
        "How much of its usable space is in use or reserved, as ONTAP reports it.",
      ),
      fields: [
        {
          title: translationKey("Aggregate"),
          value: { column: "name", format: "text" },
        },
        {
          title: translationKey("State"),
          value: { column: "status", format: "status" },
        },
        {
          title: translationKey("Node"),
          value: { column: "groupName", format: "text" },
        },
        {
          title: translationKey("Disk Type"),
          value: { column: "componentType", format: "text" },
        },
        {
          title: translationKey("Size"),
          value: { column: "capacityBytes", format: "bytes" },
        },
        {
          title: translationKey("Used"),
          value: { column: "usedBytes", format: "bytes" },
        },
        {
          title: translationKey("Available"),
          value: { detail: "availableBytes", format: "bytes" },
        },
        {
          title: translationKey("Inodes Used"),
          value: { detail: "inodeUsedPercent", format: "percent" },
        },
        {
          title: translationKey("Data Reduction"),
          value: { column: "dataReductionRatio", format: "ratio" },
        },
        {
          title: translationKey("Encrypted"),
          value: { detail: "isEncrypted", format: "boolean" },
        },
        ...PERFORMANCE_FIELDS,
      ],
      alerts: {
        title: translationKey("Aggregate alerts"),
        description: translationKey(
          "The cluster's alerts that watch its aggregates, this one included: one monitor each for an aggregate past 80% or 90% of its space, or not online.",
        ),
        templateIds: [
          "netapp-aggregate-nearly-full",
          "netapp-aggregate-full",
          "netapp-aggregate-offline",
        ],
      },
    },
  },

  [OntapKind.Svm]: {
    columns: [
      STATUS_COLUMN,
      {
        type: "value",
        id: "protocols",
        title: translationKey("Protocols"),
        description: translationKey(
          "The protocols the SVM serves its volumes and LUNs over.",
        ),
        value: { detail: "protocols", format: "text" },
      },
      { type: "performance" },
      {
        type: "value",
        id: "type",
        title: translationKey("Type"),
        value: { column: "componentType", format: "text" },
        hiddenByDefault: true,
      },
      { type: "lastSeen" },
    ],
    part: {
      labels: [{ label: "svm", from: "name" }],
      charts: [
        { metricId: "netapp-svm-read-latency", legend: translationKey("Read") },
        {
          metricId: "netapp-svm-write-latency",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "netapp-svm-read-iops", legend: translationKey("Read") },
        {
          metricId: "netapp-svm-write-iops",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        {
          metricId: "netapp-svm-read-bandwidth",
          legend: translationKey("Read"),
        },
        {
          metricId: "netapp-svm-write-bandwidth",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
      ],
      metricsDescription: translationKey(
        "Latency, IOPS and bandwidth of this SVM's volumes, as ONTAP reports them.",
      ),
      detailsDescription: translationKey("What ONTAP reports about this SVM."),
      fields: [
        {
          title: translationKey("SVM"),
          value: { column: "name", format: "text" },
        },
        {
          title: translationKey("State"),
          value: { column: "status", format: "status" },
        },
        {
          title: translationKey("Type"),
          value: { column: "componentType", format: "text" },
        },
        {
          title: translationKey("Protocols"),
          value: { detail: "protocols", format: "text" },
        },
        ...PERFORMANCE_FIELDS,
      ],
      alerts: {
        title: translationKey("SVM alerts"),
        description: translationKey(
          "The cluster's alert that watches its SVMs, this one included: one monitor that fires for any SVM that is not running.",
        ),
        templateIds: ["netapp-svm-stopped"],
      },
    },
  },

  [OntapKind.SnapMirror]: {
    columns: [
      {
        type: "status",
        title: translationKey("Health"),
        description: translationKey(
          "Healthy or Unhealthy, as ONTAP reports the relationship, in red with why when it is unhealthy, and in amber when it is more than one and a half schedule intervals behind, the SnapMirror Behind Schedule alert's line.",
        ),
      },
      {
        type: "lag",
        title: translationKey("Lag"),
        description: translationKey(
          "How far the destination is behind its source: the age of the newest snapshot it has. It grows between transfers and drops after each one.",
        ),
      },
      {
        type: "value",
        id: "schedule",
        title: translationKey("Schedule"),
        value: { detail: "schedule", format: "text" },
      },
      {
        type: "value",
        id: "source",
        title: translationKey("Source"),
        value: { detail: "source", format: "text" },
      },
      {
        type: "value",
        id: "state",
        title: translationKey("State"),
        description: translationKey(
          "Snapmirrored once the destination holds a copy, Broken Off once it was made writable, Uninitialized before its first transfer.",
        ),
        value: { detail: "relationshipState", format: "status" },
      },
      {
        type: "value",
        id: "last-transfer",
        title: translationKey("Last Transfer"),
        value: { detail: "lastTransferSizeBytes", format: "bytes" },
        hiddenByDefault: true,
      },
      { type: "lastSeen" },
    ],
    part: {
      labels: [{ label: "destination_location", from: "name" }],
      charts: [
        { metricId: "netapp-snapmirror-lag" },
        { metricId: "netapp-snapmirror-last-transfer-duration" },
        { metricId: "netapp-snapmirror-last-transfer-size" },
      ],
      metricsDescription: translationKey(
        "The lag and transfers of this SnapMirror relationship, as ONTAP reports them.",
      ),
      detailsDescription: translationKey(
        "What ONTAP reports about this SnapMirror relationship.",
      ),
      fields: [
        {
          title: translationKey("Destination"),
          value: { column: "name", format: "text" },
        },
        {
          title: translationKey("Source"),
          value: { detail: "source", format: "text" },
        },
        {
          title: translationKey("Source Cluster"),
          value: { detail: "sourceCluster", format: "text" },
        },
        {
          title: translationKey("Health"),
          value: { column: "status", format: "status" },
        },
        {
          title: translationKey("Unhealthy Reason"),
          value: { column: "statusDetail", format: "text" },
        },
        {
          title: translationKey("Lag"),
          value: { column: "replicationLagMs", format: "durationMs" },
        },
        {
          title: translationKey("Schedule"),
          value: { detail: "schedule", format: "text" },
        },
        {
          title: translationKey("State"),
          value: { detail: "relationshipState", format: "status" },
        },
        {
          title: translationKey("Transfer Status"),
          value: { detail: "relationshipStatus", format: "status" },
        },
        {
          title: translationKey("Policy Type"),
          value: { detail: "policyType", format: "text" },
        },
        {
          title: translationKey("Last Transfer"),
          value: { detail: "lastTransferSizeBytes", format: "bytes" },
        },
        {
          title: translationKey("Last Transfer Took"),
          value: {
            detail: "lastTransferDurationSeconds",
            format: "durationSeconds",
          },
        },
      ],
      alerts: {
        title: translationKey("SnapMirror alerts"),
        description: translationKey(
          "The cluster's alerts that watch its SnapMirror relationships, this one included: one monitor each for a relationship more than one and a half schedule intervals behind, a day behind, or that ONTAP reports unhealthy.",
        ),
        templateIds: [
          "netapp-snapmirror-behind-schedule",
          "netapp-snapmirror-unhealthy",
          "netapp-snapmirror-lag-day",
        ],
      },
    },
  },
};

export default ONTAP_KIND_PAGES;
