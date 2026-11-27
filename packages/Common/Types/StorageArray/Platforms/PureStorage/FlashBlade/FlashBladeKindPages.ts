import { translationKey } from "../../../../Translator";
import StorageArrayResourceKind from "../../../StorageArrayResourceKind";
import { StorageArrayKindPage } from "../../../StorageArrayPlatform";

/*
 * What a FlashBlade's inventory pages say and chart (#11122), moved here
 * unchanged from the shared pages (Pages/StorageArray/View/FileSystems,
 * FileSystemDetail, Buckets, BucketDetail and StorageArrayResourceDetail)
 * when they started reading their words from the array's platform. Pure's
 * exporter names a file system and a bucket by its `name` label.
 */
const FLASHBLADE_KIND_PAGES: Partial<Record<string, StorageArrayKindPage>> = {
  [StorageArrayResourceKind.FileSystem]: {
    description: translationKey(
      "File systems on this FlashBlade with the protocols they are shared over, their size, the flash they use and their latest performance.",
    ),
    noItemsMessage: translationKey(
      "No file systems in the inventory yet. File systems appear here a few minutes after the Storage Array Agent starts scraping the FlashBlade.",
    ),
    part: {
      labels: [{ label: "name", from: "externalId" }],
      charts: [
        { metricId: "purefb-fs-read-latency", legend: translationKey("Read") },
        {
          metricId: "purefb-fs-write-latency",
          legend: translationKey("Write"),
          overlayWithPreviousQuery: true,
        },
        { metricId: "purefb-fs-physical" },
        { metricId: "purefb-fs-available-ratio" },
      ],
      metricsDescription: translationKey(
        "Latency and space of this file system, as the FlashBlade reports them.",
      ),
      detailsDescription: translationKey(
        "What the FlashBlade reports about this file system.",
      ),
      notReportedMessage: translationKey(
        "File system {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the FlashBlade.",
      ),
      storageDescription: translationKey(
        "How much of its provisioned size is used, as the FlashBlade reports it.",
      ),
      alerts: {
        title: translationKey("File system alerts"),
        description: translationKey(
          "The FlashBlade's alerts that watch its file systems, this one included: one monitor that fires for any file system with less than 10% of its provisioned size left.",
        ),
        templateIds: ["purefb-file-system-near-full"],
      },
    },
  },
  [StorageArrayResourceKind.Bucket]: {
    description: translationKey(
      "S3 buckets on this FlashBlade with their account, quota, the flash they use, how many objects they hold and their latest performance.",
    ),
    noItemsMessage: translationKey(
      "No buckets in the inventory yet. Buckets appear here a few minutes after the Storage Array Agent starts scraping the FlashBlade's object store.",
    ),
    part: {
      labels: [{ label: "name", from: "externalId" }],
      charts: [
        { metricId: "purefb-bucket-read-latency" },
        { metricId: "purefb-bucket-physical" },
        { metricId: "purefb-bucket-object-count" },
      ],
      metricsDescription: translationKey(
        "Latency, space and object count of this bucket, as the FlashBlade reports them.",
      ),
      detailsDescription: translationKey(
        "What the FlashBlade reports about this bucket.",
      ),
      notReportedMessage: translationKey(
        "Bucket {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the FlashBlade's object store.",
      ),
    },
  },
};

export default FLASHBLADE_KIND_PAGES;
