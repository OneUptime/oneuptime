// Docs: https://git.rootprojects.org/root/greenlock-manager.js

import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import logger from 'CommonServer/Utils/Logger';

// because greenlock package expects module.exports.
module.exports = {
    create: () => {
        return {
            // Get
            get: async ({
                servername,
            }: {
                servername: string;
            }): Promise<JSON | undefined> => {
                // Required: find the certificate with the subject of `servername`
                // Optional (multi-domain certs support): find a certificate with `servername` as an altname
                // Optional (wildcard support): find a certificate with `wildname` as an altname

                // { subject, altnames, renewAt, deletedAt, challenges, ... }
                logger.info("Greenlock Manager Get");
                logger.info(servername);
                const domain: StatusPageDomain | null =
                    await StatusPageDomainService.findOneBy({
                        query: {
                            fullDomain: servername,
                        },
                        props: {
                            isRoot: true,
                            ignoreHooks: true,
                        },
                        select: {
                            _id: true,
                            greenlockConfig: true,
                        },
                    });

                if (!domain || !domain.greenlockConfig) {
                    logger.info("Greenlock Manager GET " + servername+" - No domain found.");
                    return undefined;
                }

                logger.info("Greenlock Manager GET " + servername + " RESULT");
                logger.info(domain.greenlockConfig);

                return domain.greenlockConfig;
            },

            // Set
            set: async (opts: any) => {
                logger.info("Greenlock Manager Set");
                logger.info(opts);

                // { subject, altnames, renewAt, deletedAt }
                // Required: updated `renewAt` and `deletedAt` for certificate matching `subject`

                if (!opts.subject) {
                    return;
                }

                const domain: StatusPageDomain | null =
                    await StatusPageDomainService.findOneBy({
                        query: {
                            fullDomain: opts['subject'] as string,
                        },
                        props: {
                            isRoot: true,
                        },
                        select: {
                            _id: true,
                            greenlockConfig: true,
                        },
                    });

                if (!domain) {
                    return;
                }

                await StatusPageDomainService.updateOneById({
                    id: domain.id!,
                    data: {
                        greenlockConfig: opts,
                    },
                    props: {
                        isRoot: true,
                        ignoreHooks: true,
                    },
                });
            },
        };
    },
};
