import { Stream } from 'stream';

export default class StreamUtil {
    public static convertStreamToText(stream: Stream): Promise<string> {
        return new Promise<string>((resolve: Function, reject: Function) => {
            const chunks: Array<any> = [];

            stream.on('data', (chunk: any) => {
                chunks.push(Buffer.from(chunk));
            });
            stream.on('end', () => {
                resolve(Buffer.concat(chunks).toString('utf8'));
            });
            stream.on('error', (err: Error) => {
                reject(err);
            });
        });
    }

    public static async toStringArray(stream: Stream): Promise<Array<string>> {
        const text: string = await StreamUtil.convertStreamToText(stream);
        return text.split('\n');
    }
}
