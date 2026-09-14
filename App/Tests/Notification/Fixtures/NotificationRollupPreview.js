#!/usr/bin/env node
// Render synthetic notifications through the production builder and template.
// From the repository root: node App/Tests/Notification/Fixtures/NotificationRollupPreview.js
const fs = require("node:fs");
const path = require("node:path");
const Handlebars = require("handlebars");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});
const {
  buildRollupEmail,
} = require("../../../../Common/Server/Utils/EmailRollup/EmailRollupRenderer");

const root = path.resolve(__dirname, "../../../..");
const templates = path.join(root, "App/FeatureSet/Notification/Templates");
const output = path.join(root, "output/playwright/notification-rollup");
const dashboard = "https://oneuptime.example.com/dashboard/harbor";
const items = [];
const resources = [
  {
    category: "incidents",
    title: "[Incident INC-184] Checkout errors in Europe",
    severity: "Critical",
    currentState: "Investigating",
    count: 3,
  },
  {
    category: "incidents",
    title: "[Incident INC-183] Delayed background jobs",
    severity: "High",
    currentState: "Acknowledged",
    count: 2,
  },
  {
    category: "alerts",
    title:
      "[Resolved Alert ALT-332] [K8s] High Disk Usage (>90%) — production — Node: gke-production-cluster-defaultpool-662f6819-g0jo",
    severity: "High",
    currentState: "Resolved",
    count: 3,
  },
  {
    category: "alerts",
    title:
      "[Alert ALT-327] [K8s] High Memory Utilization (>85%) — Database node",
    severity: "Critical",
    currentState: "Acknowledged",
    count: 3,
  },
  {
    category: "alerts",
    title: "[Alert ALT-359] [K8s] Pod Memory Saturating Container Limit (>90%)",
    severity: "Medium",
    currentState: "Created",
    count: 2,
  },
  { category: "monitors", title: "[Monitor] Payments API is online", count: 2 },
];

for (const [index, resource] of resources.entries()) {
  for (let update = 0; update < resource.count; update++) {
    items.push({
      createdAt: new Date(Date.UTC(2026, 8, 9, 7, 0, 10 * index + update)),
      eventType: resource.category,
      rollupCategory: resource.category,
      subject: resource.title,
      viewLink: `${dashboard}/${resource.category}/example-${index}`,
      severity: resource.severity,
      currentState: resource.currentState,
    });
  }
}

for (const file of fs.readdirSync(path.join(templates, "Partials"))) {
  if (file.endsWith(".hbs")) {
    Handlebars.registerPartial(
      file.slice(0, -4),
      fs.readFileSync(path.join(templates, "Partials", file), "utf8"),
    );
  }
}
Handlebars.registerHelper("ifCond", function (left, right, options) {
  return left === right ? options.fn(this) : options.inverse(this);
});
Handlebars.registerHelper("ifNotCond", function (left, right, options) {
  return left !== right ? options.fn(this) : options.inverse(this);
});
Handlebars.registerHelper("concat", (left, right) => left + right);

function render(name, notifications) {
  const built = buildRollupEmail({
    projectName: "Harbor Production",
    projectHomeLink: `${dashboard}/home`,
    preferencesLink: `${dashboard}/user-settings/email-preferences`,
    items: notifications,
  });
  const html = Handlebars.compile(
    fs.readFileSync(path.join(templates, "NotificationRollup.hbs"), "utf8"),
  )({
    homeURL: "https://oneuptime.example.com",
    year: "2026",
    ...built.vars,
  });
  fs.writeFileSync(path.join(output, name), html);
}

fs.mkdirSync(output, { recursive: true });
render("index.html", items);
render(
  "long-labels.html",
  items.map((item) => ({
    ...item,
    ...(item.severity
      ? {
          severity: "Critical — customer-facing checkout and payments",
          currentState:
            "Acknowledged — investigating with the infrastructure team",
        }
      : {}),
  })),
);
console.log(`Email previews: ${output}`);
