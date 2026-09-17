import LlmModelPriceModel from "Common/Models/DatabaseModels/LlmModelPrice";
import DatabaseService from "Common/Server/Services/DatabaseService";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { LlmModelPrice } from "Common/Types/Telemetry/LlmCostCatalog";

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const MAX_CACHED_PROJECTS: number = 10_000;

const modelPriceCache: InMemoryTTLCache<Array<LlmModelPrice>> =
  new InMemoryTTLCache<Array<LlmModelPrice>>(MAX_CACHED_PROJECTS);

/*
 * Per-project custom LLM prices for span-ingest cost computation. Loaded
 * once per ingest batch with the same 60s in-process cache the trace scrub
 * rules use, and handed to LlmSpanUtil.extract as catalog-shaped entries
 * (Common/Types/Telemetry/LlmCostCatalog.ts) so the price lookup can weigh
 * them against the built-in catalog.
 */
export class LlmModelPriceService {
  public static async loadModelPrices(
    projectId: ObjectID,
  ): Promise<Array<LlmModelPrice>> {
    const cacheKey: string = projectId.toString();
    const cached: Array<LlmModelPrice> | undefined =
      modelPriceCache.get(cacheKey);

    // Empty arrays are truthy — zero-override projects stay negatively cached.
    if (cached) {
      return cached;
    }

    const service: DatabaseService<LlmModelPriceModel> =
      new DatabaseService<LlmModelPriceModel>(LlmModelPriceModel);

    const rows: Array<LlmModelPriceModel> = await service.findBy({
      query: {
        projectId: projectId,
        isEnabled: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: {
        modelPrefix: SortOrder.Ascending,
      },
      select: {
        modelPrefix: true,
        inputPricePerMillionTokensInUSD: true,
        outputPricePerMillionTokensInUSD: true,
      },
      props: {
        isRoot: true,
      },
    });

    const entries: Array<LlmModelPrice> = [];

    for (const row of rows) {
      /*
       * The service normalizes and validates on write, but rows predating a
       * rule change (or edited out-of-band) must not poison span pricing —
       * skip anything unpriceable instead of trusting it.
       */
      const modelPrefix: string = (row.modelPrefix || "").trim().toLowerCase();
      const inputPrice: number | undefined =
        row.inputPricePerMillionTokensInUSD;
      const outputPrice: number | undefined =
        row.outputPricePerMillionTokensInUSD;

      if (
        !modelPrefix ||
        typeof inputPrice !== "number" ||
        !isFinite(inputPrice) ||
        inputPrice < 0 ||
        typeof outputPrice !== "number" ||
        !isFinite(outputPrice) ||
        outputPrice < 0
      ) {
        continue;
      }

      entries.push({
        modelPrefix: modelPrefix,
        inputPricePerMillionTokensInUSD: inputPrice,
        outputPricePerMillionTokensInUSD: outputPrice,
      });
    }

    modelPriceCache.set(cacheKey, entries, CACHE_TTL_MS);

    return entries;
  }
}

export default LlmModelPriceService;
