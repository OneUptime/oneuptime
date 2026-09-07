#!/usr/bin/env node
/*
 * Reproducible local visual-review harness for the email template catalog.
 * From the repository root: node App/Tests/Notification/Fixtures/EmailPreview.js
 *
 * Only reads templates/git and writes static HTML. Does not import MailService,
 * send email, load config.env, contact services, or access the database.
 * Values below are entirely synthetic. Serve output/playwright/email-design
 * with any local static server, then open index.html or overflow-check.html.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Handlebars = require("handlebars");

const root = path.resolve(__dirname, "../../../..");
const templatePath = "App/FeatureSet/Notification/Templates";
const templates = path.join(root, templatePath);
const output = path.join(root, "output/playwright/email-design");
const beforeRef = process.env.EMAIL_PREVIEW_BASE || "origin/master";
const home = "https://oneuptime.example.com";
const project = `${home}/dashboard/harbor`;
const status = "https://status.harbor.example.com";
const logo =
  "https://res.cloudinary.com/deityhub/image/upload/v1637736803/1png.png";
const read = (version, file) =>
  version === "after"
    ? fs.readFileSync(path.join(templates, file), "utf8")
    : execFileSync("git", ["show", `${beforeRef}:${templatePath}/${file}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
const filesFor = (version) =>
  version === "after"
    ? fs.readdirSync(templates).filter((file) => file.endsWith(".hbs"))
    : execFileSync(
        "git",
        ["ls-tree", "--name-only", `${beforeRef}:${templatePath}`],
        { cwd: root, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter((file) => file.endsWith(".hbs"));
const partialsFor = (version) =>
  version === "after"
    ? fs
        .readdirSync(path.join(templates, "Partials"))
        .filter((file) => file.endsWith(".hbs"))
    : execFileSync(
        "git",
        ["ls-tree", "--name-only", `${beforeRef}:${templatePath}/Partials`],
        { cwd: root, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter((file) => file.endsWith(".hbs"));
const escape = (value) => Handlebars.escapeExpression(value);
const humanize = (value) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^[a-z]/, (match) => match.toUpperCase());

function genericValue(name) {
  if (/^(is|has)[A-Z]/.test(name)) return "true";
  if (/(Url|URL|Link)$/.test(name))
    return `${project}/${name.replace(/(?:Url|URL|Link)$/, "").toLowerCase()}/example`;
  if (/(Color|Background)$/.test(name)) return "#4f46e5";
  if (/(Count|InPixels)$/.test(name)) return 3;
  if (/(Date|At)$/.test(name)) return "September 7, 2026 at 09:30 UTC";
  if (/(Description|Notes|Cause|Message)$/.test(name))
    return "Our team is investigating elevated error rates in the European region. We will share the next update in 30 minutes.";
  if (/(Duration|remainingText|leadText)$/.test(name)) return "30 minutes";
  return humanize(name);
}

// Collect referenced paths, including uncommon template fields, to keep the
// catalog smoke preview populated as templates are added. Curated fixtures below
// supply realistic data for the views reviewers use to judge the visual design.
function defaultVars(source) {
  const vars = {};
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "PathExpression" &&
      !node.data &&
      node.parts.length &&
      node.parts[0] !== "this"
    ) {
      const parts = node.parts;
      if (
        ![
          "if",
          "unless",
          "each",
          "with",
          "ifCond",
          "ifNotCond",
          "concat",
          "log",
        ].includes(parts[0])
      ) {
        let target = vars;
        for (const part of parts.slice(0, -1)) {
          if (!target[part] || typeof target[part] !== "object")
            target[part] = {};
          target = target[part];
        }
        target[parts.at(-1)] = genericValue(parts.at(-1));
      }
    }
    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    });
  };
  visit(Handlebars.parse(source));
  return vars;
}

const richDescription =
  "<p>Checkout requests in the European region are experiencing elevated latency and intermittent errors.</p><p>The on-call team is investigating the payment gateway connection pool.</p><ul><li>API and web checkout are affected.</li><li>Existing orders and account data remain available.</li></ul>";
const reportRows = [
  {
    isGroup: true,
    name: "Customer services",
    indentInPixels: 0,
    totalResources: 3,
    uptimePercentAsString: "99.97%",
    downtimeInHoursAndMinutes: "13 minutes",
    totalIncidentCount: 2,
  },
  {
    isGroup: false,
    name: "Payments API",
    indentInPixels: 16,
    uptimePercentAsString: "99.95%",
    downtimeInHoursAndMinutes: "22 minutes",
    totalIncidentCount: 2,
  },
  {
    isGroup: false,
    name: "Dashboard",
    indentInPixels: 16,
    uptimePercentAsString: "99.99%",
    downtimeInHoursAndMinutes: "4 minutes",
    totalIncidentCount: 1,
  },
  {
    isGroup: false,
    name: "Website",
    indentInPixels: 16,
    uptimePercentAsString: "100%",
    downtimeInHoursAndMinutes: "0 minutes",
    totalIncidentCount: 0,
  },
];
const common = {
  homeURL: home,
  year: "2026",
  logoUrl: "",
  statusPageName: "Harbor Status",
  statusPageUrl: status,
  projectName: "Harbor Production",
  name: "Alex Morgan",
  userName: "Alex Morgan",
  firstName: "Alex",
  email: "alex@example.com",
  userEmail: "alex@example.com",
  subject: "Verify your email address",
  code: "482 916",
  tokenVerifyUrl: `${home}/accounts/reset-password?token=preview-only-6ac38353b0a0428dab4ed020f391aae3&email=alex%40example.com`,
  dashboardLink: `${project}/settings/billing`,
  invoicePdfUrl: `${home}/invoices/INV-2026-0094.pdf`,
  incidentNumber: "INC-184",
  incidentTitle: "Elevated checkout errors in Europe",
  incidentDescription: richDescription,
  incidentSeverity: "High",
  currentState: "Investigating",
  incidentViewLink: `${project}/incidents/INC-184`,
  incidentEpisodeViewLink: `${project}/incident-episodes/IEP-28`,
  incidentEpisodeNumber: "IEP-28",
  incidentEpisodeTitle: "Regional payment degradation",
  incidentEpisodeDescription: richDescription,
  alertNumber: "ALT-291",
  alertTitle: "Payments API error rate above 5%",
  alertDescription: richDescription,
  alertSeverity: "High",
  alertViewLink: `${project}/alerts/ALT-291`,
  alertEpisodeTitle: "Payments API elevated errors",
  alertEpisodeNumber: "AEP-32",
  alertEpisodeViewLink: `${project}/alert-episodes/AEP-32`,
  resourcesAffected: "Payments API, Checkout, EU gateway",
  declaredBy: "Alex Morgan",
  declaredAt: "Sep 7, 2026 at 09:30 UTC",
  rootCause:
    "<p>Connection pooling errors between checkout workers and the regional payment gateway.</p>",
  remediationNotes:
    "<p>Traffic is being routed to healthy gateway nodes while the connection pool is restarted.</p>",
  detailsUrl: `${status}/incidents/INC-184`,
  unsubscribeUrl: `${status}/subscriptions/preferences?token=preview-only`,
  subscriberEmailNotificationFooterText:
    "You are subscribed to service updates from Harbor. We will send an update as soon as we know more.",
  isOwner: true,
  preferencesLink: `${project}/user-settings/email-preferences`,
  notificationPreferencesUrl: `${project}/user-settings/notification-settings`,
  previousState: "Acknowledged",
  previousStateColor: "#d97706",
  currentStateColor: "#2563eb",
  previousStateDurationText: "17 minutes",
  currentStatus: "Degraded",
  currentStatusColor: "#d97706",
  previousStatus: "Operational",
  previousStatusColor: "#059669",
  previousStatusDurationText: "3 days",
  incidentState: "Investigating",
  incidentStateColor: "#d97706",
  severityColor: "#dc2626",
  monitorName: "Payments API — Europe",
  monitorType: "API",
  monitorDestination: "https://api.harbor.example.com/v1/health",
  requestType: "GET",
  monitorDescription: "Checks payment processing availability every minute.",
  monitorViewLink: `${project}/monitors/payments-api`,
  scheduleName: "Payments",
  policyNames: "Production engineering, Payments response",
  remainingText: "30 minutes",
  leadText: "30 minutes",
  startsAt: "Mon 7 Sep, 10:00 Europe/London",
  endsAt: "Tue 8 Sep, 10:00 Europe/London",
  coveringFor: "Jamie Chen",
  scheduleViewLink: `${project}/on-call-duty/schedules/payments`,
  description:
    "Your on-call shift on Payments starts in 30 minutes. Review the handover notes and confirm you can receive notifications.",
  invoiceNumber: "INV-2026-0094",
  invoiceDate: "September 7, 2026",
  amount: "$249.00 USD",
  title: "Service update from Harbor",
  message: "Your team's notification settings have been updated successfully.",
  body: "<p>This is a customer-provided email body.</p>",
  hasResources: "true",
  isNewUser: "true",
  isInvitationAccepted: "false",
  hasMore: "false",
  report: {
    reportPeriodName: "August 2026",
    reportStartDate: "Aug 1, 2026",
    reportEndDate: "Aug 31, 2026",
    reportTimezone: "UTC",
    averageUptimePercent: "99.97%",
    totalDowntimeInHoursAndMinutes: "13 minutes",
    totalIncidents: 2,
    totalResources: 3,
    hasGroups: true,
    rows: reportRows,
  },
  rollupTitle: "8 notifications from Harbor Production",
  rollupIntroHtml:
    "OneUptime grouped these 8 notifications from Harbor Production into a single email.",
  summaryCount: "8 notifications",
  summaryWindow: "09:30 UTC to 09:45 UTC",
  categoryCounts: "5 Incidents · 2 Monitors · 1 Probes",
  projectHomeLink: `${project}/home`,
  preferencesHtml:
    "Email rollups help keep your inbox manageable when several events happen together. You can change this in <a href='https://oneuptime.example.com/dashboard/harbor/user-settings/email-preferences'>Email Preferences</a>.",
  rows: [
    {
      isSectionStart: "true",
      sectionLabel: "Incidents",
      sectionCount: "5 notifications",
      rowBackground: "#ffffff",
      hasLink: "true",
      title: "Checkout errors in Europe — investigating",
      link: `${project}/incidents/INC-184`,
      metaLabel: "3 updates · latest 09:44 UTC",
    },
    {
      isSectionStart: "false",
      rowBackground: "#f8fafc",
      hasLink: "true",
      title: "Background jobs delayed — resolved",
      link: `${project}/incidents/INC-183`,
      metaLabel: "2 updates · latest 09:41 UTC",
    },
    {
      isSectionStart: "true",
      sectionLabel: "Monitors",
      sectionCount: "2 notifications",
      rowBackground: "#ffffff",
      hasLink: "true",
      title: "Payments API — degraded performance",
      link: `${project}/monitors/payments-api`,
      metaLabel: "2 updates · latest 09:38 UTC",
    },
    {
      isSectionStart: "true",
      sectionLabel: "Probes",
      sectionCount: "1 notification",
      rowBackground: "#ffffff",
      hasLink: "false",
      title: "EU West probe reconnected",
      metaLabel: "09:33 UTC",
    },
  ],
  alerts: [
    {
      alertNumber: "ALT-291",
      alertTitle: "Payments API error rate above 5%",
      alertViewLink: `${project}/alerts/ALT-291`,
      currentState: "Acknowledged",
      alertSeverity: "High",
    },
  ],
  incidents: [
    {
      incidentNumber: "INC-184",
      incidentTitle: "Elevated checkout errors in Europe",
      incidentViewLink: `${project}/incidents/INC-184`,
      currentState: "Investigating",
      incidentSeverity: "High",
    },
  ],
};

const cases = [
  {
    slug: "welcome",
    label: "Welcome",
    template: "SignupWelcomeEmail.hbs",
    vars: {
      tokenVerifyUrl: `${home}/accounts/verify-email?token=preview-only-6ac38353b0a0428dab4ed020f391aae3`,
    },
  },
  {
    slug: "password-reset",
    label: "Password reset",
    template: "ForgotPassword.hbs",
  },
  {
    slug: "incident",
    label: "Incident with rich details",
    template: "IncidentOwnerResourceCreated.hbs",
  },
  {
    slug: "subscriber",
    label: "Branded subscriber update",
    template: "SubscriberIncidentCreated.hbs",
  },
  {
    slug: "subscriber-logo",
    label: "Subscriber with uploaded logo",
    template: "SubscriberIncidentCreated.hbs",
    vars: { logoUrl: logo, statusPageName: "OneUptime Status" },
  },
  {
    slug: "digest",
    label: "Notification digest",
    template: "NotificationRollup.hbs",
  },
  {
    slug: "verification",
    label: "Verification code",
    template: "VerificationCode.hbs",
  },
  {
    slug: "invoice",
    label: "Invoice",
    template: "Invoice.hbs",
    vars: { description: "OneUptime Growth plan — September 2026" },
  },
  {
    slug: "on-call",
    label: "Upcoming on-call shift",
    template: "UserOnCallShiftReminder.hbs",
  },
  {
    slug: "uptime-report",
    label: "Monthly uptime report",
    template: "StatusPageSubscriberReport.hbs",
  },
  {
    slug: "status-change",
    label: "Incident state change",
    template: "IncidentOwnerStateChanged.hbs",
  },
  {
    slug: "long-content",
    label: "Long content and rich table",
    template: "IncidentOwnerStateChanged.hbs",
    vars: {
      incidentTitle:
        "Payment authorization delays affecting checkout requests across the European region",
      previousState: "Investigation in progress across multiple regions",
      currentState: "Mitigation deployed and recovery under observation",
      incidentViewLink: `${project}/incidents/INC-184?context=preview-only-${"regional-payment-checkout-trace-".repeat(8)}`,
      incidentDescription:
        "<p>The regional gateway is recovering. The following samples were captured during the investigation:</p><table><thead><tr><th>Service endpoint</th><th>Observed</th><th>Threshold</th></tr></thead><tbody><tr><td>https://api.harbor.example.com/v1/payments/authorization/checkout/europe-west</td><td>4,820 ms</td><td>1,000 ms</td></tr><tr><td>https://api.harbor.example.com/v1/payments/settlement</td><td>2,140 ms</td><td>800 ms</td></tr></tbody></table><p>Next steps:</p><ul><li>Monitor regional traffic until latency remains below the threshold for 30 minutes.</li><li>Confirm the checkout team can complete payment authorization successfully.</li></ul>",
    },
  },
];

function createRenderer(version) {
  const engine = Handlebars.create();
  // These are the production helpers, including all concat arguments. The
  // options object appended by Handlebars is intentionally excluded.
  engine.registerHelper("concat", (...args) =>
    args
      .slice(0, -1)
      .map((value) => (value == null ? "" : String(value)))
      .join(""),
  );
  engine.registerHelper("ifCond", function (a, b, options) {
    return a === b ? options.fn(this) : options.inverse(this);
  });
  engine.registerHelper("ifNotCond", function (a, b, options) {
    return a !== b ? options.fn(this) : options.inverse(this);
  });
  for (const file of partialsFor(version)) {
    const source = read(version, `Partials/${file}`);
    engine.registerPartial(file.slice(0, -4), source);
  }
  return (template, vars = {}) => {
    const source = read(version, template);
    return engine.compile(source)({
      ...defaultVars(source),
      ...common,
      ...vars,
    });
  };
}

fs.mkdirSync(output, { recursive: true });
const manifest = { beforeRef, cases, versions: {} };
for (const version of ["before", "after"]) {
  const render = createRenderer(version);
  const dir = path.join(output, version);
  fs.mkdirSync(path.join(dir, "all"), { recursive: true });
  for (const fixture of cases)
    fs.writeFileSync(
      path.join(dir, `${fixture.slug}.html`),
      render(fixture.template, fixture.vars),
    );
  const files = filesFor(version).sort();
  manifest.versions[version] = files.map((file) => ({
    template: file,
    url: `${version}/all/${file.slice(0, -4)}.html`,
    passthrough: file === "BlankTemplate.hbs",
  }));
  for (const file of files)
    fs.writeFileSync(
      path.join(dir, "all", `${file.slice(0, -4)}.html`),
      render(file),
    );
}
fs.writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);

const links = cases
  .map(
    (fixture) =>
      `<option value="${fixture.slug}">${escape(fixture.label)}</option>`,
  )
  .join("");
fs.writeFileSync(
  path.join(output, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OneUptime email design review</title><style>*{box-sizing:border-box}body{margin:0;background:#e9eef5;color:#172133;font-family:Arial,sans-serif}header{padding:20px 28px;background:#fff;border-bottom:1px solid #dbe2eb;display:flex;gap:24px;align-items:center;flex-wrap:wrap}h1{font-size:18px;margin:0}select{font:inherit;padding:8px;border:1px solid #cbd5e1;border-radius:6px}a{color:#4338ca}.grid{display:flex;justify-content:center;gap:24px;padding:24px;align-items:flex-start}.column{width:640px;min-width:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}iframe{border:1px solid #dbe2eb;width:100%;height:1650px;background:#fff;border-radius:8px}body.mobile .column{width:375px}@media(max-width:900px){.grid{flex-wrap:wrap}.column{width:100%}}</style></head><body><header><h1>OneUptime · Email design</h1><label>Email <select id="fixture">${links}</select></label><label>Width <select id="width"><option value="desktop">Desktop</option><option value="mobile">Mobile · 375px</option></select></label><a href="overflow-check.html">All-template overflow check</a><span style="font-size:12px;color:#64748b">Synthetic preview data</span></header><main class="grid"><section class="column"><h2>Before · ${escape(beforeRef)}</h2><iframe id="before" title="Before email"></iframe></section><section class="column"><h2>After · proposed design</h2><iframe id="after" title="After email"></iframe></section></main><script>const params=new URLSearchParams(location.search);const fixture=document.getElementById('fixture');fixture.value=params.get('case')||'welcome';const width=document.getElementById('width');width.value=params.get('width')||'desktop';function fitFrame(frame){const doc=frame.contentDocument;if(!doc||!doc.body)return;frame.style.height='1px';frame.style.height=Math.max(doc.documentElement.scrollHeight,doc.body.scrollHeight)+'px'}for(const version of ['before','after']){const frame=document.getElementById(version);frame.onload=()=>fitFrame(frame)}window.addEventListener('resize',()=>{for(const version of ['before','after'])fitFrame(document.getElementById(version))});function update(){document.body.className=width.value;for(const v of ['before','after'])document.getElementById(v).src=v+'/'+fixture.value+'.html';history.replaceState(null,'','?case='+fixture.value+'&width='+width.value)}fixture.onchange=update;width.onchange=update;update();</script></body></html>`,
);

fs.writeFileSync(
  path.join(output, "overflow-check.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email narrow viewport check</title><style>body{font:14px Arial,sans-serif;margin:28px;color:#172133}h1{font-size:24px}table{border-collapse:collapse}td,th{padding:8px 12px;border:1px solid #dbe2eb;text-align:left}.pass{color:#047857}.fail{color:#b91c1c}iframe{position:absolute;left:-10000px;border:0;height:900px}</style></head><body><h1>All-template narrow viewport check</h1><p>Renders every template and curated stress case at 320px and 375px. Customer-provided BlankTemplate bodies are excluded. Generated previews use synthetic data.</p><p id="status">Loading…</p><table><thead><tr><th>Template</th><th>Width</th><th>Content width</th><th>Result</th></tr></thead><tbody id="results"></tbody></table><script>window.emailOverflowResults=[];window.emailOverflowComplete=false;(async()=>{const manifest=await(await fetch('manifest.json')).json();const version=new URLSearchParams(location.search).get('version')||'after';for(const item of [...manifest.versions[version].filter(item=>!item.passthrough),...manifest.cases.map(fixture=>({template:'Example: '+fixture.label,url:version+'/'+fixture.slug+'.html'}))]){for(const width of [320,375]){const frame=document.createElement('iframe');frame.style.width=width+'px';const ready=new Promise(resolve=>frame.onload=resolve);frame.src=item.url;document.body.append(frame);await ready;await new Promise(resolve=>setTimeout(resolve,20));const doc=frame.contentDocument;const actual=Math.max(doc.documentElement.scrollWidth,doc.body.scrollWidth);const result={template:item.template,width,actual,pass:actual<=width+1};window.emailOverflowResults.push(result);const row=document.createElement('tr');row.innerHTML='<td>'+item.template+'</td><td>'+width+'</td><td>'+actual+'</td><td class="'+(result.pass?'pass':'fail')+'">'+(result.pass?'PASS':'OVERFLOW')+'</td>';document.getElementById('results').append(row);frame.remove();document.getElementById('status').textContent=window.emailOverflowResults.length+' checks completed';}}window.emailOverflowComplete=true;const failed=window.emailOverflowResults.filter(item=>!item.pass);document.getElementById('status').textContent=window.emailOverflowResults.length+' checks complete · '+failed.length+' overflow failures';})().catch(error=>{window.emailOverflowError=String(error);document.getElementById('status').textContent=String(error)});</script></body></html>`,
);
fs.writeFileSync(
  path.join(output, "README.md"),
  `# Local email previews\n\nRegenerate from the repository root:\n\n\`node App/Tests/Notification/Fixtures/EmailPreview.js\`\n\nServe this directory on localhost using a static server. Open \`index.html\` for the before/after gallery, or \`overflow-check.html\` for the 320/375px check across all templates and curated cases. The browser exposes \`window.emailOverflowResults\` and \`window.emailOverflowComplete\` for automation.\n\nIndividual curated cases are under \`before/\` and \`after/\`. All-template renders are under each version's \`all/\`. \`manifest.json\` lists both catalogs. Default baseline is \`${beforeRef}\`; override with \`EMAIL_PREVIEW_BASE\`.\n\nData is synthetic. No mail is sent, no credentials are read, and no database is used. This is browser layout verification, not a claim of certification across email clients.\n`,
);
console.log(
  `Rendered ${cases.length} curated cases and ${manifest.versions.after.length} templates per version into ${output}`,
);
