/*
 * The create-from-template payload builder.
 *
 * These assertions exist because every failure mode in this path is silent.
 * An unresolved {{local.variables.…}} reference is not an error at run time —
 * VMAPI leaves the literal text in place and the run reports success — so a
 * workflow assembled slightly wrong looks perfectly healthy while posting
 * braces to Slack. And a WorkflowVariable created without an explicit
 * isSecret is a 400 from the API, because the column is required and its
 * declared defaultValue is not an isDefaultValueColumn.
 */

import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import {
  WorkflowTemplate,
  WorkflowTemplateVariable,
  getWorkflowTemplate,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import {
  applyTemplateVariableValuesToGraph,
  buildWorkflowFromTemplate,
  buildWorkflowVariables,
  referenceForVariable,
  templateVariableNamesAreValid,
  templateVariablesToFill,
  validateTemplateVariableValues,
} from "../../FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplateCreateUtil";

const projectId: ObjectID = ObjectID.generate();
const workflowId: ObjectID = ObjectID.generate();

let counter: number = 0;

type GenerateIdFunction = () => string;

const generateId: GenerateIdFunction = (): string => {
  counter++;
  return `generated-${counter}`;
};

/** A template with a required secret and nothing else. */
const slackTemplate: WorkflowTemplate = getWorkflowTemplate(
  "incident-created-slack",
) as WorkflowTemplate;

/** A template carrying optional variables, which is the interesting case. */
const emailTemplate: WorkflowTemplate = getWorkflowTemplate(
  "scheduled-email-digest",
) as WorkflowTemplate;

type NodeArgumentsFunction = (
  graph: JSONObject,
  componentId: string,
) => JSONObject;

const argumentsOfComponent: NodeArgumentsFunction = (
  graph: JSONObject,
  componentId: string,
): JSONObject => {
  const node: JSONObject = (graph["nodes"] as Array<JSONObject>).find(
    (candidate: JSONObject) => {
      return (candidate["data"] as JSONObject)["id"] === componentId;
    },
  ) as JSONObject;

  return (node["data"] as JSONObject)["arguments"] as JSONObject;
};

describe("referenceForVariable", () => {
  test("produces the exact form the runtime resolves", () => {
    expect(referenceForVariable("slackWebhookUrl")).toBe(
      "{{local.variables.slackWebhookUrl}}",
    );
  });

  /*
   * Whitespace inside the braces is the classic silent failure: VMAPI hands
   * the untrimmed capture to deepFind, so it resolves to nothing.
   */
  test("puts no whitespace inside the braces", () => {
    expect(referenceForVariable("apiUrl")).not.toMatch(/{{\s|\s}}/);
  });
});

describe("templateVariableNamesAreValid", () => {
  test("every shipped template passes", () => {
    for (const template of getWorkflowTemplates()) {
      expect({
        template: template.id,
        valid: templateVariableNamesAreValid(template),
      }).toEqual({ template: template.id, valid: true });
    }
  });

  test("a name with a dot is rejected, because paths split on dots", () => {
    expect(
      templateVariableNamesAreValid({
        ...slackTemplate,
        variables: [
          {
            name: "slack.url",
            title: "Slack",
            description: "d",
            placeholder: "p",
            required: true,
            isSecret: true,
          },
        ],
      }),
    ).toBe(false);
  });

  test("a name with a space is rejected", () => {
    expect(
      templateVariableNamesAreValid({
        ...slackTemplate,
        variables: [
          {
            name: "slack url",
            title: "Slack",
            description: "d",
            placeholder: "p",
            required: true,
            isSecret: true,
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("templateVariablesToFill", () => {
  test("a blank workflow needs no configuration step", () => {
    expect(templateVariablesToFill(null)).toEqual([]);
  });

  test("a zero-config template needs no configuration step", () => {
    expect(
      templateVariablesToFill(
        getWorkflowTemplate("manual-log") as WorkflowTemplate,
      ),
    ).toEqual([]);
  });

  test("a template with variables reports them", () => {
    expect(templateVariablesToFill(slackTemplate).length).toBeGreaterThan(0);
  });
});

describe("validateTemplateVariableValues", () => {
  test("accepts a filled required variable", () => {
    expect(
      validateTemplateVariableValues(slackTemplate, {
        slackWebhookUrl: "https://hooks.slack.com/services/T/B/X",
      }),
    ).toEqual({});
  });

  test("rejects a missing required variable", () => {
    const errors: JSONObject = validateTemplateVariableValues(
      slackTemplate,
      {},
    ) as unknown as JSONObject;

    expect(Object.keys(errors)).toEqual(["slackWebhookUrl"]);
  });

  test("whitespace is not a value", () => {
    expect(
      Object.keys(
        validateTemplateVariableValues(slackTemplate, {
          slackWebhookUrl: "   ",
        }),
      ),
    ).toEqual(["slackWebhookUrl"]);
  });

  test("optional variables may be left blank", () => {
    const errors: Record<string, string> = validateTemplateVariableValues(
      emailTemplate,
      {
        smtpHost: "smtp.example.com",
        smtpPort: "587",
        emailFrom: "a@example.com",
        emailTo: "b@example.com",
      },
    );

    expect(errors).toEqual({});
  });

  test("names every required field that is missing, not just the first", () => {
    const errors: Record<string, string> = validateTemplateVariableValues(
      emailTemplate,
      {},
    );

    expect(Object.keys(errors).sort()).toEqual(
      emailTemplate.variables
        .filter((variable: WorkflowTemplateVariable) => {
          return variable.required;
        })
        .map((variable: WorkflowTemplateVariable) => {
          return variable.name;
        })
        .sort(),
    );
  });
});

describe("buildWorkflowFromTemplate", () => {
  test("a blank workflow gets an empty graph, not a missing one", () => {
    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "My workflow",
      description: "Something",
      projectId: projectId,
      template: null,
      generateId: generateId,
    });

    expect(workflow.graph).toEqual({ nodes: [], edges: [] });
  });

  /*
   * saveTriggerFromGraph writes triggerId: null for a graph with no trigger
   * nodes, which is what makes a blank workflow safe to create through the
   * ordinary path.
   */
  test("a blank workflow carries no trigger", () => {
    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "My workflow",
      description: "",
      projectId: projectId,
      template: null,
      generateId: generateId,
    });

    expect((workflow.graph as JSONObject)["nodes"]).toEqual([]);
  });

  test("it is created switched off, whatever the template", () => {
    for (const template of getWorkflowTemplates()) {
      const workflow: Workflow = buildWorkflowFromTemplate({
        name: "n",
        description: "d",
        projectId: projectId,
        template: template,
        values: {},
        generateId: generateId,
      });

      expect({ template: template.id, isEnabled: workflow.isEnabled }).toEqual({
        template: template.id,
        isEnabled: false,
      });
    }
  });

  test("name and description are trimmed", () => {
    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "  Padded  ",
      description: "  Also padded  ",
      projectId: projectId,
      template: null,
      generateId: generateId,
    });

    expect(workflow.name).toBe("Padded");
    expect(workflow.description).toBe("Also padded");
  });

  test("the project is stamped on it", () => {
    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "n",
      description: "d",
      projectId: projectId,
      template: null,
      generateId: generateId,
    });

    expect(workflow.projectId).toBe(projectId);
  });

  test("a template's graph is built with its nodes and edges", () => {
    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "n",
      description: "d",
      projectId: projectId,
      template: slackTemplate,
      values: { slackWebhookUrl: "https://hooks.slack.com/x" },
      generateId: generateId,
    });

    const graph: JSONObject = workflow.graph as JSONObject;

    expect((graph["nodes"] as Array<JSONObject>).length).toBeGreaterThan(0);
    expect((graph["edges"] as Array<JSONObject>).length).toBeGreaterThan(0);
  });

  /*
   * The value goes into a WorkflowVariable row, NOT into the graph. The graph
   * keeps the reference, which is what lets the value be changed later without
   * editing the workflow.
   */
  test("a filled variable leaves the reference in the graph", () => {
    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "n",
      description: "d",
      projectId: projectId,
      template: slackTemplate,
      values: { slackWebhookUrl: "https://hooks.slack.com/secret" },
      generateId: generateId,
    });

    const args: JSONObject = argumentsOfComponent(
      workflow.graph as JSONObject,
      "slack-1",
    );

    expect(args["webhook-url"]).toBe("{{local.variables.slackWebhookUrl}}");
  });

  test("the typed value is never written into the graph", () => {
    const secret: string = "https://hooks.slack.com/super-secret";

    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "n",
      description: "d",
      projectId: projectId,
      template: slackTemplate,
      values: { slackWebhookUrl: secret },
      generateId: generateId,
    });

    expect(JSON.stringify(workflow.graph)).not.toContain(secret);
  });

  /*
   * A blank optional variable gets no row, so leaving its reference behind
   * would ship "{{local.variables.smtpUsername}}" as the SMTP username.
   */
  test("a blank optional variable has its argument dropped", () => {
    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "n",
      description: "d",
      projectId: projectId,
      template: emailTemplate,
      values: {
        smtpHost: "smtp.example.com",
        smtpPort: "587",
        emailFrom: "a@example.com",
        emailTo: "b@example.com",
      },
      generateId: generateId,
    });

    const args: JSONObject = argumentsOfComponent(
      workflow.graph as JSONObject,
      "send-email-1",
    );

    expect(args["smtp-username"]).toBeUndefined();
    expect(args["smtp-password"]).toBeUndefined();
    expect(args["smtp-host"]).toBe("{{local.variables.smtpHost}}");
  });

  test("a filled optional variable keeps its argument", () => {
    const workflow: Workflow = buildWorkflowFromTemplate({
      name: "n",
      description: "d",
      projectId: projectId,
      template: emailTemplate,
      values: {
        smtpHost: "smtp.example.com",
        smtpPort: "587",
        smtpUsername: "someone",
        smtpPassword: "hunter2",
        emailFrom: "a@example.com",
        emailTo: "b@example.com",
      },
      generateId: generateId,
    });

    const args: JSONObject = argumentsOfComponent(
      workflow.graph as JSONObject,
      "send-email-1",
    );

    expect(args["smtp-username"]).toBe("{{local.variables.smtpUsername}}");
    expect(args["smtp-password"]).toBe("{{local.variables.smtpPassword}}");
  });

  test("building twice does not disturb the shipped template", () => {
    const first: Workflow = buildWorkflowFromTemplate({
      name: "n",
      description: "d",
      projectId: projectId,
      template: emailTemplate,
      values: { smtpHost: "h", smtpPort: "1", emailFrom: "a", emailTo: "b" },
      generateId: generateId,
    });

    expect(
      argumentsOfComponent(first.graph as JSONObject, "send-email-1")[
        "smtp-username"
      ],
    ).toBeUndefined();

    const second: Workflow = buildWorkflowFromTemplate({
      name: "n",
      description: "d",
      projectId: projectId,
      template: emailTemplate,
      values: {
        smtpHost: "h",
        smtpPort: "1",
        smtpUsername: "u",
        smtpPassword: "p",
        emailFrom: "a",
        emailTo: "b",
      },
      generateId: generateId,
    });

    expect(
      argumentsOfComponent(second.graph as JSONObject, "send-email-1")[
        "smtp-username"
      ],
    ).toBe("{{local.variables.smtpUsername}}");
  });

  test("every shipped template builds without throwing", () => {
    for (const template of getWorkflowTemplates()) {
      expect(() => {
        return buildWorkflowFromTemplate({
          name: template.workflowName,
          description: template.workflowDescription,
          projectId: projectId,
          template: template,
          values: {},
          generateId: generateId,
        });
      }).not.toThrow();
    }
  });
});

describe("applyTemplateVariableValuesToGraph", () => {
  test("an all-filled template's graph is returned untouched", () => {
    const graph: JSONObject = {
      nodes: [
        {
          data: {
            id: "slack-1",
            arguments: { "webhook-url": "{{local.variables.slackWebhookUrl}}" },
          },
        },
      ],
      edges: [],
    };

    const result: JSONObject = applyTemplateVariableValuesToGraph({
      graph: graph,
      template: slackTemplate,
      values: { slackWebhookUrl: "https://hooks.slack.com/x" },
    });

    expect(argumentsOfComponent(result, "slack-1")["webhook-url"]).toBe(
      "{{local.variables.slackWebhookUrl}}",
    );
  });

  test("an argument that merely mentions an unfilled variable is left alone", () => {
    const graph: JSONObject = {
      nodes: [
        {
          data: {
            id: "log-1",
            arguments: {
              value: "Sending to {{local.variables.smtpUsername}} now",
            },
          },
        },
      ],
      edges: [],
    };

    const result: JSONObject = applyTemplateVariableValuesToGraph({
      graph: graph,
      template: emailTemplate,
      values: {},
    });

    expect(argumentsOfComponent(result, "log-1")["value"]).toBe(
      "Sending to {{local.variables.smtpUsername}} now",
    );
  });

  test("a graph with no nodes key does not throw", () => {
    expect(() => {
      return applyTemplateVariableValuesToGraph({
        graph: {},
        template: emailTemplate,
        values: {},
      });
    }).not.toThrow();
  });
});

describe("buildWorkflowVariables", () => {
  test("one row per filled variable", () => {
    const rows: Array<WorkflowVariable> = buildWorkflowVariables({
      template: slackTemplate,
      values: { slackWebhookUrl: "https://hooks.slack.com/x" },
      workflowId: workflowId,
      projectId: projectId,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("slackWebhookUrl");
    expect(rows[0]?.content).toBe("https://hooks.slack.com/x");
  });

  test("the row is scoped to the workflow, which is what makes it local.", () => {
    const rows: Array<WorkflowVariable> = buildWorkflowVariables({
      template: slackTemplate,
      values: { slackWebhookUrl: "https://hooks.slack.com/x" },
      workflowId: workflowId,
      projectId: projectId,
    });

    expect(rows[0]?.workflowId).toBe(workflowId);
    expect(rows[0]?.projectId).toBe(projectId);
  });

  /*
   * isSecret is required by the API and has no usable default, so it must be
   * present and boolean on every row. Sending undefined is a 400.
   */
  test("isSecret is always sent, as a real boolean", () => {
    const rows: Array<WorkflowVariable> = buildWorkflowVariables({
      template: emailTemplate,
      values: {
        smtpHost: "smtp.example.com",
        smtpPort: "587",
        smtpPassword: "hunter2",
        emailFrom: "a@example.com",
        emailTo: "b@example.com",
      },
      workflowId: workflowId,
      projectId: projectId,
    });

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const isSecret: unknown = (row as unknown as { isSecret?: unknown })
        .isSecret;

      expect(typeof isSecret).toBe("boolean");
    }
  });

  test("the secret variable is marked secret and the others are not", () => {
    const rows: Array<WorkflowVariable> = buildWorkflowVariables({
      template: emailTemplate,
      values: {
        smtpHost: "smtp.example.com",
        smtpPort: "587",
        smtpPassword: "hunter2",
        emailFrom: "a@example.com",
        emailTo: "b@example.com",
      },
      workflowId: workflowId,
      projectId: projectId,
    });

    const byName: Record<string, boolean> = {};

    for (const row of rows) {
      byName[row.name as string] = (
        row as unknown as { isSecret?: boolean }
      ).isSecret as boolean;
    }

    expect(byName["smtpPassword"]).toBe(true);
    expect(byName["smtpHost"]).toBe(false);
  });

  test("blank optional variables get no row at all", () => {
    const rows: Array<WorkflowVariable> = buildWorkflowVariables({
      template: emailTemplate,
      values: {
        smtpHost: "smtp.example.com",
        smtpPort: "587",
        emailFrom: "a@example.com",
        emailTo: "b@example.com",
      },
      workflowId: workflowId,
      projectId: projectId,
    });

    const names: Array<string> = rows.map((row: WorkflowVariable) => {
      return row.name as string;
    });

    expect(names).not.toContain("smtpUsername");
    expect(names).not.toContain("smtpPassword");
    expect(names).toContain("smtpHost");
  });

  test("values are trimmed, because a stray space breaks a URL", () => {
    const rows: Array<WorkflowVariable> = buildWorkflowVariables({
      template: slackTemplate,
      values: { slackWebhookUrl: "  https://hooks.slack.com/x  " },
      workflowId: workflowId,
      projectId: projectId,
    });

    expect(rows[0]?.content).toBe("https://hooks.slack.com/x");
  });

  /*
   * The name written to the row and the name inside the reference come from
   * the same string. Runtime lookup is case-sensitive while the uniqueness
   * check is not, so a drift here fails silently rather than loudly.
   */
  test("the row name matches the reference the graph carries", () => {
    for (const template of getWorkflowTemplates()) {
      if (template.variables.length === 0) {
        continue;
      }

      const values: Record<string, string> = {};

      for (const variable of template.variables) {
        values[variable.name] = "value";
      }

      const workflow: Workflow = buildWorkflowFromTemplate({
        name: "n",
        description: "d",
        projectId: projectId,
        template: template,
        values: values,
        generateId: generateId,
      });

      const rows: Array<WorkflowVariable> = buildWorkflowVariables({
        template: template,
        values: values,
        workflowId: workflowId,
        projectId: projectId,
      });

      const serialized: string = JSON.stringify(workflow.graph);

      for (const row of rows) {
        expect({
          template: template.id,
          reference: referenceForVariable(row.name as string),
          present: serialized.includes(
            referenceForVariable(row.name as string),
          ),
        }).toEqual({
          template: template.id,
          reference: referenceForVariable(row.name as string),
          present: true,
        });
      }
    }
  });

  test("a zero-variable template produces no rows", () => {
    expect(
      buildWorkflowVariables({
        template: getWorkflowTemplate("manual-log") as WorkflowTemplate,
        values: {},
        workflowId: workflowId,
        projectId: projectId,
      }),
    ).toEqual([]);
  });
});
