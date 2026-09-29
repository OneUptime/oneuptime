import ConnectorRegistry from "../../../../Server/Utils/DataSource/ConnectorRegistry";
import { DataSourceConnector } from "../../../../Server/Utils/DataSource/Types";
import DataSourceType, {
  DataSourceTypeUtil,
} from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

describe("ConnectorRegistry", () => {
  test("registers a connector for EVERY data source type", () => {
    /*
     * A type added to the enum without a connector would surface as a
     * runtime error on first query — catch it at test time instead.
     */
    for (const dataSourceType of DataSourceTypeUtil.getAllDataSourceTypes()) {
      const connector: DataSourceConnector =
        ConnectorRegistry.getConnector(dataSourceType);
      expect(connector.dataSourceType).toBe(dataSourceType);
    }
  });

  test("every registered connector implements the full interface", () => {
    for (const dataSourceType of ConnectorRegistry.getRegisteredTypes()) {
      const connector: DataSourceConnector =
        ConnectorRegistry.getConnector(dataSourceType);
      expect(typeof connector.testConnection).toBe("function");
      expect(typeof connector.queryTimeSeries).toBe("function");
      expect(typeof connector.queryTable).toBe("function");
    }
  });

  test("throws a friendly error for an unregistered type", () => {
    expect(() => {
      ConnectorRegistry.getConnector("Not A Type" as DataSourceType);
    }).toThrow(BadDataException);
  });
});
