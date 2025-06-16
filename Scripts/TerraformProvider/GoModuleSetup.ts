import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * Configuration interface for Go module setup
 */
export interface GoModuleConfig {
  outputPath: string;
  providerName: string;
  githubOrg: string;
  version?: string;
}

/**
 * GoModuleSetup class handles the creation and configuration of Go module files
 * for the Terraform provider. This includes creating go.mod, main.go, provider.go,
 * .goreleaser.yml, and terraform-registry-manifest.json files, as well as
 * updating Go dependencies and building the provider.
 * 
 * This functionality was moved from the bash script to provide better
 * integration with the TypeScript generation process.
 */
export class GoModuleSetup {
  private config: GoModuleConfig;

  constructor(config: GoModuleConfig) {
    this.config = config;
  }

  public async setupGoModule(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log("\n🔧 Step 5: Setting up Go module and build configuration...");

    // Ensure output directory exists
    if (!fs.existsSync(this.config.outputPath)) {
      fs.mkdirSync(this.config.outputPath, { recursive: true });
    }

    const terraformDir = this.config.outputPath;

    // Create go.mod
    this.createGoMod(terraformDir);

    // Create main.go
    this.createMainGo(terraformDir);

    // Create provider.go
    this.createProviderGo(terraformDir);

    // Create .goreleaser.yml
    this.createGoReleaserConfig(terraformDir);

    // Create terraform-registry-manifest.json
    this.createTerraformRegistryManifest(terraformDir);

    // Update Go dependencies and build
    await this.updateDependenciesAndBuild(terraformDir);

    // eslint-disable-next-line no-console
    console.log("✅ Go module setup completed successfully");
  }

  private createGoMod(terraformDir: string): void {
    const goModPath = path.join(terraformDir, "go.mod");
    if (!fs.existsSync(goModPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating go.mod file...");
      
      const goModContent = `module github.com/${this.config.githubOrg}/terraform-provider-${this.config.providerName}

go 1.21

require (
    github.com/hashicorp/terraform-plugin-framework v1.4.2
    github.com/hashicorp/terraform-plugin-go v0.19.1
    github.com/hashicorp/terraform-plugin-log v0.9.0
    github.com/hashicorp/terraform-plugin-testing v1.5.1
)
`;
      
      fs.writeFileSync(goModPath, goModContent);
    }
  }

  private createMainGo(terraformDir: string): void {
    const mainGoPath = path.join(terraformDir, "main.go");
    if (!fs.existsSync(mainGoPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating main.go file...");
      
      const mainGoContent = `package main

import (
    "context"
    "flag"
    "log"

    "github.com/hashicorp/terraform-plugin-framework/providerserver"
)

// Provider documentation generation.
//go:generate go run github.com/hashicorp/terraform-plugin-docs/cmd/tfplugindocs generate --provider-name ${this.config.providerName}

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
        Address: "registry.terraform.io/${this.config.providerName}/${this.config.providerName}",
        Debug:   debug,
    }

    err := providerserver.Serve(context.Background(), NewProvider(version), opts)
    if err != nil {
        log.Fatal(err.Error())
    }
}
`;
      
      fs.writeFileSync(mainGoPath, mainGoContent);
    }
  }

  private createProviderGo(terraformDir: string): void {
    const providerGoPath = path.join(terraformDir, "provider.go");
    if (!fs.existsSync(providerGoPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating provider.go file...");
      
      const providerGoContent = `package main

import (
    "context"

    "github.com/hashicorp/terraform-plugin-framework/datasource"
    "github.com/hashicorp/terraform-plugin-framework/provider"
    "github.com/hashicorp/terraform-plugin-framework/provider/schema"
    "github.com/hashicorp/terraform-plugin-framework/resource"
    "github.com/hashicorp/terraform-plugin-framework/types"
)

// Ensure the implementation satisfies the expected interfaces.
var (
    _ provider.Provider = &${this.config.providerName}Provider{}
)

// New is a helper function to simplify provider server and testing implementation.
func NewProvider(version string) func() provider.Provider {
    return func() provider.Provider {
        return &${this.config.providerName}Provider{
            version: version,
        }
    }
}

// ${this.config.providerName}Provider is the provider implementation.
type ${this.config.providerName}Provider struct {
    version string
}

// Metadata returns the provider type name.
func (p *${this.config.providerName}Provider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
    resp.TypeName = "${this.config.providerName}"
    resp.Version = p.version
}

// Schema defines the provider-level schema for configuration data.
func (p *${this.config.providerName}Provider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
    resp.Schema = schema.Schema{
        Description: "Interact with OneUptime.",
        Attributes: map[string]schema.Attribute{
            "api_url": schema.StringAttribute{
                Description: "OneUptime API URL. May also be provided via ONEUPTIME_API_URL environment variable.",
                Optional:    true,
            },
            "api_key": schema.StringAttribute{
                Description: "OneUptime API Key. May also be provided via ONEUPTIME_API_KEY environment variable.",
                Optional:    true,
                Sensitive:   true,
            },
        },
    }
}

type ${this.config.providerName}ProviderModel struct {
    ApiUrl types.String \`tfsdk:"api_url"\`
    ApiKey types.String \`tfsdk:"api_key"\`
}

// Configure prepares a OneUptime API client for data sources and resources.
func (p *${this.config.providerName}Provider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
    var config ${this.config.providerName}ProviderModel
    diags := req.Config.Get(ctx, &config)
    resp.Diagnostics.Append(diags...)
    if resp.Diagnostics.HasError() {
        return
    }

    // If configuration values are known, set them here
    // This is where you would initialize your API client
}

// DataSources defines the data sources implemented in the provider.
func (p *${this.config.providerName}Provider) DataSources(_ context.Context) []func() datasource.DataSource {
    return []func() datasource.DataSource{
        // Add your data sources here
    }
}

// Resources defines the resources implemented in the provider.
func (p *${this.config.providerName}Provider) Resources(_ context.Context) []func() resource.Resource {
    return []func() resource.Resource{
        // Add your resources here
    }
}
`;
      
      fs.writeFileSync(providerGoPath, providerGoContent);
    }
  }

  private createGoReleaserConfig(terraformDir: string): void {
    const goreleaserPath = path.join(terraformDir, ".goreleaser.yml");
    if (!fs.existsSync(goreleaserPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating .goreleaser.yml file...");
      
      const goreleaserContent = `version: 2

before:
  hooks:
    - go mod tidy

builds:
  - env:
      - CGO_ENABLED=0
    mod_timestamp: '{{ .CommitTimestamp }}'
    flags:
      - -trimpath
    ldflags:
      - '-s -w -X main.version={{.Version}} -X main.commit={{.Commit}}'
    goos:
      - freebsd
      - windows
      - linux
      - darwin
    goarch:
      - amd64
      - '386'
      - arm
      - arm64
    ignore:
      - goos: darwin
        goarch: '386'
    binary: '{{ .ProjectName }}_v{{ .Version }}'

archives:
  - format: zip
    name_template: '{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}'

checksum:
  extra_files:
    - glob: 'terraform-registry-manifest.json'
      name_template: '{{ .ProjectName }}_{{ .Version }}_manifest.json'
  name_template: '{{ .ProjectName }}_{{ .Version }}_SHA256SUMS'
  algorithm: sha256

signs:
  - artifacts: checksum
    args:
      - "--batch"
      - "--local-user"
      - "{{ .Env.GPG_FINGERPRINT }}"
      - "--output"
      - "\${signature}"
      - "--detach-sign"
      - "\${artifact}"

release:
  extra_files:
    - glob: 'terraform-registry-manifest.json'
  name_template: '{{ .ProjectName }}_{{ .Version }}'

changelog:
  use: github
  sort: asc
  abbrev: 0
  groups:
    - title: Features
      regexp: "^.*feat[(\\w)]*:+.*$"
      order: 0
    - title: 'Bug fixes'
      regexp: "^.*fix[(\\w)]*:+.*$"
      order: 1
    - title: Others
      order: 999
`;
      
      fs.writeFileSync(goreleaserPath, goreleaserContent);
    }
  }

  private createTerraformRegistryManifest(terraformDir: string): void {
    const manifestPath = path.join(terraformDir, "terraform-registry-manifest.json");
    if (!fs.existsSync(manifestPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating terraform-registry-manifest.json...");
      
      const manifestContent = {
        version: 1,
        metadata: {
          protocol_versions: ["6.0"]
        }
      };
      
      fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));
    }
  }

  private async updateDependenciesAndBuild(terraformDir: string): Promise<void> {
    try {
      // eslint-disable-next-line no-console
      console.log("   🔄 Updating Go dependencies...");
      
      // Change to terraform directory
      process.chdir(terraformDir);
      
      // Update go.mod and download dependencies
      execSync("go mod tidy", { stdio: "inherit" });
      execSync("go mod download", { stdio: "inherit" });
      
      // eslint-disable-next-line no-console
      console.log("   🔨 Building provider for current platform...");
      
      // Build for current platform
      execSync("go build -v .", { stdio: "inherit" });
      
      // eslint-disable-next-line no-console
      console.log("   ✅ Provider build successful");
      
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("   ❌ Error during Go operations:", error);
      throw error;
    }
  }

  public static async setup(config: GoModuleConfig): Promise<void> {
    const goModuleSetup = new GoModuleSetup(config);
    await goModuleSetup.setupGoModule();
  }
}
