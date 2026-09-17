import BadDataException from "../../Types/Exception/BadDataException";
import Port from "../../Types/Port";
import PositiveNumber from "../../Types/PositiveNumber";

describe("Testing class port", () => {
  test("should return a posetive number", () => {
    const value: Port = new Port(3000);
    expect(value.port.positiveNumber).toBeGreaterThanOrEqual(0);
    expect(new Port("6000").port.positiveNumber).toEqual(6000);
  });

  test('should throw exception "Port is not in valid format."', () => {
    expect(() => {
      new Port(67000);
    }).toThrow("Port is not in valid format.");
  });

  test("Port.port should be mutatable", () => {
    const value: Port = new Port(5000);
    value.port = new PositiveNumber(7000);
    expect(value.port.positiveNumber).toEqual(7000);
    expect(value.port.toNumber()).toEqual(7000);
  });

  test("try to mutating Port.port with invalid value should throw an BadDataException", () => {
    const value: Port = new Port(3000);
    expect(() => {
      value.port = new PositiveNumber("hj567");
    }).toThrowError(BadDataException);
    expect(() => {
      value.port = new PositiveNumber(-6000);
    }).toThrow(BadDataException);
  });

  test("If the supplied port is string type, is should convert it to number before creating port", () => {
    const value: Port = new Port("6000");
    expect(typeof value.port.positiveNumber).toBe("number");
  });

  /*
   * A port column is declared `TableColumnType.Number`, so whatever reaches
   * the transformer may be a Port, a string, or a plain number depending on
   * how far the request body got through deserialization. A raw number used
   * to fall off the end of `toDatabase` and return null, which wrote NULL
   * over an SMTP port the user had just typed — silently, since null is a
   * legal value for the column.
   */
  describe("getDatabaseTransformer().to", () => {
    const transformer: ReturnType<typeof Port.getDatabaseTransformer> =
      Port.getDatabaseTransformer();

    test("stores a Port instance as its number", () => {
      expect(transformer.to(new Port(587))).toBe(587);
    });

    test("stores a raw string port as a number", () => {
      expect(transformer.to("587")).toBe(587);
    });

    test("stores a raw number port rather than dropping it", () => {
      expect(transformer.to(587)).toBe(587);
      expect(transformer.to(0)).toBe(0);
      expect(transformer.to(65535)).toBe(65535);
    });

    test("keeps undefined distinct from null so a column DEFAULT applies", () => {
      expect(transformer.to(undefined)).toBeUndefined();
      expect(transformer.to(null)).toBeNull();
    });

    test("rejects a port outside the valid range instead of storing null", () => {
      expect(() => {
        return transformer.to(70000);
      }).toThrow(BadDataException);
    });
  });
});
