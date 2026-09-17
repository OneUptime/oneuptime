import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorTemplateSyncFieldUtil, {
  MonitorTemplateSyncField,
} from "../../../Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "../../../Types/Monitor/MonitorType";

describe("MonitorTemplateSyncFieldUtil", () => {
  test.each(Object.values(MonitorType))(
    "%s exposes distinct, validated field options",
    (monitorType: MonitorType): void => {
      const fields: Array<MonitorTemplateSyncField> =
        MonitorTemplateSyncFieldUtil.getFields(monitorType);
      const paths: Array<string> = fields.map(
        (field: MonitorTemplateSyncField): string => {
          return field.path;
        },
      );
      expect(new Set(paths).size).toBe(paths.length);
      expect(MonitorTemplateSyncFieldUtil.parse(paths, monitorType)).toEqual(
        paths,
      );
      for (const field of fields) {
        expect(field.label.length).toBeGreaterThan(0);
        for (const path of MonitorTemplateSyncFieldUtil.getPaths(field.path)) {
          expect(path).not.toMatch(
            /(^|\.)(id|monitorCriteria|doNotSyncFields)(\.|$)/,
          );
          expect(path.split(".").length).toBeLessThanOrEqual(2);
        }
      }
    },
  );

  test("omitted policy stays omitted and empty policy stays empty", (): void => {
    expect(MonitorTemplateSyncFieldUtil.parse(undefined)).toBeUndefined();
    expect(MonitorTemplateSyncFieldUtil.parse([])).toEqual([]);
  });

  test("deduplicates a policy without modifying the supplied array", (): void => {
    const input: Array<string> = [
      "requestHeaders",
      "monitorDestination",
      "requestHeaders",
    ];
    expect(MonitorTemplateSyncFieldUtil.parse(input, MonitorType.API)).toEqual([
      "requestHeaders",
      "monitorDestination",
    ]);
    expect(input).toEqual([
      "requestHeaders",
      "monitorDestination",
      "requestHeaders",
    ]);
  });

  test.each([
    null,
    "requestHeaders",
    0,
    false,
    {},
    ["requestHeaders", null],
    [1],
    [[]],
  ])("rejects malformed policy %j", (value: unknown): void => {
    expect((): void => {
      MonitorTemplateSyncFieldUtil.parse(value);
    }).toThrow(BadDataException);
  });

  test.each([
    "id",
    "monitorCriteria",
    "monitorCriteria.monitorCriteriaInstanceArray",
    "doNotSyncFields",
    "requestHeaders.Authorization",
    "unknownField",
    "networkDeviceMonitor.networkDeviceId",
  ])("rejects non-selectable field %s", (path: string): void => {
    expect((): void => {
      MonitorTemplateSyncFieldUtil.parse([path]);
    }).toThrow("Unsupported do not sync field");
    expect((): void => {
      MonitorTemplateSyncFieldUtil.getPaths(path);
    }).toThrow("Unsupported do not sync field");
  });

  test("rejects a field belonging to a different monitor type", (): void => {
    expect((): void => {
      MonitorTemplateSyncFieldUtil.parse(["requestHeaders"], MonitorType.DNS);
    }).toThrow("Unsupported do not sync field");
    expect((): void => {
      MonitorTemplateSyncFieldUtil.parse(
        ["dnsMonitor.queryName"],
        MonitorType.API,
      );
    }).toThrow("Unsupported do not sync field");
  });

  test("TLS credentials are a single option", (): void => {
    expect(
      MonitorTemplateSyncFieldUtil.getPaths("tlsClientAuthentication"),
    ).toEqual([
      "tlsClientCertificate",
      "tlsClientKey",
      "tlsClientKeyPassphrase",
    ]);
    expect((): void => {
      MonitorTemplateSyncFieldUtil.parse(["tlsClientKey"]);
    }).toThrow();
  });

  test("Website options include only settings used by website checks", (): void => {
    const websiteFields: Array<string> = MonitorTemplateSyncFieldUtil.getFields(
      MonitorType.Website,
    ).map((field: MonitorTemplateSyncField): string => {
      return field.path;
    });
    expect(websiteFields).toEqual([
      "monitorDestination",
      "requestTimeoutInMs",
      "retryCount",
      "doNotFollowRedirects",
      "allowSelfSignedCertificates",
      "tlsClientAuthentication",
    ]);
    for (const apiField of ["requestHeaders", "requestType", "requestBody"]) {
      expect((): void => {
        MonitorTemplateSyncFieldUtil.parse([apiField], MonitorType.Website);
      }).toThrow("Unsupported do not sync field");
      expect(
        MonitorTemplateSyncFieldUtil.parse([apiField], MonitorType.API),
      ).toEqual([apiField]);
    }
  });

  test.each(["sqlMonitor", "databaseMonitor"])(
    "%s connection includes all authentication and endpoint fields",
    (prefix: string): void => {
      expect(
        MonitorTemplateSyncFieldUtil.getPaths(`${prefix}.connection`),
      ).toEqual(
        [
          "databaseType",
          "host",
          "port",
          "databaseName",
          "username",
          "password",
          "useWindowsIntegratedAuthentication",
          "useSsl",
          "rejectUnauthorizedSsl",
        ].map((key: string): string => {
          return `${prefix}.${key}`;
        }),
      );
    },
  );

  test.each([
    MonitorType.Manual,
    MonitorType.IncomingRequest,
    MonitorType.IncomingEmail,
    MonitorType.Server,
    MonitorType.NetworkDevice,
  ])(
    "%s has no misleading exclusions for criteria or automatically preserved bindings",
    (monitorType: MonitorType): void => {
      expect(MonitorTemplateSyncFieldUtil.getFields(monitorType)).toEqual([]);
    },
  );
});
