import MonitorType from "../Monitor/MonitorType";

/*
 * WHAT A SAMPLE PROJECT HOLDS (issue #6808): "Acme Shop", a small online
 * shop, with one story told through every Essentials product and the
 * telemetry of one service.
 *
 * Ten minutes ago its checkout got slow. A monitor went Degraded, an
 * incident was declared, the on-call policy paged the engineer on call,
 * Maya, who acknowledged it four minutes later and is looking into it;
 * the status page says so to customers. The service behind checkout shows
 * it too: its latency and errors climb in its metrics, its traces and its
 * logs. Two earlier incidents were resolved, one with a postmortem; a few
 * alerts fired; a database upgrade is scheduled; an SLO counts what the
 * slow checkout costs.
 *
 * Every moment is a number of minutes before the sample is made, so it
 * always reads as now, whenever it is made (SampleProjectSeeder adds them
 * to the moment it runs). Pure: the server and the tests read it.
 */

export const MINUTES_IN_A_DAY: number = 24 * 60;

// How far back the monitors' history reaches.
export const SAMPLE_MONITOR_HISTORY_DAYS: number = 30;

export enum SampleMonitorStatus {
  Operational = "Operational",
  Degraded = "Degraded",
  Offline = "Offline",
}

/*
 * A stretch of a monitor's history that was not operational, as minutes
 * before the sample was made; `endsMinutesAgo` null while it lasts.
 */
export interface SampleMonitorOutage {
  status: SampleMonitorStatus;
  startsMinutesAgo: number;
  endsMinutesAgo: number | null;
  // Why it changed, as a monitor's timeline says it.
  rootCause: string;
}

export interface SampleMonitor {
  key: string;
  name: string;
  description: string;
  monitorType: MonitorType;
  // A URL, a host name or an IP address, as the monitor's type reads it.
  destination: string | null;
  port: number | null;
  outages: Array<SampleMonitorOutage>;
  // Shown on the sample's status page, under this group.
  statusPageGroup: string | null;
}

export const SAMPLE_MONITORS: ReadonlyArray<SampleMonitor> = [
  {
    key: "storefront",
    name: "Storefront",
    description: "The shop's home page.",
    monitorType: MonitorType.Website,
    destination: "https://shop.example.com",
    port: null,
    outages: [],
    statusPageGroup: "Website",
  },
  {
    key: "checkout",
    name: "Checkout",
    description: "The page customers pay on.",
    monitorType: MonitorType.Website,
    destination: "https://shop.example.com/checkout",
    port: null,
    outages: [
      {
        status: SampleMonitorStatus.Offline,
        startsMinutesAgo: 3 * MINUTES_IN_A_DAY + 2,
        endsMinutesAgo: 3 * MINUTES_IN_A_DAY - 40,
        rootCause:
          "Checkout answered 502 Bad Gateway after release 2.14 went out.",
      },
      {
        status: SampleMonitorStatus.Degraded,
        startsMinutesAgo: 27,
        endsMinutesAgo: null,
        rootCause: "Checkout took longer than 2 seconds to answer.",
      },
    ],
    statusPageGroup: "Website",
  },
  {
    key: "product-images",
    name: "Product Images",
    description: "The CDN that serves product photos.",
    monitorType: MonitorType.Website,
    destination: "https://images.shop.example.com",
    port: null,
    outages: [],
    statusPageGroup: "Website",
  },
  {
    key: "payments-api",
    name: "Payments API",
    description: "Takes card payments for checkout.",
    monitorType: MonitorType.API,
    destination: "https://api.shop.example.com/payments/health",
    port: null,
    outages: [
      {
        status: SampleMonitorStatus.Degraded,
        startsMinutesAgo: 9 * MINUTES_IN_A_DAY + 4,
        endsMinutesAgo: 9 * MINUTES_IN_A_DAY - 56,
        rootCause: "The card processor took more than 5 seconds to answer.",
      },
    ],
    statusPageGroup: "API",
  },
  {
    key: "search-api",
    name: "Search API",
    description: "Answers product searches.",
    monitorType: MonitorType.API,
    destination: "https://api.shop.example.com/search/health",
    port: null,
    outages: [],
    statusPageGroup: "API",
  },
  {
    key: "database",
    name: "Database Host",
    description: "The primary PostgreSQL server.",
    monitorType: MonitorType.Ping,
    destination: "db-1.shop.example.com",
    port: null,
    outages: [],
    statusPageGroup: null,
  },
  {
    key: "cache",
    name: "Redis Cache",
    description: "Sessions and carts.",
    monitorType: MonitorType.Port,
    destination: "cache-1.shop.example.com",
    port: 6379,
    outages: [],
    statusPageGroup: null,
  },
  {
    key: "certificate",
    name: "Shop Certificate",
    description: "The TLS certificate of shop.example.com.",
    monitorType: MonitorType.SSLCertificate,
    destination: "https://shop.example.com",
    port: null,
    outages: [],
    statusPageGroup: null,
  },
  {
    key: "dns",
    name: "Shop DNS",
    description: "Resolves shop.example.com.",
    monitorType: MonitorType.DNS,
    destination: "shop.example.com",
    port: null,
    outages: [],
    statusPageGroup: null,
  },
  {
    key: "nightly-backup",
    name: "Nightly Backup",
    description: "The backup job reports here when it finishes.",
    monitorType: MonitorType.IncomingRequest,
    destination: null,
    port: null,
    outages: [],
    statusPageGroup: null,
  },
];

// The groups of the sample's status page, in order.
export const SAMPLE_STATUS_PAGE_GROUPS: ReadonlyArray<string> = [
  "Website",
  "API",
];

export const SAMPLE_STATUS_PAGE = {
  name: "Acme Shop Status",
  description: "What customers see: the shop, its checkout and its APIs.",
  pageTitle: "Acme Shop Status",
  pageDescription: "Live status of the Acme Shop website and APIs.",
} as const;

export enum SampleIncidentState {
  Identified = "Identified",
  Acknowledged = "Acknowledged",
  Resolved = "Resolved",
}

export enum SampleIncidentSeverity {
  Critical = "Critical Incident",
  Major = "Major Incident",
  Minor = "Minor Incident",
}

export interface SampleNote {
  minutesAgo: number;
  // A sample person's handle (SAMPLE_PEOPLE), or null for the owner.
  authorHandle: string | null;
  note: string;
}

export interface SampleIncident {
  key: string;
  title: string;
  description: string;
  severity: SampleIncidentSeverity;
  monitorKeys: Array<string>;
  declaredMinutesAgo: number;
  // Each state it moved through, in order, from the one it was declared in.
  states: Array<{ state: SampleIncidentState; minutesAgo: number }>;
  internalNotes: Array<SampleNote>;
  publicNotes: Array<SampleNote>;
  rootCause: string | null;
  postmortemNote: string | null;
  // The incident the on-call policy paged for: the open one.
  isPagedByOnCall: boolean;
}

export const SAMPLE_INCIDENTS: ReadonlyArray<SampleIncident> = [
  {
    key: "payments-timeouts",
    title: "Payments API timing out",
    description:
      "Card payments took more than 5 seconds, and some checkouts failed.",
    severity: SampleIncidentSeverity.Major,
    monitorKeys: ["payments-api"],
    declaredMinutesAgo: 9 * MINUTES_IN_A_DAY + 2,
    states: [
      {
        state: SampleIncidentState.Identified,
        minutesAgo: 9 * MINUTES_IN_A_DAY + 2,
      },
      {
        state: SampleIncidentState.Acknowledged,
        minutesAgo: 9 * MINUTES_IN_A_DAY - 4,
      },
      {
        state: SampleIncidentState.Resolved,
        minutesAgo: 9 * MINUTES_IN_A_DAY - 56,
      },
    ],
    internalNotes: [
      {
        minutesAgo: 9 * MINUTES_IN_A_DAY - 10,
        authorHandle: "sam.okafor",
        note: "The card processor's status page shows degraded performance in our region. Raising our timeout will not help; switching traffic to the backup processor.",
      },
    ],
    publicNotes: [
      {
        minutesAgo: 9 * MINUTES_IN_A_DAY - 8,
        authorHandle: "sam.okafor",
        note: "Some card payments are slow or failing. We are moving payments to our backup processor.",
      },
      {
        minutesAgo: 9 * MINUTES_IN_A_DAY - 56,
        authorHandle: "sam.okafor",
        note: "Payments are working normally again.",
      },
    ],
    rootCause:
      "The card processor was slow in our region, and checkout waited for it with no fallback.",
    postmortemNote: [
      "## Summary",
      "",
      "For 58 minutes, card payments took more than 5 seconds and about 4% of checkouts failed.",
      "",
      "## What happened",
      "",
      "- The card processor slowed down in our region.",
      "- The Payments API monitor went Degraded and paged the on-call engineer.",
      "- We switched payments to the backup processor, and they recovered.",
      "",
      "## What we will change",
      "",
      "- Fall back to the backup processor automatically after 2 seconds.",
      "- Alert on payment latency, not only on the health check.",
    ].join("\n"),
    isPagedByOnCall: false,
  },
  {
    key: "checkout-release-errors",
    title: "Checkout errors after release 2.14",
    description:
      "Checkout answered 502 Bad Gateway for every customer after release 2.14.",
    severity: SampleIncidentSeverity.Critical,
    monitorKeys: ["checkout"],
    declaredMinutesAgo: 3 * MINUTES_IN_A_DAY + 1,
    states: [
      {
        state: SampleIncidentState.Identified,
        minutesAgo: 3 * MINUTES_IN_A_DAY + 1,
      },
      {
        state: SampleIncidentState.Acknowledged,
        minutesAgo: 3 * MINUTES_IN_A_DAY - 2,
      },
      {
        state: SampleIncidentState.Resolved,
        minutesAgo: 3 * MINUTES_IN_A_DAY - 40,
      },
    ],
    internalNotes: [
      {
        minutesAgo: 3 * MINUTES_IN_A_DAY - 12,
        authorHandle: "lena.fischer",
        note: "Release 2.14 changed the checkout service's port. Rolling back.",
      },
    ],
    publicNotes: [
      {
        minutesAgo: 3 * MINUTES_IN_A_DAY - 5,
        authorHandle: "lena.fischer",
        note: "Checkout is failing for every customer. We have found the cause and are rolling back.",
      },
    ],
    rootCause:
      "Release 2.14 moved checkout to a port the load balancer did not know.",
    postmortemNote: null,
    isPagedByOnCall: false,
  },
  {
    key: "checkout-slow",
    title: "Checkout is slow for some customers",
    description:
      "Checkout takes more than 2 seconds for about one customer in five. Payments still go through.",
    severity: SampleIncidentSeverity.Major,
    monitorKeys: ["checkout"],
    declaredMinutesAgo: 25,
    states: [
      { state: SampleIncidentState.Identified, minutesAgo: 25 },
      { state: SampleIncidentState.Acknowledged, minutesAgo: 21 },
    ],
    internalNotes: [
      {
        minutesAgo: 18,
        authorHandle: "maya.chen",
        note: "checkout-api's p95 latency went from 300 ms to 1.8 s at the same time as a spike in database connections. Looking at the slow query log.",
      },
      {
        minutesAgo: 9,
        authorHandle: "maya.chen",
        note: "Found it: the new discount query scans the whole orders table. Adding an index now.",
      },
    ],
    publicNotes: [
      {
        minutesAgo: 15,
        authorHandle: "maya.chen",
        note: "Checkout is slow for some customers. Payments still go through, and we are working on a fix.",
      },
    ],
    rootCause: null,
    postmortemNote: null,
    isPagedByOnCall: true,
  },
];

export enum SampleAlertState {
  Identified = "Identified",
  Acknowledged = "Acknowledged",
  Resolved = "Resolved",
}

export enum SampleAlertSeverity {
  High = "High",
  Low = "Low",
}

export interface SampleAlert {
  key: string;
  title: string;
  description: string;
  severity: SampleAlertSeverity;
  monitorKey: string | null;
  states: Array<{ state: SampleAlertState; minutesAgo: number }>;
}

export const SAMPLE_ALERTS: ReadonlyArray<SampleAlert> = [
  {
    key: "checkout-error-rate",
    title: "Error rate above 2% on checkout-api",
    description:
      "checkout-api answered 5xx to more than 2% of requests for 5 minutes.",
    severity: SampleAlertSeverity.High,
    monitorKey: "checkout",
    states: [
      { state: SampleAlertState.Identified, minutesAgo: 28 },
      { state: SampleAlertState.Acknowledged, minutesAgo: 22 },
    ],
  },
  {
    key: "checkout-latency",
    title: "p95 latency above 800 ms on checkout-api",
    description:
      "checkout-api's p95 latency stayed above 800 ms for 5 minutes.",
    severity: SampleAlertSeverity.High,
    monitorKey: "checkout",
    states: [{ state: SampleAlertState.Identified, minutesAgo: 26 }],
  },
  {
    key: "database-disk",
    title: "Disk space below 15% on db-1",
    description: "The database host's data disk had less than 15% free.",
    severity: SampleAlertSeverity.Low,
    monitorKey: "database",
    states: [
      { state: SampleAlertState.Identified, minutesAgo: 2 * MINUTES_IN_A_DAY },
      {
        state: SampleAlertState.Resolved,
        minutesAgo: 2 * MINUTES_IN_A_DAY - 35,
      },
    ],
  },
];

/*
 * THE ON-CALL POLICY: two levels. The engineer on call this week (a weekly
 * rotation of three), and after ten minutes without an acknowledgement,
 * the engineering manager.
 */
export const SAMPLE_ON_CALL = {
  policyName: "Acme Shop Production",
  policyDescription:
    "Pages whoever is on call for the shop, then the engineering manager.",
  scheduleName: "Shop Engineers",
  scheduleDescription: "A weekly rotation of the shop's engineers.",
  layerName: "Weekly Rotation",
  // The engineers of the rotation, in turn: the first is on call this week.
  rotationHandles: ["maya.chen", "sam.okafor", "lena.fischer"],
  firstLevelName: "Engineer on call",
  secondLevelName: "Engineering manager",
  secondLevelHandle: "diego.alvarez",
  escalateAfterInMinutes: 10,
  // How long the engineer on call took to acknowledge the open incident.
  acknowledgedAfterMinutes: 4,
} as const;

export const SAMPLE_MAINTENANCE = {
  title: "Database upgrade to PostgreSQL 17",
  description:
    "Checkout may be slow for up to 15 minutes while the database fails over.",
  // From 3 days after the sample is made, for an hour.
  startsInMinutes: 3 * MINUTES_IN_A_DAY,
  durationInMinutes: 60,
  monitorKeys: ["checkout", "database"],
} as const;

// The one service with telemetry, and what is built on it.
export const SAMPLE_SERVICE = {
  name: "checkout-api",
  description:
    "Takes the cart, prices it and asks the Payments API to charge it.",
} as const;

export const SAMPLE_SLO = {
  name: "Checkout availability",
  description: "Checkout is up 99.9% of the time, over 30 days.",
  monitorKey: "checkout",
  targetPercentage: 99.9,
  windowDays: 30,
} as const;

export const SAMPLE_DASHBOARD = {
  name: "Checkout Service",
  description: "Request rate, latency, errors and resources of checkout-api.",
} as const;
