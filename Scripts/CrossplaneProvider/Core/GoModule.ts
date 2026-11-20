/*
 * The provider's go.mod. Upjet, crossplane-runtime, controller-runtime and the
 * Kubernetes libraries are released for each other, so they are pinned to a
 * set known to work together, not upgraded on every generation as the
 * Terraform provider's dependencies are: a newer Kubernetes library than the
 * controller-runtime release supports compiles, and fails at run time.
 * `go mod tidy` adds what these need.
 *
 * Upgrading the set, in this order:
 *
 *   1. Upjet: its newest v2 release.
 *   2. What moves with it (MOVES_WITH_UPJET): read that release's own go.mod
 *      (https://proxy.golang.org/github.com/crossplane/upjet/v2/@v/<version>.mod)
 *      and take, for crossplane-runtime, Crossplane's apis, controller-runtime,
 *      controller-tools and the Kubernetes libraries, the newest patch release
 *      of the minor it requires: a patch release keeps the API its minor is
 *      built for, and carries the security fixes. Never a newer minor than
 *      Upjet's own: controller-runtime v0.25 against Upjet's v0.23 compiles,
 *      and fails at run time.
 *   3. Go: the go line of that go.mod, if it is above GO_VERSION.
 *   4. The rest (kingpin, pkg/errors, crossplane-tools, golang.org/x/tools):
 *      their newest release.
 *
 * Then generate both providers, run `go test ./...` in
 * Crossplane/provider-oneuptime, build the package for both platforms
 * (build-package.sh, check-package.sh) and run the end-to-end test
 * (packages/E2E/Crossplane), which is what catches a set that does not work
 * together. `npm run check-crossplane-provider-pins` lists what is behind,
 * with the test tools the end-to-end test pins (Core/Pins.ts), and the
 * Crossplane Provider Pins workflow keeps an issue that lists it, every week.
 */

export const MODULE_PATH: string =
  "github.com/oneuptime/crossplane-provider-oneuptime";

export const TERRAFORM_MODULE_PATH: string =
  "github.com/oneuptime/terraform-provider-oneuptime";

// Upjet v2.5.1's go line: `go mod tidy` would raise a lower one to it.
export const GO_VERSION: string = "1.26.8";

export const UPJET_MODULE: string = "github.com/crossplane/upjet/v2";

export const REQUIREMENTS: Record<string, string> = {
  "github.com/alecthomas/kingpin/v2": "v2.4.0",
  "github.com/crossplane/crossplane-runtime/v2": "v2.4.3",
  "github.com/crossplane/crossplane-tools":
    "v0.0.0-20260719180100-659f1dc036c5",
  "github.com/crossplane/crossplane/apis/v2": "v2.4.3",
  [UPJET_MODULE]: "v2.5.1",
  "github.com/pkg/errors": "v0.9.1",
  "golang.org/x/tools": "v0.53.0",
  "sigs.k8s.io/controller-runtime": "v0.23.3",
  "sigs.k8s.io/controller-tools": "v0.20.1",
};

/*
 * Kubernetes libraries of the release controller-runtime v0.23 is built
 * for (1.35), at its newest patch. The Terraform provider's dependencies
 * would otherwise raise them to one it is not.
 */
export const KUBERNETES_VERSION: string = "v0.35.10";

/*
 * The requirements Upjet's own go.mod decides (step 2 above): each is kept
 * to the minor that go.mod requires, at its newest patch.
 */
export const MOVES_WITH_UPJET: ReadonlyArray<string> = [
  "github.com/crossplane/crossplane-runtime/v2",
  "github.com/crossplane/crossplane/apis/v2",
  "sigs.k8s.io/controller-runtime",
  "sigs.k8s.io/controller-tools",
];

export const KUBERNETES_MODULES: Array<string> = [
  "k8s.io/api",
  "k8s.io/apiextensions-apiserver",
  "k8s.io/apimachinery",
  "k8s.io/client-go",
];

/*
 * The code generators generation runs (`go build -o bin/ tool`): Upjet's
 * goimports, the CRD and deep copy generator, Crossplane's method set
 * generator, and the scraper that reads the Terraform docs.
 */
export const TOOLS: Array<string> = [
  "github.com/crossplane/crossplane-tools/cmd/angryjet",
  "github.com/crossplane/upjet/v2/cmd/scraper",
  "golang.org/x/tools/cmd/goimports",
  "sigs.k8s.io/controller-tools/cmd/controller-gen",
];

export function renderGoMod(options: {
  // The Terraform provider, relative to the Crossplane provider.
  terraformProviderPath: string;
}): string {
  const lines: Array<string> = [
    `module ${MODULE_PATH}`,
    "",
    `go ${GO_VERSION}`,
    "",
    "tool (",
    ...TOOLS.map((tool: string): string => {
      return `\t${tool}`;
    }),
    ")",
    "",
    "require (",
    ...Object.keys(REQUIREMENTS)
      .sort()
      .map((module: string): string => {
        return `\t${module} ${REQUIREMENTS[module]}`;
      }),
    `\t${TERRAFORM_MODULE_PATH} v0.0.0`,
    ")",
    "",
    "// The Terraform provider generated next to this one, from the same spec.",
    `replace ${TERRAFORM_MODULE_PATH} => ${options.terraformProviderPath}`,
    "",
    "replace (",
    ...KUBERNETES_MODULES.map((module: string): string => {
      return `\t${module} => ${module} ${KUBERNETES_VERSION}`;
    }),
    ")",
    "",
  ];
  return lines.join("\n");
}
