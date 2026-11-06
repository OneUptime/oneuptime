import {
  ExpressRequest,
  headerValueToString,
} from "Common/Server/Utils/Express";

/*
 * A STREAM DELIVERY'S BODY, READ RAW AND BOUNDED.
 *
 * The cloud stream endpoints - Amazon Data Firehose's, Pub/Sub's - read
 * their own bodies: StartServer leaves their paths to them
 * (isCloudStreamPath), so the limit that holds is theirs, before anything
 * is parsed. A declared length past it is refused before a byte is read,
 * and a body that grows past it is let go of as it does.
 */

export class CloudStreamBodyTooLarge extends Error {}

// An unread body is let go of, so the connection can carry the next one.
export function drainCloudStreamBody(req: ExpressRequest): void {
  if (typeof req.resume === "function") {
    req.resume();
  }
}

/*
 * The body as sent, at most `maxBytes`: throws CloudStreamBodyTooLarge past
 * it, and an Error when something read the body first.
 */
export async function readCloudStreamBody(
  req: ExpressRequest,
  maxBytes: number,
): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) {
      throw new CloudStreamBodyTooLarge();
    }

    return req.body;
  }

  /*
   * A body something read before this route (a body parser StartServer
   * did not leave the path to) is gone: said at once, as a failure the
   * sender sends again, rather than waited for until the socket times out.
   */
  if ((req as { readableEnded?: boolean }).readableEnded === true) {
    throw new Error(
      "The delivery's body was read before the stream endpoint could read it.",
    );
  }

  const declared: number = parseInt(
    headerValueToString(req.headers["content-length"]) || "",
    10,
  );

  if (Number.isFinite(declared) && declared > maxBytes) {
    drainCloudStreamBody(req);
    throw new CloudStreamBodyTooLarge();
  }

  return await new Promise<Buffer>(
    (resolve: (body: Buffer) => void, reject: (error: Error) => void) => {
      const chunks: Array<Uint8Array> = [];
      let received: number = 0;
      let isDone: boolean = false;

      const onData: (chunk: Buffer | string) => void = (
        chunk: Buffer | string,
      ): void => {
        if (isDone) {
          return;
        }

        const buffer: Buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, "utf8");
        received += buffer.length;

        if (received > maxBytes) {
          isDone = true;
          chunks.length = 0;
          req.removeListener("data", onData);
          req.resume();
          reject(new CloudStreamBodyTooLarge());
          return;
        }

        chunks.push(new Uint8Array(buffer));
      };

      req.on("data", onData);
      req.on("end", () => {
        if (!isDone) {
          isDone = true;
          resolve(Buffer.concat(chunks));
        }
      });
      req.on("error", (error: Error) => {
        if (!isDone) {
          isDone = true;
          reject(error);
        }
      });
    },
  );
}
