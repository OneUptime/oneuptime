import { describe, expect, jest, test } from "@jest/globals";
import {
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getTemplateGraphSpec,
  getWorkflowTemplate,
} from "../../../Types/Workflow/Templates";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { ConditionOperator } from "../../../Types/Workflow/Components/Condition";
import ObjectID from "../../../Types/ObjectID";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import {
  buildWorkflowFromTemplate,
  buildWorkflowVariables,
  validateTemplateVariableValues,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplateCreateUtil";
import VMUtil from "../../../Server/Utils/VM/VMAPI";

jest.mock("../../../Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: { runCodeInSandbox: jest.fn() } };
});

const templateIds: Array<string> = [
  "github-comment-incident",
  "github-labeled-issue-incident",
  "incident-created-github-issue",
];
const projectId: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161001",
);
const workflowId: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161002",
);
const incidentId: string = "0198c8ec-2a1d-7f0c-9e75-384194161003";
const values: Record<string, string> = {
  githubRepository: "acme/payments",
  incidentSeverityId: "0198c8ec-2a1d-7f0c-9e75-384194161004",
  incidentListUrl: `https://oneuptime.example/dashboard/${projectId.toString()}/incidents`,
  incidentLabel: "production-incident",
};

const argsOf: (templateId: string, componentId: string) => JSONObject = (
  templateId: string,
  componentId: string,
): JSONObject => {
  const args: JSONObject | undefined = getTemplateGraphSpec(
    templateId,
  )?.nodes.find((node: { componentId: string }): boolean => {
    return node.componentId === componentId;
  })?.args;
  if (!args) {
    throw new Error(`Missing arguments for ${templateId}/${componentId}`);
  }
  return args;
};

const storageFor: (event?: JSONObject) => JSONObject = (
  event: JSONObject = {},
): JSONObject => {
  return {
    local: {
      variables: values,
      components: {
        "github-event-1": {
          returnValues: {
            repository: "acme/payments",
            issueNumber: 42,
            sender: "octocat",
            commandArguments: "Checkout is down",
            title: "Checkout is down",
            body: "Requests are failing.",
            url: "https://github.com/acme/payments/issues/42#issuecomment-1",
            ...event,
          },
        },
        "incident-create-one-1": {
          returnValues: { model: { _id: { value: incidentId } } },
        },
        "incident-on-create-1": {
          returnValues: {
            model: {
              _id: { value: incidentId },
              title: "Checkout is down",
              description: "Requests are failing.",
              incidentNumberWithPrefix: "INC-42",
            },
          },
        },
      },
    },
    global: { variables: {} },
  };
};

const resolve: (args: JSONObject, event?: JSONObject) => JSONObject = (
  args: JSONObject,
  event?: JSONObject,
): JSONObject => {
  return VMUtil.replaceValueInPlace(
    storageFor(event),
    args as never,
    false,
  ) as unknown as JSONObject;
};

describe("GitHub starter workflow configuration", () => {
  test.each(templateIds)(
    "%s is opt-in, tenant scoped, and uses no secret token",
    (id: string) => {
      const template: WorkflowTemplate = getWorkflowTemplate(id)!;
      const workflow: Workflow = buildWorkflowFromTemplate({
        template: template,
        name: template.workflowName,
        description: template.workflowDescription,
        projectId: projectId,
        values: values,
      });
      expect(template.category).toBe(WorkflowTemplateCategory.Integrations);
      expect(workflow.isEnabled).toBe(false);
      expect(workflow.projectId).toEqual(projectId);
      expect(workflow.graph?.["nodes"]).not.toHaveLength(0);
      expect(validateTemplateVariableValues(template, values)).toEqual({});
      const rows: Array<WorkflowVariable> = buildWorkflowVariables({
        template: template,
        values: values,
        workflowId: workflowId,
        projectId: projectId,
      });
      expect(rows).toHaveLength(template.variables.length);
      for (const row of rows) {
        expect(row.projectId).toEqual(projectId);
        expect(row.workflowId).toEqual(workflowId);
        expect((row as unknown as { isSecret: boolean }).isSecret).toBe(false);
        expect(row.content).toBe(values[row.name!]);
      }
      expect(
        template.variables.find(
          (variable: WorkflowTemplateVariable): boolean => {
            return variable.name === "githubRepository";
          },
        )?.required,
      ).toBe(true);
    },
  );

  test.each(templateIds)("%s requires every setup value", (id: string) => {
    const template: WorkflowTemplate = getWorkflowTemplate(id)!;
    const errors: Record<string, string> = validateTemplateVariableValues(
      template,
      {},
    );
    expect(Object.keys(errors).sort()).toEqual(
      template.variables
        .map((variable: WorkflowTemplateVariable): string => {
          return variable.name;
        })
        .sort(),
    );
  });

  test("comment commands only run for new explicit commands from non-bot writers", () => {
    const args: JSONObject = resolve(
      argsOf("github-comment-incident", "github-event-1"),
    );
    expect(args).toEqual({
      repository: "acme/payments",
      event: "issue_comment",
      actions: "created",
      commentType: "all",
      commentCommand: "@oneuptime incident",
      ignoreBots: true,
      requireWriteAccess: true,
    });
  });

  test("the command title is mandatory before incident creation", () => {
    const condition: JSONObject = argsOf(
      "github-comment-incident",
      "has-title",
    );
    const empty: JSONObject = resolve(condition, { commandArguments: "" });
    const complete: JSONObject = resolve(condition, {
      commandArguments: "Checkout is down",
    });
    expect(empty["input-1"]).toBe(empty["input-2"]);
    expect(complete["input-1"]).not.toBe(complete["input-2"]);
    expect(condition["operator"]).toBe(ConditionOperator.NotEqualTo);
    const graph: ReturnType<typeof getTemplateGraphSpec> = getTemplateGraphSpec(
      "github-comment-incident",
    );
    expect(graph?.edges).toContainEqual({
      fromComponentId: "has-title",
      fromPort: "yes",
      toComponentId: "incident-create-one-1",
    });
    expect(graph?.edges).toContainEqual({
      fromComponentId: "has-title",
      fromPort: "no",
      toComponentId: "github-usage-reply",
    });
    expect(
      graph?.edges.filter((edge: { toComponentId: string }): boolean => {
        return edge.toComponentId === "incident-create-one-1";
      }),
    ).toHaveLength(1);
  });

  test("label escalation listens for the chosen label being added", () => {
    expect(
      resolve(argsOf("github-labeled-issue-incident", "github-event-1")),
    ).toEqual({
      repository: "acme/payments",
      event: "issues",
      actions: "labeled",
      label: "production-incident",
      ignoreBots: true,
    });
  });
});

describe("GitHub templates through real workflow substitution", () => {
  test.each([
    'Checkout says "failed"',
    "Line one\nLine two\tTabbed",
    "$& $1 $` $' literal replacement text",
    '<script>alert("untrusted")</script>',
    "Emoji 🚨 and Unicode 支払い",
    'x", "projectId": "other-tenant", "title": "injected',
    "{{local.variables.incidentSeverityId}}",
    "{{#each local.variables}}{{this}}{{/each}}",
  ])("comment title remains literal data: %s", (title: string) => {
    const resolved: JSONObject = resolve(
      argsOf("github-comment-incident", "incident-create-one-1"),
      { commandArguments: title },
    );
    const incident: JSONObject = resolved["json"] as JSONObject;
    expect(incident["title"]).toBe(title);
    expect(incident["incidentSeverityId"]).toBe(values["incidentSeverityId"]);
    expect(incident["projectId"]).toBeUndefined();
    expect(incident["description"]).toContain(
      "https://github.com/acme/payments/issues/42#issuecomment-1",
    );
  });

  test.each(["github-comment-incident", "github-labeled-issue-incident"])(
    "%s replies to the original GitHub thread with the created incident's link",
    (id: string) => {
      const reply: JSONObject = resolve(argsOf(id, "github-reply-1"));
      expect(reply["repository"]).toBe("acme/payments");
      expect(Number(reply["number"])).toBe(42);
      expect(reply["body"]).toContain(
        `${values["incidentListUrl"]}/${incidentId}`,
      );
      expect(reply["body"]).not.toContain("{{");
      expect(getTemplateGraphSpec(id)?.edges).toContainEqual({
        fromComponentId: "incident-create-one-1",
        fromPort: "success",
        toComponentId: "github-reply-1",
      });
    },
  );

  test("labeled issues preserve the external description as data", () => {
    const body: string = 'Untrusted "text"\nwith $& and <b>markup</b>';
    const json: JSONObject = resolve(
      argsOf("github-labeled-issue-incident", "incident-create-one-1"),
      { body: body },
    )["json"] as JSONObject;
    expect(json["description"]).toContain(body);
    expect(json["title"]).toBe("Checkout is down");
  });

  test("incident to issue resolves selected incident fields and its link", () => {
    const args: JSONObject = resolve(
      argsOf("incident-created-github-issue", "github-create-issue-1"),
    );
    expect(args["title"]).toBe("[INC-42] Checkout is down");
    expect(args["body"]).toContain("Requests are failing.");
    expect(args["body"]).toContain(
      `${values["incidentListUrl"]}/${incidentId}`,
    );
    expect(JSON.stringify(args)).not.toContain("{{");
  });

  test.each(templateIds)(
    "%s has visible error paths for writes",
    (id: string) => {
      const graph: NonNullable<ReturnType<typeof getTemplateGraphSpec>> =
        getTemplateGraphSpec(id)!;
      for (const node of graph.nodes) {
        if (
          node.metadataId !== "incident-create-one" &&
          node.metadataId !== "github-add-comment" &&
          node.metadataId !== "github-create-issue"
        ) {
          continue;
        }
        const edge: { toComponentId: string } | undefined = graph.edges.find(
          (candidate: {
            fromComponentId: string;
            fromPort: string;
          }): boolean => {
            return (
              candidate.fromComponentId === node.componentId &&
              candidate.fromPort === "error"
            );
          },
        );
        expect(edge).toBeDefined();
        expect(
          graph.nodes.find((candidate: { componentId: string }): boolean => {
            return candidate.componentId === edge?.toComponentId;
          })?.metadataId,
        ).toBe(ComponentID.Log);
      }
    },
  );

  test("starter graphs never insert external data into executable code", () => {
    for (const id of templateIds) {
      for (const node of getTemplateGraphSpec(id)!.nodes) {
        expect(node.metadataId).not.toBe(ComponentID.JavaScriptCode);
        expect(node.metadataId).not.toBe(ComponentID.AIGenerateText);
        const json: JSONValue = node.args?.["json"];
        if (json) {
          expect(typeof json).toBe("object");
        }
      }
    }
  });
});
