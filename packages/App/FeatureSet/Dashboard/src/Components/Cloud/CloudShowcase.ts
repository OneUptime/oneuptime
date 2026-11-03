import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

/*
 * What Cloud's Overview shows while the project has no cloud account: what
 * Cloud gives once one is connected - every resource and its health, what
 * it costs, how to spend less, budgets that alert - an example of a
 * connected account, and the way to connect one (Cloud > Connect).
 */
const CLOUD_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Cloud,
  eyebrow: translationKey("Cloud"),
  title: translationKey(
    "See every resource in your cloud, how it is doing and what it costs",
  ),
  description: translationKey(
    "Connect an AWS account, Azure subscription or Google Cloud project with one command. OneUptime lists every resource in it, reads their key metrics, keeps what they cost and tells you how to spend less.",
  ),
  highlights: [
    translationKey("One command in your cloud's terminal"),
    translationKey("Read-only access"),
    translationKey("AWS, Azure and Google Cloud"),
  ],
  features: [
    {
      icon: IconProp.SquareStack,
      title: translationKey("Every resource, found"),
      description: translationKey(
        "Virtual machines, databases, load balancers, buckets and queues, listed from your cloud's own index with their tags.",
      ),
    },
    {
      icon: IconProp.Heart,
      title: translationKey("Health from key metrics"),
      description: translationKey(
        "Failing status checks, failed requests, throttling and full disks, read on every pass and listed under Needs attention.",
      ),
    },
    {
      icon: IconProp.Billing,
      title: translationKey("What it costs"),
      description: translationKey(
        "Each day's spend by service, Region, account and resource, and where the month is heading.",
      ),
    },
    {
      icon: IconProp.ArrowTrendingDown,
      title: translationKey("Ways to spend less"),
      description: translationKey(
        "Smaller sizes, idle resources and commitments, from your cloud's own recommender.",
      ),
    },
    {
      icon: IconProp.Alert,
      title: translationKey("Budgets that alert"),
      description: translationKey(
        "A monthly budget for one account or all of them, with an alert before it is spent.",
      ),
    },
    {
      icon: IconProp.Activity,
      title: translationKey("Every change"),
      description: translationKey(
        "What changed in an account and who changed it, from its activity log, on each resource's timeline.",
      ),
    },
  ],
  preview: {
    name: "production · 123456789012",
    subtitle: translationKey("AWS · 248 resources"),
    stats: [
      { label: translationKey("Resources"), value: "248" },
      { label: translationKey("Needs attention"), value: "2" },
      { label: translationKey("Spend this month"), value: "$4,120" },
      { label: translationKey("Savings available"), value: "$310" },
    ],
    // A day's spend a bar would show: lower at weekends, a little up a week.
    chart: {
      label: translationKey("Daily spend"),
      range: translationKey("Last 30 days"),
      values: [
        131, 128, 136, 134, 140, 122, 118, 138, 142, 139, 145, 141, 126, 121,
        143, 147, 144, 150, 146, 129, 124, 149, 152, 148, 154, 151, 133, 128,
        153, 156,
      ],
    },
    rows: [
      {
        name: "orders-db",
        detail: translationKey("RDS instance · CPU at 41%"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
      {
        name: "checkout-alb",
        detail: translationKey("Load balancer · 6% of requests failed"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Degraded"),
      },
      {
        name: "events-queue",
        detail: translationKey("SQS queue · oldest message waiting 2 hours"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Unhealthy"),
      },
      {
        name: "build-runner-3",
        detail: translationKey("EC2 instance · could be a size smaller"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
    ],
    alert: {
      title: translationKey("Alert created"),
      description: translationKey(
        'Cloud budget "production" is on course to be passed this month.',
      ),
    },
  },
};

export default CLOUD_SHOWCASE;
