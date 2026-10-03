import { JSONArray, JSONObject } from "../JSON";

/*
 * Where one custom domain's free certificate stands: what the domain list's
 * Status column needs beyond the domain's own row.
 *
 * Neither part is on the domain row. The certificate is in the certificate
 * table, shared by every kind of custom domain, and the last failed order is
 * kept in Redis for a few days (CertificateOrderFailures) - an order that
 * fails leaves nothing behind in the database, so without this the Status
 * column said "Issuing a free certificate" for as long as the order kept
 * failing.
 */
export interface CustomDomainCertificate {
  domainId: string;
  // When the domain's certificate expires; undefined while it has none.
  expiresAt?: Date | undefined;
  // Why its last order failed, while no order since has succeeded.
  lastOrderError?: string | undefined;
  lastOrderFailedAt?: Date | undefined;
}

export default class CustomDomainCertificates {
  public static toJSON(certificates: Array<CustomDomainCertificate>): JSONObject {
    return {
      domains: certificates.map(
        (certificate: CustomDomainCertificate): JSONObject => {
          const json: JSONObject = {
            domainId: certificate.domainId,
          };

          if (certificate.expiresAt) {
            json["expiresAt"] = certificate.expiresAt.toISOString();
          }

          if (certificate.lastOrderError) {
            json["lastOrderError"] = certificate.lastOrderError;
          }

          if (certificate.lastOrderFailedAt) {
            json["lastOrderFailedAt"] =
              certificate.lastOrderFailedAt.toISOString();
          }

          return json;
        },
      ),
    };
  }

  /*
   * Reads the answer, by domain id. Anything it does not recognise is left
   * out rather than guessed at: a domain missing here is shown from its own
   * row alone, as it was before this existed.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): Map<string, CustomDomainCertificate> {
    const certificates: Map<string, CustomDomainCertificate> = new Map<
      string,
      CustomDomainCertificate
    >();

    const domains: unknown = json?.["domains"];

    if (!Array.isArray(domains)) {
      return certificates;
    }

    for (const entry of domains as JSONArray) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const item: JSONObject = entry as JSONObject;
      const domainId: unknown = item["domainId"];

      if (typeof domainId !== "string" || !domainId) {
        continue;
      }

      const certificate: CustomDomainCertificate = { domainId: domainId };

      const expiresAt: Date | undefined = CustomDomainCertificates.readDate(
        item["expiresAt"],
      );

      if (expiresAt) {
        certificate.expiresAt = expiresAt;
      }

      const lastOrderError: unknown = item["lastOrderError"];

      if (typeof lastOrderError === "string" && lastOrderError.trim()) {
        certificate.lastOrderError = lastOrderError.trim();

        const lastOrderFailedAt: Date | undefined =
          CustomDomainCertificates.readDate(item["lastOrderFailedAt"]);

        if (lastOrderFailedAt) {
          certificate.lastOrderFailedAt = lastOrderFailedAt;
        }
      }

      certificates.set(domainId, certificate);
    }

    return certificates;
  }

  // An ISO string as sent, or a Date if the client's JSON reader made one.
  private static readDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? undefined : value;
    }

    if (typeof value !== "string" || !value) {
      return undefined;
    }

    const date: Date = new Date(value);

    return isNaN(date.getTime()) ? undefined : date;
  }
}
