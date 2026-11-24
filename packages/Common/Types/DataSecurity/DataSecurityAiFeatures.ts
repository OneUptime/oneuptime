import { translationKey } from "../Translator";

/*
 * WHAT ONEUPTIME AI DOES IN DATA SECURITY, AND WHAT EACH PART OF IT SENDS
 * (#10365).
 *
 * A data security product that sends its findings to a model has made a new
 * copy of what it protects. So this is the one list of Data Security's AI
 * features, and of what each one sends: names, shapes, counts and
 * configuration only - never a value of the data, a masked sample, a record
 * or a connection string. Every place that says what OneUptime AI is told
 * says it from here:
 *
 *   - Data Security > Settings > OneUptime AI (What OneUptime AI Sees) draws
 *     each feature: what it sends, what it never sends, whether it runs on
 *     its own, the model it runs on and what is kept of it;
 *   - the docs (data-security/ai.md) say the same, held to this list by
 *     DataSecurityAiDocsFacts;
 *   - the guard (DataSecurityAiInputGuard) holds the code to it: every model
 *     call a Data Security feature makes is one of these, its input built
 *     through DataSecurityAiInput (Server/Utils/AI/DataSecurity), and what
 *     the AI Logs keep of it is what this says.
 *
 * A new AI feature of Data Security (the analyst on every new issue,
 * containment, owners, the paperwork - #10360) is added here first, with
 * its words, and the guard fails until its code is held to them.
 *
 * Plain data, read by the server and the Dashboard alike; every sentence a
 * person reads is a key (translationKey) the Dashboard words in the
 * reader's language.
 */

export enum DataSecurityAiFeature {
  ExplainIssue = "ExplainIssue",
  FixIssue = "FixIssue",
  SuggestFieldTypes = "SuggestFieldTypes",
  AskAi = "AskAi",
}

// Which LLM provider a feature's calls run on.
export enum DataSecurityAiModelSource {
  /*
   * The provider an AI rule for the issue picks (#10364), else the
   * project's default LLM provider, else the server's global one.
   */
  ProjectProvider = "ProjectProvider",
  /*
   * The coding agent's: the provider an AI rule picks, else one of the
   * project's own providers, else the server's global one.
   */
  CodeAgent = "CodeAgent",
  // Ask AI's: the provider picked in the chat, else the project's default.
  Chat = "Chat",
}

export interface DataSecurityAiFeatureInfo {
  feature: DataSecurityAiFeature;
  // Its name, as its button or page says it.
  title: string;
  // Who or what starts it, in a sentence.
  startedBy: string;
  // Whether it runs with no person waiting on it: started by a scan.
  runsOnItsOwn: boolean;
  // What it sends, each a short sentence.
  sends: ReadonlyArray<string>;
  // What it never sends, though it reads the issue or the store it is about.
  neverSends: ReadonlyArray<string>;
  // What it leaves behind besides its AI Logs row, in a sentence.
  keeps: string;
  /*
   * Whether a failed call's AI Logs row keeps the provider's error, which
   * can quote what was sent (#10457). The guard reads it from the call.
   */
  keepsProviderErrors: boolean;
  modelSource: DataSecurityAiModelSource;
}

/*
 * What no Data Security feature ever sends a model - the project's own
 * included - said once over the list.
 */
export const NEVER_SENT_TO_ONEUPTIME_AI: ReadonlyArray<string> = [
  translationKey("A value of your data"),
  translationKey("A masked sample, such as j***@e******.com"),
  translationKey("A record of your telemetry: a log line, a span or a session"),
  translationKey("A connection string, a key or any other secret"),
];

/*
 * What every feature's AI Logs row keeps: which feature called which model,
 * its tokens and its cost, never the prompt or the answer
 * (storeContentPreviews: false, held by the guard).
 */
export const DATA_SECURITY_AI_LOGS_KEEP: string = translationKey(
  "In the AI Logs: the feature, the model, the tokens and the cost. Never what was sent or answered.",
);

// ...and, where keepsProviderErrors says so, a failed call's error.
export const DATA_SECURITY_AI_LOGS_KEEP_PROVIDER_ERRORS: string =
  translationKey(
    "When a call fails, its AI Logs row also keeps the provider's error, which can quote what was sent.",
  );

export const DATA_SECURITY_AI_FEATURES: ReadonlyArray<DataSecurityAiFeatureInfo> =
  [
    {
      feature: DataSecurityAiFeature.ExplainIssue,
      title: translationKey("Explain with AI"),
      startedBy: translationKey("A person, on an issue's page."),
      runsOnItsOwn: false,
      sends: [
        translationKey(
          "The issue's title, severity and evidence, why its check matters and the fix for the store's cloud",
        ),
        translationKey(
          "The store's name, kind, region and cloud ID, its sensitivity and the names of its data types",
        ),
        translationKey(
          "For a telemetry issue, where each kind of data was found: the attribute, log body or prompt it sits in",
        ),
      ],
      neverSends: [
        translationKey("A sample of what was found, not even a masked one"),
        translationKey("A record the data was seen in"),
      ],
      keeps: translationKey("The explanation, on the issue's timeline."),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.FixIssue,
      title: translationKey("Fix with AI"),
      startedBy: translationKey(
        "A person, on an issue's page, in a repository they may change in Code.",
      ),
      runsOnItsOwn: false,
      sends: [
        translationKey(
          "What Explain with AI sends, as a request to the coding agent",
        ),
        translationKey(
          "The repository's own code, which the coding agent reads to make the change",
        ),
      ],
      neverSends: [
        translationKey("A sample of what was found, not even a masked one"),
        translationKey("A record the data was seen in"),
      ],
      keeps: translationKey("The task and its pull request, under Code."),
      keepsProviderErrors: true,
      modelSource: DataSecurityAiModelSource.CodeAgent,
    },
    {
      feature: DataSecurityAiFeature.SuggestFieldTypes,
      title: translationKey("Suggestions for fields no detector placed"),
      startedBy: translationKey(
        "A store's content scan, when it finds fields no detector could place.",
      ),
      runsOnItsOwn: true,
      sends: [
        translationKey("The kind of store, and the data types it may name"),
        translationKey(
          "Each field's name, the names of the fields beside it, and the shapes of its values, such as AA-9999 for the value AB-1234",
        ),
        translationKey("How many values were read, and how long they are"),
      ],
      neverSends: [translationKey("A value of the field, nor a masked one")],
      keeps: translationKey(
        "Each suggestion, as a Low finding until a person confirms it.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.AskAi,
      title: translationKey("Ask AI"),
      startedBy: translationKey(
        "A person's question in Ask AI, read with their own permissions.",
      ),
      runsOnItsOwn: false,
      sends: [
        translationKey(
          "The stores, issues and access the person may read in Data Security",
        ),
        translationKey(
          "What was found where: each data type by its location, with counts and confidence",
        ),
      ],
      neverSends: [
        translationKey("A sample of what was found, not even a masked one"),
      ],
      keeps: translationKey("The conversation, for the person who asked."),
      keepsProviderErrors: true,
      modelSource: DataSecurityAiModelSource.Chat,
    },
  ];

// A feature's entry: every feature has one.
export function getDataSecurityAiFeatureInfo(
  feature: DataSecurityAiFeature,
): DataSecurityAiFeatureInfo {
  const info: DataSecurityAiFeatureInfo | undefined =
    DATA_SECURITY_AI_FEATURES.find(
      (entry: DataSecurityAiFeatureInfo): boolean => {
        return entry.feature === feature;
      },
    );

  if (!info) {
    throw new Error(`No Data Security AI feature ${feature}.`);
  }

  return info;
}
