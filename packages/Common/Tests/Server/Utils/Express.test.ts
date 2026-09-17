import {
  ExpressRequest,
  RequestDeviceInfo,
  extractDeviceInfo,
} from "../../../Server/Utils/Express";
import { describe, expect, test } from "@jest/globals";

/*
 * extractDeviceInfo pulls four device attributes (name, type, os, browser)
 * out of a request. For each attribute it consults five sources in a fixed
 * precedence order and keeps the first that yields a non-empty value:
 *   1. the `x-<hyphenated>` request header
 *   2. body[camelKey]           e.g. body.deviceName
 *   3. body.data[camelKey]      e.g. body.data.deviceName
 *   4. body[hyphenated]         e.g. body["device-name"]
 *   5. body.data[hyphenated]    e.g. body.data["device-name"]
 * Only attributes that resolve to a value appear on the returned object.
 */

type HeaderValueForTest = string | Array<string> | null | undefined;

interface RequestLikeOptions {
  headers?: Record<string, HeaderValueForTest>;
  body?: Record<string, unknown> | null | undefined;
}

/*
 * The function only ever touches req.headers and req.body, so a minimal stub
 * cast to ExpressRequest is enough to exercise every branch without express.
 */
const buildRequest: (options?: RequestLikeOptions) => ExpressRequest = (
  options?: RequestLikeOptions,
): ExpressRequest => {
  return {
    headers: options?.headers || {},
    body: options?.body,
  } as unknown as ExpressRequest;
};

/*
 * The four attributes, each with the header/body/data keys the function
 * derives internally. Note deviceOS: the camelCase lookup key the function
 * builds from `device-os` is `deviceOs`, while the result property is
 * `deviceOS`. That deliberate mismatch is asserted in its own block below.
 */
interface FieldCase {
  label: string;
  headerKey: string;
  camelKey: string;
  hyphenKey: string;
  resultKey: keyof RequestDeviceInfo;
}

const fields: Array<FieldCase> = [
  {
    label: "device name",
    headerKey: "x-device-name",
    camelKey: "deviceName",
    hyphenKey: "device-name",
    resultKey: "deviceName",
  },
  {
    label: "device type",
    headerKey: "x-device-type",
    camelKey: "deviceType",
    hyphenKey: "device-type",
    resultKey: "deviceType",
  },
  {
    label: "device os",
    headerKey: "x-device-os",
    camelKey: "deviceOs",
    hyphenKey: "device-os",
    resultKey: "deviceOS",
  },
  {
    label: "device browser",
    headerKey: "x-device-browser",
    camelKey: "deviceBrowser",
    hyphenKey: "device-browser",
    resultKey: "deviceBrowser",
  },
];

const expectOnly: (
  key: keyof RequestDeviceInfo,
  value: string,
) => RequestDeviceInfo = (
  key: keyof RequestDeviceInfo,
  value: string,
): RequestDeviceInfo => {
  const expected: RequestDeviceInfo = {};
  expected[key] = value;
  return expected;
};

describe("extractDeviceInfo", () => {
  describe("empty and boundary inputs", () => {
    test("returns an empty object when there is no body and no headers", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(buildRequest());
      expect(result).toEqual({});
    });

    test("treats a missing body as an empty object without throwing", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ body: undefined, headers: {} }),
      );
      expect(result).toEqual({});
    });

    test("treats a null body as an empty object", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ body: null }),
      );
      expect(result).toEqual({});
    });

    test("treats a null body.data as an empty object", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ body: { data: null } }),
      );
      expect(result).toEqual({});
    });

    test("omits an attribute whose only source is whitespace", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({
          headers: { "x-device-name": "   " },
          body: { deviceName: "\t\n ", data: { deviceName: "  " } },
        }),
      );
      expect(result).toEqual({});
    });
  });

  describe("extraction from each source", () => {
    fields.forEach((field: FieldCase) => {
      test(`reads ${field.label} from its x- header`, () => {
        const result: RequestDeviceInfo = extractDeviceInfo(
          buildRequest({ headers: { [field.headerKey]: "from-header" } }),
        );
        expect(result).toEqual(expectOnly(field.resultKey, "from-header"));
      });

      test(`reads ${field.label} from the camelCase body key`, () => {
        const result: RequestDeviceInfo = extractDeviceInfo(
          buildRequest({ body: { [field.camelKey]: "from-body-camel" } }),
        );
        expect(result).toEqual(expectOnly(field.resultKey, "from-body-camel"));
      });

      test(`reads ${field.label} from the camelCase body.data key`, () => {
        const result: RequestDeviceInfo = extractDeviceInfo(
          buildRequest({
            body: { data: { [field.camelKey]: "from-data-camel" } },
          }),
        );
        expect(result).toEqual(expectOnly(field.resultKey, "from-data-camel"));
      });

      test(`reads ${field.label} from the hyphenated body key`, () => {
        const result: RequestDeviceInfo = extractDeviceInfo(
          buildRequest({ body: { [field.hyphenKey]: "from-body-hyphen" } }),
        );
        expect(result).toEqual(expectOnly(field.resultKey, "from-body-hyphen"));
      });

      test(`reads ${field.label} from the hyphenated body.data key`, () => {
        const result: RequestDeviceInfo = extractDeviceInfo(
          buildRequest({
            body: { data: { [field.hyphenKey]: "from-data-hyphen" } },
          }),
        );
        expect(result).toEqual(expectOnly(field.resultKey, "from-data-hyphen"));
      });
    });
  });

  describe("source precedence", () => {
    /*
     * A request that populates every source for device-name at once. Each
     * precedence test starts from this shape and strips the winning source(s)
     * so the next one down is forced to win.
     */
    type BuildAllSources = (options: {
      header?: boolean;
      bodyCamel?: boolean;
    }) => ExpressRequest;

    const buildAllSources: BuildAllSources = (options: {
      header?: boolean;
      bodyCamel?: boolean;
    }): ExpressRequest => {
      const headers: Record<string, HeaderValueForTest> = {};
      if (options.header) {
        headers["x-device-name"] = "from-header";
      }

      const body: Record<string, unknown> = {
        "device-name": "from-body-hyphen",
        data: {
          deviceName: "from-data-camel",
          "device-name": "from-data-hyphen",
        },
      };
      if (options.bodyCamel) {
        body["deviceName"] = "from-body-camel";
      }

      return buildRequest({ headers, body });
    };

    test("the x- header wins over every body and data source", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildAllSources({ header: true, bodyCamel: true }),
      );
      expect(result).toEqual({ deviceName: "from-header" });
    });

    test("the camelCase body key wins over data and hyphenated keys", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildAllSources({ header: false, bodyCamel: true }),
      );
      expect(result).toEqual({ deviceName: "from-body-camel" });
    });

    test("the camelCase data key wins over both hyphenated keys", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildAllSources({ header: false, bodyCamel: false }),
      );
      expect(result).toEqual({ deviceName: "from-data-camel" });
    });

    test("the hyphenated body key wins over the hyphenated data key", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({
          body: {
            "device-name": "from-body-hyphen",
            data: { "device-name": "from-data-hyphen" },
          },
        }),
      );
      expect(result).toEqual({ deviceName: "from-body-hyphen" });
    });

    test("the hyphenated data key is the last resort", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({
          body: { data: { "device-name": "from-data-hyphen" } },
        }),
      );
      expect(result).toEqual({ deviceName: "from-data-hyphen" });
    });

    test("falls through empty and whitespace sources to the next populated one", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({
          headers: { "x-device-name": "" },
          body: { deviceName: "   ", data: { deviceName: "resolved" } },
        }),
      );
      expect(result).toEqual({ deviceName: "resolved" });
    });
  });

  describe("value normalization", () => {
    test("trims surrounding whitespace from a string value", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ headers: { "x-device-browser": "  Chrome  " } }),
      );
      expect(result).toEqual({ deviceBrowser: "Chrome" });
    });

    test("returns the first element of an array value", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ headers: { "x-device-name": ["desktop", "ignored"] } }),
      );
      expect(result).toEqual({ deviceName: "desktop" });
    });

    test("does not trim the first element of an array value", () => {
      /*
       * The array branch of headerValueToString returns element zero verbatim;
       * only the plain-string branch trims. This locks that asymmetry in.
       */
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ headers: { "x-device-type": ["  laptop  "] } }),
      );
      expect(result).toEqual({ deviceType: "  laptop  " });
    });

    test("ignores an empty array and falls through to the next source", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({
          headers: { "x-device-name": [] },
          body: { deviceName: "fallback" },
        }),
      );
      expect(result).toEqual({ deviceName: "fallback" });
    });

    test("ignores a null value and falls through to the next source", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({
          body: { deviceName: null, "device-name": "fallback-hyphen" },
        }),
      );
      expect(result).toEqual({ deviceName: "fallback-hyphen" });
    });
  });

  describe("device-os camelCase key mapping", () => {
    test("matches the camelCase body key deviceOs", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ body: { deviceOs: "macOS" } }),
      );
      expect(result).toEqual({ deviceOS: "macOS" });
    });

    test("does not match the differently-cased body key deviceOS", () => {
      /*
       * The lookup key is derived as `deviceOs`, so a caller who sends
       * `deviceOS` is not matched by the camelCase source and the attribute is
       * omitted entirely.
       */
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ body: { deviceOS: "macOS" } }),
      );
      expect(result).toEqual({});
    });
  });

  describe("partial and combined results", () => {
    test("sets only the attributes that are present", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({
          headers: { "x-device-name": "Pixel" },
          body: { deviceType: "mobile" },
        }),
      );
      expect(result).toEqual({ deviceName: "Pixel", deviceType: "mobile" });
    });

    test("extracts all four attributes at once from mixed sources", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({
          headers: { "x-device-name": "MyPhone" },
          body: {
            deviceType: "mobile",
            data: { "device-os": "iOS", deviceBrowser: "Safari" },
          },
        }),
      );
      expect(result).toEqual({
        deviceName: "MyPhone",
        deviceType: "mobile",
        deviceOS: "iOS",
        deviceBrowser: "Safari",
      });
    });
  });

  describe("malformed containers", () => {
    test("does not throw when body.data is not an object", () => {
      const result: RequestDeviceInfo = extractDeviceInfo(
        buildRequest({ body: { data: "not-an-object", deviceName: "ok" } }),
      );
      expect(result).toEqual({ deviceName: "ok" });
    });
  });
});
