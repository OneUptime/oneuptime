import {
  CodeAgent,
  CodeAgentType,
  getCodeAgentDisplayName,
  isValidCodeAgentType,
} from "./CodeAgentInterface";
import InHouseCodeAgent from "./InHouseCodeAgent";
import OpenCodeAgent from "./OpenCodeAgent";
import logger from "Common/Server/Utils/Logger";

// Factory class to create code agents
export default class CodeAgentFactory {
  /*
   * Default agent type: the in-house server-mediated agent (B4 Tier 0).
   * CODE_AGENT_TYPE=OpenCode selects the deprecated raw-key OpenCode
   * shell-out for one release — see Internal/Roadmap/CodeFixSandboxDesign.md.
   */
  private static defaultAgentType: CodeAgentType =
    CodeAgentFactory.resolveDefaultAgentTypeFromEnvironment();

  private static resolveDefaultAgentTypeFromEnvironment(): CodeAgentType {
    const configuredType: string | undefined = process.env["CODE_AGENT_TYPE"];

    if (configuredType && isValidCodeAgentType(configuredType)) {
      if (configuredType === CodeAgentType.OpenCode) {
        logger.warn(
          "CODE_AGENT_TYPE=OpenCode selects the DEPRECATED raw-key OpenCode fallback (kept for one release). The in-house metered agent is the default — unset CODE_AGENT_TYPE to use it.",
        );
      }
      return configuredType;
    }

    if (configuredType) {
      logger.warn(
        `Unknown CODE_AGENT_TYPE "${configuredType}" — using the default in-house code agent.`,
      );
    }

    return CodeAgentType.InHouse;
  }

  // Create an agent of the specified type
  public static createAgent(type: CodeAgentType): CodeAgent {
    logger.debug(`Creating code agent: ${getCodeAgentDisplayName(type)}`);

    switch (type) {
      case CodeAgentType.InHouse:
        return new InHouseCodeAgent();

      case CodeAgentType.OpenCode:
        return new OpenCodeAgent();

      default:
        throw new Error(`Unknown code agent type: ${type}`);
    }
  }

  // Create the default agent
  public static createDefaultAgent(): CodeAgent {
    return this.createAgent(this.defaultAgentType);
  }

  // Set the default agent type
  public static setDefaultAgentType(type: CodeAgentType): void {
    this.defaultAgentType = type;
  }

  // Get the default agent type
  public static getDefaultAgentType(): CodeAgentType {
    return this.defaultAgentType;
  }

  // Get all available agent types
  public static getAvailableAgentTypes(): Array<CodeAgentType> {
    return Object.values(CodeAgentType);
  }

  // Check if an agent type is available on the system
  public static async isAgentAvailable(type: CodeAgentType): Promise<boolean> {
    try {
      const agent: CodeAgent = this.createAgent(type);
      return await agent.isAvailable();
    } catch (error) {
      logger.error(`Error checking agent availability for ${type}:`);
      logger.error(error);
      return false;
    }
  }

  // Get the first available agent
  public static async getFirstAvailableAgent(): Promise<CodeAgent | null> {
    for (const type of this.getAvailableAgentTypes()) {
      if (await this.isAgentAvailable(type)) {
        return this.createAgent(type);
      }
    }
    return null;
  }

  /*
   * Create agent with fallback
   * Tries to create the specified type, falls back to first available
   */
  public static async createAgentWithFallback(
    preferredType?: CodeAgentType,
  ): Promise<CodeAgent> {
    // If preferred type is specified and available, use it
    if (preferredType && (await this.isAgentAvailable(preferredType))) {
      return this.createAgent(preferredType);
    }

    // Try the default type
    if (await this.isAgentAvailable(this.defaultAgentType)) {
      return this.createAgent(this.defaultAgentType);
    }

    // Fall back to first available
    const agent: CodeAgent | null = await this.getFirstAvailableAgent();

    if (!agent) {
      throw new Error("No code agents are available on this system");
    }

    return agent;
  }
}
