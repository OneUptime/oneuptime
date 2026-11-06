import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5803: Guard test ensuring every database model declaring @CrudApiEndpoint
 * has an active router mounted in packages/App/FeatureSet/BaseAPI/Index.ts.
 *
 * Models left out of BaseAPI/Index.ts compile fine but return 404 when called from
 * the dashboard or external clients.
 *
 * Known and documented exceptions:
 * 1. EnterpriseLicense: Mounted in ee/Server/LicenseServer/Index.ts when enterprise billing is active.
 * 2. EnterpriseLicenseInstance: Mounted in ee/Server/LicenseServer/Index.ts when enterprise billing is active.
 * 3. StatusPagePrivateUserSession: Internal status page session model with no public CRUD API.
 * 4. UserSession: Holds internal session state; no client CRUD API route is mounted.
 */

const APP_DIR: string = path.join(__dirname, "../..");
const ROOT_DIR: string = path.join(APP_DIR, "../..");

export const UNMOUNTED_CRUD_API_EXCEPTIONS: Record<string, string> = {
  EnterpriseLicense:
    "Mounted in ee/Server/LicenseServer/Index.ts when enterprise billing is active.",
  EnterpriseLicenseInstance:
    "Mounted in ee/Server/LicenseServer/Index.ts when enterprise billing is active.",
  StatusPagePrivateUserSession:
    "Internal status page session model with no public client CRUD route.",
  UserSession:
    "Holds sensitive user session state; no client CRUD route is mounted.",
};

interface ModelImport {
  alias: string;
  actual: string;
}

interface ParsedImports {
  models: Array<ModelImport>;
  apis: Array<{ alias: string; actual: string }>;
}

function parseImports(fileContent: string): ParsedImports {
  const models: Array<ModelImport> = [];
  const apis: Array<{ alias: string; actual: string }> = [];

  const statements: Array<string> =
    fileContent.match(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g) || [];

  for (const statement of statements) {
    const fromMatch: RegExpMatchArray | null = statement.match(
      /from\s+["']([^"']+)["'];/,
    );
    if (!fromMatch || !fromMatch[1]) {
      continue;
    }
    const modulePath: string = fromMatch[1];

    // Model import
    const modelPathMatch: RegExpMatchArray | null = modulePath.match(
      /(?:Common\/Models\/|\.\.\/\.\.\/Models\/)DatabaseModels\/([A-Za-z0-9_]+)$/,
    );
    if (modelPathMatch && modelPathMatch[1]) {
      const modelFile: string = modelPathMatch[1];

      // Default import identifier
      const defaultMatch: RegExpMatchArray | null = statement.match(
        /import\s+([A-Za-z0-9_]+)(?:\s*,|\s+from)/,
      );
      if (defaultMatch && defaultMatch[1]) {
        models.push({ alias: defaultMatch[1], actual: modelFile });
      }

      // Named imports
      const namedMatch: RegExpMatchArray | null =
        statement.match(/\{([\s\S]*?)\}/);
      if (namedMatch && namedMatch[1]) {
        const names: Array<string> = namedMatch[1]
          .split(",")
          .map((s: string): string => {
            return s.trim();
          })
          .filter(Boolean);
        for (const name of names) {
          const parts: Array<string> = name.split(/\s+as\s+/);
          const alias: string =
            parts.length > 1 ? parts[1]!.trim() : parts[0]!.trim();
          const orig: string = parts[0]!.trim();
          models.push({ alias, actual: orig || modelFile });
        }
      }
    }

    // API import in BaseAPI/Index.ts
    const apiPathMatch: RegExpMatchArray | null = modulePath.match(
      /(?:Common\/Server\/API\/|\.\/)([A-Za-z0-9_]+)$/,
    );
    if (apiPathMatch && apiPathMatch[1]) {
      const apiFile: string = apiPathMatch[1];
      const defaultMatch: RegExpMatchArray | null = statement.match(
        /import\s+([A-Za-z0-9_]+)(?:\s*,|\s+from)/,
      );
      if (defaultMatch && defaultMatch[1]) {
        apis.push({ alias: defaultMatch[1], actual: apiFile });
      }
    }
  }

  return { models, apis };
}

export function getUnmountedCrudApiModels(options?: {
  baseApiContent?: string;
}): Array<string> {
  const baseApiIndex: string =
    options?.baseApiContent ??
    fs.readFileSync(path.join(APP_DIR, "FeatureSet/BaseAPI/Index.ts"), "utf8");

  const baseApiImports: ParsedImports = parseImports(baseApiIndex);
  const actualModelToAliases: Map<string, Set<string>> = new Map();
  const apiFileToImportedName: Map<string, string> = new Map();

  for (const imp of baseApiImports.models) {
    if (!actualModelToAliases.has(imp.actual)) {
      actualModelToAliases.set(imp.actual, new Set());
    }
    actualModelToAliases.get(imp.actual)!.add(imp.alias);
  }

  for (const imp of baseApiImports.apis) {
    apiFileToImportedName.set(imp.actual, imp.alias);
  }

  // Read all custom API files
  const apiDirs: Array<string> = [
    path.join(ROOT_DIR, "packages/Common/Server/API"),
    path.join(ROOT_DIR, "packages/App/FeatureSet/BaseAPI"),
  ];

  const customApis: Array<{ name: string; content: string }> = [];
  for (const dir of apiDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".ts")) {
        const content: string = fs.readFileSync(path.join(dir, f), "utf8");
        customApis.push({ name: f.replace(".ts", ""), content });
      }
    }
  }

  // Map each custom API to the models it serves
  const apiServesModels: Map<string, Set<string>> = new Map();
  for (const api of customApis) {
    const served: Set<string> = new Set();
    const apiImports: ParsedImports = parseImports(api.content);
    const clean: string = api.content.replace(/\s+/g, "");

    for (const imp of apiImports.models) {
      const alias: string = imp.alias;
      if (
        clean.includes("extendsBaseAPI<" + alias + ",") ||
        clean.includes("extendsArchivableValueAPI<" + alias + ",") ||
        clean.includes("extendsCustomFieldDefinitionAPI<" + alias + ",") ||
        clean.includes("super(" + alias + ",") ||
        clean.includes("newBaseAPI<" + alias + ",") ||
        clean.includes("entityType=" + alias + ";")
      ) {
        served.add(imp.actual);
      }
    }
    if (served.size > 0) {
      apiServesModels.set(api.name, served);
    }
  }

  // Determine which custom APIs are mounted in BaseAPI/Index.ts
  const cleanBaseApi: string = baseApiIndex.replace(/\s+/g, "");
  const mountedCustomApis: Set<string> = new Set();

  for (const api of customApis) {
    const importedName: string =
      apiFileToImportedName.get(api.name) || api.name;
    if (
      cleanBaseApi.includes("new" + importedName + "()") ||
      cleanBaseApi.includes(importedName + ".getRouter()") ||
      cleanBaseApi.includes(importedName + ",") ||
      cleanBaseApi.includes(importedName + ")")
    ) {
      mountedCustomApis.add(api.name);
    }
  }

  // Get all models in DatabaseModels that declare crudApiPath
  const modelsWithCrudEndpoint: Array<{ name: string; fileCandidate: string }> =
    [];
  for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
    try {
      const model: BaseModel = new modelType();
      if (model.crudApiPath) {
        modelsWithCrudEndpoint.push({
          name: modelType.name,
          fileCandidate: model.tableName || modelType.name,
        });
      }
    } catch {
      // Non-instantiable or non-database model
    }
  }

  const unmounted: Array<string> = [];

  for (const { name: modelName, fileCandidate } of modelsWithCrudEndpoint) {
    if (
      UNMOUNTED_CRUD_API_EXCEPTIONS[modelName] ||
      UNMOUNTED_CRUD_API_EXCEPTIONS[fileCandidate]
    ) {
      continue;
    }

    const aliases: Set<string> = new Set([modelName, fileCandidate]);

    // Add any aliases imported from the model file
    for (const [
      actualFile,
      importedAliases,
    ] of actualModelToAliases.entries()) {
      if (
        actualFile.toLowerCase() === modelName.toLowerCase() ||
        actualFile.toLowerCase() === fileCandidate.toLowerCase()
      ) {
        for (const alias of importedAliases) {
          aliases.add(alias);
        }
      }
    }

    let isMounted: boolean = false;

    // 1. Direct mount in BaseAPI/Index.ts
    for (const alias of aliases) {
      if (
        cleanBaseApi.includes("newBaseAPI<" + alias + ",") ||
        cleanBaseApi.includes("newArchivableValueAPI<" + alias + ",") ||
        cleanBaseApi.includes("newCustomFieldDefinitionAPI<" + alias + ",")
      ) {
        isMounted = true;
        break;
      }
    }

    // 2. Mounted via a custom API class
    if (!isMounted) {
      for (const apiName of mountedCustomApis) {
        const modelsForApi: Set<string> | undefined =
          apiServesModels.get(apiName);
        if (modelsForApi) {
          for (const target of aliases) {
            for (const served of modelsForApi) {
              if (served.toLowerCase() === target.toLowerCase()) {
                isMounted = true;
                break;
              }
            }
            if (isMounted) {
              break;
            }
          }
        }
        if (isMounted) {
          break;
        }
      }
    }

    if (!isMounted) {
      unmounted.push(modelName);
    }
  }

  return unmounted;
}

describe("CrudApiEndpoint route mount guard (#5803)", () => {
  test("every model declaring @CrudApiEndpoint is mounted in BaseAPI/Index.ts", () => {
    const unmountedModels: Array<string> = getUnmountedCrudApiModels();

    expect(unmountedModels).toEqual([]);
  });

  test("the guard catches an unmounted model when a mount is missing", () => {
    const realBaseApi: string = fs.readFileSync(
      path.join(APP_DIR, "FeatureSet/BaseAPI/Index.ts"),
      "utf8",
    );

    // Simulate removing VMwareVCenterConnectionTest mount
    const mutatedBaseApi: string = realBaseApi.replace(
      /new\s+BaseAPI<\s*VMwareVCenterConnectionTest[\s\S]*?\.getRouter\(\),?/,
      "",
    );

    const unmounted: Array<string> = getUnmountedCrudApiModels({
      baseApiContent: mutatedBaseApi,
    });

    expect(unmounted).toContain("VMwareVCenterConnectionTest");
  });
});
