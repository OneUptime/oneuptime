/*
 * Uptime Kuma's two files, as Uptime Kuma writes them: the JSON backup of
 * 1.x (Settings > Backup > Export: `version`, `notificationList`,
 * `proxyList` and `monitorList`, each monitor with every setting) and the
 * Prometheus metrics page (/metrics). Every monitor type the import knows,
 * the ones it does not, a group, an upside down monitor, a paused one, and
 * the secrets a backup holds - which must never come out the other side.
 */

export const KUMA_SECRETS: ReadonlyArray<string> = [
  "kuma-basic-password",
  "orders-secret-token",
  "push-token-0123456789",
  "smtp-password-in-notification",
  "proxy-password",
];

function monitor(
  id: number,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: id,
    name: `Monitor ${id}`,
    description: null,
    active: true,
    interval: 60,
    retryInterval: 60,
    maxretries: 0,
    timeout: 48,
    upsideDown: false,
    expiryNotification: false,
    maxredirects: 10,
    accepted_statuscodes: ["200-299"],
    method: "GET",
    headers: null,
    body: null,
    keyword: null,
    invertKeyword: false,
    basic_auth_user: null,
    basic_auth_pass: null,
    authMethod: null,
    parent: null,
    tags: [],
    notificationIDList: {},
    ...data,
  };
}

export const KUMA_IDS: Record<string, number> = {
  home: 1,
  orders: 2,
  checkout: 3,
  errorFree: 4,
  health: 5,
  database: 6,
  gateway: 7,
  mail: 8,
  backup: 9,
  support: 10,
  container: 11,
  group: 12,
  inverted: 13,
  paused: 14,
  admin: 15,
};

export const KUMA_MONITORS: Array<unknown> = [
  monitor(KUMA_IDS["home"]!, {
    name: "Home page",
    description: "The front page",
    type: "http",
    url: "https://example.com",
    interval: 30,
    accepted_statuscodes: ["200-299", "301"],
    maxredirects: 0,
    expiryNotification: true,
  }),
  monitor(KUMA_IDS["orders"]!, {
    name: "Orders API",
    type: "http",
    url: "https://api.example.com/orders",
    method: "POST",
    body: '{"ping": true}',
    headers: JSON.stringify({
      "X-Team": "shop",
      Authorization: "Bearer orders-secret-token",
    }),
    timeout: 90,
    interval: 120,
  }),
  monitor(KUMA_IDS["checkout"]!, {
    name: "Checkout",
    type: "keyword",
    url: "https://shop.example.com",
    keyword: "Pay now",
    interval: 300,
  }),
  monitor(KUMA_IDS["errorFree"]!, {
    name: "Error free",
    type: "keyword",
    url: "https://example.com/health",
    keyword: "Exception",
    invertKeyword: true,
    interval: 300,
  }),
  monitor(KUMA_IDS["health"]!, {
    name: "Health JSON",
    type: "json-query",
    url: "https://api.example.com/health",
    jsonPath: "$.status",
    expectedValue: "ok",
    interval: 300,
  }),
  monitor(KUMA_IDS["database"]!, {
    name: "Database",
    type: "port",
    hostname: "db.example.com",
    port: 5432,
    timeout: 10,
    interval: 300,
  }),
  monitor(KUMA_IDS["gateway"]!, {
    name: "Gateway",
    type: "ping",
    hostname: "10.0.0.1",
    interval: 60,
  }),
  monitor(KUMA_IDS["mail"]!, {
    name: "Mail records",
    type: "dns",
    hostname: "example.com",
    dns_resolve_type: "MX",
    dns_resolve_server: "1.1.1.1",
    interval: 3600,
  }),
  monitor(KUMA_IDS["backup"]!, {
    name: "Nightly backup",
    type: "push",
    pushToken: "push-token-0123456789",
    interval: 86400,
    maxretries: 2,
    retryInterval: 600,
  }),
  monitor(KUMA_IDS["support"]!, {
    name: "Support desk",
    type: "manual",
    interval: 60,
  }),
  monitor(KUMA_IDS["container"]!, {
    name: "Worker container",
    type: "docker",
    docker_container: "worker",
    docker_host: 1,
  }),
  monitor(KUMA_IDS["group"]!, {
    name: "Production",
    type: "group",
  }),
  monitor(KUMA_IDS["inverted"]!, {
    name: "Old site must be down",
    type: "http",
    url: "https://old.example.com",
    upsideDown: true,
  }),
  monitor(KUMA_IDS["paused"]!, {
    name: "Staging",
    type: "ping",
    hostname: "staging.example.com",
    active: false,
    interval: 300,
  }),
  monitor(KUMA_IDS["admin"]!, {
    name: "Admin panel",
    type: "http",
    url: "https://admin.example.com",
    authMethod: "basic",
    basic_auth_user: "admin",
    basic_auth_pass: "kuma-basic-password",
    interval: 300,
  }),
  // The same id again: read once.
  monitor(KUMA_IDS["home"]!, {
    name: "Home page again",
    type: "http",
    url: "https://example.com",
  }),
  // No id, no type, and things that are not monitors at all.
  monitor(0, { id: null, name: "No id", type: "http" }),
  monitor(99, { name: "No type", type: "" }),
  null,
  5,
  "monitor",
  [],
];

export function kumaBackup(
  monitors: Array<unknown> = KUMA_MONITORS,
): Record<string, unknown> {
  return {
    version: "1.23.16",
    notificationList: [
      {
        id: 1,
        name: "Email",
        config: JSON.stringify({
          type: "smtp",
          smtpPassword: "smtp-password-in-notification",
        }),
      },
    ],
    proxyList: [
      {
        id: 1,
        protocol: "http",
        host: "proxy.example.com",
        auth: true,
        username: "proxy",
        password: "proxy-password",
      },
    ],
    monitorList: monitors,
  };
}

export function kumaBackupText(
  monitors: Array<unknown> = KUMA_MONITORS,
): string {
  return JSON.stringify(kumaBackup(monitors), null, 2);
}

// A metrics page as Uptime Kuma 1.x writes it: labels without an id.
export const KUMA_METRICS_1: string = [
  "# HELP monitor_cert_days_remaining The number of days remaining until the certificate expires",
  "# TYPE monitor_cert_days_remaining gauge",
  'monitor_cert_days_remaining{monitor_name="Home page",monitor_type="http",monitor_url="https://example.com",monitor_hostname="null",monitor_port="null"} 54',
  "# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)",
  "# TYPE monitor_status gauge",
  'monitor_status{monitor_name="Home page",monitor_type="http",monitor_url="https://example.com",monitor_hostname="null",monitor_port="null"} 1',
  'monitor_status{monitor_name="Database",monitor_type="port",monitor_url="https://",monitor_hostname="db.example.com",monitor_port="5432"} 1',
  'monitor_status{monitor_name="Gateway",monitor_type="ping",monitor_url="https://",monitor_hostname="10.0.0.1",monitor_port="null"} 1',
  'monitor_status{monitor_name="Nightly backup",monitor_type="push",monitor_url="https://",monitor_hostname="null",monitor_port="null"} 0',
  'monitor_status{monitor_name="Production",monitor_type="group",monitor_url="https://",monitor_hostname="null",monitor_port="null"} 1',
  // A name with an escaped quote, a comma and a brace in it.
  'monitor_status{monitor_name="Shop \\"EU\\", {main}",monitor_type="keyword",monitor_url="https://shop.example.com",monitor_hostname="null",monitor_port="null"} 1',
  'monitor_status{monitor_name="Worker container",monitor_type="docker",monitor_url="https://",monitor_hostname="null",monitor_port="null"} 1',
  // The same monitor twice: read once.
  'monitor_status{monitor_name="Home page",monitor_type="http",monitor_url="https://example.com",monitor_hostname="null",monitor_port="null"} 1',
  "# HELP monitor_response_time Monitor Response Time (ms)",
  "# TYPE monitor_response_time gauge",
  'monitor_response_time{monitor_name="Home page",monitor_type="http",monitor_url="https://example.com",monitor_hostname="null",monitor_port="null"} 120',
  "",
].join("\n");

// Uptime Kuma 2.x adds each monitor's id.
export const KUMA_METRICS_2: string = [
  "# TYPE monitor_status gauge",
  'monitor_status{monitor_id="1",monitor_name="Home page",monitor_type="http",monitor_url="https://example.com",monitor_hostname="null",monitor_port="null"} 1',
  'monitor_status{monitor_id="2",monitor_name="Home page",monitor_type="http",monitor_url="https://example.com/copy",monitor_hostname="null",monitor_port="null"} 1',
].join("\n");
