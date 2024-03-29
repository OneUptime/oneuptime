import { exec, ExecException } from 'node:child_process';
import { PromiseRejectErrorFunction } from 'Common/Types/FunctionTypes';

export default class SelfSignedSSL {
    public static generate(path: string, host: string): Promise<void> {
        return new Promise(
            (resolve: VoidFunction, reject: PromiseRejectErrorFunction) => {
                exec(
                    `mkdir -p ${path} && openssl req -new -x509 -nodes -subj "/C=US/ST=NY/L=NYC/O=Global Security/OU=IT Department/CN=example.com" -out ${path}/${host}.crt -keyout ${path}/${host}.key -days 99999 && chmod -R 777 ${path}`,
                    (err: ExecException | null) => {
                        if (err) {
                            return reject(err);
                        }

                        return resolve();
                    }
                );
            }
        );
    }
}
