import DomainCommon from 'Common/Types/Domain';
import dns from 'dns';
import logger from '../Utils/Logger';

export default class Domain extends DomainCommon {
    public static verifyTxtRecord(
        domain: Domain | string,
        verificationText: string
    ): Promise<boolean> {
        return new Promise((resolve: Function, reject: Function) => {
            dns.resolveTxt(
                domain.toString(),
                (
                    err: NodeJS.ErrnoException | null,
                    data: Array<Array<string>>
                ) => {
                    if (err) {
                        return reject(err);
                    }

                    logger.info("Verify TXT Record");
                    logger.info("Domain "+domain.toString());
                    logger.info("Data: ")
                    logger.info(data);

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
        });
    }
}
