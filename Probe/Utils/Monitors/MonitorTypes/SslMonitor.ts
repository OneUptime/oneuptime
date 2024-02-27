import tls from 'tls';
import PositiveNumber from 'Common/Types/PositiveNumber';
import ObjectID from 'Common/Types/ObjectID';
import logger from 'CommonServer/Utils/Logger';
import OnlineCheck from '../../OnlineCheck';
import Sleep from 'Common/Types/Sleep';
import URL from 'Common/Types/API/URL';

export interface SslMonitorResponse {
    isOnline: boolean;
    isSelfSigned?: boolean;
    createdAt?: Date;
    expiresAt?: Date;
    commonName?: string;
    organizationalUnit?: string;
    organization?: string;
    locality?: string;
    state?: string;
    country?: string;
    serialNumber?: string;
    fingerprint?: string;
    fingerprint256?: string;
    failureCause: string;
}

export interface PingOptions {
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
        pingOptions?: PingOptions
    ): Promise<SslMonitorResponse | null> {
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
            const res: SslMonitorResponse = await this.getSslMonitorResponse(
                url.hostname.hostname,
                url.hostname.port.toNumber() || 443
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
                if (!(await OnlineCheck.isProbeOnline())) {
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
    ): Promise<SslMonitorResponse> {
        const options: tls.ConnectionOptions = {
            host: host,
            port: port,
        };

        return new Promise(
            (resolve: Function, reject: PromiseRejectErrorFunction) => {
                const req: tls.TLSSocket = tls.connect(options, () => {
                    const cert: tls.PeerCertificate = req.getPeerCertificate();
                    if (req.authorized) {
                        resolve({
                            isOnline: true,
                            isSelfSigned: false,
                            createdAt: new Date(cert.valid_from),
                            expiresAt: new Date(cert.valid_to),
                            commonName: cert.subject.CN,
                            organizationalUnit: cert.subject.OU,
                            organization: cert.subject.O,
                            locality: cert.subject.L,
                            state: cert.subject.ST,
                            country: cert.subject.C,
                            serialNumber: cert.serialNumber,
                            fingerprint: cert.fingerprint,
                            fingerprint256: cert.fingerprint256,
                            failureCause: '',
                        });
                    } else {
                        resolve({
                            isOnline: true,
                            isSelfSigned: true,
                            createdAt: new Date(cert.valid_from),
                            expiresAt: new Date(cert.valid_to),
                            commonName: cert.subject.CN,
                            organizationalUnit: cert.subject.OU,
                            organization: cert.subject.O,
                            locality: cert.subject.L,
                            state: cert.subject.ST,
                            country: cert.subject.C,
                            serialNumber: cert.serialNumber,
                            fingerprint: cert.fingerprint,
                            fingerprint256: cert.fingerprint256,
                            failureCause: '',
                        });
                    }
                    req.end();
                });

                req.on('error', (err: Error) => {
                    reject(err);
                });
            }
        );
    }
}
