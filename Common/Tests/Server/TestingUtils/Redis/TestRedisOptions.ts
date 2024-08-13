import { RedisDb, RedisPassword, RedisTlsSentinelMode, RedisUsername } from "../../../../Server/EnvironmentConfig";
import { RedisOptionsType } from "../../../../Server/Infrastructure/Redis";

type GetTestDataSourceOptions = () => RedisOptionsType;

const getTestRedisConnectionOptions: GetTestDataSourceOptions =
  (): RedisOptionsType => {
    // we use process.env values directly here because it can change during test runs and we need to get the latest values.
    const redisOptions: RedisOptionsType = {
      host: "localhost",
      port: 6310,
      username: RedisUsername,
      password: RedisPassword,
      db: RedisDb,
      enableTLSForSentinelMode: RedisTlsSentinelMode,
      lazyConnect: true,
    };

    return redisOptions;
  };

export default getTestRedisConnectionOptions;
