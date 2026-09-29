import dgram from "dgram";
import { AddressInfo } from "net";

/*
 * A tiny authoritative DNS server on 127.0.0.1, for driving the REAL c-ares
 * resolver in a unit test (OneUptime issue #3916).
 *
 * Why a real resolver needs a test at all: the bug behind #3916 was not in
 * any code this repository wrote. Node's Resolver#reverse — the call the
 * probe used — goes through c-ares' ares_gethostbyaddr, which reports
 * SERVFAIL, REFUSED, NODATA, "nothing listening" and its own timeout all as
 * ENOTFOUND. Every test at the time injected the codes a resolver SHOULD
 * produce, so every test passed while production could only ever see one of
 * them. Only a real resolver asking a real server can pin what the probe
 * actually observes, and only a server the test controls can make it answer
 * SERVFAIL on demand.
 *
 * Hand-rolled wire format, UDP only, and deliberately small:
 *
 * - One question per query, answered by a callback that is handed the query
 *   name, its type and how many times THIS server has now seen that name
 *   (so "drop the first datagram, answer the second" is one line).
 * - Replies: PTR answers (optionally behind an RFC 2317 CNAME), any RCODE
 *   with no answers (NXDOMAIN, SERVFAIL, REFUSED — and NOERROR with nothing,
 *   which is NODATA), a delay before any reply, or no reply at all.
 * - Every query is logged with the time it arrived, so a test can say which
 *   server was asked, how often, and in what order.
 *
 * Binds port 0 and reports the port the kernel chose, so suites never collide
 * with each other or with anything on the machine; nothing but 127.0.0.1 is
 * ever sent to. Close it in afterAll: close() also cancels replies still
 * waiting out a delay.
 */

export enum DnsResponseCode {
  NoError = 0,
  FormatError = 1,
  ServerFailure = 2,
  NameError = 3,
  NotImplemented = 4,
  Refused = 5,
}

export const DNS_TYPE_PTR: number = 12;
const DNS_TYPE_CNAME: number = 5;
const DNS_CLASS_IN: number = 1;
const ANSWER_TTL_IN_SECONDS: number = 60;

export interface FakeDnsQuery {
  // The query name as received, without the trailing dot.
  name: string;
  type: number;
  /*
   * 1 the first time this server sees this name (case-insensitively), 2 the
   * second, and so on, across every client and resolver.
   */
  attempt: number;
  receivedAt: number;
}

export type FakeDnsReply =
  | {
      kind: "answer";
      // PTR targets, in the order they go on the wire.
      names: Array<string>;
      /*
       * RFC 2317 classless delegation: answer with a CNAME from the query
       * name to this name, followed by the PTR records owned by it.
       */
      cnameTarget?: string | undefined;
      delayInMs?: number | undefined;
    }
  | {
      kind: "rcode";
      responseCode: DnsResponseCode;
      delayInMs?: number | undefined;
    }
  | { kind: "drop" };

export type FakeDnsResponder = (query: FakeDnsQuery) => FakeDnsReply;

export function ptrReply(
  names: Array<string>,
  options?: {
    cnameTarget?: string | undefined;
    delayInMs?: number | undefined;
  },
): FakeDnsReply {
  return {
    kind: "answer",
    names: names,
    cnameTarget: options?.cnameTarget,
    delayInMs: options?.delayInMs,
  };
}

export function rcodeReply(
  responseCode: DnsResponseCode,
  options?: { delayInMs?: number | undefined },
): FakeDnsReply {
  return {
    kind: "rcode",
    responseCode: responseCode,
    delayInMs: options?.delayInMs,
  };
}

export function dropReply(): FakeDnsReply {
  return { kind: "drop" };
}

const DECIMAL_OCTET_PATTERN: RegExp = /^\d{1,3}$/;

/*
 * The IPv4 address a reverse query name stands for — "51.42.16.10.in-addr.arpa"
 * is 10.16.42.51 — or undefined for any other name. Written out by hand
 * rather than borrowed from the code under test, so a responder keyed on
 * addresses cannot agree with a bug in the name it is asked for.
 */
export function ipv4AddressOfReverseName(name: string): string | undefined {
  const labels: Array<string> = name.toLowerCase().split(".");

  if (
    labels.length !== 6 ||
    labels[4] !== "in-addr" ||
    labels[5] !== "arpa" ||
    !labels.slice(0, 4).every((label: string): boolean => {
      return DECIMAL_OCTET_PATTERN.test(label);
    })
  ) {
    return undefined;
  }

  return labels.slice(0, 4).reverse().join(".");
}

export interface FakeDnsServer {
  port: number;
  // "127.0.0.1:<port>", the spelling Resolver#setServers takes.
  address: string;
  queries: Array<FakeDnsQuery>;
  // Every query for this name, case-insensitively, in arrival order.
  queriesFor: (name: string) => Array<FakeDnsQuery>;
  close: () => Promise<void>;
}

interface ParsedQuery {
  id: number;
  flags: number;
  name: string;
  type: number;
  // The raw question section, echoed back verbatim in the reply.
  question: Buffer;
}

function parseQuery(message: Buffer): ParsedQuery | undefined {
  if (message.length < 12 || message.readUInt16BE(4) < 1) {
    return undefined;
  }

  const labels: Array<string> = [];
  let offset: number = 12;

  for (;;) {
    if (offset >= message.length) {
      return undefined;
    }

    const length: number = message[offset]!;
    offset++;

    if (length === 0) {
      break;
    }

    // A compression pointer or an overrun: not a question this server reads.
    if (length > 63 || offset + length > message.length) {
      return undefined;
    }

    labels.push(message.subarray(offset, offset + length).toString("latin1"));
    offset += length;
  }

  if (offset + 4 > message.length) {
    return undefined;
  }

  return {
    id: message.readUInt16BE(0),
    flags: message.readUInt16BE(2),
    name: labels.join("."),
    type: message.readUInt16BE(offset),
    question: message.subarray(12, offset + 4),
  };
}

function encodeName(name: string): Buffer {
  const parts: Array<Buffer> = [];

  for (const label of name.replace(/\.$/, "").split(".")) {
    if (!label) {
      continue;
    }

    const bytes: Buffer = Buffer.from(label, "latin1");
    parts.push(Buffer.from([bytes.length]), bytes);
  }

  parts.push(Buffer.from([0]));

  return Buffer.concat(parts);
}

function resourceRecord(owner: Buffer, type: number, rdata: Buffer): Buffer {
  const fixed: Buffer = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(DNS_CLASS_IN, 2);
  fixed.writeUInt32BE(ANSWER_TTL_IN_SECONDS, 4);
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([owner, fixed, rdata]);
}

function buildReply(
  query: ParsedQuery,
  responseCode: DnsResponseCode,
  answers: Array<Buffer>,
): Buffer {
  const header: Buffer = Buffer.alloc(12);
  header.writeUInt16BE(query.id, 0);
  header.writeUInt16BE(
    0x8000 | // QR: a response
      (query.flags & 0x7800) | // the query's opcode
      0x0400 | // AA: authoritative
      (query.flags & 0x0100) | // RD, echoed
      0x0080 | // RA
      (responseCode & 0x000f),
    2,
  );
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  return Buffer.concat([header, query.question, ...answers]);
}

// A pointer to the question name, which always sits at offset 12.
const QUESTION_NAME_POINTER: Buffer = Buffer.from([0xc0, 0x0c]);

function answerRecords(
  reply: Extract<FakeDnsReply, { kind: "answer" }>,
): Array<Buffer> {
  if (reply.cnameTarget) {
    const target: Buffer = encodeName(reply.cnameTarget);

    return [
      resourceRecord(QUESTION_NAME_POINTER, DNS_TYPE_CNAME, target),
      ...reply.names.map((name: string): Buffer => {
        return resourceRecord(target, DNS_TYPE_PTR, encodeName(name));
      }),
    ];
  }

  return reply.names.map((name: string): Buffer => {
    return resourceRecord(
      QUESTION_NAME_POINTER,
      DNS_TYPE_PTR,
      encodeName(name),
    );
  });
}

export async function startFakeDnsServer(
  respond: FakeDnsResponder,
): Promise<FakeDnsServer> {
  const socket: dgram.Socket = dgram.createSocket("udp4");
  const queries: Array<FakeDnsQuery> = [];
  const attemptsByName: Map<string, number> = new Map<string, number>();
  const pendingReplies: Set<ReturnType<typeof setTimeout>> = new Set<
    ReturnType<typeof setTimeout>
  >();
  const lifecycle: { isClosed: boolean } = { isClosed: false };

  socket.on("message", (message: Buffer, remote: dgram.RemoteInfo) => {
    const parsed: ParsedQuery | undefined = parseQuery(message);

    if (!parsed) {
      return;
    }

    const key: string = parsed.name.toLowerCase();
    const attempt: number = (attemptsByName.get(key) ?? 0) + 1;
    attemptsByName.set(key, attempt);

    const query: FakeDnsQuery = {
      name: parsed.name,
      type: parsed.type,
      attempt: attempt,
      receivedAt: Date.now(),
    };

    queries.push(query);

    const reply: FakeDnsReply = respond(query);

    if (reply.kind === "drop") {
      return;
    }

    const wire: Buffer =
      reply.kind === "rcode"
        ? buildReply(parsed, reply.responseCode, [])
        : buildReply(parsed, DnsResponseCode.NoError, answerRecords(reply));

    const send: () => void = (): void => {
      if (lifecycle.isClosed) {
        return;
      }

      socket.send(wire, remote.port, remote.address);
    };

    if (reply.delayInMs && reply.delayInMs > 0) {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        pendingReplies.delete(timer);
        send();
      }, reply.delayInMs);
      pendingReplies.add(timer);
      return;
    }

    send();
  });

  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      socket.once("error", reject);
      socket.bind(0, "127.0.0.1", () => {
        socket.off("error", reject);
        resolve();
      });
    },
  );

  const port: number = (socket.address() as AddressInfo).port;

  return {
    port: port,
    address: `127.0.0.1:${port}`,
    queries: queries,
    queriesFor: (name: string): Array<FakeDnsQuery> => {
      return queries.filter((query: FakeDnsQuery): boolean => {
        return query.name.toLowerCase() === name.toLowerCase();
      });
    },
    close: async (): Promise<void> => {
      if (lifecycle.isClosed) {
        return;
      }

      lifecycle.isClosed = true;

      for (const timer of pendingReplies) {
        clearTimeout(timer);
      }

      pendingReplies.clear();

      await new Promise<void>((resolve: () => void) => {
        socket.close(() => {
          resolve();
        });
      });
    },
  };
}

/*
 * A loopback UDP port with nothing listening on it: bound, read and closed
 * again. A query sent there draws an ICMP port-unreachable, which c-ares
 * reports as ECONNREFUSED — the "resolv.conf names a host that runs no DNS
 * server" case. The kernel could in principle hand the port to someone else
 * in between; on loopback, within one test, it does not in practice.
 */
export async function reserveClosedUdpPort(): Promise<number> {
  const socket: dgram.Socket = dgram.createSocket("udp4");

  await new Promise<void>((resolve: () => void) => {
    socket.bind(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port: number = (socket.address() as AddressInfo).port;

  await new Promise<void>((resolve: () => void) => {
    socket.close(() => {
      resolve();
    });
  });

  return port;
}
