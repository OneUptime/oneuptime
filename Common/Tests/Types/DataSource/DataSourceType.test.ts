import DataSourceType, {
  DataSourceTypeCategories,
  DataSourceTypeCategory,
  DataSourceTypeProps,
  DataSourceTypeUtil,
} from "../../../Types/DataSource/DataSourceType";

describe("DataSourceTypeUtil", () => {
  describe("getAllDataSourceTypes", () => {
    test("returns every declared DataSourceType exactly once", () => {
      const all: Array<DataSourceType> =
        DataSourceTypeUtil.getAllDataSourceTypes();

      // Must match the enum members one-for-one — no missing, no duplicates.
      const enumMembers: Array<DataSourceType> = Object.values(DataSourceType);
      expect([...all].sort()).toEqual([...enumMembers].sort());
      expect(new Set(all).size).toBe(all.length);
    });

    test("returns a fresh array each call (callers may mutate it)", () => {
      const first: Array<DataSourceType> =
        DataSourceTypeUtil.getAllDataSourceTypes();
      const second: Array<DataSourceType> =
        DataSourceTypeUtil.getAllDataSourceTypes();
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });

  describe("isHttpBasedType / isDatabaseType partition", () => {
    test("every type is exactly one of HTTP-based or database", () => {
      for (const type of DataSourceTypeUtil.getAllDataSourceTypes()) {
        const http: boolean = DataSourceTypeUtil.isHttpBasedType(type);
        const db: boolean = DataSourceTypeUtil.isDatabaseType(type);
        // Exactly one of the two must be true — they partition the set.
        expect(http).not.toEqual(db);
      }
    });

    test("HTTP-based types are the metrics/logs/search/api connectors", () => {
      expect(
        DataSourceTypeUtil.isHttpBasedType(DataSourceType.Prometheus),
      ).toBe(true);
      expect(DataSourceTypeUtil.isHttpBasedType(DataSourceType.Loki)).toBe(
        true,
      );
      expect(
        DataSourceTypeUtil.isHttpBasedType(DataSourceType.Elasticsearch),
      ).toBe(true);
      expect(DataSourceTypeUtil.isHttpBasedType(DataSourceType.RestApi)).toBe(
        true,
      );
      expect(
        DataSourceTypeUtil.isHttpBasedType(DataSourceType.PostgreSQL),
      ).toBe(false);
    });

    test("database types are the SQL-driver connectors", () => {
      expect(DataSourceTypeUtil.isDatabaseType(DataSourceType.PostgreSQL)).toBe(
        true,
      );
      expect(DataSourceTypeUtil.isDatabaseType(DataSourceType.MySQL)).toBe(
        true,
      );
      expect(
        DataSourceTypeUtil.isDatabaseType(DataSourceType.MicrosoftSqlServer),
      ).toBe(true);
      expect(DataSourceTypeUtil.isDatabaseType(DataSourceType.ClickHouse)).toBe(
        true,
      );
      expect(DataSourceTypeUtil.isDatabaseType(DataSourceType.Prometheus)).toBe(
        false,
      );
    });
  });

  describe("getDefaultPort", () => {
    test("database types seed the well-known driver port", () => {
      expect(DataSourceTypeUtil.getDefaultPort(DataSourceType.PostgreSQL)).toBe(
        5432,
      );
      expect(DataSourceTypeUtil.getDefaultPort(DataSourceType.MySQL)).toBe(
        3306,
      );
      expect(
        DataSourceTypeUtil.getDefaultPort(DataSourceType.MicrosoftSqlServer),
      ).toBe(1433);
      // ClickHouse is queried over its HTTP interface, not the native 9000.
      expect(DataSourceTypeUtil.getDefaultPort(DataSourceType.ClickHouse)).toBe(
        8123,
      );
    });

    test("HTTP-based types have no default port (they carry a full URL)", () => {
      expect(
        DataSourceTypeUtil.getDefaultPort(DataSourceType.Prometheus),
      ).toBeNull();
      expect(DataSourceTypeUtil.getDefaultPort(DataSourceType.Loki)).toBeNull();
      expect(
        DataSourceTypeUtil.getDefaultPort(DataSourceType.Elasticsearch),
      ).toBeNull();
      expect(
        DataSourceTypeUtil.getDefaultPort(DataSourceType.RestApi),
      ).toBeNull();
    });

    test("a default port is defined for exactly the database types", () => {
      for (const type of DataSourceTypeUtil.getAllDataSourceTypes()) {
        const hasPort: boolean =
          DataSourceTypeUtil.getDefaultPort(type) !== null;
        expect(hasPort).toBe(DataSourceTypeUtil.isDatabaseType(type));
      }
    });
  });

  describe("getProps", () => {
    test("every type gets self-consistent, non-empty display props", () => {
      for (const type of DataSourceTypeUtil.getAllDataSourceTypes()) {
        const props: DataSourceTypeProps = DataSourceTypeUtil.getProps(type);

        // The props describe the very type they were requested for.
        expect(props.dataSourceType).toBe(type);
        expect(props.title.length).toBeGreaterThan(0);
        expect(props.description.length).toBeGreaterThan(0);
        expect(props.queryLanguageTitle.length).toBeGreaterThan(0);
        expect(props.queryPlaceholder.length).toBeGreaterThan(0);
        // The category must be one the picker knows how to render.
        expect(DataSourceTypeCategories).toContain(props.category);
      }
    });

    test("getCategory agrees with getProps().category", () => {
      for (const type of DataSourceTypeUtil.getAllDataSourceTypes()) {
        expect(DataSourceTypeUtil.getCategory(type)).toBe(
          DataSourceTypeUtil.getProps(type).category,
        );
      }
    });

    test("all four database types are categorised as Databases", () => {
      for (const type of DataSourceTypeUtil.getAllDataSourceTypes()) {
        if (DataSourceTypeUtil.isDatabaseType(type)) {
          expect(DataSourceTypeUtil.getCategory(type)).toBe(
            DataSourceTypeCategory.Databases,
          );
        }
      }
    });

    test("the connector categories land in their expected sections", () => {
      expect(DataSourceTypeUtil.getCategory(DataSourceType.Prometheus)).toBe(
        DataSourceTypeCategory.Metrics,
      );
      expect(DataSourceTypeUtil.getCategory(DataSourceType.Loki)).toBe(
        DataSourceTypeCategory.Logs,
      );
      expect(DataSourceTypeUtil.getCategory(DataSourceType.Elasticsearch)).toBe(
        DataSourceTypeCategory.Search,
      );
      expect(DataSourceTypeUtil.getCategory(DataSourceType.RestApi)).toBe(
        DataSourceTypeCategory.Api,
      );
    });
  });

  describe("DataSourceTypeCategories ordering", () => {
    test("lists every category once, in the picker's display order", () => {
      expect(DataSourceTypeCategories).toEqual([
        DataSourceTypeCategory.Metrics,
        DataSourceTypeCategory.Logs,
        DataSourceTypeCategory.Databases,
        DataSourceTypeCategory.Search,
        DataSourceTypeCategory.Api,
      ]);
      // No category is missing and none is listed twice.
      expect(new Set(DataSourceTypeCategories).size).toBe(
        Object.values(DataSourceTypeCategory).length,
      );
    });
  });
});
