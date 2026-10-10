import NtpPacket, {
  NTP_PACKET_LENGTH,
  NtpMode,
} from "../../../../../Utils/Monitors/MonitorTypes/NtpMonitor/NtpPacket";
import dgram from "dgram";

/*
 * A real UDP NTP server on 127.0.0.1, for the probe's NTP check to talk to
 * over real sockets. Each request is answered the way `behaviour` says: a
 * healthy server with its clock skewed by clockSkewInMs, a kiss-o'-death, an
 * unsynchronized server, silence, or the kinds of packet a client must not
 * take for a reply.
 */

export enum FakeNtpBehaviour {
  Healthy = "Healthy",
  // ntpd's RATE kiss: stratum 0, LI 3, every timestamp a copy of the request's.
  KissOfDeathRate = "KissOfDeathRate",
  // ntpd before its first sync: stratum 0, LI 3, kiss code INIT, real time.
  NotYetSynchronized = "NotYetSynchronized",
  // chrony unsynchronized: stratum 16, LI 3, real time.
  Stratum16 = "Stratum16",
  Silent = "Silent",
  // A reply that does not echo the request's transmit timestamp.
  WrongOriginOnly = "WrongOriginOnly",
  // A stale reply first, then the real one.
  WrongOriginThenReal = "WrongOriginThenReal",
  ShortPacketOnly = "ShortPacketOnly",
  // The request sent back as it came: mode 3, not a server reply.
  EchoRequestOnly = "EchoRequestOnly",
  // Silent to the first N requests, then healthy.
  SilentThenHealthy = "SilentThenHealthy",
}

export interface FakeNtpServerOptions {
  behaviour: FakeNtpBehaviour;
  // How far ahead (positive) or behind (negative) the server's clock is.
  clockSkewInMs?: number | undefined;
  stratum?: number | undefined;
  leapIndicator?: number | undefined;
  version?: number | undefined;
  // How long the server takes to answer.
  replyDelayInMs?: number | undefined;
  referenceId?: Buffer | undefined;
  // For SilentThenHealthy: how many requests go unanswered first.
  silentRequestCount?: number | undefined;
}

export default class FakeNtpServer {
  public requests: Array<Buffer> = [];
  public port: number = 0;
  private socket: dgram.Socket | undefined = undefined;
  private options: FakeNtpServerOptions;

  public constructor(options: FakeNtpServerOptions) {
    this.options = options;
  }

  public setOptions(options: FakeNtpServerOptions): void {
    this.options = options;
  }

  public async start(): Promise<number> {
    const socket: dgram.Socket = dgram.createSocket("udp4");
    this.socket = socket;

    socket.on("message", (request: Buffer, remote: dgram.RemoteInfo): void => {
      this.requests.push(request);
      const receivedAtMs: number = Date.now();

      const send: (packets: Array<Buffer>) => void = (
        packets: Array<Buffer>,
      ): void => {
        for (const packet of packets) {
          socket.send(packet, remote.port, remote.address);
        }
      };

      const packets: Array<Buffer> = this.buildReplies(request, receivedAtMs);

      if (this.options.replyDelayInMs) {
        setTimeout((): void => {
          send(packets);
        }, this.options.replyDelayInMs);
      } else {
        send(packets);
      }
    });

    await new Promise<void>((resolve: () => void): void => {
      socket.bind(0, "127.0.0.1", resolve);
    });

    this.port = socket.address().port;

    return this.port;
  }

  public async stop(): Promise<void> {
    if (!this.socket) {
      return;
    }

    const socket: dgram.Socket = this.socket;
    this.socket = undefined;

    await new Promise<void>((resolve: () => void): void => {
      socket.close(resolve);
    });
  }

  private buildReplies(request: Buffer, receivedAtMs: number): Array<Buffer> {
    const origin: Buffer = Buffer.from(request.subarray(40, 48));

    switch (this.options.behaviour) {
      case FakeNtpBehaviour.Silent:
        return [];

      case FakeNtpBehaviour.SilentThenHealthy:
        if (this.requests.length <= (this.options.silentRequestCount ?? 1)) {
          return [];
        }

        return [this.buildReply({ origin, receivedAtMs })];

      case FakeNtpBehaviour.Healthy:
        return [this.buildReply({ origin, receivedAtMs })];

      case FakeNtpBehaviour.KissOfDeathRate: {
        const reply: Buffer = FakeNtpServer.header({
          leapIndicator: 3,
          version: 4,
          stratum: 0,
          referenceId: Buffer.from("RATE", "ascii"),
        });

        origin.copy(reply, 24);
        origin.copy(reply, 32);
        origin.copy(reply, 40);

        return [reply];
      }

      case FakeNtpBehaviour.NotYetSynchronized:
        return [
          this.buildReply({
            origin,
            receivedAtMs,
            stratum: 0,
            leapIndicator: 3,
            referenceId: Buffer.from("INIT", "ascii"),
          }),
        ];

      case FakeNtpBehaviour.Stratum16:
        return [
          this.buildReply({
            origin,
            receivedAtMs,
            stratum: 16,
            leapIndicator: 3,
          }),
        ];

      case FakeNtpBehaviour.WrongOriginOnly:
        return [
          this.buildReply({
            origin: Buffer.from("0102030405060708", "hex"),
            receivedAtMs,
          }),
        ];

      case FakeNtpBehaviour.WrongOriginThenReal:
        return [
          this.buildReply({
            origin: Buffer.from("0102030405060708", "hex"),
            receivedAtMs,
            clockSkewInMs: 99999,
          }),
          this.buildReply({ origin, receivedAtMs }),
        ];

      case FakeNtpBehaviour.ShortPacketOnly:
        return [Buffer.alloc(NTP_PACKET_LENGTH - 1, 0x24)];

      case FakeNtpBehaviour.EchoRequestOnly:
        return [Buffer.from(request)];

      default:
        return [];
    }
  }

  private buildReply(data: {
    origin: Buffer;
    receivedAtMs: number;
    stratum?: number | undefined;
    leapIndicator?: number | undefined;
    referenceId?: Buffer | undefined;
    clockSkewInMs?: number | undefined;
  }): Buffer {
    const skew: number = data.clockSkewInMs ?? this.options.clockSkewInMs ?? 0;

    const reply: Buffer = FakeNtpServer.header({
      leapIndicator: data.leapIndicator ?? this.options.leapIndicator ?? 0,
      version: this.options.version ?? 4,
      stratum: data.stratum ?? this.options.stratum ?? 2,
      referenceId:
        data.referenceId ??
        this.options.referenceId ??
        Buffer.from([192, 0, 2, 1]),
    });

    NtpPacket.unixMsToTimestamp(data.receivedAtMs + skew - 60000).copy(
      reply,
      16,
    );
    data.origin.copy(reply, 24);
    NtpPacket.unixMsToTimestamp(data.receivedAtMs + skew).copy(reply, 32);
    NtpPacket.unixMsToTimestamp(Date.now() + skew).copy(reply, 40);

    return reply;
  }

  public static header(data: {
    leapIndicator: number;
    version: number;
    stratum: number;
    referenceId: Buffer;
  }): Buffer {
    const reply: Buffer = Buffer.alloc(NTP_PACKET_LENGTH);

    reply.writeUInt8(
      (data.leapIndicator << 6) | (data.version << 3) | NtpMode.Server,
      0,
    );
    reply.writeUInt8(data.stratum, 1);
    reply.writeInt8(6, 2);
    reply.writeInt8(-20, 3);
    reply.writeUInt32BE(NtpPacket.msToShortFormat(12.5), 4);
    reply.writeUInt32BE(NtpPacket.msToShortFormat(3.25), 8);
    data.referenceId.copy(reply, 12);

    return reply;
  }
}
