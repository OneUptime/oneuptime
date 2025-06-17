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

  public constructor(config: GoModuleConfig) {
    this.config = config;
  }

  public async setupGoModule(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log("\n🔧 Step 5: Setting up Go module and build configuration...");

    // Ensure output directory exists
    if (!fs.existsSync(this.config.outputPath)) {
      fs.mkdirSync(this.config.outputPath, { recursive: true });
    }

    const terraformDir: string = this.config.outputPath;

    // Create go.mod
    this.createGoMod(terraformDir);

    // Create cmd directory and main.go
    this.createCmdMainGo(terraformDir);

    // Create provider.go in root directory with proper package
    this.createProviderGo(terraformDir);

    // Create .goreleaser.yml
    this.createGoReleaserConfig(terraformDir);

    // Create terraform-registry-manifest.json
    this.createTerraformRegistryManifest(terraformDir);

    // Update Go dependencies and build
    await this.updateDependenciesAndBuild(terraformDir);

    // Build for multiple platforms
    await this.buildMultiPlatform(terraformDir);

    // eslint-disable-next-line no-console
    console.log("✅ Go module setup completed successfully");
  }

  private createGoMod(terraformDir: string): void {
    const goModPath: string = path.join(terraformDir, "go.mod");
    if (!fs.existsSync(goModPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating go.mod file...");

      const goModContent: string = `module github.com/${this.config.githubOrg}/terraform-provider-${this.config.providerName}

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

  private createCmdMainGo(terraformDir: string): void {
    const cmdDir: string = path.join(terraformDir, "cmd");
    if (!fs.existsSync(cmdDir)) {
      fs.mkdirSync(cmdDir, { recursive: true });
    }

    const mainGoPath: string = path.join(cmdDir, "main.go");
    if (!fs.existsSync(mainGoPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating cmd/main.go file...");

      const mainGoContent: string = `package main

import (
    "context"
    "flag"
    "log"

    "github.com/hashicorp/terraform-plugin-framework/providerserver"
    "github.com/${this.config.githubOrg}/terraform-provider-${this.config.providerName}"
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

    err := providerserver.Serve(context.Background(), ${this.config.providerName}.NewProvider(version), opts)
    if err != nil {
        log.Fatal(err.Error())
    }
}
`;

      fs.writeFileSync(mainGoPath, mainGoContent);
    }
  }

  private createProviderGo(terraformDir: string): void {
    const providerGoPath: string = path.join(terraformDir, "provider.go");
    
    // eslint-disable-next-line no-console
    console.log("   📄 Creating provider.go file...");
    
    // Scan for generated resources and data sources
    const resources = this.getGeneratedResources(terraformDir);
    const dataSources = this.getGeneratedDataSources(terraformDir);
    
    // Create resource implementations
    this.createResourceImplementations(terraformDir, resources);
    
    // Create data source implementations
    this.createDataSourceImplementations(terraformDir, dataSources);
    
    // Generate resource registrations
    const resourceRegistrations = resources.map(resourceName => {
      const pascalCaseName = this.toPascalCase(resourceName);
      return `        New${pascalCaseName}Resource,`;
    }).join('\n');
    
    // Generate data source registrations
    const dataSourceRegistrations = dataSources.map(dataSourceName => {
      const pascalCaseName = this.toPascalCase(dataSourceName);
      return `        New${pascalCaseName}DataSource,`;
    }).join('\n');

    const providerGoContent: string = `package ${this.config.providerName}

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
${dataSourceRegistrations}
    }
}

// Resources defines the resources implemented in the provider.
func (p *${this.config.providerName}Provider) Resources(_ context.Context) []func() resource.Resource {
    return []func() resource.Resource{
${resourceRegistrations}
    }
}
`;

    fs.writeFileSync(providerGoPath, providerGoContent);
    
    // eslint-disable-next-line no-console
    console.log(`   ✅ Created provider.go with ${resources.length} resources and ${dataSources.length} data sources`);
  }

  private createGoReleaserConfig(terraformDir: string): void {
    const goreleaserPath: string = path.join(terraformDir, ".goreleaser.yml");
    if (!fs.existsSync(goreleaserPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating .goreleaser.yml file...");

      const goreleaserContent: string = `version: 2

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
    const manifestPath: string = path.join(
      terraformDir,
      "terraform-registry-manifest.json",
    );
    if (!fs.existsSync(manifestPath)) {
      // eslint-disable-next-line no-console
      console.log("   📄 Creating terraform-registry-manifest.json...");

      const manifestContent: {
        version: number;
        metadata: { protocol_versions: string[] };
      } = {
        version: 1,
        metadata: {
          protocol_versions: ["6.0"],
        },
      };

      fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));
    }
  }

  private async updateDependenciesAndBuild(
    terraformDir: string,
  ): Promise<void> {
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

      // Build from cmd directory
      execSync(
        `go build -v -o terraform-provider-${this.config.providerName} ./cmd`,
        { stdio: "inherit" },
      );

      // eslint-disable-next-line no-console
      console.log("   ✅ Provider build successful");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("   ❌ Error during Go operations:", error);
      throw error;
    }
  }

  private async buildMultiPlatform(terraformDir: string): Promise<void> {
    try {
      // eslint-disable-next-line no-console
      console.log("\n🏗️  Step 6: Building provider for multiple platforms...");

      // Change to terraform directory
      process.chdir(terraformDir);

      // Define target platforms
      const platforms: Array<{ os: string; arch: string }> = [
        { os: "linux", arch: "amd64" },
        { os: "linux", arch: "arm64" },
        { os: "darwin", arch: "amd64" },
        { os: "darwin", arch: "arm64" },
        { os: "windows", arch: "amd64" },
      ];

      // Create builds directory
      const buildDir: string = path.join(terraformDir, "builds");
      if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
      }

      // eslint-disable-next-line no-console
      console.log(`   📁 Created builds directory: ${buildDir}`);

      // Build for each platform
      for (const platform of platforms) {
        const { os, arch } = platform;
        const extension: string = os === "windows" ? ".exe" : "";
        const outputName: string = `terraform-provider-${this.config.providerName}_${os}_${arch}${extension}`;
        const outputPath: string = path.join(buildDir, outputName);

        // eslint-disable-next-line no-console
        console.log(`   🔨 Building for ${os}/${arch}...`);

        try {
          execSync(
            `GOOS=${os} GOARCH=${arch} go build -o "${outputPath}" ./cmd`,
            {
              stdio: "inherit",
              env: { ...process.env, GOOS: os, GOARCH: arch },
            },
          );
          // eslint-disable-next-line no-console
          console.log(`   ✅ Built for ${os}/${arch}: ${outputName}`);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`   ❌ Failed to build for ${os}/${arch}:`, error);
          throw error;
        }
      }

      // eslint-disable-next-line no-console
      console.log("✅ Multi-platform build completed successfully");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("   ❌ Error during multi-platform build:", error);
      throw error;
    }
  }

  /**
   * Scans generated resource files and extracts resource names for dynamic registration
   */
  private getGeneratedResources(terraformDir: string): string[] {
    const resources: string[] = [];
    
    try {
      const files = fs.readdirSync(terraformDir);
      const resourceFiles = files.filter(file => 
        file.endsWith('_resource_gen.go') && !file.includes('provider_gen.go')
      );
      
      for (const file of resourceFiles) {
        // Extract resource name from filename
        // e.g., team_resource_gen.go -> team
        const resourceName = file.replace('_resource_gen.go', '');
        resources.push(resourceName);
      }
    } catch (error) {
      console.log(`Warning: Could not scan for generated resources: ${error}`);
    }
    
    return resources;
  }

  /**
   * Scans generated data source files and extracts data source names for dynamic registration
   */
  private getGeneratedDataSources(terraformDir: string): string[] {
    const dataSources: string[] = [];
    
    try {
      const files = fs.readdirSync(terraformDir);
      const dataSourceFiles = files.filter(file => 
        file.endsWith('_data_source_gen.go')
      );
      
      for (const file of dataSourceFiles) {
        // Extract data source name from filename
        // e.g., team_data_source_gen.go -> team
        const dataSourceName = file.replace('_data_source_gen.go', '');
        dataSources.push(dataSourceName);
      }
    } catch (error) {
      console.log(`Warning: Could not scan for generated data sources: ${error}`);
    }
    
    return dataSources;
  }

  /**
   * Converts a resource name to PascalCase for Go function naming
   */
  private toPascalCase(str: string): string {
    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Creates resource implementation files for generated schemas
   */
  private createResourceImplementations(terraformDir: string, resources: string[]): void {
    for (const resourceName of resources) {
      const pascalCaseName = this.toPascalCase(resourceName);
      const resourceFileName = `${resourceName}_resource.go`;
      const resourceFilePath = path.join(terraformDir, resourceFileName);
      
      // Only create if implementation doesn't already exist
      if (!fs.existsSync(resourceFilePath)) {
        const resourceContent = `package oneuptime

import (
    "context"

    "github.com/hashicorp/terraform-plugin-framework/resource"
    "github.com/hashicorp/terraform-plugin-framework/types"
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ resource.Resource = &${pascalCaseName}Resource{}
var _ resource.ResourceWithImportState = &${pascalCaseName}Resource{}

func New${pascalCaseName}Resource() resource.Resource {
    return &${pascalCaseName}Resource{}
}

// ${pascalCaseName}Resource defines the resource implementation.
type ${pascalCaseName}Resource struct{}

// Metadata returns the resource type name.
func (r *${pascalCaseName}Resource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
    resp.TypeName = req.ProviderTypeName + "_${resourceName}"
}

// Schema defines the schema for the resource.
func (r *${pascalCaseName}Resource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
    resp.Schema = ${pascalCaseName}ResourceSchema(ctx)
}

// Configure adds the provider configured client to the resource.
func (r *${pascalCaseName}Resource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
    // Prevent panic if the provider has not been configured.
    if req.ProviderData == nil {
        return
    }

    // Add client configuration here when API client is implemented
}

// Create creates the resource and sets the initial Terraform state.
func (r *${pascalCaseName}Resource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
    var data ${pascalCaseName}Model

    // Read Terraform plan data into the model
    resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // TODO: Implement API call to create resource
    // For now, set a placeholder ID
    data.Id = types.StringValue("placeholder-id")

    // Write logs using the tflog package
    // Documentation: https://terraform.io/plugin/log
    // tflog.Trace(ctx, "created a resource")

    // Save data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

// Read refreshes the Terraform state with the latest data.
func (r *${pascalCaseName}Resource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
    var data ${pascalCaseName}Model

    // Read Terraform prior state data into the model
    resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // TODO: Implement API call to read resource

    // Save updated data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

// Update updates the resource and sets the updated Terraform state on success.
func (r *${pascalCaseName}Resource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
    var data ${pascalCaseName}Model

    // Read Terraform plan data into the model
    resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // TODO: Implement API call to update resource

    // Save updated data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

// Delete deletes the resource and removes the Terraform state on success.
func (r *${pascalCaseName}Resource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
    var data ${pascalCaseName}Model

    // Read Terraform prior state data into the model
    resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // TODO: Implement API call to delete resource
}

// ImportState imports the resource into Terraform state.
func (r *${pascalCaseName}Resource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
    // TODO: Implement resource import
    resp.Diagnostics.AddError(
        "Import Not Implemented",
        "Import is not yet implemented for this resource.",
    )
}
`;

        fs.writeFileSync(resourceFilePath, resourceContent);
        console.log(`   📄 Created resource implementation: ${resourceFileName}`);
      }
    }
  }

  /**
   * Creates data source implementation files for generated schemas
   */
  private createDataSourceImplementations(terraformDir: string, dataSources: string[]): void {
    for (const dataSourceName of dataSources) {
      const pascalCaseName = this.toPascalCase(dataSourceName);
      const dataSourceFileName = `${dataSourceName}_data_source.go`;
      const dataSourceFilePath = path.join(terraformDir, dataSourceFileName);
      
      // Only create if implementation doesn't already exist
      if (!fs.existsSync(dataSourceFilePath)) {
        const dataSourceContent = `package oneuptime

import (
    "context"

    "github.com/hashicorp/terraform-plugin-framework/datasource"
    "github.com/hashicorp/terraform-plugin-framework/types"
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ datasource.DataSource = &${pascalCaseName}DataSource{}

func New${pascalCaseName}DataSource() datasource.DataSource {
    return &${pascalCaseName}DataSource{}
}

// ${pascalCaseName}DataSource defines the data source implementation.
type ${pascalCaseName}DataSource struct{}

// Metadata returns the data source type name.
func (d *${pascalCaseName}DataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
    resp.TypeName = req.ProviderTypeName + "_${dataSourceName}"
}

// Schema defines the schema for the data source.
func (d *${pascalCaseName}DataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
    resp.Schema = ${pascalCaseName}DataSourceSchema(ctx)
}

// Configure adds the provider configured client to the data source.
func (d *${pascalCaseName}DataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
    // Prevent panic if the provider has not been configured.
    if req.ProviderData == nil {
        return
    }

    // Add client configuration here when API client is implemented
}

// Read refreshes the Terraform state with the latest data.
func (d *${pascalCaseName}DataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
    var data ${pascalCaseName}Model

    // Read Terraform configuration data into the model
    resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // TODO: Implement API call to read data source

    // Save data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;

        fs.writeFileSync(dataSourceFilePath, dataSourceContent);
        console.log(`   📄 Created data source implementation: ${dataSourceFileName}`);
      }
    }
  }

  public static async setup(config: GoModuleConfig): Promise<void> {
    const goModuleSetup: GoModuleSetup = new GoModuleSetup(config);
    await goModuleSetup.setupGoModule();
  }
}
