const now = "2026-09-10T10:00:00.000Z";
const later = "2026-09-10T16:00:00.000Z";
const user = { _id: "responder-1", name: "Alex Morgan", email: "alex@example.test" };
const projects = [
  { _id: "project-aurora", name: "Aurora Production", slug: "aurora-production" },
  { _id: "project-atlas", name: "Atlas Staging", slug: "atlas-staging" },
];
const accessToken = "preview." + Buffer.from(JSON.stringify({ userId: user._id, exp: 4102444800 })).toString("base64url") + ".fixture";
const tokens = { accessToken, refreshToken: "local-preview-only", refreshTokenExpiresAt: "2100-01-01T00:00:00.000Z" };
const states = [
  { _id: "created", name: "Investigating", color: { r: 255, g: 133, b: 133 }, isCreatedState: true, order: 1 },
  { _id: "acknowledged", name: "Acknowledged", color: { r: 255, g: 196, b: 100 }, isAcknowledgedState: true, order: 2 },
  { _id: "resolved", name: "Resolved", color: { r: 91, g: 214, b: 162 }, isResolvedState: true, order: 3 },
];
const statuses = [
  { _id: "down", name: "Degraded", color: { r: 255, g: 171, b: 112 }, isOperationalState: false },
  { _id: "up", name: "Operational", color: { r: 91, g: 214, b: 162 }, isOperationalState: true },
];
const critical = { _id: "critical", name: "Critical", color: { r: 255, g: 133, b: 133 } };
const warning = { _id: "warning", name: "Warning", color: { r: 255, g: 196, b: 100 } };

function dataFor(projectId) {
  const staging = projectId === projects[1]._id;
  const title = staging ? "Staging deployment health check" : "Checkout API latency above threshold";
  const monitors = [
    { _id: "monitor-1", name: staging ? "Staging API" : "Checkout API", monitorType: "Website", currentMonitorStatus: statuses[0], disableActiveMonitoring: false, createdAt: now, description: "Public API availability and response time, checked every minute." },
    { _id: "monitor-2", name: "Customer dashboard", monitorType: "Website", currentMonitorStatus: statuses[1], disableActiveMonitoring: false, createdAt: now },
    { _id: "monitor-3", name: "Payments worker", monitorType: "Server", currentMonitorStatus: statuses[1], disableActiveMonitoring: false, createdAt: now },
    { _id: "monitor-4", name: "Legacy webhook", monitorType: "API", currentMonitorStatus: statuses[1], disableActiveMonitoring: true, createdAt: now },
  ];
  const incidents = [
    { _id: "incident-1", projectId, title, incidentNumber: 1042, incidentNumberWithPrefix: "INC-1042", currentIncidentState: states[0], incidentSeverity: critical, monitors: [monitors[0]], createdAt: "2026-09-10T09:42:00Z", declaredAt: "2026-09-10T09:42:00Z", description: "## Impact\nCustomers may see slower checkout requests. The team is investigating elevated database connection times.\n\n- Response time: **2.4 seconds**\n- Affected region: Europe\n\nNext update in 15 minutes.", rootCause: "Connection pool capacity was exhausted during a traffic increase." },
    { _id: "incident-2", projectId, title: "Background jobs processing slowly", incidentNumber: 1041, incidentNumberWithPrefix: "INC-1041", currentIncidentState: states[1], incidentSeverity: warning, monitors: [monitors[2]], createdAt: "2026-09-10T09:10:00Z", declaredAt: "2026-09-10T09:10:00Z" },
    { _id: "incident-3", projectId, title: "Dashboard availability recovered", incidentNumber: 1040, incidentNumberWithPrefix: "INC-1040", currentIncidentState: states[2], incidentSeverity: warning, monitors: [monitors[1]], createdAt: "2026-09-10T08:00:00Z" },
  ];
  const alerts = incidents.map((incident, index) => ({ ...incident, _id: `alert-${index + 1}`, title: index === 0 ? (staging ? "Staging CPU usage above 80%" : "Database CPU usage above 80%") : incident.title, alertNumber: 208 + index, alertNumberWithPrefix: `ALT-${208 + index}`, currentAlertState: incident.currentIncidentState, alertSeverity: incident.incidentSeverity }));
  const incidentEpisodes = [{ ...incidents[0], _id: "incident-episode-1", title: "Checkout service degradation", episodeNumber: 36, episodeNumberWithPrefix: "IE-36", incidentCount: 2, incidents, lastIncidentAddedAt: now }];
  const alertEpisodes = [{ ...alerts[0], _id: "alert-episode-1", title: "Database resource pressure", episodeNumber: 18, episodeNumberWithPrefix: "AE-18", alertCount: 2, alerts, lastAlertAddedAt: now }];
  return { monitors, incidents, alerts, incidentEpisodes, alertEpisodes };
}

async function installFixtures(page, { signedIn = true, loginMode = "normal", requireProjectSso = false } = {}) {
  const requests = [];
  const mutations = [];
  const overrides = new Map();
  const feeds = new Map();
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(({ tokens: storedTokens, signedIn: authenticated }) => {
    if (!sessionStorage.getItem("preview-initialized")) {
      localStorage.clear();
      sessionStorage.setItem("preview-initialized", "true");
      if (authenticated) {
        localStorage.setItem("oneuptime_server_url", location.origin);
        localStorage.setItem("com.oneuptime.oncall.tokens", JSON.stringify(storedTokens));
      }
    }
  }, { tokens, signedIn });
  await page.route(/\/(api|identity)\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const projectId = request.headers().tenantid ?? projects[0]._id;
    const body = request.postDataJSON() || {};
    requests.push({ path: url.pathname, projectId, headers: request.headers(), body });
    const data = dataFor(projectId);
    const reply = (value) => { return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) }); };
    if (url.pathname === "/api/on-call-calendar/feed/current") { return reply(feeds.get(projectId) || { exists: false, isEnabled: false }); }
    if (url.pathname === "/api/on-call-calendar/feed/rotate") {
      const feed = { exists: true, isEnabled: true, feedId: "feed-1", settings: { pastDays: 2, futureDays: 90 }, urls: { https: "https://calendar.example.test/private/demo.ics", webcal: "webcal://calendar.example.test/private/demo.ics", googleAdd: "https://calendar.google.com/calendar/u/0/r?cid=demo" } };
      feeds.set(projectId, feed);
      mutations.push({ path: url.pathname, projectId, body });
      return reply(feed);
    }
    if (url.pathname === "/api/on-call-duty-policy-user-override") {
      const override = { ...body.data, _id: "override-1", overrideUser: user, routeAlertsToUser: { _id: "responder-2", name: "Priya Shah", email: "priya@example.test" } };
      overrides.set(projectId, [override]);
      mutations.push({ path: url.pathname, projectId, body });
      return reply({ data: override });
    }
    if (url.pathname.startsWith("/api/on-call-duty-policy-user-override/") && request.method() === "DELETE") {
      overrides.set(projectId, []);
      mutations.push({ path: url.pathname, projectId, body });
      return reply({});
    }
    if (url.pathname === "/api/status") { return reply({ status: "ok" }); }
    if (url.pathname === "/identity/login") {
      if (loginMode === "two-factor") { return reply({ ...user, _miscData: { totpAuthList: [{ _id: "totp-1", name: "Authenticator app" }], backupCodeCount: 8 } }); }
      if (loginMode === "enrolment") { return reply({ ...user, _miscData: { twoFactorEnrolmentRequired: true, twoFactorAuthId: "totp-1", twoFactorOtpUrl: "otpauth://totp/OneUptime:alex%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime" } }); }
      return reply({ ...user, _miscData: { ...tokens, hasBackupCodes: true } });
    }
    if (url.pathname.includes("verify-totp")) { return reply({ ...user, _miscData: { ...tokens, backupCodes: ["DEMO-1234", "DEMO-2345", "DEMO-3456", "DEMO-4567", "DEMO-5678", "DEMO-6789", "DEMO-7890", "DEMO-8901"] } }); }
    if (url.pathname === "/identity/global-sso/service-provider-login") { return reply({ data: [{ _id: "global-saml", name: "Company single sign-on", description: "Use your work account" }] }); }
    if (url.pathname === "/identity/service-provider-login") { return reply({ data: [{ _id: "aurora-sso", name: "Aurora SSO", projectId: "project-aurora", project: { name: "Aurora Production" } }] }); }
    if (url.pathname === "/identity/verify-backup-code") { return reply({ ...user, _miscData: { ...tokens, hasBackupCodes: true } }); }
    if (url.pathname.startsWith("/identity/")) { return reply({ data: [] }); }
    if (url.pathname === "/api/project/get-list") {
      const memberships = projects.map((project) => ({ ...project, requireSsoForLogin: requireProjectSso && project._id === "project-atlas" }));
      return reply({ data: memberships, count: memberships.length });
    }
    if (requireProjectSso && url.pathname === "/api/project-sso/project-atlas/sso-list") {
      return reply({ data: [{ _id: "atlas-sso", name: "Atlas SSO", description: "Use your Atlas Staging work account", projectId: "project-atlas" }] });
    }
    if (url.pathname.includes("current-on-duty-escalation-policies")) {
      return reply({ escalationRulesByUser: [], escalationRulesByTeam: [], escalationRulesBySchedule: [{ onCallDutyPolicy: { _id: "policy-1", name: "Primary response" }, onCallDutyPolicyEscalationRule: { _id: "rule-1", name: "Primary responder" }, onCallDutyPolicySchedule: { _id: "schedule-1", name: "Engineering primary" } }] });
    }
    if (url.pathname.includes("my-shifts")) { return reply({ shifts: [{ shiftKey: "shift-1", projectId, scheduleId: "schedule-1", scheduleName: "Engineering primary", userId: user._id, userName: user.name, start: "2026-09-10T08:00:00Z", end: later, policies: [{ _id: "policy-1", name: "Primary response" }] }], generatedAt: now, truncated: false }); }
    if (url.pathname.includes("user-on-call-calendar-feed")) { return reply({ exists: false, isEnabled: false }); }
    if (url.pathname.includes("on-call-duty-policy-schedule/get-list")) { return reply({ data: [
      { _id: "schedule-1", name: "Engineering primary", currentUserOnRoster: user, nextUserOnRoster: { _id: "responder-2", name: "Priya Shah", email: "priya@example.test" }, rosterStartAt: "2026-09-10T08:00:00Z", rosterHandoffAt: later, rosterNextStartAt: later, rosterNextHandoffAt: "2026-09-11T08:00:00Z" },
      { _id: "schedule-2", name: "Infrastructure backup", currentUserOnRoster: null, nextUserOnRoster: { _id: "responder-3", name: "Jordan Lee" }, rosterNextStartAt: later },
    ], count: 2 }); }
    if (url.pathname.includes("user-notification-log/get-list")) { return reply({ data: [{ _id: "page-1", createdAt: "2026-09-10T09:42:00Z", status: "Sent", onCallDutyPolicy: { name: "Primary response" }, triggeredByIncident: data.incidents[0] }, { _id: "page-2", createdAt: "2026-09-10T09:10:00Z", status: "Sent", acknowledgedAt: "2026-09-10T09:12:00Z", triggeredByAlert: data.alerts[1] }], count: 2 }); }
    if (url.pathname.includes("team-member/get-list")) { return reply({ data: [{ user }, { user: { _id: "responder-2", name: "Priya Shah", email: "priya@example.test" } }], count: 2 }); }
    if (url.pathname.includes("on-call-duty-policy-user-override/get-list")) { const rows = overrides.get(projectId) || []; return reply({ data: rows, count: rows.length }); }
    let rows = [];
    if (url.pathname.includes("/incident/get-list")) { rows = data.incidents; }
    else if (url.pathname.includes("/alert/get-list")) { rows = data.alerts; }
    else if (url.pathname.includes("/monitor/get-list")) { rows = data.monitors; }
    else if (url.pathname.includes("/incident-episode/get-list")) { rows = data.incidentEpisodes; }
    else if (url.pathname.includes("/alert-episode/get-list")) { rows = data.alertEpisodes; }
    else if (url.pathname.includes("/incident-state/get-list") || url.pathname.includes("/alert-state/get-list")) { rows = states; }
    else if (url.pathname.includes("/monitor-status/get-list")) { rows = statuses; }
    else if (url.pathname.includes("-note/get-list")) { rows = [{ _id: "note-1", note: "Investigating database connections. Next update in 15 minutes.", createdAt: "2026-09-10T09:50:00Z", createdByUser: user }]; }
    if (body.query?._id) { rows = rows.filter((item) => { return item._id === body.query._id; }); }
    if (body.query?.currentIncidentState?.isResolvedState === false) { rows = rows.filter((item) => { return !item.currentIncidentState?.isResolvedState; }); }
    if (body.query?.currentAlertState?.isResolvedState === false) { rows = rows.filter((item) => { return !item.currentAlertState?.isResolvedState; }); }
    if (body.query?.disableActiveMonitoring === true) { rows = rows.filter((item) => { return item.disableActiveMonitoring; }); }
    if (body.query?.currentMonitorStatus?.isOperationalState === false) { rows = rows.filter((item) => { return !item.currentMonitorStatus?.isOperationalState; }); }
    if (!url.pathname.includes("get-list") && request.method() !== "GET") { mutations.push({ path: url.pathname, projectId, body }); }
    return reply({ data: rows.slice(Number(url.searchParams.get("skip") ?? 0), Number(url.searchParams.get("skip") ?? 0) + Number(url.searchParams.get("limit") ?? 100)), count: rows.length });
  });
  return { requests, mutations };
}

module.exports = { installFixtures, projects, now };
