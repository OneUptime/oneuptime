import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import {
  AiIssueDossier,
  DATA_SECURITY_AI_DATA_RULE,
  DataSecurityAiPrompt,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import DataSecurityAiSettings, {
  toModelSummary,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiSettings";
import DataSecurityIssueDossier from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueDossier";
import {
  buildDataSecurityFixRequest,
  buildIssueAnalysisPrompt,
  getDataSecurityAnalystInstructions,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt";
import ProjectDataTypeNames from "../../../../../Server/Utils/DataSecurity/ProjectDataTypeNames";
import ProjectLanguage from "../../../../../Server/Utils/Notification/ProjectLanguage";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../../Models/DatabaseModels/Project";
import {
  AiContextActivity,
  AiContextSource,
} from "../../../../../Types/AI/AiContext";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import {
  DataSecurityAiExampleUnavailableReason,
  DataSecurityAiInputResponse,
} from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSecurityIssueStatus from "../../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import LlmType from "../../../../../Types/LLM/LlmType";
import ObjectID from "../../../../../Types/ObjectID";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT ONEUPTIME AI SEES, AS DATA SECURITY > SETTINGS > ONEUPTIME AI SHOWS
 * IT (#10365): whether AI is on, the model each feature runs on - to who
 * may read the project's providers - and the exact input one issue would
 * send, to who may read it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10365000-0000-4000-8000-000000000001",
);
const ISSUE_ID: ObjectID = new ObjectID("10365000-0000-4000-8000-0000000000a1");
const READER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: PROJECT_ID,
};

const OLLAMA: LlmProvider = {
  id: ObjectID.generate(),
  name: "Our Ollama",
  llmType: LlmType.Ollama,
  modelName: "llama3.1:70b",
  isGlobalLlm: false,
  projectId: PROJECT_ID,
} as unknown as LlmProvider;

const OPENAI_OF_ITS_OWN: LlmProvider = {
  id: ObjectID.generate(),
  name: "Team OpenAI",
  llmType: LlmType.OpenAI,
  modelName: "chat-large",
  isGlobalLlm: false,
  projectId: PROJECT_ID,
} as unknown as LlmProvider;

const GLOBAL: LlmProvider = {
  id: ObjectID.generate(),
  name: "OneUptime AI",
  llmType: LlmType.Anthropic,
  modelName: "chat-large",
  isGlobalLlm: true,
} as unknown as LlmProvider;

function issue(): DataSecurityIssue {
  const row: DataSecurityIssue = new DataSecurityIssue(ISSUE_ID);
  row.projectId = PROJECT_ID;
  row.checkId = "public-read";
  row.title = "Anyone on the internet can read it";
  row.severity = SecuritySeverity.Critical;
  row.evidence = "The bucket policy grants s3:GetObject to *.";
  row.dataTypeIds = ["credit-card-number"];
  const store: DataStore = new DataStore();
  store.name = "acme-card-exports";
  store.kind = DataStoreKind.AwsS3Bucket;
  store.region = "eu-north-1";
  row.dataStore = store;
  return row;
}

// What OneUptime knows about the issue, as its analysis reads it (#10369).
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");

function dossier(): AiIssueDossier {
  const row: DataSecurityIssue = issue();

  return {
    issue: row as never,
    store: row.dataStore as never,
    places: [],
    access: [],
    copies: [],
    securityCaseIds: [],
    responses: [],
    proposals: [],
    declaredCode: null,
    owners: { recordIds: [], names: [], count: 0 },
    now: NOW,
  };
}

interface World {
  enableAi: boolean;
  defaultProvider: LlmProvider | null;
  ownProvider: LlmProvider | null;
  global: LlmProvider | null;
  mayReadProviders: boolean;
  openIssue: DataSecurityIssue | null;
  mayReadIssues: boolean;
  aiContext: AiContextActivity | null;
  language: string;
}

let world: World;
let issueReads: jest.SpyInstance;
let dossierReads: jest.SpyInstance;

beforeEach(() => {
  world = {
    enableAi: true,
    defaultProvider: OLLAMA,
    ownProvider: OLLAMA,
    global: GLOBAL,
    mayReadProviders: true,
    openIssue: issue(),
    mayReadIssues: true,
    aiContext: null,
    language: "en",
  };

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return { id: PROJECT_ID, enableAi: world.enableAi } as unknown as Project;
  }) as never);

  jest.spyOn(LlmProviderService, "findOneBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }) => {
    if (args.query["isGlobalLlm"] === true) {
      expect(args.props).toEqual({ isRoot: true });
      return world.global;
    }

    // The project's own providers: read with the reader's permissions.
    expect(args.props).toBe(READER);

    if (!world.mayReadProviders) {
      throw new NotAuthorizedException("You may not read LLM providers.");
    }

    return args.query["isDefault"] === true
      ? world.defaultProvider
      : world.ownProvider;
  }) as never);

  issueReads = jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation((async (args: {
      props: DatabaseCommonInteractionProps;
    }) => {
      if (args.props === READER) {
        if (!world.mayReadIssues) {
          throw new NotAuthorizedException("You may not read issues.");
        }

        return world.openIssue;
      }

      // The read for AI, as OneUptime, once the reader may read the issue.
      return world.openIssue ? issue() : null;
    }) as never);

  jest.spyOn(DataStoreFindingService, "findBy").mockResolvedValue([]);
  // The read for AI, as OneUptime, once the reader may read the issue.
  dossierReads = jest
    .spyOn(DataSecurityIssueDossier, "read")
    .mockImplementation((async () => {
      return dossier();
    }) as never);
  jest.spyOn(ProjectLanguage, "getLanguage").mockImplementation((async () => {
    return world.language;
  }) as never);
  jest
    .spyOn(ProjectDataTypeNames, "read")
    .mockResolvedValue(DataTypeNamer.withoutCustomTypes());
  jest.spyOn(AiContextReader, "read").mockImplementation((async () => {
    return world.aiContext;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function read(issueId?: ObjectID): Promise<DataSecurityAiInputResponse> {
  return DataSecurityAiSettings.read({
    projectId: PROJECT_ID,
    props: READER,
    withExample: true,
    issueId,
  });
}

describe("whether AI is on", () => {
  test("says the project's Enable AI", async () => {
    expect((await read()).isAiEnabled).toBe(true);

    world.enableAi = false;

    expect((await read()).isAiEnabled).toBe(false);
  });
});

describe("the model each feature runs on", () => {
  test("the project's own self-hosted default, for Explain, the field suggestions and the coding agent", async () => {
    const answer: DataSecurityAiInputResponse = await read();

    expect(answer.canReadModels).toBe(true);
    expect(answer.projectModel).toEqual({
      name: "Our Ollama",
      llmType: LlmType.Ollama,
      modelName: "llama3.1:70b",
      isProjectProvider: true,
      isSelfHosted: true,
    });
    expect(answer.codeAgentModel).toEqual(answer.projectModel);
  });

  test("with no default, the calls run on the server's provider, and the coding agent on one of the project's own", async () => {
    world.defaultProvider = null;
    world.ownProvider = OPENAI_OF_ITS_OWN;

    const answer: DataSecurityAiInputResponse = await read();

    expect(answer.projectModel).toEqual({
      name: "OneUptime AI",
      llmType: LlmType.Anthropic,
      modelName: "chat-large",
      isProjectProvider: false,
      isSelfHosted: false,
    });
    expect(answer.codeAgentModel).toMatchObject({
      name: "Team OpenAI",
      isProjectProvider: true,
      isSelfHosted: false,
    });
  });

  test("with no provider at all, none", async () => {
    world.defaultProvider = null;
    world.ownProvider = null;
    world.global = null;

    const answer: DataSecurityAiInputResponse = await read();

    expect(answer.projectModel).toBeNull();
    expect(answer.codeAgentModel).toBeNull();
  });

  test("named only to who may read the project's providers", async () => {
    world.mayReadProviders = false;

    const answer: DataSecurityAiInputResponse = await read();

    expect(answer).toMatchObject({
      canReadModels: false,
      projectModel: null,
      codeAgentModel: null,
    });
  });

  test("never by its key or its address", async () => {
    world.defaultProvider = null;

    await read();

    const selects: Array<Record<string, unknown>> = (
      LlmProviderService.findOneBy as unknown as jest.SpyInstance
    ).mock.calls.map((call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { select: Record<string, unknown> }).select;
    });

    // The default, one of the project's own, and the server's.
    expect(selects).toHaveLength(3);

    for (const each of selects) {
      expect(each["apiKey"]).toBeUndefined();
      expect(each["baseUrl"]).toBeUndefined();
      expect(each["additionalParams"]).toBeUndefined();
    }
  });

  test("an OpenAI-compatible endpoint, such as the bundled vLLM, is self-hosted; a hosted provider is not", () => {
    expect(
      toModelSummary({
        name: "vLLM",
        llmType: LlmType.OpenAICompatible,
        isGlobalLlm: true,
      } as unknown as LlmProvider),
    ).toMatchObject({ isSelfHosted: true, isProjectProvider: false });

    for (const llmType of [
      LlmType.OpenAI,
      LlmType.Anthropic,
      LlmType.AzureOpenAI,
      LlmType.Groq,
      LlmType.Mistral,
    ]) {
      expect(
        toModelSummary({
          name: "Hosted",
          llmType,
          projectId: PROJECT_ID,
        } as unknown as LlmProvider)?.isSelfHosted,
      ).toBe(false);
    }

    expect(toModelSummary(null)).toBeNull();
  });
});

describe("Show an Example", () => {
  test("the exact input the analysis sends for the project's riskiest open issue, with what Fix with AI asks", async () => {
    const answer: DataSecurityAiInputResponse = await read();
    const expected: DataSecurityAiPrompt = buildIssueAnalysisPrompt({
      feature: DataSecurityAiFeature.ExplainIssue,
      dossier: dossier(),
      language: "en",
      dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
    });

    expect(answer.example).toEqual({
      dataSecurityIssueId: ISSUE_ID.toString(),
      issueTitle: "Anyone on the internet can read it",
      system: `${getDataSecurityAnalystInstructions({ checkId: "public-read", language: "en" })}\n\n${DATA_SECURITY_AI_DATA_RULE}`,
      data: expected.data,
      fixRequest: buildDataSecurityFixRequest(issue()).text,
      aiContextCharacterCount: 0,
    });
    expect(answer.exampleUnavailableReason).toBeUndefined();
    // Read for AI, as OneUptime: the issue the reader may read.
    expect(dossierReads.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      issueId: ISSUE_ID,
    });

    // Picked with the reader's own permissions: the riskiest open issue.
    expect(issueReads.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, status: DataSecurityIssueStatus.Open },
      sort: { riskScore: SortOrder.Descending },
      props: READER,
    });
  });

  test("in the project's language, as the analysis of a new issue asks", async () => {
    world.language = "de";

    expect((await read()).example?.system).toContain("in German.");
  });

  test("the issue asked for, when one is", async () => {
    await read(ISSUE_ID);

    expect(issueReads.mock.calls[0]![0]).toMatchObject({
      query: { _id: ISSUE_ID, projectId: PROJECT_ID },
      props: READER,
    });
  });

  test("the project's AI context is said by its length, never shown", async () => {
    world.aiContext = {
      parts: [
        {
          source: AiContextSource.Project,
          text: "Our buckets are managed in the infra repository.",
        },
      ],
      characterCount: 48,
      estimatedTokenCount: 12,
    };

    const answer: DataSecurityAiInputResponse = await read();

    expect(answer.example?.aiContextCharacterCount).toBe(48);
    expect(JSON.stringify(answer)).not.toContain("infra repository");
  });

  test("only when asked for: opening the page reads no issue", async () => {
    const answer: DataSecurityAiInputResponse =
      await DataSecurityAiSettings.read({
        projectId: PROJECT_ID,
        props: READER,
        withExample: false,
      });

    expect(answer.example).toBeNull();
    expect(answer.exampleUnavailableReason).toBeUndefined();
    expect(issueReads).not.toHaveBeenCalled();
    expect(dossierReads).not.toHaveBeenCalled();
  });

  test("none for a reader who may not read issues, and none for a project with no open issue", async () => {
    world.mayReadIssues = false;

    expect(await read()).toMatchObject({
      example: null,
      exampleUnavailableReason:
        DataSecurityAiExampleUnavailableReason.NoPermission,
    });

    world.mayReadIssues = true;
    world.openIssue = null;

    expect(await read()).toMatchObject({
      example: null,
      exampleUnavailableReason: DataSecurityAiExampleUnavailableReason.NoIssue,
    });
  });
});
