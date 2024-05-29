import OnlineCheck from '../../OnlineCheck';
import URL from 'Common/Types/API/URL';
import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import SSLMonitorReponse from 'Common/Types/Monitor/SSLMonitor/SslMonitorResponse';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Sleep from 'Common/Types/Sleep';
import ObjectUtil from 'Common/Utils/ObjectUtil';
import logger from 'CommonServer/Utils/Logger';
import { ClientRequest, IncomingMessage } from 'http';
import https, { RequestOptions } from 'https';
import tls, { TLSSocket } from 'tls';

export interface SslResponse extends SSLMonitorReponse {
    isOnline: boolean;
    failureCause: string;
}

export interface SSLMonitorOptions {
    timeout?: PositiveNumber;
    retry?: number | undefined;
    currentRetryCount?: number | undefined;
    monitorId?: ObjectID | undefined;
    isOnlineCheckRequest?: boolean | undefined;
}

export default class SSLMonitor {
    // burn domain names into the code to see if this probe is online.

    public static async ping(
        url: URL,
        pingOptions?: SSLMonitorOptions
    ): Promise<SslResponse | null> {
        if (!pingOptions) {
            pingOptions = {};
        }

        if (pingOptions?.currentRetryCount === undefined) {
            pingOptions.currentRetryCount = 1;
        }

        logger.debug(
            `Pinging host: ${pingOptions?.monitorId?.toString()} ${url.toString()} - Retry: ${
                pingOptions?.currentRetryCount
            }`
        );

        try {
            const res: SslResponse = await this.getSslMonitorResponse(
                url.hostname.hostname,
                url.hostname.port?.toNumber() || 443
            );

            logger.debug(
                `Pinging host ${pingOptions?.monitorId?.toString()} ${url.toString()} success: `
            );
            logger.debug(res);

            return res;
        } catch (err: unknown) {
            logger.debug(
                `Pinging host ${pingOptions?.monitorId?.toString()} ${url.toString()} error: `
            );
            logger.debug(err);

            if (!pingOptions) {
                pingOptions = {};
            }

            if (!pingOptions.currentRetryCount) {
                pingOptions.currentRetryCount = 0;
            }

            if (pingOptions.currentRetryCount < (pingOptions.retry || 5)) {
                pingOptions.currentRetryCount++;
                await Sleep.sleep(1000);
                return await this.ping(url, pingOptions);
            }

            // check if timeout exceeded and if yes, return null
            if (
                (err as any).toString().includes('timeout') &&
                (err as any).toString().includes('exceeded')
            ) {
                logger.debug(
                    `Ping Monitor - Timeout exceeded ${pingOptions.monitorId?.toString()} ${url.toString()} - ERROR: ${err}`
                );

                return {
                    isOnline: false,
                    failureCause: 'Timeout exceeded',
                };
            }

            // check if the probe is online.
            if (!pingOptions.isOnlineCheckRequest) {
                if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
                    logger.error(
                        `PingMonitor Monitor - Probe is not online. Cannot ping ${pingOptions?.monitorId?.toString()} ${url.toString()} - ERROR: ${err}`
                    );
                    return null;
                }
            }

            return {
                isOnline: false,
                failureCause: (err as any).toString(),
            };
        }
    }

    public static async getSslMonitorResponse(
        host: string,
        port = 443
    ): Promise<SslResponse> {
        let isSelfSigned: boolean = false;
        let certificate: tls.PeerCertificate | null = null;

        try {
            certificate = await this.getCertificate({
                host,
                port,
                rejectUnauthorized: true,
            });
        } catch (err) {
            try {
                certificate = await this.getCertificate({
                    host,
                    port,
                    rejectUnauthorized: false,
                });

                isSelfSigned = true;
            } catch (err) {
                return {
                    isOnline: false,
                    failureCause: (err as any).toString(),
                };
            }
        }

        if (!certificate) {
            return {
                isOnline: false,
                failureCause: 'No certificate found',
            };
        }

        const res: SslResponse = {
            isOnline: true,
            isSelfSigned: isSelfSigned,
            createdAt: OneUptimeDate.fromString(certificate.valid_from),
            expiresAt: OneUptimeDate.fromString(certificate.valid_to),
            commonName: certificate.subject.CN,
            organizationalUnit: certificate.subject.OU,
            organization: certificate.subject.O,
            locality: certificate.subject.L,
            state: certificate.subject.ST,
            country: certificate.subject.C,
            serialNumber: certificate.serialNumber,
            fingerprint: certificate.fingerprint,
            fingerprint256: certificate.fingerprint256,
            failureCause: '',
        };

        return res;
    }

    public static async getCertificate(data: {
        host: string;
        port: number;
        rejectUnauthorized: boolean;
    }): Promise<tls.PeerCertificate> {
        const { host, rejectUnauthorized } = data;

        let { port } = data;

        if (!port) {
            port = 443;
        }

        const sslPromise: Promise<tls.PeerCertificate> = new Promise(
            (
                resolve: (value: tls.PeerCertificate) => void,
                reject: (err: Error) => void
            ) => {
                const requestOptions: https.RequestOptions = this.getOptions(
                    host,
                    port,
                    rejectUnauthorized
                );

                let isResolvedOrRejected: boolean = false;

                const req: ClientRequest = https.get(
                    requestOptions,
                    (res: IncomingMessage) => {
                        const certificate: tls.PeerCertificate = (
                            res.socket as TLSSocket
                        ).getPeerCertificate();
                        if (
                            ObjectUtil.isEmpty(certificate) ||
                            certificate === null
                        ) {
                            isResolvedOrRejected = true;
                            return reject(
                                new BadDataException('No certificate found')
                            );
                        }
                        isResolvedOrRejected = true;
                        return resolve(certificate);
                    }
                );

                req.end();

                req.on('error', (err: Error) => {
                    if (!isResolvedOrRejected) {
                        isResolvedOrRejected = true;
                        return reject(err);
                    }
                });
            }
        );

        const certificate: tls.PeerCertificate = await sslPromise;

        return certificate;
    }

    private static getOptions(
        url: string,
        port: number,
        rejectUnauthorized: boolean
    ): RequestOptions {
        return {
            hostname: url,
            agent: false,
            rejectUnauthorized: rejectUnauthorized,
            ciphers: 'ALL',
            port,
            protocol: 'https:',
        };
    }
}
