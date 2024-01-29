import {
    EVERY_FIVE_MINUTE,
    EVERY_HOUR,
    EVERY_MINUTE,
} from 'Common/Utils/CronTime';
import BasicCron from 'CommonServer/Utils/BasicCron';
import { IsDevelopment } from 'CommonServer/EnvironmentConfig';
// @ts-ignore
import logger from 'CommonServer/Utils/Logger';
import JSONFunctions from 'Common/Types/JSONFunctions';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import GreenlockCertificate from 'Model/Models/GreenlockCertificate';
import GreenlockCertificateService from 'CommonServer/Services/GreenlockCertificateService';
import LocalFile from 'CommonServer/Utils/LocalFile';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
import SelfSignedSSL from '../Utils/SelfSignedSSL';

export default class Jobs {
    public static init(): void {
        BasicCron(
            'StatusPageCerts:WriteGreelockCertsToDisk',
            {
                schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR,
                runOnStartup: true,
            },
            async () => {
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

                    const certBlob: GreenlockCertificate | undefined =
                        certs.find((i: GreenlockCertificate) => {
                            return i.key === cert.key && !i.isKeyPair;
                        });

                    if (!certBlob) {
                        continue;
                    }

                    const key: string = JSONFunctions.parse(cert.blob || '{}')[
                        'privateKeyPem'
                    ] as string;
                    let crt: string = JSONFunctions.parse(
                        certBlob.blob || '{}'
                    )['cert'] as string;

                    if (
                        JSONFunctions.parse(certBlob.blob || '{}')[
                            'chain'
                        ] as string
                    ) {
                        crt += ('\n' +
                            '\n' +
                            JSONFunctions.parse(certBlob.blob || '{}')[
                                'chain'
                            ]) as string;
                    }

                    // Need to make sure StatusPageCerts dir exists.

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
                        `/etc/nginx/certs/StatusPageCerts/${cert.key}.crt`,
                        crt
                    );

                    await LocalFile.write(
                        `/etc/nginx/certs/StatusPageCerts/${cert.key}.key`,
                        key
                    );
                }
            }
        );

        BasicCron(
            'StatusPageCerts:WriteSelfSignedCertsToDisk',
            {
                schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIVE_MINUTE,
                runOnStartup: true,
            },
            async () => {
                // Fetch all domains where certs are added to greenlock.

                const certs: Array<GreenlockCertificate> =
                    await GreenlockCertificateService.findBy({
                        query: {},
                        select: {
                            key: true,
                        },
                        limit: LIMIT_MAX,
                        skip: 0,
                        props: {
                            isRoot: true,
                        },
                    });

                const statusPageDomains: Array<StatusPageDomain> =
                    await StatusPageDomainService.findBy({
                        query: {
                            isSelfSignedSslGenerated: false,
                        },
                        select: {
                            fullDomain: true,
                            _id: true,
                        },
                        limit: LIMIT_MAX,
                        skip: 0,
                        props: {
                            isRoot: true,
                            ignoreHooks: true,
                        },
                    });

                const greenlockCertDomains: Array<string | undefined> =
                    certs.map((cert: GreenlockCertificate) => {
                        return cert.key;
                    });

                // Generate self signed certs
                for (const domain of statusPageDomains) {
                    if (greenlockCertDomains.includes(domain.fullDomain)) {
                        continue;
                    }

                    if (!domain.fullDomain) {
                        continue;
                    }

                    await SelfSignedSSL.generate(
                        '/etc/nginx/certs/StatusPageCerts',
                        domain.fullDomain
                    );

                    await StatusPageDomainService.updateOneById({
                        id: domain.id!,
                        data: {
                            isSelfSignedSslGenerated: true,
                        },
                        props: {
                            ignoreHooks: true,
                            isRoot: true,
                        },
                    });
                }
            }
        );
    }
}

