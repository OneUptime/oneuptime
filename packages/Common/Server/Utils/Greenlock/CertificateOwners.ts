import { Host } from "../../EnvironmentConfig";
import DashboardDomainService from "../../Services/DashboardDomainService";
import FormDomainService from "../../Services/FormDomainService";
import StatusPageDomainService from "../../Services/StatusPageDomainService";

export type OwnedDomainsLookup = (
  domains: Array<string>,
) => Promise<Array<string>>;

export interface CertificateOwner {
  name: string;
  // Which of these domains this owner has a certificate in AcmeCertificate for.
  getOwnedDomains: OwnedDomainsLookup;
}

/*
 * Every kind of owner of the certificates in AcmeCertificate.
 *
 * Each owner renews and removes its own certificates through
 * GreenlockUtil.renewAllCertsWhichAreExpiringSoon with its own lookup; this
 * list is for the one job that has to know about all of them at once, the
 * cleanup of certificates nobody owns
 * (GreenlockUtil.removeExpiredCertificatesNobodyOwns).
 *
 * A new kind of custom domain that orders certificates must be added here.
 * Until it is, the cleanup takes its certificates for abandoned ones and
 * deletes them a month after they expire.
 */
export default class CertificateOwners {
  /*
   * The name of the form domains' entry, which FormDomainService leaves out
   * when it asks whether anything else claims a name it is letting go of.
   */
  public static readonly FORM_DOMAINS_OWNER_NAME: string = "form domains";

  // The installation's own HOST, without a port, as CoreSSL orders it.
  public static getPrimaryHostname(host: string = Host): string {
    return (host.trim().toLowerCase().split(":")[0] || "").trim();
  }

  public static getAll(): Array<CertificateOwner> {
    return [
      {
        name: "status page domains",
        getOwnedDomains: async (
          domains: Array<string>,
        ): Promise<Array<string>> => {
          return await StatusPageDomainService.getOwnedDomains(domains);
        },
      },
      {
        name: "dashboard domains",
        getOwnedDomains: async (
          domains: Array<string>,
        ): Promise<Array<string>> => {
          return await DashboardDomainService.getOwnedDomains(domains);
        },
      },
      {
        name: CertificateOwners.FORM_DOMAINS_OWNER_NAME,
        getOwnedDomains: async (
          domains: Array<string>,
        ): Promise<Array<string>> => {
          return await FormDomainService.getOwnedDomains(domains);
        },
      },
      {
        // Ordered and renewed by the CoreSSL job.
        name: "primary host",
        getOwnedDomains: async (
          domains: Array<string>,
        ): Promise<Array<string>> => {
          const primaryHostname: string =
            CertificateOwners.getPrimaryHostname();

          if (!primaryHostname) {
            return [];
          }

          return domains.filter((domain: string) => {
            return domain === primaryHostname;
          });
        },
      },
    ];
  }
}
