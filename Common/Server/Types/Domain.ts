import logger, { LogAttributes } from "../Utils/Logger";
import DomainCommon from "../../Types/Domain";
import { PromiseRejectErrorFunction } from "../../Types/FunctionTypes";
import dns from "dns";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import API from "../../Utils/API";
import DataSourceEgressGuard from "../Utils/DataSource/EgressGuard";

export default class Domain extends DomainCommon {
  /*
   * GET a domain-verification URL built from a tenant-supplied domain.
   *
   * Both the status page and the dashboard build these URLs by interpolating
   * a customer domain into a string, and the certificate cron re-fetches them
   * unattended every 15 minutes — so the target has to be validated on every
   * call, not just when the row was written. The address that was validated
   * is pinned into the socket, and redirects are refused so a 3xx cannot
   * bounce the request to a host that was never checked. (The callers try
   * http first and https second, so the ordinary http→https redirect a
   * customer proxy emits is still covered by the https attempt.)
   *
   * Private ranges stay reachable on self-hosted installs, where a status page
   * domain legitimately resolves inside the corporate network.
   */
  @CaptureSpan()
  public static async getForDomainVerification(data: {
    url: string;
    targetLabel: string;
  }): Promise<HTTPErrorResponse | HTTPResponse<JSONObject>> {
    const { httpAgent, httpsAgent } =
      await DataSourceEgressGuard.assertUrlAllowedAndPin(data.url, {
        targetLabel: data.targetLabel,
      });

    return API.get<JSONObject>({
      url: URL.fromString(data.url),
      options: {
        doNotFollowRedirects: true,
        httpAgent,
        httpsAgent,
      },
    });
  }

  @CaptureSpan()
  public static getCnameRecords(data: { domain: string }): Promise<string[]> {
    return new Promise(
      (resolve: (value: string[]) => void, reject: (error: Error) => void) => {
        dns.resolveCname(
          data.domain,
          (err: Error | null, addresses: string[]) => {
            const domainLogAttributes: LogAttributes = {
              domain: data.domain,
            };

            if (err) {
              logger.debug(
                `DNS CNAME lookup failed for domain ${data.domain}: ${err.message}`,
                domainLogAttributes,
              );

              // Handle specific DNS error types with user-friendly messages
              if (
                err.message.includes("ENODATA") ||
                err.message.includes("queryCname ENODATA")
              ) {
                reject(
                  new BadDataException(
                    `No CNAME records found for domain "${data.domain}". Please ensure you have added the CNAME record and wait for DNS propagation (up to 72 hours).`,
                  ),
                );
                return;
              }

              if (
                err.message.includes("ENOTFOUND") ||
                err.message.includes("queryCname ENOTFOUND")
              ) {
                reject(
                  new BadDataException(
                    `Domain "${data.domain}" not found. Please check if the domain is correct and accessible.`,
                  ),
                );
                return;
              }

              if (
                err.message.includes("ETIMEDOUT") ||
                err.message.includes("queryCname ETIMEDOUT")
              ) {
                reject(
                  new BadDataException(
                    `DNS lookup timeout for domain "${data.domain}". Please try again later.`,
                  ),
                );
                return;
              }

              // Generic DNS error fallback
              reject(
                new BadDataException(
                  `Unable to verify CNAME record for domain "${data.domain}". DNS Error: ${err.message}. Please check your DNS configuration and try again.`,
                ),
              );
            } else if (addresses.length > 0) {
              resolve(addresses);
            } else {
              reject(
                new BadDataException(
                  "No CNAME record found for domain: " + data.domain,
                ),
              );
            }
          },
        );
      },
    );
  }

  @CaptureSpan()
  public static verifyTxtRecord(
    domain: Domain | string,
    verificationText: string,
  ): Promise<boolean> {
    return new Promise(
      (
        resolve: (isVerfified: boolean) => void,
        reject: PromiseRejectErrorFunction,
      ) => {
        dns.resolveTxt(
          domain.toString(),
          (err: Error | null, data: Array<Array<string>>) => {
            const domainLogAttributes: LogAttributes = {
              domain: domain.toString(),
            };

            if (err) {
              logger.debug(
                `DNS TXT lookup failed for domain ${domain.toString()}: ${err.message}`,
                domainLogAttributes,
              );

              // Handle specific DNS error types with user-friendly messages
              if (
                err.message.includes("ENODATA") ||
                err.message.includes("queryTxt ENODATA")
              ) {
                return reject(
                  new BadDataException(
                    `No TXT records found for domain "${domain.toString()}". Please ensure you have added the TXT record and wait for DNS propagation (up to 72 hours).`,
                  ),
                );
              }

              if (
                err.message.includes("ENOTFOUND") ||
                err.message.includes("queryTxt ENOTFOUND")
              ) {
                return reject(
                  new BadDataException(
                    `Domain "${domain.toString()}" not found. Please check if the domain is correct and accessible.`,
                  ),
                );
              }

              if (
                err.message.includes("ETIMEDOUT") ||
                err.message.includes("queryTxt ETIMEDOUT")
              ) {
                return reject(
                  new BadDataException(
                    `DNS lookup timeout for domain "${domain.toString()}". Please try again later.`,
                  ),
                );
              }

              // Generic DNS error fallback
              return reject(
                new BadDataException(
                  `Unable to verify TXT record for domain "${domain.toString()}". DNS Error: ${err.message}. Please check your DNS configuration and try again.`,
                ),
              );
            }

            logger.debug("Verify TXT Record", domainLogAttributes);
            logger.debug("Domain " + domain.toString(), domainLogAttributes);
            logger.debug("Data: ", domainLogAttributes);
            logger.debug(data, domainLogAttributes);

            let isVerified: boolean = false;
            for (const item of data) {
              let txt: Array<string> | string = item;
              if (Array.isArray(txt)) {
                txt = (txt as Array<string>).join("");
              }

              if (txt === verificationText) {
                isVerified = true;
                break;
              }
            }

            resolve(isVerified);
          },
        );
      },
    );
  }
}
