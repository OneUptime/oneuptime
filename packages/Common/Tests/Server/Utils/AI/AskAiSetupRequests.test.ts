import ChatAgentRunner from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import { ObservabilityTool } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { LLMToolCall } from "../../../../Server/Utils/LLM/LLMService";
import { JSONObject } from "../../../../Types/JSON";
import { parseWebsiteAddress } from "../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import {
  ASK_AI_SETUP_REQUESTS,
  ExpectedSetupCall,
  SetupRequest,
  SetupRequestProject,
} from "./AskAiSetupRequests";
import { describe, expect, test } from "@jest/globals";

/*
 * THE FIXED LIST OF SETUP REQUESTS, CHECKED OFFLINE (issue #6829).
 *
 * The list (AskAiSetupRequests) is what a live-model run replays. Offline,
 * every plan in it must be one the toolbox can carry out as written: each
 * call names a tool, each argument is one that tool's schema takes, of its
 * type and among its choices, every required one is there; a plan is
 * proposed whole and runs in its plan's order; a project that pages people
 * already is never offered a second policy; and every address and monitor a
 * plan names is one the setup actions can read.
 */

function schemaOf(tool: ObservabilityTool): {
  properties: Record<string, JSONObject>;
  required: Array<string>;
} {
  return {
    properties: (tool.inputSchema["properties"] || {}) as Record<
      string,
      JSONObject
    >,
    required: (tool.inputSchema["required"] || []) as Array<string>,
  };
}

function matchesType(value: unknown, property: JSONObject): boolean {
  switch (property["type"]) {
    case "string":
      return (
        typeof value === "string" &&
        (!Array.isArray(property["enum"]) ||
          (property["enum"] as Array<string>).includes(value))
      );
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "array":
      return (
        Array.isArray(value) &&
        value.every((item: unknown) => {
          return matchesType(item, (property["items"] || {}) as JSONObject);
        })
      );
    default:
      return false;
  }
}

describe("the fixed list of setup requests", () => {
  test("opens with the issue's own sentence, and covers every setup action and the read beside them", () => {
    expect(ASK_AI_SETUP_REQUESTS[0]!.request).toBe(
      "Monitor example.com every minute and text me if it is down.",
    );
    expect(ASK_AI_SETUP_REQUESTS.length).toBeGreaterThanOrEqual(12);

    const used: Set<string> = new Set(
      ASK_AI_SETUP_REQUESTS.flatMap((entry: SetupRequest) => {
        return entry.expected.map((call: ExpectedSetupCall) => {
          return call.tool;
        });
      }),
    );

    for (const tool of AIToolbox.getTools()) {
      if (tool.setupAction) {
        expect(used).toContain(tool.name);
      }
    }
    expect(used).toContain("who_is_told");
  });

  test.each(
    ASK_AI_SETUP_REQUESTS.map(
      (entry: SetupRequest, index: number): [string, SetupRequest] => {
        return [`${index + 1}. ${entry.request}`, entry];
      },
    ),
  )(
    "%s: every call is one the toolbox takes, as written",
    (_name: string, entry: SetupRequest) => {
      for (const call of entry.expected) {
        const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(
          call.tool,
        );

        expect({ call: call.tool, exists: Boolean(tool) }).toEqual({
          call: call.tool,
          exists: true,
        });

        const schema: {
          properties: Record<string, JSONObject>;
          required: Array<string>;
        } = schemaOf(tool!);

        for (const required of schema.required) {
          expect({
            call: call.tool,
            required,
            given: required in call.arguments,
          }).toEqual({ call: call.tool, required, given: true });
        }

        for (const [key, value] of Object.entries(call.arguments)) {
          expect({
            call: call.tool,
            key,
            known: key in schema.properties,
          }).toEqual({ call: call.tool, key, known: true });
          expect({
            call: call.tool,
            key,
            fits: matchesType(value, schema.properties[key]!),
          }).toEqual({ call: call.tool, key, fits: true });
        }
      }
    },
  );

  test.each(
    ASK_AI_SETUP_REQUESTS.map(
      (entry: SetupRequest, index: number): [string, SetupRequest] => {
        return [`${index + 1}. ${entry.request}`, entry];
      },
    ),
  )(
    "%s: a plan is the setup actions alone, and runs in its plan's order",
    (_name: string, entry: SetupRequest) => {
      const setupCalls: Array<ExpectedSetupCall> = entry.expected.filter(
        (call: ExpectedSetupCall) => {
          return AIToolbox.isSetupAction(call.tool);
        },
      );

      // A plan is setup actions only, so its card can say nothing else changes.
      if (setupCalls.length > 0) {
        expect(setupCalls).toHaveLength(entry.expected.length);
      }

      const asLlmCalls: Array<LLMToolCall> = entry.expected.map(
        (call: ExpectedSetupCall, index: number): LLMToolCall => {
          return {
            id: `call-${index}`,
            name: call.tool,
            arguments: call.arguments,
          };
        },
      );
      const ran: Array<string> = ChatAgentRunner.orderForRun(asLlmCalls).map(
        (call: LLMToolCall) => {
          return call.name;
        },
      );
      const byPlanOrder: Array<string> = [...entry.expected]
        .map((call: ExpectedSetupCall) => {
          return call.tool;
        })
        .sort((a: string, b: string): number => {
          return (
            AIToolbox.getSetupPlanOrder(a) - AIToolbox.getSetupPlanOrder(b)
          );
        });

      expect(ran).toEqual(byPlanOrder);
    },
  );

  test("a project that pages people already is never offered a second policy", () => {
    for (const entry of ASK_AI_SETUP_REQUESTS) {
      if (entry.project !== SetupRequestProject.PagesPeople) {
        continue;
      }

      expect(
        entry.expected.map((call: ExpectedSetupCall) => {
          return call.tool;
        }),
      ).not.toContain("set_up_paging");
    }
  });

  test("every address is one a website monitor checks, and a status page names the monitor its plan sets up by that monitor's name", () => {
    for (const entry of ASK_AI_SETUP_REQUESTS) {
      const monitorNames: Array<string> = [];

      for (const call of entry.expected) {
        if (call.tool === "set_up_website_monitoring") {
          const address: ReturnType<typeof parseWebsiteAddress> =
            parseWebsiteAddress(call.arguments["address"] as string);

          expect({ request: entry.request, parsed: Boolean(address) }).toEqual({
            request: entry.request,
            parsed: true,
          });
          monitorNames.push(address!.monitorName);
        }
      }

      for (const call of entry.expected) {
        if (
          (call.tool === "publish_status_page" ||
            call.tool === "add_monitors_to_status_page") &&
          monitorNames.length > 0
        ) {
          for (const name of monitorNames) {
            expect(call.arguments["monitors"]).toContain(name);
          }
        }
      }
    }
  });

  test("a request no setup action answers proposes none", () => {
    const unanswered: Array<SetupRequest> = ASK_AI_SETUP_REQUESTS.filter(
      (entry: SetupRequest) => {
        return entry.expected.length === 0;
      },
    );

    expect(unanswered.length).toBeGreaterThan(0);

    for (const entry of unanswered) {
      expect(entry.note).toContain("no setup action makes one");
    }
  });
});
