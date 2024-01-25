/// https://git.rootprojects.org/root/greenlock-store-memory.js/src/branch/master/index.js

import GreenlockCertificate from 'Model/Models/GreenlockCertificate';
import GreenlockCertificateService from 'CommonServer/Services/GreenlockCertificateService';
import logger from 'CommonServer/Utils/Logger';
import JSONFunctions from 'Common/Types/JSONFunctions';

module.exports = {
    create: (_opts: any) => {
        const saveCertificate: Function = async (
            id: string,
            blob: string,
            isKeyPair: boolean
        ): Promise<null> => {
            logger.info('Save Certificates: ' + id);

            let cert: GreenlockCertificate | null =
                await GreenlockCertificateService.findOneBy({
                    query: {
                        key: id,
                        isKeyPair: isKeyPair,
                    },
                    select: {
                        _id: true,
                        isKeyPair: isKeyPair,
                    },
                    props: {
                        isRoot: true,
                        ignoreHooks: true,
                    },
                });

            if (!cert) {
                cert = new GreenlockCertificate();
                cert.key = id;
                cert.blob = blob;
                cert.isKeyPair = isKeyPair;

                await GreenlockCertificateService.create({
                    data: cert,
                    props: {
                        isRoot: true,
                    },
                });
            } else {
                cert.blob = blob;
                cert.isKeyPair = isKeyPair;
                await GreenlockCertificateService.updateOneById({
                    id: cert.id!,
                    data: cert,
                    props: {
                        isRoot: true,
                    },
                });
            }

            //
            return null;
        };

        const getCertificate: Function = async (
            id: string,
            isKeyPair: boolean
        ): Promise<null | string> => {
            logger.info('Get Certificate - ' + id);

            const cert: GreenlockCertificate | null =
                await GreenlockCertificateService.findOneBy({
                    query: {
                        key: id,
                        isKeyPair: isKeyPair,
                    },
                    select: {
                        _id: true,
                        blob: true,
                    },
                    props: {
                        isRoot: true,
                        ignoreHooks: true,
                    },
                });

            if (!cert || !cert.blob) {
                logger.info('Certificate not found');
                return null;
            }

            logger.info('Certificate found');
            return cert.blob;
        };

        const saveKeypair: Function = async (
            id: string,
            blob: string
        ): Promise<null> => {
            logger.info('Save Keypair: ' + id);
            return await saveCertificate(id, blob, true);
        };

        const getKeypair: Function = async (
            id: string
        ): Promise<null | string> => {
            logger.info('Get Keypair: ' + id);
            return await getCertificate(id, true);
        };

        return {
            accounts: {
                // Whenever a new keypair is used to successfully create an account, we need to save its keypair
                setKeypair: async (opts: any): Promise<null> => {
                    logger.info('Accounts Set Keypair: ');
                    logger.info(JSON.stringify(opts, null, 2));
                    const id: string =
                        opts.account.id || opts.email || 'default';
                    const keypair: any = opts.keypair;

                    return await saveKeypair(id, JSON.stringify(keypair)); // Must return or Promise `null` instead of `undefined`
                },
                // We need a way to retrieve a prior account's keypair for renewals and additional ACME certificate "orders"
                checkKeypair: async (opts: any): Promise<any | null> => {
                    logger.info('Accounts Check Keypair: ');
                    logger.info(JSON.stringify(opts, null, 2));
                    const id: string =
                        opts.account.id || opts.email || 'default';
                    const keyblob: any = await getKeypair(id);

                    if (!keyblob) {
                        return null;
                    }

                    return JSONFunctions.parse(keyblob);
                },
            },

            certificates: {
                setKeypair: async (opts: any): Promise<null> => {
                    logger.info('Certificates Set Keypair: ');
                    logger.info(JSON.stringify(opts, null, 2));
                    // The ID is a string that doesn't clash between accounts and certificates.
                    // That's all you need to know... unless you're doing something special (in which case you're on your own).
                    const id: string =
                        opts.certificate.kid ||
                        opts.certificate.id ||
                        opts.subject;
                    const keypair: any = opts.keypair;

                    return await saveKeypair(id, JSON.stringify(keypair)); // Must return or Promise `null` instead of `undefined`
                    // Side Note: you can use the "keypairs" package to convert between
                    // public and private for jwk and pem, as well as convert JWK <-> PEM
                },

                // You won't be able to use a certificate without it's private key, gotta save it
                checkKeypair: async (opts: any): Promise<any | null> => {
                    logger.info('Certificates Check Keypair: ');
                    logger.info(JSON.stringify(opts, null, 2));
                    const id: string =
                        opts.certificate.kid ||
                        opts.certificate.id ||
                        opts.subject;
                    const keyblob: any = await getKeypair(id);

                    if (!keyblob) {
                        return null;
                    }

                    return JSONFunctions.parse(keyblob);
                },

                // And you'll also need to save certificates. You may find the metadata useful to save
                // (perhaps to delete expired keys), but the same information can also be redireved from
                // the key using the "cert-info" package.
                set: async (opts: any): Promise<null> => {
                    logger.info('Certificates Set: ');
                    logger.info(JSON.stringify(opts, null, 2));
                    const id: string = opts.certificate.id || opts.subject;
                    const pems: any = opts.pems;

                    return await saveCertificate(
                        id,
                        JSON.stringify(pems),
                        false
                    ); // Must return or Promise `null` instead of `undefined`
                },

                // This is actually the first thing to be called after approveDomins(),
                // but it's easiest to implement last since it's not useful until there
                // are certs that can actually be loaded from storage.
                check: async (opts: any): Promise<null | any> => {
                    logger.info('Certificates Check: ');
                    logger.info(JSON.stringify(opts, null, 2));
                    const id: string = opts.certificate?.id || opts.subject;
                    const certblob: any = await getCertificate(id, false);

                    if (!certblob) {
                        return null;
                    }

                    return JSONFunctions.parse(certblob);
                },
            },

            options: {},
        };
    },
};
