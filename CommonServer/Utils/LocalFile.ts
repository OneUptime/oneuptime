import fs from 'fs';

export default class LocalFile {
    public static async read(path: string): Promise<string> {
        return new Promise(
            (resolve: (data: string) => void, reject: Function) => {
                fs.readFile(
                    path,
                    { encoding: 'utf-8' },
                    (err: unknown, data: string) => {
                        if (!err) {
                            return resolve(data);
                        }
                        return reject(err);
                    }
                );
            }
        );
    }
}
