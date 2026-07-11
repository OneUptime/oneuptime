import net from "net";
import http from "http";
import { Duplex } from "stream";
import Aedes, {
  createBroker,
  AuthenticateError,
  Client,
  PublishPacket,
  Subscription,
} from "aedes";
import WebSocket, { WebSocketServer } from "ws";
import Express from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { JSONObject } from "Common/Types/JSON";
import MetricsQueueService from "./Services/Queue/MetricsQueueService";
import {
  MQTT_INGEST_ENABLED,
  MQTT_INGEST_PORT,
  MQTT_WEBSOCKET_PATH,
} from "./Config";
import MqttPacketSizeGuard from "./Utils/MqttPacketSizeGuard";
import {
  buildOtlpMetricsBody,
  parseMqttPublish,
  MqttPublishParseResult,
  MQTT_MAX_PAYLOAD_BYTES,
} from "./Utils/MqttTelemetryMapper";

/*
 * MQTT ingestion for IoT devices — an in-process broker started from
 * the Telemetry FeatureSet alongside the gRPC OTLP server (same
 * pattern: a non-HTTP listener that authenticates a telemetry
 * ingestion key and feeds the shared BullMQ ingest pipeline).
 *
 * Listeners:
 *   - raw TCP on MQTT_INGEST_PORT (default 1883) — for devices that
 *     can reach the app service directly (in-cluster, port-forward,
 *     or an operator-exposed LoadBalancer),
 *   - MQTT-over-WebSocket at MQTT_WEBSOCKET_PATH on the main HTTP
 *     server — rides the existing Nginx ingress on 80/443, so it
 *     works on every deployment with zero extra network surface.
 *
 * AUTH: CONNECT carries the project's Telemetry Ingestion Key as the
 * password (username is ignored; the key is accepted there as a
 * fallback for clients that only expose one field). The key resolves
 * to a projectId through the same cached lookup the HTTP OTLP path
 * uses — unlike the gRPC path we reject bad credentials explicitly
 * (CONNACK rc=4) so a misconfigured device fails loudly instead of
 * silently dropping data. On success the MQTT clientId is namespaced
 * by projectId: aedes keys its session/takeover map on clientId
 * globally, so without the prefix a client in one project could evict
 * (and fire the Last Will of) another project's device that happens
 * to use the same clientId.
 *
 * INGESTION happens in authorizePublish (which aedes also applies to
 * Last Will messages, with the deceased client attached) — a device
 * that sets its Will to oneuptime/<fleet>/<device>/status = "offline"
 * gets iot_device_up=0 published on its behalf the moment its session
 * dies, which is what the stock iot-device-offline alert template and
 * the inventory isUp column key off. Ingestion is at-least-once: a
 * QoS 1/2 retransmission is authorized (and therefore ingested)
 * again, so duplicate datapoints are possible when an ack is lost.
 *
 * SUBSCRIPTIONS are denied (granted qos 128): ingestion is one-way in
 * this iteration, and because fleet names are only unique per project
 * a cross-project subscriber must never see another tenant's topics.
 * Since nothing can ever subscribe, the retain flag is cleared on
 * every accepted publish — otherwise aedes' in-memory persistence
 * would pin every retained payload for the life of the process.
 */

// MQTT 3.1.1 CONNACK return code 4 — bad user name or password.
const CONNACK_BAD_USERNAME_OR_PASSWORD: number = 4;
// MQTT 3.1.1 CONNACK return code 3 — server unavailable.
const CONNACK_SERVER_UNAVAILABLE: number = 3;

/*
 * Hard cap on a single MQTT packet as declared by its remaining-length
 * header: payload cap plus headroom for the topic and packet header.
 * Enforced on the raw byte stream BEFORE the packet is buffered (see
 * MqttPacketSizeGuard) — mqtt-packet would otherwise accumulate up to
 * ~256 MB per connection before authorizePublish ever runs.
 */
const MQTT_MAX_PACKET_BYTES: number = MQTT_MAX_PAYLOAD_BYTES + 8 * 1024;

/*
 * projectId per authenticated client. WeakMap so state dies with the
 * client object — including the dead client aedes hands back when it
 * authorizes a Last Will publish.
 */
const clientProjectIds: WeakMap<Client, ObjectID> = new WeakMap();

function makeAuthenticateError(
  message: string,
  returnCode: number,
): AuthenticateError {
  return Object.assign(new Error(message), {
    returnCode,
  }) as AuthenticateError;
}

/*
 * Telemetry ingestion keys are UUIDs by construction. Rejecting
 * non-UUID credentials up front keeps garbage CONNECT floods off
 * Postgres entirely (the secretKey column is a uuid type, so a
 * non-UUID value would otherwise error the query itself).
 */
const UUID_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveProjectId(
  username: string | undefined,
  password: Buffer | undefined,
): Promise<ObjectID | null> {
  /*
   * The ingestion key rides the password field; some constrained MQTT
   * clients only expose a username, so accept it there as a fallback.
   */
  const secretKey: string =
    password?.toString("utf8").trim() || username?.trim() || "";

  if (!secretKey || !UUID_REGEX.test(secretKey)) {
    return null;
  }

  /*
   * Anything this throws is infrastructural (e.g. Postgres down) and
   * propagates to the authenticate catch, which answers CONNACK rc=3
   * (server unavailable) so well-behaved devices retry later instead
   * of concluding their credentials are wrong.
   */
  return TelemetryIngestionKeyService.getProjectIdFromSecretKey(secretKey);
}

async function handleAuthorizePublish(
  client: Client | null,
  packet: PublishPacket,
): Promise<void> {
  /*
   * Nothing can ever subscribe here, so retained state could never be
   * read — clear the flag on every accepted publish (including Wills)
   * so aedes' in-memory persistence does not pin each unique topic's
   * last payload for the life of the process.
   */
  packet.retain = false;

  /*
   * client is null only for broker-internal publishes (e.g. persisted
   * wills replayed for a dead broker id — not a path the in-memory
   * persistence produces). Nothing to ingest without a project.
   */
  if (!client) {
    return;
  }

  const projectId: ObjectID | undefined = clientProjectIds.get(client);

  if (!projectId) {
    throw new Error("MQTT: publish rejected — client is not authenticated.");
  }

  /*
   * A Will packet is the only publish that reaches this hook carrying
   * a clientId (stamped at CONNECT). aedes' periodic will sweep can
   * replay wills for clients that are STILL CONNECTED (e.g. after a
   * forward wall-clock jump makes the broker's own heartbeat look
   * stale) — ingesting those would mark every live device offline at
   * once. A genuine death always closes the client first, so a live
   * client's will replay is accepted (harmless — there are no
   * subscribers) but not ingested.
   */
  const willClientId: string | undefined = (
    packet as PublishPacket & { clientId?: string }
  ).clientId;
  if (willClientId && client.closed === false) {
    logger.warn(
      `MQTT: skipped will replay for still-connected client "${client.id}".`,
      { service: "telemetry" },
    );
    return;
  }

  const payload: Buffer = Buffer.isBuffer(packet.payload)
    ? packet.payload
    : Buffer.from(packet.payload || "", "utf8");

  const parsed: MqttPublishParseResult = parseMqttPublish({
    topic: packet.topic,
    payload,
    nowMs: Date.now(),
  });

  if (parsed.error !== undefined) {
    /*
     * MQTT 3.1.1 has no per-message NACK: erroring the callback would
     * destroy the connection, and at QoS 1 with a persistent session
     * the client is required to retransmit the same message on
     * reconnect ([MQTT-4.4.0-1]) — a poison-message livelock. Accept
     * and drop instead, with a log the operator can find.
     */
    logger.warn(
      `MQTT: dropped publish to "${packet.topic}" — ${parsed.error}`,
      { service: "telemetry" },
    );
    return;
  }

  if (TelemetryIngestionDisabled.isDisabled()) {
    // Same contract as the other ingest paths: accept and drop.
    return;
  }

  const body: JSONObject = buildOtlpMetricsBody(parsed.payload);

  /*
   * Same synthetic-request shape the gRPC OTLP producer builds: the
   * queue service serializes the parsed body via TelemetryBodyStore
   * and the worker decodes it exactly like an OTLP/JSON HTTP POST.
   */
  const req: Partial<TelemetryRequest> = {
    body: body,
    headers: {},
    projectId: projectId,
    productType: ProductType.Metrics,
    path: "/mqtt/v1/metrics",
    url: "/mqtt/v1/metrics",
  };

  await MetricsQueueService.addMetricIngestJob(req as TelemetryRequest);
}

function createMqttBroker(): Aedes {
  const broker: Aedes = createBroker();

  broker.authenticate = (
    client: Client,
    username: Readonly<string | undefined>,
    password: Readonly<Buffer | undefined>,
    done: (error: AuthenticateError | null, success: boolean | null) => void,
  ): void => {
    resolveProjectId(username as string | undefined, password as Buffer)
      .then((projectId: ObjectID | null) => {
        if (!projectId) {
          logger.warn(
            `MQTT: CONNECT rejected for client "${client.id}" — missing or invalid telemetry ingestion key.`,
            { service: "telemetry" },
          );
          done(
            makeAuthenticateError(
              "Invalid telemetry ingestion key.",
              CONNACK_BAD_USERNAME_OR_PASSWORD,
            ),
            false,
          );
          return;
        }

        clientProjectIds.set(client, projectId);

        /*
         * Namespace the clientId by project BEFORE aedes registers the
         * client: aedes keys its global session map on client.id and
         * disconnects an existing client with the same id (MQTT
         * takeover), so an un-namespaced id would let one tenant evict
         * another tenant's device — and fire its Last Will.
         */
        client.id = `${projectId.toString()}/${client.id}`;

        logger.debug(
          `MQTT: client "${client.id}" authenticated for project ${projectId.toString()}.`,
        );
        done(null, true);
      })
      .catch((err: unknown) => {
        logger.error("MQTT: error while authenticating client:", {
          service: "telemetry",
        });
        logger.error(err, { service: "telemetry" });
        done(
          makeAuthenticateError(
            "Authentication is temporarily unavailable.",
            CONNACK_SERVER_UNAVAILABLE,
          ),
          false,
        );
      });
  };

  broker.authorizePublish = (
    client: Client | null,
    packet: PublishPacket,
    callback: (error?: Error | null) => void,
  ): void => {
    handleAuthorizePublish(client, packet)
      .then(() => {
        callback(null);
      })
      .catch((err: Error) => {
        logger.warn(err.message || "MQTT: publish rejected.", {
          service: "telemetry",
        });
        callback(err);
      });
  };

  broker.authorizeSubscribe = (
    _client: Client,
    subscription: Subscription,
    callback: (error: Error | null, subscription?: Subscription | null) => void,
  ): void => {
    /*
     * Grant nothing (SUBACK rc 128). Ingestion is publish-only, and
     * fleet names are only unique per project — a subscription would
     * otherwise be able to observe another tenant's topic space.
     */
    logger.debug(
      `MQTT: denied subscription to "${subscription.topic}" — ingestion is publish-only.`,
    );
    callback(null, null);
  };

  broker.on("clientError", (client: Client, err: Error): void => {
    logger.debug(
      `MQTT: client "${client?.id}" error: ${err?.message || "unknown"}`,
    );
  });

  broker.on("connectionError", (client: Client, err: Error): void => {
    logger.debug(
      `MQTT: connection error for client "${client?.id}": ${err?.message || "unknown"}`,
    );
  });

  return broker;
}

/*
 * The transport half of a bridge: how bytes go back to the device and
 * how the underlying connection is paused/closed. One implementation
 * per listener (TCP socket, WebSocket).
 */
interface BridgeTransport {
  send: (chunk: Buffer, callback: (error?: Error | null) => void) => void;
  close: () => void;
  terminate: () => void;
  pause: () => void;
  resume: () => void;
}

interface Bridge {
  stream: Duplex;
  deliver: (chunk: Buffer) => void;
  endInput: () => void;
  failInput: (err: Error) => void;
}

/*
 * Bridge a connection to a Duplex stream aedes can treat like a TCP
 * socket, with three properties both listeners need:
 *
 *   - SIZE GUARD: the raw bytes run through MqttPacketSizeGuard so a
 *     packet declaring more than MQTT_MAX_PACKET_BYTES drops the
 *     connection before mqtt-packet buffers it (aedes has no
 *     max-packet-size option and the MQTT varint allows ~256 MB).
 *
 *   - COALESCED PUSHES: inbound bytes are combined into one push per
 *     macrotask. MQTT clients write packets field-by-field, so one
 *     packet arrives as a synchronous burst of tiny chunks — and a
 *     burst of push()es into an idle non-flowing stream is exactly
 *     the pattern aedes' 'readable' + read(null) loop misses on the
 *     Node 26 runtime (verified against Node 26.3; Node 22 handles
 *     it). A single push carrying the whole burst parses on both.
 *
 *   - BACKPRESSURE: when push() reports the readable buffer is full
 *     (aedes stalls consumption while an ingest enqueue awaits
 *     Redis), the transport is paused until aedes reads again —
 *     otherwise a fast publisher grows the buffer without bound.
 */
function createGuardedBridge(transport: BridgeTransport): Bridge {
  const guard: MqttPacketSizeGuard = new MqttPacketSizeGuard(
    MQTT_MAX_PACKET_BYTES,
  );

  const stream: Duplex = new Duplex({
    read(): void {
      transport.resume();
    },
    write(
      chunk: Buffer,
      _encoding: string,
      callback: (error?: Error | null) => void,
    ): void {
      transport.send(chunk, callback);
    },
    final(callback: (error?: Error | null) => void): void {
      transport.close();
      callback(null);
    },
    destroy(err: Error | null, callback: (error: Error | null) => void): void {
      transport.terminate();
      callback(err);
    },
  });

  let pendingChunks: Array<Buffer> = [];
  let flushScheduled: boolean = false;
  let ended: boolean = false;

  const flushPending: () => void = (): void => {
    flushScheduled = false;
    if (ended || pendingChunks.length === 0) {
      return;
    }
    const buffer: Buffer =
      pendingChunks.length === 1
        ? (pendingChunks[0] as Buffer)
        : Buffer.concat(pendingChunks as unknown as Array<Uint8Array>);
    pendingChunks = [];
    if (!stream.push(buffer)) {
      transport.pause();
    }
  };

  return {
    stream,
    deliver: (chunk: Buffer): void => {
      if (ended) {
        return;
      }
      if (!guard.feed(chunk)) {
        ended = true;
        logger.warn(
          `MQTT: dropped connection — packet exceeds the ${MQTT_MAX_PACKET_BYTES}-byte limit (or has a malformed length header).`,
          { service: "telemetry" },
        );
        stream.destroy(new Error("MQTT packet exceeds the size limit."));
        return;
      }
      pendingChunks.push(chunk);
      if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(flushPending);
      }
    },
    endInput: (): void => {
      /*
       * Deliver anything still buffered, then end the readable side
       * so aedes tears the client session down.
       */
      flushPending();
      ended = true;
      stream.push(null);
    },
    failInput: (err: Error): void => {
      ended = true;
      stream.destroy(err);
    },
  };
}

function startTcpListener(broker: Aedes): void {
  const server: net.Server = net.createServer((socket: net.Socket): void => {
    const bridge: Bridge = createGuardedBridge({
      send: (chunk: Buffer, callback: (error?: Error | null) => void): void => {
        socket.write(chunk as unknown as Uint8Array, (err?: Error): void => {
          callback(err || null);
        });
      },
      close: (): void => {
        socket.end();
      },
      terminate: (): void => {
        socket.destroy();
      },
      pause: (): void => {
        socket.pause();
      },
      resume: (): void => {
        socket.resume();
      },
    });

    bridge.stream.on("error", (err: Error): void => {
      logger.debug(`MQTT: TCP stream error: ${err?.message || "unknown"}`);
    });

    socket.on("data", bridge.deliver);
    socket.on("end", bridge.endInput);
    socket.on("error", (err: Error): void => {
      bridge.failInput(err);
    });

    broker.handle(bridge.stream);
  });

  server.on("error", (err: Error): void => {
    logger.error(
      `MQTT: failed to listen on TCP port ${MQTT_INGEST_PORT}: ${err?.message}`,
      { service: "telemetry" },
    );
  });

  server.listen(MQTT_INGEST_PORT, () => {
    logger.info(`MQTT ingest server started on TCP port: ${MQTT_INGEST_PORT}`, {
      service: "telemetry",
    });
  });
}

function startWebSocketListener(broker: Aedes): void {
  const httpServer: http.Server = Express.getHttpServer();

  if (!httpServer) {
    logger.warn(
      "MQTT: HTTP server is not initialized; MQTT-over-WebSocket listener not started.",
      { service: "telemetry" },
    );
    return;
  }

  /*
   * noServer + hand-rolled upgrade routing: attaching ws in server
   * mode with a `path` option makes it destroy upgrade requests for
   * every OTHER path — which would kill the socket.io /realtime
   * websockets sharing this HTTP server. With noServer we only ever
   * touch upgrades addressed to MQTT_WEBSOCKET_PATH and leave the
   * rest for socket.io's own listener.
   */
  const wss: WebSocketServer = new WebSocketServer({
    noServer: true,
    // MQTT ingest frames are tiny; never accept ws' 100 MiB default.
    maxPayload: MQTT_MAX_PACKET_BYTES,
    /*
     * MQTT-over-WebSocket clients offer the "mqtt" subprotocol and
     * most of them drop the connection when the server does not echo
     * it back. Prefer it; otherwise echo whatever was offered.
     */
    handleProtocols: (protocols: Set<string>): string | false => {
      if (protocols.has("mqtt")) {
        return "mqtt";
      }
      return protocols.values().next().value ?? false;
    },
  });

  httpServer.on(
    "upgrade",
    (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
      const url: string = req.url || "";
      const queryIndex: number = url.indexOf("?");
      const pathname: string =
        queryIndex === -1 ? url : url.slice(0, queryIndex);

      if (pathname !== MQTT_WEBSOCKET_PATH) {
        // Not ours — another listener (e.g. socket.io) handles it.
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
        wss.emit("connection", ws, req);
      });
    },
  );

  wss.on("connection", (socket: WebSocket): void => {
    const bridge: Bridge = createGuardedBridge({
      send: (chunk: Buffer, callback: (error?: Error | null) => void): void => {
        socket.send(chunk, { binary: true }, (err?: Error): void => {
          callback(err || null);
        });
      },
      close: (): void => {
        socket.close();
      },
      terminate: (): void => {
        socket.terminate();
      },
      pause: (): void => {
        socket.pause();
      },
      resume: (): void => {
        if (socket.isPaused) {
          socket.resume();
        }
      },
    });

    bridge.stream.on("error", (err: Error): void => {
      logger.debug(
        `MQTT: WebSocket stream error: ${err?.message || "unknown"}`,
      );
    });

    socket.on("message", (data: WebSocket.RawData): void => {
      const chunk: Buffer = Array.isArray(data)
        ? Buffer.concat(data as unknown as Array<Uint8Array>)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      bridge.deliver(chunk);
    });

    socket.on("close", bridge.endInput);
    socket.on("error", (err: Error): void => {
      bridge.failInput(err);
    });

    broker.handle(bridge.stream);
  });

  wss.on("error", (err: Error): void => {
    logger.error("MQTT: WebSocket server error:", { service: "telemetry" });
    logger.error(err, { service: "telemetry" });
  });

  logger.info(
    `MQTT-over-WebSocket ingest listener attached at path: ${MQTT_WEBSOCKET_PATH}`,
    { service: "telemetry" },
  );
}

export function startMqttServer(): void {
  if (!MQTT_INGEST_ENABLED) {
    logger.info(
      "MQTT_INGEST_ENABLED=false — MQTT ingest listeners not started.",
      { service: "telemetry" },
    );
    return;
  }

  const broker: Aedes = createMqttBroker();

  startTcpListener(broker);
  startWebSocketListener(broker);
}
