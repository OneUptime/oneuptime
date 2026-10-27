import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Queues > All Queues shows while the project has no queue.
const MESSAGE_QUEUE_SHOWCASE: ResourceShowcase = {
  icon: IconProp.QueueList,
  eyebrow: translationKey("Queue monitoring"),
  title: translationKey("Know when a queue backs up, and why"),
  description: translationKey(
    "OneUptime finds queues and topics in the messaging spans your services already send, or add one by hand. See who publishes and consumes each one, and the broker's backlog, lag and dead letters.",
  ),
  highlights: [
    translationKey("Found in your traces"),
    translationKey("14 messaging systems"),
    translationKey("Backlog and lag alerts"),
  ],
  features: [
    {
      icon: IconProp.MagnifyingGlass,
      title: translationKey("Found, not configured"),
      description: translationKey(
        "Queues and topics show up from your messaging spans, with URLs and ARNs folded into one queue.",
      ),
    },
    {
      icon: IconProp.ArrowUpDown,
      title: translationKey("Producers and consumers"),
      description: translationKey(
        "Every service that publishes to a queue or consumes from it, with its own counts, errors and p95.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("Throughput and latency"),
      description: translationKey(
        "Messages published and consumed, errors and p95 processing time, over time.",
      ),
    },
    {
      icon: IconProp.Gauge,
      title: translationKey("Broker health"),
      description: translationKey(
        "Backlog, consumer and partition lag, dead letters and the oldest message's age, from your broker's metrics.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts on backlog and lag"),
      description: translationKey(
        "Create a monitor from any broker gauge, starting from thresholds you can tune.",
      ),
    },
    {
      icon: IconProp.Waterfall,
      title: translationKey("Every message, traced"),
      description: translationKey(
        "The spans of every producer and consumer of a queue, one click from its overview.",
      ),
    },
  ],
  preview: {
    name: "orders",
    subtitle: translationKey("Apache Kafka · kafka-1:9092"),
    stats: [
      { label: translationKey("Published"), value: "1.82M" },
      { label: translationKey("Consumed"), value: "1.79M" },
      { label: translationKey("Errors"), value: "12" },
      { label: translationKey("p95 processing"), value: "184 ms" },
    ],
    chart: {
      label: translationKey("Messages"),
      values: [
        30, 34, 41, 38, 45, 52, 49, 58, 61, 57, 64, 70, 66, 72, 69, 75, 71, 78,
        74, 80, 77, 82,
      ],
    },
    rows: [
      {
        name: "checkout-api",
        detail: translationKey("Producer · 1.82M published"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Publishing"),
      },
      {
        name: "fulfillment-worker",
        detail: translationKey("Consumer · 48,210 behind"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Falling behind"),
      },
      {
        name: "email-sender",
        detail: translationKey("Consumer · 1.79M consumed"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Consuming"),
      },
      {
        name: "analytics-ingest",
        detail: translationKey("Consumer · 1.79M consumed"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Consuming"),
      },
    ],
    alert: {
      title: translationKey("Consumer lag high"),
      description: translationKey(
        "fulfillment-worker is 48,210 messages behind on orders.",
      ),
    },
  },
};

export default MESSAGE_QUEUE_SHOWCASE;
