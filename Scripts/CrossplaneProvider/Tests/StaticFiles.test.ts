import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  listFiles,
  STATIC_FILES_DIR,
} from "../Core/CrossplaneProviderGenerator";
import { renderReferencesGo } from "../Core/References";
import { renderServerOwnedGo } from "../Core/ServerOwned";

const read: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(STATIC_FILES_DIR, file), "utf-8");
};

// A Go file's package clause.
const PACKAGE_CLAUSE: RegExp = /^package (\w+)$/m;

const REPO_ROOT: string = path.resolve(__dirname, "../../..");

const goFiles: Array<string> = listFiles(STATIC_FILES_DIR).filter(
  (file: string): boolean => {
    return file.endsWith(".go");
  },
);

/*
 * The Go fields a "+kubebuilder:default" marker sits on: the first line
 * after the marker's comment block, by the field's name.
 */
const defaultedFields: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
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
};

describe("the provider's hand-written Go", () => {
  test("has the commands, the configuration, the clients and their tests", () => {
    expect(goFiles).toEqual(
      expect.arrayContaining([
        "cmd/provider/main.go",
        "cmd/generator/main.go",
        "cmd/schema/main.go",
        "config/provider.go",
        "config/provider_test.go",
        "apis/v1beta1/types.go",
        "apis/v1beta1/crds_test.go",
        "internal/clients/oneuptime.go",
        "internal/clients/oneuptime_test.go",
        "internal/kinds/kinds_test.go",
        "internal/schemadump/describe_test.go",
      ]),
    );
  });

  test.each(goFiles)("%s is in the package of its folder", (file: string) => {
    const pkg: string | undefined = PACKAGE_CLAUSE.exec(read(file))?.[1];
    const folder: string = path.basename(path.dirname(file));
    expect(pkg).toBe(file.startsWith("cmd/") ? "main" : folder);
  });

  test.each(goFiles)(
    "%s reaches the Terraform provider through xpprovider only",
    (file: string) => {
      expect(read(file)).not.toContain(
        "terraform-provider-oneuptime/internal/",
      );
    },
  );

  test("config reads the references the generator writes", () => {
    expect(renderReferencesGo({})).toContain("var generatedReferences =");
    expect(read("config/provider.go")).toContain("range generatedReferences");
  });

  test("config reads the fields OneUptime keeps that the generator writes", () => {
    expect(renderServerOwnedGo({})).toContain("var generatedServerOwned =");
    expect(read("config/lateinit.go")).toContain(
      "range generatedServerOwned[terraformName]",
    );
  });

  /*
   * #9985: what late initialization and spec.initProvider leave to
   * OneUptime, a create that records the external name itself, and the
   * external name of a resource an older provider created, from its status.
   */
  test("every resource's defaults configure late initialization, spec.initProvider, creates in the reconcile and the external name", () => {
    const provider: string = read("config/provider.go");
    for (const line of [
      "r.UseAsync = false",
      "lateInitialization(r)",
      "r.TerraformConfigurationInjector = initProviderAtCreateOnly(r)",
      "r.ExternalName.SetIdentifierArgumentFn = identifyByExternalName",
      "r.InitializerFns = append(r.InitializerFns, NewExternalNameFromStatus)",
    ]) {
      expect([line, provider.includes(line)]).toEqual([line, true]);
    }
    expect(goFiles).toEqual(
      expect.arrayContaining([
        "config/lateinit.go",
        "config/lateinit_test.go",
        "config/serverowned_test.go",
        "config/fakeapi_test.go",
        "config/externalname.go",
        "config/externalname_test.go",
      ]),
    );
  });

  /*
   * #10144: controller-gen names a CRD, and the file it writes it to, by the
   * kind's plural, and wrote OnCallScheduleLayers' CRD over
   * OnCallScheduleLayer's, whose plural was the same. internal/kinds gives
   * OnCallScheduleLayer a plural of its own, as Upjet's Resource.Path; the
   * generator stops before it writes anything when two kinds' CRDs would
   * still share a name; and config/crds_test.go holds the configuration and
   * the package's CRDs to one CRD for each kind.
   */
  test("gives every kind a CRD of its own", () => {
    expect(read("config/provider.go")).toContain("r.Path = kinds.Path(r.Kind)");
    expect(read("internal/kinds/kinds.go")).toMatch(
      /^\t"OnCallScheduleLayer": "oncallschedulelayerdefinitions",$/m,
    );

    const generator: string = read("cmd/generator/main.go");
    const check: number = generator.indexOf("kinds.Clashes(config.CRDs(pc))");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(generator.indexOf("runner.Run(pc)"));

    expect(goFiles).toEqual(
      expect.arrayContaining([
        "config/crds_test.go",
        "internal/kinds/kinds_test.go",
      ]),
    );
  });
});

describe("the ProviderConfig", () => {
  const types: string = read("apis/v1beta1/types.go");

  /*
   * A namespace's ProviderConfig names its Secret by name: one that named a
   * namespace would let anyone who may create a ProviderConfig in theirs
   * read the API key of any other namespace through the provider.
   */
  test("a namespaced one reads a Secret of its own namespace only", () => {
    const credentials: string = types.substring(
      types.indexOf("type ProviderCredentials struct"),
      types.indexOf("type ClusterProviderConfigSpec struct"),
    );
    expect(credentials).toContain(
      'SecretRef xpv2.LocalSecretKeySelector `json:"secretRef"`',
    );
    expect(credentials).not.toContain("CommonCredentialSelectors");
    expect(credentials).toContain("+kubebuilder:validation:Enum=Secret\n");
  });

  test("a cluster one may read a Secret of any namespace, the environment or a file", () => {
    const credentials: string = types.substring(
      types.indexOf("type ClusterProviderCredentials struct"),
    );
    expect(credentials).toContain(
      "+kubebuilder:validation:Enum=Secret;Environment;Filesystem",
    );
    expect(credentials).toContain("xpv2.CommonCredentialSelectors");
  });

  /*
   * The API server fills a default in before the provider reads the object,
   * so a default url would win over the oneuptime_url of JSON credentials: a
   * self-hosted OneUptime named only there would get OneUptime Cloud. The
   * clients fall back to Cloud themselves (apis/v1beta1/crds_test.go and
   * internal/clients/oneuptime_test.go hold both ends).
   */
  test("neither defaults its url, so JSON credentials can name one", () => {
    // Both have one, and only a ProviderConfig's source (a Secret) has a default.
    expect(
      types.match(/^\s*URL string `json:"url,omitempty"`$/gm),
    ).toHaveLength(2);
    expect(defaultedFields(types)).toEqual(["Source"]);
    expect(read("internal/clients/oneuptime.go")).toContain(
      'DefaultURL = "https://oneuptime.com"',
    );
  });

  test("finds the field a default marker sits on, past the rest of its comment", () => {
    expect(
      defaultedFields(
        [
          "\t// The address.",
          "\t// +kubebuilder:default=https://oneuptime.com",
          "\t// +optional",
          '\tURL string `json:"url,omitempty"`',
        ].join("\n"),
      ),
    ).toEqual(["URL"]);
  });

  test("the clients read the namespaced Secret in the ProviderConfig's namespace", () => {
    expect(read("internal/clients/oneuptime.go")).toContain(
      "ref.ToSecretKeySelector(pc.GetNamespace())",
    );
  });
});

describe("the package", () => {
  const meta: string = read("package/crossplane.yaml");

  test("is the provider-oneuptime Provider, able to start with only the kinds a policy activates", () => {
    expect(meta).toContain("kind: Provider\n");
    expect(meta).toContain("  name: provider-oneuptime\n");
    expect(meta).toMatch(/capabilities:\n\s+- SafeStart\n/);
  });

  test("says where its source and docs are", () => {
    expect(meta).toContain(
      "meta.crossplane.io/source: github.com/OneUptime/oneuptime",
    );
    expect(meta).toContain("https://oneuptime.com/docs/crossplane");
  });

  // What a package catalog, such as the Upbound Marketplace, lists (#6618).
  test("has the name and the icon a catalog lists it by", () => {
    expect(meta).toContain(
      "\n    friendly-name.meta.crossplane.io: Provider OneUptime\n",
    );

    // The icon the Helm charts show, at the address they show it from.
    const iconLine: RegExp = /^icon: (\S+)$/m;
    const chartIcon: string | undefined = iconLine.exec(
      fs.readFileSync(
        path.join(REPO_ROOT, "HelmChart", "Public", "oneuptime", "Chart.yaml"),
        "utf-8",
      ),
    )?.[1];

    expect(chartIcon).toMatch(/^https:\/\/oneuptime\.com\/.+\.png$/);
    expect(meta).toContain(`\n    meta.crossplane.io/iconURI: ${chartIcon}\n`);
  });

  test("runs as a user that is not root, on an image with nothing else in it", () => {
    const dockerfile: string = read("Dockerfile");
    expect(dockerfile).toMatch(/^FROM gcr\.io\/distroless\/static/m);
    expect(dockerfile).toMatch(/^USER 65532/m);
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/provider"]');
  });

  /*
   * The repository ignores every Dockerfile (most are gomplate output), so
   * this one, hand-written, is let through by name: ignored, it never left
   * the machine it was written on, and the package could not be built
   * anywhere else.
   */
  test("is committed, not ignored as rendered Dockerfiles are", () => {
    const dockerfile: string = path.relative(
      REPO_ROOT,
      path.join(STATIC_FILES_DIR, "Dockerfile"),
    );
    // git check-ignore exits 1 for a path no rule ignores.
    const ignored: number | null = spawnSync(
      "git",
      ["check-ignore", "--quiet", "--no-index", dockerfile],
      { cwd: REPO_ROOT },
    ).status;

    expect({ dockerfile, ignored }).toEqual({ dockerfile, ignored: 1 });
  });

  // GHCR links a package to its repository by this label.
  test("names the repository it is made in, as the package's source", () => {
    expect(read("Dockerfile")).toMatch(
      /^LABEL org\.opencontainers\.image\.source="https:\/\/github\.com\/OneUptime\/oneuptime"$/m,
    );
  });
});
