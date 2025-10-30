import GlobalConfigService from "./GlobalConfigService";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import ObjectID from "../../Types/ObjectID";
import Hostname from "../../Types/API/Hostname";
import OneUptimeDate from "../../Types/Date";
import logger from "../Utils/Logger";
import GreenlockUtil from "../Utils/Greenlock/Greenlock";
import {
  EnableSslProvisioningForOneuptime,
  Host,
} from "../EnvironmentConfig";

export default class OneuptimeSslCertificateService {
  private static isProvisioning: boolean = false;

  public static async ensureCertificateProvisioned(): Promise<void> {
    if (!EnableSslProvisioningForOneuptime) {
      logger.debug(
        "Oneuptime SSL provisioning is disabled. Skipping certificate check.",
      );
      return;
    }

    let host: string = Host.trim();

    if (!host) {
      logger.error(
        "ENABLE_SSL_PROVIONING_FOR_ONEUPTIME is true but HOST is not set. Skipping certificate provisioning.",
      );
      return;
    }

    try {
      host = Hostname.fromString(host).toString().toLowerCase();
    } catch (err) {
      logger.error("Failed to parse HOST for SSL provisioning.");
      logger.error(err);
      return;
    }

    if (host === "localhost" || host === "127.0.0.1") {
      logger.warn(
        "Skipping OneUptime SSL provisioning because HOST resolves to a loopback address.",
      );
      return;
    }

    if (this.isProvisioning) {
      logger.debug(
        "SSL provisioning already in progress for OneUptime host. Skipping concurrent run.",
      );
      return;
    }

    const globalConfig: GlobalConfig | null = await GlobalConfigService.findOneBy({
      query: {
        _id: ObjectID.getZeroObjectID().toString(),
      },
      select: {
        oneuptimeSslCertificate: true,
        oneuptimeSslCertificateKey: true,
        oneuptimeSslIssuedAt: true,
        oneuptimeSslExpiresAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!globalConfig) {
      logger.error("GlobalConfig document not found. Unable to provision SSL certificate.");
      return;
    }

    const hasCertificate: boolean = Boolean(
      globalConfig.oneuptimeSslCertificate &&
        globalConfig.oneuptimeSslCertificateKey,
    );

    const expiresAt: Date | undefined = globalConfig.oneuptimeSslExpiresAt
      ? new Date(globalConfig.oneuptimeSslExpiresAt)
      : undefined;

    const shouldRenew: boolean = !expiresAt
      ? true
      : OneuptimeSslCertificateService.isExpiringSoon(expiresAt, 30);

    if (hasCertificate && !shouldRenew) {
      logger.debug(
        "Existing OneUptime SSL certificate is still valid. No renewal required.",
      );
      return;
    }

    this.isProvisioning = true;

    try {
      logger.debug(`Ordering SSL certificate for OneUptime host: ${host}`);

      await GreenlockUtil.orderCert({
        domain: host,
        validateCname: async () => {
          return true;
        },
        persistAcmeCertificate: false,
        onCertificateIssued: async (info) => {
          await GlobalConfigService.updateOneById({
            id: ObjectID.getZeroObjectID(),
            data: {
              oneuptimeSslCertificate: info.certificate,
              oneuptimeSslCertificateKey: info.certificateKey,
              oneuptimeSslIssuedAt: info.issuedAt,
              oneuptimeSslExpiresAt: info.expiresAt,
            },
            props: {
              isRoot: true,
            },
          });
        },
      });

      logger.debug(
        `SSL certificate provisioning completed for OneUptime host: ${host}`,
      );
    } catch (err) {
      logger.error(
        "Failed to provision OneUptime SSL certificate via Let's Encrypt.",
      );
      logger.error(err);
    } finally {
      this.isProvisioning = false;
    }
  }

  private static isExpiringSoon(expiresAt: Date, renewBeforeDays: number): boolean {
    const renewThreshold: Date = OneUptimeDate.addRemoveDays(
      expiresAt,
      -1 * renewBeforeDays,
    );

    return OneUptimeDate.isOnOrAfter(OneUptimeDate.getCurrentDate(), renewThreshold);
  }
}
