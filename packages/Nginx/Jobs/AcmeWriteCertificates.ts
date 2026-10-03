import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import BasicCron from "Common/Server/Utils/BasicCron";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import AcmeCertificate from "Common/Models/DatabaseModels/AcmeCertificate";

type DomainRow = {
  fullDomain?: string | undefined;
};

export default class Jobs {
  /*
   * The custom domains whose owner uploaded a certificate, lower-cased.
   *
   * nginx serves one file per name, and WriteCustomCertsToDisk writes the
   * uploaded certificate to it. A Let's Encrypt certificate left over from
   * before the switch must not be written over it, or the two jobs overwrite
   * each other's file every 15 minutes and the domain serves whichever ran
   * last. Same test as WriteCustomCertsToDisk: the switch is on and both the
   * certificate and its key are there.
   *
   * null when the domains cannot be read, and then every certificate is
   * written as before: a domain served the wrong certificate now and then is
   * better than every domain left without one.
   */
  public static async getDomainsWithUploadedCertificates(): Promise<Set<string> | null> {
    try {
      const statusPageDomains: Array<DomainRow> =
        await StatusPageDomainService.findAllBy({
          query: {
            isCustomCertificate: true,
            customCertificate: QueryHelper.notNull(),
            customCertificateKey: QueryHelper.notNull(),
          },
          select: {
            fullDomain: true,
          },
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const dashboardDomains: Array<DomainRow> =
        await DashboardDomainService.findAllBy({
          query: {
            isCustomCertificate: true,
            customCertificate: QueryHelper.notNull(),
            customCertificateKey: QueryHelper.notNull(),
          },
          select: {
            fullDomain: true,
          },
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      return new Set<string>(
        [...statusPageDomains, ...dashboardDomains]
          .map((row: DomainRow) => {
            return row.fullDomain?.toString().trim().toLocaleLowerCase() || "";
          })
          .filter((domain: string) => {
            return domain.length > 0;
          }),
      );
    } catch (err) {
      logger.error(
        "Could not read which domains use an uploaded certificate; writing every Let's Encrypt certificate",
        {
          service: "ingress",
          job: "AcmeWriteCertificates",
        },
      );
      logger.error(err, {
        service: "ingress",
        job: "AcmeWriteCertificates",
      });

      return null;
    }
  }

  public static init(): void {
    BasicCron({
      jobName: "StatusPageCerts:WriteAcmeCertsToDisk",
      options: {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
      },
      runFunction: async () => {
        // Fetch all domains where certs are added to greenlock.

        const certs: Array<AcmeCertificate> =
          await AcmeCertificateService.findAllBy({
            query: {},
            select: {
              domain: true,
              certificate: true,
              certificateKey: true,
            },
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        const domainsWithUploadedCertificates: Set<string> | null =
          await Jobs.getDomainsWithUploadedCertificates();

        for (const cert of certs) {
          const domain: string =
            cert.domain?.toString().trim().toLocaleLowerCase() || "";

          if (domainsWithUploadedCertificates?.has(domain)) {
            logger.debug(
              `Not writing the Let's Encrypt certificate of ${domain}: it is served with the certificate its owner uploaded`,
              {
                service: "ingress",
                job: "AcmeWriteCertificates",
                domain: domain,
              },
            );
            continue;
          }

          try {
            await LocalFile.makeDirectory("/etc/nginx/certs/StatusPageCerts");
          } catch (err) {
            // directory already exists, ignore.
            logger.error("Create directory err", {
              service: "ingress",
              job: "AcmeWriteCertificates",
            });
            logger.error(err, {
              service: "ingress",
              job: "AcmeWriteCertificates",
            });
          }

          // Write to disk.
          await LocalFile.write(
            `/etc/nginx/certs/StatusPageCerts/${cert.domain?.toString().trim().toLocaleLowerCase()}.crt`,
            cert.certificate?.toString() || "",
          );

          await LocalFile.write(
            `/etc/nginx/certs/StatusPageCerts/${cert.domain?.toString().trim().toLocaleLowerCase()}.key`,
            cert.certificateKey?.toString() || "",
          );

          logger.debug(
            `Wrote custom certs to disk for domain: ${cert.domain?.toString().trim().toLocaleLowerCase()}`,
            {
              service: "ingress",
              job: "AcmeWriteCertificates",
              domain: cert.domain?.toString().trim().toLocaleLowerCase() || "",
            },
          );
        }
      },
    });
  }
}
