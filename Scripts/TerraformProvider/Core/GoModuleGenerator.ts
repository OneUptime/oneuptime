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
    await this.generateGoSum();
    await this.generateMainGo();
    await this.generateVersionGo();
  }

  private async generateGoMod(): Promise<void> {
    /*
     * Generate minimal go.mod - dependencies will be fetched at latest versions
     * by running 'go get -u' after 'go mod tidy' in GenerateProvider.ts
     */
    const goModContent: string = `module ${this.config.goModuleName}

go 1.23

require (
	github.com/hashicorp/terraform-plugin-framework v1.0.0
	github.com/hashicorp/terraform-plugin-log v0.9.0
)
`;
    /*
     * Note: The version numbers above are placeholder minimum versions.
     * The actual latest versions will be fetched by running 'go get -u ./...'
     * after 'go mod tidy' in the generation process.
     */

    await this.fileGenerator.writeFile("go.mod", goModContent);
  }

  private async generateGoSum(): Promise<void> {
    // go.sum will be generated when running go mod tidy
    const goSumContent: string = `# This file will be generated when running 'go mod tidy'
# Run 'go mod tidy' after generating the provider to populate dependencies
`;

    await this.fileGenerator.writeFile("go.sum", goSumContent);
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
