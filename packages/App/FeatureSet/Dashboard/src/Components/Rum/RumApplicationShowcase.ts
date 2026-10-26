import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Real User Monitoring > All Applications shows while it has none.
const RUM_APPLICATION_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Globe,
  eyebrow: translationKey("Real user monitoring"),
  title: translationKey("See your app the way your users do"),
  description: translationKey(
    "Add the OpenTelemetry SDK to your web or mobile app. Every page load, Core Web Vital, error and session shows up, linked to the backend traces behind each click.",
  ),
  highlights: [
    translationKey("Web, iOS, Android, React Native"),
    translationKey("Data within a minute"),
    translationKey("Session Replay included"),
  ],
  features: [
    {
      icon: IconProp.Gauge,
      title: translationKey("Core Web Vitals"),
      description: translationKey(
        "LCP, INP, CLS, FCP and TTFB, each rated Good, Needs work or Poor.",
      ),
    },
    {
      icon: IconProp.ArrowTrendingUp,
      title: translationKey("Slowest routes first"),
      description: translationKey(
        "Interaction to Next Paint for every route, slowest first, so you know where to start.",
      ),
    },
    {
      icon: IconProp.PlayCircle,
      title: translationKey("Session Replay"),
      description: translationKey(
        "Watch what a user saw, jump to their first error, and spot rage and dead clicks.",
      ),
    },
    {
      icon: IconProp.FlowDiagram,
      title: translationKey("User flows"),
      description: translationKey(
        "Where people land, where they go next, and where they leave.",
      ),
    },
    {
      icon: IconProp.Waterfall,
      title: translationKey("From click to backend"),
      description: translationKey(
        "Errors and slow requests linked to the backend traces behind them.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts on what users feel"),
      description: translationKey(
        "Recommended monitors for poor vitals, failed operations and unhandled exceptions.",
      ),
    },
  ],
  preview: {
    name: "storefront-web",
    subtitle: translationKey("Browser · OpenTelemetry Web SDK"),
    stats: [
      { label: translationKey("Page loads"), value: "1.2M" },
      { label: translationKey("p95 load time"), value: "2.4 s" },
      { label: translationKey("Error rate"), value: "0.6%" },
      { label: translationKey("Exceptions"), value: "312" },
    ],
    chart: {
      label: translationKey("Page load time (p95)"),
      values: [
        2.1, 2.3, 2.2, 2.4, 2.2, 2.5, 2.3, 2.6, 2.4, 2.3, 2.5, 2.7, 2.5, 2.4,
        2.6, 2.4, 2.3, 2.5, 2.4, 2.2, 2.4, 2.3,
      ],
    },
    rows: [
      {
        name: "/",
        detail: translationKey("INP 120 ms"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Good"),
      },
      {
        name: "/checkout",
        detail: translationKey("INP 540 ms"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Poor"),
      },
      {
        name: "/products/:id",
        detail: translationKey("INP 168 ms"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Good"),
      },
      {
        name: "/search",
        detail: translationKey("INP 190 ms"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Good"),
      },
    ],
    alert: {
      title: translationKey("Poor Interaction to Next Paint"),
      description: translationKey(
        "The average INP of storefront-web rose to 512 ms.",
      ),
    },
  },
};

export default RUM_APPLICATION_SHOWCASE;
