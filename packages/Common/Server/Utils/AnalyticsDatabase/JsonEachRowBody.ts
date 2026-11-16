import { JSONObject } from "../../../Types/JSON";
import { Readable, Stream } from "stream";

/*
 * ---------------------------------------------------------------------------
 * THE BODY OF A JSONEachRow INSERT, WITHOUT ONE STRING OF EVERY ROW.
 *
 * Handed an array of rows, @clickhouse/client writes the insert body as
 * `rows.map((row) => JSON.stringify(row) + "\n").join("")`: an array of one
 * string per row, then one string of them all - several megabytes for a
 * fan-in batch, allocated where only a full garbage collection frees it,
 * and stored two bytes a character when a single row holds a character past
 * Latin-1 - which the gzip stream then copies into a Buffer. Under OTLP load
 * those two strings were 19% of everything the App allocated (#6086).
 *
 * These are the same bytes - each row's JSON.stringify and a line break, in
 * order - written in 32 KB pieces straight into Buffers: a third to a half
 * less CPU per batch, and nothing large left on the heap. A row that cannot
 * be written (a BigInt, a cycle) still throws before any request is made.
 * ---------------------------------------------------------------------------
 */

// Characters per piece: small enough for a young-generation string.
export const JSON_EACH_ROW_CHUNK_CHARS: number = 32 * 1024;

export default class JsonEachRowBody {
  // The body, in pieces, exactly as the client's own encoder writes it.
  public static encode(
    rows: ReadonlyArray<JSONObject>,
    chunkChars: number = JSON_EACH_ROW_CHUNK_CHARS,
  ): Array<Buffer> {
    const chunks: Array<Buffer> = [];
    let chunk: string = "";

    for (const row of rows) {
      chunk += JSON.stringify(row) + "\n";

      if (chunk.length >= chunkChars) {
        chunks.push(Buffer.from(chunk, "utf-8"));
        chunk = "";
      }
    }

    if (chunk.length > 0) {
      chunks.push(Buffer.from(chunk, "utf-8"));
    }

    return chunks;
  }

  // The body as the stream an exec() of the INSERT statement sends.
  public static toStream(chunks: ReadonlyArray<Buffer>): Readable {
    return Readable.from(chunks, { objectMode: false });
  }

  /*
   * Reads a response to its end - an INSERT answers with nothing - which is
   * what hands the HTTP connection back to the pool.
   */
  public static drain(response: Stream): Promise<void> {
    return new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        const readable: Readable = response as Readable;

        readable.on("error", reject);
        readable.on("end", () => {
          resolve();
        });
        readable.resume();
      },
    );
  }
}
