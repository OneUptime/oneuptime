import { FixtureApi, FixtureRoute, json } from "./ToolImportFixtureTransport";

/*
 * A StatusCake account in API v1's documented shapes
 * (https://developers.statuscake.com/api/): uptime checks as the list
 * gives them (an overview each) and as GET /v1/uptime/{id} gives them (all
 * their settings), SSL and heartbeat checks, and maintenance windows. Every
 * uptime test type there is, and one the import does not know.
 */

export const STATUSCAKE_KEY: string = "statuscake_key_0123456789";

export const HOME_ID: string = "5001";
export const ORDERS_ID: string = "5002";
export const DOCS_ID: string = "5003";
export const ERROR_FREE_ID: string = "5004";
export const GATEWAY_ID: string = "5005";
export const DATABASE_ID: string = "5006";
export const MAIL_ID: string = "5007";
export const BASTION_ID: string = "5008";
export const NAMES_ID: string = "5009";
export const PUSH_ID: string = "5010";

export const CERTIFICATE_ID: string = "6001";
export const SHOP_CERTIFICATE_ID: string = "6002";
export const BACKUP_HEARTBEAT_ID: string = "7001";

function overview(data: {
  id: string;
  name: string;
  test_type: string;
  website_url: string;
  check_rate: number;
  paused?: boolean;
}): Record<string, unknown> {
  return {
    id: data.id,
    name: data.name,
    test_type: data.test_type,
    website_url: data.website_url,
    check_rate: data.check_rate,
    paused: data.paused || false,
    status: "up",
    contact_groups: [],
    tags: [],
    uptime: 100,
  };
}

export const STATUSCAKE_UPTIME: Array<Record<string, unknown>> = [
  overview({
    id: HOME_ID,
    name: "Home page",
    test_type: "HTTP",
    website_url: "https://example.com",
    check_rate: 300,
  }),
  overview({
    id: ORDERS_ID,
    name: "Orders API",
    test_type: "HTTP",
    website_url: "https://api.example.com/orders",
    check_rate: 60,
  }),
  overview({
    id: DOCS_ID,
    name: "Docs",
    test_type: "HEAD",
    website_url: "https://docs.example.com",
    // Constantly: as often as OneUptime can.
    check_rate: 0,
    paused: true,
  }),
  overview({
    id: ERROR_FREE_ID,
    name: "Error free",
    test_type: "HTTP",
    website_url: "https://example.com/health",
    check_rate: 1800,
  }),
  overview({
    id: GATEWAY_ID,
    name: "Gateway",
    test_type: "PING",
    website_url: "10.0.0.1",
    check_rate: 30,
  }),
  overview({
    id: DATABASE_ID,
    name: "Database",
    test_type: "TCP",
    website_url: "db.example.com",
    check_rate: 300,
  }),
  overview({
    id: MAIL_ID,
    name: "Mail",
    test_type: "SMTP",
    website_url: "mail.example.com",
    check_rate: 300,
  }),
  overview({
    id: BASTION_ID,
    name: "Bastion",
    test_type: "SSH",
    website_url: "ssh://bastion.example.com:2222/",
    check_rate: 900,
  }),
  overview({
    id: NAMES_ID,
    name: "Names",
    test_type: "DNS",
    website_url: "example.com",
    check_rate: 3600,
  }),
  overview({
    id: PUSH_ID,
    name: "Old push",
    test_type: "PUSH",
    website_url: "https://example.com/push",
    check_rate: 300,
  }),
];

// Each uptime check's own settings, as GET /v1/uptime/{id} answers.
export const STATUSCAKE_UPTIME_DETAILS: Record<string, Record<string, unknown>> =
  {
    [HOME_ID]: {
      follow_redirects: true,
      timeout: 15,
      find_string: "Welcome",
      do_not_find: false,
      // The codes that raise an alert.
      status_codes: ["404", "500", "502", "503", "504"],
      enable_ssl_alert: true,
      custom_header: "",
      post_body: "",
      post_raw: "",
    },
    [ORDERS_ID]: {
      post_raw: '{"ping": true}',
      custom_header: '{"X-Team":"shop","X-Auth-Token":"orders-secret"}',
      status_codes: [],
      enable_ssl_alert: false,
    },
    [DOCS_ID]: {
      follow_redirects: true,
      find_string: "",
      status_codes: [],
    },
    [ERROR_FREE_ID]: {
      find_string: "Exception",
      do_not_find: true,
      status_codes: [],
    },
    [DATABASE_ID]: {
      port: 5432,
      timeout: 10,
    },
    [MAIL_ID]: {},
    [BASTION_ID]: {
      port: 2222,
    },
    [NAMES_ID]: {
      dns_server: "8.8.8.8",
      dns_ips: ["93.184.216.34"],
    },
    [PUSH_ID]: {},
  };

export const STATUSCAKE_SSL: Array<Record<string, unknown>> = [
  {
    id: CERTIFICATE_ID,
    website_url: "https://example.com",
    check_rate: 86400,
    alert_at: [1, 7, 30],
    paused: false,
  },
  {
    id: SHOP_CERTIFICATE_ID,
    // No scheme: a certificate is read over https all the same.
    website_url: "shop.example.com",
    check_rate: 3600,
    alert_at: [],
    paused: true,
  },
];

export const STATUSCAKE_HEARTBEATS: Array<Record<string, unknown>> = [
  {
    id: BACKUP_HEARTBEAT_ID,
    name: "Nightly backup",
    period: 86400,
    paused: false,
    status: "up",
  },
  // No id: skipped.
  { name: "Ghost", period: 60 },
];

export function statusCakePage(
  data: Array<unknown>,
  pageCount: number = 1,
  page: number = 1,
): Record<string, unknown> {
  return {
    data: data,
    metadata: {
      page: page,
      per_page: 100,
      page_count: pageCount,
      total_count: data.length,
    },
  };
}

export function statusCakeDetailRoute(id: string): FixtureRoute {
  const listed: Record<string, unknown> | undefined = STATUSCAKE_UPTIME.find(
    (test: Record<string, unknown>): boolean => {
      return test["id"] === id;
    },
  );

  return {
    path: `/v1/uptime/${id}`,
    answers: [
      json({ data: { ...(listed || {}), ...STATUSCAKE_UPTIME_DETAILS[id] } }),
    ],
  };
}

export function statusCakeApi(): FixtureApi {
  return new FixtureApi([
    {
      path: "/v1/uptime",
      answers: [json(statusCakePage(STATUSCAKE_UPTIME))],
    },
    ...Object.keys(STATUSCAKE_UPTIME_DETAILS).map(statusCakeDetailRoute),
    {
      path: "/v1/ssl",
      answers: [json(statusCakePage(STATUSCAKE_SSL))],
    },
    {
      path: "/v1/heartbeat",
      answers: [json(statusCakePage(STATUSCAKE_HEARTBEATS))],
    },
    {
      path: "/v1/maintenance-windows",
      answers: [json(statusCakePage([{ id: "1", name: "Patch night" }]))],
    },
  ]);
}

export function statusCakeError(message: string): unknown {
  return { message: message, errors: {} };
}
