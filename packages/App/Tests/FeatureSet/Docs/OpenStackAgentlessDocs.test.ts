import OpenStackCollectionErrorCode, {
  OpenStackCollectionErrorUtil,
} from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT,
  OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "Common/Types/OpenStack/OpenStackConnectionTestStatus";
import {
  OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES,
  OPENSTACK_PROBE_COLLECTION_CONCURRENCY,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_TRUSTED_CERTIFICATES,
  MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
} from "Common/Utils/OpenStack/OpenStackCollectionSettings";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * telemetry/openstack-agentless.md, in English for now, against the product: the limits the
 * probe keeps to, and the messages a failure shows. Markdown is not compiled, so this reads
 * the page and the constants the probe and the server use: a limit changed or a message
 * reworded fails here, instead of leaving the page describing a product that is no longer
 * there. The buttons and the card have their test once the dashboard has them.
 */

const PAGE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/Docs/Content/en/telemetry/openstack-agentless.md",
  ),
  "utf8",
);

const PROBE_UTILS: string = path.resolve(
  __dirname,
  "../../../../Probe/Utils/OpenStack",
);

function row(setting: string): string {
  const line: string | undefined = PAGE.split("\n").find((text: string) => {
    return text.startsWith(`| ${setting} |`);
  });

  expect(line).toBeDefined();

  return line as string;
}

// A number the probe keeps to, read from its own source: a figure, or a few multiplied.
function probeConstant(file: string, name: string): number {
  const text: string = fs.readFileSync(path.join(PROBE_UTILS, file), "utf8");
  const at: number = text.indexOf(`const ${name}: number = `);

  expect(at).toBeGreaterThanOrEqual(0);

  const start: number = at + `const ${name}: number = `.length;

  return text
    .substring(start, text.indexOf(";", start))
    .split("_")
    .join("")
    .split("*")
    .reduce((product: number, figure: string): number => {
      return product * Number(figure);
    }, 1);
}

describe("the reference table", () => {
  it("says how often, from the settings", () => {
    expect(row("Collect every")).toContain(
      `${DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES} minutes`,
    );
    expect(row("Collect every")).toContain(
      `From ${MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES} to ${MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES} minutes`,
    );
  });

  it("says how many at once", () => {
    expect(row("Collections at once")).toContain(
      `${OPENSTACK_PROBE_COLLECTION_CONCURRENCY} per probe`,
    );
  });

  it("says how large", () => {
    const mebibytes: number =
      OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES / (1024 * 1024);

    expect(row("Largest collection")).toContain(`About ${mebibytes} MiB`);
    expect(PAGE).toContain(`About ${mebibytes} MiB of metrics per collection`);
  });

  it("says how long a test has", () => {
    expect(row("Connection test")).toContain(
      `${OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS} seconds to start`,
    );
    expect(row("Connection test")).toContain(
      `longer than ${OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS / 60} minutes`,
    );
    expect(MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT).toBe(5);
    expect(row("Connection test")).toContain("Five can wait or run at once");
  });

  it("says how many certificates a cloud can trust", () => {
    expect(PAGE).toContain(
      `you can trust up to ${MAX_OPENSTACK_TRUSTED_CERTIFICATES}`,
    );
  });
});

describe("what it says about load", () => {
  it("is what the probe does", () => {
    expect(
      probeConstant("OpenStackServiceClient.ts", "DEFAULT_OPENSTACK_PAGE_SIZE"),
    ).toBe(1000);
    expect(PAGE).toContain("a thousand rows at a time");

    expect(
      probeConstant(
        "OpenStackServiceClient.ts",
        "OPENSTACK_REQUEST_TIMEOUT_IN_MS",
      ),
    ).toBe(60_000);
    expect(row("Waiting for one answer")).toContain("60 seconds");

    expect(
      probeConstant("OpenStackBackoff.ts", "MAX_ATTEMPTS_PER_REQUEST"),
    ).toBe(3);
    expect(row("Waiting for one answer")).toContain("three times");

    expect(probeConstant("OpenStackBackoff.ts", "BACKOFF_BASE_IN_MS")).toBe(
      60_000,
    );
    expect(probeConstant("OpenStackBackoff.ts", "MAX_BACKOFF_IN_MS")).toBe(
      30 * 60_000,
    );
    expect(PAGE).toContain(
      "left alone for a minute, then two, then four, up to half an hour",
    );

    expect(
      probeConstant(
        "OpenStackBackoff.ts",
        "REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS",
      ),
    ).toBe(5 * 60_000);
    expect(
      probeConstant(
        "OpenStackBackoff.ts",
        "MAX_REFUSED_CREDENTIAL_BACKOFF_IN_MS",
      ),
    ).toBe(60 * 60_000);
    expect(PAGE).toContain("it waits five minutes, then ten, up to an hour");

    expect(
      probeConstant(
        "OpenStackInstanceReader.ts",
        "FULL_INSTANCE_READ_INTERVAL_IN_MS",
      ),
    ).toBe(30 * 60_000);
    expect(PAGE).toContain("every half hour");

    expect(
      probeConstant("OpenStackCollectorMemory.ts", "TOKEN_EXPIRY_MARGIN_IN_MS"),
    ).toBe(5 * 60_000);
    expect(PAGE).toContain("until five minutes before it expires");

    expect(
      probeConstant(
        "Collectors/PlacementCollector.ts",
        "PLACEMENT_READS_AT_ONCE",
      ),
    ).toBe(4);
    expect(row("Requests to each service")).toContain("four at a time");
  });
});

describe("the troubleshooting section", () => {
  const TITLES: Array<string> = PAGE.split("\n")
    .filter((line: string): boolean => {
      return line.startsWith(":::details ");
    })
    .map((line: string): string => {
      return line.substring(":::details ".length);
    });

  const ADVICE_TITLES: Array<string> =
    OpenStackCollectionErrorUtil.getAll().map(
      (code: OpenStackCollectionErrorCode): string => {
        return OpenStackCollectionErrorUtil.getAdvice(code).title;
      },
    );

  it("names each message as the product shows it", () => {
    expect(TITLES.length).toBeGreaterThan(0);

    for (const title of TITLES) {
      expect(ADVICE_TITLES).toContain(title);
    }
  });

  // What a person can do something about has its entry. The rest say it all themselves.
  it.each([
    OpenStackCollectionErrorCode.AddressNotAllowed,
    OpenStackCollectionErrorCode.ConnectionRefused,
    OpenStackCollectionErrorCode.ConnectionTimedOut,
    OpenStackCollectionErrorCode.TlsFailed,
    OpenStackCollectionErrorCode.UntrustedCertificate,
    OpenStackCollectionErrorCode.CertificateChanged,
    OpenStackCollectionErrorCode.InsecureEndpoint,
    OpenStackCollectionErrorCode.NotKeystone,
    OpenStackCollectionErrorCode.InvalidCredential,
    OpenStackCollectionErrorCode.WrongProjectScope,
    OpenStackCollectionErrorCode.RegionNotFound,
    OpenStackCollectionErrorCode.NoPermission,
    OpenStackCollectionErrorCode.KeystoneFailing,
    OpenStackCollectionErrorCode.ServiceOverloaded,
    OpenStackCollectionErrorCode.TimedOut,
    OpenStackCollectionErrorCode.PayloadTooLarge,
    OpenStackCollectionErrorCode.ProbeNotAvailable,
  ])("has an entry for %s", (code: OpenStackCollectionErrorCode) => {
    expect(TITLES).toContain(
      OpenStackCollectionErrorUtil.getAdvice(code).title,
    );
  });
});

describe("which to pick", () => {
  it("says the agent, for what a probe does not do", () => {
    const line: string | undefined = PAGE.split("\n").find((text: string) => {
      return text.startsWith("Pick the agent");
    });

    expect(line).toContain("payload cap");
    expect(line).toContain("service logs");
    expect(line).toContain("the AI agent");
    expect(line).toContain("plain HTTP");
  });

  it("warns that both at once sends everything twice", () => {
    expect(PAGE).toContain("every metric arrives twice");
  });
});
