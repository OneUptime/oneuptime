import DataSourceService from "../../../Server/Services/DataSourceService";
import DataSource from "../../../Models/DatabaseModels/DataSource";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import { DataSourceConnectionSettings } from "../../../Server/Utils/DataSource/Types";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import FindOneByID from "../../../Server/Types/Database/FindOneByID";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { afterEach, describe, expect, test } from "@jest/globals";

describe("DataSourceService.getConnectionSettingsById", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns null for a non-uuid id without querying the database", async () => {
    const spy: jest.SpiedFunction<typeof DataSourceService.findOneById> = jest
      .spyOn(DataSourceService, "findOneById")
      .mockResolvedValue(null);

    const settings: DataSourceConnectionSettings | null =
      await DataSourceService.getConnectionSettingsById(
        new ObjectID("not-a-uuid"),
      );

    expect(settings).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  test("selects the secret columns with root props (the decrypt path)", async () => {
    const spy: jest.SpiedFunction<typeof DataSourceService.findOneById> = jest
      .spyOn(DataSourceService, "findOneById")
      .mockResolvedValue(null);

    await DataSourceService.getConnectionSettingsById(ObjectID.generate());

    expect(spy).toHaveBeenCalledTimes(1);
    const callArguments: FindOneByID<DataSource> = spy.mock
      .calls[0]![0] as FindOneByID<DataSource>;

    expect(callArguments.props.isRoot).toBe(true);
    expect(callArguments.select!["password"]).toBe(true);
    expect(callArguments.select!["apiToken"]).toBe(true);
    expect(callArguments.select!["customHeaders"]).toBe(true);
    expect(callArguments.select!["dataSourceType"]).toBe(true);
  });

  test("maps the record into connection settings with parsed headers", async () => {
    const record: DataSource = {
      dataSourceType: DataSourceType.Prometheus,
      url: "https://prometheus.example.com",
      username: "reader",
      password: "secret-password",
      apiToken: "secret-token",
      customHeaders: { "X-Scope-OrgID": "tenant-1", "X-Num": 42 },
      additionalOptions: { sslEnabled: true },
    } as unknown as DataSource;

    jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(record);

    const settings: DataSourceConnectionSettings | null =
      await DataSourceService.getConnectionSettingsById(ObjectID.generate());

    expect(settings).not.toBeNull();
    expect(settings!.dataSourceType).toBe(DataSourceType.Prometheus);
    expect(settings!.url).toBe("https://prometheus.example.com");
    expect(settings!.password).toBe("secret-password");
    expect(settings!.apiToken).toBe("secret-token");
    expect(settings!.customHeaders).toEqual({
      "X-Scope-OrgID": "tenant-1",
      "X-Num": "42",
    });
    expect(settings!.additionalOptions).toEqual({ sslEnabled: true });
  });

  test("returns null when the record has no data source type", async () => {
    jest
      .spyOn(DataSourceService, "findOneById")
      .mockResolvedValue({} as unknown as DataSource);

    const settings: DataSourceConnectionSettings | null =
      await DataSourceService.getConnectionSettingsById(ObjectID.generate());

    expect(settings).toBeNull();
  });
});

describe("DataSourceService shape validation", () => {
  type ValidateShapeFunction = (data: {
    dataSourceType?: DataSourceType | undefined;
    url?: string | undefined;
    databaseHost?: string | undefined;
  }) => void;

  const validate: ValidateShapeFunction = (data: {
    dataSourceType?: DataSourceType | undefined;
    url?: string | undefined;
    databaseHost?: string | undefined;
  }): void => {
    /*
     * Private method — bracket access is the repo's convention for
     * pinning private behavior (see DatabaseServiceSanitizeUpdateData).
     */
    (DataSourceService as unknown as Record<string, ValidateShapeFunction>)[
      "validateDataSourceShape"
    ]!.call(DataSourceService, data);
  };

  test("accepts an http-based source with a url", () => {
    expect(() => {
      validate({
        dataSourceType: DataSourceType.Prometheus,
        url: "https://prometheus.example.com",
      });
    }).not.toThrow();
  });

  test("rejects an http-based source without a url", () => {
    expect(() => {
      validate({ dataSourceType: DataSourceType.Loki });
    }).toThrow(BadDataException);
  });

  test("accepts a database source with a host", () => {
    expect(() => {
      validate({
        dataSourceType: DataSourceType.PostgreSQL,
        databaseHost: "db.example.com",
      });
    }).not.toThrow();
  });

  test("rejects a database source without a host", () => {
    expect(() => {
      validate({ dataSourceType: DataSourceType.ClickHouse });
    }).toThrow(BadDataException);
  });

  test("rejects an unknown data source type", () => {
    expect(() => {
      validate({
        dataSourceType: "Not A Real Type" as DataSourceType,
        url: "https://example.com",
      });
    }).toThrow(BadDataException);
  });

  test("skips validation when the update touches none of the shape fields", () => {
    expect(() => {
      validate({});
    }).not.toThrow();
  });
});

describe("DataSourceService.onBeforeUpdate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type OnBeforeUpdateFunction = (
    updateBy: UpdateBy<DataSource>,
  ) => Promise<unknown>;

  const onBeforeUpdate: OnBeforeUpdateFunction = (
    updateBy: UpdateBy<DataSource>,
  ): Promise<unknown> => {
    /*
     * Protected method — bracket access is the repo's convention for
     * pinning non-public behavior (see the shape-validation suite above).
     */
    return (
      DataSourceService as unknown as Record<string, OnBeforeUpdateFunction>
    )["onBeforeUpdate"]!.call(DataSourceService, updateBy);
  };

  function makeUpdateBy(data: Record<string, unknown>): UpdateBy<DataSource> {
    return {
      query: { _id: ObjectID.generate().toString() },
      data: data,
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<DataSource>;
  }

  function mockStoredRow(
    row: Record<string, unknown>,
  ): jest.SpiedFunction<typeof DataSourceService.findOneBy> {
    return jest
      .spyOn(DataSourceService, "findOneBy")
      .mockResolvedValue(row as unknown as DataSource);
  }

  test("rejects clearing the url of a stored http source with null", async () => {
    /*
     * Presence check, not truthiness: { url: null } must still trigger
     * validation against the stored row — an HTTP source cannot lose
     * its URL.
     */
    mockStoredRow({
      dataSourceType: DataSourceType.Prometheus,
      url: "https://prometheus.example.com",
    });

    await expect(onBeforeUpdate(makeUpdateBy({ url: null }))).rejects.toThrow(
      BadDataException,
    );
  });

  test("rejects clearing the url with an empty string", async () => {
    mockStoredRow({
      dataSourceType: DataSourceType.Prometheus,
      url: "https://prometheus.example.com",
    });

    await expect(onBeforeUpdate(makeUpdateBy({ url: "" }))).rejects.toThrow(
      /require a URL/,
    );
  });

  test("does not read the stored row when no shape field is present", async () => {
    const spy: jest.SpiedFunction<typeof DataSourceService.findOneBy> =
      mockStoredRow({
        dataSourceType: DataSourceType.Prometheus,
        url: "https://prometheus.example.com",
      });

    await expect(
      onBeforeUpdate(makeUpdateBy({ description: "x" })),
    ).resolves.toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  test("rejects clearing the host of a stored database source with null", async () => {
    mockStoredRow({
      dataSourceType: DataSourceType.PostgreSQL,
      databaseHost: "db.example.com",
    });

    await expect(
      onBeforeUpdate(makeUpdateBy({ databaseHost: null })),
    ).rejects.toThrow(BadDataException);
  });
});
