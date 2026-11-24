import {
  CODE_AMBIGUOUS_HINTS,
  highestSensitivity,
  isAnySecret,
  isHeadOf,
  NamedDataType,
  SensitiveNameMatcher,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataNames";
import {
  describeDataType,
  withArticle,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataWords";
import DataCategory from "../../../../../../Types/DataSecurity/DataCategory";
import DataSensitivity from "../../../../../../Types/DataSecurity/DataSensitivity";
import { DATA_TYPE_CATALOG } from "../../../../../../Types/DataSecurity/DataTypeCatalog";
import { describe, expect, test } from "@jest/globals";

/*
 * What a name in code says it holds (#10376): the catalog's field-name
 * hints, read as the head of a name - so `customerEmail` is an email
 * address and `emailTemplate` is not - with the hints too common in code
 * left to the scans, and the project's own types read the same way.
 */

const matcher: SensitiveNameMatcher = new SensitiveNameMatcher();

function idsOf(
  name: string,
  using: SensitiveNameMatcher = matcher,
): Array<string> {
  return using.match(name).map((type: NamedDataType): string => {
    return type.id;
  });
}

describe("a name whose head is the data", () => {
  test.each([
    ["email", "email-address"],
    ["customerEmail", "email-address"],
    ["customer_email", "email-address"],
    ["emailAddress", "email-address"],
    ["user.email", "email-address"],
    ["emails", "email-address"],
    ["phoneNumber", "phone-number"],
    ["dateOfBirth", "date-of-birth"],
    ["date_of_birth", "date-of-birth"],
    ["dob", "date-of-birth"],
    ["ssn", "us-ssn"],
    ["customer_ssn", "us-ssn"],
    ["SSNNumber", "us-ssn"],
    ["applicant.ssn", "us-ssn"],
    ["password", "generic-secret"],
    ["newPassword", "generic-secret"],
    ["DB_PASSWORD", "generic-secret"],
    ["apiKey", "generic-secret"],
    ["clientSecret", "generic-secret"],
    ["token", "generic-secret"],
    ["resetToken", "generic-secret"],
    ["refreshToken", "generic-secret"],
    ["credentials", "generic-secret"],
    ["cookie", "generic-secret"],
    ["authorization", "authorization-header"],
    ["http.request.header.authorization", "authorization-header"],
    ["privateKey", "private-key"],
    ["cardNumber", "credit-card-number"],
    ["card.number", "credit-card-number"],
    ["cvv", "card-verification-code"],
    ["cardSecurityCode", "card-verification-code"],
    ["iban", "iban"],
    ["passportNumber", "passport-number"],
    ["firstName", "person-name"],
    ["billingAddress", "postal-address"],
    ["diagnosisCode", "diagnosis-code"],
  ])("%s is %s", (name: string, id: string) => {
    expect(idsOf(name)).toContain(id);
  });
});

describe("a name that is about the data, not the data", () => {
  test.each([
    "emailTemplate",
    "emailVerified",
    "isEmailVerified",
    "emailCount",
    "numEmails",
    "hasEmail",
    "emailHash",
    "hashedEmail",
    "maskedEmail",
    "emailDomain",
    "passwordPolicy",
    "passwordLength",
    "passwordHash",
    "hashedPassword",
    "encryptedPassword",
    "isPasswordSet",
    "password_reset_at",
    "tokenCount",
    "maxTokens",
    "promptTokens",
    "nextPageToken",
    "pageToken",
    "cancellationToken",
    "tokenType",
    "apiKeyId",
    "secretName",
    "cookieName",
    "card_last4",
    "ssnLast4",
    "userId",
    "name",
    "id",
  ])("%s names no data", (name: string) => {
    expect(idsOf(name)).toEqual([]);
  });
});

describe("hints too common in code are the scans' to read", () => {
  test.each([
    "ip",
    "address",
    "run",
    "sin",
    "condition",
    "treatment",
    "expiry",
    "orientation",
    "race",
    "fingerprint",
    "mobile",
    "cell",
    "memberId",
    "accountNumber",
    "taxId",
    "nationalId",
    "securityCode",
    "pan",
  ])("%s makes no point", (name: string) => {
    expect(idsOf(name)).toEqual([]);
  });

  test("every left-out hint is one the catalog has", () => {
    const hints: Set<string> = new Set<string>(
      DATA_TYPE_CATALOG.flatMap(
        (type: { nameHints: ReadonlyArray<string> }) => {
          return [...type.nameHints];
        },
      ),
    );

    for (const hint of CODE_AMBIGUOUS_HINTS) {
      expect({ hint, isCatalogs: hints.has(hint) }).toEqual({
        hint,
        isCatalogs: true,
      });
    }
  });

  test("an IP address or a user name in code is how services are run: no point", () => {
    expect(idsOf("ipAddress")).toEqual([]);
    expect(idsOf("clientIp")).toEqual([]);
    expect(idsOf("username")).toEqual([]);
    expect(idsOf("gender")).toEqual([]);
  });
});

describe("a hint several kinds share names their category", () => {
  test("an access token is a secret, not one kind of token", () => {
    const types: Array<NamedDataType> = matcher.match("accessToken");

    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe("Secret");
    expect(types[0]!.sensitivity).toBe(DataSensitivity.Restricted);
    expect(isAnySecret(types)).toBe(true);
  });

  test("a medicare number is a health record number, of no one country", () => {
    const types: Array<NamedDataType> = matcher.match("medicareNumber");

    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe("Health record number");
  });
});

describe("the project's own data types", () => {
  const withTypes: SensitiveNameMatcher = new SensitiveNameMatcher([
    {
      id: "custom:1111",
      name: "Loyalty member number",
      sensitivity: DataSensitivity.Restricted,
      category: DataCategory.ContactAndIdentity,
      nameHints: ["loyalty number", "rewards id"],
    },
    {
      id: "custom:2222",
      name: "Internal note",
      sensitivity: DataSensitivity.Internal,
      nameHints: ["note text"],
    },
  ]);

  test("are read by their hints, the same head rule", () => {
    expect(idsOf("customerLoyaltyNumber", withTypes)).toEqual(["custom:1111"]);
    expect(idsOf("rewards_id", withTypes)).toEqual(["custom:1111"]);
    expect(idsOf("loyaltyNumberCount", withTypes)).toEqual([]);
  });

  test("an Internal or Public type of the project's makes no point", () => {
    expect(idsOf("noteText", withTypes)).toEqual([]);
  });

  test("the catalog's hints still count beside them", () => {
    expect(idsOf("email", withTypes)).toEqual(["email-address"]);
  });
});

describe("the head rule itself", () => {
  test("the hint's words must end the name, but for words that keep it the same thing", () => {
    expect(isHeadOf(["customer", "email"], ["email"])).toBe(true);
    expect(isHeadOf(["email", "value"], ["email"])).toBe(true);
    expect(isHeadOf(["email", "list"], ["email"])).toBe(true);
    expect(isHeadOf(["email", "sent"], ["email"])).toBe(false);
  });

  test("a plural is read where it is allowed", () => {
    expect(isHeadOf(["emails"], ["email"])).toBe(true);
    expect(isHeadOf(["passwords"], ["password"], { allowsPlural: false })).toBe(
      false,
    );
  });

  test("a name too long to be a name is none", () => {
    expect(idsOf(`${"a".repeat(200)}Email`)).toEqual([]);
  });

  test("the most sensitive kind comes first", () => {
    const types: Array<NamedDataType> = matcher.match("ssn");

    expect(highestSensitivity(types)).toBe(DataSensitivity.Restricted);
  });
});

describe("a kind of data in a sentence", () => {
  test.each([
    ["Email address", "an email address"],
    ["US Social Security number", "a US Social Security number"],
    ["IBAN", "an IBAN"],
    ["NHS number", "an NHS number"],
    ["Password or secret", "a password or secret"],
    ["JSON web token", "a JSON web token"],
    ["Biometric data", "biometric data"],
    ["Health information", "health information"],
    ["", "data"],
  ])("%s reads as %s", (name: string, sentence: string) => {
    expect(withArticle(name)).toBe(sentence);
  });

  test("a matched type reads with its article", () => {
    expect(describeDataType(matcher.match("email")[0]!)).toBe(
      "an email address",
    );
  });
});
