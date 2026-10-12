/*
 * Which Claude model an id names: its family, and its major and minor
 * version.
 *
 * The same Claude model reaches OneUptime under many ids. Anthropic's API
 * writes claude-opus-4-5-20251101, or from the 4.6 generation on a bare
 * claude-opus-4-6; Amazon Bedrock adds a namespace and a version suffix
 * (anthropic.claude-opus-4-5-20251101-v1:0) and a cross-region prefix
 * (us.anthropic..., global.anthropic...); Google Cloud dates a snapshot with
 * "@" (claude-opus-4-5@20251101); OpenRouter puts the provider in front and
 * writes the version with a dot (anthropic/claude-opus-4.5); a gateway may put
 * its own name in front (databricks-claude-opus-4-5). Every one of them reads
 * here as the same model, so the code that has to know which model a request
 * went to asks this one parser:
 *
 *  - ClaudeModels (Common/Server/Utils/LLM), for the request surface a model
 *    accepts on the Anthropic wire;
 *  - the LLM cost catalog (Common/Types/Telemetry/LlmCostCatalog), for the
 *    price a call is charged at.
 *
 * Plain functions of the text, with no server dependency, so they run in the
 * Dashboard as well as at ingest.
 */

export enum ClaudeModelFamily {
  Opus = "opus",
  Sonnet = "sonnet",
  Haiku = "haiku",
  Fable = "fable",
  Mythos = "mythos",
}

export interface ClaudeModelVersion {
  family: ClaudeModelFamily;
  // Undefined for an id without a version, such as claude-mythos-preview.
  major: number | undefined;
  minor: number;
}

/*
 * The current naming scheme, family first: claude-sonnet-5-5,
 * claude-opus-4-7, claude-haiku-4-5-20251001. It is matched anywhere in the
 * id, so the prefixes and suffixes gateways and clouds add still parse:
 * anthropic.claude-sonnet-5-5 (Amazon Bedrock), us.anthropic.claude-opus-4-7
 * (cross-region), anthropic/claude-sonnet-5.5 (OpenRouter, which also writes
 * the version with a dot), claude-haiku-4-5@20251001 (Google Cloud).
 *
 * The minor version is one or two digits that are not followed by another
 * digit, so the date of a dated id is not read as one: claude-opus-4-20250514
 * is Opus 4, not Opus 4.20250514.
 *
 * The older scheme puts the version first (claude-3-5-sonnet-20241022). Those
 * models all take sampling parameters and never think on their own, and they
 * deliberately do not match.
 */
const CLAUDE_MODEL_ID: RegExp =
  /(?:^|[^a-z0-9])claude-(opus|sonnet|haiku|fable|mythos)(?:-(\d+)(?:[-.](\d{1,2})(?!\d))?)?(?![a-z])/i;

export default class ClaudeModelId {
  public static parse(
    modelName: string | undefined,
  ): ClaudeModelVersion | null {
    if (!modelName) {
      return null;
    }

    const match: RegExpMatchArray | null = modelName.match(CLAUDE_MODEL_ID);

    if (!match) {
      return null;
    }

    return {
      family: match[1]!.toLowerCase() as ClaudeModelFamily,
      major: match[2] !== undefined ? parseInt(match[2], 10) : undefined,
      minor: match[3] !== undefined ? parseInt(match[3], 10) : 0,
    };
  }

  /**
   * The model's id the way Anthropic's API writes it, family first and with
   * no date or decoration: claude-opus-4-5 for every shape of Opus 4.5 above,
   * claude-sonnet-4 for Sonnet 4 (claude-sonnet-4-20250514 and
   * claude-sonnet-4-0 alike), claude-fable-5-1, claude-opus-5.
   *
   * Null for an id that names no versioned Claude model of the current
   * scheme: a versionless one (claude-opus-latest, claude-mythos-preview),
   * one of the older scheme (claude-3-5-sonnet-20241022), or no Claude model
   * at all.
   */
  public static canonicalId(modelName: string | undefined): string | null {
    const version: ClaudeModelVersion | null = this.parse(modelName);

    if (!version || version.major === undefined) {
      return null;
    }

    const majorId: string = `claude-${version.family}-${version.major}`;

    return version.minor > 0 ? `${majorId}-${version.minor}` : majorId;
  }
}
