import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What IoT > All Fleets shows while the project has no fleet.
const IOT_FLEET_SHOWCASE: ResourceShowcase = {
  icon: IconProp.IoT,
  eyebrow: translationKey("IoT monitoring"),
  title: translationKey("Know which devices are online, and which need help"),
  description: translationKey(
    "Send readings from your devices over OpenTelemetry or MQTT, with no agent to install. Each fleet shows its devices' battery, signal and temperature, and flags the ones that go quiet.",
  ),
  highlights: [
    translationKey("OpenTelemetry or MQTT"),
    translationKey("No agent to install"),
    translationKey("Data within a minute"),
  ],
  features: [
    {
      icon: IconProp.Signal,
      title: translationKey("The whole fleet"),
      description: translationKey(
        "Online and total devices, average battery and average signal, at a glance.",
      ),
    },
    {
      icon: IconProp.ExclaimationCircle,
      title: translationKey("Devices needing attention"),
      description: translationKey(
        "The devices that are offline, low on battery or on a weak signal, listed first.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("Every device's history"),
      description: translationKey(
        "Battery, signal, temperature and memory charts for each device.",
      ),
    },
    {
      icon: IconProp.Key,
      title: translationKey("A registry of devices"),
      description: translationKey(
        "MQTT credentials for each device, which you can revoke one at a time.",
      ),
    },
    {
      icon: IconProp.Bolt,
      title: translationKey("Offline in an instant"),
      description: translationKey(
        "An MQTT Last Will marks a device offline the moment its connection drops.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for devices"),
      description: translationKey(
        "Recommended monitors for devices offline, low battery, weak signal and high temperature.",
      ),
    },
  ],
  preview: {
    name: "building-a-sensors",
    subtitle: translationKey("40 devices · MQTT"),
    stats: [
      { label: translationKey("Online"), value: "38/40" },
      { label: translationKey("Devices"), value: "40" },
      { label: translationKey("Avg battery"), value: "72%" },
      { label: translationKey("Avg signal"), value: "-67 dBm" },
    ],
    chart: {
      label: translationKey("Battery level"),
      values: [
        84, 83, 83, 82, 81, 81, 80, 79, 79, 78, 77, 77, 76, 75, 75, 74, 74, 73,
        73, 72, 72, 72,
      ],
    },
    rows: [
      {
        name: "sensor-001",
        detail: translationKey("87% battery · -61 dBm"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Online"),
      },
      {
        name: "sensor-017",
        detail: translationKey("Last seen 42 minutes ago"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Offline"),
      },
      {
        name: "gw-01",
        detail: translationKey("Gateway"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Online"),
      },
      {
        name: "sensor-002",
        detail: translationKey("79% battery · -70 dBm"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Online"),
      },
    ],
    alert: {
      title: translationKey("Device offline"),
      description: translationKey(
        "sensor-017 in building-a-sensors stopped reporting.",
      ),
    },
  },
};

export default IOT_FLEET_SHOWCASE;
