import logger from '../Utils/Logger';
import DomainCommon from 'Common/Types/Domain';
import { PromiseRejectErrorFunction } from 'Common/Types/FunctionTypes';
import dns from 'dns';

export default class Domain extends DomainCommon {
    public static verifyTxtRecord(
        domain: Domain | string,
        verificationText: string
    ): Promise<boolean> {
        return new Promise(
            (
                resolve: (isVerfified: boolean) => void,
                reject: PromiseRejectErrorFunction
            ) => {
                dns.resolveTxt(
                    domain.toString(),
                    (
                        err: NodeJS.ErrnoException | null,
                        data: Array<Array<string>>
                    ) => {
                        if (err) {
                            return reject(err);
                        }

                        logger.debug('Verify TXT Record');
                        logger.debug('Domain ' + domain.toString());
                        logger.debug('Data: ');
                        logger.debug(data);

                        let isVerified: boolean = false;
                        for (const item of data) {
                            let txt: Array<string> | string = item;
                            if (Array.isArray(txt)) {
                                txt = (txt as Array<string>).join('');
                            }

                            if (txt === verificationText) {
                                isVerified = true;
                                break;
                            }
                        }

                        resolve(isVerified);
                    }
                );
            }
        );
    }
}
