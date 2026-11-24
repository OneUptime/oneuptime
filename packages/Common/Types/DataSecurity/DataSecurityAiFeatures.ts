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
  /*
   * OneUptime AI's analysis of an issue when a person asks (#10369): on its
   * page, or Explain with AI through the API and the MCP.
   */
  ExplainIssue = "ExplainIssue",
  /*
   * The same analysis, written on its own when an issue opens or opens
   * again (#10364's Analyze work).
   */
  AnalyzeIssue = "AnalyzeIssue",
  FixIssue = "FixIssue",
  SuggestFieldTypes = "SuggestFieldTypes",
  /*
   * A verdict on each finding that waits for a person - Confirm, Not
   * sensitive or Cannot tell - with the team's earlier decisions on
   * findings like it as precedent (#10372).
   */
  JudgeFindings = "JudgeFindings",
  AskAi = "AskAi",
  /*
   * Owners for the stores that have none, from the evidence of who owns
   * each - and the owner rules that keep stores like them owned (#10374).
   */
  ProposeStoreOwners = "ProposeStoreOwners",
  /*
   * A name for a group of issues one mistake made (#10370), from the facts
   * its stores share: "the static-site module turns off access logs".
   */
  NameIssueGroup = "NameIssueGroup",
  /*
   * The pull request that fixes a group's cause once, in the module or
   * file that declares its stores (#10370): a task in Code.
   */
  FixIssueGroup = "FixIssueGroup",
  /*
   * The scrub rules for telemetry findings no rule of Scrub It's can hide:
   * a pattern or the attributes to hide, from the data type, its place,
   * the names around it and the shapes of its values - each proven on the
   * records the finding was seen in before it is offered (#10366).
   */
  WriteScrubRules = "WriteScrubRules",
  /*
   * The Sensitive data section of a pull request's production review
   * (#10376): OneUptime AI words, orders and drops what the rules found the
   * change writes to telemetry, does to a store or adds a column for.
   */
  ReviewPullRequests = "ReviewPullRequests",
  /*
   * The record of processing, drafted (#10375): a store's purpose,
   * retention, legal basis and the people it is about, from what the scans
   * know of it - on its own for the stores with personal data, as the
   * project's Data Security AI rules allow, and when a person asks on
   * Review Drafts. Each stays a draft until a person confirms it.
   */
  DraftRecord = "DraftRecord",
  DraftRecordOnRequest = "DraftRecordOnRequest",
  /*
   * A data protection impact assessment for a store that needs one, in
   * GDPR Article 35(7)'s four parts, when a person asks (#10375).
   */
  DraftImpactAssessment = "DraftImpactAssessment",
  /*
   * The paragraph an auditor reads under each framework requirement, from
   * the evidence the scans and the issues' history give, when a person
   * asks (#10375).
   */
  DraftAuditEvidence = "DraftAuditEvidence",
  /*
   * The company's own data types (#10371): a data type drafted from a
   * group of fields scans could not place - the same unknown shape under
   * the same kind of name in several stores - from their names and shapes,
   * then proven on the stores' next scans before anyone is asked.
   */
  DraftDataTypes = "DraftDataTypes",
  /*
   * Describe It on the data type form (#10371): a data type drafted from a
   * sentence a person writes and the shapes of their examples, filled into
   * the form for them to test and save.
   */
  DescribeDataType = "DescribeDataType",
  /*
   * The pull request that stops a service writing sensitive data to its
   * telemetry (#10367): every open telemetry leak of the service in one
   * repository, from the places its records name - a task in Code.
   */
  FixTelemetryLeaks = "FixTelemetryLeaks",
  /*
   * An exposure's assessment written up (#10377): what it means, a notice
   * to the regulator, a notice to the people affected and an internal
   * summary, from the facts plain code worked out - the window, who could
   * read the data, whose data it was, the secrets to rotate and the breach
   * laws that may apply. On its own for a Critical exposure of a store with
   * Restricted or Confidential data, as the project's Data Security AI
   * rules allow, and when a person asks on any case about a store.
   */
  DraftExposureAssessment = "DraftExposureAssessment",
  DraftExposureAssessmentOnRequest = "DraftExposureAssessmentOnRequest",
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
  /*
   * A production review's: the provider the repository picks for its
   * production reviews, else the project's default, else the server's.
   */
  ProductionReview = "ProductionReview",
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

/*
 * What an issue's analysis sends (#10369), on its own or when a person asks:
 * the facts it is written from, each counted, named or bucketed.
 */
const ISSUE_ANALYSIS_SENDS: ReadonlyArray<string> = [
  translationKey(
    "The issue's title, severity and evidence, why its check matters and the steps that fix it",
  ),
  translationKey(
    "The store's name, kind, region, tags and configuration, its sensitivity, the names of its data types and about how many records it holds",
  ),
  translationKey(
    "Who can reach the store: each grant's identity, level and how it is granted, and roughly when it was last used; the services seen using it",
  ),
  translationKey(
    "Copies of its data in other stores, its security cases, the response action that fixes it, and the repository and files that declare it",
  ),
  translationKey("How many owners the store has, never who they are"),
  translationKey(
    "For a telemetry issue, where each kind of data was found: the attribute, log body or prompt it sits in",
  ),
];

const ISSUE_ANALYSIS_NEVER_SENDS: ReadonlyArray<string> = [
  translationKey("A sample of what was found, not even a masked one"),
  translationKey("A record the data was seen in"),
  translationKey("The names or email addresses of the store's owners"),
];

const ISSUE_ANALYSIS_KEEPS: string = translationKey(
  "The analysis, on the issue, with one entry on its timeline for each analysis written.",
);

/*
 * What a store's record drafts send (#10375), on their own or when a person
 * asks: what the scans know of the store and where its data goes.
 */
const RECORD_DRAFT_SENDS: ReadonlyArray<string> = [
  translationKey(
    "The store's name, kind, provider, region, environment and description, the names and categories of its data types and about how many records it holds",
  ),
  translationKey(
    "The services seen using it and what their teams wrote they are for, the hosts and AI providers they send to, and copies of its data in other stores",
  ),
  translationKey(
    "Where its data is: its region's country, where its cloud copies it, and the countries its data types say its people are in",
  ),
  translationKey(
    "Its cloud tags, its backup settings, the retention set for a telemetry store, and the repository and files that declare it",
  ),
];

const RECORD_DRAFT_NEVER_SENDS: ReadonlyArray<string> = [
  translationKey("A sample of what was found, not even a masked one"),
  translationKey("A record the data was seen in"),
  translationKey("The names or email addresses of the store's owners"),
];

const RECORD_DRAFT_KEEPS: string = translationKey(
  "Each draft, beside the store's record with the facts it rests on, until a person confirms it. A field a person wrote is never drafted.",
);

/*
 * What an exposure's write-up sends (#10377), on its own or when a person
 * asks: the facts plain code worked out, never what the store holds.
 */
const EXPOSURE_ASSESSMENT_SENDS: ReadonlyArray<string> = [
  translationKey(
    "The store's name, kind, region and the country it keeps its data in, its sensitivity, the names and categories of its data types and about how many records it holds",
  ),
  translationKey(
    "The exposure's issues, when it started and ended, whether reads were logged, and how many accounts outside the company could read it",
  ),
  translationKey(
    "The secrets found in the store by their type and where they were found, and where the people the data is about live",
  ),
  translationKey(
    "Each breach law that may apply, as plain code worked it out: who must be told, its deadline and what a person still checks",
  ),
];

const EXPOSURE_ASSESSMENT_NEVER_SENDS: ReadonlyArray<string> = [
  translationKey("A sample of what was found, not even a masked one"),
  translationKey("A record the data was seen in"),
  translationKey("A secret's value"),
  translationKey("Who read the data, or who can reach the store, by name"),
];

const EXPOSURE_ASSESSMENT_KEEPS: string = translationKey(
  "What it means and the three drafted notices, on the case, with the facts each rests on, for the case's readers who may read the store's findings. A draft a person edited is never drafted again. Nothing is sent.",
);

export const DATA_SECURITY_AI_FEATURES: ReadonlyArray<DataSecurityAiFeatureInfo> =
  [
    {
      feature: DataSecurityAiFeature.ExplainIssue,
      title: translationKey("Analysis on request"),
      startedBy: translationKey(
        "A person, on an issue's page, or Explain with AI through the API or the MCP.",
      ),
      runsOnItsOwn: false,
      sends: ISSUE_ANALYSIS_SENDS,
      neverSends: ISSUE_ANALYSIS_NEVER_SENDS,
      keeps: ISSUE_ANALYSIS_KEEPS,
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.AnalyzeIssue,
      title: translationKey("Analysis of new issues"),
      startedBy: translationKey(
        "A new or reopened Critical or High issue, while Work on new issues is on, as your Data Security AI rules allow.",
      ),
      runsOnItsOwn: true,
      sends: ISSUE_ANALYSIS_SENDS,
      neverSends: ISSUE_ANALYSIS_NEVER_SENDS,
      keeps: ISSUE_ANALYSIS_KEEPS,
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
          "The issue as its check saw it, the store's name, kind, region and cloud ID, and for a telemetry issue where its data was found, as a request to the coding agent",
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
      feature: DataSecurityAiFeature.JudgeFindings,
      title: translationKey("Verdicts on findings that wait for you"),
      startedBy: translationKey(
        "A store's scan, for its Low findings, OneUptime AI's suggestions and findings that show a sign of a wrong match, as your Data Security AI rules allow.",
      ),
      runsOnItsOwn: true,
      sends: [
        translationKey(
          "Each finding's data type, its field's name and kind, how sure the scan was and its counts, rounded, with any sign of a wrong match",
        ),
        translationKey("The store's name, kind and environment"),
        translationKey(
          "Your team's earlier decisions on findings like it: where each was, what was decided and the reason given, with any value in the reason left out",
        ),
      ],
      neverSends: [
        translationKey("A value of the field, nor a masked one"),
        translationKey("A record the data was seen in"),
      ],
      keeps: translationKey(
        "Each verdict on its finding, until a person decides. It never marks a finding not sensitive, and confirms one on its own only where an AI rule says so.",
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
    {
      feature: DataSecurityAiFeature.ProposeStoreOwners,
      title: translationKey("Owners for data stores"),
      startedBy: translationKey(
        "A store that has no owners: once a day for new stores, and when a cloud connection is first read, as your Data Security AI rules allow.",
      ),
      runsOnItsOwn: true,
      sends: [
        translationKey(
          "The store's name, kind, provider, environment and sensitivity, and the names of its data types",
        ),
        translationKey(
          "What points to an owner: its cloud tags, the services that use it, the code owners of the file that declares it and the changes made to it",
        ),
        translationKey(
          "The teams that evidence names, by name, and the people it names as numbered candidates only",
        ),
      ],
      neverSends: [
        translationKey("A sample of what was found, not even a masked one"),
        translationKey("A person's name or email address"),
      ],
      keeps: translationKey(
        "Each proposal, in Data Security > AI, until a person approves or dismisses it.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.NameIssueGroup,
      title: translationKey("Names for issues with one cause"),
      startedBy: translationKey(
        "A group of issues one mistake made, when it forms or what its stores share changes, while Work on new issues is on.",
      ),
      runsOnItsOwn: true,
      sends: [
        translationKey(
          "What the group's stores share: the module, stack or tag that made them, the identity that created them, or their name pattern",
        ),
        translationKey(
          "The check they fail, how many issues the group holds, the kind of store and the code that declares them",
        ),
      ],
      neverSends: [
        translationKey("The name of any one store in the group"),
        translationKey("A sample of what was found, not even a masked one"),
      ],
      keeps: translationKey(
        "The group's name, beside the facts it was written from. Its issues are never changed.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.FixIssueGroup,
      title: translationKey("Fix the cause"),
      startedBy: translationKey(
        "A person, from a group on the Issues list or by approving OneUptime AI's proposal, in a repository they may change in Code; a security playbook's Fix the code with AI step; or, on its own, an AI rule whose Fix is set to Automatically.",
      ),
      runsOnItsOwn: false,
      sends: [
        translationKey(
          "The check the group's issues fail, what their stores share, and the module or files that declare them, as a request to the coding agent",
        ),
        translationKey(
          "Each store the pull request fixes: its name, kind, region and cloud ID, and its issue",
        ),
        translationKey(
          "The repository's own code, which the coding agent reads to make the change",
        ),
      ],
      neverSends: [
        translationKey("A sample of what was found, not even a masked one"),
        translationKey("A record the data was seen in"),
      ],
      keeps: translationKey(
        "The task and its one pull request, under Code, which each of the group's issues keeps.",
      ),
      keepsProviderErrors: true,
      modelSource: DataSecurityAiModelSource.CodeAgent,
    },
    {
      feature: DataSecurityAiFeature.WriteScrubRules,
      title: translationKey("Scrub rules for what Scrub It cannot cover"),
      startedBy: translationKey(
        "A telemetry issue OneUptime AI contains, for the data no rule of Scrub It's can hide, as your Data Security AI rules allow.",
      ),
      runsOnItsOwn: true,
      sends: [
        translationKey(
          "Each finding's data type, its category and whether it is found by its values or by a field's name",
        ),
        translationKey(
          "Where it sits: the attribute or the log body, and the names of the attributes beside it",
        ),
        translationKey(
          "The shapes of its values, such as AA-9999 for the value AB-1234, and how many values were read",
        ),
      ],
      neverSends: [
        translationKey("A value of the field, nor a masked one"),
        translationKey("A record the data was seen in"),
      ],
      keeps: translationKey(
        "Each rule it wrote, proven on the records the finding was seen in, in Data Security > AI until a person approves or dismisses it - or made on its own, as your AI rules allow.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.ReviewPullRequests,
      title: translationKey("Sensitive data in pull requests"),
      startedBy: translationKey(
        "A pull request's production review, when its rules find sensitive data in the change: written to telemetry, a store left open, or a new column.",
      ),
      runsOnItsOwn: true,
      sends: [
        translationKey(
          "What the rules found in the pull request's diff: the file and line, the name written, the kind of data it names and the check it would fail",
        ),
        translationKey(
          "The diff of those files and the pull request's title, with what looks like a secret, an email address or an IP address left out",
        ),
      ],
      neverSends: [
        translationKey(
          "What production holds: where your telemetry held the data, a store's name or what a store holds",
        ),
        translationKey("A sample of what was found, not even a masked one"),
      ],
      keeps: translationKey(
        "The points, on the pull request's production review in Code and in its comment.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProductionReview,
    },
    {
      feature: DataSecurityAiFeature.DraftRecord,
      title: translationKey("Record of processing drafts"),
      startedBy: translationKey(
        "A store that holds personal data, once a day while Work on new issues is on, as your Data Security AI rules allow.",
      ),
      runsOnItsOwn: true,
      sends: RECORD_DRAFT_SENDS,
      neverSends: RECORD_DRAFT_NEVER_SENDS,
      keeps: RECORD_DRAFT_KEEPS,
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.DraftRecordOnRequest,
      title: translationKey("Record of processing drafts on request"),
      startedBy: translationKey(
        "A person, on Review Drafts or a store's Settings, for its empty fields.",
      ),
      runsOnItsOwn: false,
      sends: RECORD_DRAFT_SENDS,
      neverSends: RECORD_DRAFT_NEVER_SENDS,
      keeps: RECORD_DRAFT_KEEPS,
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.DraftImpactAssessment,
      title: translationKey("Impact assessments"),
      startedBy: translationKey(
        "A person, on the Impact Assessment of a store that needs one.",
      ),
      runsOnItsOwn: false,
      sends: [
        ...RECORD_DRAFT_SENDS,
        translationKey(
          "Its record of processing, its open issues and the ones fixed lately, how exposed it is, who can reach it, counted, and its encryption",
        ),
      ],
      neverSends: RECORD_DRAFT_NEVER_SENDS,
      keeps: translationKey(
        "The assessment, on the store, with the facts each part rests on. A part a person edited is never drafted again.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.DraftAuditEvidence,
      title: translationKey("Audit evidence"),
      startedBy: translationKey(
        "A person, on a framework's Audit Evidence, for the period they picked.",
      ),
      runsOnItsOwn: false,
      sends: [
        translationKey(
          "Each requirement of the framework, the stores in its scope by name, the checks that are evidence for it and how many of them fail",
        ),
        translationKey(
          "How many of its issues opened and were fixed in the period, and how fast",
        ),
        translationKey(
          "The risks accepted under it, with their reasons and expiry, and the resources that turned it off, with theirs",
        ),
      ],
      neverSends: [
        translationKey("A sample of what was found, not even a masked one"),
        translationKey("A record the data was seen in"),
        translationKey("Who accepted a risk or turned a requirement off"),
      ],
      keeps: translationKey(
        "The paragraphs, for the framework and the period, with the facts each rests on. A paragraph a person edited is never drafted again.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.DraftDataTypes,
      title: translationKey("Data types found in your stores"),
      startedBy: translationKey(
        "Your stores' content scans, when three or more fields in two or more stores share a shape and a name no detector knows.",
      ),
      runsOnItsOwn: true,
      sends: [
        translationKey(
          "The names of those fields and of the fields beside them, and the kind of store each is in",
        ),
        translationKey(
          "The shapes of their values, such as AA-9999 for the value AB-1234, and how many values were read",
        ),
        translationKey("The names of the data types OneUptime already knows"),
      ],
      neverSends: [translationKey("A value of the fields, nor a masked one")],
      keeps: translationKey(
        "Each data type it drafts, counted on your stores' next scans, in Data Types to Review until a person adds it or says it is not a data type.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.DescribeDataType,
      title: translationKey("Describe It"),
      startedBy: translationKey(
        "A person, with Describe It on the data type form.",
      ),
      runsOnItsOwn: false,
      sends: [
        translationKey("The sentence the person wrote"),
        translationKey(
          "The shapes of their examples, such as AA-9999 for the example AB-1234",
        ),
      ],
      neverSends: [
        translationKey(
          "The examples themselves: Test It runs them in your browser",
        ),
      ],
      keeps: translationKey(
        "Nothing: the draft fills the form, and nothing is saved until the person saves it.",
      ),
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.FixTelemetryLeaks,
      title: translationKey("Fix leaks in the code"),
      startedBy: translationKey(
        "A person, with Fix with AI on a telemetry issue or by approving OneUptime AI's proposal, in a repository they may change in Code; or, on its own, an AI rule whose Fix is set to Automatically.",
      ),
      runsOnItsOwn: false,
      sends: [
        translationKey(
          "Where the service's code writes each kind of data, as the records it was seen in name it: a file and line, a function, a span's or a logger's name, an exception's own frames and a metric's name",
        ),
        translationKey(
          "Each log line as a template, its values replaced by their types' names, such as User <Email address> signed up",
        ),
        translationKey(
          "Each attribute key and data type, how it should be fixed, and the issues the pull request fixes",
        ),
        translationKey(
          "The repository's own code, which the coding agent reads to make the change",
        ),
      ],
      neverSends: [
        translationKey("A value of your data, nor a masked one"),
        translationKey(
          "A record the data was seen in: a log line as it was logged, a span's attributes, an exception's message",
        ),
        translationKey(
          "What the service sent since: the coding agent reads none of your telemetry while it works",
        ),
      ],
      keeps: translationKey(
        "The task and its one pull request, under Code, which each issue it fixes keeps.",
      ),
      keepsProviderErrors: true,
      modelSource: DataSecurityAiModelSource.CodeAgent,
    },
    {
      feature: DataSecurityAiFeature.DraftExposureAssessment,
      title: translationKey("Exposure assessments"),
      startedBy: translationKey(
        "A security case Data Security opens for a Critical exposure of a store with Restricted or Confidential data, while Work on new issues is on, as your Data Security AI rules allow.",
      ),
      runsOnItsOwn: true,
      sends: EXPOSURE_ASSESSMENT_SENDS,
      neverSends: EXPOSURE_ASSESSMENT_NEVER_SENDS,
      keeps: EXPOSURE_ASSESSMENT_KEEPS,
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
    },
    {
      feature: DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
      title: translationKey("Exposure assessments on request"),
      startedBy: translationKey(
        "A person, on the Was It a Breach? card of any security case about a data store.",
      ),
      runsOnItsOwn: false,
      sends: EXPOSURE_ASSESSMENT_SENDS,
      neverSends: EXPOSURE_ASSESSMENT_NEVER_SENDS,
      keeps: EXPOSURE_ASSESSMENT_KEEPS,
      keepsProviderErrors: false,
      modelSource: DataSecurityAiModelSource.ProjectProvider,
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
