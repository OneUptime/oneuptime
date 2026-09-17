import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DataSource";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import DataSourceType, {
  DataSourceTypeUtil,
} from "../../Types/DataSource/DataSourceType";
import { DataSourceConnectionSettings } from "../Utils/DataSource/Types";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Per-type shape validation so a broken data source fails at save time
   * with a clear message, not at first query with a connector error.
   */
  private validateDataSourceShape(data: {
    dataSourceType?: DataSourceType | undefined;
    url?: string | undefined;
    databaseHost?: string | undefined;
  }): void {
    const dataSourceType: DataSourceType | undefined = data.dataSourceType;

    if (!dataSourceType) {
      return; // updates that don't touch the type/host/url skip validation.
    }

    if (!DataSourceTypeUtil.getAllDataSourceTypes().includes(dataSourceType)) {
      throw new BadDataException(`Unknown data source type: ${dataSourceType}`);
    }

    if (DataSourceTypeUtil.isHttpBasedType(dataSourceType) && !data.url) {
      throw new BadDataException(
        `${dataSourceType} data sources require a URL.`,
      );
    }

    if (
      DataSourceTypeUtil.isDatabaseType(dataSourceType) &&
      !data.databaseHost
    ) {
      throw new BadDataException(
        `${dataSourceType} data sources require a database host.`,
      );
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.validateDataSourceShape({
      dataSourceType: createBy.data.dataSourceType,
      url: createBy.data.url,
      databaseHost: createBy.data.databaseHost,
    });

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Only validate when the update touches the fields that participate in
     * shape validation. Changing the TYPE of an existing source without
     * also sending url/host can produce a source that fails validation on
     * its own merits — so when dataSourceType changes, re-validate against
     * the stored row's values merged with the update.
     */
    const data: {
      dataSourceType?: DataSourceType | undefined;
      url?: string | undefined;
      databaseHost?: string | undefined;
    } = updateBy.data as unknown as {
      dataSourceType?: DataSourceType | undefined;
      url?: string | undefined;
      databaseHost?: string | undefined;
    };

    /*
     * Presence check, not truthiness — an update that CLEARS url or
     * databaseHost (null / empty string) must still be validated, or an
     * HTTP source could be stripped of its URL and break at query time.
     */
    const updateData: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;
    const touchesShape: boolean =
      "dataSourceType" in updateData ||
      "url" in updateData ||
      "databaseHost" in updateData;

    if (touchesShape) {
      const existing: Model | null = await this.findOneBy({
        query: updateBy.query,
        select: {
          _id: true,
          dataSourceType: true,
          url: true,
          databaseHost: true,
        },
        props: { isRoot: true },
      });

      /*
       * A field present in the update wins even when cleared (null/"" →
       * undefined, which validation treats as missing); an absent field
       * falls back to the stored row.
       */
      this.validateDataSourceShape({
        dataSourceType: data.dataSourceType || existing?.dataSourceType,
        url: "url" in updateData ? data.url || undefined : existing?.url,
        databaseHost:
          "databaseHost" in updateData
            ? data.databaseHost || undefined
            : existing?.databaseHost,
      });
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Decrypted connection settings for the server-side connector paths
   * (/test and /query). ROOT read — the caller MUST have already performed
   * a user-scoped access check on this id (the LlmProviderAPI two-phase
   * pattern). The returned object holds plaintext secrets: never serialize
   * it into a response or a log line.
   */
  @CaptureSpan()
  public async getConnectionSettingsById(
    dataSourceId: ObjectID,
  ): Promise<DataSourceConnectionSettings | null> {
    if (!ObjectID.isValidUUID(dataSourceId.toString())) {
      /*
       * A non-uuid string in a uuid column is a Postgres cast error, not
       * an empty result — shape-check before querying.
       */
      return null;
    }

    const dataSource: Model | null = await this.findOneById({
      id: dataSourceId,
      select: {
        _id: true,
        projectId: true,
        dataSourceType: true,
        url: true,
        databaseHost: true,
        databasePort: true,
        databaseName: true,
        username: true,
        password: true,
        apiToken: true,
        customHeaders: true,
        additionalOptions: true,
      },
      props: { isRoot: true },
    });

    if (!dataSource || !dataSource.dataSourceType) {
      return null;
    }

    let customHeaders: Dictionary<string> | undefined = undefined;
    if (dataSource.customHeaders) {
      customHeaders = {};
      const headers: JSONObject = dataSource.customHeaders;
      for (const key of Object.keys(headers)) {
        if (headers[key] !== null && headers[key] !== undefined) {
          customHeaders[key] = headers[key]!.toString();
        }
      }
    }

    return {
      dataSourceType: dataSource.dataSourceType,
      url: dataSource.url,
      databaseHost: dataSource.databaseHost,
      databasePort: dataSource.databasePort,
      databaseName: dataSource.databaseName,
      username: dataSource.username,
      password: dataSource.password,
      apiToken: dataSource.apiToken,
      customHeaders: customHeaders,
      additionalOptions: dataSource.additionalOptions,
    };
  }
}

export default new Service();
