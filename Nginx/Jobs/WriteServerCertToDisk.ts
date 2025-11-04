import { Host, ProvisionSsl } from "Common/Server/EnvironmentConfig";
import AcmeCertificate from "Common/Models/DatabaseModels/AcmeCertificate";
import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import BasicCron from "Common/Server/Utils/BasicCron";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import Domain from "Common/Types/Domain";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import NginxConfigurator from "../Utils/NginxConfigurator";

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

        const certificatePem: string = certificate.certificate.toString();
        const certificateKeyPem: string = certificate.certificateKey.toString();

        const existingCertificate: string | null =
          (await LocalFile.doesFileExist(certificatePath))
            ? await LocalFile.read(certificatePath)
            : null;
        const existingKey: string | null =
          (await LocalFile.doesFileExist(keyPath))
            ? await LocalFile.read(keyPath)
            : null;

        const certificateChanged: boolean =
          existingCertificate !== certificatePem ||
          existingKey !== certificateKeyPem;

        if (!certificateChanged) {
          logger.debug(
            `${JOB_NAME}: certificate for ${hostnameOnly} already up to date; no changes written.`,
          );
          try {
            await NginxConfigurator.ensurePrimarySslConfigured({
              hostname: hostnameOnly,
              forceReload: false,
            });
          } catch (err) {
            logger.error(
              `${JOB_NAME}: failed to ensure nginx configuration for ${hostnameOnly} while certificate unchanged.`,
            );
            logger.error(err);
          }
          return;
        }

        await LocalFile.write(certificatePath, certificatePem);
        await LocalFile.write(keyPath, certificateKeyPem);

        logger.debug(
          `${JOB_NAME}: wrote certificate for ${hostnameOnly} to disk.`,
        );

        try {
          await NginxConfigurator.ensurePrimarySslConfigured({
            hostname: hostnameOnly,
            forceReload: true,
          });
        } catch (err) {
          logger.error(
            `${JOB_NAME}: failed to reload nginx after writing certificate for ${hostnameOnly}.`,
          );
          logger.error(err);
        }
      },
    });
  }
}
