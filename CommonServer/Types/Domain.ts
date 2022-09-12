import DomainCommon from "Common/Types/Domain";
import dns from 'dns';

export default class Domain extends DomainCommon {
    public static verifyTxtRecord(domain: Domain | string, verificationText: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            dns.resolveTxt(domain.toString(), (err, data) => {
                if (err) {
                    return reject(err);
                }

                let isVerified = false;
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
            })
        })

    }
}