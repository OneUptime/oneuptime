import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Storage Arrays > All Arrays shows while the project has no array.
const STORAGE_ARRAY_SHOWCASE: ResourceShowcase = {
  icon: IconProp.StorageArray,
  eyebrow: translationKey("Storage array monitoring"),
  title: translationKey("Watch your storage arrays, down to every drive"),
  description: translationKey(
    "Run the agent on a Docker host that can reach your Pure Storage FlashArray or FlashBlade. Capacity, performance, hardware and the array's own alerts show up on their own.",
  ),
  highlights: [
    translationKey("FlashArray and FlashBlade"),
    translationKey("Read-only API token"),
    translationKey("Data in a minute or two"),
  ],
  features: [
    {
      icon: IconProp.ShieldCheck,
      title: translationKey("Health and the array's alerts"),
      description: translationKey(
        "OK, warning or critical, with the array's own open alerts beside it.",
      ),
    },
    {
      icon: IconProp.ChartPie,
      title: translationKey("Capacity and data reduction"),
      description: translationKey(
        "How full each array is, and how much it saves by reducing your data.",
      ),
    },
    {
      icon: IconProp.Gauge,
      title: translationKey("Performance"),
      description: translationKey(
        "Read and write latency, IOPS and bandwidth, with the slowest and largest volumes.",
      ),
    },
    {
      icon: IconProp.CPUChip,
      title: translationKey("Hardware, part by part"),
      description: translationKey(
        "Controllers, drives and ports, with failed parts counted in red.",
      ),
    },
    {
      icon: IconProp.Layers,
      title: translationKey("Everything on the array"),
      description: translationKey(
        "Volumes, hosts and replication on FlashArray, and file systems and buckets on FlashBlade.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for arrays"),
      description: translationKey(
        "Recommended monitors for failed drives, lost host paths, replication lag and capacity.",
      ),
    },
  ],
  preview: {
    name: "fa-prod-01",
    subtitle: translationKey("Purity//FA 6.7.3 · 48 volumes · 12 hosts"),
    stats: [
      { label: translationKey("Capacity used"), value: "71.8%" },
      { label: translationKey("Data reduction"), value: "4.3:1" },
      { label: translationKey("Open alerts"), value: "1" },
      { label: translationKey("Failed parts"), value: "1" },
    ],
    chart: {
      label: translationKey("Read latency"),
      values: [
        0.42, 0.45, 0.41, 0.47, 0.52, 0.49, 0.44, 0.5, 0.56, 0.51, 0.47, 0.53,
        0.58, 0.54, 0.49, 0.52, 0.48, 0.45, 0.5, 0.47, 0.44, 0.46,
      ],
    },
    rows: [
      {
        name: "CT0",
        detail: translationKey("Controller"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Ready"),
      },
      {
        name: "CH0.BAY7",
        detail: translationKey("Drive · 3.8 TB"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Failed"),
      },
      {
        name: "CT1",
        detail: translationKey("Controller"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Ready"),
      },
      {
        name: "CH0.BAY3",
        detail: translationKey("Drive · 3.8 TB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
    ],
    alert: {
      title: translationKey("Drive failed"),
      description: translationKey("CH0.BAY7 on fa-prod-01 has failed."),
    },
  },
};

export default STORAGE_ARRAY_SHOWCASE;
