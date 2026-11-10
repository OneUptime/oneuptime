import {
  CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER,
  getCrossplaneProviderVersion,
} from "../../../FeatureSet/Docs/Utils/Placeholders";
import { CROSSPLANE_OVERVIEW, MANAGING_RESOURCES } from "./CrossplaneDocsPages";
import { readPage, scanMarkdown } from "./DocsContentSupport";
import {
  MonitorStepsSchema,
  NestedAttribute,
  ProviderAttribute,
  ProviderSchema,
  ProviderType,
  monitorStepsValues,
  readMonitorStepsSchema,
  readProvider,
  readRepoFile,
} from "./TerraformDocsSupport";
import { beforeAll, describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * The Crossplane provider's English pages (issue #6587), held to what they
 * describe:
 *
 *   - the package: the registries and the tag each release publishes it
 *     under (release.yml, Scripts/CrossplaneProvider/publish-package.sh),
 *     its name (package/crossplane.yaml) and the identity cosign signs it
 *     with;
 *   - the API: the group and versions the provider registers its kinds and
 *     ProviderConfigs under, the kinds' names (internal/kinds), and every
 *     field the pages' manifests set, which must be an argument of the
 *     Terraform resource the kind is made from - references, the Secrets a
 *     reader gives and the ones OneUptime makes included;
 *   - the provider's behaviour the pages state: how often it checks a
 *     resource, the OneUptime it manages without a url, and the JSON
 *     credentials it reads.
 *
 * The Terraform resources are read as the Terraform provider's generator
 * makes them (TerraformDocsSupport.readProvider), and the Crossplane
 * provider's own facts from its static Go sources, which
 * Scripts/CrossplaneProvider's generator copies into the provider as they
 * are. CrossplaneDocsTranslations holds every translation to these pages.
 */

const CROSSPLANE_STATIC: string = "Scripts/CrossplaneProvider/StaticFiles";
const PROVIDER_CONFIG_GO: string = `${CROSSPLANE_STATIC}/config/provider.go`;
const V1BETA1_REGISTER_GO: string = `${CROSSPLANE_STATIC}/apis/v1beta1/register.go`;
const PROVIDER_CONFIG_TYPES_GO: string = `${CROSSPLANE_STATIC}/apis/v1beta1/types.go`;
const KINDS_TEST_GO: string = `${CROSSPLANE_STATIC}/internal/kinds/kinds_test.go`;
const CLIENTS_GO: string = `${CROSSPLANE_STATIC}/internal/clients/oneuptime.go`;
const MAIN_GO: string = `${CROSSPLANE_STATIC}/cmd/provider/main.go`;
const PACKAGE_META: string = `${CROSSPLANE_STATIC}/package/crossplane.yaml`;
const PUBLISH_SCRIPT: string = "Scripts/CrossplaneProvider/publish-package.sh";
const RELEASE_WORKFLOW: string = ".github/workflows/release.yml";
const PUBLISH_JOB: string = "publish-crossplane-provider";

const GHCR_REPOSITORY: string = "ghcr.io/oneuptime/provider-oneuptime";
const DOCKER_HUB_REPOSITORY: string = "docker.io/oneuptime/provider-oneuptime";
const PACKAGE_NAME: string = "provider-oneuptime";
const TERRAFORM_PREFIX: string = "oneuptime_";
// The kinds that configure the provider rather than stand for a record.
const PROVIDER_CONFIG_KINDS: ReadonlyArray<string> = [
  "ProviderConfig",
  "ClusterProviderConfig",
];

/*
 * The levels of a monitor's steps, by the field that holds a list of the
 * next one, as monitorsteps.go nests them under a step.
 */
const STEP_LEVELS: Readonly<Record<string, string>> = {
  criteria: "criteria",
  filters: "filter",
  incidents: "incident",
  alerts: "alert",
};

// The step attributes monitorsteps.go checks against a list of fixed values.
const STEP_VALUE_LISTS: Readonly<Record<string, string>> = {
  monitor_destination_type: "monitorStepsDestinationTypeValues",
  request_type: "monitorStepsRequestTypeValues",
  filter_condition: "monitorStepsFilterConditionValues",
  check_on: "monitorStepsCheckOnValues",
  filter_type: "monitorStepsFilterTypeValues",
};

/*
 * js-yaml from Common/node_modules, as the other docs facts suites load
 * it: Common declares js-yaml 4, App declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
  loadAll: (text: string) => Array<unknown>;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(__dirname, "../../../../Common/node_modules/js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

type YamlObject = Record<string, unknown>;

interface Manifest {
  page: string;
  // The code block's title, the file name the page gives it.
  file: string;
  document: YamlObject;
}

interface ReleaseJob {
  if?: string;
  permissions?: Record<string, string>;
  steps: Array<{ run?: string }>;
}

// `const ShortGroup = "crossplane"` and its like, in a Go const block.
function goConstant(source: string, name: string): string {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`, "m"),
  );

  if (!match) {
    throw new Error(`No Go constant ${name}`);
  }

  return match[1] as string;
}

/*
 * The Go fields a "+kubebuilder:default" marker sits on: the first line
 * after the marker's comment block, by the field's name.
 */
function defaultedFields(source: string): Array<string> {
  const lines: Array<string> = source.split("\n");
  const fields: Array<string> = [];

  lines.forEach((line: string, index: number): void => {
    if (!line.includes("+kubebuilder:default")) {
      return;
    }

    let next: number = index + 1;

    while ((lines[next] || "").trim().startsWith("//")) {
      next++;
    }

    fields.push((lines[next] || "").trim().split(/\s+/)[0] || "");
  });

  return fields;
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function bothPages(): string {
  return [CROSSPLANE_OVERVIEW, MANAGING_RESOURCES].map(englishPage).join("\n");
}

// Every Kubernetes object the pages' YAML blocks write, with its block's file.
function manifests(): Array<Manifest> {
  return [CROSSPLANE_OVERVIEW, MANAGING_RESOURCES].flatMap(
    (page: string): Array<Manifest> => {
      return scanMarkdown(englishPage(page))
        .fences.filter((fence: { lang: string }): boolean => {
          return fence.lang === "yaml";
        })
        .flatMap((fence: { info: string; code: string }): Array<Manifest> => {
          const file: string =
            (fence.info.match(/title="([^"]+)"/) || [])[1] || "";

          return jsYaml
            .loadAll(
              fence.code
                .split(CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER)
                .join("v14.0.56"),
            )
            .filter((document: unknown): boolean => {
              return Boolean(
                document && (document as YamlObject)["apiVersion"],
              );
            })
            .map((document: unknown): Manifest => {
              return { page, file, document: document as YamlObject };
            });
        });
    },
  );
}

// The managed resources the pages write: every object of the provider's group but its configs.
function managedResources(group: string): Array<Manifest> {
  return manifests().filter((manifest: Manifest): boolean => {
    const apiVersion: string = manifest.document["apiVersion"] as string;

    return (
      apiVersion.startsWith(`${group}/`) &&
      !PROVIDER_CONFIG_KINDS.includes(manifest.document["kind"] as string)
    );
  });
}

/*
 * A kind's name as the page says the provider makes it: the Terraform name
 * without its prefix, in CamelCase, with Definition added to a name that
 * ends in Spec, Status or List (internal/kinds.Of, which also writes
 * Upjet's acronyms in capitals: none of the kinds these pages name has one).
 */
function kindOf(terraformName: string): string {
  const kind: string = terraformName
    .replace(TERRAFORM_PREFIX, "")
    .split("_")
    .map((word: string): string => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");

  return ["Spec", "Status", "List"].some((ending: string): boolean => {
    return kind.endsWith(ending);
  })
    ? `${kind}Definition`
    : kind;
}

// A field of a manifest by its Terraform name: monitoringInterval to monitoring_interval.
function snakeCase(field: string): string {
  return field.replace(/[A-Z]/g, (letter: string): string => {
    return `_${letter.toLowerCase()}`;
  });
}

/*
 * The Terraform attribute a manifest's field sets, and how: labelsRefs and
 * labelsSelector refer to the resources whose IDs labels holds, and
 * tlsClientKeyPassphraseSecretRef names the Secret that holds
 * tls_client_key_passphrase.
 */
function attributeOfField(field: string): {
  attribute: string;
  by: "value" | "reference" | "secret";
} {
  if (field.endsWith("SecretRef")) {
    return {
      attribute: snakeCase(field.slice(0, -"SecretRef".length)),
      by: "secret",
    };
  }

  for (const suffix of ["Refs", "Ref", "Selector"]) {
    if (field.endsWith(suffix)) {
      return {
        attribute: snakeCase(field.slice(0, -suffix.length)),
        by: "reference",
      };
    }
  }

  return { attribute: snakeCase(field), by: "value" };
}

/*
 * monitorStepReferences in config/provider.go: the fields deep in a
 * monitor's steps that take a reference, by their path, and the resource
 * each refers to.
 */
function monitorStepReferences(): Map<string, string> {
  const source: string = readRepoFile(PROVIDER_CONFIG_GO);
  const block: string = source.slice(
    source.indexOf("var monitorStepReferences = map[string]string{"),
  );
  const body: string = block.slice(0, block.indexOf("\n}"));
  const references: Map<string, string> = new Map();

  for (const match of Array.from(
    body.matchAll(/^\s*"([a-z_.]+)":\s*"([a-z_]+)",$/gm),
  )) {
    references.set(match[1] as string, match[2] as string);
  }

  return references;
}

/*
 * The reference field Upjet makes for a Terraform attribute: a list of IDs
 * takes Refs (label_ids to labelIdsRefs), one ID takes Ref
 * (monitor_status_id to monitorStatusIdRef).
 */
function referenceField(attribute: string, isList: boolean): string {
  const camel: string = attribute.replace(
    /_([a-z])/g,
    (_match: string, letter: string): string => {
      return letter.toUpperCase();
    },
  );

  return isList ? `${camel}Refs` : `${camel}Ref`;
}

// The attribute a monitorStepReferences path names, in monitorsteps.go's schema.
function stepAttributeAt(reference: string): NestedAttribute {
  const segments: Array<string> = reference.split(".");
  const field: string = segments[segments.length - 1] as string;
  const parent: string = segments[segments.length - 2] as string;
  const level: keyof MonitorStepsSchema = STEP_LEVELS[
    parent
  ] as keyof MonitorStepsSchema;
  const attribute: NestedAttribute | undefined = (
    steps[level] as Map<string, NestedAttribute>
  ).get(field);

  if (!attribute) {
    throw new Error(`monitorsteps.go has no ${reference}`);
  }

  return attribute;
}

let provider: ProviderSchema;
let steps: MonitorStepsSchema;

beforeAll(async () => {
  provider = await readProvider();
  steps = readMonitorStepsSchema();
}, 120000);

function resource(terraformName: string): ProviderType {
  const found: ProviderType | undefined = provider.resources.get(
    terraformName.replace(TERRAFORM_PREFIX, ""),
  );

  if (!found) {
    throw new Error(`The Terraform provider has no ${terraformName}`);
  }

  return found;
}

// The Terraform resource of every kind the provider makes.
function terraformNameOfKind(kind: string): string {
  const names: Array<string> = Array.from(provider.resources.keys())
    .map((name: string): string => {
      return `${TERRAFORM_PREFIX}${name}`;
    })
    .filter((name: string): boolean => {
      return kindOf(name) === kind;
    });

  if (names.length !== 1) {
    throw new Error(`${kind} is the kind of ${names.length} resources`);
  }

  return names[0] as string;
}

/*
 * Every field a manifest sets under forProvider that its Terraform resource
 * does not take as written: an argument it does not have or cannot set, a
 * reference to an attribute that refers to nothing, a value outside the
 * attribute's enum. A monitor's steps are walked level by level, as
 * monitorsteps.go nests them.
 */
function fieldProblems(
  where: string,
  fields: YamlObject,
  type: ProviderType,
): Array<string> {
  const problems: Array<string> = [];

  for (const [field, value] of Object.entries(fields)) {
    const { attribute, by } = attributeOfField(field);
    const found: ProviderAttribute | undefined = type.attributes.get(attribute);

    if (!found || !found.settable) {
      problems.push(`${where}.${field}: no argument ${attribute}`);
      continue;
    }

    if (by === "reference" && !found.relation) {
      problems.push(`${where}.${field}: ${attribute} refers to nothing`);
    }

    if (
      by === "value" &&
      found.enumValues.length > 0 &&
      !found.enumValues.includes(String(value))
    ) {
      problems.push(`${where}.${field}: ${String(value)} is no value of it`);
    }

    if (attribute === "monitor_steps") {
      for (const step of value as Array<YamlObject>) {
        problems.push(...stepProblems(`${where}.${field}`, step));
      }
    }
  }

  return problems;
}

// A monitor step's fields, and their nested criteria, filters, incidents and alerts.
function stepProblems(
  where: string,
  fields: YamlObject,
  level: keyof MonitorStepsSchema = "step",
): Array<string> {
  const problems: Array<string> = [];
  const attributes: Map<string, NestedAttribute> = steps[level] as Map<
    string,
    NestedAttribute
  >;
  const references: Map<string, string> = monitorStepReferences();

  for (const [field, value] of Object.entries(fields)) {
    const { attribute, by } = attributeOfField(field);
    const found: NestedAttribute | undefined = attributes.get(attribute);

    if (!found) {
      problems.push(`${where}.${field}: no ${level} attribute ${attribute}`);
      continue;
    }

    if (
      by === "reference" &&
      !Array.from(references.keys()).some((reference: string): boolean => {
        return reference.endsWith(`.${attribute}`);
      })
    ) {
      problems.push(`${where}.${field}: no reference for ${attribute}`);
    }

    if (by === "secret" && !found.sensitive) {
      problems.push(`${where}.${field}: ${attribute} is not a secret`);
    }

    const list: string | undefined = STEP_VALUE_LISTS[attribute];

    if (list && !monitorStepsValues(list).includes(String(value))) {
      problems.push(`${where}.${field}: ${String(value)} is not in ${list}`);
    }

    const nested: keyof MonitorStepsSchema | undefined = STEP_LEVELS[field] as
      | keyof MonitorStepsSchema
      | undefined;

    if (nested) {
      for (const item of value as Array<YamlObject>) {
        problems.push(...stepProblems(`${where}.${field}`, item, nested));
      }
    }
  }

  return problems;
}

describe("the package the pages install", () => {
  const release: { jobs: Record<string, ReleaseJob> } = jsYaml.load(
    readRepoFile(RELEASE_WORKFLOW),
  ) as { jobs: Record<string, ReleaseJob> };
  const job: ReleaseJob = release.jobs[PUBLISH_JOB] as ReleaseJob;
  const publishRun: string = job.steps
    .map((step: { run?: string }): string => {
      return step.run || "";
    })
    .join("\n");

  it("is published by every release, to the two repositories the pages name, and to no other", () => {
    expect(job.if).toBe("github.ref == 'refs/heads/release'");
    expect(publishRun).toContain(`--repository ${GHCR_REPOSITORY}`);
    expect(publishRun).toContain(`--repository ${DOCKER_HUB_REPOSITORY}`);
    expect(
      Array.from(publishRun.matchAll(/--repository (\S+)/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual([GHCR_REPOSITORY, DOCKER_HUB_REPOSITORY]);

    expect(englishPage(CROSSPLANE_OVERVIEW)).toContain(
      `package: ${GHCR_REPOSITORY}:${CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER}`,
    );
    expect(englishPage(CROSSPLANE_OVERVIEW)).toContain(
      `\`${DOCKER_HUB_REPOSITORY}\``,
    );

    // Every package the pages name is one of the two.
    for (const match of Array.from(
      bothPages().matchAll(/(\S*)\/provider-oneuptime\b/g),
    )) {
      expect([GHCR_REPOSITORY, DOCKER_HUB_REPOSITORY]).toContain(
        `${(match[1] as string).replace(/^`/, "")}/provider-oneuptime`,
      );
    }
  });

  it("is tagged v and the release's version, the tag the pages fill in", () => {
    // The release builds and publishes the version every image of it carries.
    expect(publishRun).toContain(
      '--version "${{needs.read-version.outputs.major_minor}}"',
    );
    expect(readRepoFile(PUBLISH_SCRIPT)).toContain(
      'ref="${repository}:v${VERSION}"',
    );
    expect(getCrossplaneProviderVersion("14.0.56")).toBe("v14.0.56");
  });

  it("is signed keyless by release.yml on the release branch, the identity the page's cosign verify asks for", () => {
    const page: string = englishPage(MANAGING_RESOURCES);

    expect(publishRun).toMatch(/publish-package\.sh[\s\S]*--sign/);
    expect(job.permissions?.["id-token"]).toBe("write");
    expect(page).toContain(
      `cosign verify ${GHCR_REPOSITORY}:${CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER}`,
    );
    expect(page).toContain(
      `--certificate-identity https://github.com/OneUptime/oneuptime/${RELEASE_WORKFLOW}@refs/heads/release`,
    );
    expect(page).toContain(
      "--certificate-oidc-issuer https://token.actions.githubusercontent.com",
    );
    // The repository the identity names is the one the package says it is made in.
    expect(readRepoFile(PACKAGE_META)).toContain(
      "meta.crossplane.io/source: github.com/OneUptime/oneuptime",
    );
  });

  it("is the provider package/crossplane.yaml makes, under the name the pages give it", () => {
    const meta: { metadata: { name: string } } = jsYaml.load(
      readRepoFile(PACKAGE_META),
    ) as { metadata: { name: string } };
    const providers: Array<Manifest> = manifests().filter(
      (manifest: Manifest): boolean => {
        return manifest.document["kind"] === "Provider";
      },
    );

    expect(meta.metadata.name).toBe(PACKAGE_NAME);
    // The overview installs it, and the runtime config is given to it.
    expect(providers).toHaveLength(2);

    for (const manifest of providers) {
      expect(manifest.document["apiVersion"]).toBe("pkg.crossplane.io/v1");
      expect((manifest.document["metadata"] as YamlObject)["name"]).toBe(
        PACKAGE_NAME,
      );
    }

    // Crossplane labels the provider's pods with the package's name.
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      `-l pkg.crossplane.io/provider=${PACKAGE_NAME}`,
    );
    expect(readRepoFile(PACKAGE_META)).toContain(
      "https://oneuptime.com/docs/crossplane/index",
    );
  });
});

describe("the API the pages write", () => {
  const providerGo: string = readRepoFile(PROVIDER_CONFIG_GO);
  const group: string = `${goConstant(providerGo, "ShortGroup")}.${goConstant(
    providerGo,
    "RootGroup",
  )}`;

  it("names the group and versions the provider registers its kinds and configs under", () => {
    const registerGo: string = readRepoFile(V1BETA1_REGISTER_GO);

    expect(group).toBe("crossplane.oneuptime.com");
    expect(goConstant(registerGo, "Group")).toBe(group);

    const configVersion: string = `${group}/${goConstant(registerGo, "Version")}`;
    const resourceVersion: string = `${group}/${goConstant(providerGo, "Version")}`;
    const ofTheGroup: Array<Manifest> = manifests().filter(
      (manifest: Manifest): boolean => {
        return (manifest.document["apiVersion"] as string).startsWith(
          `${group}/`,
        );
      },
    );

    expect(ofTheGroup.length).toBeGreaterThan(5);

    for (const manifest of ofTheGroup) {
      expect({
        kind: manifest.document["kind"],
        apiVersion: manifest.document["apiVersion"],
      }).toEqual({
        kind: manifest.document["kind"],
        apiVersion: PROVIDER_CONFIG_KINDS.includes(
          manifest.document["kind"] as string,
        )
          ? configVersion
          : resourceVersion,
      });
    }

    expect(englishPage(MANAGING_RESOURCES)).toContain(
      `--api-version=${resourceVersion}`,
    );
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      `kubectl api-resources --api-group=${group}`,
    );
  });

  it("names each kind after its Terraform resource, as the page says kinds are named", () => {
    const rows: Array<RegExpMatchArray> = Array.from(
      englishPage(MANAGING_RESOURCES).matchAll(
        /^\| `([A-Za-z]+)` \| [^|]+ \| `(oneuptime_[a-z_]+)` \|$/gm,
      ),
    );

    expect(rows.length).toBeGreaterThanOrEqual(8);

    for (const row of rows) {
      const kind: string = row[1] as string;
      const terraformName: string = row[2] as string;

      expect(resource(terraformName).name).toBe(
        terraformName.replace(TERRAFORM_PREFIX, ""),
      );
      expect({ terraformName, kind: kindOf(terraformName) }).toEqual({
        terraformName,
        kind,
      });
    }
  });

  it("gives the naming examples internal/kinds' own test pins", () => {
    const kindsTest: string = readRepoFile(KINDS_TEST_GO);
    const page: string = englishPage(MANAGING_RESOURCES);

    for (const [terraformName, kind] of [
      ["oneuptime_status_page", "StatusPage"],
      ["oneuptime_monitor_status", "MonitorStatusDefinition"],
    ]) {
      expect(page).toContain(
        `\`${terraformName as string}\` is \`${kind as string}\``,
      );
      expect(kindsTest).toMatch(
        new RegExp(`"${terraformName as string}":\\s+"${kind as string}"`),
      );
    }

    expect(page).toContain("`oneuptime_on_call_policy` is `OnCallPolicy`");
    expect(kindOf("oneuptime_on_call_policy")).toBe("OnCallPolicy");
  });

  it("writes only kinds the provider makes, each with fields its Terraform resource takes", () => {
    const resources: Array<Manifest> = managedResources(group);
    const problems: Array<string> = [];

    expect(
      Array.from(
        new Set(
          resources.map((manifest: Manifest): string => {
            return manifest.document["kind"] as string;
          }),
        ),
      ).sort(),
    ).toEqual([
      "Label",
      "Monitor",
      "MonitorStatusDefinition",
      "Team",
      "TelemetryIngestionKey",
    ]);

    for (const manifest of resources) {
      const kind: string = manifest.document["kind"] as string;
      const spec: YamlObject = manifest.document["spec"] as YamlObject;
      const type: ProviderType = resource(terraformNameOfKind(kind));

      problems.push(
        ...fieldProblems(
          `${manifest.file} ${kind}.spec.forProvider`,
          (spec["forProvider"] as YamlObject) || {},
          type,
        ),
      );
    }

    expect(problems).toEqual([]);
  });

  it("names its fields in camelCase under forProvider, as the page's example says", () => {
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      "`monitoring_interval` is `monitoringInterval`",
    );
    expect(
      resource("oneuptime_monitor").attributes.has("monitoring_interval"),
    ).toBe(true);
  });

  it("lists the references a monitor's steps take, as the provider configures them", () => {
    const listed: Array<string> = (
      englishPage(MANAGING_RESOURCES)
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("References reach into a monitor's steps");
        }) as string
    )
      .match(/`[a-zA-Z]+Refs?`/g)!
      .map((code: string): string => {
        return code.slice(1, -1);
      });
    const configured: Array<string> = Array.from(
      monitorStepReferences().keys(),
    ).map((reference: string): string => {
      return referenceField(
        reference.split(".").pop() as string,
        stepAttributeAt(reference).kind === "List",
      );
    });

    expect(new Set(listed)).toEqual(new Set(configured));

    // And each refers to a resource the Terraform provider has.
    for (const target of Array.from(monitorStepReferences().values())) {
      expect(resource(target).name).toBe(target.replace(TERRAFORM_PREFIX, ""));
    }
  });

  it("refers to labels from a monitor, as the generated references let it", () => {
    const labels: ProviderAttribute = resource(
      "oneuptime_monitor",
    ).attributes.get("labels") as ProviderAttribute;

    expect(labels.relation).toBe("label");
    expect(labels.settable).toBe(true);
    expect(["list", "set"]).toContain(labels.type);
    expect(referenceField("labels", true)).toBe("labelsRefs");
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      "takes `labelsRefs` and `labelsSelector`",
    );
  });

  it("writes a secret OneUptime makes to the connection Secret, under attribute. and its Terraform name", () => {
    const secretKey: ProviderAttribute | undefined = resource(
      "oneuptime_telemetry_ingestion_key",
    ).attributes.get("secret_key");

    expect(secretKey?.sensitive).toBe(true);
    // OneUptime makes it: a manifest cannot set it.
    expect(secretKey?.settable).toBe(false);
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      "{.data.attribute\\.secret_key}",
    );
  });

  it("takes a Secret for a secret the reader gives, such as a step's TLS client key passphrase", () => {
    const passphrase: NestedAttribute | undefined = steps.step.get(
      "tls_client_key_passphrase",
    );

    expect(passphrase?.sensitive).toBe(true);
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      "`tlsClientKeyPassphraseSecretRef`",
    );
  });

  it("names a person by user ID, or by email address where a kind takes one", () => {
    const member: ProviderType = resource("oneuptime_team_member");

    expect(member.attributes.has("user_id")).toBe(true);
    expect(member.attributes.get("user_email")?.settable).toBe(true);
    expect(steps.incident.has("owner_user_ids")).toBe(true);
    // No kind stands for a person.
    expect(provider.resources.has("user")).toBe(false);
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      "as `TeamMember` does in `userEmail`",
    );
    expect(kindOf("oneuptime_team_member")).toBe("TeamMember");
  });
});

describe("what the pages say the provider does", () => {
  it("checks every resource against its record every 10 minutes, unless --poll says otherwise", () => {
    expect(readRepoFile(MAIN_GO)).toMatch(
      /app\.Flag\("poll", "[^"]*"\)\.Default\("10m"\)/,
    );
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      "against its record every 10 minutes",
    );
    expect(englishPage(MANAGING_RESOURCES)).toContain("- --poll=1m");
  });

  it("manages OneUptime Cloud without a url, and reads api_key and oneuptime_url from JSON credentials", () => {
    const clients: string = readRepoFile(CLIENTS_GO);
    const types: string = readRepoFile(PROVIDER_CONFIG_TYPES_GO);
    const overview: string = englishPage(CROSSPLANE_OVERVIEW);

    expect(clients).toContain('DefaultURL = "https://oneuptime.com"');
    expect(clients).toMatch(/firstOf\(values, "api_key"/);
    expect(clients).toMatch(/firstOf\(values, "oneuptime_url"/);
    expect(overview).toContain(
      '`{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`',
    );

    // Neither config defaults its url, so JSON credentials can name one.
    expect(
      types.match(/^\s*URL string `json:"url,omitempty"`$/gm),
    ).toHaveLength(2);
    expect(defaultedFields(types)).not.toContain("URL");
  });

  it("reads a ClusterProviderConfig's key from a Secret, the environment or a file, as Crossplane's credential sources do", () => {
    const clients: string = readRepoFile(CLIENTS_GO);
    const overview: string = englishPage(CROSSPLANE_OVERVIEW);

    expect(clients).toContain("resource.CommonCredentialExtractor(");
    expect(overview).toContain("`source: Environment` or `source: Filesystem`");
    expect(overview).toContain("source: Secret");
  });

  it("names the statuses the overview observes as a new project has them", () => {
    const overview: string = englishPage(CROSSPLANE_OVERVIEW);

    expect(overview).toContain(
      "`oneuptime monitor-status list --fields _id,name`",
    );
    expect(overview).toContain("**Offline** and **Operational** statuses");
    expect(monitorStepsValues("monitorStepsCheckOnValues")).toContain(
      "Is Online",
    );
  });
});

describe("the version the pages fill in", () => {
  it("is the tag of the release serving the page", () => {
    expect(getCrossplaneProviderVersion("14.0.56")).toBe("v14.0.56");
    expect(getCrossplaneProviderVersion("v14.0.56")).toBe("v14.0.56");
    expect(getCrossplaneProviderVersion(" 14.0.56\n")).toBe("v14.0.56");
  });

  it("is the tag's form for a build that is no release", () => {
    expect(getCrossplaneProviderVersion("1.0.0")).toBe("v<version>");
    expect(getCrossplaneProviderVersion(null)).toBe("v<version>");
    expect(getCrossplaneProviderVersion("14.0")).toBe("v<version>");
    expect(getCrossplaneProviderVersion("14.0.56-rc.1")).toBe("v<version>");
  });
});
