import { TerraformProviderConfig, OpenAPISpec } from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";

export class ProviderGenerator {
  private config: TerraformProviderConfig;
  private spec: OpenAPISpec;
  private fileGenerator: FileGenerator;

  constructor(config: TerraformProviderConfig, spec: OpenAPISpec) {
    this.config = config;
    this.spec = spec;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  async generateProvider(): Promise<void> {
    await this.generateProviderGo();
    await this.generateProviderSchema();
    await this.generateClientGo();
    await this.generateConfigGo();
  }

  private async generateProviderGo(): Promise<void> {
    const providerGoContent = `package provider

import (
    "context"
    "os"

    "github.com/hashicorp/terraform-plugin-framework/datasource"
    "github.com/hashicorp/terraform-plugin-framework/provider"
    "github.com/hashicorp/terraform-plugin-framework/provider/schema"
    "github.com/hashicorp/terraform-plugin-framework/resource"
    "github.com/hashicorp/terraform-plugin-framework/types"
    "github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ provider.Provider = &${StringUtils.toPascalCase(this.config.providerName)}Provider{}

// ${StringUtils.toPascalCase(this.config.providerName)}Provider defines the provider implementation.
type ${StringUtils.toPascalCase(this.config.providerName)}Provider struct {
    // version is set to the provider version on release, "dev" when the
    // provider is built and ran locally, and "test" when running acceptance
    // testing.
    version string
}

// ${StringUtils.toPascalCase(this.config.providerName)}ProviderModel describes the provider data model.
type ${StringUtils.toPascalCase(this.config.providerName)}ProviderModel struct {
    Host     types.String \`tfsdk:"host"\`
    ApiKey   types.String \`tfsdk:"api_key"\`
    Username types.String \`tfsdk:"username"\`
    Password types.String \`tfsdk:"password"\`
}

func (p *${StringUtils.toPascalCase(this.config.providerName)}Provider) Metadata(ctx context.Context, req provider.MetadataRequest, resp *provider.MetadataResponse) {
    resp.TypeName = "${this.config.providerName}"
    resp.Version = p.version
}

func (p *${StringUtils.toPascalCase(this.config.providerName)}Provider) Schema(ctx context.Context, req provider.SchemaRequest, resp *provider.SchemaResponse) {
    resp.Schema = schema.Schema{
        MarkdownDescription: "${this.spec.info.description || `Terraform provider for ${this.config.providerName}`}",

        Attributes: map[string]schema.Attribute{
            "host": schema.StringAttribute{
                MarkdownDescription: "The ${this.config.providerName} API host",
                Optional:            true,
            },
            "api_key": schema.StringAttribute{
                MarkdownDescription: "API key for authentication",
                Optional:            true,
                Sensitive:           true,
            },
            "username": schema.StringAttribute{
                MarkdownDescription: "Username for authentication",
                Optional:            true,
            },
            "password": schema.StringAttribute{
                MarkdownDescription: "Password for authentication",
                Optional:            true,
                Sensitive:           true,
            },
        },
    }
}

func (p *${StringUtils.toPascalCase(this.config.providerName)}Provider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
    var data ${StringUtils.toPascalCase(this.config.providerName)}ProviderModel

    resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // Configuration values are now available.
    // Example implementation:
    var host string
    var apiKey string
    var username string
    var password string

    if data.Host.IsUnknown() {
        // Cannot connect to client with an unknown value
        resp.Diagnostics.AddWarning(
            "Unable to create client",
            "Cannot use unknown value as host",
        )
        return
    }

    if data.Host.IsNull() {
        host = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_HOST")
    } else {
        host = data.Host.ValueString()
    }

    if data.ApiKey.IsNull() {
        apiKey = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_API_KEY")
    } else {
        apiKey = data.ApiKey.ValueString()
    }

    if data.Username.IsNull() {
        username = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_USERNAME")
    } else {
        username = data.Username.ValueString()
    }

    if data.Password.IsNull() {
        password = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_PASSWORD")
    } else {
        password = data.Password.ValueString()
    }

    // Example client configuration for data sources and resources
    if host == "" {
        host = "${this.spec.servers[0]?.url || "https://api.example.com"}"
    }

    client, err := NewClient(host, apiKey, username, password)
    if err != nil {
        resp.Diagnostics.AddError(
            "Unable to Create ${StringUtils.toPascalCase(this.config.providerName)} API Client",
            "An unexpected error occurred when creating the ${StringUtils.toPascalCase(this.config.providerName)} API client. "+
                "If the error is not clear, please contact the provider developers.\\n\\n"+
                "${StringUtils.toPascalCase(this.config.providerName)} Client Error: "+err.Error(),
        )
        return
    }

    resp.DataSourceData = client
    resp.ResourceData = client

    tflog.Info(ctx, "Configured ${StringUtils.toPascalCase(this.config.providerName)} client", map[string]any{"success": true})
}

func (p *${StringUtils.toPascalCase(this.config.providerName)}Provider) Resources(ctx context.Context) []func() resource.Resource {
    return []func() resource.Resource{
        // Resources will be added here dynamically
    }
}

func (p *${StringUtils.toPascalCase(this.config.providerName)}Provider) DataSources(ctx context.Context) []func() datasource.DataSource {
    return []func() datasource.DataSource{
        // Data sources will be added here dynamically
    }
}

func New(version string) func() provider.Provider {
    return func() provider.Provider {
        return &${StringUtils.toPascalCase(this.config.providerName)}Provider{
            version: version,
        }
    }
}
`;

    await this.fileGenerator.writeFileInDir("internal/provider", "provider.go", providerGoContent);
  }

  private async generateProviderSchema(): Promise<void> {
    const schemaGoContent = `package provider

import (
    "github.com/hashicorp/terraform-plugin-framework/provider/schema"
    "github.com/hashicorp/terraform-plugin-framework/types"
)

// ProviderSchema returns the schema for the provider configuration
func ProviderSchema() schema.Schema {
    return schema.Schema{
        MarkdownDescription: "${this.spec.info.description || `Terraform provider for ${this.config.providerName}`}",
        Attributes: map[string]schema.Attribute{
            "host": schema.StringAttribute{
                MarkdownDescription: "The ${this.config.providerName} API host. Can also be set via the ${StringUtils.toConstantCase(this.config.providerName)}_HOST environment variable.",
                Optional:            true,
            },
            "api_key": schema.StringAttribute{
                MarkdownDescription: "API key for authentication. Can also be set via the ${StringUtils.toConstantCase(this.config.providerName)}_API_KEY environment variable.",
                Optional:            true,
                Sensitive:           true,
            },
            "username": schema.StringAttribute{
                MarkdownDescription: "Username for authentication. Can also be set via the ${StringUtils.toConstantCase(this.config.providerName)}_USERNAME environment variable.",
                Optional:            true,
            },
            "password": schema.StringAttribute{
                MarkdownDescription: "Password for authentication. Can also be set via the ${StringUtils.toConstantCase(this.config.providerName)}_PASSWORD environment variable.",
                Optional:            true,
                Sensitive:           true,
            },
        },
    }
}

// ProviderModel represents the provider configuration
type ProviderModel struct {
    Host     types.String \`tfsdk:"host"\`
    ApiKey   types.String \`tfsdk:"api_key"\`
    Username types.String \`tfsdk:"username"\`
    Password types.String \`tfsdk:"password"\`
}
`;

    await this.fileGenerator.writeFileInDir("internal/provider", "schema.go", schemaGoContent);
  }

  private async generateClientGo(): Promise<void> {
    const clientGoContent = `package provider

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "strings"
    "time"
)

// Client represents the API client for ${this.config.providerName}
type Client struct {
    BaseURL    string
    HTTPClient *http.Client
    ApiKey     string
    Username   string
    Password   string
}

// NewClient creates a new API client
func NewClient(host, apiKey, username, password string) (*Client, error) {
    // Ensure the host has the correct scheme
    if !strings.HasPrefix(host, "http://") && !strings.HasPrefix(host, "https://") {
        host = "https://" + host
    }

    // Parse and validate the URL
    parsedURL, err := url.Parse(host)
    if err != nil {
        return nil, fmt.Errorf("invalid host URL: %w", err)
    }

    client := &Client{
        BaseURL: parsedURL.String(),
        HTTPClient: &http.Client{
            Timeout: time.Second * 30,
        },
        ApiKey:   apiKey,
        Username: username,
        Password: password,
    }

    return client, nil
}

// DoRequest performs an HTTP request
func (c *Client) DoRequest(method, path string, body interface{}) (*http.Response, error) {
    // Construct the full URL
    fullURL := c.BaseURL + path

    var bodyReader io.Reader
    if body != nil {
        jsonBody, err := json.Marshal(body)
        if err != nil {
            return nil, fmt.Errorf("failed to marshal request body: %w", err)
        }
        bodyReader = bytes.NewBuffer(jsonBody)
    }

    req, err := http.NewRequest(method, fullURL, bodyReader)
    if err != nil {
        return nil, fmt.Errorf("failed to create request: %w", err)
    }

    // Set headers
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Accept", "application/json")

    // Set authentication
    if c.ApiKey != "" {
        req.Header.Set("Authorization", "Bearer "+c.ApiKey)
    } else if c.Username != "" && c.Password != "" {
        req.SetBasicAuth(c.Username, c.Password)
    }

    resp, err := c.HTTPClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("failed to execute request: %w", err)
    }

    return resp, nil
}

// Get performs a GET request
func (c *Client) Get(path string) (*http.Response, error) {
    return c.DoRequest("GET", path, nil)
}

// Post performs a POST request
func (c *Client) Post(path string, body interface{}) (*http.Response, error) {
    return c.DoRequest("POST", path, body)
}

// Put performs a PUT request
func (c *Client) Put(path string, body interface{}) (*http.Response, error) {
    return c.DoRequest("PUT", path, body)
}

// Patch performs a PATCH request
func (c *Client) Patch(path string, body interface{}) (*http.Response, error) {
    return c.DoRequest("PATCH", path, body)
}

// Delete performs a DELETE request
func (c *Client) Delete(path string) (*http.Response, error) {
    return c.DoRequest("DELETE", path, nil)
}

// ParseResponse parses an HTTP response into a struct
func (c *Client) ParseResponse(resp *http.Response, target interface{}) error {
    defer resp.Body.Close()

    if resp.StatusCode >= 400 {
        body, _ := io.ReadAll(resp.Body)
        return fmt.Errorf("API request failed with status %d: %s", resp.StatusCode, string(body))
    }

    if target == nil {
        return nil
    }

    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return fmt.Errorf("failed to read response body: %w", err)
    }

    if len(body) == 0 {
        return nil
    }

    err = json.Unmarshal(body, target)
    if err != nil {
        return fmt.Errorf("failed to unmarshal response: %w", err)
    }

    return nil
}
`;

    await this.fileGenerator.writeFileInDir("internal/provider", "client.go", clientGoContent);
  }

  private async generateConfigGo(): Promise<void> {
    const configGoContent = `package provider

import (
    "context"
    "os"

    "github.com/hashicorp/terraform-plugin-framework/diag"
)

// Config holds the provider configuration
type Config struct {
    Host     string
    ApiKey   string
    Username string
    Password string
    Client   *Client
}

// NewConfig creates a new configuration from the provider model
func NewConfig(ctx context.Context, model ProviderModel) (*Config, diag.Diagnostics) {
    var diags diag.Diagnostics

    config := &Config{}

    // Set host
    if model.Host.IsNull() {
        config.Host = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_HOST")
    } else {
        config.Host = model.Host.ValueString()
    }

    // Set API key
    if model.ApiKey.IsNull() {
        config.ApiKey = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_API_KEY")
    } else {
        config.ApiKey = model.ApiKey.ValueString()
    }

    // Set username
    if model.Username.IsNull() {
        config.Username = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_USERNAME")
    } else {
        config.Username = model.Username.ValueString()
    }

    // Set password
    if model.Password.IsNull() {
        config.Password = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_PASSWORD")
    } else {
        config.Password = model.Password.ValueString()
    }

    // Default host if not set
    if config.Host == "" {
        config.Host = "${this.spec.servers[0]?.url || "https://api.example.com"}"
    }

    // Create client
    client, err := NewClient(config.Host, config.ApiKey, config.Username, config.Password)
    if err != nil {
        diags.AddError(
            "Unable to Create API Client",
            "An unexpected error occurred when creating the API client. "+
                "If the error is not clear, please contact the provider developers.\\n\\n"+
                "Client Error: "+err.Error(),
        )
        return nil, diags
    }

    config.Client = client
    return config, diags
}
`;

    await this.fileGenerator.writeFileInDir("internal/provider", "config.go", configGoContent);
  }
}
