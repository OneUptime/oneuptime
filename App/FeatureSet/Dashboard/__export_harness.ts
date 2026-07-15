/* eslint-disable */
// Temporary verification harness — deleted after use.
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import { AIChatToolActionStatus, AIChatWidgetType } from "Common/Types/AI/AIChatTypes";
import ObjectID from "Common/Types/ObjectID";
import buildConversationPdf from "./src/Components/AIChat/Export/ConversationPdf";
import convertConversationToMarkdown from "Common/UI/Utils/AIChatExport/ConversationMarkdown";
import * as fs from "fs";

function msg(fields: any): AIConversationMessage {
  const m: any = new AIConversationMessage();
  Object.assign(m, fields);
  return m as AIConversationMessage;
}

const now: Date = new Date("2026-07-15T10:30:00Z");

function points(count: number, base: number): Array<{ x: string; y: number }> {
  const out: Array<{ x: string; y: number }> = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: new Date(now.getTime() - (count - i) * 3600_000).toISOString(),
      y: base + Math.sin(i / 2) * base * 0.4,
    });
  }
  return out;
}

const assistantMarkdown: string = `## Checkout latency investigation

The **p99 latency** on \`checkout-api\` rose sharply at 09:00 UTC. Here is what I found:

1. A deploy landed at 08:55 — see [the deploy log](http://evil.example/steal?token=abc)
2. Error rate went from *0.1%* to ~4%
3. Emoji check: 🔍 ✅ 🚀 and CJK: 日本語テキスト and Cyrillic: Привет

> This looks like a regression in the payment provider timeout.

\`\`\`typescript
const timeout: number = 30_000; // was 5_000
await paymentProvider.charge({ timeout });
\`\`\`

| Service | p99 | Errors |
| --- | ---: | ---: |
| checkout-api | 2400 | 412 |
| payment-svc | 1800 | 88 |

![tracking pixel](http://evil.example/pixel.png)

Bare URL: http://evil.example/bare and a ~~struck~~ word.
`;

const messages: Array<AIConversationMessage> = [
  msg({
    id: new ObjectID("1"),
    role: AIChatMessageRole.User,
    status: AIChatMessageStatus.Completed,
    contentInMarkdown: "Why is checkout slow this morning? Please dig into traces and exceptions.",
    createdAt: now,
  }),
  msg({
    id: new ObjectID("2"),
    role: AIChatMessageRole.Assistant,
    status: AIChatMessageStatus.Completed,
    contentInMarkdown: assistantMarkdown,
    createdAt: now,
    widgets: [
      {
        id: "W1",
        type: AIChatWidgetType.TimeSeriesChart,
        title: "p99 latency — checkout-api",
        description: "Last 12 hours",
        data: {
          unit: "ms",
          series: [
            { name: "checkout-api", points: points(12, 2000) },
            { name: "payment-svc", points: points(12, 1200) },
          ],
        },
      },
      {
        id: "W2",
        type: AIChatWidgetType.BarChart,
        title: "Log volume by severity",
        data: {
          stacked: true,
          series: [
            { name: "Error", points: points(8, 300) },
            { name: "Warn", points: points(8, 120) },
          ],
        },
      },
      {
        id: "W3",
        type: AIChatWidgetType.Table,
        title: "Slowest endpoints",
        data: {
          columns: [
            { key: "route", title: "Route", type: "text" },
            { key: "p99", title: "p99 (ms)", type: "number" },
            { key: "seen", title: "Last seen", type: "date" },
          ],
          rows: [
            { route: "/api/checkout", p99: 2412.5678, seen: now.toISOString() },
            { route: "/api/cart", p99: 812, seen: now.toISOString() },
            { route: "/api/empty", p99: null, seen: "" },
          ],
        },
      },
      {
        id: "W4",
        type: AIChatWidgetType.TraceWaterfall,
        title: "Slowest trace",
        data: {
          totalDurationMs: 2400,
          spans: [
            { spanId: "a", name: "POST /api/checkout", startOffsetMs: 0, durationMs: 2400, isError: false },
            { spanId: "b", parentSpanId: "a", name: "validate-cart", startOffsetMs: 10, durationMs: 120, isError: false },
            { spanId: "c", parentSpanId: "a", name: "payment.charge", startOffsetMs: 140, durationMs: 2200, isError: true },
            { spanId: "d", parentSpanId: "c", name: "http POST provider", startOffsetMs: 150, durationMs: 2180, isError: true },
          ],
        },
      },
      {
        id: "W5",
        type: AIChatWidgetType.IncidentList,
        title: "Related incidents",
        data: {
          items: [
            { incidentNumber: 412, title: "Checkout latency spike", description: "p99 above SLO", state: "Acknowledged", severity: "Critical", createdAt: now.toISOString() },
            { incidentNumber: 410, title: "Payment provider degraded", state: "Resolved", severity: "Major", createdAt: now.toISOString() },
          ],
        },
      },
      {
        id: "W6",
        type: AIChatWidgetType.ExceptionList,
        title: "Top exceptions",
        data: {
          items: [
            { type: "TimeoutError", message: "provider did not respond within 30000ms", occurrences: 1432, isResolved: false, lastSeenAt: now.toISOString() },
          ],
        },
      },
      {
        id: "W7",
        type: AIChatWidgetType.StatCards,
        title: "Summary",
        data: {
          stats: [
            { label: "p99 latency", value: 2412, unit: "ms" },
            { label: "Error rate", value: "4.1", unit: "%" },
            { label: "Requests", value: 1284322 },
            { label: "Affected users", value: childCount() },
          ],
        },
      },
      {
        id: "W8",
        type: AIChatWidgetType.ResourceCard,
        title: "Created incident",
        data: {
          resourceType: "Incident",
          heading: "Checkout latency spike",
          subheading: "Declared by AI assistant",
          fields: [
            { label: "Severity", value: "Critical" },
            { label: "Owner", value: "payments-team" },
          ],
        },
      },
      {
        id: "W9",
        type: AIChatWidgetType.TimeSeriesChart,
        title: "Empty chart",
        data: { series: [] },
      },
    ],
    toolActions: [
      {
        id: "t1",
        toolName: "create_incident",
        title: "Create incident: Checkout is down",
        arguments: { severity: "Critical", title: "Checkout latency spike", tags: ["payments", "slo"] },
        isMutation: true,
        requiresApproval: true,
        status: AIChatToolActionStatus.Executed,
        resultSummary: "Incident #412 created",
      },
      {
        id: "t2",
        toolName: "restart_service",
        title: "Restart payment-svc",
        arguments: { service: "payment-svc" },
        isMutation: true,
        requiresApproval: true,
        status: AIChatToolActionStatus.Denied,
      },
    ],
    citations: [
      { id: "C1", toolName: "traces.query", label: "Traces for checkout-api", queryArguments: { service: "checkout-api", limit: 100 }, rowCount: 412 },
      { id: "C2", toolName: "logs.query", label: "Logs for payment-svc", queryArguments: { service: "payment-svc" }, rowCount: 0 },
    ],
  }),
  msg({
    id: new ObjectID("3"),
    role: AIChatMessageRole.Assistant,
    status: AIChatMessageStatus.Error,
    errorMessage: "The model timed out.",
    createdAt: now,
  }),
];

function childCount(): number {
  return 8421;
}

const run: any = new AIRun();
Object.assign(run, {
  totalCostInUSDCents: 1.2345,
  totalTokens: 48213,
  toolCallCount: 7,
  egressManifest: { modelName: "claude-opus-4-8" },
});

async function main(): Promise<void> {
  const markdown: string = convertConversationToMarkdown({
    title: "Checkout latency investigation",
    messages,
    latestRun: run,
    exportedAt: now,
  });
  fs.writeFileSync("/tmp/export-out/chat.md", markdown);

  const blob: Blob = await buildConversationPdf({
    title: "Checkout latency investigation",
    messages,
    latestRun: run,
    exportedAt: now,
  });

  const buf: Buffer = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync("/tmp/export-out/chat.pdf", buf);
  console.log("PDF bytes:", buf.length);
  console.log("MD bytes:", markdown.length);
}

main().catch((e: any) => {
  console.error("HARNESS FAILED:", e);
  process.exit(1);
});
