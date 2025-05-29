import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import BasicCron from "Common/Server/Utils/BasicCron";
import LocalFile from "Common/Server/Utils/LocalFile";
// @ts-ignore
import logger from "Common/Server/Utils/Logger";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

export default class Jobs {
  public static init(): void {
    BasicCron({
      jobName: "StatusPageCerts:WriteCustomCertsToDisk",
      options: {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
      },
      runFunction: async () => {
        // Fetch all domains where certs are added to greenlock.

        const statusPageDomains: Array<StatusPageDomain> =
          await StatusPageDomainService.findBy({
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
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        for (const cert of statusPageDomains) {
          try {
            await LocalFile.makeDirectory("/etc/nginx/certs/StatusPageCerts");
          } catch (err) {
            // directory already exists, ignore.
            logger.error("Create directory err");
            logger.error(err);
          }

          if (!cert.customCertificate || !cert.customCertificateKey) {
            logger.error(
              "Custom certificate or key is missing for domain: " +
                cert.fullDomain?.toString(),
            );
            continue;
          }

          // Write to disk.
          await LocalFile.write(
            `/etc/nginx/certs/StatusPageCerts/${cert.fullDomain?.toString().trim().toLocaleLowerCase()}.crt`,
            cert.customCertificate?.toString() || "",
          );

          await LocalFile.write(
            `/etc/nginx/certs/StatusPageCerts/${cert.fullDomain?.toString().trim().toLocaleLowerCase()}.key`,
            cert.customCertificateKey?.toString() || "",
          );

          logger.debug(
            `Wrote custom certs to disk for domain: ${cert.fullDomain?.toString().trim().toLocaleLowerCase()}`,
          );
        }
      },
    });
  }
}
