import acme from 'acme-client';
import { LetsEncryptNotificationEmail } from '../../EnvironmentConfig';
import GreenlockChallenge from 'Model/Models/GreenlockChallenge';
import GreenlockChallengeService from '../../Services/GreenlockChallengeService';
import AcmeCertificate from 'Model/Models/AcmeCertificate';
import AcmeCertificateService  from '../../Services/AcmeCertificateService';
import logger from '../Logger';

export default class GreenlockUtil {

    public static async renewAllCertsWhichAreExpiringSoon(): Promise<void> {

        logger.info('Renewing all certificates');
        // TODO: Implement renewAllCerts
    }

    public static async removeDomain(domain: string): Promise<void> {
        // remove certificate for this domain. 
        await AcmeCertificateService.deleteBy({
            query: {
                key: domain
            },
            limit: 1,
            skip: 0,
            props: {
                isRoot: true
            }
        });
    }

    public static async orderCert(domain: string): Promise<void> {

        domain = domain.trim().toLowerCase();

        const client = new acme.Client({
            directoryUrl: acme.directory.letsencrypt.production,
            accountKey: await acme.crypto.createPrivateKey()
        });

        const [certificateKey, certificateRequest] = await acme.crypto.createCsr({
            commonName: domain
        });

        const certificate: string = await client.auto({
            csr: certificateRequest,
            email: LetsEncryptNotificationEmail.toString(),
            termsOfServiceAgreed: true,
            challengePriority: ['http-01'], // only http-01 challenge is supported by oneuptime
            challengeCreateFn: async (authz, challenge, keyAuthorization) => {
                // Satisfy challenge here
                /* http-01 */
                if (challenge.type === 'http-01') {

                    const greenlockChallenge = new GreenlockChallenge();
                    greenlockChallenge.challenge = keyAuthorization;
                    greenlockChallenge.token = challenge.token;
                    greenlockChallenge.key = authz.identifier.value; 


                    await GreenlockChallengeService.create({
                        data: greenlockChallenge,
                        props: {
                            isRoot: true
                        }
                    });
                    
                }
            },
            challengeRemoveFn: async (authz, challenge) => {
                // Clean up challenge here

                if (challenge.type === 'http-01') {

                    await GreenlockChallengeService.deleteBy({
                        query: {
                            key: authz.identifier.value
                        },
                        limit: 1,
                        skip: 0,
                        props: {
                            isRoot: true
                        }
                    });
                }
            }
        });

        // get expires at date from certificate

        const cert = await acme.forge.readCertificateInfo(certificate);
        const issuedAt = cert.notBefore;
        const expiresAt = cert.notAfter;



        // check if the certificate is already in the database.

        const existingCertificate: AcmeCertificate | null = await AcmeCertificateService.findOneBy({
            query: {
                key: domain
            },
            select:{
                _id: true
            },
            props: {
                isRoot: true
            }
        });

        const blob: string = JSON.stringify({
            certificate: certificate.toString(),
            certificateKey: certificateKey.toString()
        });

        if(existingCertificate){
            // update the certificate
            await AcmeCertificateService.updateBy({
                query: {
                    key: domain
                },
                limit: 1,
                skip: 0,
                data: {
                    blob: blob
                },
                props: {
                    isRoot: true
                }
            });
        } else {
            // create the certificate
            const AcmeCertificate = new AcmeCertificate();
            AcmeCertificate.key = domain;
            AcmeCertificate.blob = blob;

            await AcmeCertificateService.create({
                data: AcmeCertificate,
                props: {
                    isRoot: true
                }
            });
        }         
    }
}
