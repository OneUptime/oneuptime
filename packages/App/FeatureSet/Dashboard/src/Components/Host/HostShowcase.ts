import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Hosts > All Hosts shows while the project has no host.
const HOST_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Server,
  eyebrow: translationKey("Host monitoring"),
  title: translationKey("Know what every server is doing, down to the process"),
  description: translationKey(
    "Run one command on a Linux, Windows or macOS host. It installs an OpenTelemetry Collector that OneUptime configures for you, and the host's metrics, processes, services and logs show up on their own.",
  ),
  highlights: [
    translationKey("One command"),
    translationKey("About a minute"),
    translationKey("No config file to write"),
  ],
  features: [
    {
      icon: IconProp.ChartBar,
      title: translationKey("The vitals"),
      description: translationKey(
        "CPU, memory, disk, load and network, charted from the first minute.",
      ),
    },
    {
      icon: IconProp.ListBullet,
      title: translationKey("Down to the process"),
      description: translationKey(
        "Every process with its CPU, memory and user, so you can see what is hogging the box.",
      ),
    },
    {
      icon: IconProp.Cog,
      title: translationKey("Services and units"),
      description: translationKey(
        "systemd units on Linux and services on Windows, with failed ones in red.",
      ),
    },
    {
      icon: IconProp.Logs,
      title: translationKey("Logs from the host"),
      description: translationKey(
        "The journal on Linux, event logs on Windows and log files on macOS.",
      ),
    },
    {
      icon: IconProp.AdjustmentHorizontal,
      title: translationKey("A collector managed for you"),
      description: translationKey(
        "Change what every host collects from one place. A config that fails rolls back on its own.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for every host"),
      description: translationKey(
        "Recommended monitors for CPU, memory, disk space, load and process count.",
      ),
    },
  ],
  preview: {
    name: "prod-app-01",
    subtitle: translationKey("Ubuntu 22.04 · amd64 · 8 cores · 32 GB"),
    stats: [
      { label: translationKey("CPU"), value: "42%" },
      { label: translationKey("Memory"), value: "63%" },
      { label: translationKey("Filesystem"), value: "71%" },
      { label: translationKey("Load (1m)"), value: "2.14" },
    ],
    chart: {
      label: translationKey("CPU"),
      values: [
        31, 35, 33, 38, 44, 41, 39, 46, 52, 48, 45, 50, 47, 43, 49, 54, 50, 46,
        44, 48, 45, 42,
      ],
    },
    rows: [
      {
        name: "/",
        detail: translationKey("ext4 · 1.42 of 2 TB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("71% used"),
      },
      {
        name: "/var/lib/postgresql",
        detail: translationKey("xfs · 460 of 500 GB"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("92% used"),
      },
      {
        name: "/home",
        detail: translationKey("ext4 · 61 of 120 GB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("51% used"),
      },
      {
        name: "/boot",
        detail: translationKey("ext4 · 0.4 of 1 GB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("38% used"),
      },
    ],
    alert: {
      title: translationKey("High filesystem usage"),
      description: translationKey(
        "/var/lib/postgresql on prod-app-01 is 92% full.",
      ),
    },
  },
};

export default HOST_SHOWCASE;
