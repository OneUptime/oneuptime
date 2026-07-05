import StartupMigrationBase from "./StartupMigrationBase";
import ObjectID from "Common/Types/ObjectID";
import LlmType from "Common/Types/LLM/LlmType";
import ColumnLength from "Common/Types/Database/ColumnLength";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmProviderService from "Common/Server/Services/LlmProviderService";
import logger from "Common/Server/Utils/Logger";

/*
 * Declaratively syncs a single Global LLM Provider row from the
 * GLOBAL_LLM_PROVIDER_* env vars on every boot:
 * - GLOBAL_LLM_PROVIDER_TYPE set   -> create or update the seeded row.
 * - GLOBAL_LLM_PROVIDER_TYPE unset -> delete the seeded row if it exists.
 *
 * The row uses a fixed well-known id so only the env-managed row is ever
 * touched — global providers created by admins in the Admin Dashboard are
 * never affected. The Helm chart sets these env vars when the bundled vLLM
 * is enabled (vllm.enabled + vllm.globalProvider.enabled), and docker
 * compose users can set them to register any provider (e.g. a local Ollama).
 */
export default class SeedGlobalLlmProviderFromEnv extends StartupMigrationBase {
  public static readonly seededGlobalLlmProviderId: ObjectID = new ObjectID(
    "00000000-0000-0000-0000-000000000001",
  );

  public constructor() {
    super("SeedGlobalLlmProviderFromEnv");
  }

  public override async migrate(): Promise<void> {
    const seedId: ObjectID =
      SeedGlobalLlmProviderFromEnv.seededGlobalLlmProviderId;
    const llmTypeEnv: string = process.env["GLOBAL_LLM_PROVIDER_TYPE"] || "";

    const existing: LlmProvider | null = await LlmProviderService.findOneById({
      id: seedId,
      select: {
        _id: true,
        name: true,
        description: true,
        llmType: true,
        modelName: true,
        baseUrl: true,
        apiKey: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!llmTypeEnv) {
      if (existing) {
        await LlmProviderService.deleteOneById({
          id: seedId,
          props: {
            isRoot: true,
          },
        });
        logger.info(
          "GLOBAL_LLM_PROVIDER_TYPE is unset: removed the env-seeded global LLM provider.",
        );
      }
      return;
    }

    if (!Object.values(LlmType).includes(llmTypeEnv as LlmType)) {
      logger.error(
        `GLOBAL_LLM_PROVIDER_TYPE "${llmTypeEnv}" is not a valid LLM type. Valid values: ${Object.values(
          LlmType,
        ).join(", ")}. Skipping the global LLM provider seed.`,
      );
      return;
    }

    const llmType: LlmType = llmTypeEnv as LlmType;
    /*
     * Truncate cosmetic fields to their column caps so an over-long name can
     * never fail the whole seed.
     */
    const name: string = (
      process.env["GLOBAL_LLM_PROVIDER_NAME"] || "Global LLM Provider"
    ).substring(0, ColumnLength.Name);
    const description: string = (
      process.env["GLOBAL_LLM_PROVIDER_DESCRIPTION"] || ""
    ).substring(0, ColumnLength.Description);
    const baseUrl: string = process.env["GLOBAL_LLM_PROVIDER_BASE_URL"] || "";
    const modelName: string =
      process.env["GLOBAL_LLM_PROVIDER_MODEL_NAME"] || "";
    const apiKey: string = process.env["GLOBAL_LLM_PROVIDER_API_KEY"] || "";

    /*
     * A truncated base URL would be a broken URL, so skip with a clear error
     * instead. This can happen when the Helm-generated in-cluster URL
     * (release + namespace + cluster domain) exceeds the column cap.
     */
    if (baseUrl.length > ColumnLength.ShortURL) {
      logger.error(
        `GLOBAL_LLM_PROVIDER_BASE_URL is ${baseUrl.length} characters; the maximum is ${ColumnLength.ShortURL}. Skipping the global LLM provider seed - use a shorter Helm release/namespace name or set an explicit shorter base URL.`,
      );
      return;
    }

    /*
     * Mirror LLMService's per-type requirements so a misconfiguration
     * surfaces in the boot log instead of only as per-request failures.
     * Still seed (warn-and-seed) so the declarative sync semantics hold.
     */
    const missing: Array<string> = [];
    if (llmType !== LlmType.Ollama && !apiKey) {
      missing.push("GLOBAL_LLM_PROVIDER_API_KEY");
    }
    if (
      (llmType === LlmType.AzureOpenAI || llmType === LlmType.Ollama) &&
      !baseUrl
    ) {
      missing.push("GLOBAL_LLM_PROVIDER_BASE_URL");
    }
    if (missing.length > 0) {
      logger.error(
        `Global LLM provider type "${llmType}" requires ${missing.join(
          " and ",
        )} to be set - AI requests will fail until it is. For keyless OpenAI-compatible servers (e.g. vLLM without VLLM_API_KEY), set GLOBAL_LLM_PROVIDER_API_KEY to any placeholder value.`,
      );
    }

    if (existing) {
      const isUnchanged: boolean =
        (existing.name || "") === name &&
        (existing.description || "") === description &&
        existing.llmType === llmType &&
        (existing.modelName || "") === modelName &&
        (existing.baseUrl || "") === baseUrl &&
        (existing.apiKey || "") === apiKey;

      /*
       * Skip the no-op write: apiKey encryption is salted, so an
       * unconditional update would rewrite the row on every boot.
       */
      if (isUnchanged) {
        return;
      }

      await LlmProviderService.updateOneById({
        id: seedId,
        data: {
          name: name,
          description: description,
          llmType: llmType,
          modelName: modelName,
          baseUrl: baseUrl,
          apiKey: apiKey,
          isGlobalLlm: true,
          isDefault: false,
        },
        props: {
          isRoot: true,
        },
      });
      logger.info(
        `Updated the env-seeded global LLM provider "${name}" (${llmType}).`,
      );
      return;
    }

    const provider: LlmProvider = new LlmProvider();
    provider.id = seedId;
    provider.name = name;
    provider.llmType = llmType;
    /*
     * Explicit: the model defaults isGlobalLlm to false, and onBeforeCreate
     * would force isDefault to true if left undefined.
     */
    provider.isGlobalLlm = true;
    provider.isDefault = false;
    if (description) {
      provider.description = description;
    }
    if (modelName) {
      provider.modelName = modelName;
    }
    if (baseUrl) {
      provider.baseUrl = baseUrl;
    }
    if (apiKey) {
      provider.apiKey = apiKey;
    }

    await LlmProviderService.create({
      data: provider,
      props: {
        isRoot: true,
      },
    });
    logger.info(
      `Created the env-seeded global LLM provider "${name}" (${llmType}).`,
    );
  }
}
