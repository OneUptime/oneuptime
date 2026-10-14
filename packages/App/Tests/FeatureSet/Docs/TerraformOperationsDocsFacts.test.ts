import {
  DEVELOPER_DOCS_IMPORT_LIMIT,
  DeveloperDocsGuide,
  DeveloperDocsStep,
  getDeveloperDocsGuide,
} from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { getDeveloperDocsResource } from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import DocsPlaceholders, {
  TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER,
  TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER,
  TERRAFORM_PROVIDER_VERSION_PLACEHOLDER,
  getTerraformProviderMatchingConstraint,
  getTerraformProviderVersionConstraint,
} from "../../../FeatureSet/Docs/Utils/Placeholders";
import { scanMarkdown } from "./DocsContentSupport";
import { boldPaths } from "./DocsPageShape";
import {
  codeIn,
  englishPage,
  englishSection,
  lineStartingWith,
  rowStartingWith,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import {
  IMPORTING_RESOURCES,
  OPENTOFU,
  OTHER_VERSION_CONSTRAINTS,
  REGISTRY,
  SELF_HOSTED,
  TROUBLESHOOTING,
} from "./TerraformDocsPages";
import {
  CodeBlock,
  DATA_SOURCE_GENERATOR,
  DOCUMENTATION_GENERATOR,
  HclAttribute,
  HclBlock,
  HclBody,
  MONITOR_STEPS_GO,
  MODULES_DIRECTORY,
  ModuleInterface,
  PROVIDER_GENERATOR,
  ProviderAttribute,
  ProviderSchema,
  ProviderType,
  REGISTRY_PROVIDER_ADDRESSES,
  RESOURCE_GENERATOR,
  attributeNamed,
  codeBlocks,
  goFunction,
  moduleInterface,
  parseHcl,
  publishedModuleDirectory,
  readProvider,
  readRepoFile,
} from "./TerraformDocsSupport";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { getApiKeysStoppedMessage } from "Common/Types/Billing/PlanCutoffCredentials";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import ObjectID from "Common/Types/ObjectID";
import { getReferenceRefusalMessage } from "Common/Server/Utils/Database/ProjectScopedReferenceRefusal";
import { getEmptyDeveloperDocsLiveData } from "Common/Utils/DeveloperDocs/LiveData";
import {
  getTerraformImportBlocksHcl,
  getTerraformProviderHcl,
  getTerraformProviderUrl,
  getTerraformProviderVersionConstraint as getDashboardVersionConstraint,
  getTerraformResourceConfig,
  TerraformResourceConfig,
} from "Common/Utils/DeveloperDocs/TerraformConfig";
import { getListOrderCollisionChanges } from "Common/Utils/ListOrder";
import { beforeAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 30b: the importing, troubleshooting, self-hosted,
 * registry and OpenTofu pages, held to what they describe.
 * TerraformDocsFacts runs its HCL checks on these pages too (every block is
 * one the provider takes, import and removed blocks included, and the CLI
 * configurations, lock file and module block are read as what they are);
 * TerraformDocsTranslations holds the 16 translations to them.
 *
 * Each page says what the product does, and this suite reads that from the
 * code that does it:
 *
 *   - the importing page: which resources can be imported, the error an
 *     import of the others stops on, the blocks and the command the
 *     dashboard's Terraform pages write (run here, through the dashboard's
 *     own guide), where a record's ID shows, and which secrets an import
 *     cannot read back;
 *   - the troubleshooting page: every error it quotes, as the provider, the
 *     server and the generated Go word it, with its status; the lookup
 *     table leading to every section; and the order numbers that move;
 *   - the self-hosted page: the address and the version range the
 *     dashboard writes for an installation, which the new
 *     {{TERRAFORM_PROVIDER_MATCHING}} placeholder renders the same way, and
 *     the settings it names;
 *   - the registry page: the platforms a release builds, the signed
 *     checksums, the versions a release publishes and the tests it passes
 *     first;
 *   - the OpenTofu page: the module it uses, read from Examples/opentofu,
 *     and the generated OpenTofu guide saying the same as the page.
 *
 * What Terraform and OpenTofu themselves print (the plan lines, the import
 * and version errors, the removed and moved blocks' versions) was taken
 * from real terraform and tofu runs against the built provider; the PR that
 * wrote these pages lists them.
 */

let provider: ProviderSchema;

beforeAll(async () => {
  provider = await readProvider();
}, 180000);

function resourceType(name: string): ProviderType {
  const type: ProviderType | undefined = provider.resources.get(name);

  if (!type) {
    throw new Error(`The provider has no resource oneuptime_${name}`);
  }

  return type;
}

function attribute(typeName: string, name: string): ProviderAttribute {
  const found: ProviderAttribute | undefined =
    resourceType(typeName).attributes.get(name);

  if (!found) {
    throw new Error(`oneuptime_${typeName} has no attribute ${name}`);
  }

  return found;
}

// The fenced code blocks of an English page.
function pageBlocks(page: string): Array<CodeBlock> {
  return codeBlocks(englishPage(page));
}

// The code block of a page with this info string, such as title="imports.tf".
function blockTitled(page: string, info: string): Array<CodeBlock> {
  const found: Array<CodeBlock> = pageBlocks(page).filter(
    (block: CodeBlock): boolean => {
      return block.info === info;
    },
  );

  if (found.length === 0) {
    throw new Error(`${page} has no code block with ${info}`);
  }

  return found;
}

// The first code block of a section.
function sectionBlock(page: string, heading: string, lang: string): CodeBlock {
  const block: CodeBlock | undefined = codeBlocks(
    englishSection(page, heading),
  ).find((candidate: CodeBlock): boolean => {
    return candidate.lang === lang;
  });

  if (!block) {
    throw new Error(`${heading} on ${page} has no ${lang} block`);
  }

  return block;
}

// The text of a :::details block, by its summary.
function detailsBody(page: string, summary: string): string {
  const markdown: string = englishPage(page);
  const opening: string = `:::details ${summary}\n`;
  const start: number = markdown.indexOf(opening);

  if (start < 0) {
    throw new Error(`${page} has no details "${summary}"`);
  }

  return markdown.slice(
    start + opening.length,
    markdown.indexOf("\n:::", start + opening.length),
  );
}

function developerPageTitle(type: DeveloperDocsPageType): string {
  const definition: DeveloperDocsPageDefinition | undefined =
    DEVELOPER_DOCS_PAGES.find((candidate: DeveloperDocsPageDefinition) => {
      return candidate.type === type;
    });

  if (!definition) {
    throw new Error(`No Developer page of type ${type}`);
  }

  return definition.title;
}

// The page's placeholders as a OneUptime of this major renders them.
function rendered(text: string, major: string): string {
  return text
    .split(TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER)
    .join(major)
    .split(TERRAFORM_PROVIDER_VERSION_PLACEHOLDER)
    .join(`~> ${major}.0`);
}

const MONITOR_IDS: Readonly<Record<string, string>> = {
  Homepage: "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b01",
  "Checkout API": "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b05",
};

describe("the importing page", () => {
  it("names the one resource that cannot be imported, and the error an import of it stops on", () => {
    const unimportable: Array<string> = Array.from(provider.resources.values())
      .filter((type: ProviderType): boolean => {
        return !type.canBeImported;
      })
      .map((type: ProviderType): string => {
        return type.name;
      });
    const generator: string = readRepoFile(RESOURCE_GENERATOR);

    expect(unimportable).toEqual(["file"]);
    expect(
      englishSection(IMPORTING_RESOURCES, "### What can be imported"),
    ).toContain(
      "Every resource of the provider can be imported by its ID, except `oneuptime_file`: the OneUptime API cannot read a file back, so the provider answers `Import Not Supported`.",
    );
    expect(generator).toContain('"Import Not Supported",');
    expect(generator).toContain(
      "cannot be imported: the OneUptime API exposes no read endpoint for it.",
    );
    expect(detailsBody(IMPORTING_RESOURCES, "Import Not Supported")).toContain(
      "`oneuptime_file` is the one resource that cannot be imported.",
    );
  });

  it("imports by the record's ID, which the API answers 404 for when it is missing or the key may not read it", () => {
    const generator: string = readRepoFile(RESOURCE_GENERATOR);
    const baseApi: string = readRepoFile(
      "packages/Common/Server/API/BaseAPI.ts",
    );
    const getItem: string = baseApi.slice(
      baseApi.indexOf("public async getItem("),
      baseApi.indexOf("public async deleteItem("),
    );

    // The import ID is the id attribute, read back by its ID.
    expect(generator).toContain(
      'resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)',
    );
    // A read answered 404 drops the resource: Terraform's "non-existent" error.
    expect(generator).toContain(
      "if httpResp.StatusCode == http.StatusNotFound {\n        resp.State.RemoveResource(ctx)",
    );
    expect(getItem).toContain("ObjectID.validateUUID(idParam);");
    expect(getItem).toContain(
      "is one the\n     * caller may not read is answered as missing (404)",
    );
    expect(getItem).toContain("throw new NotFoundException(");
    expect(
      detailsBody(IMPORTING_RESOURCES, "Cannot import non-existent remote object"),
    ).toContain(
      "No record has that ID, or the provider's API key may not read it: OneUptime answers both the same way.",
    );

    // A name where the ID goes: the API's own words.
    expect(() => {
      ObjectID.validateUUID("critical");
    }).toThrow('Invalid ID format: "critical". Expected a valid UUID');
    expect(detailsBody(IMPORTING_RESOURCES, "Invalid ID format")).toContain(
      "The ID is not a record's ID, for example a name.",
    );
  });

  it("asks for the versions the generated docs give for import blocks", () => {
    expect(readRepoFile(DOCUMENTATION_GENERATOR)).toContain(
      "with an \\`import\\` block (Terraform 1.5+, OpenTofu 1.6+)",
    );
    expect(englishPage(IMPORTING_RESOURCES)).toContain(
      "- **Terraform 1.5 or later, or OpenTofu 1.6 or later.** The `import` blocks on this page need these versions.",
    );
  });

  it("shows the resource block and import block a resource's Terraform page writes, as the dashboard writes them", () => {
    const id: string = "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b02";
    const config: TerraformResourceConfig | null = getTerraformResourceConfig({
      modelType: StatusPage,
      json: {
        _id: id,
        name: "Public Status",
        pageTitle: "Acme Status",
        isPublicStatusPage: true,
      },
    });
    const block: CodeBlock = blockTitled(
      IMPORTING_RESOURCES,
      'title="status-pages.tf"',
    )[0] as CodeBlock;

    expect(config?.hcl.trim()).toBe(block.code.trim());
    expect(config?.importCommand).toBe(
      `terraform import oneuptime_status_page.public_status ${id}`,
    );
    expect(
      sectionBlock(IMPORTING_RESOURCES, "## Import on the command line", "bash")
        .code,
    ).toContain(config?.importCommand as string);
  });

  it("shows the import blocks and the command a list's Terraform page writes, for the first 100", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      {
        resource: getDeveloperDocsResource(Monitor),
        scope: DeveloperDocsScope.List,
        oneuptimeUrl: "https://oneuptime.example.com",
        platformVersion: "14.0.40",
        apiKeysUrl: "/dashboard/p/settings/api-keys",
        live: getEmptyDeveloperDocsLiveData(
          new Date("2026-10-14T12:00:00.000Z"),
        ),
        importTargets: Object.entries(MONITOR_IDS).map(
          ([name, monitorId]: [string, string]) => {
            return { id: monitorId, displayName: name };
          },
        ),
        totalCount: 2,
      },
    );
    const bringIn: string =
      (guide.steps as Array<DeveloperDocsStep>).find(
        (step: DeveloperDocsStep): boolean => {
          return step.title.startsWith("Bring in the");
        },
      )?.markdown || "";
    const imports: string = (
      blockTitled(IMPORTING_RESOURCES, 'title="imports.tf"')[0] as CodeBlock
    ).code;
    const command: string = sectionBlock(
      IMPORTING_RESOURCES,
      "### Let Terraform write the configuration",
      "bash",
    ).code;

    expect(
      getTerraformImportBlocksHcl({
        modelType: Monitor,
        targets: Object.entries(MONITOR_IDS).map(
          ([name, monitorId]: [string, string]) => {
            return { id: monitorId, displayName: name };
          },
        ),
      })?.trim(),
    ).toBe(imports.trim());
    expect(bringIn).toContain(imports.trim());
    expect(bringIn).toContain(command.trim());
    expect(command.trim()).toBe(
      "terraform plan -generate-config-out=monitors.tf",
    );
    expect(DEVELOPER_DOCS_IMPORT_LIMIT).toBe(100);
    expect(englishPage(IMPORTING_RESOURCES)).toContain(
      `The page writes an \`import\` block for each record (the first ${DEVELOPER_DOCS_IMPORT_LIMIT})`,
    );
  });

  it("names the Developer section, its Terraform page and the Monitors list as the Dashboard does", () => {
    const paths: Array<string> = boldPaths(
      englishPage(IMPORTING_RESOURCES),
    ).map((segments: Array<string>): string => {
      return segments.join(" → ");
    });
    const terraform: string = developerPageTitle(
      DeveloperDocsPageType.Terraform,
    );

    expect(paths).toEqual([
      `Monitors → ${DEVELOPER_DOCS_SECTION_TITLE} → ${terraform}`,
    ]);
    expect(englishPage(IMPORTING_RESOURCES)).toContain(
      `In its side menu, open **${DEVELOPER_DOCS_SECTION_TITLE}**, then **${terraform}**.`,
    );
  });

  it("finds a record's ID where the Dashboard shows it", () => {
    const idLine: string = readRepoFile(
      "packages/Common/UI/Components/Detail/DetailIdLine.tsx",
    );
    const routes: string = readRepoFile(
      "packages/App/FeatureSet/Dashboard/src/Utils/RouteMap.ts",
    );
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(IMPORTING_RESOURCES, "### Write the blocks yourself"),
      "Where",
    );

    expect(idLine).toContain('{translator.translateText("ID")}');
    expect(idLine).toContain(
      'aria-label={translator.translateText("Copy ID to clipboard")}',
    );
    expect(rowStartingWith(rows, "The resource's page")[1]).toBe(
      "Its details card ends with an **ID** line. Click the ID, or the copy button beside it, to copy the whole ID.",
    );
    expect(routes).toContain(
      "`/dashboard/${RouteParams.ProjectID}/monitors/${\n      MonitorsRoutePath[PageMap.MONITOR_VIEW]\n    }`",
    );
    expect(routes).toContain("[PageMap.MONITOR_VIEW]: `${RouteParams.ModelID}`,");
    expect(codeIn(rowStartingWith(rows, "The address bar")[1] as string)).toEqual(
      ["/dashboard/<project-id>/monitors/<monitor-id>"],
    );
  });

  it("is right that a secret OneUptime never sends back is not read into the state", () => {
    const secret: ProviderAttribute = attribute(
      "monitor_secret",
      "secret_value",
    );

    expect(secret).toEqual(
      expect.objectContaining({
        settable: true,
        sensitive: true,
        readBack: false,
      }),
    );
    // A field the read never maps keeps the value the state already has.
    expect(readRepoFile(RESOURCE_GENERATOR)).toContain(
      "Write-only fields (in the create/update schemas but never in a\n       * response) are not present in API responses. Skip mapping them",
    );
    expect(englishPage(IMPORTING_RESOURCES)).toContain(
      "- **Secrets are not read back.** A secret OneUptime never sends back, such as a monitor secret's `secret_value`, is not in the state after an import.",
    );
  });

  it("stops managing a resource with a removed block that keeps the record", () => {
    const removed: HclBlock = parseHcl(
      sectionBlock(IMPORTING_RESOURCES, "## Stop managing a resource", "hcl")
        .code,
    ).blocks[0] as HclBlock;
    const lifecycle: HclBlock = removed.body.blocks[0] as HclBlock;

    expect(removed.type).toBe("removed");
    expect(lifecycle.type).toBe("lifecycle");
    expect(attributeNamed(lifecycle.body.attributes, "destroy")?.value).toEqual(
      expect.objectContaining({ kind: "bool", value: false }),
    );
    expect(resourceType("team").canBeImported).toBe(true);
  });
});

// A link to a section of the same page: "[text](#anchor)".
const OWN_SECTION_LINK: RegExp = /\]\(#([^)]+)\)/g;

describe("the troubleshooting page", () => {
  it("quotes every error as the provider and the server word it, with its status", () => {
    const providerSource: string = readRepoFile(PROVIDER_GENERATOR);
    const page: string = englishPage(TROUBLESHOOTING);
    const tablePermission: string = readRepoFile(
      "packages/Common/Server/Types/Database/Permissions/TablePermission.ts",
    );

    expect(providerSource).toContain('"Missing API Key",');
    expect(
      readRepoFile("packages/Common/Server/Middleware/ProjectAuthorization.ts"),
    ).toContain('throw new BadDataException("Invalid API Key");');
    expect(
      readRepoFile("packages/Common/Server/Services/MonitorService.ts"),
    ).toContain(
      'throw new BadDataException("ProjectId required to create monitor.");',
    );

    // "You do not have permissions to create Monitor", a 422.
    expect(tablePermission).toContain("`You do not have permissions to ${type} ${");
    expect(tablePermission).toContain("throw new NotAuthorizedException(");
    expect(new Monitor().singularName).toBe("Monitor");
    expect(ExceptionCode.NotAuthorizedException).toBe(422);
    expect(
      englishSection(TROUBLESHOOTING, "### The key lacks a permission"),
    ).toContain(
      "`You do not have permissions to create Monitor` and messages like it come with status `422`",
    );

    // Below Growth, a 402 that names the plan.
    expect(getApiKeysStoppedMessage("Growth")).toMatch(
      /^API keys need the Growth plan\. /,
    );
    expect(ExceptionCode.PaymentRequiredException).toBe(402);
    expect(page).toContain("| `API keys need the Growth plan` |");

    // A blocked project, a 403.
    expect(ExceptionMessages.ProjectBlocked).toBe(
      "This project has been blocked. Please contact your administrator.",
    );
    expect(ExceptionCode.ForbiddenException).toBe(403);
    expect(englishSection(TROUBLESHOOTING, "### A blocked project")).toContain(
      `\`${ExceptionMessages.ProjectBlocked}\` comes with status \`403\``,
    );

    // The data sources' lookups.
    for (const summary of ['"Not Found"', '"Ambiguous Match"']) {
      expect(readRepoFile(DATA_SOURCE_GENERATOR)).toContain(summary);
    }

    // A renamed type's deprecation.
    expect(readRepoFile(RESOURCE_GENERATOR)).toContain(
      "has been renamed to ${this.providerName}_${resource.name}",
    );
  });

  it("quotes the server's answer to an ID of another project's record word for word", () => {
    const quoted: string = sectionBlock(
      TROUBLESHOOTING,
      "### IDs from another project",
      "text",
    ).code;

    expect(quoted).toBe(
      getReferenceRefusalMessage({
        subject: "network device",
        described: ['Network Site "…"'],
      }),
    );
  });

  it("says where an error comes from by the words the provider writes", () => {
    const providerSource: string = readRepoFile(PROVIDER_GENERATOR);
    const generator: string = readRepoFile(RESOURCE_GENERATOR);
    const page: string = englishSection(TROUBLESHOOTING, "## How to read an error");

    expect(providerSource).toContain(
      'return nil, fmt.Errorf("failed to execute request: %w", err)',
    );
    expect(providerSource).toContain(
      'return fmt.Errorf("the OneUptime API returned status %d: %s", resp.StatusCode, apiErrorMessage(body))',
    );
    expect(generator).toContain(
      'AddError("Parse Error", fmt.Sprintf("Unable to parse ${resource.name} response, got error: %s", err))',
    );
    expect(generator).toContain(
      'AddError("OneUptime API Error", fmt.Sprintf("Unable to create ${resource.name}: %s", err))',
    );
    expect(generator).toContain(
      'AddError("OneUptime API Error", fmt.Sprintf("Unable to update ${resource.name}: %s", err))',
    );

    for (const words of [
      "`failed to execute request`",
      "`the OneUptime API returned status`",
      "`Unable to create monitor`",
      "`Unable to update monitor`",
      "`Unable to parse label response`",
      "`Parse Error`",
    ]) {
      expect(page).toContain(words);
    }
  });

  it("is right about how long the provider waits, and which requests it tries again", () => {
    const providerSource: string = readRepoFile(PROVIDER_GENERATOR);
    const section: string = englishSection(
      TROUBLESHOOTING,
      "### Connections that fail",
    );

    expect(providerSource).toContain("Timeout: time.Second * 60,");
    expect(section).toContain("The provider waits up to 60 seconds for each answer.");
    // Reads (get-item, get-list, count) and deletes: three attempts.
    expect(providerSource).toContain(
      'idempotent := method == "GET" || method == "DELETE" || strings.HasSuffix(path, "/get-item")',
    );
    expect(providerSource).toContain("attempts = 3");

    for (const status of [
      "StatusTooManyRequests",
      "StatusBadGateway",
      "StatusServiceUnavailable",
      "StatusGatewayTimeout",
    ]) {
      expect(providerSource).toContain(`resp.StatusCode == http.${status}`);
    }

    expect(section).toContain(
      "It tries a read or a delete up to three times when no answer comes, or the answer is `429`, `502`, `503` or `504`, but never a create or a change",
    );
    expect(readRepoFile(PROVIDER_GENERATOR)).toContain(
      'return fmt.Errorf("failed to unmarshal response: %w", err)',
    );
  });

  it("names the warning the provider logs for a column OneUptime will not send", () => {
    expect(readRepoFile(PROVIDER_GENERATOR)).toContain(
      'tflog.Warn(ctx, "OneUptime rejected a column in the select; dropping it and retrying"',
    );
    expect(englishSection(TROUBLESHOOTING, "## Get more detail")).toContain(
      "`OneUptime rejected a column in the select; dropping it and retrying` names a column",
    );
  });

  it("is right that a taken order number moves the ones in the way, and a free one is kept", () => {
    for (const model of [
      MonitorStatus,
      IncidentState,
      IncidentSeverity,
      AlertState,
      AlertSeverity,
    ]) {
      expect({
        model: new model().tableName,
        ordered: Boolean(new model().getListOrder()),
      }).toEqual({ model: new model().tableName, ordered: true });
    }

    const siblings: Array<{ id: string; value: number }> = [
      { id: "a", value: 101 },
      { id: "b", value: 102 },
      { id: "c", value: 103 },
    ];

    // A number nobody holds is kept, and nothing else moves.
    expect(
      getListOrderCollisionChanges({
        siblings: siblings,
        itemId: "new",
        previousValue: null,
        requestedValue: 110,
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([]);
    // A taken number: the one holding it, and the run behind it, step down.
    expect(
      getListOrderCollisionChanges({
        siblings: siblings,
        itemId: "new",
        previousValue: null,
        requestedValue: 102,
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([
      { id: "b", value: 103 },
      { id: "c", value: 104 },
    ]);
    expect(
      englishSection(TROUBLESHOOTING, "### A priority or order that moves"),
    ).toContain(
      "A number nobody else holds is kept as written. A number another one already holds is taken over, and the ones in the way step down one place",
    );
  });

  it("is right about the attributes only OneUptime writes", () => {
    let readOnly: number = 0;

    for (const type of Array.from(provider.resources.values())) {
      for (const [name, found] of Array.from(type.attributes.entries())) {
        if (name.endsWith("_by_user_id") || name === "archived_at") {
          readOnly++;
          expect({ type: type.name, name, settable: found.settable }).toEqual({
            type: type.name,
            name,
            settable: false,
          });
        }
      }
    }

    expect(readOnly).toBeGreaterThan(100);
    expect(attribute("monitor", "is_archived").settable).toBe(true);
    expect(attribute("monitor", "archived_at").settable).toBe(false);
  });

  it("names the decimal attribute an older provider read as null", () => {
    expect(
      attribute(
        "status_page_history_chart_bar_color",
        "uptime_percent_greater_than_or_equal_to",
      ).type,
    ).toBe("number");
    expect(englishPage(TROUBLESHOOTING)).toContain(
      "`terraform untaint oneuptime_status_page_history_chart_bar_color.operational`",
    );
  });

  it("refuses the empty values the page names, in monitor_steps and its parts", () => {
    const source: string = readRepoFile(MONITOR_STEPS_GO);

    expect(
      goFunction(source, "func MonitorStepsSchemaAttribute("),
    ).toContain("Validators:   []validator.List{listvalidator.SizeAtLeast(1)},");

    const step: string = goFunction(source, "func monitorStepsStepSchema()");
    const field: (name: string) => string = (name: string): string => {
      return step.slice(
        step.indexOf(`"${name}": schema.`),
        step.indexOf("},", step.indexOf(`"${name}": schema.`)),
      );
    };

    expect(field("request_headers")).toContain("mapvalidator.SizeAtLeast(1)");
    expect(field("request_body")).toContain("stringvalidator.LengthAtLeast(1)");
    expect(englishSection(TROUBLESHOOTING, "### Empty values")).toContain(
      "such as `monitor_steps = []`, `request_headers = {}` or `request_body = \"\"`",
    );
  });

  it("leads from its table to every section that explains an error, and to nothing else", () => {
    const markdown: string = englishPage(TROUBLESHOOTING);
    const table: string = englishSection(TROUBLESHOOTING, "## Find your error");
    const linked: Set<string> = new Set(
      Array.from(table.matchAll(OWN_SECTION_LINK)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );
    const groups: Array<string> = [
      "## API keys, permissions and plans",
      "## Records and lookups",
      "## Plans that do not settle",
      "## Configuration the provider refuses",
      "## Versions and the registry",
      "## Connecting to a self-hosted OneUptime",
    ];
    const explained: Array<string> = scanMarkdown(markdown)
      .headings.filter((heading: { level: number; text: string }) => {
        return heading.level === 3;
      })
      .map((heading: { slug: string }): string => {
        return heading.slug;
      });

    for (const group of groups) {
      expect(markdown).toContain(`\n${group}\n`);
    }

    expect(Array.from(linked).sort()).toEqual([...explained].sort());
    // One row for the 404 a refresh gets, and it says to import.
    const rows: Array<string> = table.split("\n").filter((line: string) => {
      return line.startsWith("| ") && line.includes("`404`");
    });

    expect(rows.length).toBe(1);
    expect(rows[0]).toContain("`terraform import`");
  });
});

// Where config.example.env and the Helm chart's values set an installation's address.
const HOST_SETTING: RegExp = /^HOST=/;
const PROTOCOL_SETTING: RegExp = /^HTTP_PROTOCOL=/;
const HOST_VALUE: RegExp = /^host: /;
const PROTOCOL_VALUE: RegExp = /^httpProtocol: /;
// An attribute of the provider block's schema in ProviderGenerator.
const PROVIDER_SETTING: RegExp = /"([a-z_]+)": schema\.StringAttribute/g;
// Where a parsed HCL value says it was: not part of what it is.
const LINE_FIELD: RegExp = /"line":\d+/g;

describe("the self-hosted page", () => {
  const packageVersion: string = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf-8"),
  ).version;

  it("renders {{TERRAFORM_PROVIDER_MATCHING}} as the range the dashboard writes for the same version", () => {
    for (const version of ["14.0.40", "14.0.56", "15.2.3", "v14.0.7"]) {
      expect({
        version,
        docs: getTerraformProviderMatchingConstraint(version),
      }).toEqual({
        version,
        docs: getDashboardVersionConstraint(
          version.startsWith("v") ? version.slice(1) : version,
        ),
      });
    }

    // No release to read: the newest provider of the major, as the version placeholder.
    for (const version of ["1.0.0", "unknown", ""]) {
      expect(getTerraformProviderMatchingConstraint(version)).toBe(
        getTerraformProviderVersionConstraint(version),
      );
    }

    expect(
      DocsPlaceholders.render(
        `version = "${TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER}"`,
      ),
    ).toBe(
      `version = ">= ${packageVersion.split(".")[0]}.0, <= ${packageVersion}"`,
    );
  });

  it("writes the provider block the dashboard writes for an installation: its address, and its range", () => {
    const oneuptimeUrl: string | null = getTerraformProviderUrl({
      host: "oneuptime.example.com",
      isHttps: true,
    });
    const dashboard: string = getTerraformProviderHcl({
      oneuptimeUrl: oneuptimeUrl,
      platformVersion: "14.0.40",
    });
    const blocks: Array<HclBody> = codeBlocks(englishPage(SELF_HOSTED))
      .filter((block: CodeBlock): boolean => {
        return block.lang === "hcl" && block.info === 'title="main.tf"';
      })
      .map((block: CodeBlock): HclBody => {
        return parseHcl(rendered(block.code, "14"));
      });
    const versions: Array<string> = blocks.flatMap((body: HclBody) => {
      return body.blocks
        .filter((block: HclBlock): boolean => {
          return block.type === "terraform";
        })
        .map((block: HclBlock): string => {
          const requirement: HclAttribute | undefined = attributeNamed(
            (block.body.blocks[0] as HclBlock).body.attributes,
            "oneuptime",
          );

          return requirement?.value.kind === "object"
            ? ((
                attributeNamed(requirement.value.attributes, "version")
                  ?.value as { value: string }
              ).value as string)
            : "";
        });
    });

    expect(oneuptimeUrl).toBe("https://oneuptime.example.com");
    expect(englishPage(SELF_HOSTED)).toContain(
      `  oneuptime_url = "${oneuptimeUrl}"`,
    );
    expect(dashboard).toContain(`oneuptime_url = "${oneuptimeUrl}"`);
    // The example range for a OneUptime 14.0.40 is the dashboard's for it.
    expect(versions).toEqual([
      TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER,
      ">= 14.0, <= 14.0.40",
    ]);
    expect(dashboard).toContain('version = ">= 14.0, <= 14.0.40"');
    expect(OTHER_VERSION_CONSTRAINTS[SELF_HOSTED]).toContain(
      TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER,
    );
  });

  it("is right that the provider adds the scheme and /api, and reads the address from ONEUPTIME_URL", () => {
    const providerSource: string = readRepoFile(PROVIDER_GENERATOR);

    expect(providerSource).toContain(
      'oneuptimeUrl = "https://" + oneuptimeUrl',
    );
    expect(providerSource).toContain(
      'strings.TrimSuffix(oneuptimeUrl, "/") + "/api"',
    );
    expect(providerSource).toContain(
      'os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_URL")',
    );
    expect(englishPage(SELF_HOSTED)).toContain(
      "The provider adds `https://` when the address has no scheme, and `/api` at the end, so `https://oneuptime.example.com` sends every request to `https://oneuptime.example.com/api`.",
    );
    expect(
      readRepoFile("packages/Nginx/default.conf.template"),
    ).toContain("    location /api {");
  });

  it("names the settings an installation's address comes from", () => {
    const env: string = readRepoFile("config.example.env");
    const values: string = readRepoFile(
      "HelmChart/Public/oneuptime/values.yaml",
    );

    expect(env.split("\n")).toEqual(
      expect.arrayContaining([
        expect.stringMatching(HOST_SETTING),
        expect.stringMatching(PROTOCOL_SETTING),
      ]),
    );
    expect(values.split("\n")).toEqual(
      expect.arrayContaining([
        expect.stringMatching(HOST_VALUE),
        expect.stringMatching(PROTOCOL_VALUE),
      ]),
    );
    expect(englishPage(SELF_HOSTED)).toContain(
      "`HOST` and `HTTP_PROTOCOL` in `config.env` with Docker Compose, and `host` and `httpProtocol` in the Helm chart's values",
    );
  });

  it("asks OneUptime for its version where it answers", () => {
    const versionApi: string = readRepoFile(
      "packages/Common/Server/API/VersionAPI.ts",
    );

    expect(versionApi).toContain('router.get("/version",');
    expect(versionApi).toContain("res.send({ version: AppVersion, commit: GitSha });");
    expect(englishPage(SELF_HOSTED)).toContain(
      'The answer is JSON, such as `{"version":"{{TERRAFORM_PROVIDER_MAJOR}}.0.40","commit":"..."}`.',
    );
  });

  it("is right that nothing skips the certificate check, proxies come from the environment, and the key is the APIKey header", () => {
    const providerSource: string = readRepoFile(PROVIDER_GENERATOR);
    const client: string = providerSource.slice(
      providerSource.indexOf("client := &Client{"),
      providerSource.indexOf("return client, nil"),
    );
    const schemaStart: number = providerSource.indexOf(
      "Attributes: map[string]schema.Attribute{",
    );
    const schema: string = providerSource.slice(
      schemaStart,
      providerSource.indexOf("func (p *", schemaStart),
    );

    // The default transport: the system's trust store, and HTTPS_PROXY.
    expect(client).toContain("HTTPClient: &http.Client{");
    expect(client).not.toContain("Transport");
    expect(client).not.toContain("InsecureSkipVerify");
    // The provider's only settings are the address and the key.
    expect(
      Array.from(schema.matchAll(PROVIDER_SETTING)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(["oneuptime_url", "api_key"]);
    expect(providerSource).toContain('req.Header.Set("APIKey", c.ApiKey)');
    expect(
      readRepoFile("packages/Common/Server/Middleware/ProjectAuthorization.ts"),
    ).toContain('req.headers?.["apikey"]');
    expect(englishSection(SELF_HOSTED, "## TLS and certificates")).toContain(
      "there is no setting to skip the check",
    );
  });

  it("mirrors the provider under each registry's address, Terraform's tab first", () => {
    const configurations: Array<HclBody> = blockTitled(
      SELF_HOSTED,
      'title="mirror.tfrc"',
    ).map((block: CodeBlock): HclBody => {
      return parseHcl(block.code);
    });
    const included: Array<string> = configurations.map((body: HclBody) => {
      const installation: HclBlock = body.blocks[0] as HclBlock;
      const mirror: HclBlock = installation.body.blocks.find(
        (block: HclBlock): boolean => {
          return block.type === "filesystem_mirror";
        },
      ) as HclBlock;
      const direct: HclBlock = installation.body.blocks.find(
        (block: HclBlock): boolean => {
          return block.type === "direct";
        },
      ) as HclBlock;
      const include: string = JSON.stringify(
        attributeNamed(mirror.body.attributes, "include")?.value,
      );
      const exclude: string = JSON.stringify(
        attributeNamed(direct.body.attributes, "exclude")?.value,
      );

      // What the mirror holds, and nothing else, is not fetched directly.
      expect(include.replace(LINE_FIELD, "")).toBe(
        exclude.replace(LINE_FIELD, ""),
      );

      return (
        (attributeNamed(mirror.body.attributes, "include")?.value as {
          items: Array<{ value: string }>;
        }).items[0] as { value: string }
      ).value;
    });

    expect(included).toEqual([...REGISTRY_PROVIDER_ADDRESSES]);
  });
});

// The operating systems the release builds the provider for, as the page names them.
// A target of the GoReleaser configuration: "      - darwin".
const GOOS_LINE: RegExp = /^ {6}- ([a-z]+)$/gm;
// The default of a module input: `  default     = "Operational"`.
const DEFAULT_VALUE: RegExp = /^ {2}default\s*=\s*"([^"]*)"$/m;

const OPERATING_SYSTEM_NAMES: Readonly<Record<string, string>> = {
  linux: "Linux",
  darwin: "macOS",
  windows: "Windows",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  solaris: "Solaris",
};

describe("the registry page", () => {
  const generator: string = readRepoFile(
    "Scripts/TerraformProvider/Core/TerraformProviderGenerator.ts",
  );
  const release: string = readRepoFile(".github/workflows/release.yml");
  const publish: string = readRepoFile(
    "Scripts/TerraformProvider/publish-terraform-provider.sh",
  );

  it("names every operating system a release builds the provider for, and the signed checksums", () => {
    const goreleaser: string = generator.slice(
      generator.indexOf("    goos:"),
      generator.indexOf("    goarch:"),
    );
    const systems: Array<string> = Array.from(
      goreleaser.matchAll(GOOS_LINE),
    ).map((match: RegExpMatchArray): string => {
      return OPERATING_SYSTEM_NAMES[match[1] as string] as string;
    });
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(REGISTRY, "## What is published"),
      "What",
    );

    expect(systems).toEqual([
      "macOS",
      "Linux",
      "Windows",
      "FreeBSD",
      "OpenBSD",
      "Solaris",
    ]);
    expect(rows[0]?.[0]).toBe(
      "The provider, for Linux, macOS, Windows, FreeBSD, OpenBSD and Solaris",
    );
    // GoReleaser signs the checksums file with OneUptime's key.
    expect(generator).toContain("signs:\n  - artifacts: checksum\n    cmd: gpg");
    expect(rows[0]?.[1]).toContain("with checksums that OneUptime signs");
  });

  it("is right that a release publishes the provider under its own version, only when it changed, and after the tests under both engines", () => {
    const job: string = release.slice(
      release.indexOf("  publish-terraform-provider:"),
      release.indexOf("  push-release-tags:"),
    );
    const e2e: string = readRepoFile(
      ".github/workflows/terraform-provider-e2e.yml",
    );

    expect(job).toContain(
      "needs: [generate-build-number, read-version, terraform-provider-e2e]",
    );
    expect(job).toContain('VERSION="${{needs.read-version.outputs.major_minor}}"');
    expect(job).toContain(
      'npm run publish-terraform-provider -- --version "${{ steps.version.outputs.version }}"',
    );
    expect(publish).toContain(
      "No provider changes detected compared to remote (ignoring VERSION). Skipping publish entirely",
    );
    expect(e2e).toContain("- name: Run OpenTofu E2E tests");
    expect(e2e).toContain('TOFU_VERSION: "');
    expect(englishSection(REGISTRY, "## What is published")).toContain(
      "When the provider changed, the release publishes it, under the release's version, once it has passed its end-to-end tests under Terraform and under OpenTofu",
    );
    expect(englishSection(REGISTRY, "## How versions are numbered")).toContain(
      "A release whose provider did not change publishes none, so the versions have gaps",
    );
  });

  it("names the registry's documentation as the generator writes it", () => {
    const documentation: string = readRepoFile(DOCUMENTATION_GENERATOR);
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(REGISTRY, "## What is published"),
      "What",
    );

    for (const group of [
      'name: "Monitors"',
      'name: "Status Pages"',
      'name: "Incidents"',
      'name: "On-Call & Escalation"',
    ]) {
      expect(documentation).toContain(group);
    }

    expect(documentation).toContain('subcategory: "Guides"');
    expect(rowStartingWith(rows, "A guide to using the provider with OpenTofu")[1]).toBe(
      "The registry's guides",
    );
  });

  it("names the provider's own repository and what its releases link to", () => {
    expect(publish).toContain('GITHUB_ORG="OneUptime"');
    expect(publish).toContain('PROVIDER_REPO="terraform-provider-$PROVIDER_NAME"');
    expect(publish).toContain("**Full Changelog**");
    expect(englishPage(REGISTRY)).toContain(
      "[The provider's releases](https://github.com/OneUptime/terraform-provider-oneuptime/releases) link to the changes since the one before.",
    );
  });

  it("shows a lock file under the Terraform Registry's address, with the constraint the pages write", () => {
    const lock: HclBlock = parseHcl(
      (blockTitled(REGISTRY, 'title=".terraform.lock.hcl"')[0] as CodeBlock)
        .code,
    ).blocks[0] as HclBlock;

    expect(lock.labels[0]).toBe(REGISTRY_PROVIDER_ADDRESSES[0]);
    expect(
      (attributeNamed(lock.body.attributes, "constraints")?.value as {
        value: string;
      }).value,
    ).toBe(TERRAFORM_PROVIDER_VERSION_PLACEHOLDER);
    expect(englishSection(REGISTRY, "## The lock file")).toContain(
      `OpenTofu writes \`${REGISTRY_PROVIDER_ADDRESSES[1]}\` where Terraform writes \`${REGISTRY_PROVIDER_ADDRESSES[0]}\``,
    );
  });
});

describe("the OpenTofu page", () => {
  const MODULE: string = "monitoring-and-incident-response";

  it("uses the module the provider repository publishes, with inputs and outputs it has", () => {
    const block: HclBlock = parseHcl(
      sectionBlock(OPENTOFU, "## A reusable module", "hcl").code,
    ).blocks[0] as HclBlock;
    const source: string = (
      attributeNamed(block.body.attributes, "source")?.value as {
        value: string;
      }
    ).value;
    const module: ModuleInterface = moduleInterface(MODULE);

    expect(publishedModuleDirectory(source)).toBe(MODULE);
    expect(source).toContain("?ref=vX.Y.Z");
    expect(englishSection(OPENTOFU, "## A reusable module")).toContain(
      "Replace `vX.Y.Z` with a published provider version",
    );
    // The two inputs a call must set.
    expect(
      Array.from(module.variables.entries())
        .filter(([, required]: [string, boolean]) => {
          return required;
        })
        .map(([name]: [string, boolean]) => {
          return name;
        })
        .sort(),
    ).toEqual(["monitors", "service_name"]);
    expect(module.outputs.has("on_call_policy_id")).toBe(true);
    expect(module.outputs.has("escalation_rule_id")).toBe(true);
    // The generator publishes the directory under modules/.
    expect(readRepoFile(DOCUMENTATION_GENERATOR)).toContain(
      'this.fileGenerator.copyDirectory(MODULES_SOURCE_DIR, "modules");',
    );
    expect(fs.existsSync(path.join(__dirname, "../../../../..", MODULES_DIRECTORY, MODULE))).toBe(true);
  });

  it("names the statuses and severity the module looks up, and the inputs that rename them", () => {
    const variables: string = readRepoFile(
      `${MODULES_DIRECTORY}/${MODULE}/variables.tf`,
    );
    const main: string = readRepoFile(`${MODULES_DIRECTORY}/${MODULE}/main.tf`);
    const text: string = englishSection(OPENTOFU, "## A reusable module");

    for (const [input, name] of [
      ["operational_monitor_status_name", "Operational"],
      ["offline_monitor_status_name", "Offline"],
      ["incident_severity_name", "Critical Incident"],
    ] as Array<[string, string]>) {
      const declaration: string = variables.slice(
        variables.indexOf(`variable "${input}"`),
      );

      expect(declaration.match(DEFAULT_VALUE)?.[1]).toBe(name);
      expect(text).toContain(`\`${name}\``);
      expect(text).toContain(`\`${input}\``);
    }

    expect(main).toContain('data "oneuptime_monitor_status" "operational"');
    expect(main).not.toContain('resource "oneuptime_monitor_status"');
  });

  it("is right that the module's escalation rule pages nobody until a team is added to it", () => {
    const main: string = readRepoFile(`${MODULES_DIRECTORY}/${MODULE}/main.tf`);

    expect(main).toContain('resource "oneuptime_escalation_rule" "primary"');

    for (const responder of [
      "oneuptime_team_on_call_duty_escalation_rule",
      "oneuptime_users_on_call_duty_escalation_rule",
      "oneuptime_schedules_on_call_duty_escalation_rule",
    ]) {
      expect(main).not.toContain(responder);
      expect(provider.resources.has(responder.slice("oneuptime_".length))).toBe(
        true,
      );
    }

    expect(englishSection(OPENTOFU, "## A reusable module")).toContain(
      "Its escalation rule pages nobody until you say who: add a team to it with the module's outputs:",
    );
  });

  it("is right that every release is tested under OpenTofu, and that >= 1.5.0 admits every OpenTofu", () => {
    const e2e: string = readRepoFile(
      ".github/workflows/terraform-provider-e2e.yml",
    );

    expect(e2e).toContain("- name: Run OpenTofu E2E tests");
    expect(
      readRepoFile(`${MODULES_DIRECTORY}/${MODULE}/versions.tf`),
    ).toContain('required_version = ">= 1.5.0"');
    expect(englishPage(OPENTOFU)).toContain(
      "| `required_version` | OpenTofu's versions start at 1.6.0, so `>= 1.5.0`, written for Terraform, admits every OpenTofu. |",
    );
  });

  it("says what the generated OpenTofu guide says about variables, .tofu files and lock files", () => {
    const documentation: string = readRepoFile(DOCUMENTATION_GENERATOR);
    const page: string = englishSection(OPENTOFU, "## What differs from Terraform");

    expect(documentation).not.toContain("TOFU_VAR");
    expect(documentation).toContain(
      "| Variables | \\`TF_VAR_name\\` sets a variable under OpenTofu too. |",
    );
    expect(page).toContain("| Variables | `TF_VAR_name` sets a variable under OpenTofu too. |");
    expect(documentation).toContain("OpenTofu 1.8 and later also read \\`.tofu\\` files");
    expect(page).toContain("OpenTofu 1.8 and later also read `.tofu` files");
    expect(documentation).toContain(
      "\\`init\\` rewrites the provider's entry when you switch engines",
    );
    expect(page).toContain("Switching engines rewrites that entry");
    expect(
      readRepoFile("Examples/opentofu/README.md"),
    ).not.toContain("TOFU_VAR");
  });
});
