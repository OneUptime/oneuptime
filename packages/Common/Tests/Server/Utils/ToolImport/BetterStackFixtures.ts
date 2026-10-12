import { FixtureApi, json } from "./ToolImportFixtureTransport";

/*
 * A Better Stack Uptime team in API v2's documented shapes
 * (https://betterstack.com/docs/uptime/api/): JSON:API records of
 * { id, type, attributes }, paged with `pagination.next`. Every monitor
 * type the import knows and the ones it does not, heartbeats (one sharing
 * an id with a monitor, as the two lists may), a public status page with
 * sections, each kind of resource and subscribers, and a private one.
 */

export const BETTER_STACK_TOKEN: string = "bs_team_token_0123456789";

export const HOME_ID: string = "2001";
export const CHECKOUT_ID: string = "2002";
export const ERROR_FREE_ID: string = "2003";
export const ORDERS_ID: string = "2004";
export const GATEWAY_ID: string = "2005";
export const DATABASE_ID: string = "2006";
export const MAIL_ID: string = "2007";
export const NAMES_ID: string = "2008";
export const SYSLOG_ID: string = "2009";
export const SIGNUP_ID: string = "2010";

export const BACKUP_HEARTBEAT_ID: string = "3001";
// The same id as the Checkout monitor: the two lists number apart.
export const SYNC_HEARTBEAT_ID: string = "2002";

export const PUBLIC_PAGE_ID: string = "4001";
export const INTERNAL_PAGE_ID: string = "4002";

function record(
  type: string,
  id: string | null,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return id === null
    ? { type: type, attributes: attributes }
    : { id: id, type: type, attributes: attributes };
}

function monitor(
  id: string | null,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return record("monitor", id, {
    team_name: "Acme",
    status: "up",
    paused_at: null,
    check_frequency: 300,
    follow_redirects: true,
    request_headers: [],
    ...attributes,
  });
}

export const BETTER_STACK_MONITORS: Array<Record<string, unknown>> = [
  monitor(HOME_ID, {
    pronounceable_name: "Home page",
    monitor_type: "status",
    url: "https://example.com",
    http_method: "get",
    check_frequency: 180,
    request_timeout: 30,
    ssl_expiration: 14,
  }),
  monitor(CHECKOUT_ID, {
    pronounceable_name: "Checkout",
    monitor_type: "keyword",
    url: "https://shop.example.com",
    http_method: "head",
    required_keyword: "Pay now",
    check_frequency: 60,
    follow_redirects: false,
  }),
  monitor(ERROR_FREE_ID, {
    pronounceable_name: "Error free",
    monitor_type: "keyword_absence",
    url: "https://example.com/health",
    required_keyword: "Exception",
  }),
  monitor(ORDERS_ID, {
    pronounceable_name: "Orders API",
    monitor_type: "expected_status_code",
    url: "https://api.example.com/orders",
    http_method: "post",
    request_body: '{"ping": true}',
    request_headers: [
      { id: "1", name: "X-Team", value: "shop" },
      { id: "2", name: "Authorization", value: "Bearer orders-secret" },
    ],
    expected_status_codes: [200, 201, 202, 204],
    auth_username: "api",
    auth_password: "never-read",
    paused_at: "2026-09-01T00:00:00.000Z",
    status: "paused",
  }),
  monitor(GATEWAY_ID, {
    pronounceable_name: "Gateway",
    monitor_type: "ping",
    url: "10.0.0.1",
    check_frequency: 30,
  }),
  monitor(DATABASE_ID, {
    pronounceable_name: "Database",
    monitor_type: "tcp",
    url: "db.example.com",
    port: "5432",
    // Milliseconds, for a TCP monitor.
    request_timeout: 5000,
  }),
  monitor(MAIL_ID, {
    pronounceable_name: "Mail",
    monitor_type: "smtp",
    url: "mail.example.com",
    port: "25,465",
  }),
  monitor(NAMES_ID, {
    pronounceable_name: "Names",
    monitor_type: "dns",
    // The server to ask; the name to look up is the request body.
    url: "1.1.1.1",
    request_body: "example.com",
    required_keyword: "93.184.216.34",
  }),
  monitor(SYSLOG_ID, {
    pronounceable_name: "Syslog",
    monitor_type: "udp",
    url: "logs.example.com",
    port: "514",
  }),
  monitor(SIGNUP_ID, {
    pronounceable_name: "Signup flow",
    monitor_type: "playwright",
    url: "https://example.com/signup",
  }),
  // A record with no id: skipped.
  monitor(null, { pronounceable_name: "Ghost", monitor_type: "status" }),
];

export const BETTER_STACK_HEARTBEATS: Array<Record<string, unknown>> = [
  record("heartbeat", BACKUP_HEARTBEAT_ID, {
    name: "Nightly backup",
    period: 86400,
    grace: 3600,
    status: "up",
    paused_at: null,
  }),
  record("heartbeat", SYNC_HEARTBEAT_ID, {
    name: "Hourly sync",
    period: 3600,
    grace: 0,
    status: "paused",
    paused_at: "2026-09-01T00:00:00.000Z",
  }),
];

export const BETTER_STACK_STATUS_PAGES: Array<Record<string, unknown>> = [
  record("status_page", PUBLIC_PAGE_ID, {
    company_name: "Acme",
    company_url: "https://acme.example",
    subdomain: "acme",
    custom_domain: "status.acme.com",
    subscribable: true,
    hide_from_search_engines: false,
    password_enabled: false,
    ip_allowlist: [],
    history: 90,
    logo_url: "https://cdn.example.com/logo.png",
  }),
  record("status_page", INTERNAL_PAGE_ID, {
    company_name: "Internal",
    subdomain: "acme-internal",
    subscribable: false,
    hide_from_search_engines: true,
    password_enabled: true,
  }),
];

export const PUBLIC_PAGE_SECTIONS: Array<Record<string, unknown>> = [
  record("status_page_section", "51", { name: "Website", position: 1 }),
  record("status_page_section", "50", { name: "API", position: 0 }),
];

export const PUBLIC_PAGE_RESOURCES: Array<Record<string, unknown>> = [
  record("status_page_resource", "61", {
    resource_id: Number(HOME_ID),
    resource_type: "Monitor",
    public_name: "Home page",
    explanation: "Our website",
    status_page_section_id: 51,
    position: 1,
    widget_type: "history",
  }),
  record("status_page_resource", "62", {
    resource_id: Number(ORDERS_ID),
    resource_type: "Monitor",
    public_name: "Orders",
    status_page_section_id: 50,
    position: 0,
    widget_type: "plain",
  }),
  record("status_page_resource", "63", {
    resource_id: Number(SYNC_HEARTBEAT_ID),
    resource_type: "Heartbeat",
    public_name: "Sync",
    status_page_section_id: 51,
    position: 2,
    widget_type: "response_times",
  }),
  record("status_page_resource", "64", {
    resource_type: "ManuallyTrackedItem",
    public_name: "Support desk",
    // A section the page does not have: shown outside any group.
    status_page_section_id: 999,
    position: 3,
    widget_type: "plain",
  }),
  record("status_page_resource", "65", {
    resource_id: 9,
    resource_type: "WebhookIntegration",
    public_name: "Deploys",
    position: 4,
    widget_type: "plain",
  }),
];

export const PUBLIC_PAGE_SUBSCRIBERS: Array<Record<string, unknown>> = [
  record("status_page_subscriber", "71", {
    email: "Ann@Example.com",
    confirmed_at: "2026-01-02T03:04:05.000Z",
    status_page_resource_ids: [],
  }),
  record("status_page_subscriber", "72", {
    email: "bob@example.com",
    confirmed_at: null,
  }),
  record("status_page_subscriber", "73", {
    email: "carol@example.com",
    confirmed_at: "2026-01-02T03:04:05.000Z",
    status_page_resource_ids: [61, 63],
  }),
  // Not an address: skipped.
  record("status_page_subscriber", "74", {
    email: "not-an-email",
    confirmed_at: "2026-01-02T03:04:05.000Z",
  }),
  // No id: skipped.
  record("status_page_subscriber", null, {
    email: "noid@example.com",
    confirmed_at: "2026-01-02T03:04:05.000Z",
  }),
];

export const INTERNAL_PAGE_RESOURCES: Array<Record<string, unknown>> = [
  record("status_page_resource", "66", {
    resource_id: Number(DATABASE_ID),
    resource_type: "Monitor",
    public_name: "Database",
    position: 0,
    widget_type: "history",
  }),
];

export function betterStackPage(
  data: Array<unknown>,
  next: string | null = null,
): Record<string, unknown> {
  return {
    data: data,
    pagination: { first: "first", last: "last", prev: null, next: next },
  };
}

export function betterStackApi(): FixtureApi {
  const publicPage: string = `/api/v2/status-pages/${PUBLIC_PAGE_ID}`;
  const internalPage: string = `/api/v2/status-pages/${INTERNAL_PAGE_ID}`;

  return new FixtureApi([
    {
      path: "/api/v2/monitors",
      answers: [json(betterStackPage(BETTER_STACK_MONITORS))],
    },
    {
      path: "/api/v2/heartbeats",
      answers: [json(betterStackPage(BETTER_STACK_HEARTBEATS))],
    },
    {
      path: "/api/v2/status-pages",
      answers: [json(betterStackPage(BETTER_STACK_STATUS_PAGES))],
    },
    {
      path: `${publicPage}/sections`,
      answers: [json(betterStackPage(PUBLIC_PAGE_SECTIONS))],
    },
    {
      path: `${publicPage}/resources`,
      answers: [json(betterStackPage(PUBLIC_PAGE_RESOURCES))],
    },
    {
      path: `${publicPage}/subscribers`,
      answers: [json(betterStackPage(PUBLIC_PAGE_SUBSCRIBERS))],
    },
    {
      path: `${internalPage}/sections`,
      answers: [json(betterStackPage([]))],
    },
    {
      path: `${internalPage}/resources`,
      answers: [json(betterStackPage(INTERNAL_PAGE_RESOURCES))],
    },
    {
      path: `${internalPage}/subscribers`,
      answers: [json(betterStackPage([]))],
    },
  ]);
}

export function betterStackError(message: string): unknown {
  return { errors: message };
}
