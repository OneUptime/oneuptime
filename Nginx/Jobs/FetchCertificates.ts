import LIMIT_MAX from "Common/Types/Database/LimitMax";
import JSONFunctions from "Common/Types/JSONFunctions";
import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import GreenlockCertificateService from "Common/Server/Services/GreenlockCertificateService";
import BasicCron from "Common/Server/Utils/BasicCron";
import LocalFile from "Common/Server/Utils/LocalFile";
// @ts-ignore
import logger from "Common/Server/Utils/Logger";
import GreenlockCertificate from "Common/Models/DatabaseModels/GreenlockCertificate";

export default class Jobs {
  public static init(): void {
    BasicCron({
      jobName: "StatusPageCerts:WriteGreelockCertsToDisk",
      options: {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
      },
      runFunction: async () => {
        // Fetch all domains where certs are added to greenlock.

        const certs: Array<GreenlockCertificate> =
          await GreenlockCertificateService.findBy({
            query: {},
            select: {
              isKeyPair: true,
              key: true,
              blob: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        for (const cert of certs) {
          if (!cert.isKeyPair) {
            continue;
          }

          const certBlob: GreenlockCertificate | undefined = certs.find(
            (i: GreenlockCertificate) => {
              return i.key === cert.key && !i.isKeyPair;
            },
          );

          if (!certBlob) {
            continue;
          }

          const key: string = JSONFunctions.parseJSONObject(cert.blob || "{}")[
            "privateKeyPem"
          ] as string;
          let crt: string = JSONFunctions.parseJSONObject(
            certBlob.blob || "{}",
          )["cert"] as string;

          if (
            JSONFunctions.parseJSONObject(certBlob.blob || "{}")[
              "chain"
            ] as string
          ) {
            crt += ("\n" +
              "\n" +
              JSONFunctions.parseJSONObject(certBlob.blob || "{}")[
                "chain"
              ]) as string;
          }

          // Need to make sure StatusPageCerts dir exists.

          try {
            await LocalFile.makeDirectory("/etc/nginx/certs/StatusPageCerts");
          } catch (err) {
            // directory already exists, ignore.
            logger.error("Create directory err");
            logger.error(err);
          }

          // Write to disk.
          await LocalFile.write(
            `/etc/nginx/certs/StatusPageCerts/${cert.key}.crt`,
            crt,
          );

          await LocalFile.write(
            `/etc/nginx/certs/StatusPageCerts/${cert.key}.key`,
            key,
          );
        }
      },
    });
  }
}
