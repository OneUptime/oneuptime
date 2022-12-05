/// https://git.rootprojects.org/root/greenlock-store-memory.js/src/branch/master/index.js

import GreenlockCertificate from 'Model/Models/GreenlockCertificate';
import GreenlockCertificateService from 'CommonServer/Services/GreenlockCertificateService';

module.exports = {

    create: () => {
        
        const saveCertificate = async (id: string, blob: string): Promise<null> => {
            let cert: GreenlockCertificate | null = await GreenlockCertificateService.findOneBy({
                query: {
                    key: id
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true
                }
            });
    
            if (!cert) {
                cert = new GreenlockCertificate();
                cert.key = id;
                cert.blob = blob;
    
                await GreenlockCertificateService.create({
                    data: cert,
                    props: {
                        isRoot: true
                    }
                });
    
            } else {
                cert.blob = blob;
                await GreenlockCertificateService.updateOneById({
                    id: cert.id!,
                    data: cert,
                    props: {
                        isRoot: true
                    }
                })
            }
    
            // 
            return null;
        }
        
        const getCertificate = async (id: string): Promise<null | string> => {
            let cert: GreenlockCertificate | null = await GreenlockCertificateService.findOneBy({
                query: {
                    key: id
                },
                select: {
                    _id: true,
                    blob: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true
                }
            });
    
            if (!cert || !cert.blob) {
                return null;
    
            } else {
                return cert.blob;
            }
        }
        
        const saveKeypair = async (id: string, blob: string): Promise<null> => {
            return await saveCertificate(id, blob);
        }

        const getKeypair = async (id: string): Promise<null | string> => {
            return await getCertificate(id);
        }

        return {
            accounts: {
                // Whenever a new keypair is used to successfully create an account, we need to save its keypair
                setKeypair: async (opts: any): Promise<null> => {

                    var id = opts.account.id || opts.email || 'default';
                    var keypair = opts.keypair;

                    return await saveKeypair(id, JSON.stringify({
                        privateKeyPem: keypair.privateKeyPem // string PEM
                        , privateKeyJwk: keypair.privateKeyJwk // object JWK
                    })); // Must return or Promise `null` instead of `undefined`
                },
                // We need a way to retrieve a prior account's keypair for renewals and additional ACME certificate "orders"
                checkKeypair: async (opts: any): Promise<any | null> => {
                    console.log('accounts.checkKeypair:', opts.account, opts.email);

                    var id = opts.account.id || opts.email || 'default';
                    var keyblob = await getKeypair(id);

                    if (!keyblob) { return null; }

                    return JSON.parse(keyblob);
                },
            },

            certificate: {
                setKeypair: async (opts: any): Promise<null> => {
        
                    // The ID is a string that doesn't clash between accounts and certificates.
                    // That's all you need to know... unless you're doing something special (in which case you're on your own).
                    var id = opts.certificate.kid || opts.certificate.id || opts.subject;
                    var keypair = opts.keypair;
        
                    return await saveKeypair(id, JSON.stringify({
                        privateKeyPem: keypair.privateKeyPem // string PEM
                        , privateKeyJwk: keypair.privateKeyJwk // object JWK
                    })); // Must return or Promise `null` instead of `undefined`
                    // Side Note: you can use the "keypairs" package to convert between
                    // public and private for jwk and pem, as well as convert JWK <-> PEM
                },
        
        
        
                // You won't be able to use a certificate without it's private key, gotta save it
                checkKeypair: async (opts: any): Promise<any | null> => {
        
                    var id = opts.certificate.kid || opts.certificate.id || opts.subject;
                    var keyblob = await getKeypair(id);
        
                    if (!keyblob) { return null; }
        
                    return JSON.parse(keyblob);
                },
        
        
        
                // And you'll also need to save certificates. You may find the metadata useful to save
                // (perhaps to delete expired keys), but the same information can also be redireved from
                // the key using the "cert-info" package.
                set: async (opts: any): Promise<null> => {
        
                    var id = opts.certificate.id || opts.subject;
                    var pems = opts.pems;
                    return await saveCertificate(id, JSON.stringify({
                        cert: pems.cert           // string PEM
                        , chain: pems.chain         // string PEM
                        , subject: pems.subject     // string name 'example.com
                        , altnames: pems.altnames   // Array of string names [ 'example.com', '*.example.com', 'foo.bar.example.com' ]
                        , issuedAt: pems.issuedAt   // date number in ms (a.k.a. NotBefore)
                        , expiresAt: pems.expiresAt // date number in ms (a.k.a. NotAfter)
                    })); // Must return or Promise `null` instead of `undefined`
                },
        
        
        
                // This is actually the first thing to be called after approveDomins(),
                // but it's easiest to implement last since it's not useful until there
                // are certs that can actually be loaded from storage.
                check: async (opts: any): Promise<null | any> => {
        
                    var id = opts.certificate.id || opts.subject;
                    var certblob = await getCertificate(id);
        
                    if (!certblob) { return null; }
        
                    return JSON.parse(certblob);
                }
            },

            options: {

            }

        };
    }
}