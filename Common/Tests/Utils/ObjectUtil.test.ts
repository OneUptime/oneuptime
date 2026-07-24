import ObjectUtil from "../../Utils/ObjectUtil";
import { GlobalObject } from "../../Types/Object";

describe("ObjectUtil.isEmpty", () => {
  test("should return true for an object with no own keys", () => {
    expect(ObjectUtil.isEmpty({} as GlobalObject)).toBe(true);
  });

  test("should return false when the object has keys", () => {
    expect(ObjectUtil.isEmpty({ a: 1 } as unknown as GlobalObject)).toBe(false);
  });

  test("should return false when a key holds an undefined value", () => {
    // The key still exists, so the object is not empty.
    expect(
      ObjectUtil.isEmpty({ a: undefined } as unknown as GlobalObject),
    ).toBe(false);
  });

  test("should ignore inherited properties", () => {
    const parent: GlobalObject = { inherited: true } as unknown as GlobalObject;
    const child: GlobalObject = Object.create(parent) as GlobalObject;

    expect(ObjectUtil.isEmpty(child)).toBe(true);
  });

  test("should treat an empty array as empty", () => {
    expect(ObjectUtil.isEmpty([] as unknown as GlobalObject)).toBe(true);
  });
});
