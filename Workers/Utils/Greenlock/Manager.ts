
// Docs: https://git.rootprojects.org/root/greenlock-manager.js

import StatusPageDomainService from "CommonServer/Services/StatusPageDomainService";
import StatusPageDomain from "Model/Models/StatusPageDomain";

export default {
    create: () => {

        console.log("Manager created");

        return {
            // Get
            get: async ({ servername }: { servername: string }): Promise<JSON | undefined> => {
                // Required: find the certificate with the subject of `servername`
                // Optional (multi-domain certs support): find a certificate with `servername` as an altname
                // Optional (wildcard support): find a certificate with `wildname` as an altname

                // { subject, altnames, renewAt, deletedAt, challenges, ... }

                const domain: StatusPageDomain | null = await StatusPageDomainService.findOneBy({
                    query: {
                        fullDomain: servername,
                    },
                    props: {
                        isRoot: true,
                        ignoreHooks: true
                    },
                    select: {
                        _id: true,
                        greenlockConfig: true,
                    }
                });

                if (!domain || !domain.greenlockConfig) {
                    return undefined;
                }
                
                return domain.greenlockConfig;
            },

            // Set
            set: async  (opts: any) => {
                // { subject, altnames, renewAt, deletedAt }
                // Required: updated `renewAt` and `deletedAt` for certificate matching `subject`

                if(!opts.subject){
                    return 
                }

                const domain: StatusPageDomain | null = await StatusPageDomainService.findOneBy({
                    query: {
                        fullDomain: opts['subject'] as string,
                    },
                    props: {
                        isRoot: true,
                    },
                    select: {
                        _id: true,
                        greenlockConfig: true,
                    }
                });

                if (!domain) {
                    return; 
                }

                await StatusPageDomainService.updateOneById({
                    id: domain.id!,
                    data: {
                        greenlockConfig: opts
                    },
                    props: {
                        isRoot: true,
                        ignoreHooks: true
                    }
                });
            }
        };
    }
}
