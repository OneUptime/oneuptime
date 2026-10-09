import { FixtureApi, FixtureRoute, json } from "./ToolImportFixtureTransport";

/*
 * A Pingdom account in API 3.1's documented shapes
 * (https://docs.pingdom.com/api/): the check list as GET /checks answers
 * it, and each check's own settings as GET /checks/{id} answers them -
 * keyed by its type, as Pingdom writes them. Every check type the import
 * knows, the ones it does not, transaction checks and maintenance windows.
 */

export const PINGDOM_TOKEN: string = "pingdom_read_0123456789";

export const HOME_ID: number = 1001;
export const ORDERS_ID: number = 1002;
export const LOGIN_ID: number = 1003;
export const DATABASE_ID: number = 1004;
export const REDIS_ID: number = 1005;
export const MAIL_ID: number = 1006;
export const INBOX_ID: number = 1007;
export const GATEWAY_ID: number = 1008;
export const NAMES_ID: number = 1009;
export const SYSLOG_ID: number = 1010;
export const CUSTOM_ID: number = 1011;
export const PLAIN_ID: number = 1012;

export const TRANSACTION_ID: number = 77;

function listed(data: {
  id: number;
  name: string;
  type: string;
  hostname: string;
  resolution: number;
  status?: string;
}): Record<string, unknown> {
  return {
    id: data.id,
    name: data.name,
    type: data.type,
    hostname: data.hostname,
    resolution: data.resolution,
    status: data.status || "up",
    created: 1700000000,
    lasttesttime: 1760000000,
    tags: [],
  };
}

export const PINGDOM_CHECKS: Array<Record<string, unknown>> = [
  listed({
    id: HOME_ID,
    name: "Home page",
    type: "http",
    hostname: "example.com",
    resolution: 5,
  }),
  listed({
    id: ORDERS_ID,
    name: "Orders API",
    type: "http",
    hostname: "api.example.com",
    resolution: 1,
    status: "paused",
  }),
  listed({
    id: LOGIN_ID,
    name: "Login",
    type: "http",
    hostname: "login.example.com",
    resolution: 15,
  }),
  listed({
    id: DATABASE_ID,
    name: "Database",
    type: "tcp",
    hostname: "db.example.com",
    resolution: 5,
  }),
  listed({
    id: REDIS_ID,
    name: "Redis",
    type: "tcp",
    hostname: "cache.example.com",
    resolution: 1,
  }),
  listed({
    id: MAIL_ID,
    name: "Mail",
    type: "smtp",
    hostname: "mail.example.com",
    resolution: 5,
  }),
  listed({
    id: INBOX_ID,
    name: "Inbox",
    type: "imap",
    hostname: "imap.example.com",
    resolution: 30,
  }),
  listed({
    id: GATEWAY_ID,
    name: "Gateway",
    type: "ping",
    hostname: "10.0.0.1",
    resolution: 1,
  }),
  listed({
    id: NAMES_ID,
    name: "Name server",
    type: "dns",
    hostname: "example.com",
    resolution: 60,
  }),
  listed({
    id: SYSLOG_ID,
    name: "Syslog",
    type: "udp",
    hostname: "logs.example.com",
    resolution: 5,
  }),
  listed({
    id: CUSTOM_ID,
    name: "Custom",
    type: "httpcustom",
    hostname: "custom.example.com",
    resolution: 5,
  }),
  listed({
    id: PLAIN_ID,
    name: "Plain site",
    type: "http",
    hostname: "plain.example.com",
    resolution: 5,
  }),
];

// Each check's own settings, under `type.<its type>`.
export const PINGDOM_CHECK_DETAILS: Record<number, Record<string, unknown>> = {
  [HOME_ID]: {
    type: {
      http: {
        url: "/",
        encryption: true,
        port: 443,
        shouldcontain: "Welcome",
        requestheaders: { "User-Agent": "Pingdom.com_bot_version_1.4" },
        verify_certificate: true,
        ssl_down_days_before: 14,
      },
    },
  },
  [ORDERS_ID]: {
    type: {
      http: {
        url: "/orders",
        encryption: true,
        port: 8443,
        postdata: '{"ping": true}',
        requestheaders: {
          "User-Agent": "Pingdom.com_bot_version_1.4",
          "X-Team": "shop",
          "X-Api-Key": "orders-secret",
        },
        verify_certificate: true,
        ssl_down_days_before: 0,
      },
    },
  },
  [LOGIN_ID]: {
    type: {
      http: {
        url: "login",
        encryption: false,
        port: 80,
        shouldnotcontain: "Error",
        username: "admin",
        // "Name: value" strings, the other shape Pingdom writes.
        requestheaders: ["X-Env: prod"],
        verify_certificate: false,
        ssl_down_days_before: 7,
      },
    },
  },
  [DATABASE_ID]: {
    type: { tcp: { port: 5432 } },
  },
  [REDIS_ID]: {
    type: { tcp: { port: 6379, stringtosend: "PING", stringtoexpect: "PONG" } },
  },
  [MAIL_ID]: {
    type: { smtp: { encryption: true } },
  },
  [INBOX_ID]: {
    type: { imap: { encryption: false } },
  },
  [NAMES_ID]: {
    type: { dns: { nameserver: "8.8.8.8", expectedip: "93.184.216.34" } },
  },
  [PLAIN_ID]: {
    type: { http: { url: "/", encryption: true } },
  },
};

export function pingdomCheckRoute(id: number): FixtureRoute {
  return {
    path: `/api/3.1/checks/${id}`,
    answers: [
      json({ check: { id: id, ...(PINGDOM_CHECK_DETAILS[id] || {}) } }),
    ],
  };
}

export function pingdomApi(): FixtureApi {
  return new FixtureApi([
    {
      path: "/api/3.1/checks",
      answers: [
        json({ checks: PINGDOM_CHECKS, counts: { total: 12, limited: 12 } }),
      ],
    },
    ...Object.keys(PINGDOM_CHECK_DETAILS).map((id: string) => {
      return pingdomCheckRoute(Number(id));
    }),
    {
      path: "/api/3.1/tms/check",
      answers: [
        json({
          checks: [
            { id: TRANSACTION_ID, name: "Checkout flow", active: true },
            { name: "No id" },
          ],
        }),
      ],
    },
    {
      path: "/api/3.1/maintenance",
      answers: [
        json({
          maintenance: [
            { id: 1, description: "Patch night" },
            { id: 2, description: "Quarterly" },
            { id: 3, description: "Move" },
          ],
        }),
      ],
    },
  ]);
}

export function pingdomError(status: number, message: string): unknown {
  return { error: { statuscode: status, statusdesc: "", errormessage: message } };
}
