import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import EnterpriseMarketplaceBillingUtil, {
  EnterpriseMarketplaceBillingState,
} from "Common/Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import PartialEntity from "Common/Types/Database/PartialEntity";
import ObjectID from "Common/Types/ObjectID";

/*
 * Reads and writes GlobalConfig.enterpriseMarketplaceBilling. Both run as
 * root - it is a license column, refused to everybody else - and writes skip
 * the hooks, as the license client's own writes do.
 */

export interface StoredMarketplaceBilling {
  state: EnterpriseMarketplaceBillingState | null;
  // Used to make each report's idempotency key; null on a brand-new install.
  instanceId: string | null;
}

export default class MarketplaceBillingStore {
  /*
   * The stored billing, or null when the GlobalConfig row does not exist yet
   * (a brand-new installation, before the data migration that creates it).
   */
  public static async load(): Promise<StoredMarketplaceBilling | null> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        _id: true,
        instanceId: true,
        enterpriseMarketplaceBilling: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!config) {
      return null;
    }

    return {
      state: EnterpriseMarketplaceBillingUtil.fromJSON(
        config.enterpriseMarketplaceBilling,
      ),
      instanceId: config.instanceId ? config.instanceId.toString() : null,
    };
  }

  public static async save(
    state: EnterpriseMarketplaceBillingState,
  ): Promise<void> {
    /*
     * Built as a plain record: checking a JSON value against the entity's
     * deep-partial type makes TypeScript recurse without end.
     */
    const update: PartialEntity<GlobalConfig> = {};
    (update as Record<string, unknown>)["enterpriseMarketplaceBilling"] =
      EnterpriseMarketplaceBillingUtil.toJSON(state);

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: update,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  }
}
