import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import BasicCron from "Common/Server/Utils/BasicCron";
import LocalFile from "Common/Server/Utils/LocalFile";
// @ts-ignore
import logger from "Common/Server/Utils/Logger";
import AcmeCertificate from "Common/Models/DatabaseModels/AcmeCertificate";

export default class Jobs {
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
          await AcmeCertificateService.findBy({
            query: {},
            select: {
              domain: true,
              certificate: true,
              certificateKey: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        for (const cert of certs) {
          try {
            await LocalFile.makeDirectory("/etc/nginx/certs/StatusPageCerts");
          } catch (err) {
            // directory already exists, ignore.
            logger.error("Create directory err");
            logger.error(err);
          }

          // Write to disk.
          await LocalFile.write(
            `/etc/nginx/certs/StatusPageCerts/${cert.domain}.crt`,
            cert.certificate?.toString() || "",
          );

          await LocalFile.write(
            `/etc/nginx/certs/StatusPageCerts/${cert.domain}.key`,
            cert.certificateKey?.toString() || "",
          );
        }
      },
    });
  }
}
