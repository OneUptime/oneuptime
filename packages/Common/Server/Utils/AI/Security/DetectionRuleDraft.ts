import { DetectionRuleDefinition } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import {
  DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH,
  isDetectionRuleDraftDescription,
} from "../../../../Types/SecurityEvent/DetectionRuleAiDraft";
import {
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import PromptText from "../../../../Utils/AI/PromptText";
import SigmaRuleSetParser, {
  sigmaRulesOf,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import SecurityWatchlist from "../../../../Models/DatabaseModels/SecurityWatchlist";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLISTS_PER_PROJECT_MAX,
  SigmaWatchlists,
  getSecurityWatchlistNameKey,
} from "../../../../Types/SecurityEvent/SecurityWatchlist";
import {
  bindSigmaWatchlists,
  getDetectionRuleWatchlistReferences,
  getMissingSigmaWatchlists,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaWatchlists";
import AIService, {
  AI_DETECTION_RULE_DRAFT_FEATURE,
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Services/AIService";
import SecurityWatchlistService from "../../../Services/SecurityWatchlistService";
import { LLMMessage } from "../../LLM/LLMService";
import logger from "../../Logger";
import SigmaClickhouseCompiler from "../../SecurityEvent/Sigma/SigmaClickhouseCompiler";

/*
 * A DETECTION RULE, WRITTEN BY ONEUPTIME AI FROM A DESCRIPTION.
 *
 * On the Detection Rules form, "Describe what to catch" takes a sentence -
 * "ten failed sign-ins from one IP address in five minutes" - and
 * OneUptime AI writes the Sigma rule for it into the form's YAML, for the
 * person to read, change and save. Nothing is saved by this: the form
 * saves, through the same validation as a rule written by hand.
 *
 * The draft is checked here exactly as DetectionRuleService checks a rule
 * on save - parsed whole and every Sigma rule compiled - so the form never
 * receives YAML it would refuse. A draft that does not pass is sent back to
 * the model once with what was wrong; one that still does not pass is
 * refused with the reason. A correlation must hold every rule it reads in
 * its own YAML: a draft never leans on the project's other rules.
 *
 * One request (two at most), started by a person and answered while they
 * wait, so it is held to the interactive limits: one attempt per call,
 * within the proxy's budget, metered and billed like any other request -
 * and inside the project's daily AI limits, not the autonomous budget.
 *
 * The project's watchlists go with the description - their names, what
 * each holds and what it is for, never their values - so "a sign-in by a
 * VIP outside office hours" reads the team's own vip_users list. A draft
 * may read only those lists.
 */

export { DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH };
const DRAFT_MAX_OUTPUT_TOKENS: number = 2000;
// How many times the model may write the rule: once, and once more to fix it.
export const DETECTION_RULE_DRAFT_MAX_ATTEMPTS: number = 2;

/*
 * Rules from the Rule Library the prompt shows as examples: a single rule,
 * a counting sequence and a first-seen correlation. One the library no
 * longer has is left out.
 */
const EXAMPLE_RULE_IDS: ReadonlyArray<string> = [
  "50e60fa4-eddb-4138-b68b-1f928a8f1f10",
  "1e112332-583d-4fd9-b688-9b5d715d5896",
  "e65a43a0-6eb3-4441-beff-ecdfc5f0b8f4",
];

export const DETECTION_RULE_DRAFT_SYSTEM_PROMPT: string = `You write Sigma detection rules for OneUptime's Security Events. Write exactly ONE rule file in YAML that detects what the user describes, and nothing else: no prose, no explanation, no Markdown fences.

The events are OCSF-normalized, with these typed fields (use them by these names):
- text: className (e.g. Authentication, Process Activity, Network Activity, DNS Activity, Account Change, Detection Finding), activityName, categoryName, statusName (Success, Failure), severityName, message, vendorName, productName, ruleName, principalUser, principalHost, principalIp, principalProcess, processName, processPath, processCommandLine, parentProcessName, parentProcessPath, parentProcessCommandLine, targetUser, targetHost, targetIp, targetResource
- numbers: classUid, categoryUid, severityId, targetPort
- arrays: mitreTactics, mitreTechniques, observables
Common spellings work too (CommandLine, Image, ParentImage, User, src_ip, dst_ip, DestinationPort). Any other field name is read from the event's original attributes by its exact path (e.g. eventType for Okta, outcome.result).

Matching is case-insensitive. Modifiers: |contains, |startswith, |endswith, |all, |re, |cidr, |gt, |gte, |lt, |lte, |cased, and |expand, which matches a field against one of the project's watchlists, written alone as principalUser|expand: '%vip_users%'. Read a watchlist only when the request lists one that fits what the user describes.

A rule with one detection fires on every matching event. To count, sequence or find something new, write a Sigma correlation in the SAME file - the correlation first, then each rule it reads, separated by "---", each read rule with its own "name:" - of one of these types:
- event_count: at least N matching events per group within a timespan (condition: gte: N)
- value_count: at least N distinct values of a field per group (condition: field: <field>, gte: N)
- temporal: all of the named rules match for the same group within a timespan
- temporal_ordered: the named rules match in that order within a timespan
- new_value: a value of a field never seen for the group in the timespan before (condition: field: <field>)
group-by takes the typed fields above. A timespan is at most 24h, except new_value's history, at most 30d.

Always write: title, id (a new random UUID v4), description (one sentence), level (informational, low, medium, high or critical) and, when you know them, MITRE ATT&CK tags (attack.<tactic>, attack.t<number>).

Examples of valid rules:`;

const DRAFT_INSTRUCTION: string =
  "Write the Sigma rule file for this. Answer with the YAML only.";

export interface DetectionRuleDraftResult {
  sigmaRuleYaml: string;
  title: string;
  isCorrelation: boolean;
}

// A watchlist as the request names it: never its values.
export interface DetectionRuleDraftWatchlist {
  name: string;
  holds: string;
  description: string;
}

// What a watchlist's description may take of the request.
const DRAFT_WATCHLIST_DESCRIPTION_MAX_LENGTH: number = 200;

/*
 * The YAML in a model's answer: what a code fence holds when it wrote one
 * (it was told not to), else the whole answer. Read with indexOf, in one
 * pass.
 */
export function extractDraftYaml(answer: string): string {
  const text: string = (answer || "").trim();
  const fence: string = "```";
  const open: number = text.indexOf(fence);

  if (open === -1) {
    return text;
  }

  const lineEnd: number = text.indexOf("\n", open);

  if (lineEnd === -1) {
    return text;
  }

  const close: number = text.indexOf(fence, lineEnd + 1);

  return (
    close === -1 ? text.slice(lineEnd + 1) : text.slice(lineEnd + 1, close)
  ).trim();
}

/*
 * Whether a draft is a rule OneUptime would save: parsed whole, holding
 * every rule it reads, and each Sigma rule compiled. Returns what it is, or
 * throws with what is wrong.
 */
export function validateDraftYaml(
  yaml: string,
  options: { watchlistNames?: ReadonlyArray<string> | undefined } = {},
): DetectionRuleDraftResult {
  let definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);

  if (
    definition.kind === "correlation" &&
    definition.unresolvedReferences.length > 0
  ) {
    throw new BadDataException(
      `the correlation reads rules the file does not hold: ${definition.unresolvedReferences.join(", ")}. Write each rule it reads into the same file, with its name.`,
    );
  }

  /*
   * A draft reads only the project's watchlists: each is compiled as a list
   * with nothing on it, which is all a check of the rule's shape needs.
   */
  if (getDetectionRuleWatchlistReferences(definition).length > 0) {
    const available: SigmaWatchlists = {};

    for (const name of options.watchlistNames || []) {
      available[getSecurityWatchlistNameKey(name)] = {
        name,
        entityType: SecurityEntityType.Other,
        exactValues: [],
        patterns: [],
        ranges: [],
      };
    }

    const missing: Array<string> = getMissingSigmaWatchlists(
      definition,
      available,
    );

    if (missing.length > 0) {
      throw new BadDataException(
        `the rule reads watchlists the project does not have: ${missing.join(", ")}. Read only the watchlists the request lists, or match the values in the rule itself.`,
      );
    }

    definition = bindSigmaWatchlists(definition, available);
  }

  for (const rule of sigmaRulesOf(definition)) {
    SigmaClickhouseCompiler.compile(rule);
  }

  return {
    sigmaRuleYaml: yaml,
    title:
      definition.kind === "single"
        ? definition.rule.title || ""
        : definition.correlation.title || "",
    isCorrelation: definition.kind === "correlation",
  };
}

export function buildDraftMessages(
  description: string,
  watchlists: ReadonlyArray<DetectionRuleDraftWatchlist> = [],
): Array<LLMMessage> {
  const examples: Array<string> = EXAMPLE_RULE_IDS.map(
    (id: string): DetectionRuleLibraryEntry | undefined => {
      return getDetectionRuleLibraryEntry(id);
    },
  )
    .filter((entry: DetectionRuleLibraryEntry | undefined): boolean => {
      return Boolean(entry);
    })
    .map((entry: DetectionRuleLibraryEntry | undefined): string => {
      return `# ${entry!.title}\n${entry!.sigmaRuleYaml.trim()}`;
    });

  return [
    {
      role: "system",
      content: `${DETECTION_RULE_DRAFT_SYSTEM_PROMPT}\n\n${examples.join("\n\n# ---- next example ----\n\n")}`,
    },
    {
      role: "user",
      content: `${DRAFT_INSTRUCTION}\n\nWhat to detect: ${JSON.stringify(
        PromptText.field(description, {
          maxLength: DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH,
        }),
      )}${
        watchlists.length > 0
          ? `\n\nThe project's watchlists (a rule reads one as field|expand: '%name%'): ${JSON.stringify(
              watchlists.map(
                (watchlist: DetectionRuleDraftWatchlist): object => {
                  return {
                    name: watchlist.name,
                    holds: watchlist.holds,
                    description: PromptText.field(watchlist.description, {
                      maxLength: DRAFT_WATCHLIST_DESCRIPTION_MAX_LENGTH,
                    }),
                  };
                },
              ),
            )}`
          : ""
      }`,
    },
  ];
}

/*
 * The project's watchlists, as the request names them. A read that fails
 * leaves them out: the draft is written without them, and one that names a
 * list is refused by the check.
 */
async function readDraftWatchlists(
  projectId: ObjectID,
): Promise<Array<DetectionRuleDraftWatchlist>> {
  try {
    const watchlists: Array<SecurityWatchlist> =
      await SecurityWatchlistService.findAllBy({
        query: {
          projectId,
        },
        select: {
          name: true,
          entityType: true,
          description: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: SECURITY_WATCHLISTS_PER_PROJECT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return watchlists
      .filter((watchlist: SecurityWatchlist): boolean => {
        return Boolean(watchlist.name);
      })
      .map((watchlist: SecurityWatchlist): DetectionRuleDraftWatchlist => {
        return {
          name: watchlist.name || "",
          holds: watchlist.entityType || SecurityEntityType.Other,
          description: watchlist.description || "",
        };
      });
  } catch (error) {
    logger.warn(
      "DetectionRuleDraft: could not read the project's watchlists; drafting without them.",
    );
    logger.warn(error);
    return [];
  }
}

export default class DetectionRuleDraft {
  public static async draft(data: {
    projectId: ObjectID;
    userId?: ObjectID | undefined;
    description: string;
  }): Promise<DetectionRuleDraftResult> {
    const description: string = (data.description || "").trim();

    if (!isDetectionRuleDraftDescription(description)) {
      throw new BadDataException(
        "Describe what the rule should detect, in a sentence or two.",
      );
    }

    /*
     * Project AI kill switch, before any token is spent: executeWithLogging
     * meters and bills the call but does not read Project.enableAi.
     */
    await AIService.assertProjectAIEnabled(data.projectId);

    const watchlists: Array<DetectionRuleDraftWatchlist> =
      await readDraftWatchlists(data.projectId);
    const messages: Array<LLMMessage> = buildDraftMessages(
      description,
      watchlists,
    );
    const watchlistNames: Array<string> = watchlists.map(
      (watchlist: DetectionRuleDraftWatchlist): string => {
        return watchlist.name;
      },
    );
    let lastError: string = "";

    for (
      let attempt: number = 1;
      attempt <= DETECTION_RULE_DRAFT_MAX_ATTEMPTS;
      attempt++
    ) {
      const request: AILogRequest = {
        projectId: data.projectId,
        feature: AI_DETECTION_RULE_DRAFT_FEATURE,
        messages,
        maxTokens: DRAFT_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        // The person waits on the form: one attempt, within the proxy's budget.
        requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
        requestRetries: 0,
        // The description may name the project's systems: no previews kept.
        storeContentPreviews: false,
      };

      if (data.userId) {
        request.userId = data.userId;
      }

      const response: AILogResponse =
        await AIService.executeWithLogging(request);

      const yaml: string = extractDraftYaml(response.content || "");

      try {
        return validateDraftYaml(yaml, { watchlistNames });
      } catch (error) {
        lastError =
          error instanceof Error && error.message
            ? error.message
            : String(error);

        // Once more, told what was wrong; the answer is the model's own YAML.
        messages.push({ role: "assistant", content: yaml });
        messages.push({
          role: "user",
          content: `That rule cannot be saved: ${lastError}. Write the corrected rule file. Answer with the YAML only.`,
        });
      }
    }

    throw new BadDataException(
      `OneUptime AI could not write a rule OneUptime can run for that description (${lastError}). Try describing it differently, or write the rule yourself.`,
    );
  }
}
