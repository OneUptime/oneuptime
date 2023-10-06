import fs from 'fs';

export default class LocalFile {
    public static async makeDirectory(path: string): Promise<void> {
        return new Promise((resolve: Function, reject: Function) => {
            fs.mkdir(path, { recursive: true }, (err: unknown) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    public static async write(path: string, data: string): Promise<void> {
        return new Promise((resolve: Function, reject: Function) => {
            fs.writeFile(path, data, (err: unknown) => {
                if (err) {
                    return reject();
                }
                resolve();
            });
        });
    }

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
