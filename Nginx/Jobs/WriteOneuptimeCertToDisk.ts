import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { EnableSslProvisioningForOneuptime, Host, IsDevelopment } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ObjectID from "Common/Types/ObjectID";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";

const CERT_DIRECTORY: string = "/etc/nginx/certs/OneUptime";

export default class WriteOneuptimeCertToDiskJob {
  public static init(): void {
    BasicCron({
      jobName: "OneuptimeCerts:WriteToDisk",
      options: {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
      },
      runFunction: async () => {
        await this.syncCertificateToDisk();
      },
    });
  }

  public static async syncCertificateToDisk(): Promise<void> {
    const originalHost: string = Host.trim();
    const host: string = originalHost.toLowerCase();

    if (!EnableSslProvisioningForOneuptime || !host) {
      await this.removeCertificateFromDisk(originalHost, host);
      return;
    }

    const globalConfig: GlobalConfig | null = await GlobalConfigService.findOneBy({
      query: {
        _id: ObjectID.getZeroObjectID().toString(),
      },
      select: {
        oneuptimeSslCertificate: true,
        oneuptimeSslCertificateKey: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!globalConfig) {
      logger.error(
        "GlobalConfig record not found while attempting to write OneUptime SSL certificate to disk.",
      );
      await this.removeCertificateFromDisk(originalHost, host);
      return;
    }

    const certificate: string | undefined =
      globalConfig.oneuptimeSslCertificate || undefined;
    const certificateKey: string | undefined =
      globalConfig.oneuptimeSslCertificateKey || undefined;

    if (!certificate || !certificateKey) {
      await this.removeCertificateFromDisk(originalHost, host);
      return;
    }

    try {
      await LocalFile.makeDirectory(CERT_DIRECTORY);
    } catch (err) {
      logger.error("Failed to ensure directory for OneUptime certificates exists.");
      logger.error(err);
      return;
    }

    const fileVariants: Array<string> = [host];

    if (originalHost && originalHost !== host) {
      fileVariants.push(originalHost);
    }

    for (const variant of fileVariants) {
      const certPath: string = `${CERT_DIRECTORY}/${variant}.crt`;
      const keyPath: string = `${CERT_DIRECTORY}/${variant}.key`;

      await LocalFile.write(certPath, certificate);
      await LocalFile.write(keyPath, certificateKey);
    }

    logger.debug(
      `Wrote primary OneUptime SSL certificate to disk for host variants: ${fileVariants.join(",")}`,
    );
  }

  private static async removeCertificateFromDisk(
    originalHost: string,
    host: string,
  ): Promise<void> {
    if (!host && !originalHost) {
      return;
    }

    const variants: Set<string> = new Set<string>();

    if (host) {
      variants.add(host);
    }

    if (originalHost) {
      variants.add(originalHost);
    }

    for (const variant of variants) {
      const certPath: string = `${CERT_DIRECTORY}/${variant}.crt`;
      const keyPath: string = `${CERT_DIRECTORY}/${variant}.key`;

      await LocalFile.deleteFile(certPath).catch(() => {
        // ignore delete errors.
      });

      await LocalFile.deleteFile(keyPath).catch(() => {
        // ignore delete errors.
      });
    }

    logger.debug(
      `Removed OneUptime SSL certificate artifacts from disk for host variants: ${Array.from(variants).join(",")}`,
    );
  }
}
