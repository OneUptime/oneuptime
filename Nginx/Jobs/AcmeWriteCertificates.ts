import {
    EVERY_FIFTEEN_MINUTE,
    EVERY_MINUTE,
} from 'Common/Utils/CronTime';
import BasicCron from 'CommonServer/Utils/BasicCron';
import { IsDevelopment } from 'CommonServer/EnvironmentConfig';
// @ts-ignore
import logger from 'CommonServer/Utils/Logger';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import GreenlockCertificate from 'Model/Models/GreenlockCertificate';
import GreenlockCertificateService from 'CommonServer/Services/GreenlockCertificateService';
import LocalFile from 'CommonServer/Utils/LocalFile';

export default class Jobs {
    public static init(): void {
        BasicCron({
            jobName: 'StatusPageCerts:WriteAcmeCertsToDisk',
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
                    

                    try {
                        await LocalFile.makeDirectory(
                            '/etc/nginx/certs/StatusPageCerts'
                        );
                    } catch (err) {
                        // directory already exists, ignore.
                        logger.error('Create directory err');
                        logger.error(err);
                    }

                    const certBlob = JSON.parse(cert.blob!);

                    // Write to disk.
                    await LocalFile.write(
                        `/etc/nginx/certs/StatusPageCerts/${cert.key}.crt`,
                        certBlob['certificate']
                    );

                    await LocalFile.write(
                        `/etc/nginx/certs/StatusPageCerts/${cert.key}.key`,
                        certBlob['certificateKey']
                    );
                }
            },
        });

    }
}
