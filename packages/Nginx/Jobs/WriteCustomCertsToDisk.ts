import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import BasicCron from "Common/Server/Utils/BasicCron";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

/*
 * nginx serves every custom domain - status page or dashboard - from this
 * one directory, choosing the files by the TLS server name (see
 * ssl_certificate in default.conf.template). AcmeWriteCertificates writes
 * the Let's Encrypt certificates here; this job writes the ones customers
 * uploaded themselves.
 */
const CUSTOM_DOMAIN_CERTS_DIRECTORY: string =
  "/etc/nginx/certs/StatusPageCerts";

const LOG_ATTRIBUTES: { service: string; job: string } = {
  service: "ingress",
  job: "WriteCustomCertsToDisk",
};

type UploadedCertificate = {
  fullDomain?: string | undefined;
  customCertificate?: string | undefined;
  customCertificateKey?: string | undefined;
};

export default class Jobs {
  public static init(): void {
    BasicCron({
      jobName: "StatusPageCerts:WriteCustomCertsToDisk",
      options: {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
      },
      runFunction: async () => {
        /*
         * Each kind of custom domain is read and written on its own, so a
         * failure reading one never keeps the other's certificates off disk.
         */
        await Jobs.writeUploadedCertificates({
          kind: "status page",
          fetchCertificates: async (): Promise<Array<UploadedCertificate>> => {
            return await StatusPageDomainService.findAllBy({
              query: {
                isCustomCertificate: true,
                customCertificate: QueryHelper.notNull(),
                customCertificateKey: QueryHelper.notNull(),
              },
              select: {
                fullDomain: true,
                customCertificate: true,
                customCertificateKey: true,
              },
              skip: 0,
              props: {
                isRoot: true,
              },
            });
          },
        });

        await Jobs.writeUploadedCertificates({
          kind: "dashboard",
          fetchCertificates: async (): Promise<Array<UploadedCertificate>> => {
            return await DashboardDomainService.findAllBy({
              query: {
                isCustomCertificate: true,
                customCertificate: QueryHelper.notNull(),
                customCertificateKey: QueryHelper.notNull(),
              },
              select: {
                fullDomain: true,
                customCertificate: true,
                customCertificateKey: true,
              },
              skip: 0,
              props: {
                isRoot: true,
              },
            });
          },
        });
      },
    });
  }

  private static async writeUploadedCertificates(data: {
    kind: string;
    fetchCertificates: () => Promise<Array<UploadedCertificate>>;
  }): Promise<void> {
    let certificates: Array<UploadedCertificate> = [];

    try {
      certificates = await data.fetchCertificates();
    } catch (err) {
      logger.error(
        `Could not read the uploaded certificates of ${data.kind} domains`,
        LOG_ATTRIBUTES,
      );
      logger.error(err, LOG_ATTRIBUTES);
      return;
    }

    if (certificates.length === 0) {
      return;
    }

    try {
      await LocalFile.makeDirectory(CUSTOM_DOMAIN_CERTS_DIRECTORY);
    } catch (err) {
      // the directory usually exists already; the writes below say if not.
      logger.error("Create directory err", LOG_ATTRIBUTES);
      logger.error(err, LOG_ATTRIBUTES);
    }

    for (const cert of certificates) {
      const domain: string =
        cert.fullDomain?.toString().trim().toLocaleLowerCase() || "";

      if (!domain) {
        continue;
      }

      if (!cert.customCertificate || !cert.customCertificateKey) {
        logger.error(
          "Custom certificate or key is missing for domain: " + domain,
          {
            ...LOG_ATTRIBUTES,
            domain: domain,
          },
        );
        continue;
      }

      try {
        await LocalFile.write(
          `${CUSTOM_DOMAIN_CERTS_DIRECTORY}/${domain}.crt`,
          cert.customCertificate.toString(),
        );

        await LocalFile.write(
          `${CUSTOM_DOMAIN_CERTS_DIRECTORY}/${domain}.key`,
          cert.customCertificateKey.toString(),
        );

        logger.debug(`Wrote custom certs to disk for domain: ${domain}`, {
          ...LOG_ATTRIBUTES,
          domain: domain,
        });
      } catch (err) {
        // one domain that cannot be written must not keep the rest off disk.
        logger.error(`Could not write custom certs for domain: ${domain}`, {
          ...LOG_ATTRIBUTES,
          domain: domain,
        });
        logger.error(err, { ...LOG_ATTRIBUTES, domain: domain });
      }
    }
  }
}
