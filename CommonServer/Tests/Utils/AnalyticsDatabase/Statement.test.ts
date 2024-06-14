import { SQL, Statement } from "../../../Utils/AnalyticsDatabase/Statement";
import "../../TestingUtils/Init";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";

describe("Statement", () => {
  describe("constructor", () => {
    test("Should default to empty", () => {
      const statement: Statement = new Statement();
      expect(statement.query).toBe("");
      expect(statement.query_params).toStrictEqual({});
    });
  });

  describe("SQL", () => {
    test("should produce ClickHouse query params", () => {
      const statement: Statement = SQL`SELECT * FROM table`;
      expect(statement.query).toBe("SELECT * FROM table");
      expect(statement.query_params).toStrictEqual({});
    });

    test("should use ClickHouse query param substitution", () => {
      const statement: Statement = SQL`
                SELECT
                    *
                FROM
                    ${"table"}
                WHERE TRUE
                    AND number_col = ${{
                      value: 123,
                      type: TableColumnType.Number,
                    }}
                    AND text_col = ${{
                      value: "<text>",
                      type: TableColumnType.Text,
                    }}
            `;
      expect(statement.query).toBe(
        "SELECT\n" +
          "    *\n" +
          "FROM\n" +
          "    {p0:Identifier}\n" +
          "WHERE TRUE\n" +
          "    AND number_col = {p1:Int32}\n" +
          "    AND text_col = {p2:String}",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "table",
        p1: 123,
        p2: "<text>",
      });
    });

    describe("append", () => {
      test("should append a Statement", () => {
        const statement: Statement = SQL`
                    SELECT
                        *
                    FROM
                        ${"table"}
                    WHERE TRUE
                        AND number_col = ${{
                          value: 123,
                          type: TableColumnType.Number,
                        }}
                        AND text_col = ${{
                          value: "<text>",
                          type: TableColumnType.Text,
                        }}
                    `.append(SQL`
                        AND boolean_col = ${{
                          value: false,
                          type: TableColumnType.Boolean,
                        }}
                        AND decimal_col = ${{
                          value: 234.5,
                          type: TableColumnType.Decimal,
                        }}
                `);

        expect(statement.query).toBe(
          "SELECT\n" +
            "    *\n" +
            "FROM\n" +
            "    {p0:Identifier}\n" +
            "WHERE TRUE\n" +
            "    AND number_col = {p1:Int32}\n" +
            "    AND text_col = {p2:String}\n" +
            "\n" +
            "    AND boolean_col = {p3:Bool}\n" +
            "    AND decimal_col = {p4:Double}",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "table",
          p1: 123,
          p2: "<text>",
          p3: false,
          p4: 234.5,
        });
      });
    });
  });
});
