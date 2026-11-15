import Redis, { ClientType } from "./Redis";
import logger from "../Utils/Logger";
import {
  ClusterAdapterOptions,
  ClusterAdapterWithHeartbeat,
  ClusterMessage,
  ClusterResponse,
  Offset,
  ServerId,
} from "socket.io-adapter";

/*
 * EVERY APP SERVER'S LIVE CONNECTIONS AS ONE (#8662).
 *
 * Each App process - an app pod, a worker pod, the telemetry writer, all
 * the same image - holds its own socket.io server, and a page's socket is
 * connected to one of them. A record written on one process used to be
 * heard only by the sockets that process held: with more than one replica,
 * or a worker opening the incident, the pages connected elsewhere heard
 * nothing until they were reloaded.
 *
 * This is socket.io's own cluster adapter (socket.io-adapter's
 * ClusterAdapterWithHeartbeat, which keeps the cluster's members by their
 * heartbeats, and asks them and waits for their answers) over a Valkey
 * channel: every process's socket.io server is a member, and can ask the
 * others which of their sockets listen to a room, and send to sockets they
 * hold. Who may hear what is still decided by Realtime, in one place, as
 * before (see Realtime.fetchListeningSockets).
 *
 * Only this transport is ours: a message is published on CHANNEL, which
 * every member listens to, and an answer on the asking member's own
 * channel. Messages are JSON - Realtime sends nothing else. A member whose
 * subscription is not working publishes nothing either, so the others
 * never count on it to answer, and a member that stops (a restart, a
 * crash) is let go: at once when it closes, and after heartbeatTimeout
 * when it goes without a word.
 */

// Where a member's messages to every member go.
export const SOCKET_IO_CLUSTER_CHANNEL: string = "oneuptime:realtime:cluster";

export type ClusterBusHandler = (channel: string, message: string) => void;

// How a member talks to the others: Valkey, or a bus of the tests' own.
export interface SocketIOClusterBus {
  publish(channel: string, message: string): Promise<void>;
  /*
   * Hears every message on `channels`; resolves once it does. Throws when
   * it cannot listen.
   */
  subscribe(channels: Array<string>, onMessage: ClusterBusHandler): Promise<void>;
  // Stops `onMessage` hearing `channels`.
  unsubscribe(
    channels: Array<string>,
    onMessage: ClusterBusHandler,
  ): Promise<void>;
  // Whether the subscription is working now.
  isListening(): boolean;
  // Called each time the subscription works again after it stopped.
  onListeningAgain(listener: () => void): void;
}

/*
 * The members' heartbeats: a member that has published nothing for
 * HEARTBEAT_INTERVAL_MS says it is there, and one not heard of for
 * HEARTBEAT_TIMEOUT_MS is let go - and no longer waited for.
 */
export const HEARTBEAT_INTERVAL_MS: number = 2_000;
export const HEARTBEAT_TIMEOUT_MS: number = 6_000;

export interface SocketIOClusterOptions extends ClusterAdapterOptions {
  bus: SocketIOClusterBus;
  channel?: string | undefined;
}

export class SocketIOClusterAdapter extends ClusterAdapterWithHeartbeat {
  private readonly bus: SocketIOClusterBus;
  private readonly channel: string;
  private readonly responseChannel: string;
  private subscribed: Promise<void> | null = null;
  private isClosed: boolean = false;
  private readonly handler: ClusterBusHandler = (
    channel: string,
    message: string,
  ): void => {
    this.receive(channel, message);
  };

  public constructor(nsp: unknown, options: SocketIOClusterOptions) {
    super(nsp, {
      heartbeatInterval: options.heartbeatInterval ?? HEARTBEAT_INTERVAL_MS,
      heartbeatTimeout: options.heartbeatTimeout ?? HEARTBEAT_TIMEOUT_MS,
    });

    this.bus = options.bus;
    this.channel = options.channel || SOCKET_IO_CLUSTER_CHANNEL;
    this.responseChannel = SocketIOClusterAdapter.responseChannelOf(
      this.channel,
      this.uid,
    );

    /*
     * Listening again after Valkey came back: the others have let this
     * member go meanwhile, so it says it is there again.
     */
    this.bus.onListeningAgain((): void => {
      if (!this.isClosed) {
        super.init();
      }
    });

    /*
     * socket.io (4.8) makes the adapter and never calls its init(): the
     * member joins the cluster itself. init() does it once, should a later
     * socket.io call it too.
     */
    void this.init();
  }

  // This member's id in the cluster.
  public getUid(): ServerId {
    return this.uid;
  }

  /*
   * Whether this member can talk to the others now: a member that cannot
   * hear them, or is closed, asks them nothing - its question would wait
   * for answers it cannot hear.
   */
  public canReachOthers(): boolean {
    return this.isMember();
  }

  /*
   * Joins the cluster once it hears it: the first heartbeat asks every
   * member to answer with theirs, and an answer can only be heard once
   * this member listens.
   */
  public override init(): Promise<void> {
    if (!this.subscribed) {
      this.subscribed = this.bus
        .subscribe([this.channel, this.responseChannel], this.handler)
        .then((): void => {
          if (!this.isClosed) {
            super.init();
          }
        })
        .catch((err: unknown): void => {
          /*
           * Not listening: this member publishes nothing (doPublish), so no
           * member waits for it, and its sockets hear what is written here.
           * It joins once the bus works again (onListeningAgain).
           */
          logger.warn(
            "Realtime: could not join the other servers' live connections yet; until it does, only this server's pages hear what is written here.",
          );
          logger.debug(err);
        });
    }

    return this.subscribed;
  }

  public override close(): void {
    if (this.isClosed) {
      return;
    }

    // The others let this member go at once, rather than wait for it.
    super.close();
    this.isClosed = true;

    this.bus
      .unsubscribe([this.channel, this.responseChannel], this.handler)
      .catch((err: unknown): void => {
        logger.debug(err);
      });
  }

  protected override async doPublish(message: ClusterMessage): Promise<Offset> {
    if (!this.isMember()) {
      return "";
    }

    await this.bus.publish(this.channel, JSON.stringify(message));

    return "";
  }

  protected override async doPublishResponse(
    requesterUid: ServerId,
    response: ClusterResponse,
  ): Promise<void> {
    if (!this.isMember()) {
      return;
    }

    await this.bus.publish(
      SocketIOClusterAdapter.responseChannelOf(this.channel, requesterUid),
      JSON.stringify(response),
    );
  }

  // Whether this member may speak: listening, and not closed.
  private isMember(): boolean {
    return !this.isClosed && this.bus.isListening();
  }

  private receive(channel: string, raw: string): void {
    if (this.isClosed) {
      return;
    }

    let message: unknown;

    try {
      message = JSON.parse(raw);
    } catch {
      logger.debug("Realtime: a cluster message that is not JSON is ignored.");
      return;
    }

    if (!message || typeof message !== "object") {
      return;
    }

    try {
      if (channel === this.responseChannel) {
        this.onResponse(message as ClusterResponse);
        return;
      }

      this.onMessage(message as ClusterMessage);
    } catch (err) {
      logger.error("Realtime: a cluster message could not be handled.");
      logger.error(err);
    }
  }

  private static responseChannelOf(channel: string, uid: ServerId): string {
    return `${channel}#${uid}`;
  }
}

/*
 * The adapter socket.io makes for each namespace, as its `adapter` option
 * takes it: a constructor of one argument, the namespace.
 */
export type SocketIOAdapterConstructor = new (
  nsp: unknown,
) => SocketIOClusterAdapter;

export function createSocketIOClusterAdapter(
  options: SocketIOClusterOptions,
): SocketIOAdapterConstructor {
  return class extends SocketIOClusterAdapter {
    public constructor(nsp: unknown) {
      super(nsp, options);
    }
  };
}

/*
 * The members' bus on Valkey: published with the app's connection, heard
 * on a connection of its own (one in subscriber mode can do nothing else),
 * which the client subscribes again by itself after a reconnect.
 */
export class ValkeySocketIOClusterBus implements SocketIOClusterBus {
  private subscriber: ClientType | null = null;
  private handlers: Map<string, Set<ClusterBusHandler>> = new Map<
    string,
    Set<ClusterBusHandler>
  >();
  private listening: boolean = false;
  private hasListened: boolean = false;
  private listeningAgainListeners: Array<() => void> = [];

  public async publish(channel: string, message: string): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client) {
      return;
    }

    await client.publish(channel, message);
  }

  public async subscribe(
    channels: Array<string>,
    onMessage: ClusterBusHandler,
  ): Promise<void> {
    const subscriber: ClientType = this.getSubscriber();

    for (const channel of channels) {
      const handlers: Set<ClusterBusHandler> =
        this.handlers.get(channel) || new Set<ClusterBusHandler>();
      handlers.add(onMessage);
      this.handlers.set(channel, handlers);
    }

    await subscriber.subscribe(...channels);

    this.listening = true;
    this.hasListened = true;
  }

  public async unsubscribe(
    channels: Array<string>,
    onMessage: ClusterBusHandler,
  ): Promise<void> {
    const unheard: Array<string> = [];

    for (const channel of channels) {
      const handlers: Set<ClusterBusHandler> | undefined =
        this.handlers.get(channel);

      handlers?.delete(onMessage);

      if (!handlers || handlers.size === 0) {
        this.handlers.delete(channel);
        unheard.push(channel);
      }
    }

    if (this.subscriber && unheard.length > 0) {
      await this.subscriber.unsubscribe(...unheard);
    }
  }

  public isListening(): boolean {
    return this.listening;
  }

  public onListeningAgain(listener: () => void): void {
    this.listeningAgainListeners.push(listener);
  }

  private getSubscriber(): ClientType {
    if (this.subscriber) {
      return this.subscriber;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client) {
      throw new Error("Valkey is not connected.");
    }

    const subscriber: ClientType = client.duplicate();

    subscriber.on("error", (err: Error): void => {
      logger.debug(err);
    });

    subscriber.on("message", (channel: string, message: string): void => {
      for (const handler of Array.from(this.handlers.get(channel) || [])) {
        handler(channel, message);
      }
    });

    // Gone: nothing is published until it is back.
    subscriber.on("close", (): void => {
      this.listening = false;
    });

    // Back, and subscribed again by the client (autoResubscribe).
    subscriber.on("ready", (): void => {
      if (!this.hasListened || this.listening) {
        return;
      }

      this.listening = true;

      for (const listener of this.listeningAgainListeners) {
        try {
          listener();
        } catch (err) {
          logger.debug(err);
        }
      }
    });

    this.subscriber = subscriber;

    return subscriber;
  }
}
