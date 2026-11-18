import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import AutoRemediationRuleEngineService from "../../../../Server/Services/AutoRemediationRuleEngineService";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import RunbookService from "../../../../Server/Services/RunbookService";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIIncidentPostmortemRunner from "../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import AutoRemediationDecisionRecorder from "../../../../Server/Utils/AutoRemediation/AutoRemediationDecisionRecorder";
import InsightScanner from "../../../../Server/Utils/AI/SRE/Insights/InsightScanner";
import ProductionReviewPoller from "../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewPoller";
import ProductionReviewQueue from "../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue";
import ProductionReviewRunner from "../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner";
import logger from "../../../../Server/Utils/Logger";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import { getProductsOfAIRun } from "../../../../Types/AI/AIRunProducts";
import AIRunType from "../../../../Types/AI/AIRunType";
import ProductSwitchedOffException from "../../../../Types/Exception/ProductSwitchedOffException";
import ObjectID from "../../../../Types/ObjectID";
import ProductKey from "../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * WHAT THE SERVER DOES BY ITSELF WHILE A PRODUCT IS SWITCHED OFF (#9489).
 *
 * What already runs keeps running - monitors' checks, telemetry, published
 * pages, a workflow's or a runbook's own schedule, webhook and events - and
 * OneUptime AI starts nothing on a switched-off product: no run is created
 * for its records (AIRunService) or queued or claimed (the investigation
 * queue), no code fix is handed to an AI agent while Code is off, no fix
 * is decided for its incidents or alerts and no runbook is picked or
 * started while Runbooks is off (auto-remediation), no postmortem is
 * drafted while Incidents is off, no finding is looked for while AI
 * Insights is off, and no pull request is reviewed while Code is off. Each
 * gate reads what is off before anything else, and answers as before while
 * the product is on.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c9489bb0-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "c9489bb0-0000-4000-8000-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("c9489bb0-0000-4000-8000-000000000003");

// What is off, on a server with its database (see the last suite).
const switchOff: (products: Array<ProductKey>) => void = (
  products: Array<ProductKey>,
): void => {
  getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  getJestSpyOn(ServerProducts, "getOff").mockResolvedValue(
    Object.fromEntries(
      products.map((product: ProductKey) => {
        return [product, ServerProductOffReason.SwitchedOff];
      }),
    ),
  );
};

const message: (title: string) => string = (title: string): string => {
  return `${title} is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.`;
};

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the products an AI run works on", () => {
  test("by its record and its kind", () => {
    expect(
      getProductsOfAIRun({
        runType: AIRunType.Investigation,
        triggeredByIncidentId: INCIDENT_ID,
      }),
    ).toEqual([ProductKey.Incidents]);
    expect(
      getProductsOfAIRun({
        runType: AIRunType.Investigation,
        triggeredByAlertId: ALERT_ID,
      }),
    ).toEqual([ProductKey.Alerts]);
    // An incident's follow-up check, for the alert that opened.
    expect(
      getProductsOfAIRun({
        runType: AIRunType.Investigation,
        triggeredByIncidentId: INCIDENT_ID,
        followUpForAlertId: ALERT_ID,
      }),
    ).toEqual([ProductKey.Incidents, ProductKey.Alerts]);
    expect(
      getProductsOfAIRun({
        runType: AIRunType.Investigation,
        triggeredByAiInsightId: "insight",
      }),
    ).toEqual([ProductKey.AIInsights]);
    expect(
      getProductsOfAIRun({
        runType: AIRunType.Investigation,
        triggeredBySecurityCaseId: "case",
      }),
    ).toEqual([ProductKey.SecurityEvents]);
  });

  test("a code fix works in Code, a conversation is AI Chat's, a runbook pick picks from Runbooks", () => {
    expect(
      getProductsOfAIRun({
        runType: AIRunType.CodeFix,
        triggeredByTelemetryExceptionId: "exception",
      }),
    ).toEqual([ProductKey.Code, ProductKey.Exceptions]);
    expect(getProductsOfAIRun({ runType: AIRunType.Chat })).toEqual([
      ProductKey.AIChat,
    ]);
    expect(
      getProductsOfAIRun({
        runType: AIRunType.RemediationPlan,
        triggeredByAlertId: ALERT_ID,
      }),
    ).toEqual([ProductKey.Runbooks, ProductKey.Alerts]);
    expect(
      getProductsOfAIRun({
        runType: AIRunType.RemediationExecution,
        triggeredByIncidentId: INCIDENT_ID,
      }),
    ).toEqual([ProductKey.Incidents]);
    // A reply in a Code task's conversation.
    expect(
      getProductsOfAIRun({
        runType: AIRunType.CodeFix,
        codeTaskId: "task",
        codeRepositoryId: "repository",
      }),
    ).toEqual([ProductKey.Code]);
  });

  test("a run of nothing in particular works on no product", () => {
    expect(getProductsOfAIRun({})).toEqual([]);
    expect(
      getProductsOfAIRun({
        runType: AIRunType.Investigation,
        triggeredByIncidentId: null,
        triggeredByAlertId: "",
      }),
    ).toEqual([]);
  });

  test("every kind of run is decided", () => {
    for (const runType of Object.values(AIRunType)) {
      expect(Array.isArray(getProductsOfAIRun({ runType }))).toBe(true);
    }
  });
});

describe("AIRunService: OneUptime AI starts no run on a product switched off", () => {
  const codeFix: () => AIRun = (): AIRun => {
    const run: AIRun = new AIRun();
    run.projectId = PROJECT_ID;
    run.runType = AIRunType.CodeFix;
    return run;
  };

  test("a run of a product that is off is refused before anything is written, naming it", async () => {
    switchOff([ProductKey.Code]);
    const counter: SpyInstance<
      typeof ProjectService.incrementAndGetAIRunCounter
    > = jest.spyOn(ProjectService, "incrementAndGetAIRunCounter");

    const refusal: unknown = await (
      AIRunService as unknown as {
        onBeforeCreate: (createBy: unknown) => Promise<unknown>;
      }
    )
      .onBeforeCreate({ data: codeFix(), props: { isRoot: true } })
      .catch((err: unknown) => {
        return err;
      });

    expect(refusal).toBeInstanceOf(ProductSwitchedOffException);
    expect((refusal as Error).message).toBe(message("Code"));
    // Its task number is never taken: nothing is written for it.
    expect(counter).not.toHaveBeenCalled();
  });

  test("whoever asks, the server included", async () => {
    switchOff([ProductKey.Incidents]);
    const run: AIRun = new AIRun();
    run.projectId = PROJECT_ID;
    run.runType = AIRunType.Investigation;
    run.triggeredByIncidentId = INCIDENT_ID;

    await expect(AIRunService.assertProductsAreOn(run)).rejects.toThrow(
      message("Incidents"),
    );
  });

  test("a run of products that are on goes on", async () => {
    switchOff([ProductKey.Logs, ProductKey.Alerts]);
    const run: AIRun = new AIRun();
    run.runType = AIRunType.Investigation;
    run.triggeredByIncidentId = INCIDENT_ID;

    await expect(
      AIRunService.assertProductsAreOn(run),
    ).resolves.toBeUndefined();
    await expect(AIRunService.getOffProductOfRun(run)).resolves.toBeNull();
  });

  test("no code fix is handed to an AI agent, nor counted, while Code is off", async () => {
    switchOff([ProductKey.Code]);
    const repository: SpyInstance<typeof AIRunService.getRepository> =
      jest.spyOn(AIRunService, "getRepository");

    await expect(
      AIRunService.claimNextQueuedCodeFixRun({
        aiAgentId: new ObjectID("c9489bb0-0000-4000-8000-0000000000aa"),
        worker: {} as never,
      }),
    ).resolves.toBeNull();
    await expect(
      AIRunService.countClaimableCodeFixRuns({} as never),
    ).resolves.toBe(0);
    expect(repository).not.toHaveBeenCalled();
  });
});

describe("the investigation queue", () => {
  test("enqueues nothing for a record of a product that is off, quietly", async () => {
    switchOff([ProductKey.Incidents]);
    const budget: SpyInstance<typeof AIService.getAutonomousDailyBudgetStatus> =
      jest.spyOn(AIService, "getAutonomousDailyBudgetStatus");
    const created: SpyInstance<typeof AIRunService.create> = jest.spyOn(
      AIRunService,
      "create",
    );
    const notEnqueued: Mock = jest.fn();

    await expect(
      AIInvestigationQueue.enqueue({
        projectId: PROJECT_ID,
        subjectIncidentId: INCIDENT_ID,
        onNotEnqueued: notEnqueued as never,
      }),
    ).resolves.toBeNull();

    expect(budget).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    // Not a failure to say on the record's AI card: its product is off.
    expect(notEnqueued).not.toHaveBeenCalled();
  });

  test("a runbook pick is not enqueued while Runbooks is off", async () => {
    switchOff([ProductKey.Runbooks]);
    const budget: SpyInstance<typeof AIService.getAutonomousDailyBudgetStatus> =
      jest.spyOn(AIService, "getAutonomousDailyBudgetStatus");
    const created: SpyInstance<typeof AIRunService.create> = jest.spyOn(
      AIRunService,
      "create",
    );

    await expect(
      AIInvestigationQueue.enqueue({
        projectId: PROJECT_ID,
        subjectAlertId: ALERT_ID,
        subjectAutoRemediationSuggestionId: new ObjectID(
          "c9489bb0-0000-4000-8000-0000000000bb",
        ),
      }),
    ).resolves.toBeNull();
    expect(budget).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  });

  test("a run queued before its product was switched off is left queued, not claimed", async () => {
    switchOff([ProductKey.Alerts]);
    const claim: jest.SpyInstance = getJestSpyOn(AIInvestigationQueue, "claim");
    // The claim's other gates - the project's caps, the budget - are not asked.
    const project: SpyInstance<typeof ProjectService.findOneById> = jest.spyOn(
      ProjectService,
      "findOneById",
    );
    const budget: SpyInstance<typeof AIService.getAutonomousDailyBudgetStatus> =
      jest.spyOn(AIService, "getAutonomousDailyBudgetStatus");

    await AIInvestigationQueue.processRun({
      id: new ObjectID("c9489bb0-0000-4000-8000-0000000000cc"),
      projectId: PROJECT_ID,
      attemptCount: 0,
      runType: AIRunType.Investigation,
      triggeredByAlertId: ALERT_ID,
    });

    expect(claim).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(budget).not.toHaveBeenCalled();
  });
});

describe("auto-remediation", () => {
  const incident: () => Incident = (): Incident => {
    const value: Incident = new Incident();
    value.id = INCIDENT_ID;
    value.projectId = PROJECT_ID;
    return value;
  };

  test("decides nothing, and writes nothing, for an incident while Incidents is off", async () => {
    switchOff([ProductKey.Incidents]);
    const applyRules: jest.SpyInstance = getJestSpyOn(
      AutoRemediationRuleEngineService,
      "applyRules",
    );

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(applyRules).not.toHaveBeenCalled();
  });

  test("nor for an alert while Alerts is off - and an incident goes on", async () => {
    switchOff([ProductKey.Alerts]);
    const applyRules: jest.SpyInstance = getJestSpyOn(
      AutoRemediationRuleEngineService,
      "applyRules",
    ).mockResolvedValue(undefined);

    const alert: Alert = new Alert();
    alert.id = ALERT_ID;
    alert.projectId = PROJECT_ID;

    await AutoRemediationRuleEngineService.applyRulesToAlert(alert);

    expect(applyRules).not.toHaveBeenCalled();

    // The recorder saves what it found; here it has nothing to save it to.
    jest
      .spyOn(AutoRemediationDecisionRecorder.prototype, "save")
      .mockResolvedValue(undefined as never);

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(applyRules).toHaveBeenCalledTimes(1);
  });

  test("OneUptime AI has no runbook to pick while Runbooks is off, and counts none", async () => {
    switchOff([ProductKey.Runbooks]);
    const count: SpyInstance<typeof RunbookService.countBy> = jest.spyOn(
      RunbookService,
      "countBy",
    );

    await expect(
      (
        AutoRemediationRuleEngineService as unknown as {
          hasRunbooksToPick: (data: unknown) => Promise<boolean>;
        }
      ).hasRunbooksToPick({ projectId: PROJECT_ID, runbookIds: [] }),
    ).resolves.toBe(false);
    expect(count).not.toHaveBeenCalled();
  });

  test("a rule's runbook is not started while Runbooks is off, and the record's feed says why", async () => {
    switchOff([ProductKey.Runbooks]);
    const started: SpyInstance<
      typeof RunbookRuleEngineService.startRunbookFor
    > = jest.spyOn(RunbookRuleEngineService, "startRunbookFor");
    const posted: jest.SpyInstance = getJestSpyOn(
      AutoRemediationRuleEngineService,
      "postFeedItem",
    ).mockResolvedValue(undefined);

    const rule: AutoRemediationRule = new AutoRemediationRule();
    rule.id = new ObjectID("c9489bb0-0000-4000-8000-0000000000dd");
    rule.name = "Restart on 5xx";
    const runbook: Runbook = new Runbook();
    runbook.id = new ObjectID("c9489bb0-0000-4000-8000-0000000000ee");
    runbook.name = "Restart checkout";

    await expect(
      (
        AutoRemediationRuleEngineService as unknown as {
          autoExecuteRunbook: (data: unknown) => Promise<boolean>;
        }
      ).autoExecuteRunbook({
        projectId: PROJECT_ID,
        rule,
        runbook,
        linkage: { incidentId: INCIDENT_ID },
      }),
    ).resolves.toBe(false);

    expect(started).not.toHaveBeenCalled();
    expect(posted).toHaveBeenCalledTimes(1);

    const markdown: string = String(
      (posted.mock.calls[0]![0] as { markdown: string }).markdown,
    );

    expect(markdown).toContain('AI rule "Restart on 5xx" matched');
    expect(markdown).toContain('runbook "Restart checkout" was not started');
    expect(markdown).toContain("Runbooks is switched off on this server");
  });
});

describe("OneUptime AI's own jobs", () => {
  test("no postmortem is drafted while Incidents is off: nothing is read for it", async () => {
    switchOff([ProductKey.Incidents]);
    const project: SpyInstance<typeof ProjectService.findOneById> = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await AIIncidentPostmortemRunner.draftPostmortemOnResolve({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(project).not.toHaveBeenCalled();
    await expect(
      AIIncidentPostmortemRunner.isIncidentsSwitchedOff(),
    ).resolves.toBe(true);
  });

  test("nor is a draft that waited for its calls written", async () => {
    switchOff([ProductKey.Incidents]);
    const incident: SpyInstance<typeof IncidentService.findOneById> =
      jest.spyOn(IncidentService, "findOneById");

    await AIIncidentPostmortemRunner.draftWaitingPostmortem({
      incidentId: INCIDENT_ID,
    });

    expect(incident).not.toHaveBeenCalled();
  });

  test("no finding is looked for while AI Insights is off", async () => {
    switchOff([ProductKey.AIInsights]);
    const list: SpyInstance<typeof InsightScanner.listProjectsToScan> =
      jest.spyOn(InsightScanner, "listProjectsToScan");

    await InsightScanner.scanAllProjects();

    expect(list).not.toHaveBeenCalled();
  });

  test("no pull request is reviewed, nor a Git server read, while Code is off", async () => {
    switchOff([ProductKey.Code]);
    const due: SpyInstance<typeof ProductionReviewQueue.claimDue> = jest.spyOn(
      ProductionReviewQueue,
      "claimDue",
    );
    const repositories: SpyInstance<typeof CodeRepositoryService.findBy> =
      jest.spyOn(CodeRepositoryService, "findBy");

    await expect(ProductionReviewRunner.runDueReviews()).resolves.toBe(0);
    await expect(ProductionReviewPoller.pollAll()).resolves.toEqual({
      repositories: 0,
      asked: 0,
    });
    expect(due).not.toHaveBeenCalled();
    expect(repositories).not.toHaveBeenCalled();
  });

  test("while each product is on, each job goes on to its work", async () => {
    switchOff([ProductKey.Logs]);
    const list: SpyInstance<typeof InsightScanner.listProjectsToScan> = jest
      .spyOn(InsightScanner, "listProjectsToScan")
      .mockResolvedValue([]);
    const due: SpyInstance<typeof ProductionReviewQueue.claimDue> = jest
      .spyOn(ProductionReviewQueue, "claimDue")
      .mockResolvedValue([]);

    await InsightScanner.scanAllProjects();
    await expect(ProductionReviewRunner.runDueReviews()).resolves.toBe(0);

    expect(list).toHaveBeenCalledTimes(1);
    expect(due).toHaveBeenCalledTimes(1);
    await expect(
      AIIncidentPostmortemRunner.isIncidentsSwitchedOff(),
    ).resolves.toBe(false);
  });
});

/*
 * As ProductWriteRefusal reads it: without a database to read the
 * products from (a unit test of a service), nothing is off for the
 * server's own work - nothing could be written either - and what is off
 * is never asked.
 */
describe("without a database", () => {
  test("nothing is off for the server's own work, and nothing is asked", async () => {
    getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);
    const getOff: jest.SpyInstance = getJestSpyOn(
      ServerProducts,
      "getOff",
    ).mockResolvedValue({
      [ProductKey.Code]: ServerProductOffReason.SwitchedOff,
    });

    await expect(
      ServerProducts.getOffReasonOfServerWork(ProductKey.Code),
    ).resolves.toBeNull();
    await expect(
      ServerProducts.getFirstOffOfServerWork([ProductKey.Code]),
    ).resolves.toBeNull();
    expect(getOff).not.toHaveBeenCalled();
  });

  test("with one, the server's own work reads what is off as everything else does", async () => {
    switchOff([ProductKey.Code]);

    await expect(
      ServerProducts.getOffReasonOfServerWork(ProductKey.Code),
    ).resolves.toBe(ServerProductOffReason.SwitchedOff);
    await expect(
      ServerProducts.getFirstOffOfServerWork([
        ProductKey.Incidents,
        ProductKey.Code,
      ]),
    ).resolves.toEqual({
      product: ProductKey.Code,
      reason: ServerProductOffReason.SwitchedOff,
    });
    await expect(
      ServerProducts.getFirstOffOfServerWork([]),
    ).resolves.toBeNull();
  });
});
