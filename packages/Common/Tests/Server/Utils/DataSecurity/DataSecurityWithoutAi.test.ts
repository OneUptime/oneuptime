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
 *     (DataSecurityAiProposals.onIssuesClosed, from the issue service, the
 *     reconciler, and a fix followed to production that closes it -
 *     DataSecurityIssueResolutions, #10368): it proves or expires proposals
 *     already written and asks no model, so with AI off it has nothing to do
 *     but that;
 *   - the grouping of the issues one mistake made (#10370,
 *     DataSecurityIssueGrouper), after each evaluation, has OneUptime AI
 *     name each open group (DataSecurityIssueGroupNaming.nameGroups) and
 *     propose its fix (DataSecurityIssueGroupProposals.proposeForGroups),
 *     which read Enable AI and Work on new issues first and ask nothing,
 *     and write nothing, with either off (DataSecurityIssueGroupNaming.test,
 *     DataSecurityIssueGroupProposals.test); the rest it uses ranks the
 *     repositories that declare the stores and reads their tags
 *     (DeclaredCodeOwner, CloudAiTargets.getManagedAsCode), and asks no
 *     model; it proves the group fixes OneUptime AI made
 *     (DataSecurityIssueGroupFixProof.proveForProject, #10738), which reads
 *     the issues those fixes closed and asks no model, and tells each issue
 *     a group's waiting proposal expired
 *     (DataSecurityIssueGroupTimelines.expireWaitingForGroup, #10741),
 *     which writes a timeline line of fixed words and asks no model;
 *   - the list of groups (DataSecurityIssueGroups) asks
 *     AIService.isProjectAIEnabled, and with AI off shows no name OneUptime
 *     AI gave a group: each goes by its cause's own words. For a reader held
 *     to labels (#10739) it reads which issues a group's pull request lists
 *     (DataSecurityFixTarget.readTask, issueIdsOfTask) and how a store's
 *     tags declare it (CloudAiTargets.getManagedAsCode), and asks no model;
 *   - the daily drafts of the record of processing (#10375) run
 *     RecordOfProcessingDraftRun.run, which reads Enable AI and Work on new
 *     issues first and asks nothing, and writes nothing, with either off;
 *     the audit evidence's reader (AuditEvidenceReader) only shapes the
 *     facts the page shows and a draft is built from, with the input
 *     builder's types, and asks no model;
 *   - the discovery of the data types a project's own fields make (#10371)
 *     runs DataTypeDiscovery.runForProject, which decides the proofs under
 *     way from their counts and asks no model, then asks
 *     AIService.isProjectAIEnabled and drafts nothing with it off
 *     (DataTypeDiscovery.test);
 *   - the job that assesses an exposure a Critical issue opened a case for
 *     (#10377) runs ExposureAssessmentRun.run: plain code's assessment -
 *     the window, the reads, whose data, the secrets and the breach laws -
 *     is worked out with no model, and OneUptime AI writes it up only once
 *     Enable AI, Work on new issues and the issue's Analyze rule allow it
 *     (ExposureAssessmentRun.test);
 *   - the job that proposes the fix of each service's telemetry leaks in
 *     its code (#10367) runs TelemetryLeakFixProposals.proposeForProject,
 *     which reads Enable AI and Work on new issues first and asks nothing,
 *     and writes nothing, with either off (TelemetryLeakFixProposals.test);
 *   - a person's own pull request, linked to an issue (#10831,
 *     DataSecurityIssuePullRequestService), is followed to production as
 *     OneUptime AI's are (DataSecurityLinkedFixes): the check its issue's
 *     store calls for (DataSecurityFixTarget.checkOfStore, readLink), the
 *     leak's baseline (TelemetryLeakFixWatch.readBaseline), its deploy and
 *     its verdict (FixProductionVerifier, FixProductionVerdict) - reads of
 *     the store, telemetry and the pull request that ask no model, so a
 *     person's own fix is followed with Enable AI off too.
 *
 * Everything else a person can start with AI is asked for on purpose, in
 * Data Security's API: the analysis of an issue (Explain with AI) and the
 * field suggestions through the one Data Security call, whose
 * AIService.executeWithLogging refuses a project with AI off before a model
 * is asked (below); Fix with AI through the Code task's gate, whose answer
 * with AI off is what to fix, with nothing started
 * (DataSecurityCodeTask.test) - its button's work lives in
 * DataSecurityButtons (#10378), which the API's route and Ask AI's action
 * both call: DataSecurityCodeTask.requestFix asks CodeTaskGate.getBlocker
 * before it builds the task's request, and DataSecurityAiReads only reads
 * the issue and its places for it; a group's pull request, through the same
 * gate (DataSecurityIssueGroupFix: DataSecurityCodeTask.requestGroupFix
 * asks CodeTaskGate.getBlocker before it builds the task's request,
 * DataSecurityIssueGroupPrompt, and the plan shows the gate's refusal -
 * DataSecurityIssueGroupFix.test), whose other reads say where the task
 * stands and in which repositories the person may ask (AIRunService,
 * CodeTaskThread, CodeTaskListRows, CodeTaskAccess, DeclaredCodeOwner,
 * CloudAiTargets) and ask no model; a service's telemetry fix, through the
 * same gate (TelemetryLeakFix: DataSecurityCodeTask.requestTelemetryLeakFix
 * asks CodeTaskGate.getBlocker first), and where an issue's fix in code
 * stands (DataSecurityIssueCodeFix), which only reads; and Ask AI's chat,
 * which the chat's own switch refuses. On the Dashboard, the issue's page draws no analysis and
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
  /*
   * Fix with AI's button (#10362, #10378), as a person presses it on the
   * issue's page or asks Ask AI for it: through the Code task's gate -
   * DataSecurityCodeTask.requestFix asks CodeTaskGate.getBlocker before it
   * builds the task's request, so with Enable AI off it answers what to
   * fix and starts nothing; DataSecurityAiReads reads the issue and its
   * places for the request, and asks no model.
   */
  "Common/Server/Utils/DataSecurity/DataSecurityButtons.ts": [
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiInput",
      uses: ["DataSecurityAiCodeRequest"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiReads",
      uses: ["DataSecurityAiReads.readIssue", "DataSecurityAiReads.readPlaces"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityCodeTask",
      uses: ["DataSecurityFixCode", "DataSecurityCodeTask.requestFix"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt",
      uses: ["buildDataSecurityFixRequest"],
    },
  ],
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
    {
      module: "Common/Server/Utils/AI/DataSecurity/RecordOfProcessingDraftRun",
      uses: ["RecordOfProcessingDraftRun.run"],
    },
    /*
     * An exposure's assessment (#10377): plain code's part asks no model;
     * the run reads Enable AI and Work on new issues, and the rules, before
     * OneUptime AI writes it up.
     */
    {
      module: "Common/Server/Utils/AI/DataSecurity/ExposureAssessmentRun",
      uses: ["ExposureAssessmentRun.run"],
    },
    // The data types a project's own fields make (#10371): drafted only with Enable AI on.
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataTypeDiscovery",
      uses: ["DataTypeDiscovery.runForProject"],
    },
    /*
     * A service's telemetry leaks fixed in its code (#10367): proposed only
     * with Enable AI and Work on new issues on.
     */
    {
      module: "Common/Server/Utils/AI/DataSecurity/TelemetryLeakFixProposals",
      uses: ["TelemetryLeakFixProposals.proposeForProject"],
    },
  ],
  "Common/Server/Utils/DataSecurity/AuditEvidenceReader.ts": [
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiInput",
      uses: ["AiEvidenceRequirement", "AiIssueRecord", "AiStoreRecord"],
    },
  ],
  /*
   * A person's own pull request, linked to an issue (#10831): the check its
   * issue's store calls for, read from the store's kind - asks no model.
   */
  "Common/Server/Services/DataSecurityIssuePullRequestService.ts": [
    {
      module: "Common/Server/Utils/AI/CodeFix/DataSecurityFixTarget",
      uses: ["DataSecurityFixTarget.checkOfStore"],
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
  "Common/Server/Utils/DataSecurity/DataSecurityIssueResolutions.ts": [
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiProposals",
      uses: ["DataSecurityAiProposals.onIssuesClosed"],
    },
  ],
  /*
   * A person's own pull request followed to production (#10831), as
   * OneUptime AI's are: its issue and check (DataSecurityFixTarget), the
   * leak's baseline, its deploy, its verdict - reads of the store,
   * telemetry and the code host that ask no model.
   */
  "Common/Server/Utils/DataSecurity/DataSecurityLinkedFixes.ts": [
    {
      module: "Common/Server/Utils/AI/CodeFix/DataSecurityFixTarget",
      uses: ["DataSecurityFixTargetRead", "DataSecurityFixTarget.readLink"],
    },
    {
      module: "Common/Server/Utils/AI/CodeFix/FixProductionVerdict",
      uses: ["FixProductionVerdict", "fieldsWhenMerged", "fitVerdict"],
    },
    {
      module: "Common/Server/Utils/AI/CodeFix/FixProductionVerifier",
      uses: [
        "VerifierRun",
        "FixProductionVerifier.verifyFix",
        "FixProductionVerifier.saveBaseline",
        "FixProductionVerifier.writeFix",
      ],
    },
    {
      module: "Common/Server/Utils/AI/CodeFix/TelemetryLeakFixWatch",
      uses: ["TelemetryLeakFixWatch.readBaseline"],
    },
  ],
  "Common/Server/Utils/DataSecurity/DataSecurityIssueGrouper.ts": [
    // A group fix proven by its issues' checks (#10738): reads, and asks no model.
    {
      module:
        "Common/Server/Utils/AI/DataSecurity/DataSecurityIssueGroupFixProof",
      uses: ["DataSecurityIssueGroupFixProof.proveForProject"],
    },
    {
      module:
        "Common/Server/Utils/AI/DataSecurity/DataSecurityIssueGroupNaming",
      uses: ["DataSecurityIssueGroupNaming.nameGroups"],
    },
    // A waiting proposal expired, on each issue's timeline (#10741): fixed words, no model.
    {
      module:
        "Common/Server/Utils/AI/DataSecurity/DataSecurityIssueGroupTimelines",
      uses: [
        "GroupProposalExpiry",
        "DataSecurityIssueGroupTimelines.expireWaitingForGroup",
      ],
    },
    {
      module:
        "Common/Server/Utils/AI/DataSecurity/DataSecurityIssueGroupProposals",
      uses: ["DataSecurityIssueGroupProposals.proposeForGroups"],
    },
    {
      module: "Common/Server/Utils/AI/Remediation/DeclaredCodeOwner",
      uses: [
        "DeclaredCodeOwnerCandidate",
        "getRepositoryFullName",
        "DeclaredCodeOwner.rank",
        "DeclaredCodeOwner.getBest",
      ],
    },
    {
      module: "Common/Server/Utils/AI/ResourceAccess/CloudAiTargets",
      uses: ["CloudAiTargets.getManagedAsCode"],
    },
  ],
  "Common/Server/Utils/DataSecurity/DataSecurityIssueGroups.ts": [
    {
      module: "Common/Server/Services/AIService",
      uses: ["AIService.isProjectAIEnabled"],
    },
    // A cut-down group's pull request, for a reader held to labels (#10739): reads only.
    {
      module: "Common/Server/Utils/AI/CodeFix/DataSecurityFixTarget",
      uses: [
        "DataSecurityFixTarget.readTask",
        "DataSecurityFixTarget.issueIdsOfTask",
      ],
    },
    {
      module: "Common/Server/Utils/AI/ResourceAccess/CloudAiTargets",
      uses: ["CloudAiTargets.getManagedAsCode"],
    },
  ],
  "Common/Server/Utils/DataSecurity/DataSecurityIssueGroupFix.ts": [
    {
      module: "Common/Server/Services/AIRunService",
      uses: ["AIRunService.findOneBy"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiInput",
      uses: ["AiGroupFixStore", "DataSecurityAiCodeRequest"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityCodeTask",
      uses: [
        "DataSecurityFixCode",
        "getDataSecurityFixNoRepositoryMessage",
        "DataSecurityCodeTask.requestGroupFix",
      ],
    },
    {
      module:
        "Common/Server/Utils/AI/DataSecurity/DataSecurityIssueGroupPrompt",
      uses: ["buildIssueGroupFixRequest"],
    },
    // The waiting proposals a fix asked another way expires (#10741): fixed words, no model.
    {
      module:
        "Common/Server/Utils/AI/DataSecurity/DataSecurityIssueGroupTimelines",
      uses: [
        "GroupProposalExpiry",
        "DataSecurityIssueGroupTimelines.expireWaitingForGroup",
      ],
    },
    {
      module: "Common/Server/Utils/AI/CodeTask/CodeTaskAccess",
      uses: [
        "CodeTaskAccess.listReadableRepositoriesByIds",
        "CodeTaskAccess.listAskableRepositoryIds",
        "CodeTaskAccess.findReadableRepository",
      ],
    },
    {
      module: "Common/Server/Utils/AI/CodeTask/CodeTaskGate",
      uses: ["CodeTaskGate.getBlocker"],
    },
    {
      module: "Common/Server/Utils/AI/CodeTask/CodeTaskListRows",
      uses: [
        "CodeTaskRepliesRead",
        "CodeTaskListRows.readReplies",
        "CodeTaskListRows.readPullRequests",
        "CodeTaskListRows.key",
      ],
    },
    {
      module: "Common/Server/Utils/AI/CodeTask/CodeTaskThread",
      uses: ["CodeTaskThread.findTasksHiddenFrom"],
    },
    {
      module: "Common/Server/Utils/AI/Remediation/DeclaredCodeOwner",
      uses: [
        "DeclaredCodeOwnerCandidate",
        "getRepositoryFullName",
        "DeclaredCodeOwner.findCandidates",
        "DeclaredCodeOwner.getBest",
      ],
    },
    {
      module: "Common/Server/Utils/AI/ResourceAccess/CloudAiTargets",
      uses: ["CloudAiTargets.getManagedAsCode"],
    },
  ],
  /*
   * Where an issue's fix in code stands, read for its page (#10367): the
   * task, its pull request and what production showed - reads that ask no
   * model.
   */
  "Common/Server/Utils/DataSecurity/DataSecurityIssueCodeFix.ts": [
    {
      module: "Common/Server/Services/AIRunService",
      uses: ["AIRunService.findOneBy"],
    },
    {
      module: "Common/Server/Utils/AI/CodeFix/FixProductionReportUtil",
      uses: ["FixProductionReportUtil.fromPullRequest"],
    },
    {
      module: "Common/Server/Utils/AI/CodeTask/CodeTaskAccess",
      uses: ["CodeTaskAccess.listReadableRepositories"],
    },
    {
      module: "Common/Server/Utils/AI/CodeTask/CodeTaskListRows",
      uses: [
        "CodeTaskRepliesRead",
        "CodeTaskListRows.readReplies",
        "CodeTaskListRows.readPullRequests",
        "CodeTaskListRows.key",
      ],
    },
    {
      module: "Common/Server/Utils/AI/CodeTask/CodeTaskThread",
      uses: ["CodeTaskThread.findTasksHiddenFrom"],
    },
    {
      module: "Common/Server/Utils/AI/Remediation/DeclaredCodeOwner",
      uses: ["getRepositoryFullName"],
    },
  ],
  /*
   * A service's telemetry leaks fixed in its code (#10367): asked for
   * through the Code task's gate (DataSecurityCodeTask
   * .requestTelemetryLeakFix asks CodeTaskGate.getBlocker before it builds
   * the task's request), by a person or by TelemetryLeakFixProposals; the
   * rest says whether a fix is on its way and where it may be asked, and
   * asks no model.
   */
  "Common/Server/Utils/DataSecurity/TelemetryLeakFix.ts": [
    {
      module: "Common/Server/Services/AIRunService",
      uses: ["AIRunService.findOneBy"],
    },
    {
      module: "Common/Server/Utils/AI/CodeFix/CodeFixOnItsWay",
      uses: ["CodeFixOnItsWay.findTaskId", "CodeFixOnItsWay.ofTelemetryLeaks"],
    },
    {
      module: "Common/Server/Utils/AI/CodeTask/CodeTaskAccess",
      uses: ["CodeTaskAccess.listReadableRepositories"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityAiInput",
      uses: ["DataSecurityAiCodeRequest"],
    },
    {
      module: "Common/Server/Utils/AI/DataSecurity/DataSecurityCodeTask",
      uses: [
        "DataSecurityCodeTask.requestTelemetryLeakFix",
        "DataSecurityCodeTask.getAskableRepositories",
      ],
    },
    {
      module:
        "Common/Server/Utils/AI/DataSecurity/DataSecurityTelemetryFixPrompt",
      uses: ["buildTelemetryLeakFixRequest"],
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
      /*
       * The words of the dialog Fix with AI opens on an issue in a service's
       * telemetry (#10367), shown before its pull request is asked for.
       */
      [path.join("Components", "DataSecurity", "TelemetryFixCopy.ts")]: [
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
    // A telemetry issue's Fix with AI dialog (#10367) is opened by Fix with AI alone.
    expect(page.split('setDialog("telemetryFix")').length).toBe(2);
    expect(
      page.slice(
        page.indexOf("const fixWithAi: () => Promise<void>"),
        page.indexOf("await askForFix();"),
      ),
    ).toContain('setDialog("telemetryFix")');
  });
});
