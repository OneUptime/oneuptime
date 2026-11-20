import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import { AiContextActivity } from "../../../../Types/AI/AiContext";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  DataSecurityAiExampleUnavailableReason,
  DataSecurityAiInputExample,
  DataSecurityAiInputResponse,
  DataSecurityAiModelSummary,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import LlmType from "../../../../Types/LLM/LlmType";
import ObjectID from "../../../../Types/ObjectID";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import LlmProviderService from "../../../Services/LlmProviderService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ProjectDataTypeNames from "../../DataSecurity/ProjectDataTypeNames";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AiContextReader from "../AiContext/AiContextReader";
import {
  DataSecurityAiCodeRequest,
  DataSecurityAiPrompt,
  AiFindingRecord,
} from "./DataSecurityAiInput";
import DataSecurityAiReads from "./DataSecurityAiReads";
import {
  buildDataSecurityFixRequest,
  buildExplainIssuePrompt,
} from "./DataSecurityIssuePrompt";

/*
 * WHAT ONEUPTIME AI SEES, FOR DATA SECURITY > SETTINGS > ONEUPTIME AI
 * (#10365).
 *
 * What each feature sends, never sends and keeps is the catalog's
 * (Types/DataSecurity/DataSecurityAiFeatures), which the page draws itself.
 * This answers what only the server knows:
 *
 *   - whether the project's Enable AI is on: with it off, nothing is sent;
 *   - the model each feature runs on when no AI rule picks one - the
 *     project's default provider, else the server's global one, for Explain
 *     and the field suggestions; one of the project's own, else the global
 *     one, for Fix with AI's coding agent - named only to who may read the
 *     project's LLM providers (LlmProvider's readers), never by its key or
 *     its address;
 *   - Show an Example: the exact input Explain with AI would send for one
 *     real issue of the project - the riskiest open one, or the one asked
 *     for - built the way Explain builds it (DataSecurityAiReads, the
 *     project's names for its data types, DataSecurityAiInput), with what
 *     Fix with AI would ask for it. Only for a reader who may read that
 *     issue, read with their own permissions first. The project's AI
 *     context, which goes first in the system message, is said by its
 *     length: it is the project's settings to read, not the issue's.
 */

// The columns a model is named by: never a key, additional parameters or an address.
const MODEL_SELECT: {
  _id: true;
  name: true;
  llmType: true;
  modelName: true;
  isGlobalLlm: true;
  projectId: true;
} = {
  _id: true,
  name: true,
  llmType: true,
  modelName: true,
  isGlobalLlm: true,
  projectId: true,
};

// The kinds of provider a team or an operator runs themselves.
const SELF_HOSTED_TYPES: ReadonlyArray<string> = [
  LlmType.Ollama,
  LlmType.OpenAICompatible,
];

function isRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

export function toModelSummary(
  provider: LlmProvider | null,
): DataSecurityAiModelSummary | null {
  if (!provider) {
    return null;
  }

  const llmType: string = String(provider.llmType || "");

  return {
    name: provider.name || "",
    llmType,
    modelName: provider.modelName || "",
    isProjectProvider: Boolean(provider.projectId) && !provider.isGlobalLlm,
    isSelfHosted: SELF_HOSTED_TYPES.includes(llmType),
  };
}

export default class DataSecurityAiSettings {
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    // The reader's own permissions.
    props: DatabaseCommonInteractionProps;
    // Whether to build the example: only once the reader asks to see it.
    withExample: boolean;
    // The issue to show the example for; the riskiest open one without it.
    issueId?: ObjectID | undefined;
  }): Promise<DataSecurityAiInputResponse> {
    const [isAiEnabled, models, example]: [
      boolean,
      Pick<
        DataSecurityAiInputResponse,
        "canReadModels" | "projectModel" | "codeAgentModel"
      >,
      Pick<DataSecurityAiInputResponse, "example" | "exampleUnavailableReason">,
    ] = await Promise.all([
      this.isAiEnabled(data.projectId),
      this.readModels(data),
      data.withExample
        ? this.readExample(data)
        : Promise.resolve({ example: null }),
    ]);

    return {
      isAiEnabled,
      ...models,
      ...example,
    };
  }

  private static async isAiEnabled(projectId: ObjectID): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { enableAi: true },
      props: { isRoot: true },
    });

    // NOT NULL DEFAULT true: only an explicit false is off.
    return project?.enableAi !== false;
  }

  /*
   * The models, as the reader may read the project's providers: the
   * project's default, else one of its own for the coding agent, else the
   * server's global one - which the chat's provider picker lists to every
   * member - for both.
   */
  private static async readModels(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<
    Pick<
      DataSecurityAiInputResponse,
      "canReadModels" | "projectModel" | "codeAgentModel"
    >
  > {
    let projectDefault: LlmProvider | null;
    let projectOwn: LlmProvider | null;

    try {
      projectDefault = await LlmProviderService.findOneBy({
        query: { projectId: data.projectId, isDefault: true },
        select: MODEL_SELECT,
        props: data.props,
      });
      projectOwn =
        projectDefault ||
        (await LlmProviderService.findOneBy({
          query: { projectId: data.projectId },
          select: MODEL_SELECT,
          sort: { createdAt: SortOrder.Ascending },
          props: data.props,
        }));
    } catch (error) {
      if (isRefusal(error)) {
        return {
          canReadModels: false,
          projectModel: null,
          codeAgentModel: null,
        };
      }

      throw error;
    }

    const global: LlmProvider | null =
      projectDefault && projectOwn
        ? null
        : await LlmProviderService.findOneBy({
            query: { projectId: QueryHelper.isNull(), isGlobalLlm: true },
            select: MODEL_SELECT,
            props: { isRoot: true },
          });

    return {
      canReadModels: true,
      projectModel: toModelSummary(projectDefault || global),
      codeAgentModel: toModelSummary(projectOwn || global),
    };
  }

  private static async readExample(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    issueId?: ObjectID | undefined;
  }): Promise<
    Pick<DataSecurityAiInputResponse, "example" | "exampleUnavailableReason">
  > {
    let readable: DataSecurityIssue | null;

    // The reader's own read first: an issue they may not read shows nothing.
    try {
      readable = await DataSecurityIssueService.findOneBy({
        query: data.issueId
          ? { _id: data.issueId, projectId: data.projectId }
          : {
              projectId: data.projectId,
              status: DataSecurityIssueStatus.Open,
            },
        select: { _id: true, title: true },
        sort: { riskScore: SortOrder.Descending },
        props: data.props,
      });
    } catch (error) {
      if (isRefusal(error)) {
        return {
          example: null,
          exampleUnavailableReason:
            DataSecurityAiExampleUnavailableReason.NoPermission,
        };
      }

      throw error;
    }

    if (!readable?.id) {
      return {
        example: null,
        exampleUnavailableReason:
          DataSecurityAiExampleUnavailableReason.NoIssue,
      };
    }

    return { example: await this.buildExample(data.projectId, readable.id) };
  }

  // What Explain with AI, and Fix with AI, would send for the issue.
  public static async buildExample(
    projectId: ObjectID,
    issueId: ObjectID,
  ): Promise<DataSecurityAiInputExample> {
    const issue: DataSecurityIssue = await DataSecurityAiReads.readIssue({
      projectId,
      issueId,
    });
    const [places, dataTypeNamer, aiContext]: [
      Array<AiFindingRecord>,
      DataTypeNamer,
      AiContextActivity | null,
    ] = await Promise.all([
      DataSecurityAiReads.readPlaces({ projectId, issue }),
      ProjectDataTypeNames.read({ projectId }),
      AiContextReader.read({ projectId }),
    ]);
    // As Explain builds it, but the AI context, which is said by its length.
    const prompt: DataSecurityAiPrompt = buildExplainIssuePrompt({
      issue,
      findings: places,
      dataTypeNamer,
    });
    const request: DataSecurityAiCodeRequest = buildDataSecurityFixRequest(
      issue,
      places,
      dataTypeNamer,
    );

    return {
      dataSecurityIssueId: issueId.toString(),
      issueTitle: issue.title || issue.checkId || "",
      system: prompt.instructions,
      data: prompt.data,
      fixRequest: request.text,
      aiContextCharacterCount: aiContext?.characterCount || 0,
    };
  }
}
