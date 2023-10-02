import { JSONObject } from 'Common/Types/JSON';
import { Stream } from 'stream';

export default class StreamUtil {
    public static async toJSONArray(
        stream: Stream
    ): Promise<Array<JSONObject>> {
        return new Promise<Array<JSONObject>>((resolve: Function, reject: Function) => {
            const data: Array<JSONObject> = [];
            stream.on('data', (chunk: any) => {
                data.push(chunk);
            });
            stream.on('end', () => {
                resolve(data);
            });
            stream.on('error', (err: Error) => {
                reject(err);
            });
        });
    }
}
