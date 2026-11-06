import net from "net";
import tls from "tls";
import { EgressLookupFunction } from "../../DataSource/EgressGuard";
import {
  API_KEY_API_VERSIONS,
  API_KEY_FETCH,
  API_KEY_LIST_OFFSETS,
  API_KEY_METADATA,
  API_KEY_SASL_AUTHENTICATE,
  API_KEY_SASL_HANDSHAKE,
  ApiVersionRange,
  FetchPartitionRequest,
  KAFKA_ERROR_NONE,
  KAFKA_REQUEST_VERSIONS,
  KafkaBroker,
  KafkaFetchedPartition,
  KafkaPartitionOffset,
  KafkaProtocolError,
  KafkaTopicMetadata,
  decodeApiVersions,
  decodeFetch,
  decodeListOffsets,
  decodeMetadata,
  decodeSaslAuthenticate,
  decodeSaslHandshake,
  encodeFetch,
  encodeListOffsets,
  encodeMetadata,
  encodeSaslAuthenticate,
  encodeSaslHandshake,
  frameRequest,
  oauthBearerInitialResponse,
} from "./KafkaProtocol";

/*
 * ONE CONNECTION TO A KAFKA BROKER - AN EVENT HUBS NAMESPACE - AND THE FEW
 * REQUESTS A PARTITION READER MAKES ON IT.
 *
 * A socket (TLS to Event Hubs; the caller hands the socket factory, so a
 * test can hand a plain one), requests sent one after another and their
 * answers matched by correlation id. Every answer is a frame of at most
 * maxFrameBytes, read as it arrives: a frame that says it is larger closes
 * the connection before a byte of it is kept. Every request has a time
 * limit, and a connection that closes fails every request waiting on it.
 *
 * Signs in with SASL OAUTHBEARER (an Entra token, for Event Hubs): the
 * broker's API versions are asked first, then the handshake and the token.
 * A refused token is a KafkaAuthenticationError, so the reader can tell
 * "may not read" from "could not reach".
 */

export class KafkaAuthenticationError extends Error {}
export class KafkaConnectionError extends Error {}

export interface KafkaSocketOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

// Opens the socket a client talks on: TLS to Event Hubs.
export type KafkaSocketFactory = (options: KafkaSocketOptions) => net.Socket;

export interface KafkaClientOptions {
  host: string;
  port: number;
  clientId: string;
  // The longest one request may wait for its answer.
  timeoutMs: number;
  // The largest answer taken.
  maxFrameBytes: number;
  socketFactory: KafkaSocketFactory;
}

interface PendingRequest {
  resolve: (body: Buffer) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/*
 * A TLS socket to a host, TLS 1.2 or later, the host's own name checked
 * against its certificate. `lookup` pins the addresses an egress check
 * already allowed.
 */
export function createTlsSocketFactory(
  lookup?: EgressLookupFunction | undefined,
): KafkaSocketFactory {
  return (options: KafkaSocketOptions): net.Socket => {
    return tls.connect({
      host: options.host,
      port: options.port,
      servername: options.host,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      ...(lookup ? { lookup: lookup as never } : {}),
    });
  };
}

export default class KafkaClient {
  private options: KafkaClientOptions;
  private socket: net.Socket | null = null;
  private pending: Map<number, PendingRequest> = new Map();
  private nextCorrelationId: number = 1;
  // What arrived of the next answer, and its size once its first four bytes did.
  private chunks: Array<Buffer> = [];
  private receivedBytes: number = 0;
  private expectedBytes: number | null = null;
  private closedError: Error | null = null;
  private versions: Map<number, ApiVersionRange> = new Map();

  public constructor(options: KafkaClientOptions) {
    this.options = options;
  }

  public async connect(): Promise<void> {
    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        const socket: net.Socket = this.options.socketFactory({
          host: this.options.host,
          port: this.options.port,
          timeoutMs: this.options.timeoutMs,
        });
        const isTls: boolean = socket instanceof tls.TLSSocket;
        let isSettled: boolean = false;

        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            socket.destroy();
            reject(
              new KafkaConnectionError(
                `${this.options.host} did not answer within ${this.options.timeoutMs} ms.`,
              ),
            );
          }
        }, this.options.timeoutMs);

        socket.once(isTls ? "secureConnect" : "connect", () => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            resolve();
          }
        });

        socket.on("error", (error: Error) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            reject(
              new KafkaConnectionError(
                `${this.options.host} could not be reached: ${error.message}`,
              ),
            );
          }

          this.fail(
            new KafkaConnectionError(
              `The connection to ${this.options.host} failed: ${error.message}`,
            ),
          );
        });

        socket.on("close", () => {
          this.fail(
            new KafkaConnectionError(
              `${this.options.host} closed the connection.`,
            ),
          );
        });

        socket.on("data", (chunk: Buffer) => {
          this.onData(chunk);
        });

        this.socket = socket;
      },
    );
  }

  public close(): void {
    this.fail(new KafkaConnectionError("The connection was closed."));
    this.socket?.destroy();
    this.socket = null;
  }

  // What the broker takes, asked first: every later request is one of its versions.
  public async readApiVersions(): Promise<void> {
    const body: Buffer = await this.send(API_KEY_API_VERSIONS, Buffer.alloc(0));
    const answer: { errorCode: number; versions: Array<ApiVersionRange> } =
      decodeApiVersions(body);

    if (answer.errorCode !== KAFKA_ERROR_NONE) {
      throw new KafkaProtocolError(
        `The broker refused to say what it takes (error ${answer.errorCode}).`,
      );
    }

    this.versions = new Map(
      answer.versions.map((range: ApiVersionRange): [number, ApiVersionRange] => {
        return [range.apiKey, range];
      }),
    );

    for (const apiKey of Object.keys(KAFKA_REQUEST_VERSIONS)) {
      const key: number = Number(apiKey);
      const version: number = KAFKA_REQUEST_VERSIONS[key]!;
      const range: ApiVersionRange | undefined = this.versions.get(key);

      if (
        key !== API_KEY_API_VERSIONS &&
        (!range || range.minVersion > version || range.maxVersion < version)
      ) {
        throw new KafkaProtocolError(
          `The broker does not take version ${version} of request ${key}.`,
        );
      }
    }
  }

  // Signs in with an OAuth 2.0 bearer token (SASL OAUTHBEARER).
  public async authenticateWithToken(token: string): Promise<void> {
    const handshake: { errorCode: number; mechanisms: Array<string> } =
      decodeSaslHandshake(
        await this.send(API_KEY_SASL_HANDSHAKE, encodeSaslHandshake("OAUTHBEARER")),
      );

    if (handshake.errorCode !== KAFKA_ERROR_NONE) {
      throw new KafkaAuthenticationError(
        `The broker does not take OAUTHBEARER sign-in (it takes ${
          handshake.mechanisms.join(", ") || "none"
        }).`,
      );
    }

    const answer: { errorCode: number; errorMessage: string } =
      decodeSaslAuthenticate(
        await this.send(
          API_KEY_SASL_AUTHENTICATE,
          encodeSaslAuthenticate(oauthBearerInitialResponse(token)),
        ),
      );

    if (answer.errorCode !== KAFKA_ERROR_NONE) {
      throw new KafkaAuthenticationError(
        answer.errorMessage || `The broker refused the token (error ${answer.errorCode}).`,
      );
    }
  }

  public async getMetadata(topic: string): Promise<{
    brokers: Array<KafkaBroker>;
    topic: KafkaTopicMetadata | null;
  }> {
    const answer: { brokers: Array<KafkaBroker>; topics: Array<KafkaTopicMetadata> } =
      decodeMetadata(await this.send(API_KEY_METADATA, encodeMetadata([topic])));

    return {
      brokers: answer.brokers,
      topic:
        answer.topics.find((candidate: KafkaTopicMetadata): boolean => {
          return candidate.topic === topic;
        }) || null,
    };
  }

  public async listOffsets(data: {
    topic: string;
    partitions: Array<number>;
    timestamp: number;
  }): Promise<Array<KafkaPartitionOffset>> {
    return decodeListOffsets(
      await this.send(API_KEY_LIST_OFFSETS, encodeListOffsets(data)),
    );
  }

  public async fetch(data: {
    topic: string;
    partitions: Array<FetchPartitionRequest>;
    maxWaitMs: number;
    minBytes: number;
    maxBytes: number;
  }): Promise<{ throttleTimeMs: number; partitions: Array<KafkaFetchedPartition> }> {
    return decodeFetch(await this.send(API_KEY_FETCH, encodeFetch(data)));
  }

  private async send(apiKey: number, body: Buffer): Promise<Buffer> {
    if (this.closedError) {
      throw this.closedError;
    }

    if (!this.socket) {
      throw new KafkaConnectionError("Not connected.");
    }

    const correlationId: number = this.nextCorrelationId;
    this.nextCorrelationId = (this.nextCorrelationId % 2_000_000_000) + 1;

    const frame: Buffer = frameRequest({
      apiKey,
      apiVersion: KAFKA_REQUEST_VERSIONS[apiKey]!,
      correlationId,
      clientId: this.options.clientId,
      body,
    });

    return await new Promise<Buffer>(
      (resolve: (body: Buffer) => void, reject: (error: Error) => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          this.pending.delete(correlationId);
          reject(
            new KafkaConnectionError(
              `${this.options.host} did not answer request ${apiKey} within ${this.options.timeoutMs} ms.`,
            ),
          );
          // A late answer would be read as the next one's: the connection is done.
          this.close();
        }, this.options.timeoutMs);

        this.pending.set(correlationId, { resolve, reject, timer });
        this.socket!.write(frame);
      },
    );
  }

  /*
   * The bytes as they arrive: an answer's size is read from its first four,
   * refused at once when past the limit, and the answer is put together
   * once, when all of it has come.
   */
  private onData(chunk: Buffer): void {
    if (this.closedError) {
      return;
    }

    this.chunks.push(chunk);
    this.receivedBytes += chunk.length;

    for (;;) {
      if (this.expectedBytes === null) {
        if (this.receivedBytes < 4) {
          return;
        }

        const head: Buffer =
          this.chunks[0]!.length >= 4
            ? this.chunks[0]!
            : Buffer.concat(this.chunks, this.receivedBytes);
        const size: number = head.readInt32BE(0);

        if (size < 4 || size > this.options.maxFrameBytes) {
          this.fail(
            new KafkaProtocolError(
              `${this.options.host} sent an answer of ${size} bytes, past the ${this.options.maxFrameBytes} taken.`,
            ),
          );
          this.chunks = [];
          this.receivedBytes = 0;
          this.socket?.destroy();
          return;
        }

        this.expectedBytes = size;
      }

      if (this.receivedBytes < 4 + this.expectedBytes) {
        return;
      }

      const all: Buffer = Buffer.concat(this.chunks, this.receivedBytes);
      const frame: Buffer = all.subarray(4, 4 + this.expectedBytes);
      const rest: Buffer = all.subarray(4 + this.expectedBytes);

      this.chunks = rest.length > 0 ? [rest] : [];
      this.receivedBytes = rest.length;
      this.expectedBytes = null;

      const correlationId: number = frame.readInt32BE(0);
      const request: PendingRequest | undefined = this.pending.get(correlationId);

      if (!request) {
        // An answer to no request: the stream cannot be trusted past it.
        this.fail(
          new KafkaProtocolError(
            `${this.options.host} answered a request it was not sent.`,
          ),
        );
        this.socket?.destroy();
        return;
      }

      this.pending.delete(correlationId);
      clearTimeout(request.timer);
      request.resolve(Buffer.from(frame.subarray(4)));
    }
  }

  private fail(error: Error): void {
    if (!this.closedError) {
      this.closedError = error;
    }

    for (const [correlationId, request] of this.pending) {
      clearTimeout(request.timer);
      this.pending.delete(correlationId);
      request.reject(error);
    }
  }
}
