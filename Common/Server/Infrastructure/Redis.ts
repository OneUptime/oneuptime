import {
  RedisDb,
  RedisHostname,
  RedisIPFamily,
  RedisPassword,
  RedisPort,
  RedisTlsCa,
  RedisTlsCert,
  RedisTlsKey,
  RedisTlsSentinelMode,
  RedisUsername,
  ShouldRedisTlsEnable,
} from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import Sleep from "../../Types/Sleep";
import { Redis as RedisClient, RedisOptions } from "ioredis";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import GracefulShutdown, { ShutdownPriority } from "../Utils/GracefulShutdown";

export type ClientType = RedisClient;
export type RedisOptionsType = RedisOptions;

export default abstract class Redis {
  private static client: RedisClient | null = null;

  @CaptureSpan()
  public static isConnected(): boolean {
    if (!this.client) {
      return false;
    }

    return this.client.status === "ready";
  }

  @CaptureSpan()
  public static getClient(): RedisClient | null {
    return this.client;
  }

  @CaptureSpan()
  public static getRedisOptions(): RedisOptions {
    const redisOptions: RedisOptions = {
      host: RedisHostname,
      port: RedisPort.toNumber(),
      username: RedisUsername,
      password: RedisPassword,
      db: RedisDb,
      enableTLSForSentinelMode: RedisTlsSentinelMode,
      family: RedisIPFamily,
      lazyConnect: true,
    };

    if (ShouldRedisTlsEnable) {
      redisOptions.tls = {
        ca: RedisTlsCa || undefined,
        cert: RedisTlsCert || undefined,
        key: RedisTlsKey || undefined,
      };
    }

    return redisOptions;
  }

  @CaptureSpan()
  public static async connect(): Promise<RedisClient> {
    let retry: number = 0;

    try {
      this.client = new RedisClient(this.getRedisOptions());

      // Listen to 'error' events to the Redis connection
      this.client.on("error", (error: Error) => {
        if ((error as any).code === "ECONNRESET") {
          logger.error("Connection to Redis Session Store timed out.");
        } else if ((error as any).code === "ECONNREFUSED") {
          logger.error("Connection to Redis Session Store refused!");
        } else {
          logger.error(error);
        }
      });

      // Listen to 'reconnecting' event to Redis
      this.client.on("reconnecting", () => {
        if (this.client?.status === "reconnecting") {
          logger.error("Reconnecting to Redis Session Store...");
        } else {
          logger.error("Error reconnecting to Redis Session Store.");
        }
      });

      // Listen to the 'connect' event to Redis
      this.client.on("connect", (err: Error) => {
        if (!err) {
          logger.debug("Connected to Redis Session Store!");
        }
      });

      type ConnectToDatabaseFunction = (client: RedisClient) => Promise<void>;

      const connectToDatabase: ConnectToDatabaseFunction = async (
        client: RedisClient,
      ): Promise<void> => {
        // A previous attempt (or ioredis' background reconnect) already succeeded.
        if (client.status === "ready") {
          return;
        }

        /*
         * The client is created with lazyConnect, so it starts in the "wait" state
         * and only opens when we call connect(). If the first attempt fails, ioredis
         * begins auto-reconnecting in the background (status "connecting" /
         * "reconnecting"), and calling connect() again in that state throws
         * "Redis is already connecting/connected" — which previously propagated out
         * of init() and crashlooped the process. So only issue connect() when the
         * client is idle; when a (re)connect is already in flight, skip the call and
         * wait for it to settle on the next iteration.
         */
        const isIdle: boolean =
          client.status === "wait" ||
          client.status === "end" ||
          client.status === "close";

        try {
          if (isIdle) {
            await client.connect();
            return;
          }
        } catch (err) {
          if (retry >= 3) {
            throw err;
          }
        }

        if (retry >= 3) {
          throw new Error(
            `Unable to connect to Redis at ${RedisHostname}:${RedisPort.toNumber()} (status: ${client.status})`,
          );
        }

        logger.debug("Cannot connect to Redis. Retrying again in 5 seconds");
        // sleep for 5 seconds.

        await Sleep.sleep(5000);

        retry++;
        return await connectToDatabase(client);
      };

      await connectToDatabase(this.client);

      logger.debug(
        `Redis connected on ${RedisHostname}:${RedisPort.toNumber()}`,
      );

      // Close the Redis connection on shutdown.
      GracefulShutdown.registerHandler(
        "Redis",
        ShutdownPriority.DataStores,
        () => {
          return this.disconnect();
        },
      );

      return this.client;
    } catch (err) {
      logger.error("Redis Connection Failed");
      logger.error(err);
      throw err;
    }
  }

  @CaptureSpan()
  public static disconnect(): Promise<void> {
    if (this.isConnected()) {
      this.client?.disconnect();
      this.client = null;
    }

    return Promise.resolve();
  }

  @CaptureSpan()
  public static async checkConnnectionStatus(): Promise<boolean> {
    // Ping redis to check if the connection is still alive
    try {
      const result: "PONG" | undefined = await this.client?.ping();

      if (result !== "PONG") {
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Redis Connection Lost");
      logger.error(err);
      return false;
    }
  }
}
