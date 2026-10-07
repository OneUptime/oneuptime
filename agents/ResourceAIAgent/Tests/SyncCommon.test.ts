import "./Helpers/TestSupport";
import assert from "assert";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { makeTempDir } from "./Helpers/FakeBinary";

/*
 * Scripts/SyncCommon.js keeps the agent's Common/ copies byte-identical to
 * packages/Common. The directories in CommonCopies.json are copied WHOLE,
 * so a module a kit adds to Utils/AiRemediation/Resource is picked up
 * without anyone touching the list — and a copy whose source is gone is
 * reported, then removed. Tested against a scratch repository laid out like
 * the real one.
 */

const AGENT_ROOT: string = path.resolve(__dirname, "..", "..", "..");
const SCRIPT: string = path.join(AGENT_ROOT, "Scripts", "SyncCommon.js");

interface Copy {
  label: string;
  source: string;
  target: string;
}

interface Roots {
  repoRoot?: string;
  agentRoot?: string;
}

interface SyncCommonModule {
  AGENT_ROOT: string;
  REPO_ROOT: string;
  loadCopyList: (roots?: Roots) => {
    commonPolicyDirectories: Array<string>;
    commonPolicyFiles: Array<string>;
    otherCopies: Array<{ source: string; target: string }>;
  };
  listFilesRecursively: (dir: string) => Array<string>;
  getCommonRelativePaths: (roots?: Roots) => Array<string>;
  getCopies: (roots?: Roots) => Array<Copy>;
  findDrift: (roots?: Roots) => Array<Copy>;
  findStray: (roots?: Roots) => Array<{ label: string; target: string }>;
  sync: (roots?: Roots) => {
    copied: Array<Copy>;
    removed: Array<{ label: string; target: string }>;
  };
}

const loadModule: NodeJS.Require = createRequire(__filename);
const SyncCommon: SyncCommonModule = loadModule(SCRIPT) as SyncCommonModule;

function labels(items: Array<{ label: string }>): Array<string> {
  return items
    .map((item: { label: string }): string => {
      return item.label;
    })
    .sort();
}

describe("the real copy list", () => {
  test("names the two policy directories and the three single files", () => {
    assert.deepStrictEqual(SyncCommon.loadCopyList(), {
      commonPolicyDirectories: [
        "Types/ResourceAiAgent",
        "Utils/AiRemediation/Resource",
      ],
      commonPolicyFiles: [
        "Types/AI/AgentAiSettings.ts",
        "Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts",
        "Types/Runbook/RunnerJobOrigin.ts",
      ],
      otherCopies: [],
    });
    assert.strictEqual(SyncCommon.AGENT_ROOT, AGENT_ROOT);
    assert.strictEqual(
      SyncCommon.REPO_ROOT,
      path.resolve(AGENT_ROOT, "..", ".."),
    );
  });

  test("copies at least the shared contracts and the policy entry points", () => {
    const paths: Array<string> = SyncCommon.getCommonRelativePaths();

    for (const expected of [
      "Types/ResourceAiAgent/AiResourceType.ts",
      "Types/ResourceAiAgent/ResourceAiAccess.ts",
      "Utils/AiRemediation/Resource/ResourceCommandPolicy.ts",
      "Utils/AiRemediation/Resource/ResourceCommandPolicyCore.ts",
      "Utils/AiRemediation/Resource/ResourceOutputRedactor.ts",
      "Types/AI/AgentAiSettings.ts",
      "Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts",
      "Types/Runbook/RunnerJobOrigin.ts",
    ]) {
      assert.ok(paths.includes(expected), expected);
    }
  });

  test("--list prints the same paths as JSON", () => {
    const run: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      [SCRIPT, "--list"],
      { encoding: "utf8" },
    );

    assert.strictEqual(run.status, 0, run.stderr);
    assert.deepStrictEqual(
      JSON.parse(run.stdout),
      SyncCommon.getCommonRelativePaths(),
    );
  });
});

describe("against a scratch repository", () => {
  let scratch: string;
  let roots: Roots;
  let common: string;

  function write(relative: string, text: string): void {
    const file: string = path.join(common, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }

  beforeEach((): void => {
    scratch = makeTempDir("sync-common-");
    const repoRoot: string = path.join(scratch, "repo");
    const agentRoot: string = path.join(repoRoot, "agents", "ResourceAIAgent");
    common = path.join(repoRoot, "packages", "Common");
    roots = { repoRoot, agentRoot };

    fs.mkdirSync(path.join(agentRoot, "Scripts"), { recursive: true });
    fs.copyFileSync(
      path.join(AGENT_ROOT, "Scripts", "CommonCopies.json"),
      path.join(agentRoot, "Scripts", "CommonCopies.json"),
    );

    write("Types/ResourceAiAgent/AiResourceType.ts", "export default 1;\n");
    write("Types/ResourceAiAgent/.DS_Store", "finder junk");
    write("Utils/AiRemediation/Resource/ResourceCommandPolicy.ts", "p\n");
    write("Utils/AiRemediation/Resource/Database/Catalog.ts", "c\n");
    write("Types/AI/AgentAiSettings.ts", "s\n");
    write("Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts", "v\n");
    write("Types/Runbook/RunnerJobOrigin.ts", "o\n");
    // Not in the list: never copied.
    write("Types/Other.ts", "x\n");
  });

  afterEach((): void => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test("every file of the listed directories (recursively, dotfiles aside) and the single files", () => {
    assert.deepStrictEqual(SyncCommon.getCommonRelativePaths(roots), [
      "Types/AI/AgentAiSettings.ts",
      "Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts",
      "Types/ResourceAiAgent/AiResourceType.ts",
      "Types/Runbook/RunnerJobOrigin.ts",
      "Utils/AiRemediation/Resource/Database/Catalog.ts",
      "Utils/AiRemediation/Resource/ResourceCommandPolicy.ts",
    ]);
  });

  test("missing copies drift; sync copies them byte for byte; then nothing drifts", () => {
    assert.strictEqual(SyncCommon.findDrift(roots).length, 6);

    const result: {
      copied: Array<Copy>;
      removed: Array<{ label: string; target: string }>;
    } = SyncCommon.sync(roots);

    assert.strictEqual(result.copied.length, 6);
    assert.deepStrictEqual(result.removed, []);
    assert.deepStrictEqual(SyncCommon.findDrift(roots), []);

    for (const copy of SyncCommon.getCopies(roots)) {
      assert.ok(
        fs.readFileSync(copy.source).equals(fs.readFileSync(copy.target)),
        copy.label,
      );
    }
  });

  test("a new module in a listed directory is picked up without touching the list", () => {
    SyncCommon.sync(roots);
    write("Utils/AiRemediation/Resource/NewKitPolicy.ts", "new\n");

    assert.deepStrictEqual(labels(SyncCommon.findDrift(roots)), [
      "Common/Utils/AiRemediation/Resource/NewKitPolicy.ts",
    ]);
  });

  test("a source that changed drifts", () => {
    SyncCommon.sync(roots);
    write("Utils/AiRemediation/Resource/ResourceCommandPolicy.ts", "p2\n");

    assert.deepStrictEqual(labels(SyncCommon.findDrift(roots)), [
      "Common/Utils/AiRemediation/Resource/ResourceCommandPolicy.ts",
    ]);
  });

  test("a copy edited in the agent drifts", () => {
    SyncCommon.sync(roots);
    fs.appendFileSync(
      path.join(
        roots.agentRoot!,
        "Common",
        "Types",
        "Runbook",
        "RunnerJobOrigin.ts",
      ),
      "// local edit\n",
    );

    assert.deepStrictEqual(labels(SyncCommon.findDrift(roots)), [
      "Common/Types/Runbook/RunnerJobOrigin.ts",
    ]);
  });

  test("a copy whose source is gone is stray; sync removes it and empty directories", () => {
    SyncCommon.sync(roots);
    fs.rmSync(path.join(common, "Utils/AiRemediation/Resource/Database"), {
      recursive: true,
    });

    assert.deepStrictEqual(labels(SyncCommon.findStray(roots)), [
      "Common/Utils/AiRemediation/Resource/Database/Catalog.ts",
    ]);

    const result: {
      copied: Array<Copy>;
      removed: Array<{ label: string; target: string }>;
    } = SyncCommon.sync(roots);

    assert.strictEqual(result.removed.length, 1);
    assert.deepStrictEqual(SyncCommon.findStray(roots), []);
    assert.strictEqual(
      fs.existsSync(
        path.join(
          roots.agentRoot!,
          "Common",
          "Utils",
          "AiRemediation",
          "Resource",
          "Database",
        ),
      ),
      false,
    );
  });

  test("a listed directory or file that does not exist is an error, not an empty copy", () => {
    fs.rmSync(path.join(common, "Types", "ResourceAiAgent"), {
      recursive: true,
    });
    assert.throws((): void => {
      SyncCommon.getCopies(roots);
    }, /packages\/Common\/Types\/ResourceAiAgent \(in Scripts\/CommonCopies.json\) is not a directory/);
  });

  test("a listed single file that does not exist is an error", () => {
    fs.rmSync(path.join(common, "Types", "Runbook", "RunnerJobOrigin.ts"));
    assert.throws((): void => {
      SyncCommon.getCopies(roots);
    }, /Types\/Runbook\/RunnerJobOrigin.ts \(in Scripts\/CommonCopies.json\) does not exist/);
  });

  test("listFilesRecursively skips dotfiles and sorts", () => {
    assert.deepStrictEqual(
      SyncCommon.listFilesRecursively(path.join(common, "Types")),
      [
        "AI/AgentAiSettings.ts",
        "AutoRemediation/AiRemediationCommandPolicyVerdict.ts",
        "Other.ts",
        "ResourceAiAgent/AiResourceType.ts",
        "Runbook/RunnerJobOrigin.ts",
      ],
    );
  });
});
