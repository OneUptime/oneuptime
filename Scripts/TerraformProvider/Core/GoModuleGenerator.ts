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
    // Pin all dependencies to specific versions that are known to work with Terraform 1.5+
    // This prevents go mod tidy from upgrading to incompatible versions
    const goModContent: string = `module ${this.config.goModuleName}

go 1.21

require (
	github.com/hashicorp/terraform-plugin-framework v1.8.0
	github.com/hashicorp/terraform-plugin-log v0.9.0
)

require (
	github.com/fatih/color v1.13.0 // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/hashicorp/go-hclog v1.5.0 // indirect
	github.com/hashicorp/go-plugin v1.6.0 // indirect
	github.com/hashicorp/go-uuid v1.0.3 // indirect
	github.com/hashicorp/terraform-plugin-go v0.22.2 // indirect
	github.com/hashicorp/terraform-registry-address v0.2.3 // indirect
	github.com/hashicorp/terraform-svchost v0.1.1 // indirect
	github.com/hashicorp/yamux v0.1.1 // indirect
	github.com/mattn/go-colorable v0.1.12 // indirect
	github.com/mattn/go-isatty v0.0.14 // indirect
	github.com/mitchellh/go-testing-interface v1.14.1 // indirect
	github.com/oklog/run v1.0.0 // indirect
	github.com/vmihailenco/msgpack/v5 v5.4.1 // indirect
	github.com/vmihailenco/tagparser/v2 v2.0.0 // indirect
	golang.org/x/net v0.21.0 // indirect
	golang.org/x/sys v0.17.0 // indirect
	golang.org/x/text v0.14.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240227224415-6ceb2ff114de // indirect
	google.golang.org/grpc v1.63.2 // indirect
	google.golang.org/protobuf v1.33.0 // indirect
)
`;

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
