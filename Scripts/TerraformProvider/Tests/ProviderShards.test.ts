/*
 * The generated resources and data sources are split into packages of their
 * own, internal/provider/shard00 and on, so no compile of the provider holds
 * them all (#7591, Core/ProviderShards.ts): compiled as one package of some
 * 1,000 files, they took the Go compiler more than 11 GiB, near the 16 GB of
 * a CI runner.
 *
 * These pin how a file finds its shard (the FNV-1a hash of its name, so it
 * stays there as others come and go), what a shard hands to the provider
 * package, the package that links them all, and the check that stops a
 * generation whose shard has grown too large - then, through a generation
 * of the fixture spec, that every generated file is in its shard and every
 * resource and data source keeps its place in the provider's lists.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { GoModuleGenerator } from "../Core/GoModuleGenerator";
import { FileGenerator } from "../Core/FileGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { HANDWRITTEN_RESOURCES } from "../Core/HandwrittenResources";
import { StringUtils } from "../Core/StringUtils";
import {
  MAX_SHARD_BYTES,
  PROVIDER_PACKAGE_DIR,
  SHARD_COUNT,
  checkShardSizes,
  fnv1a32,
  generatedFilePath,
  providerDotImport,
  shardName,
  shardNames,
  shardOf,
  shardRegistrationFile,
  shardSizes,
  writeAllShardsPackage,
} from "../Core/ProviderShards";
import {
  TerraformDataSource,
  TerraformProviderConfig,
  TerraformResource,
} from "../Core/Types";
import { buildFixtureSpec } from "./Fixtures";

const MODULE: string = "github.com/oneuptime/terraform-provider-oneuptime";

describe("fnv1a32", () => {
  // The published test vectors of 32-bit FNV-1a.
  test.each([
    ["", 0x811c9dc5],
    ["a", 0xe40c292c],
    ["foobar", 0xbf9cf968],
  ])("hashes %j as FNV-1a does", (text: string, hash: number) => {
    expect(fnv1a32(text)).toBe(hash);
  });

  test("hashes a name's UTF-8 bytes, not its UTF-16 code units", () => {
    // "é" is C3 A9 in UTF-8, and the one code unit E9 in UTF-16.
    expect(fnv1a32("é")).toBe(0x1e9de8c1);
  });
});

describe("the shards", () => {
  test("are SHARD_COUNT packages, named with two digits", () => {
    expect(SHARD_COUNT).toBe(32);
    expect(shardNames()).toHaveLength(SHARD_COUNT);
    expect(new Set(shardNames()).size).toBe(SHARD_COUNT);
    expect(shardName(0)).toBe("shard00");
    expect(shardName(7)).toBe("shard07");
    expect(shardNames()[SHARD_COUNT - 1]).toBe("shard31");
  });

  test("a file's shard is its name's hash, modulo their count", () => {
    for (const fileName of [
      "resource_monitor.go",
      "data_source_monitor.go",
      "resource_on_call_duty_policy.go",
    ]) {
      expect(shardOf(fileName)).toBe(
        shardName(fnv1a32(fileName) % SHARD_COUNT),
      );
    }
  });

  /*
   * Pinned: a change of the hash or of SHARD_COUNT moves files between
   * shards, every one of them in the provider's repository, so it is one to
   * make on purpose.
   */
  test("keeps each file where it is", () => {
    expect({
      monitor: shardOf("resource_monitor.go"),
      incident: shardOf("resource_incident.go"),
      statusPage: shardOf("data_source_status_page.go"),
    }).toEqual({
      monitor: "shard08",
      incident: "shard16",
      statusPage: "shard00",
    });
  });

  test("a generated file's path is in its shard's folder", () => {
    expect(generatedFilePath("resource_monitor.go")).toBe(
      `internal/provider/${shardOf("resource_monitor.go")}/resource_monitor.go`,
    );
  });

  test("spread a thousand names over every shard", () => {
    const counts: Map<string, number> = new Map();
    for (let index: number = 0; index < 1000; index++) {
      const shard: string = shardOf(`resource_thing_${index}.go`);
      counts.set(shard, (counts.get(shard) || 0) + 1);
    }

    expect(counts.size).toBe(SHARD_COUNT);
    expect(Math.max(...counts.values())).toBeLessThan(2 * (1000 / 32));
  });
});

describe("shardRegistrationFile", () => {
  test("hands the shard's resources to the provider package, in their places, with their aliases", () => {
    expect(
      shardRegistrationFile({
        shard: "shard07",
        goModuleName: MODULE,
        kind: "Resources",
        entries: [
          { order: 3, constructor: "NewTeamResource" },
          { order: 40, constructor: "NewTeamLegacyResource" },
        ],
        aliases: [
          {
            order: 3,
            name: "team",
            legacyName: "old_team",
            constructor: "NewTeamResource",
            legacyConstructor: "NewTeamLegacyResource",
          },
        ],
      }),
    ).toBe(`package shard07

import (
    . "${MODULE}/internal/provider"
)

// The resources this package holds, handed to internal/provider with their
// places among the provider's, and the deprecated aliases among them (its
// shards.go).
func init() {
    RegisterResources("shard07", []OrderedResource{
        {Order: 3, New: NewTeamResource},
        {Order: 40, New: NewTeamLegacyResource},
    }, []LegacyResourceAlias{
        {Order: 3, Name: "team", LegacyName: "old_team", New: NewTeamResource, NewLegacy: NewTeamLegacyResource},
    })
}
`);
  });

  test("hands over nothing from a shard with no data sources, so the provider still counts it", () => {
    const file: string = shardRegistrationFile({
      shard: "shard30",
      goModuleName: MODULE,
      kind: "DataSources",
      entries: [],
      aliases: [],
    });

    expect(file).toContain('    RegisterDataSources("shard30", nil, nil)');
    expect(file).toContain("// The data sources this package holds");
  });
});

describe("writeAllShardsPackage", () => {
  test("writes internal/provider/all, which imports every shard", async () => {
    const outputDir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "tfgen-all-"),
    );
    try {
      await writeAllShardsPackage(new FileGenerator(outputDir), MODULE);
      const all: string = fs.readFileSync(
        path.join(outputDir, "internal/provider/all/all.go"),
        "utf-8",
      );

      expect(all).toContain("\npackage all\n");
      for (const shard of shardNames()) {
        expect(all).toContain(`    _ "${MODULE}/internal/provider/${shard}"\n`);
      }
      expect(all.match(/^ {4}_ "/gm)).toHaveLength(SHARD_COUNT);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe("checkShardSizes", () => {
  let providerDir: string;

  function writeGo(shard: string, fileName: string, bytes: number): void {
    const directory: string = path.join(
      providerDir,
      PROVIDER_PACKAGE_DIR,
      shard,
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, fileName), "x".repeat(bytes));
  }

  beforeEach(() => {
    providerDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-sizes-"));
  });

  afterEach(() => {
    fs.rmSync(providerDir, { recursive: true, force: true });
  });

  test("counts each shard's Go files and their bytes, and nothing else", () => {
    writeGo("shard00", "resource_a.go", 100);
    writeGo("shard00", "data_source_a.go", 50);
    writeGo("shard00", "notes.txt", 1000);
    writeGo("shard05", "resource_b.go", 7);

    const sizes: Map<string, { bytes: number; files: number }> = new Map(
      shardSizes(providerDir).map(
        (size: { shard: string; bytes: number; files: number }) => {
          return [size.shard, { bytes: size.bytes, files: size.files }];
        },
      ),
    );

    expect(sizes.size).toBe(SHARD_COUNT);
    expect(sizes.get("shard00")).toEqual({ bytes: 150, files: 2 });
    expect(sizes.get("shard05")).toEqual({ bytes: 7, files: 1 });
    expect(sizes.get("shard31")).toEqual({ bytes: 0, files: 0 });
  });

  test("lets a generation whose shards are small enough go on", () => {
    writeGo("shard03", "resource_a.go", 1000);

    expect(() => {
      checkShardSizes(providerDir, 1000);
    }).not.toThrow();
  });

  test("stops one whose shard has grown too large, saying which and what to raise", () => {
    writeGo("shard03", "resource_a.go", 600);
    writeGo("shard03", "resource_b.go", 600);

    expect(() => {
      checkShardSizes(providerDir, 1000);
    }).toThrow(
      /internal\/provider\/shard03 holds 0\.0 MiB of Go in 2 files: more than the 0\.0 MiB a shard may hold .* Raise SHARD_COUNT in Scripts\/TerraformProvider\/Core\/ProviderShards\.ts\./,
    );
  });

  test("allows a shard six MiB, room for the provider's largest to grow twice over", () => {
    expect(MAX_SHARD_BYTES).toBe(6 * 1024 * 1024);
  });

  /*
   * Every generation checks its own provider, the one from the whole spec,
   * before Go compiles any of it: a shard that has outgrown the split stops
   * the pull request that grew it.
   */
  test("runs in every generation, once the resources and data sources are written and before Go compiles them", () => {
    const generate: string = fs.readFileSync(
      path.join(__dirname, "..", "GenerateProvider.ts"),
      "utf-8",
    );
    const check: number = generate.indexOf("checkShardSizes(providerDir);");

    expect(check).toBeGreaterThan(
      generate.indexOf("await dataSourceGen.generateDataSources();"),
    );
    expect(
      generate.indexOf("await dataSourceGen.generateDataSources();"),
    ).toBeGreaterThan(
      generate.indexOf("await resourceGen.generateResources();"),
    );
    expect(check).toBeLessThan(generate.indexOf("await runGoCommand("));
    expect(generate.split("checkShardSizes(").length).toBe(2);
  });
});

/*
 * A generation of the fixture spec, as GenerateProvider.ts runs the
 * generators: every generated file in its shard, as that shard's package,
 * and every resource and data source in its place in the provider's lists.
 */
describe("a generated provider", () => {
  let outputDir: string;
  let resources: Array<TerraformResource>;
  let dataSources: Array<TerraformDataSource>;

  function read(relativePath: string): string {
    return fs.readFileSync(path.join(outputDir, relativePath), "utf-8");
  }

  // The {Order, New} entries a file hands over, as [order, constructor].
  function entriesIn(file: string): Array<[number, string]> {
    return Array.from(file.matchAll(/\{Order: (\d+), New: (\w+)\}/g)).map(
      (match: RegExpMatchArray): [number, string] => {
        return [Number(match[1]), match[2]!];
      },
    );
  }

  beforeAll(async () => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-shards-"));
    const config: TerraformProviderConfig = {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "11.0.0",
      goModuleName: MODULE,
    };
    const spec: ReturnType<typeof buildFixtureSpec> = buildFixtureSpec();
    await new GoModuleGenerator(config).generateModule();
    await new ResourceGenerator(config, spec).generateResources();
    await new DataSourceGenerator(config, spec).generateDataSources();

    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec);
    resources = parser.getResources();
    dataSources = parser.getDataSources();
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test("puts each generated resource and data source in its shard, as that shard's package", () => {
    const files: Array<string> = [
      ...resources.map(ResourceGenerator.resourceFileName),
      ...dataSources
        .filter((dataSource: TerraformDataSource) => {
          return !dataSource.staticFile;
        })
        .map(DataSourceGenerator.dataSourceFileName),
    ];
    expect(files.length).toBeGreaterThan(3);

    for (const fileName of files) {
      const go: string = read(generatedFilePath(fileName));

      expect(go.startsWith(`package ${shardOf(fileName)}\n`)).toBe(true);
      expect(go).toContain(`\n    ${providerDotImport(MODULE)}\n`);
      expect(
        fs.existsSync(path.join(outputDir, PROVIDER_PACKAGE_DIR, fileName)),
      ).toBe(false);
    }
  });

  test("keeps a data source written by hand in the provider package", () => {
    for (const dataSource of dataSources.filter(
      (candidate: TerraformDataSource) => {
        return Boolean(candidate.staticFile);
      },
    )) {
      const fileName: string =
        DataSourceGenerator.dataSourceFileName(dataSource);
      expect(read(`${PROVIDER_PACKAGE_DIR}/${fileName}`)).toMatch(
        /^package provider\n/,
      );
    }
  });

  test("writes every shard's registration, as that shard's package", () => {
    for (const shard of shardNames()) {
      for (const [file, register] of [
        ["resources.go", "RegisterResources"],
        ["data_sources.go", "RegisterDataSources"],
      ] as Array<[string, string]>) {
        const go: string = read(`${PROVIDER_PACKAGE_DIR}/${shard}/${file}`);

        expect(go.startsWith(`package ${shard}\n`)).toBe(true);
        expect(go).toContain(`    ${register}("${shard}", `);
      }
    }
  });

  test("lists the resources in the generator's order: the generated ones, those written by hand, then the deprecated aliases", () => {
    const listed: Map<number, string> = new Map();
    for (const shard of shardNames()) {
      for (const [order, constructor] of entriesIn(
        read(`${PROVIDER_PACKAGE_DIR}/${shard}/resources.go`),
      )) {
        expect(listed.has(order)).toBe(false);
        listed.set(order, constructor);
        // A shard hands over what it holds.
        expect(
          fs
            .readdirSync(path.join(outputDir, PROVIDER_PACKAGE_DIR, shard))
            .some((file: string) => {
              return read(`${PROVIDER_PACKAGE_DIR}/${shard}/${file}`).includes(
                `func ${constructor}() resource.Resource`,
              );
            }),
        ).toBe(true);
      }
    }
    for (const [order, constructor] of entriesIn(
      read(`${PROVIDER_PACKAGE_DIR}/resources.go`),
    )) {
      listed.set(order, constructor);
    }

    const renamed: Array<TerraformResource> = resources.filter(
      (resource: TerraformResource) => {
        return Boolean(resource.legacyName);
      },
    );
    const want: Array<string> = [
      ...resources.map((resource: TerraformResource) => {
        return `New${StringUtils.toPascalCase(resource.name)}Resource`;
      }),
      ...HANDWRITTEN_RESOURCES.map((resource: { goConstructor: string }) => {
        return resource.goConstructor;
      }),
      ...renamed.map((resource: TerraformResource) => {
        return `New${StringUtils.toPascalCase(resource.name)}LegacyResource`;
      }),
    ];
    expect(
      Array.from(listed.keys()).sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(
      want.map((_: string, index: number) => {
        return index;
      }),
    );
    expect(
      want.map((_: string, index: number) => {
        return listed.get(index);
      }),
    ).toEqual(want);
  });

  test("lists the data sources in the spec's order, one written by hand in its place", () => {
    const listed: Map<number, string> = new Map();
    for (const relativePath of [
      `${PROVIDER_PACKAGE_DIR}/data_sources.go`,
      ...shardNames().map((shard: string) => {
        return `${PROVIDER_PACKAGE_DIR}/${shard}/data_sources.go`;
      }),
    ]) {
      for (const [order, constructor] of entriesIn(read(relativePath))) {
        expect(listed.has(order)).toBe(false);
        listed.set(order, constructor);
      }
    }

    const want: Array<string> = [
      ...dataSources.map((dataSource: TerraformDataSource) => {
        return `New${StringUtils.toPascalCase(dataSource.name)}DataSource`;
      }),
      ...dataSources
        .filter((dataSource: TerraformDataSource) => {
          return Boolean(dataSource.legacyName);
        })
        .map((dataSource: TerraformDataSource) => {
          return `New${StringUtils.toPascalCase(dataSource.name)}LegacyDataSource`;
        }),
    ];
    expect(
      want.map((_: string, index: number) => {
        return listed.get(index);
      }),
    ).toEqual(want);
    expect(listed.size).toBe(want.length);
  });

  test("tells the provider package how many shards to wait for", () => {
    expect(read(`${PROVIDER_PACKAGE_DIR}/resources.go`)).toContain(
      `\nconst generatedShards = ${SHARD_COUNT}\n`,
    );
  });

  test("links every shard into the provider's binary, xpprovider and the provider's tests", () => {
    const all: string = `_ "${MODULE}/internal/provider/all"`;

    expect(read("main.go")).toContain(`    ${all}\n`);
    expect(read("xpprovider/xpprovider.go")).toContain(`\t${all}\n`);
    expect(read(`${PROVIDER_PACKAGE_DIR}/shards_test.go`)).toContain(
      `\t${all}\n`,
    );
    expect(read(`${PROVIDER_PACKAGE_DIR}/shards_test.go`)).toMatch(
      /^package provider_test\n/,
    );
  });

  test("leaves no shard larger than a shard may be", () => {
    expect(() => {
      checkShardSizes(outputDir);
    }).not.toThrow();
  });
});
