import fs from 'fs';

export default class LocalFile {
    public static async read(path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            return fs.readFile(path, { encoding: 'utf-8' }, (err, data) => {
                if (!err) {
                    resolve(data)
                } else {
                    reject(err);
                }
            });
        })
    }
}