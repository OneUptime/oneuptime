import BadDataException from "../../../Types/Exception/BadDataException";
import LlmConnectionProvider, {
  AllLlmConnectionProviders,
} from "../../../Types/LlmObservability/LlmConnectionProvider";
import AnthropicConnector from "./Connectors/Anthropic/AnthropicConnector";
import AwsBedrockConnector from "./Connectors/AwsBedrock/AwsBedrockConnector";
import AzureOpenAIConnector from "./Connectors/AzureOpenAI/AzureOpenAIConnector";
import ClaudeEnterpriseConnector from "./Connectors/ClaudeEnterprise/ClaudeEnterpriseConnector";
import GoogleVertexAIConnector from "./Connectors/GoogleVertexAI/GoogleVertexAIConnector";
import Microsoft365CopilotConnector from "./Connectors/Microsoft365Copilot/Microsoft365CopilotConnector";
import OpenAIConnector from "./Connectors/OpenAI/OpenAIConnector";
import { LlmConnector } from "./LlmConnectorTypes";

/*
 * Provider -> connector. Connectors are stateless, so one instance of each
 * serves every connection. Every provider of the catalog has one: a test
 * holds the two lists to each other.
 */
const CONNECTORS: Record<LlmConnectionProvider, LlmConnector> = {
  [LlmConnectionProvider.OpenAI]: new OpenAIConnector(),
  [LlmConnectionProvider.Anthropic]: new AnthropicConnector(),
  [LlmConnectionProvider.AzureOpenAI]: new AzureOpenAIConnector(),
  [LlmConnectionProvider.AwsBedrock]: new AwsBedrockConnector(),
  [LlmConnectionProvider.GoogleVertexAI]: new GoogleVertexAIConnector(),
  [LlmConnectionProvider.ClaudeEnterprise]: new ClaudeEnterpriseConnector(),
  [LlmConnectionProvider.Microsoft365Copilot]:
    new Microsoft365CopilotConnector(),
};

export default class LlmConnectorRegistry {
  public static getConnector(provider: LlmConnectionProvider): LlmConnector {
    const connector: LlmConnector | undefined = CONNECTORS[provider];

    if (!connector) {
      throw new BadDataException(`No connector for provider "${provider}".`);
    }

    return connector;
  }

  public static getAllConnectors(): Array<LlmConnector> {
    return AllLlmConnectionProviders.map(
      (provider: LlmConnectionProvider): LlmConnector => {
        return LlmConnectorRegistry.getConnector(provider);
      },
    );
  }
}
