import { translationKey } from "../../../../Translator";
import StorageArrayResourceKind from "../../../StorageArrayResourceKind";
import { StorageArrayKindPage } from "../../../StorageArrayPlatform";

/*
 * What a FlashArray's inventory pages say and chart (#11122), moved here
 * unchanged from the shared pages (Pages/StorageArray/View/Volumes,
 * VolumeDetail, Hosts, HostDetail, Replication, Directories and
 * StorageArrayResourceDetail) when they started reading their words from
 * the array's platform. Pure's series name a volume by its `name` label (a
 * volume in a pod or group is pod::volume or group/volume, its externalId)
 * and a host by `host`.
 */
const FLASHARRAY_KIND_PAGES: Partial<Record<string, StorageArrayKindPage>> = {
  [StorageArrayResourceKind.Volume]: {
    description: translationKey(
      "Block volumes on this FlashArray with their size, the flash they use and their latest performance. Sort by latency to find the volume hosts are waiting on.",
    ),
    noItemsMessage: translationKey(
      "No volumes in the inventory yet. Volumes appear here a few minutes after the Storage Array Agent starts scraping the array.",
    ),
    part: {
      labels: [{ label: "name", from: "externalId" }],
      charts: [
        {
          metricId: "purefa-volume-read-latency",
          legend: translationKey("Read"),
        },
        {
          metricId: "purefa-volume-write-latency",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "purefa-volume-read-iops", legend: translationKey("Read") },
        {
          metricId: "purefa-volume-write-iops",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        {
          metricId: "purefa-volume-read-bandwidth",
          legend: translationKey("Read"),
        },
        {
          metricId: "purefa-volume-write-bandwidth",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "purefa-volume-physical" },
        { metricId: "purefa-volume-data-reduction" },
      ],
      metricsDescription: translationKey(
        "Latency, IOPS, bandwidth and space of this volume, as the FlashArray reports them.",
      ),
      detailsDescription: translationKey(
        "What the FlashArray reports about this volume.",
      ),
    },
  },
  [StorageArrayResourceKind.Host]: {
    description: translationKey(
      "The hosts defined on this FlashArray: whether the array sees them on all their paths, the volumes connected to them and the performance they get.",
    ),
    noItemsMessage: translationKey(
      "No hosts in the inventory yet. Hosts appear here a few minutes after the Storage Array Agent starts scraping the array.",
    ),
    part: {
      labels: [{ label: "host", from: "externalId" }],
      charts: [
        {
          metricId: "purefa-host-read-latency",
          legend: translationKey("Read"),
        },
        {
          metricId: "purefa-host-write-latency",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "purefa-host-iops", legend: translationKey("Read") },
        {
          metricId: "purefa-host-write-iops",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "purefa-host-connectivity" },
      ],
      metricsDescription: translationKey(
        "Latency, IOPS and connectivity of this host, as the FlashArray sees them.",
      ),
      detailsDescription: translationKey(
        "What the FlashArray reports about this host.",
      ),
      alerts: {
        title: translationKey("Host alerts"),
        description: translationKey(
          "The array's alerts that watch its hosts, this one included: one monitor that fires for any host that no longer reaches the array through both controllers.",
        ),
        templateIds: ["purefa-host-connectivity-critical"],
      },
    },
  },
  [StorageArrayResourceKind.Pod]: {
    description: translationKey(
      "Pods on this FlashArray and their replica links: how far each remote copy is behind, the link's status, and whether stretched pods reach their mediator.",
    ),
    noItemsMessage: translationKey(
      "No pods in the inventory yet. Pods appear here a few minutes after the Storage Array Agent starts scraping the array, if the array has any.",
    ),
  },
  [StorageArrayResourceKind.Directory]: {
    description: translationKey(
      "Managed directories of this FlashArray's file services, with the flash they use and their latest performance. Directory space is read every 30 minutes.",
    ),
    noItemsMessage: translationKey(
      "No directories yet. They appear once the array serves files and the agent reads them, every 30 minutes.",
    ),
  },
};

export default FLASHARRAY_KIND_PAGES;
