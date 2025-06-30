import { TerraformProviderConfig, OpenAPISpec } from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { GoCodeGenerator } from "./GoCodeGenerator";

export class ProviderGenerator {
  private config: TerraformProviderConfig;
  private spec: OpenAPISpec;
  private fileGenerator: FileGenerator;

  public constructor(config: TerraformProviderConfig, spec: OpenAPISpec) {
    this.config = config;
    this.spec = spec;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  public async generateProvider(): Promise<void> {
    await this.generateProviderGo();
    await this.generateClientGo();
    await this.generateConfigGo();
  }

  private async generateProviderGo(): Promise<void> {
    const providerGoContent: string = `package provider

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
    OneuptimeUrl types.String \`tfsdk:"oneuptime_url"\`
    ApiKey       types.String \`tfsdk:"api_key"\`
}

func (p *${StringUtils.toPascalCase(this.config.providerName)}Provider) Metadata(ctx context.Context, req provider.MetadataRequest, resp *provider.MetadataResponse) {
    resp.TypeName = "${this.config.providerName}"
    resp.Version = p.version
}

func (p *${StringUtils.toPascalCase(this.config.providerName)}Provider) Schema(ctx context.Context, req provider.SchemaRequest, resp *provider.SchemaResponse) {
    resp.Schema = schema.Schema{
        MarkdownDescription: "${GoCodeGenerator.escapeString(this.spec.info.description || `Terraform provider for ${this.config.providerName}`)}",

        Attributes: map[string]schema.Attribute{
            "oneuptime_url": schema.StringAttribute{
                MarkdownDescription: "The ${this.config.providerName} URL (without /api path). Defaults to 'oneuptime.com' if not specified. The provider automatically appends '/api' to the URL.",
                Optional:            true,
            },
            "api_key": schema.StringAttribute{
                MarkdownDescription: "API key for authentication",
                Required:            true,
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
    var oneuptimeUrl string
    var apiKey string

    if data.OneuptimeUrl.IsUnknown() {
        // Cannot connect to client with an unknown value
        resp.Diagnostics.AddWarning(
            "Unable to create client",
            "Cannot use unknown value as oneuptime_url",
        )
        return
    }

    if data.OneuptimeUrl.IsNull() {
        oneuptimeUrl = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_URL")
        if oneuptimeUrl == "" {
            oneuptimeUrl = "oneuptime.com"
        }
    } else {
        oneuptimeUrl = data.OneuptimeUrl.ValueString()
    }

    if data.ApiKey.IsUnknown() {
        // Cannot connect to client with an unknown value
        resp.Diagnostics.AddWarning(
            "Unable to create client",
            "Cannot use unknown value as api_key",
        )
        return
    }

    if data.ApiKey.IsNull() {
        apiKey = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_API_KEY")
        if apiKey == "" {
            resp.Diagnostics.AddError(
                "Missing API Key",
                "API key is required for authentication. "+
                    "Please provide it via the api_key attribute or the ${StringUtils.toConstantCase(this.config.providerName)}_API_KEY environment variable.",
            )
            return
        }
    } else {
        apiKey = data.ApiKey.ValueString()
    }

    client, err := NewClient(oneuptimeUrl, apiKey)
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
    return GetResources()
}

func (p *${StringUtils.toPascalCase(this.config.providerName)}Provider) DataSources(ctx context.Context) []func() datasource.DataSource {
    return GetDataSources()
}

func New(version string) func() provider.Provider {
    return func() provider.Provider {
        return &${StringUtils.toPascalCase(this.config.providerName)}Provider{
            version: version,
        }
    }
}
`;

    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      "provider.go",
      providerGoContent,
    );
  }

  private async generateClientGo(): Promise<void> {
    const clientGoContent: string = `package provider

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
}

// NewClient creates a new API client
func NewClient(oneuptimeUrl, apiKey string) (*Client, error) {
    // Ensure the oneuptimeUrl has the correct scheme
    if !strings.HasPrefix(oneuptimeUrl, "http://") && !strings.HasPrefix(oneuptimeUrl, "https://") {
        oneuptimeUrl = "https://" + oneuptimeUrl
    }

    // Append /api to the oneuptimeUrl
    if !strings.HasSuffix(oneuptimeUrl, "/api") {
        oneuptimeUrl = strings.TrimSuffix(oneuptimeUrl, "/") + "/api"
    }

    // Parse and validate the URL
    parsedURL, err := url.Parse(oneuptimeUrl)
    if err != nil {
        return nil, fmt.Errorf("invalid oneuptime_url: %w", err)
    }

    client := &Client{
        BaseURL: parsedURL.String(),
        HTTPClient: &http.Client{
            Timeout: time.Second * 30,
        },
        ApiKey: apiKey,
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
        req.Header.Set("APIKey", c.ApiKey)
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

// PostWithSelect performs a POST request with select parameter to fetch full object
func (c *Client) PostWithSelect(path string, selectParam interface{}) (*http.Response, error) {
    requestBody := map[string]interface{}{
        "select": selectParam,
    }
    return c.DoRequest("POST", path, requestBody)
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

    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      "client.go",
      clientGoContent,
    );
  }

  private async generateConfigGo(): Promise<void> {
    const configGoContent: string = `package provider

import (
    "context"
    "os"

    "github.com/hashicorp/terraform-plugin-framework/diag"
)

// Config holds the provider configuration
type Config struct {
    OneuptimeUrl string
    ApiKey       string
    Client       *Client
}

// NewConfig creates a new configuration from the provider model
func NewConfig(ctx context.Context, model ${StringUtils.toPascalCase(this.config.providerName)}ProviderModel) (*Config, diag.Diagnostics) {
    var diags diag.Diagnostics

    config := &Config{}

    // Set oneuptime_url
    if model.OneuptimeUrl.IsNull() {
        config.OneuptimeUrl = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_URL")
        if config.OneuptimeUrl == "" {
            config.OneuptimeUrl = "oneuptime.com"
        }
    } else {
        config.OneuptimeUrl = model.OneuptimeUrl.ValueString()
    }

    // Set API key
    if model.ApiKey.IsNull() {
        config.ApiKey = os.Getenv("${StringUtils.toConstantCase(this.config.providerName)}_API_KEY")
        if config.ApiKey == "" {
            diags.AddError(
                "Missing API Key",
                "API key is required for authentication. "+
                    "Please provide it via the api_key attribute or the ${StringUtils.toConstantCase(this.config.providerName)}_API_KEY environment variable.",
            )
            return nil, diags
        }
    } else {
        config.ApiKey = model.ApiKey.ValueString()
    }

    // Create client
    client, err := NewClient(config.OneuptimeUrl, config.ApiKey)
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

    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      "config.go",
      configGoContent,
    );
  }
}
