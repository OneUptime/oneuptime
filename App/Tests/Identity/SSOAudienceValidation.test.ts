/*
 * Logger pulls in server logging infra that is irrelevant to these pure SAML
 * parsing/comparison helpers; replace it so the suite stays light and isolated.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(),
  };
});

import SSOUtil, {
  AudienceValidationResult,
} from "../../FeatureSet/Identity/Utils/SSO";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";
import xml2js from "xml2js";

const EXPECTED: string = "https://oneuptime.example.com/global-sso/abc-123";

const parseXml: (xml: string) => Promise<JSONObject> = async (
  xml: string,
): Promise<JSONObject> => {
  return (await xml2js.parseStringPromise(xml)) as JSONObject;
};

/*
 * Wrap an arbitrary <Conditions> body inside a minimal Response/Assertion using
 * the requested namespace prefix ("saml2", "saml", or "" for no prefix).
 */
const buildResponse: (data: {
  conditionsXml: string;
  prefix?: string;
}) => string = (data: { conditionsXml: string; prefix?: string }): string => {
  const prefix: string = data.prefix ?? "saml2";
  const p: string = prefix ? `${prefix}:` : "";
  const protoNs: string = prefix
    ? `xmlns:${prefix}="urn:oasis:names:tc:SAML:2.0:assertion"`
    : `xmlns="urn:oasis:names:tc:SAML:2.0:assertion"`;

  return (
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ${protoNs}>` +
    `<${p}Assertion><${p}Issuer>idp</${p}Issuer>${data.conditionsXml}</${p}Assertion>` +
    `</samlp:Response>`
  );
};

const audienceConditions: (data: {
  audiences: Array<string>;
  prefix?: string;
}) => string = (data: {
  audiences: Array<string>;
  prefix?: string;
}): string => {
  const p: string = (data.prefix ?? "saml2") ? `${data.prefix ?? "saml2"}:` : "";
  const audienceXml: string = data.audiences
    .map((a: string) => {
      return `<${p}Audience>${a}</${p}Audience>`;
    })
    .join("");
  return `<${p}Conditions><${p}AudienceRestriction>${audienceXml}</${p}AudienceRestriction></${p}Conditions>`;
};

describe("SSOUtil.getAudiences", () => {
  test("extracts a single audience (saml2 prefix)", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({ conditionsXml: audienceConditions({ audiences: [EXPECTED] }) }),
    );
    expect(SSOUtil.getAudiences(payload)).toEqual([EXPECTED]);
  });

  test("extracts audiences with the saml: prefix", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({
        prefix: "saml",
        conditionsXml: audienceConditions({ audiences: [EXPECTED], prefix: "saml" }),
      }),
    );
    expect(SSOUtil.getAudiences(payload)).toEqual([EXPECTED]);
  });

  test("extracts audiences with no namespace prefix", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({
        prefix: "",
        conditionsXml: audienceConditions({ audiences: [EXPECTED], prefix: "" }),
      }),
    );
    expect(SSOUtil.getAudiences(payload)).toEqual([EXPECTED]);
  });

  test("reads audience text even when the element carries attributes", async () => {
    const conditionsXml: string =
      `<saml2:Conditions><saml2:AudienceRestriction>` +
      `<saml2:Audience xmlns:extra="urn:x">${EXPECTED}</saml2:Audience>` +
      `</saml2:AudienceRestriction></saml2:Conditions>`;
    const payload: JSONObject = await parseXml(buildResponse({ conditionsXml }));
    expect(SSOUtil.getAudiences(payload)).toEqual([EXPECTED]);
  });

  test("collects multiple audiences across multiple AudienceRestrictions", async () => {
    const conditionsXml: string =
      `<saml2:Conditions>` +
      `<saml2:AudienceRestriction><saml2:Audience>first</saml2:Audience></saml2:AudienceRestriction>` +
      `<saml2:AudienceRestriction><saml2:Audience>second</saml2:Audience><saml2:Audience>third</saml2:Audience></saml2:AudienceRestriction>` +
      `</saml2:Conditions>`;
    const payload: JSONObject = await parseXml(buildResponse({ conditionsXml }));
    expect(SSOUtil.getAudiences(payload)).toEqual(["first", "second", "third"]);
  });

  test("returns [] when there is no Conditions / AudienceRestriction", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({ conditionsXml: "" }),
    );
    expect(SSOUtil.getAudiences(payload)).toEqual([]);
  });

  test("returns [] for a payload with no Response", async () => {
    const payload: JSONObject = await parseXml(`<Other></Other>`);
    expect(SSOUtil.getAudiences(payload)).toEqual([]);
  });
});

describe("SSOUtil.validateAudience", () => {
  test("passes when the expected audience is present", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({ conditionsXml: audienceConditions({ audiences: [EXPECTED] }) }),
    );
    const result: AudienceValidationResult = SSOUtil.validateAudience({
      payload,
      expectedAudience: EXPECTED,
    });
    expect(result.isOk).toBe(true);
    expect(result.isMismatch).toBe(false);
  });

  test("passes when expected appears among several audiences", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({
        conditionsXml: audienceConditions({
          audiences: ["api://other", EXPECTED, "spn:xyz"],
        }),
      }),
    );
    const result: AudienceValidationResult = SSOUtil.validateAudience({
      payload,
      expectedAudience: EXPECTED,
    });
    expect(result.isOk).toBe(true);
    expect(result.isMismatch).toBe(false);
  });

  test("flags a mismatch and names both values in the message", async () => {
    const received: string = "api://0000-1111-2222";
    const payload: JSONObject = await parseXml(
      buildResponse({ conditionsXml: audienceConditions({ audiences: [received] }) }),
    );
    const result: AudienceValidationResult = SSOUtil.validateAudience({
      payload,
      expectedAudience: EXPECTED,
    });
    expect(result.isOk).toBe(false);
    expect(result.isMismatch).toBe(true);
    expect(result.message).toContain(EXPECTED);
    expect(result.message).toContain(received);
  });

  test("is case-sensitive (a case-only difference is a mismatch)", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({
        conditionsXml: audienceConditions({ audiences: [EXPECTED.toUpperCase()] }),
      }),
    );
    const result: AudienceValidationResult = SSOUtil.validateAudience({
      payload,
      expectedAudience: EXPECTED,
    });
    expect(result.isMismatch).toBe(true);
  });

  test("tolerates a single trailing slash difference", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({
        conditionsXml: audienceConditions({ audiences: [`${EXPECTED}/`] }),
      }),
    );
    const result: AudienceValidationResult = SSOUtil.validateAudience({
      payload,
      expectedAudience: EXPECTED,
    });
    expect(result.isOk).toBe(true);
    expect(result.isMismatch).toBe(false);
  });

  test("skips (isOk, not mismatch) when no AudienceRestriction is present", async () => {
    const payload: JSONObject = await parseXml(
      buildResponse({ conditionsXml: "" }),
    );
    const result: AudienceValidationResult = SSOUtil.validateAudience({
      payload,
      expectedAudience: EXPECTED,
    });
    expect(result.isOk).toBe(true);
    expect(result.isMismatch).toBe(false);
    expect(result.message).toContain("skipped");
  });
});
