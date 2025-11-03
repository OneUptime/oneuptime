import { Host, ProvisionSsl } from "Common/Server/EnvironmentConfig";
import AcmeCertificate from "Common/Models/DatabaseModels/AcmeCertificate";
import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import BasicCron from "Common/Server/Utils/BasicCron";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import Domain from "Common/Types/Domain";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

const JOB_NAME: string = "CoreSSL:WritePrimaryHostCertificateToDisk";
const SERVER_CERTS_DIRECTORY: string = "/etc/nginx/certs/ServerCerts";

export default class WriteServerCertToDiskJob {
  public static init(): void {
    BasicCron({
      jobName: JOB_NAME,
      options: {
        schedule: EVERY_MINUTE,
        runOnStartup: true,
      },
      runFunction: async () => {
        if (!ProvisionSsl) {
          logger.debug(
            `${JOB_NAME}: SSL provisioning disabled; skipping write.`,
          );
          return;
        }

        const normalizedHost: string = Host.trim().toLowerCase();
        const hostnameOnly: string = normalizedHost.split(":")[0] || "";

        if (!hostnameOnly) {
          logger.warn(
            `${JOB_NAME}: HOST environment variable is empty; cannot write certificate.`,
          );
          return;
        }

        if (!Domain.isValidDomain(hostnameOnly)) {
          logger.warn(
            `${JOB_NAME}: HOST "${hostnameOnly}" is not a valid domain; skipping write.`,
          );
          return;
        }

        const certificate: AcmeCertificate | null =
          await AcmeCertificateService.findOneBy({
            query: {
              domain: hostnameOnly,
            },
            select: {
              certificate: true,
              certificateKey: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!certificate?.certificate || !certificate.certificateKey) {
          logger.debug(
            `${JOB_NAME}: certificate data not yet available for ${hostnameOnly}; will retry later.`,
          );
          return;
        }

        await LocalFile.makeDirectory(SERVER_CERTS_DIRECTORY);

        const certificatePath: string = `${SERVER_CERTS_DIRECTORY}/${hostnameOnly}.crt`;
        const keyPath: string = `${SERVER_CERTS_DIRECTORY}/${hostnameOnly}.key`;

        await LocalFile.write(
          certificatePath,
          certificate.certificate.toString(),
        );
        await LocalFile.write(keyPath, certificate.certificateKey.toString());

        logger.debug(
          `${JOB_NAME}: wrote certificate for ${hostnameOnly} to disk.`,
        );
      },
    });
  }
}
