import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
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
  OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
  OPENSTACK_INSTANCE_ACTION_READS_PER_COLLECTION,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
} from "Common/Types/OpenStack/OpenStackScale";
import {
  TerraformAttributeDescriptor,
  getTerraformAttributes,
  getTerraformTypeName,
} from "Common/Utils/DeveloperDocs/TerraformSchema";
import {
  DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_TRUSTED_CERTIFICATES,
  MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
} from "Common/Utils/OpenStack/OpenStackCollectionSettings";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { OPENSTACK_COLLECTION_OVERDUE_AFTER_IN_MS } from "../../../FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProbeCollectionView";

/*
 * telemetry/openstack-agentless.md, in English for now, against the product: the limits the
 * probe keeps to, the messages a failure shows and what it tells a person to click. Markdown
 * is not compiled, so this reads the page, the constants the probe and the server use and the
 * Dashboard's own files: a limit changed, a message reworded or a button renamed fails here,
 * instead of leaving the page describing a product that is no longer there.
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

    expect(row("Largest upload")).toContain(`${mebibytes} MiB`);
    expect(row("Largest cloud")).toContain(`uploads of ${mebibytes} MiB`);
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

describe("what it tells a person to click", () => {
  const DASHBOARD: string = path.resolve(
    __dirname,
    "../../../FeatureSet/Dashboard/src",
  );

  function dashboardFile(file: string): string {
    return fs.readFileSync(path.join(DASHBOARD, file), "utf8");
  }

  const CLOUDS_LIST: string = dashboardFile("Pages/OpenStack/Clouds.tsx");
  const TEST_PANEL: string = dashboardFile(
    "Components/OpenStack/OpenStackConnectionTestPanel.tsx",
  );
  const FORM: string = dashboardFile(
    "Components/OpenStack/OpenStackConnectionFormModal.tsx",
  );
  const SETTINGS_CARD: string = dashboardFile(
    "Components/OpenStack/OpenStackDataCollectionCard.tsx",
  );
  const OVERVIEW_CARD: string = dashboardFile(
    "Components/OpenStack/OpenStackCollectionStatusCard.tsx",
  );
  const VIEW: string = dashboardFile(
    "Components/OpenStack/OpenStackProbeCollectionView.ts",
  );
  const OPTIONS: string = dashboardFile(
    "Components/OpenStack/OpenStackConnectionFields.tsx",
  );

  it.each([
    ["Connect Cloud", CLOUDS_LIST],
    ["Connect Cloud", FORM],
    ["Test connection", TEST_PANEL],
    ["Trust this certificate", TEST_PANEL],
    ["Collect With a Probe", SETTINGS_CARD],
    ["Use the OpenStack Agent", SETTINGS_CARD],
    ["Edit Connection", SETTINGS_CARD],
  ])("**%s** is a button the page has", (button: string, source: string) => {
    expect(PAGE).toContain(`**${button}**`);
    expect(source).toContain(`"${button}"`);
  });

  it("says the Data Collection card is on the cloud's Overview and its Settings page", () => {
    expect(PAGE).toContain("**Data Collection**");
    expect(OVERVIEW_CARD).toContain('title="Data Collection"');
    expect(SETTINGS_CARD).toContain('title="Data Collection"');
    expect(dashboardFile("Pages/OpenStack/View/Index.tsx")).toContain(
      "<OpenStackCollectionStatusCard modelId={modelId} />",
    );
    expect(dashboardFile("Pages/OpenStack/View/Settings.tsx")).toContain(
      "<OpenStackDataCollectionCard modelId={modelId} />",
    );
  });

  it("reads the card's words as the card says them", () => {
    for (const word of ["Checking", "Collecting"]) {
      expect(PAGE).toContain(`**${word}**`);
      expect(VIEW).toContain(`"${word}"`);
    }
  });

  it("names each option as the card does, with what it costs", () => {
    expect(row("Project limits")).toContain("Four calls per project");
    expect(OPTIONS).toContain('translateText("Project limits")');
    expect(OPTIONS).toContain("Costs four API calls per project");

    expect(row("Ports")).toContain(
      "An unscoped list of ports can saturate Neutron on a large cloud",
    );
    expect(OPTIONS).toContain('translateText("Ports")');
    expect(OPTIONS).toContain(
      "An unscoped list of ports can saturate Neutron on a large cloud",
    );
  });
});

describe("plain HTTP", () => {
  it("is said up front: a probe never sends a credential over it", () => {
    const callout: number = PAGE.indexOf(
      "A probe only speaks HTTPS to a cloud.",
    );

    expect(callout).toBeGreaterThanOrEqual(0);
    // Before the first section, so nobody gets as far as a credential first.
    expect(callout).toBeLessThan(PAGE.indexOf("\n## "));
    expect(PAGE).toContain(
      "A credential or its token is never sent over plain HTTP",
    );
    expect(PAGE).toContain("turn on TLS for its APIs");
    expect(PAGE).toContain("The connection test says so");
  });

  it("is refused in the words the page says", () => {
    expect(
      OpenStackCollectionErrorUtil.getAdvice(
        OpenStackCollectionErrorCode.InsecureEndpoint,
      ).nextStep,
    ).toContain("Turn on TLS");
    expect(
      OpenStackCollectionErrorUtil.getAdvice(
        OpenStackCollectionErrorCode.InsecureEndpoint,
      ).nextStep,
    ).toContain("use the OpenStack agent");
  });
});

describe("from the API and Terraform", () => {
  const ATTRIBUTES: Array<TerraformAttributeDescriptor> =
    getTerraformAttributes(OpenStackCloud);

  function attribute(name: string): TerraformAttributeDescriptor | undefined {
    return ATTRIBUTES.find(
      (descriptor: TerraformAttributeDescriptor): boolean => {
        return descriptor.attributeName === name;
      },
    );
  }

  const EXAMPLE: string = PAGE.split("```hcl")[1]?.split("```")[0] || "";

  it("names the resource as the provider does, and links its page in the API reference", () => {
    expect(EXAMPLE).toContain(
      `resource "${getTerraformTypeName(OpenStackCloud)}"`,
    );
    expect(PAGE).toContain(
      `(/reference/${new OpenStackCloud().getAPIDocumentationPath()})`,
    );
    expect(PAGE).toContain(
      `/api${new OpenStackCloud().crudApiPath?.toString()}`,
    );
  });

  it("sets only what a configuration can set, and every attribute it names exists", () => {
    const names: Array<string> = Array.from(
      EXAMPLE.matchAll(/^\s*([a-z_]+)\s*=/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(names.length).toBeGreaterThan(5);

    for (const name of names) {
      expect({
        name,
        isWritable: Boolean(
          attribute(name)?.inCreateSchema && attribute(name)?.inUpdateSchema,
        ),
      }).toEqual({ name, isWritable: true });
    }
  });

  it("names, in words, only attributes that exist, and what the probe reports as what it is", () => {
    const section: string =
      PAGE.split("## Connect a cloud from the API or Terraform")[1]?.split(
        "\n## ",
      )[0] || "";
    const words: Array<string> = Array.from(
      section
        .split("```hcl")[0]!
        .concat(section.split("```")[2] || "")
        .matchAll(/`([a-z]+(?:_[a-z0-9]+)+)`/g),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1] as string;
      })
      .filter((word: string): boolean => {
        return word !== "oneuptime_openstack_cloud";
      });

    // A configuration reads these, and getTerraformAttributes only lists what it can set.
    const REPORTED: Record<string, string> = {
      collection_status: "collectionStatus",
      collection_error: "collectionError",
      presented_certificate: "presentedCertificate",
    };

    expect(words).toEqual(
      expect.arrayContaining([
        "credential_secret",
        "keystone_username",
        "project_name",
        ...Object.keys(REPORTED),
      ]),
    );

    for (const word of words) {
      if (REPORTED[word]) {
        continue;
      }

      expect({ word, isAttribute: Boolean(attribute(word)) }).toEqual({
        word,
        isAttribute: true,
      });
    }

    for (const word of Object.keys(REPORTED)) {
      const access: ReturnType<OpenStackCloud["getColumnAccessControlFor"]> =
        new OpenStackCloud().getColumnAccessControlFor(
          REPORTED[word] as string,
        );

      expect({
        word,
        create: access?.create,
        update: access?.update,
        isRead: (access?.read?.length || 0) > 0,
      }).toEqual({ word, create: [], update: [], isRead: true });
    }

    expect(attribute("credential_secret")?.readPermissions).toEqual([]);
  });
});

describe("what it says about how a collection stands", () => {
  it("says when a probe that stopped coming is said to have, from the page's own line", () => {
    const minutes: number = OPENSTACK_COLLECTION_OVERDUE_AFTER_IN_MS / 60_000;

    expect(PAGE).toContain(
      `If no probe comes for the cloud for ${minutes} minutes`,
    );
    expect(PAGE).toContain(`once a collection is ${minutes} minutes overdue`);
    expect(PAGE).toContain("**Not collecting**");
  });

  it("says where a large cloud starts keeping less", () => {
    expect(PAGE).toContain(
      `Past ${OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT.toLocaleString("en-US")} instances`,
    );
  });

  it("says how many instances' histories one collection reads", () => {
    expect(OPENSTACK_INSTANCE_ACTION_READS_PER_COLLECTION).toBe(25);
    expect(PAGE).toContain("at most 25 are read in a collection");
  });

  it("says how many flavors Placement is asked about", () => {
    expect(PAGE).toContain(
      `Placement takes at most ${OPENSTACK_CANDIDATE_READS_PER_COLLECTION} more`,
    );
  });
});

describe("which to pick", () => {
  it("says the agent, for what a probe does not do", () => {
    const line: string | undefined = PAGE.split("\n").find((text: string) => {
      return text.startsWith("Pick the agent");
    });

    expect(line).toContain("read from its databases");
    expect(line).toContain("service logs");
    expect(line).toContain("the AI agent");
    expect(line).toContain("what the cloud stands on");
    expect(line).toContain("each instance's real usage");
    expect(line).toContain("plain HTTP");
  });

  it("warns that both at once sends everything twice", () => {
    expect(PAGE).toContain("every metric arrives twice");
  });
});
