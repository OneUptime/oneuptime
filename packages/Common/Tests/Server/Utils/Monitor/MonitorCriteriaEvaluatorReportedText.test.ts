import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { renderAsDashboard } from "../../../Utils/Markdown/DashboardMarkdownRenderer";
import { describe, expect, test } from "@jest/globals";
import { Lexer, Token, marked } from "marked";

/*
 * WHAT A FILTER FOUND, IN A ROOT CAUSE.
 *
 * A filter's finding can quote what the monitored system sent - "Email body
 * is not empty. Value: <the body>", a probe's own account of a failure. The
 * root cause built from the findings is Markdown, shown on the dashboard, in
 * email and in the record's Slack and Microsoft Teams channels: there each
 * finding is escaped, so it reads as sent and is no link, image, HTML or
 * chat mention. The evaluation summary shows the same findings as plain
 * text, and keeps them exactly as written.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

const SUBJECT: string =
  "<!channel> [Verify your account](https://evil.example/login)";
const BODY: string =
  "Backup failed <@U0123ABC>\n\n![](https://tracker.example/p.png)\n<img src=x>";

const CRITERIA_NAME: string = "Backup [failed](https://evil.example/c)";

const SLACK_MENTION_PATTERN: RegExp = /<[!@#][A-Za-z0-9]/;

// A Markdown text as its reader sees it: backslash escapes and joiners gone.
function asRead(markdown: string): string {
  return markdown
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .split("⁠")
    .join("");
}

function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(
    new Lexer({ gfm: true }).lex(markdown),
    (token: Token): void => {
      tokens.push(token);
    },
  );

  return tokens;
}

// No image, HTML tag, link to an address the email brought, or mention.
function expectInert(markdown: string): void {
  const tokens: Array<Token> = tokensOf(markdown);
  const html: string = renderAsDashboard([markdown])[0]!;

  expect(
    tokens
      .filter((token: Token): boolean => {
        return (
          token.type === "image" ||
          (token.type === "html" && /<\/?[A-Za-z]/.test(token.raw)) ||
          (token.type === "link" &&
            /^https:\/\/(?:evil|tracker)\.example/.test(
              (token as { href: string }).href,
            ) &&
            (token as { text: string }).text !==
              (token as { href: string }).href)
        );
      })
      .map((token: Token): string => {
        return token.raw;
      }),
  ).toEqual([]);
  expect(html).not.toMatch(/<img|<a href="https:\/\/(?:evil|tracker)[^"]*">[^h]/);
  expect(SlackUtil.convertMarkdownToSlackRichText(markdown)).not.toMatch(
    SLACK_MENTION_PATTERN,
  );
}

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.IncomingEmail;
  model.name = "Nightly backups";
  return model;
}

function email(): IncomingEmailMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailFrom: "backups@acme.example",
    emailTo: "monitor-[REDACTED]@inbound.oneuptime.example",
    emailSubject: SUBJECT,
    emailBody: BODY,
    emailHeaders: {},
    emailReceivedAt: new Date("2026-10-05T09:55:00.000Z"),
    checkedAt: new Date("2026-10-05T09:55:00.000Z"),
    onlyCheckForIncomingEmailReceivedAt: false,
  };
}

const BODY_NOT_EMPTY: CriteriaFilter = {
  checkOn: CheckOn.EmailBody,
  filterType: FilterType.IsNotEmpty,
  value: undefined,
};

const SUBJECT_CONTAINS: CriteriaFilter = {
  checkOn: CheckOn.EmailSubject,
  filterType: FilterType.Contains,
  value: "verify",
};

function step(filterCondition: FilterCondition): MonitorStep {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = CRITERIA_NAME;
  instance.data!.filterCondition = filterCondition;
  instance.data!.filters = [BODY_NOT_EMPTY, SUBJECT_CONTAINS];
  instance.data!.createIncidents = false;
  instance.data!.createAlerts = false;

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray = [
    instance,
  ];
  return monitorStep;
}

async function evaluate(
  filterCondition: FilterCondition,
  dataToProcess: IncomingEmailMonitorRequest | ProbeMonitorResponse = email(),
): Promise<{ rootCause: string; criteriaResult: MonitorEvaluationCriteriaResult }> {
  const evaluationSummary: MonitorEvaluationSummary = {
    evaluatedAt: new Date(),
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: step(filterCondition),
      monitor: monitor(),
      probeApiIngestResponse: {
        monitorId: MONITOR_ID,
        rootCause: null,
      } as ProbeApiIngestResponse,
      evaluationSummary: evaluationSummary,
    });

  expect(response.rootCause).toBeTruthy();

  return {
    rootCause: response.rootCause!,
    criteriaResult: evaluationSummary.criteriaResults[0]!,
  };
}

describe("A root cause quotes what a filter found as text", () => {
  test.each([[FilterCondition.All], [FilterCondition.Any]])(
    "with %s filters, nothing the email holds acts on its own in the root cause",
    async (filterCondition: FilterCondition) => {
      const { rootCause } = await evaluate(filterCondition);

      expectInert(rootCause);
    },
  );

  test("each finding reads as written, on its own line of the list", async () => {
    const { rootCause, criteriaResult } = await evaluate(FilterCondition.All);

    expect(asRead(rootCause)).toContain(
      `All filters met.\n- Email body is not empty. Value: ${BODY.split("\n").join(" ")}\n- Email subject contains "verify".`,
    );
    // The criteria's name is text too.
    expect(asRead(rootCause)).toContain(`**Criteria Name**: ${CRITERIA_NAME}`);
    expect(rootCause).not.toContain(CRITERIA_NAME);

    // The evaluation summary is plain text: the findings as written.
    expect(criteriaResult.message).toBe(
      `All filters met.\n- Email body is not empty. Value: ${BODY}\n- Email subject contains "verify".`,
    );
    expect(
      criteriaResult.filters.map((filter: { message: string }): string => {
        return filter.message;
      }),
    ).toEqual([
      `Email body is not empty. Value: ${BODY}`,
      'Email subject contains "verify".',
    ]);
  });

  test("with Any filters, the first finding is the root cause, escaped, and the summary keeps it as written", async () => {
    const { rootCause, criteriaResult } = await evaluate(FilterCondition.Any);

    expect(asRead(rootCause)).toContain(
      `**Filter Conditions Met**: Email body is not empty. Value: ${BODY.split("\n").join(" ")}`,
    );
    expect(criteriaResult.message).toBe(
      `Email body is not empty. Value: ${BODY}`,
    );
  });
});

describe("A root cause quotes a probe's account of a failure as text", () => {
  test("the failure cause and the request's failure details are escaped", async () => {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data!.id = "criteria-1";
    instance.data!.name = "Site down";
    instance.data!.filterCondition = FilterCondition.Any;
    instance.data!.filters = [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      },
    ];

    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray = [
      instance,
    ];

    const website: Monitor = monitor();
    website.monitorType = MonitorType.Website;

    const failureCause: string =
      "getaddrinfo ENOTFOUND <!channel> [Open status](https://evil.example/s)";

    const evaluationSummary: MonitorEvaluationSummary = {
      evaluatedAt: new Date(),
      criteriaResults: [],
      events: [],
    };

    const response: ProbeApiIngestResponse =
      await MonitorCriteriaEvaluator.processMonitorStep({
        dataToProcess: {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          isOnline: false,
          failureCause: failureCause,
          monitoredAt: new Date(),
          probeId: ObjectID.generate(),
          monitorStepId: ObjectID.generate(),
        } as unknown as ProbeMonitorResponse,
        monitorStep: monitorStep,
        monitor: website,
        probeApiIngestResponse: {
          monitorId: MONITOR_ID,
          rootCause: null,
        } as ProbeApiIngestResponse,
        evaluationSummary: evaluationSummary,
      });

    expect(response.rootCause).toBeTruthy();
    expectInert(response.rootCause!);
    expect(asRead(response.rootCause!)).toContain(`**Cause**: ${failureCause}`);
  });
});
