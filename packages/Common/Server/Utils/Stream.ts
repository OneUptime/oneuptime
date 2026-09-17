import { PromiseRejectErrorFunction } from "../../Types/FunctionTypes";
import { Stream } from "stream";
import CaptureSpan from "./Telemetry/CaptureSpan";

export default class StreamUtil {
  @CaptureSpan()
  public static convertStreamToText(stream: Stream): Promise<string> {
    return new Promise<string>(
      (
        resolve: (result: string) => void,
        reject: PromiseRejectErrorFunction,
      ) => {
        const chunks: Array<any> = [];

        stream.on("data", (chunk: any) => {
          if (Array.isArray(chunk) && chunk.length === 0) {
            return;
          }

          chunks.push(Buffer.from(chunk));
        });
        stream.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        stream.on("error", (err: Error) => {
          reject(err);
        });
      },
    );
  }

  @CaptureSpan()
  public static async toStringArray(stream: Stream): Promise<Array<string>> {
    const text: string = await StreamUtil.convertStreamToText(stream);
    return text.split("\n");
  }
}
