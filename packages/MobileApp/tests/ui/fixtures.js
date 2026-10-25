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


/*
 * Security Events, for the suites that ask for it (installFixtures'
 * `security` option): the project's case statuses and priorities, four open
 * cases - one of them held by a playbook step waiting for an approval - a
 * timeline and a note. Ids are real uuids, as the API's are, and colours
 * come as the API serializes them: { _type: "Color", value }.
 */
const caseIds = {
  spray: "5ec0ca5e-0142-4d1a-9a00-000000000142",
  powershell: "5ec0ca5e-0141-4d1a-9a00-000000000141",
  travel: "5ec0ca5e-0139-4d1a-9a00-000000000139",
  scan: "5ec0ca5e-0137-4d1a-9a00-000000000137",
};
const color = (value) => { return { _type: "Color", value }; };
const caseStatuses = [
  { _id: "5717a7e5-0001-4000-8000-000000000001", name: "New", color: color("#E5484D"), order: 1, isNewStatus: true },
  { _id: "5717a7e5-0002-4000-8000-000000000002", name: "Investigating", color: color("#FFB224"), order: 2, isAcknowledgedStatus: true },
  { _id: "5717a7e5-0003-4000-8000-000000000003", name: "Contained", color: color("#3E63DD"), order: 3, isContainedStatus: true },
  { _id: "5717a7e5-0004-4000-8000-000000000004", name: "Closed", color: color("#30A46C"), order: 4, isClosedStatus: true },
];
const casePriorities = [
  { _id: "9e10e117-0001-4000-8000-000000000001", name: "Critical", color: color("#E5484D"), order: 1, isCriticalPriority: true },
  { _id: "9e10e117-0002-4000-8000-000000000002", name: "High", color: color("#F76B15"), order: 2, isHighPriority: true },
  { _id: "9e10e117-0003-4000-8000-000000000003", name: "Medium", color: color("#FFB224"), order: 3, isMediumPriority: true },
  { _id: "9e10e117-0004-4000-8000-000000000004", name: "Low", color: color("#3E63DD"), order: 4, isLowPriority: true },
  { _id: "9e10e117-0005-4000-8000-000000000005", name: "Informational", color: color("#8B8D98"), order: 5, isInformationalPriority: true },
];
const priya = { _id: "8a5d4c1e-0002-4000-8000-000000000002", name: "Priya Shah", email: "priya@example.test" };
const jordan = { _id: "8a5d4c1e-0003-4000-8000-000000000003", name: "Jordan Lee", email: "jordan@example.test" };
const triageReport = [
  "## 🧠 AI — Security Case Triage",
  "",
  "**Summary**",
  "Fourteen failed VPN sign-ins for alice@acme.test from 203.0.113.24 in six minutes, then one that succeeded from the same address.",
  "",
  "**Assessment**",
  "Likely malicious: the address is on a known password-spray list [C1], and Alice signed in from Lisbon an hour earlier [C2].",
  "",
  "**Suggested next steps**",
  "1. Suspend alice@acme.test in Okta and end her sessions.",
  "2. Block 203.0.113.24 at the VPN gateway.",
].join("\n");

function securityCasesFor(me) {
  const status = (index) => { return caseStatuses[index]; };
  const priority = (index) => { return casePriorities[index]; };
  return [
    {
      _id: caseIds.spray, title: "Password spray against the VPN ended in a sign-in for alice@acme.test", caseNumber: 142, caseNumberWithPrefix: "CASE-142",
      securityCaseStatusId: status(0)._id, securityCaseStatus: status(0), securityCasePriorityId: priority(0)._id, securityCasePriority: priority(0),
      assignedToUserId: null, assignedToUser: null, assignedToTeamId: null, assignedToTeam: null,
      entities: [{ type: "User", value: "alice@acme.test" }, { type: "IP Address", value: "203.0.113.24" }, { type: "Host", value: "vpn-gw-01" }],
      detectionCount: 14, source: "Detection Rule", firstDetectedAt: "2026-09-10T09:46:00Z", lastDetectedAt: "2026-09-10T09:52:00Z", createdAt: "2026-09-10T09:46:00Z",
      description: "Detection rule **VPN password spray** fired 14 times for one account from one address.",
      aiVerdict: "Likely Malicious", aiSuggestedSecurityCasePriorityId: priority(0)._id, aiTriageReport: triageReport, aiTriagedAt: "2026-09-10T09:48:00Z", aiTriagePromptInjectionSuspected: false,
    },
    {
      _id: caseIds.powershell, title: "Unusual PowerShell download on fin-laptop-07", caseNumber: 141, caseNumberWithPrefix: "CASE-141",
      securityCaseStatusId: status(1)._id, securityCaseStatus: status(1), securityCasePriorityId: priority(1)._id, securityCasePriority: priority(1),
      assignedToUserId: priya._id, assignedToUser: priya, assignedToTeamId: null, assignedToTeam: null,
      entities: [{ type: "Host", value: "fin-laptop-07" }, { type: "Process", value: "powershell.exe" }],
      detectionCount: 3, source: "Connected Product", firstDetectedAt: "2026-09-10T09:20:00Z", lastDetectedAt: "2026-09-10T09:31:00Z", createdAt: "2026-09-10T09:20:00Z",
      aiVerdict: "Inconclusive", aiTriagedAt: "2026-09-10T09:24:00Z", aiTriageReport: "**Summary**\nA signed script downloaded a file from a new domain.", aiTriagePromptInjectionSuspected: true,
    },
    {
      _id: caseIds.travel, title: "Impossible travel for jordan.lee@acme.test", caseNumber: 139, caseNumberWithPrefix: "CASE-139",
      securityCaseStatusId: status(2)._id, securityCaseStatus: status(2), securityCasePriorityId: priority(2)._id, securityCasePriority: priority(2),
      assignedToUserId: me._id, assignedToUser: me, assignedToTeamId: null, assignedToTeam: null,
      entities: [{ type: "User", value: "jordan.lee@acme.test" }],
      detectionCount: 2, source: "Detection Rule", firstDetectedAt: "2026-09-10T07:10:00Z", lastDetectedAt: "2026-09-10T07:12:00Z", createdAt: "2026-09-10T07:10:00Z",
      aiVerdict: "Likely Benign", aiSuggestedSecurityCasePriorityId: priority(3)._id, aiTriageReport: "**Summary**\nJordan is on a work trip; the second sign-in came through the corporate VPN.", aiTriagedAt: "2026-09-10T07:14:00Z",
    },
    {
      _id: caseIds.scan, title: "Port scan from 198.51.100.7", caseNumber: 137, caseNumberWithPrefix: "CASE-137",
      securityCaseStatusId: status(0)._id, securityCaseStatus: status(0), securityCasePriorityId: priority(3)._id, securityCasePriority: priority(3),
      assignedToUserId: null, assignedToUser: null, assignedToTeamId: "7ea70000-0001-4000-8000-000000000001", assignedToTeam: { _id: "7ea70000-0001-4000-8000-000000000001", name: "Security Operations" },
      entities: [{ type: "IP Address", value: "198.51.100.7" }],
      detectionCount: 1, source: "Threat Intel", firstDetectedAt: "2026-09-10T06:40:00Z", lastDetectedAt: "2026-09-10T06:40:00Z", createdAt: "2026-09-10T06:40:00Z",
    },
  ];
}

function securityRunsFor() {
  return [
    {
      _id: "7a6b0000-0001-4000-8000-000000000001", securityCaseId: caseIds.spray, playbookName: "Contain a compromised account", status: "Waiting for Approval", trigger: "Case Opened",
      currentStepIndex: 1,
      steps: [
        { id: "step-1", action: "Check Threat Intel", config: {}, requiresApproval: false, continueOnFailure: false, onlyIfThreatIntelMatched: false },
        { id: "step-2", action: "Suspend Okta User", config: {}, requiresApproval: true, continueOnFailure: false, onlyIfThreatIntelMatched: false },
        { id: "step-3", action: "Post to Slack", config: {}, requiresApproval: false, continueOnFailure: false, onlyIfThreatIntelMatched: false },
      ],
      stepResults: [
        { stepId: "step-1", action: "Check Threat Intel", status: "Succeeded" },
        { stepId: "step-2", action: "Suspend Okta User", status: "Waiting for Approval", targets: [
          { type: "User", value: "alice@acme.test", reason: "Grouped On", state: "Proposed" },
          { type: "User", value: "breakglass-admin@acme.test", reason: "Threat Intel", state: "Protected", protectedBy: "breakglass-*" },
        ] },
        { stepId: "step-3", action: "Post to Slack", status: "Pending" },
      ],
      triggeredByUserId: null, triggeredByUser: null, startedAt: "2026-09-10T09:47:00Z", createdAt: "2026-09-10T09:47:00Z",
    },
  ];
}

function securityFeedFor(caseId) {
  if (caseId !== caseIds.spray) {
    return [{ _id: "f1e00000-0009-4000-8000-000000000009", feedInfoInMarkdown: "🛡️ Case opened by a detection.", displayColor: color("#8B8D98"), securityCaseFeedEventType: "CaseOpened", postedAt: "2026-09-10T07:10:00Z", createdAt: "2026-09-10T07:10:00Z" }];
  }
  return [
    { _id: "f1e00000-0004-4000-8000-000000000004", feedInfoInMarkdown: "⏸️ **Approval needed**: playbook **Contain a compromised account** is waiting for someone to approve step 2 (Suspend the user in Okta).", displayColor: color("#FFB224"), securityCaseFeedEventType: "ApprovalRequested", postedAt: "2026-09-10T09:48:30Z", createdAt: "2026-09-10T09:48:30Z" },
    { _id: "f1e00000-0003-4000-8000-000000000003", feedInfoInMarkdown: "🧠 OneUptime AI triaged the case: **Likely Malicious**.", moreInformationInMarkdown: triageReport, displayColor: color("#6E56CF"), securityCaseFeedEventType: "AiTriage", postedAt: "2026-09-10T09:48:00Z", createdAt: "2026-09-10T09:48:00Z" },
    { _id: "f1e00000-0002-4000-8000-000000000002", feedInfoInMarkdown: "🔔 Told 3 people about this **Critical** case.", displayColor: color("#3E63DD"), securityCaseFeedEventType: "Notification", postedAt: "2026-09-10T09:46:20Z", createdAt: "2026-09-10T09:46:20Z" },
    { _id: "f1e00000-0001-4000-8000-000000000001", feedInfoInMarkdown: "🛡️ Case opened by detection rule **VPN password spray**.", displayColor: color("#E5484D"), securityCaseFeedEventType: "CaseOpened", postedAt: "2026-09-10T09:46:00Z", createdAt: "2026-09-10T09:46:00Z" },
  ];
}

const DECISION_PATH = /^\/api\/security-playbook-run\/([^/]+)\/(approve|reject)$/;

async function installFixtures(page, { signedIn = true, loginMode = "normal", requireProjectSso = false, security = false } = {}) {
  const requests = [];
  const mutations = [];
  // Per page, so a decision or a change made in one test never leaks into the next.
  const securityState = { cases: securityCasesFor(user), runs: securityRunsFor(), notes: [{ _id: "0e7e0000-0001-4000-8000-000000000001", note: "Called Alice: she is at home and did not sign in.", createdAt: "2026-09-10T09:55:00Z", createdByUser: priya }] };
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
    if (security && url.pathname.startsWith("/api/security-")) {
      const query = body.query || {};
      const includes = (value) => { return value && value._type === "Includes" ? value.value : null; };
      if (url.pathname === "/api/security-case-status/get-list") { return reply({ data: caseStatuses, count: caseStatuses.length }); }
      if (url.pathname === "/api/security-case-priority/get-list") { return reply({ data: casePriorities, count: casePriorities.length }); }
      const matchingCases = () => {
        let rows = securityState.cases;
        if (query._id) { rows = rows.filter((row) => { return row._id === query._id; }); }
        const statusIds = includes(query.securityCaseStatusId);
        if (statusIds) { rows = rows.filter((row) => { return statusIds.includes(row.securityCaseStatusId); }); }
        return rows;
      };
      if (url.pathname === "/api/security-case/count") { return reply({ count: matchingCases().length }); }
      if (url.pathname === "/api/security-case/get-list") { const rows = matchingCases(); return reply({ data: rows, count: rows.length }); }
      if (url.pathname.startsWith("/api/security-case/") && request.method() === "PUT") {
        const caseId = url.pathname.split("/").pop();
        const row = securityState.cases.find((candidate) => { return candidate._id === caseId; });
        mutations.push({ path: url.pathname, projectId, body, method: "PUT" });
        if (!row) { return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "This security case no longer exists." }) }); }
        const data = body.data || {};
        Object.assign(row, data);
        if (data.securityCaseStatusId) { row.securityCaseStatus = caseStatuses.find((value) => { return value._id === data.securityCaseStatusId; }); }
        if (data.securityCasePriorityId) { row.securityCasePriority = casePriorities.find((value) => { return value._id === data.securityCasePriorityId; }); }
        if (data.assignedToUserId !== undefined) { row.assignedToUser = [user, priya, jordan].find((person) => { return person._id === data.assignedToUserId; }) || null; }
        return reply({});
      }
      if (url.pathname === "/api/security-case-feed/get-list") { const rows = securityFeedFor(query.securityCaseId); return reply({ data: rows, count: rows.length }); }
      if (url.pathname === "/api/security-case-note/get-list") { const rows = query.securityCaseId === caseIds.spray ? securityState.notes : []; return reply({ data: rows, count: rows.length }); }
      if (url.pathname === "/api/security-case-note") { securityState.notes.unshift({ _id: "0e7e0000-0002-4000-8000-00000000000" + String(securityState.notes.length + 1), note: body.data?.note, createdAt: now, createdByUser: user }); mutations.push({ path: url.pathname, projectId, body }); return reply({}); }
      if (url.pathname === "/api/security-playbook-run/get-list") {
        let rows = securityState.runs.filter((run) => { return !query.status || run.status === query.status; });
        if (query.securityCaseId) { rows = rows.filter((run) => { return run.securityCaseId === query.securityCaseId; }); }
        return reply({ data: rows, count: rows.length });
      }
      const decision = DECISION_PATH.exec(url.pathname);
      if (decision) {
        const run = securityState.runs.find((candidate) => { return candidate._id === decision[1]; });
        mutations.push({ path: url.pathname, projectId, body });
        if (!run || run.status !== "Waiting for Approval") { return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "This run is not waiting for an approval: somebody may have decided already." }) }); }
        run.status = decision[2] === "approve" ? "Queued" : "Cancelled";
        return reply({ runId: run._id, decision: decision[2] === "approve" ? "Approved" : "Rejected" });
      }
      return reply({ data: [], count: 0 });
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
    if (url.pathname.includes("team-member/get-list")) { return reply(security ? { data: [user, priya, jordan].map((member) => { return { user: member }; }), count: 3 } : { data: [{ user }, { user: { _id: "responder-2", name: "Priya Shah", email: "priya@example.test" } }], count: 2 }); }
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
    // Open records are asked for by state id (utils/resolvedState): { _type: "Includes", value: [open state ids] }.
    for (const [idKey, stateKey] of [["currentIncidentStateId", "currentIncidentState"], ["currentAlertStateId", "currentAlertState"]]) {
      const stateIds = body.query?.[idKey];
      if (stateIds?._type === "Includes") { rows = rows.filter((item) => { return stateIds.value.includes(item[idKey] ?? item[stateKey]?._id); }); }
    }
    if (body.query?.disableActiveMonitoring === true) { rows = rows.filter((item) => { return item.disableActiveMonitoring; }); }
    if (body.query?.currentMonitorStatus?.isOperationalState === false) { rows = rows.filter((item) => { return !item.currentMonitorStatus?.isOperationalState; }); }
    if (!url.pathname.includes("get-list") && request.method() !== "GET") { mutations.push({ path: url.pathname, projectId, body }); }
    return reply({ data: rows.slice(Number(url.searchParams.get("skip") ?? 0), Number(url.searchParams.get("skip") ?? 0) + Number(url.searchParams.get("limit") ?? 100)), count: rows.length });
  });
  return { requests, mutations };
}

module.exports = { installFixtures, projects, now, caseIds };
