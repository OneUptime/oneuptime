import DatabaseConfig from "../../DatabaseConfig";
import { LetsEncryptAccountKey } from "../../EnvironmentConfig";
import Protocol from "../../../Types/API/Protocol";

/*
 * Which of a published page's custom domains its links name, and over which
 * protocol - the rule a status page's links have always followed
 * (StatusPageService.getUsableCustomDomain), for a dashboard's and a form's
 * custom domains too (DashboardDomain, FormDomain): an email's link, and
 * where single sign-on sends somebody back to.
 *
 *   - a domain with the free certificate in place, first;
 *   - else one with its own certificate, once its record is found;
 *   - else, on an installation that issues no free certificates (no Let's
 *     Encrypt account key: the operator's own proxy ends TLS), one whose
 *     record is found;
 *   - else none: the page's address on OneUptime's own domain.
 *
 * A domain with a certificate is known to answer over HTTPS; one with only
 * its record found answers over the installation's own protocol, so an
 * HTTP-only installation gets http:// links that work.
 */

export interface CustomDomainForLink {
  fullDomain?: string | undefined;
  isSslProvisioned?: boolean | undefined;
  isCustomCertificate?: boolean | undefined;
  isCnameVerified?: boolean | undefined;
}

export default class UsableCustomDomain {
  public static pick<T extends CustomDomainForLink>(
    domains: Array<T>,
    data?: { issuesFreeCertificates?: boolean | undefined },
  ): T | null {
    const issuesFreeCertificates: boolean =
      data?.issuesFreeCertificates ?? Boolean(LetsEncryptAccountKey);

    const named: Array<T> = domains.filter((domain: T): boolean => {
      return Boolean(domain.fullDomain);
    });

    return (
      named.find((domain: T): boolean => {
        return Boolean(domain.isSslProvisioned);
      }) ||
      named.find((domain: T): boolean => {
        return Boolean(domain.isCustomCertificate && domain.isCnameVerified);
      }) ||
      (!issuesFreeCertificates
        ? named.find((domain: T): boolean => {
            return Boolean(domain.isCnameVerified);
          })
        : undefined) ||
      null
    );
  }

  // The protocol a link to the domain is written with.
  public static async getProtocol(
    domain: CustomDomainForLink,
  ): Promise<Protocol> {
    if (domain.isSslProvisioned || domain.isCustomCertificate) {
      return Protocol.HTTPS;
    }

    return await DatabaseConfig.getHttpProtocol();
  }

  /*
   * The address a link names: the usable domain's, else `fallbackPath` on
   * OneUptime's own address ("/public-dashboard/<id>").
   */
  public static async getAddress(data: {
    domains: Array<CustomDomainForLink>;
    fallbackPath: string;
  }): Promise<string> {
    const domain: CustomDomainForLink | null = UsableCustomDomain.pick(
      data.domains,
    );

    if (domain?.fullDomain) {
      const protocol: Protocol = await UsableCustomDomain.getProtocol(domain);

      return `${protocol}${domain.fullDomain}`;
    }

    const host: string = (await DatabaseConfig.getHost()).toString();
    const protocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return `${protocol}${host}${data.fallbackPath}`;
  }
}
