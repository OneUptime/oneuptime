import AIService, {
  AI_DISABLED_MESSAGE,
} from "../../../../Server/Services/AIService";
import LlmLogService from "../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import DataSecurityAiCall from "../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import {
  AiIssueDossier,
  DataSecurityAiPrompt,
} from "../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import { buildIssueAnalysisPrompt } from "../../../../Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt";
import { buildFieldSuggestionPrompt } from "../../../../Server/Utils/AI/DataSecurity/FieldSuggestionPrompt";
import LLMService from "../../../../Server/Utils/LLM/LLMService";
import LlmLog from "../../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import LlmType from "../../../../Types/LLM/LlmType";
import ObjectID from "../../../../Types/ObjectID";
import SecuritySeverity from "../../../../Types/SecuritySeverity";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * DATA SECURITY, WHOLE WITHOUT AI (#10365).
 *
 * With the project's Enable AI off, OneUptime AI is sent nothing, and Data
 * Security keeps every page, check, scan and integration it has. That
 * holds because Data Security's own code - its scans, checks, issues,
 * integrations, owners, flows and jobs, on the workers and on a probe -
 * reaches OneUptime AI at these places only, each asking the switch first
 * or asking no model at all:
 *
 *   - a content scan that found fields no detector could place asks for
 *     suggestions only when AIService.isProjectAIEnabled says yes
 *     (DataSecurityFindingWriter; DataSecurityFindingWriter.test);
 *   - the job that asks runs FieldSuggestion.suggestForStore, which asks the
 *     switch again and sends nothing when it is off (FieldSuggestion.test);
 *   - the job that works on a new issue runs DataSecurityAiEngine
 *     .evaluateIssue (#10364), which reads Enable AI and Work on new issues
 *     first and does nothing, and writes nothing, with either off
 *     (DataSecurityAiEngine.test) - the analysis of the issue (#10369)
 *     among what it does;
 *   - the job that emails a store's owners runs DataSecurityOwnerNotice
 *     .send (#10369), which waits for the analysis only while the engine
 *     works on new issues, reads the analysis the issue keeps, and asks no
 *     model (DataSecurityOwnerNotice.test; the whole way, from the issue
 *     opening to the email, DataSecurityNewIssueAnalysis.test);
 *   - the jobs that propose owners for stores that have none, and the owner
 *     rules that keep them (#10374), run DataStoreOwnerProposalRun.run and
 *     DataStoreOwnerRuleProposals.proposeForProject, which read the same
 *     two switches first and ask nothing, and write nothing, when either is
 *     off (DataStoreOwnerRunsAndRules.test);
 *   - an issue that closes settles what OneUptime AI proposed for it
 *     (DataSecurityAiProposals.onIssuesClosed, from the issue service and
 *     the reconciler): it proves or expires proposals already written and
 *     asks no model, so with AI off it has nothing to do but that.
 *
 * Everything else a person can start with AI is asked for on purpose, in
 * Data Security's API: the analysis of an issue (Explain with AI) and the
 * field suggestions through the one Data Security call, whose
 * AIService.executeWithLogging refuses a project with AI off before a model
 * is asked (below); Fix with AI through the Code task's gate, whose answer
 * with AI off is what to fix, with nothing started
 * (DataSecurityCodeTask.test); and Ask AI's chat, which the chat's own
 * switch refuses. On the Dashboard, the issue's page draws no analysis and
 * no AI action with Enable AI off, and is whole without them
 * (DataSecurityIssuePageThroughTheServer.test); the pages below draw no
 * other.
 *
 * A new import of OneUptime AI into Data Security's code fails here until
 * this says how it asks the switch.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: false };
});

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");
const PACKAGES: string = path.join(REPOSITORY_ROOT, "packages");

// Data Security's own code: every place its scans, checks and integrations run.
const DATA_SECURITY_CODE: Array<string> = [
  "Common/Server/Utils/DataSecurity",
  "Common/Server/Services/DataSecurity*",
  "Common/Server/Services/DataStore*",
  "App/FeatureSet/Workers/Jobs/DataSecurity",
  "App/FeatureSet/Workers/Jobs/DataStoreOwners",
  "Probe/Jobs/DataSecurity",
];

// A module of OneUptime AI: its runs, its prompts, its models and their logs.
const AI_MODULE: RegExp =
  /^Common\/Server\/(?:Utils\/(?:AI|LLM)\/|Services\/(?:AI|Llm)[A-Za-z]*Service$)/;

interface AiReach {
  // The AI module it imports.
  module: string;
  // What of it the code uses, as Name.member.
  uses: Array<string>;
}

// The only places Data Security's code reaches OneUptime AI, and what each uses.
const WHERE_IT_REACHES_AI: Record<string, Array<AiReach>> = {
  "Common/Server/Utils/DataSecurity/DataSecurityFindingWriter.ts": [
    {
      module: "Common/Server/Services/AIService",
      uses: ["AIService.isProjectAIEnabled"],
    },
  ],
  "App/FeatureSet/Workers/Jobs/DataSecurity/DataSecurityJobs.ts": [
    {
      module: "Common/Server/Utils/AI/DataSecurity/FieldSuggestion",
      uses: ["DataSecurityFieldSuggestion.suggestForStore"],
    },
    // OneUptime AI's verdicts on findings (#10372): the switch is asked in the run.
    {
      module: "Common/Server/Utils/AI/DataSecurity/FindingVerdicts",
      uses: ["DataSecurityFindingVerdicts.judgeStore"],
    },
    // The scans' tuning (#10372): asks no model, under the same switches.
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityScanTuning",
      uses: ["DataSecurityScanTuning.proposeForProject"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiEngine",
      uses: ["DataSecurityAiEngine.evaluateIssue"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityOwnerNotice",
      uses: ["DataSecurityOwnerNotice.send"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataStoreOwnerProposalRun",
      uses: ["DataStoreOwnerProposalRun.run"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataStoreOwnerRuleProposals",
      uses: ["DataStoreOwnerRuleProposals.proposeForProject"],
    },
  ],
  "Common/Server/Services/DataSecurityIssueService.ts": [
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiProposals",
      uses: ["DataSecurityAiProposals.onIssuesClosed"],
    },
  ],
  "Common/Server/Utils/DataSecurity/DataSecurityIssueReconciler.ts": [
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiProposals",
      uses: ["DataSecurityAiProposals.onIssuesClosed"],
    },
  ],
};

const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.test\.tsx?$/;

const SKIPPED: ReadonlySet<string> = new Set([
  "node_modules",
  "build",
  "dist",
  "Tests",
]);

function listFiles(entry: string): Array<string> {
  const absolute: string = path.join(PACKAGES, entry);

  if (entry.endsWith("*")) {
    const directory: string = path.dirname(absolute);
    const prefix: string = path.basename(entry).slice(0, -1);

    return fs
      .readdirSync(directory)
      .filter((name: string): boolean => {
        return name.startsWith(prefix) && name.endsWith(".ts");
      })
      .map((name: string): string => {
        return path.join(directory, name);
      });
  }

  if (fs.statSync(absolute).isFile()) {
    return [absolute];
  }

  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((child: fs.Dirent): Array<string> => {
      if (child.isDirectory()) {
        return SKIPPED.has(child.name)
          ? []
          : listFiles(path.join(entry, child.name));
      }

      return SOURCE_FILE.test(child.name) && !TEST_FILE.test(child.name)
        ? [path.join(absolute, child.name)]
        : [];
    });
}

// Where an import leads, from packages/: a relative path or a package's.
function resolveImport(file: string, specifier: string): string {
  if (specifier.startsWith(".")) {
    return path
      .relative(PACKAGES, path.resolve(path.dirname(file), specifier))
      .split(path.sep)
      .join("/");
  }

  return specifier;
}

// Each import of OneUptime AI in a file, and what of it the file uses.
function findAiReaches(file: string): Array<AiReach> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const reaches: Array<AiReach> = [];
  const names: Map<string, AiReach> = new Map();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let specifier: string | null = null;

    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifier = node.arguments[0].text;
    }

    if (specifier !== null) {
      const module: string = resolveImport(file, specifier);

      if (AI_MODULE.test(module)) {
        const reach: AiReach = { module, uses: [] };
        reaches.push(reach);

        const clause: ts.ImportClause | undefined = ts.isImportDeclaration(node)
          ? node.importClause
          : undefined;

        if (clause?.name) {
          names.set(clause.name.text, reach);
        }

        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            reach.uses.push(element.name.text);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  const use: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      names.has(node.expression.text)
    ) {
      const reach: AiReach = names.get(node.expression.text)!;
      const name: string = `${node.expression.text}.${node.name.text}`;

      if (!reach.uses.includes(name)) {
        reach.uses.push(name);
      }
    }

    ts.forEachChild(node, use);
  };

  use(source);

  return reaches;
}

describe("Data Security's scans, checks and integrations reach OneUptime AI only where it asks the switch first, or asks no model", () => {
  const files: Array<string> = DATA_SECURITY_CODE.flatMap(listFiles);

  test("it reads Data Security's code, on the workers and on a probe", () => {
    const relative: Array<string> = files.map((file: string): string => {
      return path.relative(PACKAGES, file).split(path.sep).join("/");
    });

    expect(files.length).toBeGreaterThan(40);

    for (const known of [
      "Common/Server/Utils/DataSecurity/DataSecurityEvaluator.ts",
      "Common/Server/Utils/DataSecurity/DataSecurityIntegrations.ts",
      "Common/Server/Utils/DataSecurity/DataSecurityIssueAlerts.ts",
      "Common/Server/Services/DataSecurityIssueService.ts",
      "Common/Server/Services/DataStoreOwnerRuleEngineService.ts",
      "Probe/Jobs/DataSecurity/ScanDatabases.ts",
      ...Object.keys(WHERE_IT_REACHES_AI),
    ]) {
      expect(relative).toContain(known);
    }
  });

  test("each asks the project's Enable AI first, and uses nothing else of AI", () => {
    const found: Record<string, Array<AiReach>> = {};

    for (const file of files) {
      const reaches: Array<AiReach> = findAiReaches(file);

      if (reaches.length > 0) {
        found[path.relative(PACKAGES, file).split(path.sep).join("/")] =
          reaches;
      }
    }

    expect(found).toEqual(WHERE_IT_REACHES_AI);
  });

  test("the reader finds an import of AI, by a relative path or a package's, and what of it is used", () => {
    const planted: string = path.join(
      PACKAGES,
      "Common/Server/Utils/DataSecurity/__planted__.ts",
    );
    const read: jest.SpyInstance = jest
      .spyOn(fs, "readFileSync")
      .mockReturnValueOnce(
        [
          'import AIService from "../../Services/AIService";',
          'import { getCompletion } from "Common/Server/Utils/LLM/LLMService";',
          'import DataStoreService from "../../Services/DataStoreService";',
          "AIService.executeWithLogging({});",
          'const later: unknown = require("../AI/SRE/AIInvestigationEngine");',
        ].join("\n"),
      );

    expect(findAiReaches(planted)).toEqual([
      {
        module: "Common/Server/Services/AIService",
        uses: ["AIService.executeWithLogging"],
      },
      { module: "Common/Server/Utils/LLM/LLMService", uses: ["getCompletion"] },
      { module: "Common/Server/Utils/AI/SRE/AIInvestigationEngine", uses: [] },
    ]);
    read.mockRestore();
  });
});

describe("with Enable AI off, the one Data Security call sends nothing", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10365000-0000-4000-8000-0000000000f1",
  );
  const PROVIDER: LlmProvider = {
    _id: "10365000-0000-4000-8000-0000000000f2",
    id: new ObjectID("10365000-0000-4000-8000-0000000000f2"),
    name: "Our Ollama",
    llmType: LlmType.Ollama,
    baseUrl: "http://ollama.internal:11434",
    modelName: "llama3.1:70b",
    isGlobalLlm: false,
    isDefault: true,
    projectId: PROJECT_ID,
  } as unknown as LlmProvider;

  // The analysis of an issue (#10369), as a person asks for it.
  function explainPrompt(): DataSecurityAiPrompt {
    const dossier: AiIssueDossier = {
      issue: {
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        severity: SecuritySeverity.Critical,
        evidence: "The bucket policy grants s3:GetObject to *.",
      },
      store: { name: "acme-card-exports", kind: DataStoreKind.AwsS3Bucket },
      places: [],
      access: [],
      copies: [],
      securityCaseIds: [],
      responses: [],
      proposals: [],
      declaredCode: null,
      owners: { recordIds: [], names: [], count: 0 },
      now: new Date("2026-11-20T12:00:00.000Z"),
    };

    return buildIssueAnalysisPrompt({
      feature: DataSecurityAiFeature.ExplainIssue,
      dossier,
      language: "en",
    });
  }

  function fieldPrompt(): DataSecurityAiPrompt {
    return buildFieldSuggestionPrompt({
      storeKind: "PostgreSQL",
      dataTypes: [{ id: "email-address", name: "Email address" }],
      fields: [
        {
          location: "public.users.mail",
          locationKind: "Column",
          neighbours: ["name"],
          shapes: [{ shape: "aaaa@aaaa.aaa", share: 1 }],
          valueCount: 20,
          averageLength: 14,
        },
      ],
    });
  }

  let enableAi: boolean;
  let getCompletion: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
      return { id: PROJECT_ID, enableAi } as unknown as Project;
    }) as never);
    jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockResolvedValue(PROVIDER as never);
    getCompletion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
      content: "The bucket is public. Turn on Block Public Access.",
      usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
    });
    jest.spyOn(LlmLogService, "create").mockResolvedValue(new LlmLog());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["The analysis of an issue", explainPrompt],
    ["the field suggestions", fieldPrompt],
  ])(
    "%s: refused with the switch's own sentence, and no model is asked",
    async (_feature: string, prompt: () => DataSecurityAiPrompt) => {
      enableAi = false;

      await expect(
        DataSecurityAiCall.ask({
          projectId: PROJECT_ID,
          userId: ObjectID.generate(),
          prompt: prompt(),
          maxTokens: 900,
        }),
      ).rejects.toThrow(AI_DISABLED_MESSAGE);
      expect(getCompletion).not.toHaveBeenCalled();
      expect(await AIService.isProjectAIEnabled(PROJECT_ID)).toBe(false);
    },
  );

  test("with it on, the same call reaches the project's model", async () => {
    enableAi = true;

    await DataSecurityAiCall.ask({
      projectId: PROJECT_ID,
      userId: ObjectID.generate(),
      prompt: explainPrompt(),
      maxTokens: 900,
    });

    expect(getCompletion).toHaveBeenCalledTimes(1);
  });
});

describe("the Dashboard's Data Security pages draw an AI action in one place, behind Enable AI", () => {
  const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
  // A button's or a dialog's title that asks OneUptime AI: "Explain with AI".
  const AI_ACTION: RegExp = /["'`]((?:[A-Z][a-z]+ )+with AI)["'`]/g;

  function actionsIn(file: string): Array<string> {
    return Array.from(
      fs.readFileSync(file, "utf8").matchAll(AI_ACTION),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );
  }

  test("only the issue's page, its analysis card and the Fix with AI dialog it opens name one", () => {
    const found: Record<string, Array<string>> = {};

    for (const file of [
      ...listFiles(`${DASHBOARD}/Pages/DataSecurity`),
      ...listFiles(`${DASHBOARD}/Components/DataSecurity`),
    ]) {
      const actions: Array<string> = actionsIn(file);

      if (actions.length > 0) {
        found[path.relative(path.join(PACKAGES, DASHBOARD), file)] = [
          ...new Set(actions),
        ];
      }
    }

    expect(found).toEqual({
      [path.join("Pages", "DataSecurity", "IssueView", "Overview.tsx")]: [
        "Fix with AI",
      ],
      // The analysis card's words (#10369): its path to fixed offers Fix with AI.
      [path.join("Components", "DataSecurity", "IssueAiAnalysisCopy.ts")]: [
        "Fix with AI",
      ],
      [path.join("Components", "DataSecurity", "IssueModals.tsx")]: [
        "Fix with AI",
      ],
    });
  });

  test("the issue's page draws its analysis and Fix with AI only when the project's Enable AI offers them", () => {
    const page: string = fs.readFileSync(
      path.join(
        PACKAGES,
        DASHBOARD,
        "Pages/DataSecurity/IssueView/Overview.tsx",
      ),
      "utf8",
    );
    const gated: string = page.slice(page.indexOf("if (isAiOffered) {"));

    expect(page).toContain("const isAiOffered: boolean = useAiOffered();");
    expect(page.indexOf("if (isAiOffered) {")).toBeGreaterThan(0);
    expect(page.indexOf('title: "Fix with AI"')).toBeGreaterThan(
      page.indexOf("if (isAiOffered) {"),
    );
    expect(gated).toContain('title: "Fix with AI"');
    // OneUptime AI's analysis (#10369), and every action it offers, is drawn once, behind the switch.
    expect(page.split("<IssueAiAnalysisCard").length).toBe(2);
    expect(page).toMatch(/\{isAiOffered \? \(\s*<IssueAiAnalysisCard\b/);
  });
});
