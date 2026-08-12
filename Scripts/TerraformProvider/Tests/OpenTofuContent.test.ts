/*
 * Contract tests for the checked-in OpenTofu content under Examples/opentofu.
 *
 * They live in the generator's suite because the generator consumes that
 * directory: DocumentationGenerator copies modules/ into the published provider
 * repository, and the OpenTofu guide, the provider README and the OneUptime
 * docs all publish a `source` address pointing at where it lands. These assert
 * the invariants those publications depend on — the things that break silently
 * rather than loudly.
 *
 * `terraform validate` is what proves the HCL is *correct* against the provider
 * schema; that needs a real binary, a registry and network, so it is not run
 * here. These are the checks that are worth having on every PR.
 */

import fs from "fs";
import path from "path";

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");
const EXAMPLES_DIR: string = path.join(REPO_ROOT, "Examples", "opentofu");
const MODULE_DIR: string = path.join(
  EXAMPLES_DIR,
  "modules",
  "monitoring-and-incident-response",
);

function listFiles(dir: string, extension: string): Array<string> {
  const found: Array<string> = [];
  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full: string = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(extension)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

/*
 * Hoisted rather than inlined at the call sites: eslint's wrap-regex and
 * prettier disagree about parenthesising a regex literal in a member
 * expression, and fixing one re-breaks the other. None are global, so `.test`
 * carries no lastIndex state between calls.
 */
const SOURCE_LINE: RegExp = /^\s*source\s*=/;
const DESCRIPTION_ATTR: RegExp = /description\s*=/;
const API_KEY_ASSIGNMENT: RegExp = /^\s*api_key\s*=/m;
const REGISTRY_HOST: RegExp = /registry\.(terraform\.io|opentofu\.org)/;

/*
 * Names declared by `variable "x" {` / `output "x" {` blocks. Good enough for
 * these hand-written files, and it fails loudly (empty list) rather than
 * silently if the shape ever changes.
 */
function declaredBlockNames(hcl: string, blockType: string): Array<string> {
  const pattern: RegExp = new RegExp(`^${blockType}\\s+"([^"]+)"\\s*\\{`, "gm");
  const names: Array<string> = [];
  let match: RegExpExecArray | null = pattern.exec(hcl);
  while (match !== null) {
    names.push(match[1] as string);
    match = pattern.exec(hcl);
  }
  return names;
}

const allTfFiles: Array<string> = listFiles(EXAMPLES_DIR, ".tf");

describe("layout", () => {
  test("the example directories the docs advertise all exist", () => {
    for (const dir of [
      "quickstart",
      "monitoring-and-incident-response",
      "modules/monitoring-and-incident-response",
    ]) {
      expect(fs.existsSync(path.join(EXAMPLES_DIR, dir))).toBe(true);
    }
  });

  test("the module has every file the generator copies and the README lists", () => {
    for (const file of [
      "main.tf",
      "variables.tf",
      "outputs.tf",
      "versions.tf",
      "README.md",
    ]) {
      expect(fs.existsSync(path.join(MODULE_DIR, file))).toBe(true);
    }
  });

  test("there is HCL to check", () => {
    /*
     * Guards against a refactor that moves the tree and turns every
     * file-walking test below into a vacuous pass.
     */
    expect(allTfFiles.length).toBeGreaterThanOrEqual(8);
  });
});

describe("engine neutrality", () => {
  /*
   * A hostname-qualified source address pins the configuration to one registry
   * and fails under the other engine. This is the single most important
   * invariant in the whole change, and it is invisible until someone runs the
   * other CLI.
   */
  test("no source address names a registry host", () => {
    for (const file of allTfFiles) {
      const sourceLines: Array<string> = read(file)
        .split("\n")
        .filter((line: string) => {
          return SOURCE_LINE.test(line);
        });
      for (const line of sourceLines) {
        expect({ file, line }).toMatchObject({
          line: expect.not.stringMatching(REGISTRY_HOST),
        });
      }
    }
  });

  test("the provider is declared as the bare oneuptime/oneuptime address", () => {
    expect(read(path.join(MODULE_DIR, "versions.tf"))).toContain(
      'source  = "oneuptime/oneuptime"',
    );
  });

  /*
   * OpenTofu ignores any .tf file that has a .tofu sibling, so a .tofu file
   * here would make the examples behave differently under each engine — the
   * opposite of what they are meant to demonstrate.
   */
  test("no .tofu files (they would break Terraform compatibility)", () => {
    expect(listFiles(EXAMPLES_DIR, ".tofu")).toEqual([]);
  });

  /*
   * OpenTofu's version series starts at 1.6.0, so >= 1.5.0 is satisfied by both
   * engines. A constraint of >= 1.6.0 would exclude Terraform 1.5.x, which is
   * OneUptime's documented floor.
   */
  test("required_version admits both engines", () => {
    const constraints: Array<string> = [];
    for (const file of allTfFiles) {
      const match: RegExpMatchArray | null = read(file).match(
        /required_version\s*=\s*"([^"]+)"/,
      );
      if (match) {
        constraints.push(match[1] as string);
      }
    }
    expect(constraints.length).toBeGreaterThan(0);
    for (const constraint of constraints) {
      expect(constraint).toBe(">= 1.5.0");
    }
  });
});

describe("module quality", () => {
  const variablesHcl: string = read(path.join(MODULE_DIR, "variables.tf"));
  const outputsHcl: string = read(path.join(MODULE_DIR, "outputs.tf"));
  const readme: string = read(path.join(MODULE_DIR, "README.md"));

  const variableNames: Array<string> = declaredBlockNames(
    variablesHcl,
    "variable",
  );
  const outputNames: Array<string> = declaredBlockNames(outputsHcl, "output");

  test("the module declares variables and outputs", () => {
    expect(variableNames.length).toBeGreaterThanOrEqual(10);
    expect(outputNames.length).toBeGreaterThanOrEqual(5);
  });

  test("every variable has a description", () => {
    const blocks: Array<string> = variablesHcl.split(/^variable\s+"/m).slice(1);
    for (const block of blocks) {
      const name: string = block.split('"')[0] as string;
      expect({ name, hasDescription: DESCRIPTION_ATTR.test(block) }).toEqual({
        name,
        hasDescription: true,
      });
    }
  });

  test("every output has a description", () => {
    const blocks: Array<string> = outputsHcl.split(/^output\s+"/m).slice(1);
    for (const block of blocks) {
      const name: string = block.split('"')[0] as string;
      expect({ name, hasDescription: DESCRIPTION_ATTR.test(block) }).toEqual({
        name,
        hasDescription: true,
      });
    }
  });

  /*
   * The README's inputs/outputs tables are the module's published interface.
   * Hand-maintained tables go stale the first time someone adds a variable, and
   * nothing else notices.
   */
  test("the README documents every variable", () => {
    for (const name of variableNames) {
      expect({ name, documented: readme.includes(`\`${name}\``) }).toEqual({
        name,
        documented: true,
      });
    }
  });

  test("the README documents every output", () => {
    for (const name of outputNames) {
      expect({ name, documented: readme.includes(`\`${name}\``) }).toEqual({
        name,
        documented: true,
      });
    }
  });

  /*
   * OneUptime seeds monitor statuses and incident severities per project. A
   * module instantiated once per service must look them up, not create them —
   * creating them duplicates the taxonomy and shifts `priority` insert slots.
   */
  test("the module looks the project taxonomy up instead of creating it", () => {
    const mainHcl: string = read(path.join(MODULE_DIR, "main.tf"));
    expect(mainHcl).toContain('data "oneuptime_monitor_status"');
    expect(mainHcl).toContain('data "oneuptime_incident_severity"');
    expect(mainHcl).not.toContain('resource "oneuptime_monitor_status"');
    expect(mainHcl).not.toContain('resource "oneuptime_incident_severity"');
  });
});

describe("examples", () => {
  test("no example hard-codes a credential", () => {
    for (const file of allTfFiles) {
      const content: string = read(file);
      // api_key should come from the environment, never be assigned inline.
      expect({ file, assigns: API_KEY_ASSIGNMENT.test(content) }).toEqual({
        file,
        assigns: false,
      });
    }
  });

  test("the worked example's relative module source resolves on disk", () => {
    const exampleDir: string = path.join(
      EXAMPLES_DIR,
      "monitoring-and-incident-response",
    );
    const sources: Array<string> = read(path.join(exampleDir, "main.tf"))
      .split("\n")
      .filter((line: string) => {
        return SOURCE_LINE.test(line);
      })
      .map((line: string) => {
        return (line.match(/"([^"]+)"/) as RegExpMatchArray)[1] as string;
      })
      /*
       * Local module paths only — the provider's registry address is a
       * `source` too, and it is not a path on disk.
       */
      .filter((source: string) => {
        return source.startsWith(".");
      });

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect({
        source,
        exists: fs.existsSync(path.resolve(exampleDir, source)),
      }).toEqual({ source, exists: true });
    }
  });
});

describe("published module source address", () => {
  /*
   * The docs, the module README and the generated guide all tell users to fetch
   * the module from the provider repository at //modules/<name>. The generator
   * copies Examples/opentofu/modules -> modules/, so the directory name is
   * load-bearing: renaming it silently 404s every one of those links.
   */
  const publishedPath: string =
    "terraform-provider-oneuptime//modules/monitoring-and-incident-response";

  test("the docs page advertises the path the generator writes to", () => {
    const docsPage: string = read(
      path.join(
        REPO_ROOT,
        "App/FeatureSet/Docs/Content/en/terraform/opentofu.md",
      ),
    );
    expect(docsPage).toContain(publishedPath);
  });

  test("the module README advertises the same path", () => {
    expect(read(path.join(MODULE_DIR, "README.md"))).toContain(publishedPath);
  });

  test("the advertised directory name matches the checked-in module", () => {
    expect(fs.existsSync(MODULE_DIR)).toBe(true);
    expect(path.basename(MODULE_DIR)).toBe("monitoring-and-incident-response");
  });
});
