import ModelServiceHandler, {
  getColumnsRequiredOnCreateForDocumentation,
  getDocumentedDefaultValue,
} from "../../../FeatureSet/APIReference/Service/Model";
import ResourceUtil, {
  ModelDocumentation,
} from "../../../FeatureSet/APIReference/Utils/Resources";
import { PAGE_FIXTURES, renderPage } from "./ReferenceFixtures";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import Dictionary from "Common/Types/Dictionary";
import { getColumnsRequiredOnCreate } from "Common/Utils/DeveloperDocs/TerraformSchema";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import type * as Path from "path";

/*
 * A resource's page badges a column Required when a create must send it -
 * not whenever the database requires it (#5164's follow-ups). #5158 let a
 * create leave out every required column with a default, and the OpenAPI
 * spec and the Terraform provider already said they were optional, but the
 * reference still badged them Required: a new detection rule's Enabled, a
 * monitor's switches, every project id (the API key's) and every slug.
 *
 * The badge reads requiredOnCreate (getColumnsRequiredOnCreate, which
 * TerraformProviderSchemaContract holds to the real spec), and a column's
 * declared default is shown beside it.
 */

jest.mock("../../../FeatureSet/APIReference/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(
    __dirname,
    "../../../FeatureSet/APIReference",
  );
  return {
    ViewsPath: path.join(root, "views"),
    StaticPath: path.join(root, "Static"),
    CodeExamplesPath: path.join(root, "CodeExamples"),
  };
});

interface PageColumn extends TableColumnMetadata {
  requiredOnCreate: boolean;
  documentedDefault: string | null;
}

async function pageColumns(
  resource: ModelDocumentation,
): Promise<Dictionary<PageColumn>> {
  let locals: Record<string, unknown> = {};

  const req: ExpressRequest = {
    params: { lang: "en", page: resource.path },
    originalUrl: `/reference/en/${resource.path}`,
    headers: {},
  } as unknown as ExpressRequest;

  const res: unknown = {
    status: (): unknown => {
      return res;
    },
    render: (_view: string, renderLocals: Record<string, unknown>): void => {
      locals = renderLocals;
    },
  };

  await ModelServiceHandler.executeResponse(req, res as ExpressResponse);

  return ((locals["pageData"] as Record<string, unknown>)?.["columns"] ||
    {}) as Dictionary<PageColumn>;
}

function resourceOf(modelType: DatabaseBaseModelType): ModelDocumentation {
  const resource: ModelDocumentation | undefined =
    ResourceUtil.getResources().find((candidate: ModelDocumentation) => {
      return candidate.model.constructor === modelType;
    });

  if (!resource) {
    throw new Error(`${modelType.name} has no page`);
  }

  return resource;
}

describe("the Required badge on a resource's page", () => {
  let detectionRule: Dictionary<PageColumn>;
  let monitor: Dictionary<PageColumn>;

  beforeAll(async () => {
    detectionRule = await pageColumns(resourceOf(DetectionRule));
    monitor = await pageColumns(resourceOf(Monitor));
  }, 120000);

  it("is not on a required column a create may leave out for its default: a detection rule's Enabled", () => {
    const enabled: PageColumn = detectionRule["isEnabled"]!;

    // The database requires it, and a create leaves it to its default (#5158).
    expect(enabled.required).toBe(true);
    expect(enabled.isDefaultValueColumn).toBe(true);
    expect(enabled.requiredOnCreate).toBe(false);
    expect(enabled.documentedDefault).toBe("true");
  });

  it("is on the columns a create must send", () => {
    expect(detectionRule["name"]?.requiredOnCreate).toBe(true);
    expect(monitor["name"]?.requiredOnCreate).toBe(true);
    expect(monitor["name"]?.documentedDefault).toBeNull();
  });

  it("is not on the project id, which the API key gives, or on the id and the dates", () => {
    expect(monitor["projectId"]?.required).toBe(true);
    expect(monitor["projectId"]?.requiredOnCreate).toBe(false);

    for (const key of ["_id", "createdAt", "updatedAt"]) {
      expect([key, monitor[key]?.requiredOnCreate ?? false]).toEqual([
        key,
        false,
      ]);
    }
  });

  it("shows a monitor's switches as optional, with the default a create stores", () => {
    const switches: Array<string> = Object.keys(monitor).filter(
      (key: string): boolean => {
        const column: PageColumn = monitor[key]!;

        return (
          column.type === TableColumnType.Boolean &&
          column.required === true &&
          column.isDefaultValueColumn === true
        );
      },
    );

    expect(switches.length).toBeGreaterThan(0);

    for (const key of switches) {
      expect([key, monitor[key]!.requiredOnCreate]).toEqual([key, false]);
      expect([key, monitor[key]!.documentedDefault]).toEqual([
        key,
        JSON.stringify(monitor[key]!.defaultValue),
      ]);
    }
  });

  it("on every resource: only what the create schema requires, never a column with a default, a slug or the project id", async () => {
    const wrong: Array<string> = [];

    for (const resource of ResourceUtil.getResources()) {
      if (resource.isAnalytics) {
        continue;
      }

      const columns: Dictionary<PageColumn> = await pageColumns(resource);
      const required: Set<string> = new Set<string>(
        getColumnsRequiredOnCreate(
          (resource.model as BaseModel).constructor as DatabaseBaseModelType,
        ),
      );

      for (const key of Object.keys(columns)) {
        const column: PageColumn = columns[key]!;

        if (column.requiredOnCreate !== required.has(key)) {
          wrong.push(`${resource.path}.${key}: page and create schema differ`);
        }

        if (!column.requiredOnCreate) {
          continue;
        }

        if (
          column.isDefaultValueColumn ||
          (column.defaultValue !== undefined && column.defaultValue !== null)
        ) {
          wrong.push(`${resource.path}.${key}: has a default`);
        }

        if (column.type === TableColumnType.Slug) {
          wrong.push(`${resource.path}.${key}: is a slug`);
        }

        if (key === "projectId") {
          wrong.push(`${resource.path}.${key}: is the project id`);
        }
      }
    }

    expect(wrong).toEqual([]);
  }, 600000);

  it("on an analytics resource, nothing a create cannot send", async () => {
    for (const resource of ResourceUtil.getResources()) {
      if (!resource.isAnalytics) {
        continue;
      }

      const required: Set<string> = getColumnsRequiredOnCreateForDocumentation(
        resource.model,
        true,
      );

      for (const key of required) {
        expect([
          resource.path,
          key,
          resource.model.getColumnAccessControlFor(key)?.create.length || 0,
        ]).not.toEqual([resource.path, key, 0]);
      }
    }
  });
});

describe("a column's documented default", () => {
  it("is its declared text, number or switch value, as JSON", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new DetectionRule(),
    );

    expect(getDocumentedDefaultValue(columns["isEnabled"]!)).toBe("true");
    expect(getDocumentedDefaultValue(columns["name"]!)).toBeNull();
    expect(
      getDocumentedDefaultValue({
        type: TableColumnType.ShortText,
        defaultValue: "Medium",
      }),
    ).toBe('"Medium"');
    expect(
      getDocumentedDefaultValue({
        type: TableColumnType.Number,
        defaultValue: 0,
      }),
    ).toBe("0");
    // An object default is the example's to show.
    expect(
      getDocumentedDefaultValue({
        type: TableColumnType.JSON,
        defaultValue: { a: 1 },
      }),
    ).toBeNull();
  });
});

describe("the page as it is drawn", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderPage(PAGE_FIXTURES["model"]!);
  });

  // The list item of one column on the page.
  const item: (key: string) => string = (key: string): string => {
    const start: number = html.indexOf(
      `<code class="model-inline-code">${key}</code>`,
    );

    expect(start).toBeGreaterThan(-1);

    const end: number = html.indexOf("</li>", start);

    return html.slice(start, end);
  };

  it("badges Required only what a create must send", () => {
    expect(item("name")).toContain(">Required<");
    expect(item("_id")).not.toContain(">Required<");
    expect(item("disableActiveMonitoring")).not.toContain(">Required<");
  });

  it("names the default beside a column that has one", () => {
    expect(item("disableActiveMonitoring")).toContain(
      'Default <code class="font-mono text-ink">false</code>',
    );
    expect(item("name")).not.toContain("Default");
  });

  /*
   * The badges sit in the column's type line, which is set in the code
   * font: they are the page's words, so they carry its own font, and only
   * the default's value is code (fu-platform's review).
   */
  it("draws both badges in the page's font, and only the default's value as code", () => {
    const required: string = item("name");
    const requiredBadge: string = required.slice(
      required.lastIndexOf("<span", required.indexOf(">Required<")),
      required.indexOf(">Required<"),
    );
    expect(requiredBadge).toContain("font-sans");

    const withDefault: string = item("disableActiveMonitoring");
    const defaultBadge: string = withDefault.slice(
      withDefault.lastIndexOf("<span", withDefault.indexOf("Default <code")),
      withDefault.indexOf("Default <code"),
    );
    expect(defaultBadge).toContain("font-sans");
  });
});
