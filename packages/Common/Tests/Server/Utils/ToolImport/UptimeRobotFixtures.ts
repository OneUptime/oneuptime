import { FixtureApi, json } from "./ToolImportFixtureTransport";

/*
 * An UptimeRobot account in the v3 API's documented shapes
 * (https://uptimerobot.com/api/v3/): every monitor type the import knows,
 * the ones it does not, public status pages chosen by monitor and by tag,
 * and maintenance windows. Only the fields the adapter reads, with the
 * names and types UptimeRobot sends.
 */

export const UPTIMEROBOT_KEY: string = "ur_read_only_0123456789";

export const HOME_ID: number = 101;
export const CHECKOUT_ID: number = 102;
export const ORDERS_ID: number = 103;
export const GATEWAY_ID: number = 104;
export const DATABASE_ID: number = 105;
export const OPEN_PORT_ID: number = 106;
export const BACKUP_ID: number = 107;
export const MX_ID: number = 108;
export const SYSLOG_ID: number = 109;
export const HEALTH_ID: number = 110;
export const ADMIN_ID: number = 111;

export const PUBLIC_PAGE_ID: number = 201;
export const INTERNAL_PAGE_ID: number = 202;
export const EVERYTHING_PAGE_ID: number = 203;

export const PUBLIC_TAG_ID: number = 1;

export const UPTIMEROBOT_MONITORS: Array<Record<string, unknown>> = [
  {
    id: HOME_ID,
    friendlyName: "Home page",
    url: "https://example.com",
    type: "HTTP",
    interval: 300,
    timeout: 30,
    status: "UP",
    httpMethodType: "GET",
    successHttpResponseCodes: ["2xx", "3xx"],
    followRedirections: true,
    sslExpirationReminder: true,
    config: { sslExpirationPeriodDays: [7, 14, 30] },
    tags: [{ id: PUBLIC_TAG_ID, name: "public" }],
  },
  {
    id: CHECKOUT_ID,
    friendlyName: "Checkout",
    url: "https://shop.example.com/checkout",
    type: "KEYWORD",
    interval: 60,
    timeout: 30,
    status: "UP",
    httpMethodType: "HEAD",
    keywordType: "ALERT_NOT_EXISTS",
    keywordValue: "Pay now",
    keywordCaseType: 1,
    successHttpResponseCodes: ["200-299"],
    followRedirections: false,
    tags: [],
  },
  {
    id: ORDERS_ID,
    friendlyName: "Orders API",
    url: "https://api.example.com/orders",
    type: "HTTP",
    interval: 120,
    timeout: 90,
    status: "PAUSED",
    httpMethodType: "POST",
    customHttpHeaders: {
      "Content-Type": "application/json",
      Authorization: "Bearer orders-secret",
    },
    postValueType: "RAW_JSON",
    postValueData: { ping: true },
    tags: [],
  },
  {
    id: GATEWAY_ID,
    friendlyName: "Gateway",
    url: "10.0.0.1",
    type: "PING",
    interval: 30,
    status: "UP",
    tags: [],
  },
  {
    id: DATABASE_ID,
    friendlyName: "Database",
    url: "db.example.com",
    type: "PORT",
    port: 5432,
    portAlertCondition: "CLOSED",
    interval: 300,
    timeout: 10,
    status: "UP",
    tags: [],
  },
  {
    id: OPEN_PORT_ID,
    friendlyName: "Telnet must stay shut",
    url: "legacy.example.com",
    type: "PORT",
    port: 23,
    portAlertCondition: "OPEN",
    interval: 300,
    status: "UP",
    tags: [],
  },
  {
    id: BACKUP_ID,
    friendlyName: "Nightly backup",
    type: "HEARTBEAT",
    interval: 86400,
    gracePeriod: 3600,
    status: "UP",
    tags: [],
  },
  {
    id: MX_ID,
    friendlyName: "Mail records",
    url: "example.com",
    type: "DNS",
    interval: 3600,
    status: "UP",
    config: { dnsRecords: { MX: ["mx1.example.com"] } },
    tags: [],
  },
  {
    id: SYSLOG_ID,
    friendlyName: "Syslog",
    url: "logs.example.com",
    type: "UDP",
    port: 514,
    interval: 300,
    status: "UP",
    tags: [],
  },
  {
    id: HEALTH_ID,
    friendlyName: "Health assertions",
    url: "https://api.example.com/health",
    type: "API",
    interval: 300,
    status: "UP",
    httpMethodType: "GET",
    config: {
      apiAssertions: {
        logic: "AND",
        checks: [{ property: "$.status", comparison: "equals", target: "ok" }],
      },
    },
    tags: [],
  },
  {
    id: ADMIN_ID,
    friendlyName: "Admin panel",
    url: "https://admin.example.com",
    type: "HTTP",
    interval: 300,
    status: "UP",
    authType: "HTTP_BASIC",
    httpUsername: "admin",
    tags: [],
  },
];

export const UPTIMEROBOT_PSPS: Array<Record<string, unknown>> = [
  {
    id: PUBLIC_PAGE_ID,
    friendlyName: "Public status",
    monitorIds: [CHECKOUT_ID, HOME_ID],
    tagIds: [],
    // A page as read sends its features as "true"/"false" strings.
    customSettings: {
      features: { showUptimePercentage: "true", showBars: "false" },
    },
    isPasswordSet: false,
    customDomain: "status.example.com",
    logo: "https://cdn.example.com/logo.png",
    subscription: true,
    noIndex: true,
  },
  {
    id: INTERNAL_PAGE_ID,
    friendlyName: "Internal",
    monitorIds: [],
    tagIds: [PUBLIC_TAG_ID],
    // Booleans, as a page is written: read the same.
    customSettings: {
      features: { showUptimePercentage: false, showBars: true },
    },
    isPasswordSet: true,
    subscription: false,
  },
  {
    id: EVERYTHING_PAGE_ID,
    friendlyName: "Everything",
    isPasswordSet: false,
  },
];

export function uptimeRobotPage(
  data: Array<unknown>,
  nextCursor?: number,
): Record<string, unknown> {
  return {
    data: data,
    nextLink:
      nextCursor === undefined
        ? null
        : `https://api.uptimerobot.com/v3/monitors?cursor=${nextCursor}&limit=200`,
  };
}

// The whole account, one page per list.
export function uptimeRobotApi(): FixtureApi {
  return new FixtureApi([
    {
      path: "/v3/user/me",
      answers: [json({ email: "ops@acme.com", fullName: "Ops" })],
    },
    {
      path: "/v3/monitors",
      answers: [json(uptimeRobotPage(UPTIMEROBOT_MONITORS))],
    },
    {
      path: "/v3/psps",
      answers: [json(uptimeRobotPage(UPTIMEROBOT_PSPS))],
    },
    {
      path: "/v3/maintenance-windows",
      answers: [
        json(
          uptimeRobotPage([
            { id: 1, friendlyName: "Patch night" },
            { id: 2, friendlyName: "Quarterly" },
          ]),
        ),
      ],
    },
  ]);
}

export function uptimeRobotError(status: number, message: string): unknown {
  return { message: message, statusCode: status };
}
