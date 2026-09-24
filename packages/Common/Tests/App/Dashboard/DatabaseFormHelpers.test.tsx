import { describe, expect, test } from "@jest/globals";
import {
  DATABASE_SERVER_ADDRESS_DESCRIPTION,
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
 * hint offers the `@<cluster>` form without forcing it.
 *
 * The Endpoints tab's "Added by" pill: which of discovery's claims an
 * endpoint is.
 */

describe("the create form's Server Address help", () => {
  test("documents the cluster qualifier, the named instance and the user@host rule", () => {
    expect(DATABASE_SERVER_ADDRESS_DESCRIPTION).toContain(
      "pg.shop.svc.cluster.local:5432@prod-eu",
    );
    expect(DATABASE_SERVER_ADDRESS_DESCRIPTION).toContain("pg.shop");
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
  test("says who added each endpoint", () => {
    expect(getDatabaseEndpointSourceLabel("user")).toEqual({
      text: "Added by a person",
      isUser: true,
    });
    expect(getDatabaseEndpointSourceLabel("workload")).toEqual({
      text: "Discovered (Kubernetes Service)",
      isUser: false,
    });
    expect(getDatabaseEndpointSourceLabel("auto")).toEqual({
      text: "Discovered",
      isUser: false,
    });
  });

  test("is case- and space-tolerant, and reads anything unknown as discovered", () => {
    expect(getDatabaseEndpointSourceLabel(" USER ").isUser).toBe(true);
    expect(getDatabaseEndpointSourceLabel("Workload").text).toBe(
      "Discovered (Kubernetes Service)",
    );
    for (const value of [undefined, null, "", "something-new", 42]) {
      expect(getDatabaseEndpointSourceLabel(value)).toEqual({
        text: "Discovered",
        isUser: false,
      });
    }
  });
});
