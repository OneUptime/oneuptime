import GlobalConfigService from "./Services/GlobalConfigService";
import { AccountsRoute, DashboardRoute } from "../ServiceRoute";
import Hostname from "../Types/API/Hostname";
import Protocol from "../Types/API/Protocol";
import URL from "../Types/API/URL";
import Route from "../Types/API/Route";
import BadDataException from "../Types/Exception/BadDataException";
import { JSONValue } from "../Types/JSON";
import GlobalConfig from "../Models/DatabaseModels/GlobalConfig";
import CaptureSpan from "./Utils/Telemetry/CaptureSpan";
import ObjectID from "../Types/ObjectID";

export default class DatabaseConfig {
  @CaptureSpan()
  public static async getFromGlobalConfig(
    key: string,
    defaultValueIfNotFound?: JSONValue,
  ): Promise<JSONValue> {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          [key]: true,
        },
      });

    if (!globalConfig) {
      /*
       * The GlobalConfig row is seeded on first boot. Callers that pass a
       * default (e.g. the feature-flag gates below) must not 500 when a
       * request lands before seeding completes — a real race during fresh
       * deploys and E2E bring-up. Callers that omit a default still get the
       * strict behaviour.
       */
      if (defaultValueIfNotFound !== undefined) {
        return defaultValueIfNotFound;
      }

      throw new BadDataException("Global Config not found");
    }

    return globalConfig.getColumnValue(key);
  }

  @CaptureSpan()
  public static async getHomeUrl(): Promise<URL> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return new URL(httpProtocol, host);
  }

  @CaptureSpan()
  public static async getHost(): Promise<Hostname> {
    return Promise.resolve(new Hostname(process.env["HOST"] || "localhost"));
  }

  @CaptureSpan()
  public static async getHttpProtocol(): Promise<Protocol> {
    return Promise.resolve(
      process.env["HTTP_PROTOCOL"] === "https" ? Protocol.HTTPS : Protocol.HTTP,
    );
  }

  @CaptureSpan()
  public static async getAccountsUrl(): Promise<URL> {
    const host: Hostname = await DatabaseConfig.getHost();
    return new URL(
      await DatabaseConfig.getHttpProtocol(),
      host,
      new Route(AccountsRoute.toString()),
    );
  }

  @CaptureSpan()
  public static async getDashboardUrl(): Promise<URL> {
    const host: Hostname = await DatabaseConfig.getHost();
    return new URL(
      await DatabaseConfig.getHttpProtocol(),
      host,
      new Route(DashboardRoute.toString()),
    );
  }

  @CaptureSpan()
  public static async shouldDisableSignup(): Promise<boolean> {
    /*
     * Default to "not disabled" (signup enabled) when GlobalConfig is absent,
     * matching the model default. Otherwise a signup that races GlobalConfig
     * seeding would 500 instead of proceeding.
     */
    return (await DatabaseConfig.getFromGlobalConfig(
      "disableSignup",
      false,
    )) as boolean;
  }

  @CaptureSpan()
  public static async shouldDisableUserProjectCreation(): Promise<boolean> {
    /*
     * Default to "not disabled" (project creation allowed) when GlobalConfig
     * is absent, matching the model default.
     */
    return (await DatabaseConfig.getFromGlobalConfig(
      "disableUserProjectCreation",
      false,
    )) as boolean;
  }
}
