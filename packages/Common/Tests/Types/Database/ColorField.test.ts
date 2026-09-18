import ColorField, {
  getColorFieldColumns,
  getFirstColorFieldColumn,
  isColorFieldColumn,
} from "../../../Types/Database/ColorField";
import "reflect-metadata";

class ModelWithColorFields {
  @ColorField()
  public primaryColor: string = "";

  public name: string = "";

  @ColorField()
  public secondaryColor: string = "";
}

class ModelWithoutColorFields {
  public name: string = "";

  public count: number = 0;
}

describe("ColorField", () => {
  describe("isColorFieldColumn", () => {
    test("returns true for a column decorated with @ColorField", () => {
      const model: ModelWithColorFields = new ModelWithColorFields();
      expect(isColorFieldColumn(model as any, "primaryColor")).toBe(true);
      expect(isColorFieldColumn(model as any, "secondaryColor")).toBe(true);
    });

    test("returns false for a column that is not decorated", () => {
      const model: ModelWithColorFields = new ModelWithColorFields();
      expect(isColorFieldColumn(model as any, "name")).toBe(false);
    });

    test("returns false for an unknown column", () => {
      const model: ModelWithColorFields = new ModelWithColorFields();
      expect(isColorFieldColumn(model as any, "doesNotExist")).toBe(false);
    });
  });

  describe("getColorFieldColumns", () => {
    test("returns every column decorated with @ColorField", () => {
      const model: ModelWithColorFields = new ModelWithColorFields();
      expect(getColorFieldColumns(model as any)).toEqual([
        "primaryColor",
        "secondaryColor",
      ]);
    });

    test("returns an empty array when no column is decorated", () => {
      const model: ModelWithoutColorFields = new ModelWithoutColorFields();
      expect(getColorFieldColumns(model as any)).toEqual([]);
    });
  });

  describe("getFirstColorFieldColumn", () => {
    test("returns the first column decorated with @ColorField", () => {
      const model: ModelWithColorFields = new ModelWithColorFields();
      expect(getFirstColorFieldColumn(model as any)).toEqual("primaryColor");
    });

    test("returns null when no column is decorated", () => {
      const model: ModelWithoutColorFields = new ModelWithoutColorFields();
      expect(getFirstColorFieldColumn(model as any)).toBeNull();
    });
  });
});
