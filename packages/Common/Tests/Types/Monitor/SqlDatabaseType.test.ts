import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "../../../Types/Monitor/SqlDatabaseType";

describe("SqlDatabaseTypeUtil", () => {
  describe("getSupportedDatabaseTypes", () => {
    test("supports PostgreSQL, MySQL, and Microsoft SQL Server", () => {
      const supported: Array<SqlDatabaseType> =
        SqlDatabaseTypeUtil.getSupportedDatabaseTypes();

      expect(supported).toContain(SqlDatabaseType.PostgreSQL);
      expect(supported).toContain(SqlDatabaseType.MySQL);
      expect(supported).toContain(SqlDatabaseType.MicrosoftSqlServer);
      expect(supported).toHaveLength(3);
    });
  });

  describe("isSupported", () => {
    test("returns true for every enum member (all engines ship an executor)", () => {
      expect(SqlDatabaseTypeUtil.isSupported(SqlDatabaseType.PostgreSQL)).toBe(
        true,
      );
      expect(SqlDatabaseTypeUtil.isSupported(SqlDatabaseType.MySQL)).toBe(true);
      expect(
        SqlDatabaseTypeUtil.isSupported(SqlDatabaseType.MicrosoftSqlServer),
      ).toBe(true);
    });

    test("returns false for an engine that is not in the enum", () => {
      expect(
        SqlDatabaseTypeUtil.isSupported("OracleDatabase" as SqlDatabaseType),
      ).toBe(false);
    });
  });

  describe("getDefaultPort", () => {
    test("returns the well-known default port per engine", () => {
      expect(
        SqlDatabaseTypeUtil.getDefaultPort(SqlDatabaseType.PostgreSQL),
      ).toBe(5432);
      expect(SqlDatabaseTypeUtil.getDefaultPort(SqlDatabaseType.MySQL)).toBe(
        3306,
      );
      expect(
        SqlDatabaseTypeUtil.getDefaultPort(SqlDatabaseType.MicrosoftSqlServer),
      ).toBe(1433);
    });

    test("falls back to the PostgreSQL port for an unknown engine", () => {
      expect(
        SqlDatabaseTypeUtil.getDefaultPort("OracleDatabase" as SqlDatabaseType),
      ).toBe(5432);
    });
  });
});
