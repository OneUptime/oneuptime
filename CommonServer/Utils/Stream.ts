import { JSONObject } from 'Common/Types/JSON';
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

    public static async toJSONArray(
        stream: Stream
    ): Promise<Array<JSONObject>> {
        const text = await this.convertStreamToText(stream);
        return JSON.parse(text);
    }

    public static async toStringArray(
        stream: Stream
    ): Promise<Array<string>> {
        return new Promise<Array<string>>(
            (resolve: Function, reject: Function) => {
                const data: Array<string> = [];
                stream.on('data', (chunk: any) => {
                    data.push(chunk);
                });
                stream.on('end', () => {
                    resolve(data);
                });
                stream.on('error', (err: Error) => {
                    reject(err);
                });
            }
        );
    }
}
