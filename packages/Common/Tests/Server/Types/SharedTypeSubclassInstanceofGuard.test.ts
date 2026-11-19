import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO CODE ASKS WHETHER A VALUE IS AN INSTANCE OF ITS OWN SUBCLASS OF A TYPE
 * THE API READS JSON INTO (#9997).
 *
 * The API reads typed JSON - { "_type": "Domain", "value": "customer.com" }
 * - back as the shared class in Common/Types (SerializableObjectDictionary,
 * through JSONFunctions.deserialize), and a request's model as the shared
 * model (BaseModel.fromJSON). The database hands its columns back as the
 * shared class too (each type's fromDatabase). A class that extends one of
 * those types elsewhere - Common/Server/Types/Domain extends
 * Common/Types/Domain, to add DNS and HTTP checks - is never what a request
 * or a row holds. So `value instanceof <the subclass>` is false for every
 * value the Dashboard and the API send. DomainService asked exactly that,
 * and refused every domain Add Custom Domain added to a project with
 * "Domain must be a string or an instance of Domain." Its tests built the
 * server's subclass by hand, so they passed.
 *
 * This reads every file of the product (packages and ee, migrations
 * included; tests left out) and refuses `instanceof` against a subclass of
 * a type the API reads JSON into. Ask the shared class instead - or better,
 * read the value whatever form it came in, as Domain.getNameFrom reads a
 * domain's name.
 *
 * Read with a small scanner rather than the TypeScript compiler: it walks
 * every file of the product, and needs only imports, class headers and
 * instanceof.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SCAN_ROOTS: ReadonlyArray<string> = ["packages", "ee"];

// Folders that hold no product code.
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "dist",
  "build",
  "Tests",
  "__tests__",
  "__mocks__",
  ".git",
  ".expo",
  "dist-ui",
  "coverage",
]);

// The file that maps each JSON `_type` to the class the API reads it into.
const DICTIONARY_FILE: string =
  "packages/Common/Types/SerializableObjectDictionary.ts";

// Types that join that dictionary as their module loads (joinSerializableObjectDictionary).
const JOINED_TYPE_FILES: ReadonlyArray<string> = [
  "packages/Common/Types/Monitor/MonitorCriteria.ts",
  "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
  "packages/Common/Types/Monitor/MonitorStep.ts",
  "packages/Common/Types/Monitor/MonitorSteps.ts",
];

// The models a request's body is read into (BaseModel.fromJSON).
const MODEL_FOLDERS: ReadonlyArray<string> = [
  "packages/Common/Models/DatabaseModels",
  "packages/Common/Models/AnalyticsModels",
];

// Where the shared types themselves live: a class there is one of them.
const SHARED_FOLDERS: ReadonlyArray<string> = [
  "packages/Common/Types/",
  "packages/Common/Models/",
];

const TEST_FILE_NAME: RegExp = /\.(test|spec)\.tsx?$/;

const IMPORT_STATEMENT: RegExp =
  /import\s+(type\s+)?([^'";]*?)\s+from\s+["']([^"']+)["']/g;

const CLASS_HEADER: RegExp =
  /class\s+([A-Za-z_$][\w$]*)\s*(?:<[^{]*?>)?\s+extends\s+([A-Za-z_$][\w$]*)/g;

const INSTANCEOF: RegExp = /instanceof\s+([A-Za-z_$][\w$]*)/g;

const NAMED_IMPORT_SEPARATOR: RegExp = /\s+as\s+/;

const toPosix: (file: string) => string = (file: string): string => {
  return file.split(path.sep).join("/");
};

// Every product file under the scan roots, relative to the repository root.
const listProductFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];

  const walk: (relative: string) => void = (relative: string): void => {
    let entries: Array<fs.Dirent> = [];

    try {
      entries = fs.readdirSync(path.join(REPOSITORY_ROOT, relative), {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      const child: string = `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          walk(child);
        }
        continue;
      }

      if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".d.ts") &&
        !TEST_FILE_NAME.test(entry.name)
      ) {
        files.push(child);
      }
    }
  };

  for (const root of SCAN_ROOTS) {
    walk(root);
  }

  return files.sort();
};

const isFile: (relative: string) => boolean = (relative: string): boolean => {
  try {
    return fs.statSync(path.join(REPOSITORY_ROOT, relative)).isFile();
  } catch {
    return false;
  }
};

/*
 * The product file an import names, relative to the repository root: a
 * relative path, or Common/... as the App and ee name Common's files.
 * Null for a package from node_modules.
 */
const resolveImport: (fromFile: string, specifier: string) => string | null = (
  fromFile: string,
  specifier: string,
): string | null => {
  let base: string;

  if (specifier.startsWith(".")) {
    base = toPosix(path.posix.join(path.posix.dirname(fromFile), specifier));
  } else if (specifier.startsWith("Common/")) {
    base = `packages/${specifier}`;
  } else {
    return null;
  }

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/Index.ts`,
    `${base}/index.ts`,
  ]) {
    if (isFile(candidate)) {
      return candidate;
    }
  }

  return null;
};

// Each name a file imports a value as, with the file it comes from.
const readImports: (file: string, source: string) => Map<string, string> = (
  file: string,
  source: string,
): Map<string, string> => {
  const imports: Map<string, string> = new Map<string, string>();

  for (const match of source.matchAll(IMPORT_STATEMENT)) {
    // A type-only import names no value instanceof could test.
    if (match[1]) {
      continue;
    }

    const resolved: string | null = resolveImport(file, match[3] as string);

    if (!resolved) {
      continue;
    }

    const clause: string = (match[2] as string).trim();
    const braceAt: number = clause.indexOf("{");
    const defaultName: string = (
      braceAt === -1 ? clause : clause.slice(0, braceAt)
    )
      .replace(",", "")
      .trim();

    if (defaultName && !defaultName.startsWith("*")) {
      imports.set(defaultName, resolved);
    }

    if (braceAt !== -1) {
      const named: string = clause.slice(braceAt + 1, clause.indexOf("}"));

      for (const part of named.split(",")) {
        const pieces: Array<string> = part
          .replace(/^\s*type\s+/, "")
          .trim()
          .split(NAMED_IMPORT_SEPARATOR);
        const localName: string = (pieces[1] || pieces[0] || "").trim();

        if (localName) {
          imports.set(localName, resolved);
        }
      }
    }
  }

  return imports;
};

// The files of the types the API reads JSON, or a request's model, into.
const readDeserializedTypeFiles: () => Set<string> = (): Set<string> => {
  const files: Set<string> = new Set<string>(JOINED_TYPE_FILES);

  const dictionary: string = fs.readFileSync(
    path.join(REPOSITORY_ROOT, DICTIONARY_FILE),
    "utf8",
  );

  for (const resolved of readImports(DICTIONARY_FILE, dictionary).values()) {
    files.add(resolved);
  }

  for (const file of listProductFiles()) {
    if (
      MODEL_FOLDERS.some((folder: string): boolean => {
        return file.startsWith(`${folder}/`);
      })
    ) {
      files.add(file);
    }
  }

  return files;
};

interface SubclassOfSharedType {
  file: string;
  className: string;
  // The file of the shared type, or of the subclass, it extends.
  extendsFile: string;
}

/*
 * Every class outside the shared folders that extends a type the API reads
 * JSON into - or extends such a class in turn.
 */
const findSubclassesOfSharedTypes: (data: {
  sources: Map<string, string>;
  sharedTypeFiles: Set<string>;
}) => Array<SubclassOfSharedType> = (data: {
  sources: Map<string, string>;
  sharedTypeFiles: Set<string>;
}): Array<SubclassOfSharedType> => {
  const found: Map<string, SubclassOfSharedType> = new Map<
    string,
    SubclassOfSharedType
  >();
  const extendable: Set<string> = new Set<string>(data.sharedTypeFiles);

  let isGrowing: boolean = true;

  while (isGrowing) {
    isGrowing = false;

    for (const [file, source] of data.sources) {
      if (
        SHARED_FOLDERS.some((folder: string): boolean => {
          return file.startsWith(folder);
        })
      ) {
        continue;
      }

      const imports: Map<string, string> = readImports(file, source);

      for (const match of source.matchAll(CLASS_HEADER)) {
        const baseFile: string | undefined = imports.get(match[2] as string);

        if (!baseFile || !extendable.has(baseFile)) {
          continue;
        }

        const key: string = `${file}#${match[1] as string}`;

        if (found.has(key)) {
          continue;
        }

        found.set(key, {
          file: file,
          className: match[1] as string,
          extendsFile: baseFile,
        });
        extendable.add(file);
        isGrowing = true;
      }
    }
  }

  return [...found.values()].sort(
    (a: SubclassOfSharedType, b: SubclassOfSharedType): number => {
      return a.file.localeCompare(b.file);
    },
  );
};

interface InstanceofOfSubclass {
  file: string;
  line: number;
  name: string;
  subclassFile: string;
}

// Each `instanceof X` in `source` whose X is imported from a subclass's file.
const findInstanceofOfSubclasses: (data: {
  file: string;
  source: string;
  subclassFiles: Set<string>;
}) => Array<InstanceofOfSubclass> = (data: {
  file: string;
  source: string;
  subclassFiles: Set<string>;
}): Array<InstanceofOfSubclass> => {
  const imports: Map<string, string> = readImports(data.file, data.source);
  const found: Array<InstanceofOfSubclass> = [];

  for (const match of data.source.matchAll(INSTANCEOF)) {
    const importedFrom: string | undefined = imports.get(match[1] as string);

    if (!importedFrom || !data.subclassFiles.has(importedFrom)) {
      continue;
    }

    found.push({
      file: data.file,
      line: data.source.slice(0, match.index).split("\n").length,
      name: match[1] as string,
      subclassFile: importedFrom,
    });
  }

  return found;
};

const readSources: (files: Array<string>) => Map<string, string> = (
  files: Array<string>,
): Map<string, string> => {
  const sources: Map<string, string> = new Map<string, string>();

  for (const file of files) {
    sources.set(
      file,
      fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    );
  }

  return sources;
};

describe("instanceof against a subclass of a type the API reads JSON into", () => {
  const sources: Map<string, string> = readSources(listProductFiles());
  const sharedTypeFiles: Set<string> = readDeserializedTypeFiles();
  const subclasses: Array<SubclassOfSharedType> = findSubclassesOfSharedTypes({
    sources: sources,
    sharedTypeFiles: sharedTypeFiles,
  });
  const subclassFiles: Set<string> = new Set<string>(
    subclasses.map((subclass: SubclassOfSharedType): string => {
      return subclass.file;
    }),
  );

  test("the scan reads the types the API reads JSON into, Domain's among them", () => {
    expect(sharedTypeFiles.has("packages/Common/Types/Domain.ts")).toBe(true);
    expect(sharedTypeFiles.has("packages/Common/Types/Email.ts")).toBe(true);
    expect(
      sharedTypeFiles.has("packages/Common/Models/DatabaseModels/Domain.ts"),
    ).toBe(true);
    expect(
      sharedTypeFiles.has("packages/Common/Types/Monitor/MonitorStep.ts"),
    ).toBe(true);
  });

  test("the scan finds the server's subclass of Domain, which no request or row ever holds", () => {
    expect(subclasses).toContainEqual({
      file: "packages/Common/Server/Types/Domain.ts",
      className: "Domain",
      extendsFile: "packages/Common/Types/Domain.ts",
    });
  });

  test("no product code asks whether a value is an instance of one", () => {
    const found: Array<string> = [];

    for (const [file, source] of sources) {
      for (const use of findInstanceofOfSubclasses({
        file: file,
        source: source,
        subclassFiles: subclassFiles,
      })) {
        found.push(
          `${use.file}:${use.line} instanceof ${use.name} (${use.subclassFile}): a value from the API or the database is never one. Read it whatever form it came in - for a domain, Domain.getNameFrom.`,
        );
      }
    }

    expect(found).toEqual([]);
  });

  test("the check DomainService made is found, and a check against the shared class is not", () => {
    // DomainService's create hook, as it was before #9997.
    const asItWas: string = [
      'import Domain from "../Types/Domain";',
      "",
      "if (createBy.data.domain instanceof Domain) {",
      "  domain = createBy.data.domain.toString();",
      "}",
    ].join("\n");

    expect(
      findInstanceofOfSubclasses({
        file: "packages/Common/Server/Services/DomainService.ts",
        source: asItWas,
        subclassFiles: subclassFiles,
      }),
    ).toEqual([
      {
        file: "packages/Common/Server/Services/DomainService.ts",
        line: 3,
        name: "Domain",
        subclassFile: "packages/Common/Server/Types/Domain.ts",
      },
    ]);

    // The same check against the class the API reads JSON into is sound.
    const againstTheSharedClass: string = asItWas.replace(
      '"../Types/Domain"',
      '"../../Types/Domain"',
    );

    expect(
      findInstanceofOfSubclasses({
        file: "packages/Common/Server/Services/DomainService.ts",
        source: againstTheSharedClass,
        subclassFiles: subclassFiles,
      }),
    ).toEqual([]);

    // And from the App, which names Common's files as Common/...
    const fromTheApp: string = asItWas.replace(
      '"../Types/Domain"',
      '"Common/Server/Types/Domain"',
    );

    expect(
      findInstanceofOfSubclasses({
        file: "packages/App/FeatureSet/Workers/DataMigrations/Example.ts",
        source: fromTheApp,
        subclassFiles: subclassFiles,
      }),
    ).toHaveLength(1);
  });

  test("a subclass of a subclass is found too, and a named or renamed import of it", () => {
    const sharedOnly: Set<string> = new Set<string>([
      "packages/Common/Types/Domain.ts",
    ]);

    const found: Array<SubclassOfSharedType> = findSubclassesOfSharedTypes({
      sources: new Map<string, string>([
        [
          "packages/Common/Server/Types/Domain.ts",
          'import DomainCommon from "../../Types/Domain";\nexport default class Domain extends DomainCommon {}',
        ],
        [
          "packages/Common/Server/Utils/Example.ts",
          'import ServerDomain from "../Types/Domain";\nexport class CheckedDomain extends ServerDomain {}',
        ],
      ]),
      sharedTypeFiles: sharedOnly,
    });

    expect(
      found.map((subclass: SubclassOfSharedType): string => {
        return `${subclass.file}#${subclass.className}`;
      }),
    ).toEqual([
      "packages/Common/Server/Types/Domain.ts#Domain",
      "packages/Common/Server/Utils/Example.ts#CheckedDomain",
    ]);

    expect(
      findInstanceofOfSubclasses({
        file: "packages/Common/Server/Services/Example.ts",
        source:
          'import { default as Named } from "../Types/Domain";\nimport Plain, { Other as Renamed } from "../Types/Domain";\nif (a instanceof Named || b instanceof Plain || c instanceof Renamed) {}',
        subclassFiles: new Set<string>([
          "packages/Common/Server/Types/Domain.ts",
        ]),
      }).map((use: InstanceofOfSubclass): string => {
        return use.name;
      }),
    ).toEqual(["Named", "Plain", "Renamed"]);
  });
});
