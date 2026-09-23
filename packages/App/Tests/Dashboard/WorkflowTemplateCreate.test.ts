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
import ColumnLength from "Common/Types/Database/ColumnLength";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import {
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
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

type FilledValuesFunction = (
  template: WorkflowTemplate,
  known?: Record<string, string>,
) => Record<string, string>;

/**
 * A value for every variable a template declares, required or not, taken from
 * `known` where it has one. Filling everything is the case where the wizard
 * writes the most rows.
 */
const filledValuesFor: FilledValuesFunction = (
  template: WorkflowTemplate,
  known?: Record<string, string>,
): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const variable of template.variables) {
    values[variable.name] =
      known?.[variable.name] || `value-for-${variable.name}`;
  }

  return values;
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
      byName[row.name as string] = (row as unknown as { isSecret?: boolean })
        .isSecret as boolean;
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

  /*
   * WorkflowVariableService looks for an existing name case-insensitively, so
   * a template asking for both jiraUrl and JiraUrl would pass every check in
   * the wizard and then fail on the second row — after the workflow itself
   * was written, which is exactly the half-created state the rollback exists
   * for. Runtime lookup IS case-sensitive, so the two would not even be
   * interchangeable if the create went through.
   */
  test("no template writes two rows whose names differ only in case", () => {
    for (const template of getWorkflowTemplates()) {
      const rows: Array<WorkflowVariable> = buildWorkflowVariables({
        template: template,
        values: filledValuesFor(template),
        workflowId: workflowId,
        projectId: projectId,
      });

      const lowerCaseNames: Array<string> = rows.map(
        (row: WorkflowVariable) => {
          return (row.name as string).toLowerCase();
        },
      );

      expect({
        template: template.id,
        rows: rows.length,
        distinctNames: new Set<string>(lowerCaseNames).size,
      }).toEqual({
        template: template.id,
        rows: template.variables.length,
        distinctNames: template.variables.length,
      });
    }
  });

  /*
   * name is a ShortText column and description a LongText one. A template
   * whose help text outgrew the column would be rejected by the API on the
   * variable row, again only after the workflow already exists.
   */
  test("every row fits the columns it is written to", () => {
    for (const template of getWorkflowTemplates()) {
      const rows: Array<WorkflowVariable> = buildWorkflowVariables({
        template: template,
        values: filledValuesFor(template),
        workflowId: workflowId,
        projectId: projectId,
      });

      for (const row of rows) {
        expect({
          template: template.id,
          variable: row.name,
          nameFits: (row.name as string).length <= ColumnLength.ShortText,
          descriptionFits:
            (row.description || "").length <= ColumnLength.LongText,
        }).toEqual({
          template: template.id,
          variable: row.name,
          nameFits: true,
          descriptionFits: true,
        });
      }
    }
  });
});

/* ------------------------------- Jira ------------------------------- */

/*
 * The Jira templates are the first whose secret sits inside an OBJECT-valued
 * argument: the API token is referenced from request-headers, and
 * applyTemplateVariableValuesToGraph only ever inspects string arguments.
 * That is fine precisely because every Jira setting is required, so there is
 * never an unfilled reference to strip. Break either half and the result is a
 * 401 from Jira that reads like a wrong token, with the run still reporting
 * success.
 *
 * Every Jira template comes in an incident and an alert version, built from
 * one set of builders, so most of what follows is checked once for each kind.
 * A template is named here by the part it plays, which is also how an alert
 * template is paired with its incident counterpart.
 */

type JiraTemplateRole =
  | "createIssue"
  | "transition"
  | "privateNoteToComment"
  | "publicNoteToComment"
  | "updateComment"
  | "createFromIssue"
  | "statusToState"
  | "commentToNote"
  | "issueChangesToNote";

/** The order each kind's templates are declared in, OneUptime -> Jira first. */
const JIRA_TEMPLATE_ROLES: Array<JiraTemplateRole> = [
  "createIssue",
  "transition",
  "privateNoteToComment",
  "publicNoteToComment",
  "updateComment",
  "createFromIssue",
  "statusToState",
  "commentToNote",
  "issueChangesToNote",
];

/** Every other template that calls Jira only needs to know where and as whom. */
const JIRA_SITE_AND_TOKEN_ROLES: Array<JiraTemplateRole> = [
  "transition",
  "privateNoteToComment",
  "publicNoteToComment",
  "updateComment",
  "createFromIssue",
  "commentToNote",
];

/*
 * A webhook in and OneUptime's own database out: neither calls Jira, so
 * neither has anything to ask for.
 */
const JIRA_WEBHOOK_ONLY_ROLES: Array<JiraTemplateRole> = [
  "statusToState",
  "issueChangesToNote",
];

interface JiraKind {
  /** The record, as the template ids and every line of their text name it. */
  noun: string;
  /** The other kind's record, which nothing of this kind should mention. */
  otherNoun: string;
  /** Each template's id by the part it plays, or null where the kind has none. */
  templateIds: Record<JiraTemplateRole, string | null>;
}

const INCIDENT_JIRA_KIND: JiraKind = {
  noun: "incident",
  otherNoun: "alert",
  templateIds: {
    createIssue: "jira-create-issue-for-incident",
    transition: "jira-transition-issue-on-incident-state",
    privateNoteToComment: "jira-comment-from-incident-private-note",
    publicNoteToComment: "jira-comment-from-incident-public-note",
    updateComment: "jira-comment-on-incident-update",
    createFromIssue: "jira-declare-incident-from-issue",
    statusToState: "jira-status-to-incident-state",
    commentToNote: "jira-comment-to-incident-private-note",
    issueChangesToNote: "jira-issue-changes-to-incident-private-note",
  },
};

/* Alerts have no public notes, so there is nothing for that template to copy. */
const ALERT_JIRA_KIND: JiraKind = {
  noun: "alert",
  otherNoun: "incident",
  templateIds: {
    createIssue: "jira-create-issue-for-alert",
    transition: "jira-transition-issue-on-alert-state",
    privateNoteToComment: "jira-comment-from-alert-private-note",
    publicNoteToComment: null,
    updateComment: "jira-comment-on-alert-update",
    createFromIssue: "jira-create-alert-from-issue",
    statusToState: "jira-status-to-alert-state",
    commentToNote: "jira-comment-to-alert-private-note",
    issueChangesToNote: "jira-issue-changes-to-alert-private-note",
  },
};

const JIRA_KINDS: Array<JiraKind> = [INCIDENT_JIRA_KIND, ALERT_JIRA_KIND];

type TemplateIdsOfFunction = (
  kind: JiraKind,
  roles?: Array<JiraTemplateRole>,
) => Array<string>;

/** The kind's templates in those roles, in that order, skipping any it lacks. */
const templateIdsOf: TemplateIdsOfFunction = (
  kind: JiraKind,
  roles: Array<JiraTemplateRole> = JIRA_TEMPLATE_ROLES,
): Array<string> => {
  const ids: Array<string> = [];

  for (const role of roles) {
    const templateId: string | null = kind.templateIds[role];

    if (templateId) {
      ids.push(templateId);
    }
  }

  return ids;
};

/** Every Jira template, in the order the picker shows them: incidents, then alerts. */
const JIRA_TEMPLATE_IDS: Array<string> = [
  ...templateIdsOf(INCIDENT_JIRA_KIND),
  ...templateIdsOf(ALERT_JIRA_KIND),
];

const JIRA_WEBHOOK_ONLY_TEMPLATE_IDS: Array<string> = [
  ...templateIdsOf(INCIDENT_JIRA_KIND, JIRA_WEBHOOK_ONLY_ROLES),
  ...templateIdsOf(ALERT_JIRA_KIND, JIRA_WEBHOOK_ONLY_ROLES),
];

const JIRA_TOKEN_VARIABLE: string = "jiraBasicAuthToken";

/** The one setting whose help text names the record: it is what the issue links back to. */
const ONEUPTIME_URL_VARIABLE: string = "oneuptimeUrl";

const JIRA_AUTHORIZATION_HEADERS: JSONObject = {
  Authorization: "Basic {{local.variables.jiraBasicAuthToken}}",
};

/** The create-issue template's settings, in the order the wizard asks. */
const JIRA_CREATE_ISSUE_VARIABLE_NAMES: Array<string> = [
  "jiraBaseUrl",
  "jiraBasicAuthToken",
  "jiraProjectKey",
  "jiraIssueType",
  ONEUPTIME_URL_VARIABLE,
];

/** What someone setting the Jira templates up would type. */
const JIRA_VALUES: Record<string, string> = {
  jiraBaseUrl: "https://acme.atlassian.net",
  jiraBasicAuthToken: "cHJpeWFAYWNtZS5jb206QVRBVFQzeEZmR0YwUzNjcjN0",
  jiraProjectKey: "OPS",
  jiraIssueType: "Task",
  oneuptimeUrl: "https://oneuptime.com",
};

type TemplateByIdFunction = (templateId: string) => WorkflowTemplate;

const templateById: TemplateByIdFunction = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!template) {
    throw new Error(`Workflow template "${templateId}" was not found.`);
  }

  return template;
};

type JiraTemplatesFunction = () => Array<WorkflowTemplate>;

const jiraTemplates: JiraTemplatesFunction = (): Array<WorkflowTemplate> => {
  return getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Jira);
};

type TemplateIdsFunction = (
  templates: Array<WorkflowTemplate>,
) => Array<string>;

const idsOf: TemplateIdsFunction = (
  templates: Array<WorkflowTemplate>,
): Array<string> => {
  return templates.map((template: WorkflowTemplate) => {
    return template.id;
  });
};

type VariableNamesFunction = (template: WorkflowTemplate) => Array<string>;

const variableNamesOf: VariableNamesFunction = (
  template: WorkflowTemplate,
): Array<string> => {
  return template.variables.map((variable: WorkflowTemplateVariable) => {
    return variable.name;
  });
};

type BuildJiraWorkflowFunction = (template: WorkflowTemplate) => Workflow;

/** A Jira workflow as the wizard creates it once every setting is filled. */
const buildJiraWorkflow: BuildJiraWorkflowFunction = (
  template: WorkflowTemplate,
): Workflow => {
  return buildWorkflowFromTemplate({
    name: template.workflowName,
    description: template.workflowDescription,
    projectId: projectId,
    template: template,
    values: filledValuesFor(template, JIRA_VALUES),
    generateId: generateId,
  });
};

interface BuiltNode {
  componentId: string;
  args: JSONObject;
}

type BuiltNodesFunction = (workflow: Workflow) => Array<BuiltNode>;

const builtNodesOf: BuiltNodesFunction = (
  workflow: Workflow,
): Array<BuiltNode> => {
  return ((workflow.graph as JSONObject)["nodes"] as Array<JSONObject>).map(
    (node: JSONObject): BuiltNode => {
      const data: JSONObject = node["data"] as JSONObject;

      return {
        componentId: data["id"] as string,
        args: data["arguments"] as JSONObject,
      };
    },
  );
};

interface TemplateSpecNode {
  componentId: string;
  args?: JSONObject | undefined;
}

type SpecNodesFunction = (templateId: string) => Array<TemplateSpecNode>;

/** The nodes exactly as the template defines them, before anything is built. */
const specNodesOf: SpecNodesFunction = (
  templateId: string,
): Array<TemplateSpecNode> => {
  const spec: { nodes: Array<TemplateSpecNode> } | null = getTemplateGraphSpec(
    templateId,
  ) as unknown as { nodes: Array<TemplateSpecNode> } | null;

  if (!spec) {
    throw new Error(`Workflow template "${templateId}" has no graph.`);
  }

  return spec.nodes;
};

type ReferencedVariablesFunction = (workflow: Workflow) => Array<string>;

/** Every variable a built graph refers to, anywhere in it, sorted. */
const referencedVariablesOf: ReferencedVariablesFunction = (
  workflow: Workflow,
): Array<string> => {
  const pattern: RegExp = /\{\{local\.variables\.([^{}]+)\}\}/g;
  const serialized: string = JSON.stringify(workflow.graph);
  const names: Array<string> = [];

  let match: RegExpExecArray | null = pattern.exec(serialized);

  while (match) {
    const name: string = match[1] as string;

    if (!names.includes(name)) {
      names.push(name);
    }

    match = pattern.exec(serialized);
  }

  return names.sort();
};

type IsSecretFunction = (row: WorkflowVariable) => unknown;

/** isSecret is declared `string` on a boolean column, hence the cast. */
const isSecretOf: IsSecretFunction = (row: WorkflowVariable): unknown => {
  return (row as unknown as { isSecret?: unknown }).isSecret;
};

type BuildJiraRowsFunction = (
  template: WorkflowTemplate,
  values?: Record<string, string>,
) => Array<WorkflowVariable>;

const buildJiraRows: BuildJiraRowsFunction = (
  template: WorkflowTemplate,
  values?: Record<string, string>,
): Array<WorkflowVariable> => {
  return buildWorkflowVariables({
    template: template,
    values: values || filledValuesFor(template, JIRA_VALUES),
    workflowId: workflowId,
    projectId: projectId,
  });
};

interface RowSummary {
  name: string | undefined;
  content: string | undefined;
  isSecret: unknown;
  description: string | undefined;
}

type SummarizeRowsFunction = (
  rows: Array<WorkflowVariable>,
) => Array<RowSummary>;

/** What the wizard writes for each row, in the order it writes them. */
const summarizeRows: SummarizeRowsFunction = (
  rows: Array<WorkflowVariable>,
): Array<RowSummary> => {
  return rows.map((row: WorkflowVariable): RowSummary => {
    return {
      name: row.name,
      content: row.content,
      isSecret: isSecretOf(row),
      description: row.description,
    };
  });
};

type RowIdentitiesFunction = (
  rows: Array<WorkflowVariable>,
) => Array<JSONObject>;

/** What each row is and holds, leaving out the help text that explains it. */
const rowIdentitiesOf: RowIdentitiesFunction = (
  rows: Array<WorkflowVariable>,
): Array<JSONObject> => {
  return summarizeRows(rows).map((summary: RowSummary): JSONObject => {
    return {
      name: summary.name,
      content: summary.content,
      isSecret: summary.isSecret as boolean,
    };
  });
};

type TemplateTextFunction = (template: WorkflowTemplate) => Array<string>;

/*
 * What a template says about itself, on its card and in the workflow it
 * creates. Settings' help text is left out: the issue-type setting shared by
 * both kinds rightly offers Jira's own "Incident" issue type as an example.
 */
const textOf: TemplateTextFunction = (
  template: WorkflowTemplate,
): Array<string> => {
  return [
    template.name,
    template.description,
    template.teaches,
    template.workflowName,
    template.workflowDescription,
  ];
};

describe("Jira templates", () => {
  test("the Jira category holds the seventeen Jira templates, the incident ones first", () => {
    expect(idsOf(jiraTemplates())).toEqual(JIRA_TEMPLATE_IDS);
    expect(JIRA_TEMPLATE_IDS).toHaveLength(17);
  });

  /*
   * Workflow names are unique within a project, compared without regard to
   * case. The alert versions exist so a team can run them beside the incident
   * ones, and a suggested name shared by the two would make whichever was
   * created second fail on its name.
   */
  test("every template suggests a workflow name no other template does", () => {
    const seen: Record<string, string> = {};

    for (const template of getWorkflowTemplates()) {
      const key: string = template.workflowName.trim().toLowerCase();

      expect({
        template: template.id,
        sameNameAs: seen[key],
      }).toEqual({ template: template.id, sameNameAs: undefined });

      seen[key] = template.id;
    }
  });

  /*
   * The precondition for everything below. With no optional settings there is
   * never an unfilled reference, so the wizard never has anything to strip
   * from a Jira graph.
   */
  test("every setting a Jira template asks for is required", () => {
    for (const template of jiraTemplates()) {
      for (const variable of template.variables) {
        expect({
          template: template.id,
          variable: variable.name,
          required: variable.required,
        }).toEqual({
          template: template.id,
          variable: variable.name,
          required: true,
        });
      }
    }
  });

  /*
   * isSecret decides two things: the field is masked in the wizard, and the
   * stored value is scrubbed from run logs. The token is a reusable Jira
   * credential, so it is secret wherever it is asked for. The site URL and
   * project key are not, and masking them would only hide typos.
   */
  test("the API token is secret in every Jira template, and nothing else is", () => {
    for (const template of jiraTemplates()) {
      for (const variable of template.variables) {
        expect({
          template: template.id,
          variable: variable.name,
          isSecret: variable.isSecret,
        }).toEqual({
          template: template.id,
          variable: variable.name,
          isSecret: variable.name === JIRA_TOKEN_VARIABLE,
        });
      }
    }
  });

  /*
   * Both directions fail quietly. A setting the graph never refers to asks
   * someone for a credential that is then stored for nothing; a reference
   * with no setting behind it has no row to resolve to, so it is sent to Jira
   * as literal braces.
   */
  test("each Jira template asks for exactly the settings its graph refers to", () => {
    for (const template of jiraTemplates()) {
      expect({
        template: template.id,
        referenced: referencedVariablesOf(buildJiraWorkflow(template)),
      }).toEqual({
        template: template.id,
        referenced: variableNamesOf(template).sort(),
      });
    }
  });

  describe("buildWorkflowFromTemplate", () => {
    test("every step that calls Jira sends that same Authorization header", () => {
      for (const template of jiraTemplates()) {
        const calls: Array<BuiltNode> = builtNodesOf(
          buildJiraWorkflow(template),
        ).filter((node: BuiltNode) => {
          return (
            node.args["url"] !== undefined ||
            node.args["request-headers"] !== undefined
          );
        });

        expect({
          template: template.id,
          callsJira: calls.length > 0,
        }).toEqual({
          template: template.id,
          callsJira: !JIRA_WEBHOOK_ONLY_TEMPLATE_IDS.includes(template.id),
        });

        for (const call of calls) {
          expect({
            template: template.id,
            component: call.componentId,
            headers: call.args["request-headers"],
          }).toEqual({
            template: template.id,
            component: call.componentId,
            headers: JIRA_AUTHORIZATION_HEADERS,
          });
        }
      }
    });

    /*
     * request-headers is marked sensitive, so the whole argument is kept out
     * of the run log. Anywhere else — a URL, a body, a log line, a script's
     * arguments — the resolved token would be sent or recorded without that
     * protection.
     */
    test("the token is referenced nowhere but the Authorization header", () => {
      for (const template of jiraTemplates()) {
        for (const node of builtNodesOf(buildJiraWorkflow(template))) {
          for (const argumentId of Object.keys(node.args)) {
            if (argumentId === "request-headers") {
              continue;
            }

            expect({
              template: template.id,
              component: node.componentId,
              argument: argumentId,
              mentionsToken: JSON.stringify(node.args[argumentId]).includes(
                JIRA_TOKEN_VARIABLE,
              ),
            }).toEqual({
              template: template.id,
              component: node.componentId,
              argument: argumentId,
              mentionsToken: false,
            });
          }
        }
      }
    });

    /*
     * The stripping pass only fires for a blank optional setting, and Jira has
     * none, so every argument — the object-valued ones included, which that
     * pass never looks inside — reaches the saved graph unchanged.
     */
    test("nothing is stripped: every argument arrives as the template wrote it", () => {
      for (const template of jiraTemplates()) {
        const built: Array<BuiltNode> = builtNodesOf(
          buildJiraWorkflow(template),
        );
        const spec: Array<TemplateSpecNode> = specNodesOf(template.id);

        expect({
          template: template.id,
          components: built.map((node: BuiltNode) => {
            return node.componentId;
          }),
        }).toEqual({
          template: template.id,
          components: spec.map((node: TemplateSpecNode) => {
            return node.componentId;
          }),
        });

        for (const specNode of spec) {
          const builtNode: BuiltNode | undefined = built.find(
            (node: BuiltNode) => {
              return node.componentId === specNode.componentId;
            },
          );

          expect({
            template: template.id,
            component: specNode.componentId,
            args: builtNode?.args,
          }).toEqual({
            template: template.id,
            component: specNode.componentId,
            args: specNode.args || {},
          });
        }
      }
    });

    test("what was typed never reaches the graph", () => {
      for (const template of jiraTemplates()) {
        const serialized: string = JSON.stringify(
          buildJiraWorkflow(template).graph,
        );

        expect({
          template: template.id,
          token: serialized.includes(
            JIRA_VALUES[JIRA_TOKEN_VARIABLE] as string,
          ),
          site: serialized.includes(JIRA_VALUES["jiraBaseUrl"] as string),
        }).toEqual({ template: template.id, token: false, site: false });
      }
    });

    /*
     * Filled-in settings are no reason to switch it on. The create-issue
     * template would file an issue for the very next incident or alert, and a
     * webhook template has not been registered in Jira yet at this point.
     */
    test("a Jira workflow is created switched off, even with every setting filled", () => {
      for (const template of jiraTemplates()) {
        expect({
          template: template.id,
          isEnabled: buildJiraWorkflow(template).isEnabled,
        }).toEqual({ template: template.id, isEnabled: false });
      }
    });
  });

  describe("buildWorkflowVariables", () => {
    /*
     * The help text says where each value comes from, and it goes on the row
     * so it is still there when someone opens the variable a year later. It
     * has to fit the LongText column or the API refuses the row.
     */
    test("each row carries the template's own help text, short enough for its column", () => {
      for (const template of jiraTemplates()) {
        for (const row of buildJiraRows(template)) {
          const variable: WorkflowTemplateVariable | undefined =
            template.variables.find((candidate: WorkflowTemplateVariable) => {
              return candidate.name === row.name;
            });

          expect({
            template: template.id,
            variable: row.name,
            description: row.description,
            fits: (row.description || "").length <= ColumnLength.LongText,
          }).toEqual({
            template: template.id,
            variable: row.name,
            description: variable?.description,
            fits: true,
          });
        }
      }
    });
  });

  describe.each(JIRA_KINDS)("the $noun templates", (kind: JiraKind) => {
    const createIssueTemplateId: string = kind.templateIds
      .createIssue as string;

    /*
     * Search matches on this text, so an alert template that mentioned
     * incidents would turn up when someone looked for the incident ones, and
     * its card would describe the wrong record.
     */
    /*
     * The one deliberate exception: the template that creates a record from
     * a new Jira issue warns about running it beside the other kind's, since
     * two webhooks that match the same issue would make it both. That sentence
     * is pinned exactly and taken out before the check.
     */
    const overlapWarning: string = ` If you also create ${kind.otherNoun}s from Jira, give the two webhooks JQL filters that never match the same issue, or each issue becomes both.`;

    test(`the create-from-Jira template warns about the ${kind.otherNoun} version`, () => {
      expect(
        templateById(kind.templateIds.createFromIssue as string)
          .workflowDescription,
      ).toContain(overlapWarning);
    });

    test(`every one names the ${kind.noun} and never the ${kind.otherNoun}`, () => {
      for (const templateId of templateIdsOf(kind)) {
        const text: Array<string> = textOf(templateById(templateId)).map(
          (line: string) => {
            return line.split(overlapWarning).join("");
          },
        );

        expect({
          template: templateId,
          namesItsRecord: templateId.includes(kind.noun),
          mentionsTheOtherRecord: [templateId, ...text].some((line: string) => {
            return line.toLowerCase().includes(kind.otherNoun);
          }),
        }).toEqual({
          template: templateId,
          namesItsRecord: true,
          mentionsTheOtherRecord: false,
        });
      }
    });

    describe("validateTemplateVariableValues", () => {
      test("the create-issue template demands all five of its settings", () => {
        const template: WorkflowTemplate = templateById(createIssueTemplateId);

        expect(variableNamesOf(template)).toEqual(
          JIRA_CREATE_ISSUE_VARIABLE_NAMES,
        );

        const expected: Record<string, string> = {};

        for (const variable of template.variables) {
          expected[variable.name] = `${variable.title} is required.`;
        }

        expect(validateTemplateVariableValues(template, {})).toEqual(expected);
        expect(Object.keys(expected)).toHaveLength(5);
      });

      test("the create-issue template is satisfied once all five are filled", () => {
        const template: WorkflowTemplate = templateById(createIssueTemplateId);

        expect(
          validateTemplateVariableValues(
            template,
            filledValuesFor(template, JIRA_VALUES),
          ),
        ).toEqual({});
      });

      /* There is no partial Jira setup: each setting on its own blocks the create. */
      test("leaving out any one setting blocks the create-issue template", () => {
        const template: WorkflowTemplate = templateById(createIssueTemplateId);

        for (const name of JIRA_CREATE_ISSUE_VARIABLE_NAMES) {
          const values: Record<string, string> = filledValuesFor(
            template,
            JIRA_VALUES,
          );

          delete values[name];

          expect({
            missing: name,
            errors: Object.keys(
              validateTemplateVariableValues(template, values),
            ),
          }).toEqual({ missing: name, errors: [name] });
        }
      });

      /*
       * The token comes out of a pipe into base64, which ends its output with
       * a line break. Pasting only that is not a token.
       */
      test("a token that is only a line break counts as missing", () => {
        const template: WorkflowTemplate = templateById(createIssueTemplateId);

        expect(
          Object.keys(
            validateTemplateVariableValues(template, {
              ...filledValuesFor(template, JIRA_VALUES),
              jiraBasicAuthToken: " \n",
            }),
          ),
        ).toEqual([JIRA_TOKEN_VARIABLE]);
      });

      test("the webhook-only templates demand nothing", () => {
        const templateIds: Array<string> = templateIdsOf(
          kind,
          JIRA_WEBHOOK_ONLY_ROLES,
        );

        expect(templateIds).toHaveLength(2);

        for (const templateId of templateIds) {
          const template: WorkflowTemplate = templateById(templateId);

          expect({
            template: templateId,
            toFill: templateVariablesToFill(template),
            errors: validateTemplateVariableValues(template, {}),
          }).toEqual({ template: templateId, toFill: [], errors: {} });
        }
      });
    });

    describe("buildWorkflowFromTemplate", () => {
      /*
       * request-headers is an object, not a string. The runtime substitutes
       * inside it with JSON escaping and hands the object back, so the
       * reference has to reach the saved graph exactly as the template wrote
       * it.
       */
      test("the token reference survives inside the object-valued request-headers", () => {
        const workflow: Workflow = buildJiraWorkflow(
          templateById(createIssueTemplateId),
        );

        expect(
          argumentsOfComponent(workflow.graph as JSONObject, "create-issue-1")[
            "request-headers"
          ],
        ).toEqual(JIRA_AUTHORIZATION_HEADERS);
      });

      /*
       * The builder edits the graph after it is created. An object-valued
       * argument is exactly what a shallow copy would share with the shipped
       * template, so an edit to one workflow's headers would turn up in every
       * workflow made from it afterwards.
       */
      test("editing one Jira workflow's headers does not reach the next one", () => {
        const template: WorkflowTemplate = templateById(createIssueTemplateId);

        const headers: JSONObject = argumentsOfComponent(
          buildJiraWorkflow(template).graph as JSONObject,
          "create-issue-1",
        )["request-headers"] as JSONObject;

        headers["Authorization"] = "Basic edited-in-the-builder";
        headers["X-Atlassian-Token"] = "no-check";

        expect(
          argumentsOfComponent(
            buildJiraWorkflow(template).graph as JSONObject,
            "create-issue-1",
          )["request-headers"],
        ).toEqual(JIRA_AUTHORIZATION_HEADERS);
      });
    });

    describe("buildWorkflowVariables", () => {
      test("the create-issue template writes one row per setting, in the order the wizard asks", () => {
        const rows: Array<WorkflowVariable> = buildJiraRows(
          templateById(createIssueTemplateId),
        );

        expect(
          rows.map((row: WorkflowVariable) => {
            return row.name;
          }),
        ).toEqual(JIRA_CREATE_ISSUE_VARIABLE_NAMES);

        for (const row of rows) {
          expect(row.workflowId).toBe(workflowId);
          expect(row.projectId).toBe(projectId);
        }
      });

      test("only the API token row is secret", () => {
        const rows: Array<WorkflowVariable> = buildJiraRows(
          templateById(createIssueTemplateId),
        );

        const byName: Record<string, unknown> = {};

        for (const row of rows) {
          byName[row.name as string] = isSecretOf(row);
        }

        expect(byName).toEqual({
          jiraBaseUrl: false,
          jiraBasicAuthToken: true,
          jiraProjectKey: false,
          jiraIssueType: false,
          oneuptimeUrl: false,
        });
      });

      /*
       * base64 ends its output with a line break, and a stray space in the
       * site URL lands in the middle of every request URL built from it.
       * Either one surviving into the row breaks every call the workflow
       * makes.
       */
      test("what was typed is trimmed, including the line break base64 leaves", () => {
        const rows: Array<WorkflowVariable> = buildJiraRows(
          templateById(createIssueTemplateId),
          {
            jiraBaseUrl: "  https://acme.atlassian.net  ",
            jiraBasicAuthToken: `${JIRA_VALUES[JIRA_TOKEN_VARIABLE]}\n`,
            jiraProjectKey: " OPS",
            jiraIssueType: "Task ",
            oneuptimeUrl: "\thttps://oneuptime.com\r\n",
          },
        );

        const contentByName: Record<string, string | undefined> = {};

        for (const row of rows) {
          contentByName[row.name as string] = row.content;
        }

        expect(contentByName).toEqual(JIRA_VALUES);
      });

      /*
       * The link back from the issue is the only setting that is about the
       * record, so its help text is the only one that says which record it
       * is. Someone configuring the alert version should not be told the
       * issue links back to an incident.
       */
      test(`the OneUptime URL row says the issue links back to the ${kind.noun}`, () => {
        const row: WorkflowVariable | undefined = buildJiraRows(
          templateById(createIssueTemplateId),
        ).find((candidate: WorkflowVariable) => {
          return candidate.name === ONEUPTIME_URL_VARIABLE;
        });

        expect(row?.description).toContain(
          `link the Jira issue back to the ${kind.noun}`,
        );
        expect(row?.description).not.toContain(kind.otherNoun);
      });

      test("the other Jira-calling templates write the site URL and the secret token", () => {
        const templateIds: Array<string> = templateIdsOf(
          kind,
          JIRA_SITE_AND_TOKEN_ROLES,
        );

        expect(templateIds.length).toBeGreaterThan(0);

        for (const templateId of templateIds) {
          const rows: Array<WorkflowVariable> = buildJiraRows(
            templateById(templateId),
          );

          expect({
            template: templateId,
            rows: rows.map((row: WorkflowVariable) => {
              return {
                name: row.name,
                content: row.content,
                isSecret: isSecretOf(row),
              };
            }),
          }).toEqual({
            template: templateId,
            rows: [
              {
                name: "jiraBaseUrl",
                content: JIRA_VALUES["jiraBaseUrl"],
                isSecret: false,
              },
              {
                name: JIRA_TOKEN_VARIABLE,
                content: JIRA_VALUES[JIRA_TOKEN_VARIABLE],
                isSecret: true,
              },
            ],
          });
        }
      });

      test("the webhook-only templates write no rows", () => {
        for (const templateId of templateIdsOf(kind, JIRA_WEBHOOK_ONLY_ROLES)) {
          expect({
            template: templateId,
            rows: buildJiraRows(templateById(templateId)),
          }).toEqual({ template: templateId, rows: [] });
        }
      });
    });
  });

  describe("the alert templates beside the incident ones", () => {
    /*
     * An alert has no public notes: there is nothing on an alert for that
     * template to copy, so the alert set is one shorter.
     */
    test("only incidents have a public-note template", () => {
      expect(
        templateIdsOf(INCIDENT_JIRA_KIND, ["publicNoteToComment"]),
      ).toEqual(["jira-comment-from-incident-public-note"]);
      expect(templateIdsOf(ALERT_JIRA_KIND)).toHaveLength(8);
      expect(
        idsOf(jiraTemplates()).filter((templateId: string) => {
          return templateId.includes("public-note");
        }),
      ).toEqual(["jira-comment-from-incident-public-note"]);
      expect(getWorkflowTemplate("jira-comment-from-alert-public-note")).toBe(
        null,
      );
    });

    /*
     * Someone taking both sets types the same Jira site and token twice, and
     * each workflow gets its own rows. They must come out identical — same
     * names, same secret flags — or the alert set would store its token in
     * the clear, or under a name its graph does not refer to.
     */
    test("each alert template writes the same rows as its incident counterpart", () => {
      for (const role of JIRA_TEMPLATE_ROLES) {
        const incidentTemplateId: string | null =
          INCIDENT_JIRA_KIND.templateIds[role];
        const alertTemplateId: string | null =
          ALERT_JIRA_KIND.templateIds[role];

        if (!incidentTemplateId || !alertTemplateId) {
          continue;
        }

        expect({
          role: role,
          rows: rowIdentitiesOf(buildJiraRows(templateById(alertTemplateId))),
        }).toEqual({
          role: role,
          rows: rowIdentitiesOf(
            buildJiraRows(templateById(incidentTemplateId)),
          ),
        });
      }
    });

    /*
     * The help text differs in exactly one place: the OneUptime URL names the
     * record the issue links back to. Every other setting is the same shared
     * definition, word for word.
     */
    test("the create-issue rows differ from the incident's only in which record the link goes back to", () => {
      const incidentRows: Array<RowSummary> = summarizeRows(
        buildJiraRows(
          templateById(INCIDENT_JIRA_KIND.templateIds.createIssue as string),
        ),
      );
      const alertRows: Array<RowSummary> = summarizeRows(
        buildJiraRows(
          templateById(ALERT_JIRA_KIND.templateIds.createIssue as string),
        ),
      );

      expect(alertRows).toEqual(
        incidentRows.map((row: RowSummary): RowSummary => {
          if (row.name !== ONEUPTIME_URL_VARIABLE) {
            return row;
          }

          return {
            ...row,
            description: (row.description || "").replace(
              "back to the incident",
              "back to the alert",
            ),
          };
        }),
      );
      expect(alertRows).not.toEqual(incidentRows);
    });
  });
});
