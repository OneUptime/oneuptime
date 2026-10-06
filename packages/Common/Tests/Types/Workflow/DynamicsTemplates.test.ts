/*
 * The Dynamics 365 templates' contracts: what each one asks for, how every
 * step calls the Dataverse Web API, and what each graph hands its scripts.
 *
 * Templates.test.ts already holds every template to the component registry
 * and the builder's own checks. What it cannot know is what Dataverse
 * needs: a bearer token from the OAuth 2.0 variable and nothing else in the
 * Authorization header, the OData headers, a $filter with no raw spaces, an
 * If-Match on every update so it can never become an upsert, the link
 * column selected wherever a script reads it. A template that got one of
 * these wrong would still lint clean and still run — and answer 400, or
 * worse, quietly create a second case — so they are pinned here.
 *
 * Every template comes in an incident and an alert version, built from one
 * set of builders, so the per-kind checks run for both.
 */

import { describe, expect, test } from "@jest/globals";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { ComponentType } from "../../../Types/Workflow/Component";
import {
  DYNAMICS_ACCESS_TOKEN_VARIABLE_NAME,
  DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER,
  DYNAMICS_WEB_API_ROOT,
  JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateOAuth2Variable,
  WorkflowTemplateVariable,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";

/* ------------------------------- The graph ------------------------------- */

interface NodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  args?: JSONObject | undefined;
}

interface EdgeSpec {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

interface GraphSpec {
  nodes: Array<NodeSpec>;
  edges: Array<EdgeSpec>;
}

type SpecOfFunction = (templateId: string) => GraphSpec;

const specOf: SpecOfFunction = (templateId: string): GraphSpec => {
  const spec: GraphSpec | null = getTemplateGraphSpec(
    templateId,
  ) as unknown as GraphSpec | null;

  if (!spec) {
    throw new Error(`There is no template ${templateId}.`);
  }

  return spec;
};

type NodeOfFunction = (templateId: string, componentId: string) => NodeSpec;

const nodeOf: NodeOfFunction = (
  templateId: string,
  componentId: string,
): NodeSpec => {
  const node: NodeSpec | undefined = specOf(templateId).nodes.find(
    (candidate: NodeSpec) => {
      return candidate.componentId === componentId;
    },
  );

  if (!node) {
    throw new Error(`${templateId} has no step ${componentId}.`);
  }

  return node;
};

type ArgOfFunction = (
  templateId: string,
  componentId: string,
  argumentId: string,
) => JSONValue;

const argOf: ArgOfFunction = (
  templateId: string,
  componentId: string,
  argumentId: string,
): JSONValue => {
  return (nodeOf(templateId, componentId).args || {})[argumentId] as JSONValue;
};

type JsonArgOfFunction = (
  templateId: string,
  componentId: string,
  argumentId: string,
) => JSONObject;

/* Arguments the builder stores as JSON text, parsed. */
const jsonArgOf: JsonArgOfFunction = (
  templateId: string,
  componentId: string,
  argumentId: string,
): JSONObject => {
  const value: JSONValue = argOf(templateId, componentId, argumentId);

  if (typeof value !== "string") {
    throw new Error(
      `${templateId} ${componentId}.${argumentId} is not JSON text.`,
    );
  }

  return JSON.parse(value) as JSONObject;
};

const API_COMPONENTS: Array<string> = [
  ComponentID.ApiGet,
  ComponentID.ApiPost,
  ComponentID.ApiPatch,
  ComponentID.ApiPut,
  ComponentID.ApiDelete,
];

type ApiStepsOfFunction = (templateId: string) => Array<NodeSpec>;

const apiStepsOf: ApiStepsOfFunction = (
  templateId: string,
): Array<NodeSpec> => {
  return specOf(templateId).nodes.filter((node: NodeSpec) => {
    return API_COMPONENTS.includes(node.metadataId);
  });
};

type ScriptsOfFunction = (templateId: string) => Array<NodeSpec>;

const scriptsOf: ScriptsOfFunction = (templateId: string): Array<NodeSpec> => {
  return specOf(templateId).nodes.filter((node: NodeSpec) => {
    return node.metadataId === ComponentID.JavaScriptCode;
  });
};

/** Every string an argument holds, including strings nested inside JSON objects. */
type CollectStringsFunction = (value: JSONValue | undefined) => Array<string>;

const collectStrings: CollectStringsFunction = (
  value: JSONValue | undefined,
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry: JSONValue) => {
      return collectStrings(entry);
    });
  }

  if (value && typeof value === "object") {
    return [
      ...Object.keys(value as JSONObject),
      ...Object.values(value as JSONObject).flatMap((entry: JSONValue) => {
        return collectStrings(entry);
      }),
    ];
  }

  return [];
};

/* ------------------------------ The two kinds ------------------------------ */

interface DynamicsKind {
  noun: string;
  otherNoun: string;
  plural: string;
  part: string;
  linkPrefix: string;
  numberField: string;
  idColumn: string;
  stateIdColumn: string;
  stateRelation: string;
  severityRelation: string;
  severityIdColumn: string;
  timelineStateColumn: string;
  create: string;
  /** In the order the picker lists them. */
  templateIds: Array<string>;
  createCase: string;
  updateCase: string;
  privateNote: string;
  publicNote: string | undefined;
  createRecord: string;
  statusToState: string;
  caseNoteToNote: string;
  /** Written beside the essentials when a record is created from a case. */
  quietCreateFields: JSONObject;
}

const INCIDENT: DynamicsKind = {
  noun: "incident",
  otherNoun: "alert",
  plural: "incidents",
  part: "Incidents",
  linkPrefix: "oneuptime-incident-",
  numberField: "incidentNumberWithPrefix",
  idColumn: "incidentId",
  stateIdColumn: "currentIncidentStateId",
  stateRelation: "currentIncidentState",
  severityRelation: "incidentSeverity",
  severityIdColumn: "incidentSeverityId",
  timelineStateColumn: "incidentStateId",
  create: "declare",
  templateIds: [
    "dynamics-create-case-for-incident",
    "dynamics-update-case-on-incident-state",
    "dynamics-note-from-incident-private-note",
    "dynamics-note-from-incident-public-note",
    "dynamics-declare-incident-from-case",
    "dynamics-case-status-to-incident-state",
    "dynamics-case-note-to-incident-private-note",
  ],
  createCase: "dynamics-create-case-for-incident",
  updateCase: "dynamics-update-case-on-incident-state",
  privateNote: "dynamics-note-from-incident-private-note",
  publicNote: "dynamics-note-from-incident-public-note",
  createRecord: "dynamics-declare-incident-from-case",
  statusToState: "dynamics-case-status-to-incident-state",
  caseNoteToNote: "dynamics-case-note-to-incident-private-note",
  quietCreateFields: {
    isVisibleOnStatusPage: false,
    shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
  },
};

const ALERT: DynamicsKind = {
  noun: "alert",
  otherNoun: "incident",
  plural: "alerts",
  part: "Alerts",
  linkPrefix: "oneuptime-alert-",
  numberField: "alertNumberWithPrefix",
  idColumn: "alertId",
  stateIdColumn: "currentAlertStateId",
  stateRelation: "currentAlertState",
  severityRelation: "alertSeverity",
  severityIdColumn: "alertSeverityId",
  timelineStateColumn: "alertStateId",
  create: "create",
  templateIds: [
    "dynamics-create-case-for-alert",
    "dynamics-update-case-on-alert-state",
    "dynamics-note-from-alert-private-note",
    "dynamics-create-alert-from-case",
    "dynamics-case-status-to-alert-state",
    "dynamics-case-note-to-alert-private-note",
  ],
  createCase: "dynamics-create-case-for-alert",
  updateCase: "dynamics-update-case-on-alert-state",
  privateNote: "dynamics-note-from-alert-private-note",
  publicNote: undefined,
  createRecord: "dynamics-create-alert-from-case",
  statusToState: "dynamics-case-status-to-alert-state",
  caseNoteToNote: "dynamics-case-note-to-alert-private-note",
  quietCreateFields: {},
};

const KINDS: Array<[string, DynamicsKind]> = [
  ["incident", INCIDENT],
  ["alert", ALERT],
];

const ALL_IDS: Array<string> = [...INCIDENT.templateIds, ...ALERT.templateIds];

const WEB_API: string = "{{local.variables.dynamicsUrl}}/api/data/v9.2";

const AUTHORIZATION: string = `Bearer {{local.variables.${DYNAMICS_ACCESS_TOKEN_VARIABLE_NAME}}}`;

const FORMATTED_VALUES: string =
  'odata.include-annotations="OData.Community.Display.V1.FormattedValue"';

type TemplateOfFunction = (templateId: string) => WorkflowTemplate;

const templateOf: TemplateOfFunction = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!template) {
    throw new Error(`There is no template ${templateId}.`);
  }

  return template;
};

/* ------------------------------- The category ------------------------------- */

describe("the Dynamics 365 category", () => {
  const dynamics: Array<WorkflowTemplate> = getWorkflowTemplatesByCategory(
    WorkflowTemplateCategory.Dynamics365,
  );

  test("holds seven incident templates, then six alert ones, in the order the guide lists them", () => {
    expect(
      dynamics.map((template: WorkflowTemplate): string => {
        return template.id;
      }),
    ).toEqual(ALL_IDS);
  });

  test("a template is in the Dynamics 365 category exactly when its id says dynamics-", () => {
    for (const template of getWorkflowTemplates()) {
      expect({
        id: template.id,
        inCategory: template.category === WorkflowTemplateCategory.Dynamics365,
      }).toEqual({
        id: template.id,
        inCategory: template.id.startsWith("dynamics-"),
      });
    }
  });

  test("each is filed under the record it works on", () => {
    for (const [, kind] of KINDS) {
      for (const templateId of kind.templateIds) {
        expect(templateOf(templateId).subcategory).toBe(kind.part);
      }
    }
  });

  test("says what it is for, under the product's own name", () => {
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Dynamics365),
    ).toEqual({
      category: WorkflowTemplateCategory.Dynamics365,
      label: "Dynamics 365",
      description:
        "Keep Dynamics 365 cases in step with your incidents and alerts, both ways.",
      icon: expect.any(String),
    });
  });

  test("its markers are the Jira templates' outbound one, and an inbound one of its own", () => {
    expect(DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER).toBe(
      JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
    );
    expect(ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER).toBe(
      "Synced from Dynamics 365",
    );
    /*
     * Not the Jira one: a note copied in from Jira is ordinary text to the
     * Dynamics 365 templates, and is posted to the case.
     */
    expect(ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER).not.toBe(
      ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
    );
  });

  test("every template calls the same Web API", () => {
    expect(DYNAMICS_WEB_API_ROOT).toBe(WEB_API);
  });
});

/* ------------------------------ What they ask for ------------------------------ */

describe("what the Dynamics 365 templates ask for", () => {
  const SIGN_IN: Array<string> = [
    "dynamicsUrl",
    "dynamicsTenantId",
    "dynamicsClientId",
    "dynamicsClientSecret",
    "dynamicsLinkColumn",
  ];

  test.each(ALL_IDS)(
    "%s asks for the environment, how to sign in, and the link column, in that order",
    (templateId: string) => {
      const names: Array<string> = templateOf(templateId).variables.map(
        (variable: WorkflowTemplateVariable): string => {
          return variable.name;
        },
      );

      expect(names.slice(0, SIGN_IN.length)).toEqual(SIGN_IN);
    },
  );

  test("only the templates that open cases ask for a customer and the OneUptime URL", () => {
    for (const templateId of ALL_IDS) {
      const names: Array<string> = templateOf(templateId).variables.map(
        (variable: WorkflowTemplateVariable): string => {
          return variable.name;
        },
      );
      const opensCases: boolean =
        templateId === INCIDENT.createCase || templateId === ALERT.createCase;

      expect({ templateId: templateId, names: names }).toEqual({
        templateId: templateId,
        names: opensCases
          ? [...SIGN_IN, "dynamicsCustomer", "oneuptimeUrl"]
          : SIGN_IN,
      });
    }
  });

  test("every setting is required, and only the client secret is secret", () => {
    for (const templateId of ALL_IDS) {
      for (const variable of templateOf(templateId).variables) {
        expect({ name: variable.name, required: variable.required }).toEqual({
          name: variable.name,
          required: true,
        });
        expect({ name: variable.name, isSecret: variable.isSecret }).toEqual({
          name: variable.name,
          isSecret: variable.name === "dynamicsClientSecret",
        });
      }
    }
  });

  test("the tenant, client ID and secret only ever become the OAuth 2.0 variable's settings", () => {
    for (const templateId of ALL_IDS) {
      for (const variable of templateOf(templateId).variables) {
        expect({
          name: variable.name,
          isOAuth2SettingOnly: Boolean(variable.isOAuth2SettingOnly),
        }).toEqual({
          name: variable.name,
          isOAuth2SettingOnly: [
            "dynamicsTenantId",
            "dynamicsClientId",
            "dynamicsClientSecret",
          ].includes(variable.name),
        });
      }
    }
  });

  test("every template signs in through the same OAuth 2.0 variable, set up for Microsoft Entra ID", () => {
    for (const templateId of ALL_IDS) {
      const oauth2Variables: Array<WorkflowTemplateOAuth2Variable> =
        templateOf(templateId).oauth2Variables || [];

      expect(oauth2Variables).toEqual([
        {
          name: "dynamicsAccessToken",
          description: expect.stringContaining("Microsoft Entra ID"),
          grantType: OAuth2GrantType.ClientCredentials,
          clientAuthenticationMethod:
            OAuth2ClientAuthenticationMethod.RequestBody,
          tokenUrl:
            "https://login.microsoftonline.com/{dynamicsTenantId}/oauth2/v2.0/token",
          clientId: "{dynamicsClientId}",
          clientSecret: "{dynamicsClientSecret}",
          scope: "{dynamicsUrl}/.default",
        },
      ]);
    }
  });

  type FormatOfFunction = (name: string) => WorkflowTemplateVariable;

  const fieldOf: FormatOfFunction = (
    name: string,
  ): WorkflowTemplateVariable => {
    const field: WorkflowTemplateVariable | undefined = templateOf(
      INCIDENT.createCase,
    ).variables.find((variable: WorkflowTemplateVariable) => {
      return variable.name === name;
    });

    if (!field || !field.format) {
      throw new Error(`${name} has no format.`);
    }

    return field;
  };

  type AcceptsFunction = (name: string, value: string) => boolean;

  const accepts: AcceptsFunction = (name: string, value: string): boolean => {
    return Boolean(fieldOf(name).format?.pattern.test(value));
  };

  test("the environment URL is the address alone, as the token's scope needs it", () => {
    for (const good of [
      "https://acme.crm.dynamics.com",
      "https://acme.crm4.dynamics.com",
      "https://contoso-dev.crm.microsoftdynamics.us",
    ]) {
      expect({ good: good, accepted: accepts("dynamicsUrl", good) }).toEqual({
        good: good,
        accepted: true,
      });
    }

    for (const bad of [
      "https://acme.crm.dynamics.com/",
      "https://acme.crm.dynamics.com/api/data/v9.2",
      "https://acme.crm.dynamics.com/api/data/v9.2/",
      "http://acme.crm.dynamics.com",
      "acme.crm.dynamics.com",
      "https://acme",
      "https://acme.crm.dynamics.com/main.aspx?appid=1",
    ]) {
      expect({ bad: bad, accepted: accepts("dynamicsUrl", bad) }).toEqual({
        bad: bad,
        accepted: false,
      });
    }
  });

  test("the tenant is a GUID or a domain", () => {
    expect(
      accepts("dynamicsTenantId", "72f988bf-86f1-41af-91ab-2d7cd011db47"),
    ).toBe(true);
    expect(accepts("dynamicsTenantId", "contoso.onmicrosoft.com")).toBe(true);
    expect(accepts("dynamicsTenantId", "contoso")).toBe(false);
    expect(accepts("dynamicsTenantId", "72f988bf 86f1")).toBe(false);
    expect(
      accepts(
        "dynamicsTenantId",
        "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47",
      ),
    ).toBe(false);
  });

  test("the client ID is a GUID", () => {
    expect(
      accepts("dynamicsClientId", "9F2C1D44-7A3B-4C5D-8E6F-0A1B2C3D4E5F"),
    ).toBe(true);
    expect(accepts("dynamicsClientId", "OneUptime Integration")).toBe(false);
  });

  test("the client secret is refused when it is the secret's ID, which is a GUID", () => {
    expect(
      accepts("dynamicsClientSecret", "9f2c1d44-7a3b-4c5d-8e6f-0a1b2c3d4e5f"),
    ).toBe(false);
    expect(fieldOf("dynamicsClientSecret").format?.message).toContain(
      "Paste the secret's Value instead",
    );
    expect(
      accepts("dynamicsClientSecret", "Abc8Q~9f2c1d44-7a3b-4c5d-8e6f-0a1b2c"),
    ).toBe(true);
  });

  test("the link column is a logical name, never a display name", () => {
    for (const good of [
      "new_oneuptimelink",
      "cr4f2_oneuptimeid",
      "contoso_link_2",
    ]) {
      expect(accepts("dynamicsLinkColumn", good)).toBe(true);
    }

    for (const bad of [
      "OneUptime Link",
      "new_OneUptimeLink",
      "oneuptimelink",
      "_link",
      "new_link eq 'x'",
    ]) {
      expect({
        bad: bad,
        accepted: accepts("dynamicsLinkColumn", bad),
      }).toEqual({ bad: bad, accepted: false });
    }
  });

  test("the customer is an account's id, or a contact named as contacts(<id>)", () => {
    for (const good of [
      "4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b",
      "accounts(4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b)",
      "contacts(4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b)",
      "/contacts(4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b)",
    ]) {
      expect(accepts("dynamicsCustomer", good)).toBe(true);
    }

    for (const bad of [
      "Contoso Pharmaceuticals",
      "leads(4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b)",
      "4f7e6c3a",
    ]) {
      expect(accepts("dynamicsCustomer", bad)).toBe(false);
    }
  });
});

/* ------------------------------- Every template ------------------------------- */

describe.each(ALL_IDS)("Dynamics 365 template %s", (templateId: string) => {
  test("every call goes to the environment's Web API", () => {
    const steps: Array<NodeSpec> = apiStepsOf(templateId);

    expect(steps.length).toBeGreaterThan(0);

    for (const node of steps) {
      expect({
        step: node.componentId,
        url: String(node.args?.["url"]).startsWith(`${WEB_API}/`),
      }).toEqual({ step: node.componentId, url: true });
    }
  });

  test("every call carries the access token and the OData headers, as an object of headers", () => {
    for (const node of apiStepsOf(templateId)) {
      const headers: JSONObject = node.args?.["request-headers"] as JSONObject;

      expect(headers).toEqual(
        expect.objectContaining({
          Authorization: AUTHORIZATION,
          Accept: "application/json",
          "OData-MaxVersion": "4.0",
          "OData-Version": "4.0",
        }),
      );
    }
  });

  test("the access token is referenced nowhere but those Authorization headers", () => {
    const token: string = `{{local.variables.${DYNAMICS_ACCESS_TOKEN_VARIABLE_NAME}}}`;

    for (const node of specOf(templateId).nodes) {
      for (const [argumentId, value] of Object.entries(node.args || {})) {
        const strings: Array<string> = collectStrings(value as JSONValue);
        const mentions: number = strings.filter((text: string) => {
          return text.includes(token);
        }).length;

        if (argumentId === "request-headers") {
          expect((value as JSONObject)["Authorization"]).toBe(AUTHORIZATION);
          expect(mentions).toBe(1);
        } else {
          expect({ step: node.componentId, argumentId, mentions }).toEqual({
            step: node.componentId,
            argumentId,
            mentions: 0,
          });
        }
      }
    }
  });

  test("no step refers to the tenant, the client ID or the secret, which have no rows", () => {
    for (const node of specOf(templateId).nodes) {
      for (const text of collectStrings(node.args as JSONValue)) {
        expect(text).not.toMatch(
          /\{\{local\.variables\.(dynamicsTenantId|dynamicsClientId|dynamicsClientSecret)\}\}/,
        );
      }
    }
  });

  test("no URL holds a raw space: nothing on the way to Dataverse encodes one", () => {
    for (const node of apiStepsOf(templateId)) {
      expect(String(node.args?.["url"])).not.toMatch(/\s/);
    }
  });

  test("every read asks for the display text beside each value", () => {
    for (const node of apiStepsOf(templateId)) {
      if (node.metadataId !== ComponentID.ApiGet) {
        continue;
      }

      expect((node.args?.["request-headers"] as JSONObject)["Prefer"]).toBe(
        FORMATTED_VALUES,
      );
    }
  });

  test("every update is If-Match: *, so a case deleted meanwhile is never created again", () => {
    for (const node of apiStepsOf(templateId)) {
      if (node.metadataId !== ComponentID.ApiPatch) {
        continue;
      }

      expect((node.args?.["request-headers"] as JSONObject)["If-Match"]).toBe(
        "*",
      );
      expect(String(node.args?.["url"])).toMatch(
        /\/incidents\(\{\{local\.components\.[a-z0-9-]+\.returnValues\.returnValue\.caseId\}\}\)$/,
      );
    }
  });

  test("no call deletes anything, and none uses PUT", () => {
    for (const node of apiStepsOf(templateId)) {
      expect([ComponentID.ApiDelete, ComponentID.ApiPut]).not.toContain(
        node.metadataId,
      );
    }
  });

  test("every script parses, and holds nothing the runtime would substitute", () => {
    for (const node of scriptsOf(templateId)) {
      const code: string = String(node.args?.["code"]);

      expect(code).not.toContain("{{");
      expect(code).not.toContain("}}");
      expect(code).not.toContain("${");
      expect(code).not.toContain("`");
      expect(() => {
        // eslint-disable-next-line no-new-func
        return new Function("args", code);
      }).not.toThrow();
    }
  });

  test("every script starts with the shared helper block, then says what it does", () => {
    for (const node of scriptsOf(templateId)) {
      const code: string = String(node.args?.["code"]);

      expect(
        code.startsWith("// ---- Shared by the Dynamics 365 templates ----\n"),
      ).toBe(true);
      expect(code).toContain("\n// ---- What this step does ----\n");
    }
  });

  test("its text never names Jira", () => {
    const template: WorkflowTemplate = templateOf(templateId);

    for (const text of [
      template.name,
      template.description,
      template.teaches,
      template.workflowName,
      template.workflowDescription,
    ]) {
      expect(text.toLowerCase()).not.toContain("jira");
    }
  });
});

/* ------------------------------- One kind at a time ------------------------------- */

describe.each(KINDS)(
  "the %s templates",
  (_name: string, kind: DynamicsKind) => {
    test("every script of this kind starts with the very same helper block", () => {
      const blocks: Set<string> = new Set();

      for (const templateId of kind.templateIds) {
        for (const node of scriptsOf(templateId)) {
          const code: string = String(node.args?.["code"]);
          blocks.add(
            code.slice(0, code.indexOf("// ---- What this step does ----")),
          );
        }
      }

      expect(blocks.size).toBe(1);
    });

    test(`the helper block knows the ${kind.noun}'s link and no other kind's`, () => {
      const code: string = String(
        argOf(kind.createCase, "prepare-case-1", "code"),
      );

      expect(code).toContain(
        `const ${kind.noun.toUpperCase()}_LINK_PREFIX = "${kind.linkPrefix}";`,
      );
      expect(code).not.toContain(`${kind.otherNoun.toUpperCase()}_LINK_PREFIX`);
    });

    test(`each one names the ${kind.noun}, and only the create-from-case template the ${kind.otherNoun}`, () => {
      for (const templateId of kind.templateIds) {
        const template: WorkflowTemplate = templateOf(templateId);
        const searched: string = [
          template.name,
          template.description,
          template.teaches,
          template.workflowName,
        ]
          .join(" ")
          .toLowerCase();

        expect(searched).toContain(kind.noun);
        expect(searched).not.toContain(kind.otherNoun);

        const warning: boolean = templateId === kind.createRecord;

        expect({
          templateId: templateId,
          mentionsTheOtherKind: template.workflowDescription
            .toLowerCase()
            .includes(kind.otherNoun),
        }).toEqual({ templateId: templateId, mentionsTheOtherKind: warning });
      }
    });

    test("the templates fed by a webhook say how to connect it", () => {
      for (const templateId of [
        kind.createRecord,
        kind.statusToState,
        kind.caseNoteToNote,
      ]) {
        const description: string = templateOf(templateId).workflowDescription;

        expect(description).toContain("copy the URL from the Webhook trigger");
        expect(description).toContain(
          "Power Automate flow or a Dataverse webhook",
        );
        expect(nodeOf(templateId, "webhook-1").metadataId).toBe(
          ComponentID.Webhook,
        );
      }
    });

    describe("creating a case", () => {
      const templateId: string = kind.createCase;

      test(`starts when an ${kind.noun} is created, with everything the script reads`, () => {
        const trigger: NodeSpec = nodeOf(
          templateId,
          `${kind.noun}-on-create-1`,
        );

        expect(trigger.metadataId).toBe(`${kind.noun}-on-create`);
        expect(trigger.args?.["select"]).toEqual({
          _id: true,
          projectId: true,
          title: true,
          description: true,
          [kind.numberField]: true,
          isPrivate: true,
          customFields: true,
          rootCause: true,
          remediationNotes: true,
          [kind.severityRelation]: { _id: true, name: true },
          [kind.stateRelation]: { name: true },
        });
      });

      test("reads the project's severities to choose a priority, in order", () => {
        const step: NodeSpec = nodeOf(templateId, "find-severities-1");

        expect(step.metadataId).toBe(`${kind.noun}-severity-find-many`);
        expect(step.args?.["select"]).toEqual({
          _id: true,
          name: true,
          order: true,
        });
      });

      test("hands the script the settings it needs, and the record last", () => {
        const args: JSONObject = jsonArgOf(
          templateId,
          "prepare-case-1",
          "arguments",
        );

        expect(Object.keys(args)).toEqual([
          "oneuptimeUrl",
          "linkColumn",
          "customer",
          "severities",
          kind.noun,
        ]);
        expect(args).toEqual({
          oneuptimeUrl: "{{local.variables.oneuptimeUrl}}",
          linkColumn: "{{local.variables.dynamicsLinkColumn}}",
          customer: "{{local.variables.dynamicsCustomer}}",
          severities:
            "{{local.components.find-severities-1.returnValues.models}}",
          [kind.noun]: `{{local.components.${kind.noun}-on-create-1.returnValues.model}}`,
        });
      });

      test("POSTs the script's columns whole, and asks for the new case back", () => {
        const step: NodeSpec = nodeOf(templateId, "create-case-1");

        expect(step.metadataId).toBe(ComponentID.ApiPost);
        expect(step.args?.["url"]).toBe(
          `${WEB_API}/incidents?$select=incidentid,ticketnumber,title`,
        );
        expect(step.args?.["request-body"]).toBe(
          "{{local.components.prepare-case-1.returnValues.returnValue.caseColumns}}",
        );
        expect((step.args?.["request-headers"] as JSONObject)["Prefer"]).toBe(
          "return=representation",
        );
      });

      test("logs the new case's number, which Dataverse sends back", () => {
        expect(String(argOf(templateId, "log-created", "value"))).toContain(
          "{{local.components.create-case-1.returnValues.response-body.ticketnumber}}",
        );
      });
    });

    describe("moving the case", () => {
      const templateId: string = kind.updateCase;

      test(`wakes only when the ${kind.noun}'s state changes`, () => {
        const trigger: NodeSpec = nodeOf(
          templateId,
          `${kind.noun}-on-update-1`,
        );

        expect(trigger.metadataId).toBe(`${kind.noun}-on-update`);
        expect(trigger.args?.["listen-on"]).toEqual({
          [kind.stateIdColumn]: true,
        });
        expect(trigger.args?.["select"]).toEqual({
          _id: true,
          [kind.numberField]: true,
          isPrivate: true,
          [kind.stateRelation]: {
            name: true,
            isAcknowledgedState: true,
            isResolvedState: true,
          },
        });
      });

      test("finds the case by its link, asking for two so a copy can be refused", () => {
        expect(argOf(templateId, "find-case-1", "url")).toBe(
          `${WEB_API}/incidents?$select=incidentid,ticketnumber,title,statecode,statuscode&$filter={{local.variables.dynamicsLinkColumn}}%20eq%20'${kind.linkPrefix}{{local.components.${kind.noun}-on-update-1.returnValues.model._id}}'&$top=2`,
        );
      });

      test("closes the case with CloseIncident, which records a Case Resolution", () => {
        expect(argOf(templateId, "close-case-1", "url")).toBe(
          `${WEB_API}/CloseIncident`,
        );
        expect(argOf(templateId, "close-case-1", "request-body")).toBe(
          "{{local.components.plan-case-1.returnValues.returnValue.closeBody}}",
        );
      });

      test("moves it to another status with a PATCH of the case itself", () => {
        const step: NodeSpec = nodeOf(templateId, "set-status-1");

        expect(step.metadataId).toBe(ComponentID.ApiPatch);
        expect(step.args?.["url"]).toBe(
          `${WEB_API}/incidents({{local.components.plan-case-1.returnValues.returnValue.caseId}})`,
        );
        expect(step.args?.["request-body"]).toBe(
          "{{local.components.plan-case-1.returnValues.returnValue.statusBody}}",
        );
      });

      test("chooses between them by the action the script returns", () => {
        expect(argOf(templateId, "if-close-1", "input-1")).toBe(
          "{{local.components.plan-case-1.returnValues.returnValue.action}}",
        );
        expect(argOf(templateId, "if-close-1", "input-2")).toBe("close");
        expect(argOf(templateId, "if-status-1", "input-2")).toBe("status");

        const edges: Array<EdgeSpec> = specOf(templateId).edges;

        expect(edges).toEqual(
          expect.arrayContaining([
            {
              fromComponentId: "if-close-1",
              toComponentId: "close-case-1",
              fromPort: "yes",
            },
            {
              fromComponentId: "if-close-1",
              toComponentId: "if-status-1",
              fromPort: "no",
            },
            {
              fromComponentId: "if-status-1",
              toComponentId: "set-status-1",
              fromPort: "yes",
            },
            {
              fromComponentId: "if-status-1",
              toComponentId: "log-skipped",
              fromPort: "no",
            },
          ]),
        );
      });
    });

    describe("copying notes to the case", () => {
      const noteTemplates: Array<[string, string]> = [
        [kind.privateNote, `${kind.noun}-internal-note-on-create`],
        ...(kind.publicNote
          ? ([[kind.publicNote, `${kind.noun}-public-note-on-create`]] as Array<
              [string, string]
            >)
          : []),
      ];

      test.each(noteTemplates)(
        "%s starts from %s",
        (templateId: string, trigger: string) => {
          const node: NodeSpec = nodeOf(templateId, "note-on-create-1");

          expect(node.metadataId).toBe(trigger);
          expect(node.args?.["select"]).toEqual({
            _id: true,
            note: true,
            [kind.idColumn]: true,
            [kind.noun]: { [kind.numberField]: true, isPrivate: true },
            createdByUser: { name: true },
          });
        },
      );

      test.each(noteTemplates)(
        "%s finds the case by the note's record, and binds the new note to it",
        (templateId: string) => {
          expect(argOf(templateId, "find-case-1", "url")).toBe(
            `${WEB_API}/incidents?$select=incidentid,ticketnumber,title,statecode,statuscode&$filter={{local.variables.dynamicsLinkColumn}}%20eq%20'${kind.linkPrefix}{{local.components.note-on-create-1.returnValues.model.${kind.idColumn}.value}}'&$top=2`,
          );
          expect(argOf(templateId, "post-note-1", "url")).toBe(
            `${WEB_API}/annotations`,
          );
          expect(jsonArgOf(templateId, "post-note-1", "request-body")).toEqual({
            subject:
              "{{local.components.build-note-1.returnValues.returnValue.subject}}",
            notetext:
              "{{local.components.build-note-1.returnValues.returnValue.text}}",
            "objectid_incident@odata.bind":
              "/incidents({{local.components.build-note-1.returnValues.returnValue.caseId}})",
          });
        },
      );
    });

    describe(`${kind.create === "declare" ? "declaring" : "creating"} the ${kind.noun} from a case`, () => {
      const templateId: string = kind.createRecord;
      const prepare: string = `prepare-${kind.noun}-1`;

      test("reads the event from the request body, whole", () => {
        expect(argOf(templateId, "read-event-1", "arguments")).toBe(
          "{{local.components.webhook-1.returnValues.request-body}}",
        );
      });

      test("reads the case back from Dynamics 365, link column and all", () => {
        expect(argOf(templateId, "get-case-1", "url")).toBe(
          `${WEB_API}/incidents({{local.components.read-event-1.returnValues.returnValue.caseId}})?$select=incidentid,ticketnumber,title,description,prioritycode,statecode,_customerid_value,{{local.variables.dynamicsLinkColumn}}`,
        );
      });

      test("hands the prepare step the case last, after everything OneUptime wrote", () => {
        const args: JSONObject = jsonArgOf(templateId, prepare, "arguments");

        expect(Object.keys(args)).toEqual([
          "severities",
          "dynamicsUrl",
          "linkColumn",
          "case",
        ]);
        expect(args["case"]).toBe(
          "{{local.components.get-case-1.returnValues.response-body}}",
        );
      });

      test(`writes the ${kind.noun} with the case's id where the create-case template looks for it`, () => {
        expect(jsonArgOf(templateId, `create-${kind.noun}-1`, "json")).toEqual({
          [kind.severityIdColumn]: `{{local.components.${prepare}.returnValues.returnValue.${kind.severityIdColumn}}}`,
          customFields: {
            dynamicsCaseId: `{{local.components.${prepare}.returnValues.returnValue.caseId}}`,
            dynamicsCaseNumber: `{{local.components.${prepare}.returnValues.returnValue.caseNumber}}`,
          },
          ...kind.quietCreateFields,
          title: `{{local.components.${prepare}.returnValues.returnValue.title}}`,
          description: `{{local.components.${prepare}.returnValues.returnValue.description}}`,
        });
      });

      test("then links the case to it, under the link column's own name", () => {
        const step: NodeSpec = nodeOf(templateId, "link-case-1");

        expect(step.metadataId).toBe(ComponentID.ApiPatch);
        expect(step.args?.["url"]).toBe(
          `${WEB_API}/incidents({{local.components.${prepare}.returnValues.returnValue.caseId}})`,
        );
        expect(jsonArgOf(templateId, "link-case-1", "request-body")).toEqual({
          "{{local.variables.dynamicsLinkColumn}}": `${kind.linkPrefix}{{local.components.create-${kind.noun}-1.returnValues.model._id}}`,
        });
      });

      test("only for a new case: the event script takes Create alone", () => {
        expect(String(argOf(templateId, "read-event-1", "code"))).toContain(
          'const MESSAGES = ["Create"];',
        );
      });
    });

    describe(`moving the ${kind.noun} when its case moves`, () => {
      const templateId: string = kind.statusToState;

      test("reads the case's state, its status and who changed it, with the link column", () => {
        expect(argOf(templateId, "get-case-1", "url")).toBe(
          `${WEB_API}/incidents({{local.components.read-event-1.returnValues.returnValue.caseId}})?$select=incidentid,ticketnumber,statecode,statuscode,_modifiedby_value,{{local.variables.dynamicsLinkColumn}}`,
        );
      });

      test("takes the events a status change can arrive as", () => {
        expect(String(argOf(templateId, "read-event-1", "code"))).toContain(
          'const MESSAGES = ["Update","Close","SetState","SetStateDynamicEntity"];',
        );
      });

      test(`looks the ${kind.noun} up by the id on the case, with its state's order`, () => {
        const step: NodeSpec = nodeOf(templateId, `find-${kind.noun}-1`);

        expect(step.metadataId).toBe(`${kind.noun}-find-one`);
        expect(step.args?.["query"]).toEqual({
          _id: `{{local.components.find-link-1.returnValues.returnValue.${kind.noun}Id}}`,
        });
        expect(step.args?.["select"]).toEqual({
          _id: true,
          [kind.numberField]: true,
          [kind.stateRelation]: { _id: true, name: true, order: true },
        });
      });

      test("writes a timeline row, which is what refuses to move a record backwards", () => {
        const step: NodeSpec = nodeOf(templateId, "change-state-1");

        expect(step.metadataId).toBe(`${kind.noun}-state-timeline-create-one`);
        expect(jsonArgOf(templateId, "change-state-1", "json")).toEqual({
          [kind.idColumn]: `{{local.components.decide-state-1.returnValues.returnValue.${kind.noun}Id}}`,
          [kind.timelineStateColumn]:
            "{{local.components.decide-state-1.returnValues.returnValue.stateId}}",
          rootCause:
            "{{local.components.decide-state-1.returnValues.returnValue.rootCause}}",
        });
      });

      test("hands the decision the case's link last", () => {
        expect(
          Object.keys(jsonArgOf(templateId, "decide-state-1", "arguments")),
        ).toEqual([kind.noun, "states", "link"]);
      });
    });

    describe("copying case notes to the record", () => {
      const templateId: string = kind.caseNoteToNote;

      test("reads the note and, in the same call, the case it is on", () => {
        expect(argOf(templateId, "get-note-1", "url")).toBe(
          `${WEB_API}/annotations({{local.components.read-event-1.returnValues.returnValue.noteId}})?$select=annotationid,subject,notetext,isdocument,filename,objecttypecode,_createdby_value&$expand=objectid_incident($select=incidentid,ticketnumber,{{local.variables.dynamicsLinkColumn}})`,
        );
      });

      test("writes only to a record this project has", () => {
        expect(argOf(templateId, "if-found-1", "input-1")).toBe(
          `{{local.components.find-${kind.noun}-1.returnValues.model._id}}`,
        );
        expect(argOf(templateId, "if-found-1", "input-2")).toBe(
          `{{local.components.read-note-1.returnValues.returnValue.${kind.noun}Id}}`,
        );
      });

      test("adds a private note, never a public one", () => {
        expect(nodeOf(templateId, "create-note-1").metadataId).toBe(
          `${kind.noun}-internal-note-create-one`,
        );
        expect(jsonArgOf(templateId, "create-note-1", "json")).toEqual({
          [kind.idColumn]: `{{local.components.find-${kind.noun}-1.returnValues.model._id}}`,
          note: "{{local.components.read-note-1.returnValues.returnValue.note}}",
        });
      });
    });
  },
);

describe("the alert templates beside the incident ones", () => {
  test("only incidents have a public-note template", () => {
    expect(INCIDENT.templateIds).toHaveLength(ALERT.templateIds.length + 1);
    expect(
      ALL_IDS.filter((templateId: string) => {
        return templateId.includes("public-note");
      }),
    ).toEqual(["dynamics-note-from-incident-public-note"]);
  });

  test("each alert template is its incident twin, word for word but for the record", () => {
    const pairs: Array<[string, string]> = [
      [INCIDENT.createCase, ALERT.createCase],
      [INCIDENT.updateCase, ALERT.updateCase],
      [INCIDENT.privateNote, ALERT.privateNote],
      [INCIDENT.statusToState, ALERT.statusToState],
      [INCIDENT.caseNoteToNote, ALERT.caseNoteToNote],
    ];

    for (const [incidentId, alertId] of pairs) {
      expect(
        specOf(alertId).nodes.map((node: NodeSpec): string => {
          return node.componentId.replace("alert", "incident");
        }),
      ).toEqual(
        specOf(incidentId).nodes.map((node: NodeSpec): string => {
          return node.componentId;
        }),
      );
    }
  });

  test("an alert created from a case writes no status page settings", () => {
    const json: JSONObject = jsonArgOf(
      ALERT.createRecord,
      "create-alert-1",
      "json",
    );

    expect(Object.keys(json).sort()).toEqual(
      ["alertSeverityId", "customFields", "description", "title"].sort(),
    );
  });
});
