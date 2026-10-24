import RemediationRulePullRequests from "../../../../Server/Utils/AI/SRE/RemediationRulePullRequests";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import logger from "../../../../Server/Utils/Logger";
import IncidentAlertRuleMatcher from "../../../../Server/Utils/Rules/IncidentAlertRuleMatcher";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import {
  AutomaticFixPullRequest,
  AutomaticFixPullRequestBlocker,
  AutomaticFixPullRequestRules,
  decideAutomaticFixPullRequest,
} from "../../../../Types/AI/AutomaticFixPullRequests";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Which AI rules stand behind a pull request OneUptime AI opens on its own:
 * the project's enabled rules of the signal's kind - whether it has any -
 * and the ones that match the incident (or alert) and fix it, matched the
 * way the rule engine matches them, with each rule's two pull request
 * switches and the code repositories it names. A pull request is one of
 * the ways OneUptime AI fixes: a rule that only investigates opens none.
 * Null whenever they cannot be read: then no pull request opens
 * (decideAutomaticFixPullRequest).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
);
const ALERT_ID: ObjectID = new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1");
const MONITOR_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
);
const MONITOR_B: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
);
const SEVERITY_LOW: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
);
const CHECKOUT_REPO: string = "c1111111-1111-4111-8111-111111111111";

function ref<T extends { _id?: string | undefined }>(
  type: { new (): T },
  id: ObjectID | string,
): T {
  const model: T = new type();
  model._id = id.toString();
  return model;
}

function rule(values: Partial<AutoRemediationRule>): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), {
    _id: ObjectID.generate().toString(),
    name: "Production",
    openCodeFixPullRequests: true,
    openTelemetryPullRequests: true,
    ...values,
  });
}

function incident(): Incident {
  return Object.assign(new Incident(), {
    _id: INCIDENT_ID.toString(),
    title: "Checkout is down",
    monitors: [ref(Monitor, MONITOR_A)],
    labels: [],
  });
}

function alert(): Alert {
  return Object.assign(new Alert(), {
    _id: ALERT_ID.toString(),
    title: "Checkout is slow",
    alertSeverityId: SEVERITY_LOW,
    monitorId: MONITOR_A,
    labels: [],
  });
}

function mockRules(
  rules: Array<AutoRemediationRule> | Error,
): SpyInstance<typeof AutoRemediationRuleService.findBy> {
  return jest
    .spyOn(AutoRemediationRuleService, "findBy")
    .mockImplementation(async () => {
      if (rules instanceof Error) {
        throw rules;
      }

      return rules;
    });
}

function quietLogger(): SpyInstance<typeof logger.error> {
  return jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RemediationRulePullRequests.getRulesForSignal", () => {
  test("no enabled rule: none set up, and the incident is never read", async () => {
    mockRules([]);
    const read: SpyInstance<typeof IncidentService.findOneById> = jest.spyOn(
      IncidentService,
      "findOneById",
    );

    expect(
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual({ rulesSetUp: false, matchingRules: [] });
    expect(read).not.toHaveBeenCalled();
  });

  test("reads the project's enabled rules of the signal's kind, with what they match on, their pull requests and repositories, as root", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([]);

    await RemediationRulePullRequests.getRulesForSignal({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        isEnabled: true,
        triggerEntityType: AutoRemediationTriggerEntity.Incident,
      },
      select: {
        fixes: true,
        criteria: true,
        titlePattern: true,
        descriptionPattern: true,
        monitors: { _id: true },
        incidentSeverities: { _id: true },
        alertSeverities: { _id: true },
        labels: { _id: true },
        monitorLabels: { _id: true },
        openCodeFixPullRequests: true,
        openTelemetryPullRequests: true,
        codeRepositories: { _id: true },
      },
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("keeps the rules the incident matches, matched as the rule engine matches them", async () => {
    const matching: AutoRemediationRule = rule({
      name: "Checkout",
      monitors: [ref(Monitor, MONITOR_A)],
      openTelemetryPullRequests: false,
      codeRepositories: [ref(CodeRepository, CHECKOUT_REPO)],
    });
    mockRules([
      rule({ name: "Search", monitors: [ref(Monitor, MONITOR_B)] }),
      matching,
    ]);
    const read: SpyInstance<typeof IncidentService.findOneById> = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);
    const matcher: SpyInstance<
      typeof IncidentAlertRuleMatcher.doesIncidentMatch
    > = jest.spyOn(IncidentAlertRuleMatcher, "doesIncidentMatch");

    const rules: AutomaticFixPullRequestRules | null =
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(rules?.rulesSetUp).toBe(true);
    expect(
      rules?.matchingRules.map((matched: unknown): string | undefined => {
        return (matched as AutoRemediationRule).name;
      }),
    ).toEqual(["Checkout"]);
    expect(read.mock.calls[0]![0]).toMatchObject({
      id: INCIDENT_ID,
      select: {
        title: true,
        description: true,
        incidentSeverityId: true,
        monitors: { _id: true },
        labels: { _id: true },
      },
      props: { isRoot: true },
    });
    expect(matcher.mock.calls[0]![2]).toBe("AI rule");
  });

  test("a matching rule that only investigates opens no pull request: it is not matched at all", async () => {
    mockRules([
      rule({
        name: "Investigate checkout",
        monitors: [ref(Monitor, MONITOR_A)],
        fixes: false,
      }),
      rule({
        name: "Fix checkout",
        monitors: [ref(Monitor, MONITOR_A)],
        codeRepositories: [ref(CodeRepository, CHECKOUT_REPO)],
      }),
    ]);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);
    const matcher: SpyInstance<
      typeof IncidentAlertRuleMatcher.doesIncidentMatch
    > = jest.spyOn(IncidentAlertRuleMatcher, "doesIncidentMatch");

    const rules: AutomaticFixPullRequestRules | null =
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(rules?.rulesSetUp).toBe(true);
    expect(
      rules?.matchingRules.map((matched: unknown): string | undefined => {
        return (matched as AutoRemediationRule).name;
      }),
    ).toEqual(["Fix checkout"]);
    // The rule that only investigates is never matched.
    expect(matcher).toHaveBeenCalledTimes(1);
  });

  test("with only rules that investigate matching, rules are set up and none stands behind a pull request, so none opens", async () => {
    mockRules([rule({ monitors: [ref(Monitor, MONITOR_A)], fixes: false })]);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);

    const rules: AutomaticFixPullRequestRules | null =
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(rules).toEqual({ rulesSetUp: true, matchingRules: [] });

    for (const pullRequest of [
      AutomaticFixPullRequest.CodeFix,
      AutomaticFixPullRequest.MissingTelemetry,
    ]) {
      expect(
        decideAutomaticFixPullRequest({
          project: { enableAutomaticIncidentRemediation: true },
          signal: AutoRemediationTriggerEntity.Incident,
          pullRequest,
          rules,
        }).blocker,
      ).toBe(AutomaticFixPullRequestBlocker.NoMatchingRule);
    }
  });

  test("an alert's rules that only investigate open no pull request either", async () => {
    mockRules([
      rule({
        name: "Low, investigate only",
        alertSeverities: [ref(AlertSeverity, SEVERITY_LOW)],
        fixes: false,
      }),
    ]);
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert() as never);

    expect(
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      }),
    ).toEqual({ rulesSetUp: true, matchingRules: [] });
  });

  test("an alert reads its own rules and is matched on its own monitor and severity", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([
        rule({
          name: "Low",
          alertSeverities: [ref(AlertSeverity, SEVERITY_LOW)],
        }),
        rule({ name: "Search", monitors: [ref(Monitor, MONITOR_B)] }),
      ]);
    const read: SpyInstance<typeof AlertService.findOneById> = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alert() as never);

    const rules: AutomaticFixPullRequestRules | null =
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      });

    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { triggerEntityType: AutoRemediationTriggerEntity.Alert },
    });
    expect(read.mock.calls[0]![0]).toMatchObject({
      id: ALERT_ID,
      select: { alertSeverityId: true, monitorId: true },
    });
    expect(
      rules?.matchingRules.map((matched: unknown): string | undefined => {
        return (matched as AutoRemediationRule).name;
      }),
    ).toEqual(["Low"]);
  });

  test("rules set up, none matching: set up, with no matching rule", async () => {
    mockRules([rule({ monitors: [ref(Monitor, MONITOR_B)] })]);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);

    expect(
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual({ rulesSetUp: true, matchingRules: [] });
  });

  test("no signal named, an incident that is gone, or rules that cannot be read: null", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([rule({})]);

    expect(
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
    expect(findBy).not.toHaveBeenCalled();

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);
    expect(
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBeNull();

    jest.restoreAllMocks();
    const error: SpyInstance<typeof logger.error> = quietLogger();
    mockRules(new Error("database is down"));
    expect(
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBeNull();
    expect(String(error.mock.calls[0]![0])).toContain(
      "could not read the AI rules for a pull request; none opens",
    );
  });

  /*
   * End to end with the decision the triggers take: what was read decides
   * whether the pull request opens, and in which repositories.
   */
  test("what it reads decides the pull request: a matching rule with telemetry off opens no telemetry pull request, its fix pull request opens in its repository", async () => {
    mockRules([
      rule({
        monitors: [ref(Monitor, MONITOR_A)],
        openTelemetryPullRequests: false,
        codeRepositories: [ref(CodeRepository, CHECKOUT_REPO)],
      }),
    ]);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);

    const rules: AutomaticFixPullRequestRules | null =
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });
    const project: { enableAutomaticIncidentRemediation: boolean } = {
      enableAutomaticIncidentRemediation: true,
    };

    expect(
      decideAutomaticFixPullRequest({
        project,
        signal: AutoRemediationTriggerEntity.Incident,
        pullRequest: AutomaticFixPullRequest.MissingTelemetry,
        rules,
      }).blocker,
    ).toBe(AutomaticFixPullRequestBlocker.PullRequestOff);
    expect(
      decideAutomaticFixPullRequest({
        project,
        signal: AutoRemediationTriggerEntity.Incident,
        pullRequest: AutomaticFixPullRequest.CodeFix,
        rules,
      }),
    ).toEqual({
      blocker: null,
      repositories: {
        isEveryRepository: false,
        repositoryIds: [CHECKOUT_REPO],
      },
      // The rule picks no LLM provider: the project's default, else the global one.
      llmProviderId: "",
    });
  });

  /*
   * The pull request is written with the LLM provider the rules that open it
   * pick (Types/AI/LlmProviderChoice): what was read carries the pick.
   */
  test("what it reads carries the LLM provider the matching rule picks to the pull request", async () => {
    const OPUS: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    mockRules([
      rule({
        monitors: [ref(Monitor, MONITOR_A)],
        llmProviderId: new ObjectID(OPUS),
      }),
    ]);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);

    const rules: AutomaticFixPullRequestRules | null =
      await RemediationRulePullRequests.getRulesForSignal({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(
      decideAutomaticFixPullRequest({
        project: { enableAutomaticIncidentRemediation: true },
        signal: AutoRemediationTriggerEntity.Incident,
        pullRequest: AutomaticFixPullRequest.CodeFix,
        rules,
      }).llmProviderId,
    ).toBe(OPUS);
  });
});
