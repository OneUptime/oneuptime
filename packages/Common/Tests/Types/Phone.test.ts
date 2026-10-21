import BadDataException from "../../Types/Exception/BadDataException";
import Phone from "../../Types/Phone";

describe("Testing Class Phone", () => {
  test("Should create a phone if the phone is valid phone number", () => {
    expect(new Phone("+251912974103").toString()).toEqual("+251912974103");
    expect(new Phone("961-770-7727").phone).toEqual("961-770-7727");
    expect(new Phone("943-627-0355").phone).toEqual("943-627-0355");
    expect(new Phone("282.652.3201").phone).toEqual("282.652.3201");
  });

  test("Phone.phone should be mutatable", () => {
    const value: Phone = new Phone("+251912974103");
    value.phone = "+251925974121";
    expect(value.phone).toEqual("+251925974121");
    expect(value.toString()).toEqual("+251925974121");
  });

  test("Creating phone number with invalid format should throw BadDataException", () => {
    expect(() => {
      new Phone("25192599879079074121");
    }).toThrowError(BadDataException);
  });

  test("try to mutating Phone.phone with invalid value should throw a BadDataException", () => {
    const valid: string = "+251912974103";
    const invalid: string = "278@$90> ";
    const value: Phone = new Phone(valid);
    expect(() => {
      value.phone = invalid;
    }).toThrowError(BadDataException);
    expect(() => {
      value.phone = "278@$90> ";
    }).toThrow("Phone is not in valid format: 278@$90>");
    expect(value.phone).toBe(valid);
    expect(() => {
      value.phone = "hgjuit879";
    }).toThrowError(BadDataException);
  });
});

/*
 * Phone.isSameNumber is what decides that a number a person verified for SMS
 * is the number they are adding for calls (UserCallService
 * .isNumberVerifiedForSms). A number is stored as it was typed, so the same
 * line can be two different strings; a false "same" would make a number live
 * that nobody proved, so anything doubtful is "not the same".
 */
describe("Phone.isSameNumber", () => {
  test("the same number typed the same way is the same", () => {
    expect(Phone.isSameNumber("+15551230100", "+15551230100")).toBe(true);
    expect(
      Phone.isSameNumber(new Phone("+15551230100"), new Phone("+15551230100")),
    ).toBe(true);
  });

  test("spaces, dashes, dots and brackets do not make a different number", () => {
    expect(Phone.isSameNumber("+1 (555) 123-0100", "+15551230100")).toBe(true);
    expect(Phone.isSameNumber("+1.555.123.0100", "+1-555-123-0100")).toBe(true);
    expect(Phone.isSameNumber("+65 9066 5484", new Phone("+6590665484"))).toBe(
      true,
    );
  });

  test("a different number is not the same", () => {
    expect(Phone.isSameNumber("+15551230100", "+15551230101")).toBe(false);
    expect(Phone.isSameNumber("+6590665484", "+6590665485")).toBe(false);
  });

  test("a number with its country code and one without are not matched", () => {
    expect(Phone.isSameNumber("+15551230100", "5551230100")).toBe(false);
  });

  test("nothing is never the same as anything, itself included", () => {
    expect(Phone.isSameNumber(undefined, "+15551230100")).toBe(false);
    expect(Phone.isSameNumber("+15551230100", null)).toBe(false);
    expect(Phone.isSameNumber(undefined, undefined)).toBe(false);
    expect(Phone.isSameNumber("", "")).toBe(false);
    expect(Phone.isSameNumber("+", "+")).toBe(false);
  });
});
