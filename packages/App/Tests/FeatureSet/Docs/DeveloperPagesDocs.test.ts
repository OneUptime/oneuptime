import {
  DEVELOPER_DOCS_IMPORT_LIMIT,
  DeveloperDocsGuide,
  DeveloperDocsGuideContext,
  DeveloperDocsSection,
  DeveloperDocsStep,
  getDeveloperDocsGuide,
} from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import { getDeveloperDocsResource } from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsPageType,
  DeveloperDocsScope,
  getDeveloperDocsParentPage,
} from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { SECTION_TITLES_COLLAPSED_BY_DEFAULT } from "Common/UI/Components/SideMenu/SideMenuSectionState";
import { hasMcpTools } from "Common/Utils/DeveloperDocs/AiAssistantExamples";
import { getCurlCommand } from "Common/Utils/DeveloperDocs/ApiExamples";
import {
  DeveloperDocsLiveData,
  getEmptyDeveloperDocsLiveData,
} from "Common/Utils/DeveloperDocs/LiveData";
import { ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE } from "Common/Utils/DeveloperDocs/ExampleValues";
import {
  getTerraformProviderHcl,
  getTerraformResourceConfig,
  TerraformResourceConfig,
} from "Common/Utils/DeveloperDocs/TerraformConfig";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Drift checks for what the docs say about the dashboard's Developer pages
 * (Terraform, API and AI Assistants under every resource). Each claim the
 * docs make (where the section is, that it starts collapsed, how many
 * import blocks a list page writes, which resources have MCP tools, that
 * secrets come from sensitive variables) is checked against the code that
 * makes it true, so changing one without the other fails here.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, `${relativePath}.md`), "utf8");
}

const TERRAFORM_INDEX: string = "terraform/index";
const TERRAFORM_IMPORTING: string = "terraform/importing-resources";
const API_REFERENCE: string = "api-reference/api-reference";
const MCP_SERVER: string = "ai/mcp-server";

function pageTitle(page: DeveloperDocsPageType): string {
  const definition: DeveloperDocsPageDefinition | undefined =
    DEVELOPER_DOCS_PAGES.find((candidate: DeveloperDocsPageDefinition) => {
      return candidate.type === page;
    });

  expect(definition).toBeDefined();

  return definition!.title;
}

function hasPages(
  modelType: DatabaseBaseModelType,
  scope: DeveloperDocsScope,
): boolean {
  return Boolean(getDeveloperDocsParentPage(new modelType().tableName!, scope));
}

const ONEUPTIME_URL: string = "https://oneuptime.acme.com";

describe("the docs name the Developer section and its pages as the dashboard does", () => {
  it.each([
    [TERRAFORM_INDEX, DeveloperDocsPageType.Terraform],
    [TERRAFORM_IMPORTING, DeveloperDocsPageType.Terraform],
    [API_REFERENCE, DeveloperDocsPageType.Api],
    [MCP_SERVER, DeveloperDocsPageType.AiAssistants],
  ])("%s", (page: string, developerPage: DeveloperDocsPageType) => {
    const text: string = readPage(page);

    expect(text).toContain(`**${DEVELOPER_DOCS_SECTION_TITLE}**`);
    expect(text).toContain(`**${pageTitle(developerPage)}**`);
  });

  it("the Terraform overview names all three pages", () => {
    const text: string = readPage(TERRAFORM_INDEX);

    for (const definition of DEVELOPER_DOCS_PAGES) {
      expect(text).toContain(`**${definition.title}**`);
    }
  });

  it("says the section starts collapsed, and it does", () => {
    expect(SECTION_TITLES_COLLAPSED_BY_DEFAULT).toContain(
      DEVELOPER_DOCS_SECTION_TITLE,
    );

    for (const page of [TERRAFORM_INDEX, API_REFERENCE]) {
      expect(readPage(page)).toMatch(/collapsed until you open it/);
    }
  });
});

describe("the Terraform docs", () => {
  it("name resources whose own pages have the section, and the Monitors list", () => {
    for (const modelType of [Monitor, StatusPage, Workflow, OnCallDutyPolicy]) {
      expect({
        model: new modelType().tableName,
        hasPages: hasPages(modelType, DeveloperDocsScope.View),
      }).toEqual({ model: new modelType().tableName, hasPages: true });
    }

    expect(hasPages(Monitor, DeveloperDocsScope.List)).toBe(true);
    expect(readPage(TERRAFORM_IMPORTING)).toContain(
      `**Monitors → ${DEVELOPER_DOCS_SECTION_TITLE} → ${pageTitle(DeveloperDocsPageType.Terraform)}**`,
    );
  });

  it("give the same number of import blocks a list page writes", () => {
    for (const page of [TERRAFORM_INDEX, TERRAFORM_IMPORTING]) {
      expect(readPage(page)).toContain(
        `(the first ${DEVELOPER_DOCS_IMPORT_LIMIT})`,
      );
    }
  });

  it("are right that the provider block carries the instance's URL and a matching version", () => {
    const hcl: string = getTerraformProviderHcl({
      oneuptimeUrl: ONEUPTIME_URL,
      platformVersion: "14.0.11",
    });

    expect(hcl).toContain(`oneuptime_url = "${ONEUPTIME_URL}"`);
    // The newest provider not newer than the instance, as the Versioning section advises.
    expect(hcl).toMatch(/version\s+= ">= 14\.0, <= 14\.0\.11"/);
  });

  it("are right that a monitor's Authorization header comes from a sensitive variable", () => {
    expect(readPage(TERRAFORM_INDEX)).toContain(
      "a monitor's `Authorization` header",
    );

    const config: TerraformResourceConfig | null = getTerraformResourceConfig({
      modelType: Monitor,
      json: {
        _id: "1a2b3c4d-1234-4b2c-9d8e-0123456789ab",
        name: "Checkout API",
        monitorType: "API",
        monitorSteps: {
          _type: "MonitorSteps",
          value: {
            monitorStepsInstanceArray: [
              {
                _type: "MonitorStep",
                value: {
                  monitorDestination: {
                    _type: "URL",
                    value: "https://api.acme.com/health",
                  },
                  requestHeaders: { Authorization: "Bearer NEVER-SHOWN" },
                },
              },
            ],
          },
        },
      },
    });

    expect(config).not.toBeNull();
    expect(config!.hcl).not.toContain("NEVER-SHOWN");
    expect(config!.variables).toHaveLength(1);
    expect(config!.hcl).toMatch(/sensitive\s+= true/);
    expect(config!.hcl).toContain(
      `Authorization = var.${config!.variables[0]!.name}`,
    );
  });

  it("are right that secrets the configuration does not need are left out", () => {
    const config: TerraformResourceConfig | null = getTerraformResourceConfig({
      modelType: Workflow,
      json: { _id: "6e4f0a1c-1234-4b2c-9d8e-0123456789ab", name: "Weekly" },
    });

    expect(config).not.toBeNull();
    expect(config!.omittedSecrets.length).toBeGreaterThan(0);
    expect(config!.variables).toHaveLength(0);
  });
});

/*
 * A project as the pages see it after their lookups: enough records for
 * the examples the docs describe.
 */
const CRITICAL_ID: string = "a0000001-0000-4000-8000-000000000001";
const INCIDENT_ID: string = "7a8b9c0d-1234-4b2c-9d8e-0123456789ab";

type LiveRecord = { id: string; name: string; flags: Record<string, boolean> };

function liveProject(): DeveloperDocsLiveData {
  const record: (
    id: string,
    name: string,
    flags?: Record<string, boolean>,
  ) => LiveRecord = (
    id: string,
    name: string,
    flags: Record<string, boolean> = {},
  ): LiveRecord => {
    return { id, name, flags };
  };

  return {
    ...getEmptyDeveloperDocsLiveData(new Date("2026-10-02T15:30:00.000Z")),
    records: {
      IncidentSeverity: [
        record(CRITICAL_ID, "Critical Incident"),
        record("a0000002-0000-4000-8000-000000000002", "Major Incident"),
      ],
      IncidentState: [
        record("c0000001-0000-4000-8000-000000000001", "Identified", {
          isCreatedState: true,
        }),
        record("c0000002-0000-4000-8000-000000000002", "Acknowledged", {
          isAcknowledgedState: true,
        }),
        record("c0000003-0000-4000-8000-000000000003", "Resolved", {
          isResolvedState: true,
        }),
      ],
      Monitor: [record("e0000001-0000-4000-8000-000000000001", "Checkout API")],
      Team: [record("10000001-0000-4000-8000-000000000001", "Platform")],
    },
    namesById: { [CRITICAL_ID]: "Critical Incident" },
  };
}

function guideFor(
  page: DeveloperDocsPageType,
  overrides: Partial<DeveloperDocsGuideContext>,
): DeveloperDocsGuide {
  return getDeveloperDocsGuide(page, {
    resource: getDeveloperDocsResource(Incident),
    scope: DeveloperDocsScope.List,
    oneuptimeUrl: ONEUPTIME_URL,
    platformVersion: "14.0.11",
    apiKeysUrl: "/dashboard/p/settings/api-keys",
    live: liveProject(),
    ...overrides,
  });
}

function incidentRecord(): DeveloperDocsGuideContext["record"] {
  return {
    id: INCIDENT_ID,
    displayName: "Checkout requests are failing",
    json: {
      _id: INCIDENT_ID,
      title: "Checkout requests are failing",
      incidentSeverityId: { _type: "ObjectID", value: CRITICAL_ID },
    },
  };
}

// The id format the docs used to show, which no OneUptime id has.
const HEX_24_ID: RegExp = /\b[0-9a-f]{24}\b/g;
// `id = "..."` in an import block, and the id of `terraform import <address> <id>`.
const IMPORT_BLOCK_ID: RegExp = /^\s*id\s*=\s*"([^"]+)"/gm;
const IMPORT_COMMAND_ID: RegExp = /terraform import \S+ (\S+)/g;

describe("the Terraform docs on the dashboard's pages", () => {
  it("are right that a resource's configuration names the records its ids point at", () => {
    expect(readPage(TERRAFORM_INDEX)).toContain(
      '`incident_severity_id = "..." # Critical Incident`',
    );

    const guide: DeveloperDocsGuide = guideFor(
      DeveloperDocsPageType.Terraform,
      {
        scope: DeveloperDocsScope.View,
        record: incidentRecord(),
      },
    );

    expect(guide.steps[1]?.markdown).toContain(
      `incident_severity_id = "${CRITICAL_ID}" # Critical Incident`,
    );
  });

  it("name the sections the pages have", () => {
    const text: string = readPage(TERRAFORM_INDEX);
    const view: DeveloperDocsGuide = guideFor(DeveloperDocsPageType.Terraform, {
      scope: DeveloperDocsScope.View,
      record: incidentRecord(),
    });
    const list: DeveloperDocsGuide = guideFor(
      DeveloperDocsPageType.Terraform,
      {},
    );
    const titles: (guide: DeveloperDocsGuide) => Array<string> = (
      guide: DeveloperDocsGuide,
    ): Array<string> => {
      return guide.sections.map((section: DeveloperDocsSection): string => {
        return section.title;
      });
    };

    expect(titles(view)).toEqual(["Build on it"]);
    expect(titles(list)).toEqual(["Common setups"]);
    expect(text).toContain("**Build on it**");
    expect(text).toContain("**Common setups**");
  });

  it("are right that a new incident uses one of the project's own severities", () => {
    expect(readPage(TERRAFORM_INDEX)).toContain(
      "an incident with one of your severities",
    );
    expect(
      guideFor(DeveloperDocsPageType.Terraform, {}).steps[1]?.markdown,
    ).toMatch(new RegExp(`incident_severity_id +=  ?"${CRITICAL_ID}"`));
  });

  it("no longer call ids 24-character hex strings: they are UUIDs", () => {
    expect(readPage(TERRAFORM_IMPORTING)).not.toContain("24-character");
    expect(readPage(TERRAFORM_IMPORTING)).toContain("a UUID");
  });

  it("give example ids in the form OneUptime's ids take", () => {
    const terraformDir: string = path.join(CONTENT_DIR, "terraform");

    for (const file of fs.readdirSync(terraformDir)) {
      const text: string = fs.readFileSync(
        path.join(terraformDir, file),
        "utf8",
      );

      expect({ file, ids: text.match(HEX_24_ID) || [] }).toEqual({
        file,
        ids: [],
      });
    }

    const importing: string = readPage(TERRAFORM_IMPORTING);
    const ids: Array<string> = [
      ...Array.from(
        importing.matchAll(IMPORT_BLOCK_ID),
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
      ...Array.from(
        importing.matchAll(IMPORT_COMMAND_ID),
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ];

    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      expect({ id, isUuid: ObjectID.isValidUUID(id) }).toEqual({
        id,
        isUuid: true,
      });
    }
  });
});

describe("the API reference", () => {
  it("lists the requests a resource's page and a list page show", () => {
    const view: DeveloperDocsGuide = guideFor(DeveloperDocsPageType.Api, {
      scope: DeveloperDocsScope.View,
      record: incidentRecord(),
    });
    const list: DeveloperDocsGuide = guideFor(DeveloperDocsPageType.Api, {});
    const stepTitles: (guide: DeveloperDocsGuide) => Array<string> = (
      guide: DeveloperDocsGuide,
    ): Array<string> => {
      return guide.steps.map((step: DeveloperDocsStep): string => {
        return step.title;
      });
    };

    expect(stepTitles(view)).toEqual([
      "Create an API key",
      "Read it",
      "Change it",
      "Delete it",
    ]);
    expect(stepTitles(list)).toEqual([
      "Create an API key",
      "List your incidents",
      "Find the ones you need",
      "Declare an incident",
    ]);
    expect(readPage(API_REFERENCE)).toContain(
      "read, change and delete it from the resource's own page, or list, count and create from a list page",
    );
  });

  it("is right about the Incidents list's filters and an incident's tasks", () => {
    const text: string = readPage(API_REFERENCE);
    const list: DeveloperDocsGuide = guideFor(DeveloperDocsPageType.Api, {});
    const view: DeveloperDocsGuide = guideFor(DeveloperDocsPageType.Api, {
      scope: DeveloperDocsScope.View,
      record: incidentRecord(),
    });

    expect(text).toContain(
      "find incidents that are not resolved, of one severity, about one monitor or from the last seven days",
    );
    expect(
      (list.steps[2]?.variants || []).map((variant: { label: string }) => {
        return variant.label;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Not resolved",
        "By severity",
        "By monitor",
        "Last 7 days",
      ]),
    );
    expect(text).toContain("acknowledge and resolve it");
    expect(
      (view.sections[0]?.variants || []).map((variant: { label: string }) => {
        return variant.label;
      }),
    ).toEqual(expect.arrayContaining(["Acknowledge it", "Resolve it"]));
    expect(text).toContain(
      "Every API page ends with the resource's endpoints.",
    );
    expect(
      view.sections.map((section: DeveloperDocsSection): string => {
        return section.title;
      }),
    ).toContain("Endpoints");
  });

  it("names the environment variable the commands read the key from", () => {
    expect(readPage(API_REFERENCE)).toContain(
      `\`${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}\``,
    );
    expect(
      getCurlCommand({ method: "GET", url: `${ONEUPTIME_URL}/api/incident` }),
    ).toContain(`$${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}`);
  });
});

describe("the MCP server guide", () => {
  it("names resources that have the page and MCP tools", () => {
    expect(readPage(MCP_SERVER)).toContain(
      "(a monitor, an incident, a status page, and so on)",
    );

    for (const modelType of [Monitor, Incident, StatusPage]) {
      expect({
        model: new modelType().tableName,
        hasPages: hasPages(modelType, DeveloperDocsScope.View),
        hasMcpTools: hasMcpTools(modelType),
      }).toEqual({
        model: new modelType().tableName,
        hasPages: true,
        hasMcpTools: true,
      });
    }
  });

  it("is right that workflows have the page but no MCP tools yet", () => {
    expect(readPage(MCP_SERVER)).toContain(
      "For a resource the MCP server has no tools for yet, such as a workflow",
    );
    expect(hasPages(Workflow, DeveloperDocsScope.View)).toBe(true);
    expect(hasMcpTools(Workflow)).toBe(false);
  });
});
