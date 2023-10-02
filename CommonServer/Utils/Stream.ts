import { JSONObject } from "Common/Types/JSON";
import { Stream } from "stream";

export default class StreamUtil {
    public static async toJSONArray(stream: Stream): Promise<Array<JSONObject>> {
        return new Promise<Array<JSONObject>>((resolve, reject) => {
            const data: Array<JSONObject> = [];
            stream.on("data", (chunk) => {
                data.push(chunk);
            });
            stream.on("end", () => {
                resolve(data);
            });
            stream.on("error", (err) => {
                reject(err);
            });
        });
    }
}