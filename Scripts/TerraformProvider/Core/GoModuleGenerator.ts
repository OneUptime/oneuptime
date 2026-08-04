import { TerraformProviderConfig } from "./Types";
import { FileGenerator } from "./FileGenerator";

export class GoModuleGenerator {
  private config: TerraformProviderConfig;
  private fileGenerator: FileGenerator;

  public constructor(config: TerraformProviderConfig) {
    this.config = config;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  public async generateModule(): Promise<void> {
    await this.generateGoMod();
    await this.generateMainGo();
    await this.generateVersionGo();
  }

  private async generateGoMod(): Promise<void> {
    /*
     * Minimum versions only — GenerateProvider.ts runs `go get -u ./...`
     * followed by `go mod tidy`, so every generation resolves the newest
     * releases and the compile/vet/test gates catch breakage immediately.
     * The floors below are recent enough that even a network-restricted
     * build without the upgrade step gets CVE-patched dependencies.
     */
    const goModContent: string = `module ${this.config.goModuleName}

go 1.23.0

toolchain go1.24.0

require (
	github.com/hashicorp/terraform-plugin-framework v1.13.0
	github.com/hashicorp/terraform-plugin-framework-validators v0.16.0
	github.com/hashicorp/terraform-plugin-go v0.25.0
	github.com/hashicorp/terraform-plugin-log v0.9.0
)
`;

    await this.fileGenerator.writeFile("go.mod", goModContent);
  }

  private async generateMainGo(): Promise<void> {
    const mainGoContent: string = `package main

import (
    "context"
    "flag"
    "log"

    "github.com/hashicorp/terraform-plugin-framework/providerserver"

    "${this.config.goModuleName}/internal/provider"
)

// Run "go generate" to format example terraform files and generate the docs for the registry/website

//go:generate terraform fmt -recursive ./examples/

// Run the docs generation tool, check its repository for more information on how it works and how docs
// can be customized.
//go:generate go run github.com/hashicorp/terraform-plugin-docs/cmd/tfplugindocs

var (
    // these will be set by the goreleaser configuration
    // to appropriate values for the compiled binary.
    version string = "dev"

    // goreleaser can pass other information to the main package, such as the specific commit
    // https://goreleaser.com/cookbooks/using-main.version/
)

func main() {
    var debug bool

    flag.BoolVar(&debug, "debug", false, "set to true to run the provider with support for debuggers like delve")
    flag.Parse()

    opts := providerserver.ServeOpts{
        Address: "registry.terraform.io/oneuptime/${this.config.providerName}",
        Debug:   debug,
    }

    err := providerserver.Serve(context.Background(), provider.New(version), opts)

    if err != nil {
        log.Fatal(err.Error())
    }
}
`;

    await this.fileGenerator.writeFile("main.go", mainGoContent);
  }

  private async generateVersionGo(): Promise<void> {
    const versionGoContent: string = `package main

import (
    "fmt"
)

// Version is the current version of the provider
var Version = "${this.config.providerVersion}"

// PrintVersion prints the version information
func PrintVersion() {
    fmt.Printf("terraform-provider-${this.config.providerName} v%s\\n", Version)
}
`;

    await this.fileGenerator.writeFile("version.go", versionGoContent);
  }
}
