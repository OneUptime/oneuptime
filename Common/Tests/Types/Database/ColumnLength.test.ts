import ColumnLength from "../../../Types/Database/ColumnLength";

describe("enum ColumnLength", () => {
  test("ColumnLength.Version", () => {
    expect(ColumnLength.Version).toEqual(30);
  });

  test("ColumnLength.Slug", () => {
    expect(ColumnLength.Slug).toEqual(100);
  });

  test("ColumnLength.Email", () => {
    expect(ColumnLength.Email).toEqual(100);
  });

  test("ColumnLength.Color", () => {
    expect(ColumnLength.Color).toEqual(10);
  });

  test("ColumnLength.Name", () => {
    expect(ColumnLength.Name).toEqual(50);
  });

  test("ColumnLength.Description", () => {
    expect(ColumnLength.Description).toEqual(500);
  });

  test("ColumnLength.LongText", () => {
    expect(ColumnLength.LongText).toEqual(500);
  });

  test("ColumnLength.Password", () => {
    expect(ColumnLength.Password).toEqual(500);
  });

  test("ColumnLength.ShortURL", () => {
    expect(ColumnLength.ShortURL).toEqual(100);
  });

  test("ColumnLength.ShortText", () => {
    expect(ColumnLength.ShortText).toEqual(100);
  });

  test("ColumnLength.HashedString", () => {
    /*
     * Not 64 (a bare SHA-256 digest) since user passwords became scrypt
     * hashes that carry their own cost parameters: `scrypt$N=...,r=...,p=...$
     * <64 hex>`, around 90 characters. Narrowing this back would truncate
     * every password on write and lock the whole instance out.
     */
    expect(ColumnLength.HashedString).toEqual(255);
  });

  test("ColumnLength.Phone", () => {
    expect(ColumnLength.Phone).toEqual(30);
  });

  test("ColumnLength.OTP", () => {
    expect(ColumnLength.OTP).toEqual(8);
  });
});
