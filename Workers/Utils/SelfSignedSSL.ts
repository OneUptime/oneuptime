import { exec, ExecException } from 'node:child_process';

export default class SelfSignedSSL {
    public static generate(path: string, host: string): Promise<void> {
        return new Promise((resolve: Function, reject: Function) => {
            exec(
                `openssl req -new -x509 -nodes -subj "/C=US/ST=NY/L=NYC/O=Global Security/OU=IT Department/CN=example.com" -out ${path}/${host}.crt -keyout ${path}/${host}.key -days 99999`,
                (err: ExecException | null) => {
                    if (err) {
                        return reject(err);
                    }

                    return resolve();
                }
            );
        });
    }
}
