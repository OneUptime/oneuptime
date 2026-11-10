import {
  KUBERNETES_MODULES,
  KUBERNETES_VERSION,
  MODULE_PATH,
  renderGoMod,
  REQUIREMENTS,
  TERRAFORM_MODULE_PATH,
  TOOLS,
} from "../Core/GoModule";

const goMod: string = renderGoMod({
  terraformProviderPath: "../../Terraform/terraform-provider-oneuptime",
});

describe("go.mod", () => {
  test("is the provider's module", () => {
    expect(goMod.startsWith(`module ${MODULE_PATH}\n`)).toBe(true);
    expect(goMod).toMatch(/\ngo 1\.\d+\.\d+\n/);
  });

  test("runs the Terraform provider generated next to it", () => {
    expect(goMod).toContain(`\t${TERRAFORM_MODULE_PATH} v0.0.0\n`);
    expect(goMod).toContain(
      `replace ${TERRAFORM_MODULE_PATH} => ../../Terraform/terraform-provider-oneuptime\n`,
    );
  });

  test("pins every requirement to a release, never a moving version", () => {
    for (const [module, version] of Object.entries(REQUIREMENTS)) {
      expect(version).toMatch(/^v\d+\.\d+\.\d+(-[0-9a-z.-]+)?$/);
      expect(goMod).toContain(`\t${module} ${version}\n`);
    }
    expect(REQUIREMENTS["github.com/crossplane/upjet/v2"]).toBeDefined();
    expect(REQUIREMENTS["sigs.k8s.io/controller-runtime"]).toBeDefined();
  });

  test("holds the Kubernetes libraries at the release controller-runtime is built for", () => {
    expect(KUBERNETES_MODULES).toEqual(
      expect.arrayContaining(["k8s.io/api", "k8s.io/client-go"]),
    );
    for (const module of KUBERNETES_MODULES) {
      expect(goMod).toContain(
        `\t${module} => ${module} ${KUBERNETES_VERSION}\n`,
      );
    }
  });

  test("lists the code generators as tools, each from a required module", () => {
    expect(goMod).toContain(
      `tool (\n${TOOLS.map((tool: string) => {
        return `\t${tool}\n`;
      }).join("")})\n`,
    );
    for (const tool of TOOLS) {
      const module: string | undefined = Object.keys(REQUIREMENTS).find(
        (candidate: string): boolean => {
          return tool.startsWith(`${candidate}/`);
        },
      );
      expect({ tool, module }).toEqual({ tool, module: expect.any(String) });
    }
  });
});
