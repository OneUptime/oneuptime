import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Port from "../../../Types/Port";
import MonitorOverviewTargetUtil, {
  MonitorOverviewTarget,
} from "../../../Utils/Monitor/MonitorOverviewTargetUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * The hero shows what a monitor watches to every role that can open it, so
 * the target line must identify the resource without leaking the secrets
 * that monitor steps routinely carry: userinfo and tokens in URLs, and
 * database credentials that sit right next to the host.
 */

const stepsOf: (...stepData: Array<JSONObject>) => MonitorSteps = (
  ...stepData: Array<JSONObject>
): MonitorSteps => {
  return {
    data: {
      monitorStepsInstanceArray: stepData.map((data: JSONObject) => {
        return { data: data };
      }),
    },
  } as unknown as MonitorSteps;
};

const target: (
  monitorType: MonitorType,
  monitorSteps: MonitorSteps | undefined,
  serverHostname?: string,
) => MonitorOverviewTarget | null = (
  monitorType: MonitorType,
  monitorSteps: MonitorSteps | undefined,
  serverHostname?: string,
): MonitorOverviewTarget | null => {
  return MonitorOverviewTargetUtil.getTarget({
    monitorType: monitorType,
    monitorSteps: monitorSteps,
    serverHostname: serverHostname,
  });
};

describe("MonitorOverviewTargetUtil.getTarget", () => {
  it("Website shows the redacted URL", () => {
    expect(
      target(
        MonitorType.Website,
        stepsOf({
          monitorDestination: "https://user:pass@shop.example.com/?ref=x#top",
        }),
      ),
    ).toEqual({
      value: "https://shop.example.com/",
      isMono: true,
      extraStepCount: 0,
    });
  });

  it("Website reads a URL class instance", () => {
    expect(
      target(
        MonitorType.Website,
        stepsOf({
          monitorDestination: URL.fromString(
            "https://shop.example.com/health?key=secret",
          ) as unknown as JSONObject,
        }),
      )?.value,
    ).toBe("https://shop.example.com/health");
  });

  it("External status page shows the status page URL", () => {
    expect(
      target(
        MonitorType.ExternalStatusPage,
        stepsOf({
          externalStatusPageMonitor: {
            statusPageUrl: "https://status.vendor.com/?token=abc",
          },
        }),
      )?.value,
    ).toBe("https://status.vendor.com/");
  });

  it("SSL certificate shows the redacted URL", () => {
    expect(
      target(
        MonitorType.SSLCertificate,
        stepsOf({ monitorDestination: "https://secure.example.com" }),
      )?.value,
    ).toBe("https://secure.example.com");
  });

  it("API shows the method and the redacted URL", () => {
    expect(
      target(
        MonitorType.API,
        stepsOf({
          requestType: "POST",
          monitorDestination:
            "https://api.example.com/v1/health?api_key=s3cr3t",
        }),
      ),
    ).toEqual({
      value: "POST https://api.example.com/v1/health",
      isMono: true,
      extraStepCount: 0,
    });
  });

  it("Ping and IP show the host without userinfo", () => {
    expect(
      target(MonitorType.Ping, stepsOf({ monitorDestination: "10.0.0.5" }))
        ?.value,
    ).toBe("10.0.0.5");
    expect(
      target(
        MonitorType.IP,
        stepsOf({ monitorDestination: "admin@192.168.1.1" }),
      )?.value,
    ).toBe("192.168.1.1");
  });

  it("Port shows host:port", () => {
    expect(
      target(
        MonitorType.Port,
        stepsOf({
          monitorDestination: Hostname.fromString(
            "mail.example.com",
          ) as unknown as JSONObject,
          monitorDestinationPort: new Port(587) as unknown as JSONObject,
        }),
      )?.value,
    ).toBe("mail.example.com:587");
    expect(
      target(MonitorType.Port, stepsOf({ monitorDestination: "db.local" }))
        ?.value,
    ).toBe("db.local");
  });

  it("DNS shows the record, the name and the resolver when one is set", () => {
    expect(
      target(
        MonitorType.DNS,
        stepsOf({
          dnsMonitor: { queryName: "example.com", recordType: "MX" },
        }),
      )?.value,
    ).toBe("MX example.com");
    expect(
      target(
        MonitorType.DNS,
        stepsOf({
          dnsMonitor: {
            queryName: "example.com",
            recordType: "A",
            hostname: "8.8.8.8",
          },
        }),
      )?.value,
    ).toBe("A example.com via 8.8.8.8");
  });

  it("Domain shows the domain name", () => {
    expect(
      target(
        MonitorType.Domain,
        stepsOf({ domainMonitor: { domainName: "example.org" } }),
      )?.value,
    ).toBe("example.org");
  });

  it("DNSSEC shows the domain name", () => {
    expect(
      target(
        MonitorType.DNSSEC,
        stepsOf({ dnssecMonitor: { domainName: "secure.example.org" } }),
      )?.value,
    ).toBe("secure.example.org");
  });

  it("SQL query and Database show engine · host:port/database", () => {
    expect(
      target(
        MonitorType.SQLQuery,
        stepsOf({
          sqlMonitor: {
            databaseType: "PostgreSQL",
            host: "db.internal",
            port: 5432,
            databaseName: "orders",
            username: "app",
            password: "hunter2",
          },
        }),
      )?.value,
    ).toBe("PostgreSQL · db.internal:5432/orders");
    expect(
      target(
        MonitorType.Database,
        stepsOf({
          databaseMonitor: {
            databaseType: "MySQL",
            host: "mysql.internal",
            databaseName: "",
          },
        }),
      )?.value,
    ).toBe("MySQL · mysql.internal");
  });

  it("SQL target omits missing parts", () => {
    expect(
      target(
        MonitorType.SQLQuery,
        stepsOf({ sqlMonitor: { databaseName: "orders" } }),
      )?.value,
    ).toBe("orders");
    expect(
      target(MonitorType.SQLQuery, stepsOf({ sqlMonitor: {} })),
    ).toBeNull();
  });

  it("SQL target never contains username or password", () => {
    const value: string =
      target(
        MonitorType.SQLQuery,
        stepsOf({
          sqlMonitor: {
            databaseType: "PostgreSQL",
            host: "reporting:Sup3rS3cret@db.internal",
            port: 5432,
            databaseName: "orders",
            username: "reporting",
            password: "Sup3rS3cret",
          },
        }),
      )?.value || "";

    expect(value).toBe("PostgreSQL · db.internal:5432/orders");
    expect(value).not.toContain("reporting");
    expect(value).not.toContain("Sup3rS3cret");
  });

  it("Server shows the reported hostname", () => {
    expect(
      target(MonitorType.Server, stepsOf({}), "web-01.example.com"),
    ).toEqual({ value: "web-01.example.com", isMono: true, extraStepCount: 0 });
    expect(target(MonitorType.Server, stepsOf({}))).toBeNull();
  });

  it("scripted checks describe the script instead of a target", () => {
    expect(target(MonitorType.SyntheticMonitor, stepsOf({}))).toEqual({
      value: "Browser script",
      isMono: false,
      extraStepCount: 0,
    });
    expect(target(MonitorType.CustomJavaScriptCode, stepsOf({}))).toEqual({
      value: "Custom script",
      isMono: false,
      extraStepCount: 0,
    });
  });

  it.each([
    MonitorType.NetworkDevice,
    MonitorType.IncomingRequest,
    MonitorType.IncomingEmail,
    MonitorType.Logs,
    MonitorType.Metrics,
    MonitorType.Kubernetes,
    MonitorType.Host,
    MonitorType.Manual,
  ])("%s has no target", (monitorType: MonitorType) => {
    expect(
      target(
        monitorType,
        stepsOf({ monitorDestination: "https://example.com" }),
        "host-1",
      ),
    ).toBeNull();
  });

  it("extraStepCount", () => {
    expect(
      target(
        MonitorType.Website,
        stepsOf(
          { monitorDestination: "https://a.example.com" },
          { monitorDestination: "https://b.example.com" },
          { monitorDestination: "https://c.example.com" },
        ),
      ),
    ).toEqual({
      value: "https://a.example.com",
      isMono: true,
      extraStepCount: 2,
    });
  });

  it("malformed steps give null without throwing", () => {
    expect(target(MonitorType.Website, undefined)).toBeNull();
    expect(
      target(MonitorType.Website, {
        data: undefined,
      } as unknown as MonitorSteps),
    ).toBeNull();
    expect(
      target(MonitorType.API, {
        data: { monitorStepsInstanceArray: "nope" },
      } as unknown as MonitorSteps),
    ).toBeNull();
    expect(
      target(MonitorType.API, {
        data: { monitorStepsInstanceArray: [null] },
      } as unknown as MonitorSteps),
    ).toBeNull();
    expect(
      target(MonitorType.Website, stepsOf({ monitorDestination: { a: 1 } })),
    ).toBeNull();
    expect(target(MonitorType.DNS, stepsOf({ dnsMonitor: null }))).toBeNull();
    expect(
      target(MonitorType.Website, {
        data: {
          get monitorStepsInstanceArray(): never {
            throw new Error("boom");
          },
        },
      } as unknown as MonitorSteps),
    ).toBeNull();
  });
});

describe("MonitorOverviewTargetUtil.redactUrl", () => {
  it("redactUrl strips userinfo, query and fragment", () => {
    expect(
      MonitorOverviewTargetUtil.redactUrl("https://user:pass@host/p?token=x#f"),
    ).toBe("https://host/p");
    expect(
      MonitorOverviewTargetUtil.redactUrl("HTTPS://Admin@Host.example.com/x"),
    ).toBe("HTTPS://Host.example.com/x");
    expect(
      MonitorOverviewTargetUtil.redactUrl("  https://host/p#only-fragment "),
    ).toBe("https://host/p");
  });

  it("strips userinfo typed without a scheme", () => {
    expect(
      MonitorOverviewTargetUtil.redactUrl("user:pass@host.example.com/p"),
    ).toBe("host.example.com/p");
  });

  it("leaves an @ in the path alone", () => {
    expect(
      MonitorOverviewTargetUtil.redactUrl("https://host/users/@alice"),
    ).toBe("https://host/users/@alice");
  });
});

describe("MonitorOverviewTargetUtil.redactHost", () => {
  it("returns what follows the last @", () => {
    expect(MonitorOverviewTargetUtil.redactHost("a@b@db.internal ")).toBe(
      "db.internal",
    );
    expect(MonitorOverviewTargetUtil.redactHost("db.internal")).toBe(
      "db.internal",
    );
  });
});
