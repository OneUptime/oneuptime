/*
 * Which request paths the two SPA catch-all fallbacks must NOT answer.
 *
 * This lives in its own module, apart from FeatureSet/Frontend/Index.ts, for
 * one reason: Index.ts calls Express.getExpressApp() at module scope and pulls
 * in database services, so importing it from a test boots half the server.
 * These lists and the predicate that reads them are the part that most needs
 * testing, and here they can be imported directly - a test asserts against the
 * real values and the real predicate rather than against a regex scraped over
 * the source, which is a class of false pass this area has already suffered.
 *
 * Nothing here may import anything with side effects. Keep it pure.
 */

export const IngestRoutePrefixesToSkip: Array<string> = [
  "/telemetry",
  "/otlp",
  "/opentelemetry.proto.collector",
  /*
   * Log ingest, mounted at the root as well as under "/telemetry", and given
   * its own nginx location - /fluentd is reached through a rewrite, which is
   * the same route #2986 took. Both are POST-only today, and the fallbacks
   * are GET-only, so nothing is shadowed right now; they are reserved so that
   * adding a GET health or validate route (as /otlp already has) cannot
   * quietly start returning SPA HTML.
   */
  "/fluentd",
  "/syslog",
  /*
   * Session replay ingest is mounted on both "/telemetry" and "/", so
   * without this entry a root-level /session-replay/v1/chunk would be
   * answered with SPA HTML instead of reaching the ingest router.
   */
  "/session-replay",
  /*
   * Source map upload ingest, mounted on both "/telemetry" and "/" the same
   * way as session replay. POST-only today; reserved for the same reason as
   * /fluentd above.
   */
  "/source-maps",
  /*
   * Queue-depth and shed-rate endpoints polled by the KEDA metrics-api
   * scaler (HelmChart/.../keda-scaledobjects.yaml). The worker and api tiers
   * only kept working because App/Index.ts mounts AppMetricsAPI on "/"
   * BEFORE the feature sets; telemetry-writer's shed-rate route has no such
   * head start and is registered by the Telemetry feature set.
   */
  "/metrics",
  "/probe-ingest",
  "/ingestor",
  /*
   * ProbeIngest's routers are mounted on "/" as well as "/probe-ingest" and
   * "/ingestor", so their own route prefixes are reachable at the root too.
   */
  "/probe",
  "/monitor",
  /*
   * Both spellings are needed: the predicate matches a prefix exactly or
   * followed by "/", so "/server-monitor" does NOT cover
   * "/server-monitor-ingest/...".
   */
  "/server-monitor-ingest",
  "/server-monitor",
  "/incoming-request-ingest",
  "/incoming-request",
  /*
   * Nginx rewrites /heartbeat/<key> to the /incoming-request route above, so
   * the App normally never sees this prefix - it is reserved for the case
   * where a request reaches the App without passing through that rewrite.
   */
  "/heartbeat",
  "/incoming-email",
  "/worker",
];

export const DashboardFallbackRoutePrefixesToSkip: Array<string> = [
  "/status-page",
  "/status-page-api",
  "/status-page-sso-api",
  "/status-page-oidc-api",
  "/status-page-identity-api",
  "/public-dashboard",
  "/public-dashboard-api",
  "/api",
  "/identity",
  "/notification",
  ...IngestRoutePrefixesToSkip,
  "/realtime",
  "/workflow",
  "/workers",
  "/mcp",
  "/analytics-api",
  "/file",
  "/docs",
  "/reference",
  /*
   * The vendored browser libraries (Common/Server/Utils/VendorAssets.ts).
   * That mount terminates its own prefix with a 404, so this is belt and
   * braces - but a stylesheet answered with the dashboard's index page at
   * HTTP 200 is a failure nothing logs, and this list is where that class of
   * mistake is meant to be caught.
   */
  "/oneuptime-assets",
  "/.well-known",
  "/l",
  "/manifest.json",
  "/service-worker.js",
  "/sw.js",
  "/browserconfig.xml",
  "/rss",
  "/llms.txt",
];

export const StatusPageDomainFallbackRoutePrefixesToSkip: Array<string> = [
  "/status-page-api",
  "/status-page-sso-api",
  "/status-page-oidc-api",
  "/status-page-identity-api",
  "/public-dashboard-api",
  /*
   * Ingest is reserved here as well as on the dashboard list, deliberately.
   * "Not a primary host" covers two very different callers: a customer's
   * status-page custom domain, and any cluster-internal client addressing a
   * pod by its Kubernetes service name. The second is why this matters - see
   * the KEDA note on IngestRoutePrefixesToSkip.
   *
   * The cost to the first caller is nil: none of these prefixes is a
   * StatusPage or PublicDashboard client route (their root-level routes are
   * /incidents, /announcements, /scheduled-events, /subscribe, /login and
   * friends), so no status page deep link is shadowed by this.
   */
  ...IngestRoutePrefixesToSkip,
  /* Same reservation as the dashboard list above. */
  "/oneuptime-assets",
  "/.well-known",
  "/rss",
  "/llms.txt",
];

/*
 * Prefix match on PATH SEGMENT boundaries, not on raw string prefix. The
 * distinction is load-bearing: "/server-monitor" must not reserve
 * "/server-monitor-ingest/...", which is a different mount, so both spellings
 * appear in the list above.
 */
export const isRouteReservedAgainstSpaFallback: (
  prefixes: Array<string>,
  path: string,
) => boolean = (prefixes: Array<string>, path: string): boolean => {
  return prefixes.some((prefix: string) => {
    if (path === prefix) {
      return true;
    }

    return path.startsWith(`${prefix}/`);
  });
};

export const shouldSkipDashboardFallbackRoute: (path: string) => boolean = (
  path: string,
): boolean => {
  return isRouteReservedAgainstSpaFallback(
    DashboardFallbackRoutePrefixesToSkip,
    path,
  );
};

export const shouldSkipStatusPageDomainFallbackRoute: (
  path: string,
) => boolean = (path: string): boolean => {
  return isRouteReservedAgainstSpaFallback(
    StatusPageDomainFallbackRoutePrefixesToSkip,
    path,
  );
};
