import AIService from "../../../../../../Server/Services/AIService";
import DatabaseService from "../../../../../../Server/Services/DatabaseService";
import MonitorService from "../../../../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../../../../Server/Services/OnCallDutyPolicyService";
import StatusPageService from "../../../../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../../../../Server/Services/TeamMemberService";
import {
  AskAiEvalNamedRecord,
  AskAiEvalProject,
  AskAiEvalProjectKind,
  getAskAiEvalProject,
} from "../../../../../../Server/Utils/AI/Eval/AskAi/AskAiEvalProject";
import AskAiEvalTurnRunner, {
  AskAiEvalPatches,
  AskAiEvalTurn,
  getAskingProps,
} from "../../../../../../Server/Utils/AI/Eval/AskAi/AskAiEvalTurn";
import { DASHBOARD_RECORD_READERS } from "../../../../../../Server/Utils/AI/Docs/DashboardRecordReaders";
import { AskAiRecordKind } from "../../../../../../Types/AI/AskAiRecordPages";
import DatabaseCommonInteractionProps from "../../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  AskAiSetupCase,
  gradeSetupTurn,
} from "../../../../../../Server/Utils/AI/Eval/AskAi/AskAiEvalGrades";
import { PinnedModelCall } from "../../../../../../Server/Utils/AI/Eval/PinnedModel";
import {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
} from "../../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIToolbox from "../../../../../../Server/Utils/AI/Toolbox/Index";
import { JSONObject } from "../../../../../../Types/JSON";
import { ASK_AI_SETUP_REQUESTS, SetupRequest } from "../../AskAiSetupRequests";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The live-model runner's turn (AskAiEvalTurn, #7246), held offline: each
 * of ASK_AI_SETUP_REQUESTS asked of a model that answers with the very
 * plan the list expects, through Ask AI's own chat turn. A live run is only
 * as good as its project: had one of the setup actions' checks read
 * something the runner does not answer, it would read the database, which
 * a test does not have, and the turn would fail here. So every request's
 * plan reaches its card, or is refused before it as the request's note
 * says, the grade passes, no database is reached, nothing is made, and
 * nothing stays patched.
 */

interface ScriptedModel {
  callModel: PinnedModelCall;
  calls: Array<ObservabilityAssistantModelCall>;
}

function scripted(
  replies: Array<Partial<ObservabilityAssistantModelReply>>,
): ScriptedModel {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return {
    calls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);
      const reply: Partial<ObservabilityAssistantModelReply> = replies[
        calls.length - 1
      ] || { content: "Done." };

      return {
        content: "",
        tokenCount: 100,
        providerName: "Scripted",
        modelName: "scripted",
        ...reply,
      };
    },
  };
}

// The model answers with exactly the plan the list expects, in one answer.
function answeringWith(request: SetupRequest): ScriptedModel {
  if (request.expected.length === 0) {
    return scripted([
      {
        content:
          "No setup action makes a threshold monitor of a host's memory. Create a Host monitor under Monitors > Create Monitor.",
      },
    ]);
  }

  return scripted([
    {
      stopReason: "tool_use",
      toolCalls: request.expected.map(
        (call: { tool: string; arguments: JSONObject }, index: number) => {
          return {
            id: `call-${index + 1}`,
            name: call.tool,
            arguments: call.arguments,
          };
        },
      ),
    },
    { content: "Done." },
  ]);
}

function caseOf(request: SetupRequest, index: number): AskAiSetupCase {
  return {
    id: `setup-${index + 1}`,
    request: request.request,
    projectKind: request.project as unknown as AskAiEvalProjectKind,
    expected: request.expected,
    language: request.language || "en",
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every setup request, asked of a model that proposes its plan", () => {
  test.each(
    ASK_AI_SETUP_REQUESTS.map(
      (request: SetupRequest, index: number): [string, number] => {
        return [`${index + 1}. ${request.request} (${request.project})`, index];
      },
    ),
  )("%s", async (_title: string, index: number) => {
    const request: SetupRequest = ASK_AI_SETUP_REQUESTS[index]!;
    const setupCase: AskAiSetupCase = caseOf(request, index);
    const project: AskAiEvalProject = getAskAiEvalProject(
      setupCase.projectKind,
    );
    const model: ScriptedModel = answeringWith(request);
    const monitorCreate: ReturnType<typeof jest.spyOn> = jest.spyOn(
      MonitorService,
      "create",
    );
    const policyCreate: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyService,
      "create",
    );
    const statusPageCreate: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageService,
      "create",
    );
    const memberCreate: ReturnType<typeof jest.spyOn> = jest.spyOn(
      TeamMemberService,
      "create",
    );
    // Any read or write of a database goes through a repository first.
    const databaseReached: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DatabaseService.prototype,
      "getRepository",
    );

    const turn: AskAiEvalTurn = await AskAiEvalTurnRunner.ask({
      question: request.request,
      project,
      callModel: model.callModel,
      language: setupCase.language,
    });

    expect(turn.error).toBeUndefined();
    expect(gradeSetupTurn(setupCase, project, turn)).toEqual({
      passed: true,
      reasons: [],
    });

    // The model was asked the request, with Ask AI's tools.
    expect(JSON.stringify(model.calls[0]!.messages)).toContain(
      JSON.stringify(request.request).slice(1, -1),
    );
    expect(
      (model.calls[0]!.tools || []).map((tool: { name: string }) => {
        return tool.name;
      }),
    ).toEqual(expect.arrayContaining(["set_up_website_monitoring"]));

    // Each part reached the card, or was refused before it: none ran.
    const actions: Array<string> = request.expected
      .map((call: { tool: string }): string => {
        return call.tool;
      })
      .filter((name: string): boolean => {
        return AIToolbox.isMutationTool(name);
      });
    const refused: Array<string> = turn.refusedBeforeCard.map(
      (refusal: { name: string }): string => {
        return refusal.name;
      },
    );

    expect([...turn.onCard, ...refused].sort()).toEqual([...actions].sort());
    expect(monitorCreate).not.toHaveBeenCalled();
    expect(policyCreate).not.toHaveBeenCalled();
    expect(statusPageCreate).not.toHaveBeenCalled();
    expect(memberCreate).not.toHaveBeenCalled();
    expect(databaseReached).not.toHaveBeenCalled();

    // Nothing stays patched for the next request.
    expect(
      Object.prototype.hasOwnProperty.call(AIService, "executeWithLogging"),
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(MonitorService, "findBy")).toBe(
      false,
    );
  });
});

describe("what a project's own checks say before the card", () => {
  test("a monitor of example.com is refused before the card in the project that checks it already, naming that monitor (#7292)", async () => {
    const turn: AskAiEvalTurn = await AskAiEvalTurnRunner.ask({
      question: "Monitor example.com and tell me when it is down.",
      project: getAskAiEvalProject(AskAiEvalProjectKind.ChecksExampleCom),
      callModel: scripted([
        {
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call-1",
              name: "set_up_website_monitoring",
              arguments: { address: "example.com" },
            },
          ],
        },
        { content: "Acme website checks example.com already." },
      ]).callModel,
      language: "en",
    });

    expect(turn.onCard).toEqual([]);
    expect(turn.refusedBeforeCard).toHaveLength(1);
    expect(turn.refusedBeforeCard[0]!.name).toBe("set_up_website_monitoring");
    expect(turn.refusedBeforeCard[0]!.reason).toContain("Acme website");
    expect(turn.answer).toBe("Acme website checks example.com already.");
  });

  test("in a new project the same request reaches the card", async () => {
    const turn: AskAiEvalTurn = await AskAiEvalTurnRunner.ask({
      question: "Monitor example.com and tell me when it is down.",
      project: getAskAiEvalProject(AskAiEvalProjectKind.PagesNobody),
      callModel: scripted([
        {
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call-1",
              name: "set_up_website_monitoring",
              arguments: { address: "example.com" },
            },
          ],
        },
      ]).callModel,
      language: "en",
    });

    expect(turn.onCard).toEqual(["set_up_website_monitoring"]);
    expect(turn.refusedBeforeCard).toEqual([]);
    expect(turn.answersWithActions).toBe(1);
    expect(turn.llmCallCount).toBe(1);
    expect(turn.totalTokens).toBe(100);
  });
});

describe("a turn the model does not finish", () => {
  test("a provider's error is the turn's, and grades as a failure", async () => {
    const turn: AskAiEvalTurn = await AskAiEvalTurnRunner.ask({
      question: "Monitor example.com.",
      project: getAskAiEvalProject(AskAiEvalProjectKind.PagesNobody),
      callModel: async (): Promise<ObservabilityAssistantModelReply> => {
        throw new Error("The provider refused the key.");
      },
      language: "en",
    });

    expect(turn.error).toBeDefined();
    expect(
      gradeSetupTurn(
        {
          id: "setup-x",
          request: "Monitor example.com.",
          projectKind: AskAiEvalProjectKind.PagesNobody,
          expected: [
            {
              tool: "set_up_website_monitoring",
              arguments: { address: "example.com" },
            },
          ],
          language: "en",
        },
        getAskAiEvalProject(AskAiEvalProjectKind.PagesNobody),
        turn,
      ).passed,
    ).toBe(false);
  });
});

/*
 * The records a page question is asked on since #10104 - a schedule, a
 * call policy, a team, a dashboard, a runbook, an SLO, a form - are read by
 * their IDs as their Go to buttons read them (DashboardRecordReaders), from
 * the project and never the database; a record of no project reads null.
 */
describe("the records a page question is asked on (#10104)", () => {
  test("each is read by its ID as its Go to button reads it, and no other", async () => {
    const project: AskAiEvalProject = getAskAiEvalProject(
      AskAiEvalProjectKind.PagesPeople,
    );
    const patches: AskAiEvalPatches = new AskAiEvalPatches();
    const databaseReached: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DatabaseService.prototype,
      "getRepository",
    );

    (
      AskAiEvalTurnRunner as unknown as {
        answerFromProject: (
          patches: AskAiEvalPatches,
          project: AskAiEvalProject,
        ) => void;
      }
    ).answerFromProject(patches, project);

    try {
      const props: DatabaseCommonInteractionProps = getAskingProps(project);
      const records: Array<[AskAiRecordKind, AskAiEvalNamedRecord]> = [
        [AskAiRecordKind.OnCallSchedule, project.onCallSchedules[0]!],
        [AskAiRecordKind.IncomingCallPolicy, project.incomingCallPolicies[0]!],
        [AskAiRecordKind.Team, project.teams[0]!],
        [AskAiRecordKind.Dashboard, project.dashboards[0]!],
        [AskAiRecordKind.Runbook, project.runbooks[0]!],
        [AskAiRecordKind.Slo, project.slos[0]!],
        [AskAiRecordKind.Form, project.forms[0]!],
      ];

      for (const [kind, record] of records) {
        expect([
          kind,
          await DASHBOARD_RECORD_READERS[kind]({
            id: new ObjectID(record.id),
            props,
          }),
        ]).toEqual([kind, record.name]);
        expect([
          kind,
          await DASHBOARD_RECORD_READERS[kind]({
            id: ObjectID.generate(),
            props,
          }),
        ]).toEqual([kind, null]);
      }

      expect(databaseReached).not.toHaveBeenCalled();
    } finally {
      patches.restoreAll();
    }
  });
});
