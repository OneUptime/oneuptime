import { DEVELOPER_DOCS_IMPORT_LIMIT } from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
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
import {
  CollectionApiExamples,
  getCollectionApiExamples,
  getResourceApiExamples,
  ResourceApiExamples,
} from "Common/Utils/DeveloperDocs/ApiExamples";
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

describe("the API reference", () => {
  it("lists the requests a resource's page and a list page show", () => {
    const resource: ResourceApiExamples = getResourceApiExamples({
      modelType: Monitor,
      apiBaseUrl: `${ONEUPTIME_URL}/api`,
      id: "1a2b3c4d-1234-4b2c-9d8e-0123456789ab",
      displayName: "Checkout API",
    });
    const collection: CollectionApiExamples = getCollectionApiExamples({
      modelType: Monitor,
      apiBaseUrl: `${ONEUPTIME_URL}/api`,
      singularName: "Monitor",
    });

    expect([resource.read, resource.update, resource.delete]).not.toContain(
      null,
    );
    expect([
      collection.list,
      collection.count,
      collection.create,
    ]).not.toContain(null);
    expect(readPage(API_REFERENCE)).toContain(
      "read, change and delete it from the resource's own page, or list, count and create from a list page",
    );
  });

  it("names the environment variable the commands read the key from", () => {
    expect(readPage(API_REFERENCE)).toContain(
      `\`${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}\``,
    );

    const resource: ResourceApiExamples = getResourceApiExamples({
      modelType: Monitor,
      apiBaseUrl: `${ONEUPTIME_URL}/api`,
      id: "1a2b3c4d-1234-4b2c-9d8e-0123456789ab",
    });

    expect(resource.read!.curl).toContain(
      `$${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}`,
    );
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
