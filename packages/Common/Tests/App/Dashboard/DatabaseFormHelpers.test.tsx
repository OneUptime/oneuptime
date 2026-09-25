import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DATABASE_SERVER_ADDRESS_DESCRIPTION,
  DATABASE_SERVER_SERVICE_NAME_CLUSTER_REQUIRED,
  getDatabaseServerAddressHint,
  validateDatabaseServerAddress,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseManualEndpointForm";
import { getDatabaseEndpointSourceLabel } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";

/*
 * The Databases pages' form helpers.
 *
 * The create form's Server Address: its help text documents the forms the
 * identity rules accept (`@<cluster>` for an address that only resolves
 * inside one cluster or private network, `host\INSTANCE` for a SQL Server
 * named instance, never `user@host`), its validation refuses what could
 * never become an endpoint with a message that says what to change, and its
 * hint offers the `@<cluster>` form — saying, for a Kubernetes Service name,
 * that the server requires it once the project has a Kubernetes cluster.
 *
 * The Endpoints tab's "Added by" pill: which of discovery's claims an
 * endpoint is.
 */

describe("the create form's Server Address help", () => {
  test("documents the cluster qualifier, the named instance and the user@host rule", () => {
    expect(DATABASE_SERVER_ADDRESS_DESCRIPTION).toContain(
      "pg.shop.svc.cluster.local:5432@prod-eu",
    );
    expect(DATABASE_SERVER_ADDRESS_DESCRIPTION).toContain(
      "(pg.shop.svc.cluster.local, pg.shop.svc)",
    );
    expect(DATABASE_SERVER_ADDRESS_DESCRIPTION).toContain("private IP");
    expect(DATABASE_SERVER_ADDRESS_DESCRIPTION).toContain("host\\INSTANCE");
    expect(DATABASE_SERVER_ADDRESS_DESCRIPTION).toContain(
      "Do not include a user name (user@host)",
    );
    expect(DATABASE_SERVER_ADDRESS_DESCRIPTION).toContain("Never localhost");
  });

  test("every example the help gives is accepted as written", () => {
    for (const example of [
      "pg.shop.svc.cluster.local:5432@prod-eu",
      "pg.shop@prod-eu",
      "10.0.0.5:5432@prod-eu",
      "sql1\\INST01",
    ]) {
      expect({
        example,
        error: validateDatabaseServerAddress({
          dbSystem: "postgresql",
          serverAddress: example,
        }),
      }).toEqual({ example, error: null });
    }
  });

  /*
   * Regression: the help gave `pg.shop` as a cluster-only name, but the
   * create form has no namespace to complete it with, so it reads as an
   * ordinary two-label domain — no cluster advice, and a database no pod's
   * calls would match.
   */
  test("every cluster-only example the help gives is read as cluster-only on the create form", () => {
    const examples: Array<string> = (
      DATABASE_SERVER_ADDRESS_DESCRIPTION.match(
        /one Kubernetes cluster \(([^)]+)\)/,
      ) as RegExpMatchArray
    )[1]!.split(", ");

    expect(examples).toEqual(["pg.shop.svc.cluster.local", "pg.shop.svc"]);

    for (const serverAddress of examples) {
      expect({
        serverAddress,
        advises: Boolean(
          getDatabaseServerAddressHint({
            dbSystem: "postgresql",
            serverAddress,
          })?.includes("@<cluster name>"),
        ),
      }).toEqual({ serverAddress, advises: true });
    }

    // The old example: a two-label domain here, never cluster-only.
    expect(
      getDatabaseServerAddressHint({
        dbSystem: "postgresql",
        serverAddress: "pg.shop",
      }),
    ).toBeNull();
  });
});

describe("validateDatabaseServerAddress", () => {
  test("a plain host, with or without a port, is accepted", () => {
    expect(
      validateDatabaseServerAddress({
        dbSystem: "postgresql",
        serverAddress: "db.prod.example.com",
      }),
    ).toBeNull();
    expect(
      validateDatabaseServerAddress({
        dbSystem: "mysql",
        serverAddress: "db.prod.example.com:3307",
        serverPort: "",
      }),
    ).toBeNull();
  });

  test("user@host is refused, and told to drop the user", () => {
    const error: string | null = validateDatabaseServerAddress({
      dbSystem: "postgresql",
      serverAddress: "admin@db.example.com:5432",
    });
    expect(error).toContain('Remove "admin@"');
    expect(error).toContain("does not belong in an endpoint");
  });

  test("a dotted user name is a user name too, not a host", () => {
    expect(
      validateDatabaseServerAddress({
        dbSystem: "postgresql",
        serverAddress: "john.doe@db.example.com",
      }),
    ).toContain('Remove "john.doe@"');
  });

  test("a cluster qualifier on a public name is refused", () => {
    expect(
      validateDatabaseServerAddress({
        dbSystem: "postgresql",
        serverAddress: "db.example.com@prod",
      }),
    ).toContain('Remove "@prod"');
  });

  test("loopback is refused", () => {
    expect(
      validateDatabaseServerAddress({
        dbSystem: "redis",
        serverAddress: "localhost:6379",
      }),
    ).toContain("loopback");
  });

  test("the port field is checked with the address", () => {
    expect(
      validateDatabaseServerAddress({
        dbSystem: "postgresql",
        serverAddress: "db.example.com",
        serverPort: 70000,
      }),
    ).toBe("Server port must be a whole number between 1 and 65535.");
    expect(
      validateDatabaseServerAddress({
        dbSystem: "postgresql",
        serverAddress: "db.example.com:99999",
      }),
    ).toContain("port outside 1-65535");
    expect(
      validateDatabaseServerAddress({
        dbSystem: "postgresql",
        serverAddress: "db.example.com",
        serverPort: 6432,
      }),
    ).toBeNull();
  });

  test("works before an engine is picked, and on empty input", () => {
    expect(
      validateDatabaseServerAddress({ serverAddress: "db.example.com" }),
    ).toBeNull();
    expect(validateDatabaseServerAddress({ serverAddress: "" })).toContain(
      "Server address is required",
    );
    expect(validateDatabaseServerAddress(null)).toContain(
      "Server address is required",
    );
  });
});

describe("getDatabaseServerAddressHint", () => {
  test("an unqualified cluster-local name or private IP gets the @<cluster> advice", () => {
    for (const serverAddress of [
      "pg.shop.svc.cluster.local",
      "10.0.0.5",
      "db.internal",
    ]) {
      const hint: string | null = getDatabaseServerAddressHint({
        dbSystem: "postgresql",
        serverAddress,
      });
      expect({
        serverAddress,
        advises: Boolean(hint?.includes("@<cluster name>")),
      }).toEqual({ serverAddress, advises: true });
    }
  });

  test("a Kubernetes Service name is told the cluster is required where clusters exist", () => {
    for (const serverAddress of [
      "pg.shop.svc.cluster.local",
      "pg.shop.svc",
      "pg.shop.svc.cluster.local:5433",
      "mongo-0.mongo-hl.data.svc.cluster.local",
    ]) {
      const hint: string | null = getDatabaseServerAddressHint({
        dbSystem: "postgresql",
        serverAddress,
      });
      expect({
        serverAddress,
        advises: Boolean(hint?.includes("@<cluster name>")),
        required: Boolean(
          hint?.endsWith(DATABASE_SERVER_SERVICE_NAME_CLUSTER_REQUIRED),
        ),
      }).toEqual({ serverAddress, advises: true, required: true });
    }
  });

  test("says 'required' on exactly the test the server's refusal applies", () => {
    // DatabaseServerService refuses when both of these hold (and clusters exist).
    const service: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/Services/DatabaseServerService.ts"),
      "utf8",
    );
    const refusal: string = service.substring(
      service.indexOf("private async refuseUnqualifiedKubernetesServiceName"),
    );

    expect(refusal).toContain("!data.manual.clusterQualifierHint");
    expect(refusal).toContain("!isKubernetesServiceDnsHost(endpoint.host)");
  });

  test("a private IP or private-zone name is only advised, never told it is required", () => {
    for (const serverAddress of ["10.0.0.5", "db.internal", "pg.local:5432"]) {
      const hint: string | null = getDatabaseServerAddressHint({
        dbSystem: "postgresql",
        serverAddress,
      });
      expect({
        serverAddress,
        advises: Boolean(hint?.includes("@<cluster name>")),
        required: Boolean(
          hint?.includes(DATABASE_SERVER_SERVICE_NAME_CLUSTER_REQUIRED),
        ),
      }).toEqual({ serverAddress, advises: true, required: false });
    }
  });

  test("a qualified, public or refused address gets no hint", () => {
    for (const serverAddress of [
      "pg.shop.svc.cluster.local:5432@prod-eu",
      "db.example.com",
      "admin@10.0.0.5",
      "",
    ]) {
      expect({
        serverAddress,
        hint: getDatabaseServerAddressHint({
          dbSystem: "postgresql",
          serverAddress,
        }),
      }).toEqual({ serverAddress, hint: null });
    }
  });
});

describe("getDatabaseEndpointSourceLabel", () => {
  test("says who added each endpoint, in words short enough for the 'Added by' pill", () => {
    expect(getDatabaseEndpointSourceLabel("user")).toMatchObject({
      text: "A person",
      isUser: true,
    });
    expect(getDatabaseEndpointSourceLabel("workload")).toMatchObject({
      text: "Kubernetes Service",
      isUser: false,
    });
    expect(getDatabaseEndpointSourceLabel("auto")).toMatchObject({
      text: "Discovery",
      isUser: false,
    });
    /*
     * "Discovered (Kubernetes Service)" made the pill 268 px wide and the
     * Endpoints table overflow its card at 1440 px.
     */
    for (const value of ["user", "workload", "auto"]) {
      expect(
        getDatabaseEndpointSourceLabel(value).text.length,
      ).toBeLessThanOrEqual(18);
    }
  });

  test("the sentence the pill used to say is its hover text", () => {
    expect(getDatabaseEndpointSourceLabel("user").description).toContain(
      "by a person",
    );
    expect(getDatabaseEndpointSourceLabel("workload").description).toContain(
      "Service name of the Kubernetes workload",
    );
    expect(getDatabaseEndpointSourceLabel("auto").description).toContain(
      "Discovered",
    );
  });

  test("is case- and space-tolerant, and reads anything unknown as discovered", () => {
    expect(getDatabaseEndpointSourceLabel(" USER ").isUser).toBe(true);
    expect(getDatabaseEndpointSourceLabel("Workload").text).toBe(
      "Kubernetes Service",
    );
    for (const value of [undefined, null, "", "something-new", 42]) {
      expect(getDatabaseEndpointSourceLabel(value)).toEqual(
        getDatabaseEndpointSourceLabel("auto"),
      );
    }
  });
});
