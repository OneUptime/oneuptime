import { isMainThread, parentPort, MessagePort } from "worker_threads";
import OtelDecode, {
  OtelPayloadEncoding,
  OtelPayloadFormat,
} from "./OtelDecode";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

/*
 * Worker-thread entry point for the telemetry decode pool.
 *
 * DecodeThreadPool spawns this FILE (the .ts source — the app runs
 * through ts-node in both dev and prod, so the worker is loaded with
 * `-r ts-node/register/transpile-only` in execArgv) and speaks a tiny
 * id-correlated request/response protocol over `parentPort`:
 *
 *   request:  { id, productType, format, encoding, payload: ArrayBuffer }
 *   response: { id, ok: true, result }
 *           | { id, ok: false, errorMessage, errorStack }
 *
 * The payload arrives as a TRANSFERRED ArrayBuffer (zero-copy handoff —
 * the pool already paid the one defensive memcpy on the main thread, see
 * DecodeThreadPool for why). `Buffer.from(arrayBuffer)` below wraps it
 * in a Buffer VIEW over the same memory without copying, so the thread
 * adds no allocation of its own before decoding.
 *
 * Failure model: a malformed payload (bad gzip stream, truncated
 * protobuf, invalid JSON) is a PER-MESSAGE failure — it must reject
 * that one request, never kill the thread. Every message is therefore
 * wrapped in try/catch and answered with an ok:false response carrying
 * the error text; the pool re-throws it to the caller and the thread
 * lives on to serve the next request. Only a genuinely unexpected crash
 * (OOM, a bug outside the catch) surfaces as a thread 'error'/'exit',
 * which the pool handles by rejecting that thread's in-flight request
 * and respawning.
 *
 * Import discipline: only node builtins + OtelDecode (+ type-only
 * imports, elided at emit). This file runs in a fresh thread with its
 * own module registry — importing any infrastructure module here would
 * open per-thread datastore connections. Don't.
 */

export interface DecodeRequestMessage {
  id: number;
  productType: ProductType;
  format: OtelPayloadFormat;
  encoding: OtelPayloadEncoding;
  payload: ArrayBuffer;
}

export type DecodeResponseMessage =
  | { id: number; ok: true; result: JSONObject }
  | {
      id: number;
      ok: false;
      errorMessage: string;
      errorStack: string | undefined;
    };

async function handleDecodeRequest(
  port: MessagePort,
  message: DecodeRequestMessage,
): Promise<void> {
  try {
    /*
     * Zero-copy: Buffer.from(ArrayBuffer) creates a view over the
     * transferred memory, not a copy.
     */
    const body: Buffer = Buffer.from(message.payload);

    const result: JSONObject = await OtelDecode.decodeBody({
      productType: message.productType,
      format: message.format,
      encoding: message.encoding,
      body: body,
    });

    const response: DecodeResponseMessage = {
      id: message.id,
      ok: true,
      result: result,
    };
    port.postMessage(response);
  } catch (err) {
    const error: Error = err instanceof Error ? err : new Error(String(err));
    const response: DecodeResponseMessage = {
      id: message.id,
      ok: false,
      errorMessage: error.message,
      errorStack: error.stack,
    };
    port.postMessage(response);
  }
}

/*
 * Guarded so that an accidental import of this file on the MAIN thread
 * (e.g. for the message types above, or by a test) is completely inert:
 * no listener is attached and nothing runs.
 */
if (!isMainThread && parentPort) {
  const port: MessagePort = parentPort;
  port.on("message", (message: DecodeRequestMessage): void => {
    void handleDecodeRequest(port, message);
  });
}
