import DatabaseService from "./DatabaseService";
import VercelMarketplaceInstallation from "../../Models/DatabaseModels/VercelMarketplaceInstallation";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<VercelMarketplaceInstallation> {
  public constructor() {
    super(VercelMarketplaceInstallation);
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
