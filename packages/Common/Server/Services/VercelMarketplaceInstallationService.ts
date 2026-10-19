import DatabaseService from "./DatabaseService";
import VercelMarketplaceInstallation from "../../Models/DatabaseModels/VercelMarketplaceInstallation";
import FindBy from "../Types/Database/FindBy";
import { OnFind } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<VercelMarketplaceInstallation> {
  public constructor() {
    super(VercelMarketplaceInstallation);
  }

  /*
   * The access token is for the server's own calls to Vercel, and is never
   * served: not even to a master admin through the API. With it a reader
   * could change the environment variables of every Vercel project connected
   * to the installation.
   */
  protected override async onBeforeFind(
    findBy: FindBy<VercelMarketplaceInstallation>,
  ): Promise<OnFind<VercelMarketplaceInstallation>> {
    if (!findBy.props.isRoot && findBy.select) {
      delete (findBy.select as Record<string, unknown>)["accessToken"];
    }

    return { findBy, carryForward: null };
  }

  // Everything a caller may need to read off an installation, the token included.
  public getInstallationSelect(): Record<string, true> {
    return {
      _id: true,
      installationId: true,
      vercelAccountId: true,
      accessToken: true,
      tokenType: true,
      scopes: true,
      acceptedPolicies: true,
      accountName: true,
      accountUrl: true,
      contactEmail: true,
      contactName: true,
      status: true,
      deleteRequestedAt: true,
      invoicedUntil: true,
      billingDataSentAt: true,
      lastBillingError: true,
      createdAt: true,
    };
  }

  @CaptureSpan()
  public async findByInstallationId(
    installationId: string,
  ): Promise<VercelMarketplaceInstallation | null> {
    return await this.findOneBy({
      query: { installationId: installationId },
      select: this.getInstallationSelect(),
      props: { isRoot: true },
    });
  }
}

export default new Service();
