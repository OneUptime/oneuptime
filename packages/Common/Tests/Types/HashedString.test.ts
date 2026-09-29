import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";

describe("class HashedString", () => {
  test("HashedString.constructor() should return valid hashedString", async () => {
    const hashedString: HashedString = new HashedString("stringToHash");
    expect(hashedString).toBeInstanceOf(HashedString);
    expect(hashedString.isValueHashed()).toBe(false);
    expect(await hashedString.hashValue(ObjectID.generate())).toBeTruthy();
  });

  test("should hash value with provided salt", async () => {
    const hashedString: HashedString = new HashedString("testPassword");
    expect(hashedString).toBeInstanceOf(HashedString);
    expect(hashedString.isValueHashed()).toBe(false);

    const salt: ObjectID = ObjectID.generate();
    const hashedValue: string = await hashedString.hashValue(salt);

    expect(hashedValue).toBeTruthy();
    expect(typeof hashedValue).toBe("string");
    expect(hashedValue.length).toBeGreaterThan(0);
  });

  test("should return different hashes for same value with different salts", async () => {
    const password: string = "samePassword";
    const hashedString1: HashedString = new HashedString(password);
    const hashedString2: HashedString = new HashedString(password);

    const salt1: ObjectID = ObjectID.generate();
    const salt2: ObjectID = ObjectID.generate();

    const hash1: string = await hashedString1.hashValue(salt1);
    const hash2: string = await hashedString2.hashValue(salt2);

    expect(hash1).toBeTruthy();
    expect(hash2).toBeTruthy();
    expect(hash1).not.toBe(hash2);
  });

  test("should return same hash for same value with same salt", async () => {
    const password: string = "consistentPassword";
    const salt: ObjectID = new ObjectID("123456789012345678901234");

    const hashedString1: HashedString = new HashedString(password);
    const hashedString2: HashedString = new HashedString(password);

    const hash1: string = await hashedString1.hashValue(salt);
    const hash2: string = await hashedString2.hashValue(salt);

    expect(hash1).toBe(hash2);
  });

  test("should handle empty string by returning empty hash", async () => {
    const hashedString: HashedString = new HashedString("");
    expect(hashedString).toBeInstanceOf(HashedString);

    const salt: ObjectID = ObjectID.generate();
    const hashedValue: string = await hashedString.hashValue(salt);

    // Empty string input returns empty hash
    expect(typeof hashedValue).toBe("string");
    expect(hashedValue).toBe("");
  });
});
