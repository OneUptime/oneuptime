import VercelMarketplaceInstallation from "../../../Models/DatabaseModels/VercelMarketplaceInstallation";
import DatabaseService from "../../../Server/Services/DatabaseService";
import VercelMarketplaceInstallationService from "../../../Server/Services/VercelMarketplaceInstallationService";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnFind } from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * A Vercel installation's access token is for the server's own calls to
 * Vercel. The master-admin API serves the rest of the row - its status and
 * billing errors - but never the token.
 */

type FindHook = (
  findBy: FindBy<VercelMarketplaceInstallation>,
) => Promise<OnFind<VercelMarketplaceInstallation>>;

const onBeforeFind: FindHook = (
  VercelMarketplaceInstallationService as unknown as {
    onBeforeFind: FindHook;
  }
).onBeforeFind.bind(VercelMarketplaceInstallationService);

const selectAfterHook: (
  props: DatabaseCommonInteractionProps,
) => Promise<Record<string, unknown>> = async (
  props: DatabaseCommonInteractionProps,
): Promise<Record<string, unknown>> => {
  const onFind: OnFind<VercelMarketplaceInstallation> = await onBeforeFind({
    query: {},
    select: VercelMarketplaceInstallationService.getInstallationSelect(),
    props: props,
  } as unknown as FindBy<VercelMarketplaceInstallation>);

  return onFind.findBy.select as Record<string, unknown>;
};

describe("VercelMarketplaceInstallationService", () => {
  it("never serves the access token through the API, to a master admin either", async () => {
    const select: Record<string, unknown> = await selectAfterHook({
      userId: ObjectID.generate(),
      isMasterAdmin: true,
    });

    expect(select["accessToken"]).toBeUndefined();
    expect(select).toMatchObject({
      installationId: true,
      status: true,
      lastBillingError: true,
    });
  });

  it("reads the access token for the server's own calls", async () => {
    const select: Record<string, unknown> = await selectAfterHook({
      isRoot: true,
    });

    expect(select["accessToken"]).toBe(true);
  });

  it("has a find hook of its own, so BaseAPI runs its list and count in turn", () => {
    expect(
      (
        VercelMarketplaceInstallationService as unknown as {
          onBeforeFind: unknown;
        }
      ).onBeforeFind,
    ).not.toBe(
      (DatabaseService.prototype as unknown as { onBeforeFind: unknown })
        .onBeforeFind,
    );
  });
});
