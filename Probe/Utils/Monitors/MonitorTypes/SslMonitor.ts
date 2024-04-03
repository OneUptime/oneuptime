import tls, { TLSSocket } from 'tls';
import PositiveNumber from 'Common/Types/PositiveNumber';
import ObjectID from 'Common/Types/ObjectID';
import logger from 'CommonServer/Utils/Logger';
import OnlineCheck from '../../OnlineCheck';
import Sleep from 'Common/Types/Sleep';
import URL from 'Common/Types/API/URL';
import SSLMonitorReponse from 'Common/Types/Monitor/SSLMonitor/SslMonitorResponse';
import https, { RequestOptions } from 'https';
import ObjectUtil from 'Common/Utils/ObjectUtil';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OneUptimeDate from 'Common/Types/Date';
import { IncomingMessage } from 'http';

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

        logger.info(
            `Pinging host: ${pingOptions?.monitorId?.toString()} ${url.toString()} - Retry: ${
                pingOptions?.currentRetryCount
            }`
        );

        try {
            const res: SslResponse = await this.getSslMonitorResponse(
                url.hostname.hostname,
                url.hostname.port?.toNumber() || 443
            );

            logger.info(
                `Pinging host ${pingOptions?.monitorId?.toString()} ${url.toString()} success: `
            );
            logger.info(res);

            return res;
        } catch (err: unknown) {
            logger.info(
                `Pinging host ${pingOptions?.monitorId?.toString()} ${url.toString()} error: `
            );
            logger.info(err);

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
                logger.info(
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
        debugger;

        const sslPromise = new Promise(
            (
                resolve: (value: tls.PeerCertificate) => void,
                reject: (err: Error) => void
            ) => {
                const requestOptions = this.getOptions(host, port);

                let isResolvedOrRejected = false;

                const req = https.get(
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

        const res: SslResponse = {
            isOnline: true,
            isSelfSigned: certificate.issuer.CN === certificate.subject.CN,
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

    private static getOptions(url: string, port: number): RequestOptions {
        return {
            hostname: url,
            agent: false,
            rejectUnauthorized: false,
            ciphers: 'ALL',
            port,
            protocol: 'https:',
        };
    }
}
