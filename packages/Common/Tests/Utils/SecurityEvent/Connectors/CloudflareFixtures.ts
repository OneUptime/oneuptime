import { JSONObject } from "../../../../Types/JSON";
import { CloudflareZoneContext } from "../../../../Utils/SecurityEvent/Connectors/CloudflareNormalizer";

/*
 * Firewall events as the GraphQL Analytics API's firewallEventsAdaptive
 * dataset returns them (the fields CloudflareClient asks for, in the shape
 * and the spellings Cloudflare answers with), one for each thing its
 * firewall does: a WAF managed rule blocking SQL injection, a custom rule's
 * managed challenge and the challenge passed afterwards, a managed rule in
 * log mode, a skip rule letting an allowlisted monitor through, a skip rule
 * letting an attack through, rate limiting, HTTP DDoS protection, a JS
 * challenge of Security Level, an action Cloudflare added after this was
 * written, and a sampled row.
 */

export const CLOUDFLARE_ZONE: CloudflareZoneContext = {
  zoneTag: "023e105f4ecef8ad9ca31a8372d0c353",
  zoneName: "example.com",
};

export const ATTACKER_IP: string = "35.205.11.131";

function row(overrides: JSONObject): JSONObject {
  return {
    action: "block",
    source: "firewallManaged",
    ruleId: "6179ae15870a4bb7b2d480d4843b323c",
    rulesetId: "efb7b8c949ac4650a09736fc376e9aee",
    description: "SQLi - Comment",
    rayName: "8f2a1b3c4d5e6f70",
    matchIndex: 0,
    datetime: "2026-11-20T10:42:13Z",
    clientIP: ATTACKER_IP,
    clientRequestHTTPHost: "shop.example.com",
    clientRequestHTTPMethodName: "GET",
    clientRequestPath: "/products",
    clientRequestQuery: "?id=1%27%20or%201%3D1--",
    clientRequestScheme: "https",
    clientRequestHTTPProtocol: "HTTP/2",
    userAgent: "sqlmap/1.7.2#stable (https://sqlmap.org)",
    clientCountryName: "BE",
    clientAsn: "396982",
    clientASNDescription: "GOOGLE-CLOUD-PLATFORM",
    edgeColoName: "BRU",
    edgeResponseStatus: 403,
    originResponseStatus: 0,
    originatorRayName: "00",
    ref: "",
    sampleInterval: 1,
    ...overrides,
  };
}

// A WAF managed rule blocked a SQL injection at the edge.
export const MANAGED_RULE_BLOCK: JSONObject = row({});

// A custom rule answered with a managed challenge.
export const CUSTOM_RULE_MANAGED_CHALLENGE: JSONObject = row({
  action: "managed_challenge",
  source: "firewallCustom",
  ruleId: "f2d427378e7542acb295380d352e2ebd",
  rulesetId: "b59b2d62a4d84b5a8fb9e1a1d1d8e6a3",
  description: "Challenge visitors outside the EU",
  rayName: "8f2a1b3c4d5e6f71",
  clientRequestPath: "/login",
  clientRequestQuery: "",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  edgeResponseStatus: 403,
});

// The visitor passed that challenge: a later request of theirs.
export const MANAGED_CHALLENGE_PASSED: JSONObject = row({
  action: "managed_challenge_non_interactive_solved",
  source: "firewallCustom",
  ruleId: "f2d427378e7542acb295380d352e2ebd",
  description: "Challenge visitors outside the EU",
  rayName: "8f2a1b3c4d5e6f72",
  originatorRayName: "8f2a1b3c4d5e6f71",
  clientRequestPath: "/login",
  clientRequestQuery: "",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  edgeResponseStatus: 200,
  originResponseStatus: 200,
});

// A managed rule in log mode flagged an attack and let it through; the origin answered 200.
export const MANAGED_RULE_LOG: JSONObject = row({
  action: "log",
  rayName: "8f2a1b3c4d5e6f73",
  clientRequestPath: "/search",
  clientRequestQuery: "?q=x%27%20union%20select%20password%20from%20users--",
  edgeResponseStatus: 200,
  originResponseStatus: 200,
});

// A skip rule let the customer's uptime monitor through: nothing of an attack in it.
export const SKIP_ALLOWLISTED_MONITOR: JSONObject = row({
  action: "skip",
  source: "firewallCustom",
  ruleId: "9a8b7c6d5e4f40312a1b2c3d4e5f6a7b",
  description: "Skip WAF for our uptime monitor",
  rayName: "8f2a1b3c4d5e6f74",
  clientIP: "198.51.100.20",
  clientRequestPath: "/health",
  clientRequestQuery: "",
  userAgent: "OneUptime-Probe/1.0",
  edgeResponseStatus: 200,
  originResponseStatus: 200,
});

// A skip rule let a path traversal through, and the origin failed on it.
export const SKIP_WITH_PATH_TRAVERSAL: JSONObject = row({
  action: "skip",
  source: "firewallCustom",
  ruleId: "9a8b7c6d5e4f40312a1b2c3d4e5f6a7b",
  description: "Skip WAF for our partner API",
  rayName: "8f2a1b3c4d5e6f75",
  clientRequestPath: "/files/../../etc/passwd",
  clientRequestQuery: "",
  edgeResponseStatus: 500,
  originResponseStatus: 500,
});

// Rate limiting blocked a burst, spelled as Logpush spells its sources.
export const RATE_LIMIT_BLOCK: JSONObject = row({
  action: "block",
  source: "ratelimit",
  ruleId: "2c0fc9fa937b11eaa1b71c4d701ab86e",
  description: "Limit sign-in attempts",
  rayName: "8f2a1b3c4d5e6f76",
  clientRequestHTTPMethodName: "post",
  clientRequestPath: "/login",
  clientRequestQuery: "",
  edgeResponseStatus: 429,
});

// HTTP DDoS protection dropped a request of a flood.
export const HTTP_DDOS_DROP: JSONObject = row({
  action: "connection_close",
  source: "l7ddos",
  ruleId: "4d21379b4f9f4bb088e0729962c8b3cf",
  description: "HTTP requests from known botnet signatures",
  rayName: "8f2a1b3c4d5e6f77",
  clientRequestPath: "/",
  clientRequestQuery: "",
  edgeResponseStatus: 0,
});

// Security Level answered with a JS challenge, spelled in camelCase.
export const SECURITY_LEVEL_JS_CHALLENGE: JSONObject = row({
  action: "jschallenge",
  source: "securityLevel",
  ruleId: "",
  description: "",
  rayName: "8f2a1b3c4d5e6f78",
  clientRequestPath: "/",
  clientRequestQuery: "",
  edgeResponseStatus: 503,
});

// An action this connector does not know yet.
export const UNKNOWN_ACTION: JSONObject = row({
  action: "ai_labyrinth_served",
  source: "botManagement",
  ruleId: "",
  description: "",
  rayName: "8f2a1b3c4d5e6f79",
  clientRequestPath: "/",
  clientRequestQuery: "",
  edgeResponseStatus: 200,
});

// A row of a busy minute: it stands for ten requests like it.
export const SAMPLED_BLOCK: JSONObject = row({
  rayName: "8f2a1b3c4d5e6f80",
  sampleInterval: 10,
});
