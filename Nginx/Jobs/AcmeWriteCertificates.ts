import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from 'Common/Utils/CronTime';
import BasicCron from 'CommonServer/Utils/BasicCron';
import { IsDevelopment } from 'CommonServer/EnvironmentConfig';
// @ts-ignore
import logger from 'CommonServer/Utils/Logger';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import LocalFile from 'CommonServer/Utils/LocalFile';
import AcmeCertificate from 'Model/Models/AcmeCertificate';
import AcmeCertificateService from 'CommonServer/Services/AcmeCertificateService';

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
                        await LocalFile.makeDirectory(
                            '/etc/nginx/certs/StatusPageCerts'
                        );
                    } catch (err) {
                        // directory already exists, ignore.
                        logger.error('Create directory err');
                        logger.error(err);
                    }


                    // Write to disk.
                    await LocalFile.write(
                        `/etc/nginx/certs/StatusPageCerts/${cert.domain}.crt`,
                        cert.certificate?.toString() || ''
                    );

                    await LocalFile.write(
                        `/etc/nginx/certs/StatusPageCerts/${cert.domain}.key`,
                        cert.certificateKey?.toString() || ''
                    );
                }
            },
        });
    }
}
