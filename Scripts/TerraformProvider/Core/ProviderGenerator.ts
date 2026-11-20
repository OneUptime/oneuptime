import { TerraformProviderConfig, OpenAPISpec } from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { GoCodeGenerator } from "./GoCodeGenerator";
import {
  API_KEY_ATTRIBUTE_DESCRIPTION,
  PROVIDER_DESCRIPTION,
  URL_ATTRIBUTE_DESCRIPTION,
} from "./ProviderWords";
import {
  NAME_TAKEN_REFUSAL_CODE,
  REFUSAL_CODE_FIELD,
} from "Common/Types/Exception/NameTakenException";

export class ProviderGenerator {
  private config: TerraformProviderConfig;
  private fileGenerator: FileGenerator;

  /*
   * The spec is no longer read here: the provider describes itself in its
   * own words (ProviderWords), not with the API document's.
   */
  public constructor(config: TerraformProviderConfig, _spec: OpenAPISpec) {
    this.config = config;
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

    // What a Crossplane manifest last applied, for the one managed resource
    // a provider made for its reconcile plans (NewUnderCrossplane,
    // shared.go). Nil under Terraform.
    lastApplied *LastApplied
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
        MarkdownDescription: "${GoCodeGenerator.escapeString(PROVIDER_DESCRIPTION)}",

        Attributes: map[string]schema.Attribute{
            "oneuptime_url": schema.StringAttribute{
                MarkdownDescription: "${GoCodeGenerator.escapeString(URL_ATTRIBUTE_DESCRIPTION)}",
                Optional:            true,
            },
            "api_key": schema.StringAttribute{
                MarkdownDescription: "${GoCodeGenerator.escapeString(API_KEY_ATTRIBUTE_DESCRIPTION)}",
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
    var oneuptimeUrl string
    var apiKey string

    if data.OneuptimeUrl.IsUnknown() {
        resp.Diagnostics.AddError(
            "Unknown Provider Configuration",
            "oneuptime_url is not known at configure time. Set it to a static value or resolve the reference before applying.",
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
        resp.Diagnostics.AddError(
            "Unknown Provider Configuration",
            "api_key is not known at configure time. Set it to a static value or resolve the reference before applying.",
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

    client, err := NewClient(oneuptimeUrl, apiKey, p.version)
    if err != nil {
        resp.Diagnostics.AddError(
            "Unable to Create ${StringUtils.toPascalCase(this.config.providerName)} API Client",
            "An unexpected error occurred when creating the ${StringUtils.toPascalCase(this.config.providerName)} API client. "+
                "If the error is not clear, please contact the provider developers.\\n\\n"+
                "${StringUtils.toPascalCase(this.config.providerName)} Client Error: "+err.Error(),
        )
        return
    }

    client.lastApplied = p.lastApplied

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

// NewUnderCrossplane returns the provider for one Crossplane reconcile of one
// managed resource: what its manifest last applied reaches the plan of the
// attributes people and OneUptime both change (shared.go). xpprovider calls
// it.
func NewUnderCrossplane(version string, lastApplied LastApplied) func() provider.Provider {
    return func() provider.Provider {
        return &${StringUtils.toPascalCase(this.config.providerName)}Provider{
            version:     version,
            lastApplied: &lastApplied,
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
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "regexp"
    "strings"
    "time"

    "github.com/hashicorp/terraform-plugin-log/tflog"
)

// Client represents the API client for ${this.config.providerName}
type Client struct {
    BaseURL    string
    HTTPClient *http.Client
    ApiKey     string
    UserAgent  string

    // The people this provider process has found by email address or ID
    // (people.go), so one person named by many resources is looked up once.
    people peopleDirectory

    // How long a create or an update refused only because another record
    // has the name is asked again (askAgainWhileNameIsTaken).
    nameTakenRetry nameTakenRetry

    // What the Crossplane manifest of the resource this provider plans last
    // applied (shared.go). Nil under Terraform.
    lastApplied *LastApplied
}

// NewClient creates a new API client
func NewClient(oneuptimeUrl, apiKey, version string) (*Client, error) {
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
            Timeout: time.Second * 60,
        },
        ApiKey:         apiKey,
        UserAgent:      "terraform-provider-${this.config.providerName}/" + version,
        nameTakenRetry: defaultNameTakenRetry,
    }

    return client, nil
}

// DoRequest performs an HTTP request. The context propagates Terraform's
// cancellation and deadlines into the HTTP layer. A create or an update the
// server refused only because another record has the name it asks for is
// asked again for a while first (askAgainWhileNameIsTaken).
func (c *Client) DoRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
    resp, err := c.doRequestOnce(ctx, method, path, body)
    if err != nil || !writesARecord(method) {
        return resp, err
    }

    return c.askAgainWhileNameIsTaken(ctx, method, path, body, resp)
}

// doRequestOnce performs one HTTP request, asked again only after a failure
// that says nothing about the request: a read's or a delete's 429 or 5xx.
func (c *Client) doRequestOnce(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
    // Construct the full URL
    fullURL := c.BaseURL + path

    var jsonBody []byte
    if body != nil {
        var err error
        jsonBody, err = json.Marshal(body)
        if err != nil {
            return nil, fmt.Errorf("failed to marshal request body: %w", err)
        }
    }

    buildRequest := func() (*http.Request, error) {
        var bodyReader io.Reader
        if jsonBody != nil {
            bodyReader = bytes.NewBuffer(jsonBody)
        }
        req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
        if err != nil {
            return nil, fmt.Errorf("failed to create request: %w", err)
        }
        req.Header.Set("Content-Type", "application/json")
        req.Header.Set("Accept", "application/json")
        req.Header.Set("User-Agent", c.UserAgent)
        if c.ApiKey != "" {
            req.Header.Set("APIKey", c.ApiKey)
        }
        return req, nil
    }

    /*
     * Reads and deletes are safe to retry; creates and updates are not
     * (retrying a POST after an ambiguous failure could duplicate the
     * resource). Retry only on 429 and transient 5xx.
     */
    idempotent := method == "GET" || method == "DELETE" || strings.HasSuffix(path, "/get-item") || strings.HasSuffix(path, "/get-list") || strings.HasSuffix(path, "/count")
    attempts := 1
    if idempotent {
        attempts = 3
    }

    var resp *http.Response
    for attempt := 0; attempt < attempts; attempt++ {
        if attempt > 0 {
            select {
            case <-ctx.Done():
                return nil, ctx.Err()
            case <-time.After(time.Duration(500*(1<<attempt)) * time.Millisecond):
            }
        }

        req, err := buildRequest()
        if err != nil {
            return nil, err
        }

        resp, err = c.HTTPClient.Do(req)
        if err != nil {
            if attempt == attempts-1 {
                return nil, fmt.Errorf("failed to execute request: %w", err)
            }
            continue
        }

        if resp.StatusCode == http.StatusTooManyRequests ||
            resp.StatusCode == http.StatusBadGateway ||
            resp.StatusCode == http.StatusServiceUnavailable ||
            resp.StatusCode == http.StatusGatewayTimeout {
            if attempt < attempts-1 {
                resp.Body.Close()
                continue
            }
        }

        return resp, nil
    }

    return resp, nil
}

/*
 * A NAME ANOTHER RECORD HAS, ASKED AGAIN WHILE ANOTHER RESOURCE GIVES IT UP
 * (OneUptime/oneuptime#9855).
 *
 * Teams, labels, on-call policies and on-call schedules each have a name of
 * their own in a project: a create, or a rename, onto a name another one
 * has is refused with 400, and nothing is written. Terraform makes the
 * independent changes of one apply side by side, so in a chain of renames
 * (A becomes B while B becomes C) A's rename is refused whenever it runs
 * before B's has given the name up. Asked again a moment later, it goes
 * through, and the chain converges in one apply.
 *
 * The refusal is told apart by the code the server sends beside its message
 * (Common/Types/Exception/NameTakenException.ts, whose constants these
 * are), never by its English, which may be reworded. Any other answer is
 * handed back at once, and so is the refusal of a server from before the
 * code, as it always was.
 *
 * A swap (A and B for each other) or any cycle never goes through: none of
 * its renames can go first. Once nameTakenRetry.window has passed since the
 * first refusal, the refusal is handed back as it came, and ParseResponse
 * says to go by way of a temporary name (nameTakenAdvice).
 */
const (
    refusalCodeField     = "${REFUSAL_CODE_FIELD}"
    nameTakenRefusalCode = "${NAME_TAKEN_REFUSAL_CODE}"
)

// How long, and how often, a refusal of a name another record has is asked again.
type nameTakenRetry struct {
    // How long, from the first refusal. Zero never asks again.
    window time.Duration
    // The wait before asking again the first time. Each wait doubles...
    firstWait time.Duration
    // ...up to this.
    maxWait time.Duration
}

var defaultNameTakenRetry = nameTakenRetry{
    window:    30 * time.Second,
    firstWait: 500 * time.Millisecond,
    maxWait:   5 * time.Second,
}

// A create (POST) or an update (PUT, PATCH): the requests a name is refused on.
func writesARecord(method string) bool {
    return method == "POST" || method == "PUT" || method == "PATCH"
}

// askAgainWhileNameIsTaken asks for the write again, with backoff, for as
// long as the server refuses it because another record has the name and
// nameTakenRetry.window has not passed. A refused write wrote nothing, so
// asking again is safe, a create's POST included.
func (c *Client) askAgainWhileNameIsTaken(ctx context.Context, method, path string, body interface{}, resp *http.Response) (*http.Response, error) {
    retry := c.nameTakenRetry
    if retry.window <= 0 {
        return resp, nil
    }
    if retry.firstWait <= 0 {
        retry.firstWait = defaultNameTakenRetry.firstWait
    }
    if retry.maxWait < retry.firstWait {
        retry.maxWait = retry.firstWait
    }

    deadline := time.Now().Add(retry.window)
    wait := retry.firstWait

    for {
        refused, err := isNameTakenResponse(resp)
        if err != nil {
            return nil, err
        }

        remaining := time.Until(deadline)
        if !refused || remaining <= 0 {
            return resp, nil
        }

        // The last time is asked when the window ends, not after it.
        if wait > remaining {
            wait = remaining
        }

        tflog.Debug(ctx, "OneUptime refused a name another record has; asking again, in case another resource of this apply is giving it up", map[string]any{
            "method": method,
            "path":   path,
            "wait":   wait.String(),
        })

        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case <-time.After(wait):
        }

        resp, err = c.doRequestOnce(ctx, method, path, body)
        if err != nil {
            return nil, err
        }

        wait *= 2
        if wait > retry.maxWait {
            wait = retry.maxWait
        }
    }
}

// isNameTakenResponse reports whether resp is a refusal of a name another
// record has. It reads a 400's body to tell, and puts it back for the caller.
func isNameTakenResponse(resp *http.Response) (bool, error) {
    if resp == nil || resp.StatusCode != http.StatusBadRequest {
        return false, nil
    }

    body, err := io.ReadAll(resp.Body)
    resp.Body.Close()
    if err != nil {
        return false, fmt.Errorf("failed to read response body: %w", err)
    }
    resp.Body = io.NopCloser(bytes.NewReader(body))

    return isNameTakenRefusal(body), nil
}

// isNameTakenRefusal reports whether an error body carries the code of a
// refusal of a name another record has, beside its message.
func isNameTakenRefusal(body []byte) bool {
    var parsed map[string]interface{}
    if err := json.Unmarshal(body, &parsed); err != nil {
        return false
    }

    code, _ := parsed[refusalCodeField].(string)
    return code == nameTakenRefusalCode
}

// nameTakenAdvice is what a refusal of a name another record has adds to the
// server's own words once it has been asked again for the whole window: no
// resource of this apply gave the name up.
func (c *Client) nameTakenAdvice() string {
    advice := "If resources in this configuration swap names, or rename each other in a cycle, none of them can go first: give one of them a temporary name, apply, then apply the names you want."
    if c.nameTakenRetry.window <= 0 {
        return advice
    }

    return fmt.Sprintf("The name was still taken after asking again for %s. %s", describeWait(c.nameTakenRetry.window), advice)
}

// describeWait says a wait as an error message does: "30 seconds", "250ms".
func describeWait(wait time.Duration) string {
    if wait < time.Second || wait%time.Second != 0 {
        return wait.String()
    }

    seconds := int(wait / time.Second)
    if seconds == 1 {
        return "1 second"
    }

    return fmt.Sprintf("%d seconds", seconds)
}

// Get performs a GET request
func (c *Client) Get(ctx context.Context, path string) (*http.Response, error) {
    return c.DoRequest(ctx, "GET", path, nil)
}

// Post performs a POST request
func (c *Client) Post(ctx context.Context, path string, body interface{}) (*http.Response, error) {
    return c.DoRequest(ctx, "POST", path, body)
}

// Put performs a PUT request
func (c *Client) Put(ctx context.Context, path string, body interface{}) (*http.Response, error) {
    return c.DoRequest(ctx, "PUT", path, body)
}

// Patch performs a PATCH request
func (c *Client) Patch(ctx context.Context, path string, body interface{}) (*http.Response, error) {
    return c.DoRequest(ctx, "PATCH", path, body)
}

// Delete performs a DELETE request
func (c *Client) Delete(ctx context.Context, path string) (*http.Response, error) {
    return c.DoRequest(ctx, "DELETE", path, nil)
}

// DeleteWithBody performs a DELETE request whose body says what the delete
// takes besides the record, in miscDataProps (deletechoices.go). A nil body
// sends none - never "null", which the API would refuse - so a delete that
// says nothing is the delete it always was.
func (c *Client) DeleteWithBody(ctx context.Context, path string, body map[string]interface{}) (*http.Response, error) {
    if body == nil {
        return c.DoRequest(ctx, "DELETE", path, nil)
    }
    return c.DoRequest(ctx, "DELETE", path, body)
}

/*
 * Server phrasings that name one column the select has to give up on. They are
 * matched against the DECODED error message (apiErrorMessage), never the raw
 * response body: the unknown-column phrasing quotes the column name, and the
 * API JSON-encodes its errors, so on the wire those quotes arrive backslash-
 * escaped. A pattern anchored on a bare quote therefore never fires
 * against raw bytes, which is exactly how the unknown-column phrasing went
 * unhandled while the (quote-free) permission phrasing kept working. The
 * optional backslash keeps every pattern honest on the fallback path too,
 * where apiErrorMessage hands back an undecodable body verbatim.
 */
var droppableSelectColumnPatterns = []*regexp.Regexp{
    // "You do not have permissions to select on - serviceLanguage."
    regexp.MustCompile(\`select on - ([A-Za-z0-9_]+)\`),
    // Invalid select clause. Cannot select on "enableSearchEngineIndexing".
    regexp.MustCompile(\`Cannot select on \\\\?"([A-Za-z0-9_]+)\`),
    // ClickHouse-backed models reject an unknown column more tersely.
    regexp.MustCompile(\`Unknown column: ([A-Za-z0-9_]+)\`),
    // A root or master-admin caller (a self-hosted master API key) skips the
    // select permission check, and the model's column metadata refuses an
    // unknown column instead: "TableColumnMetadata not found for X column".
    regexp.MustCompile(\`TableColumnMetadata not found for ([A-Za-z0-9_]+) column\`),
}

// droppableSelectColumn returns the column named by a select-rejection error
// response, or "" when the body is not one.
func droppableSelectColumn(body []byte) string {
    message := apiErrorMessage(body)
    for _, pattern := range droppableSelectColumnPatterns {
        if match := pattern.FindStringSubmatch(message); match != nil {
            return match[1]
        }
    }
    return ""
}

// PostWithSelect performs a POST request with a select parameter. When the
// server rejects a column in the select (permission-gated columns, or
// columns this server version does not know about yet), that column is
// dropped and the request retried — a version- or permission-skewed column
// must not fail the entire read.
func (c *Client) PostWithSelect(ctx context.Context, path string, selectParam interface{}) (*http.Response, error) {
    return c.PostBodyWithSelect(ctx, path, map[string]interface{}{
        "select": selectParam,
    })
}

// PostBodyWithSelect is PostWithSelect for callers whose request body carries
// more than the select — the data sources' by-name lookup also sends "query"
// and "limit". Everything other than the rejected column survives each retry.
func (c *Client) PostBodyWithSelect(ctx context.Context, path string, requestBody map[string]interface{}) (*http.Response, error) {
    selectMap, _ := requestBody["select"].(map[string]interface{})

    // One attempt per droppable column, bounded to keep worst cases sane.
    maxAttempts := 8
    for attempt := 0; attempt < maxAttempts; attempt++ {
        resp, err := c.DoRequest(ctx, "POST", path, requestBody)
        if err != nil {
            return nil, err
        }
        if selectMap == nil ||
            (resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusUnprocessableEntity) {
            return resp, nil
        }

        body, readErr := io.ReadAll(resp.Body)
        resp.Body.Close()
        if readErr != nil {
            return nil, fmt.Errorf("failed to read response body: %w", readErr)
        }

        rebuilt := func() *http.Response {
            resp.Body = io.NopCloser(bytes.NewReader(body))
            return resp
        }
        column := droppableSelectColumn(body)
        if column == "" {
            // Not a select-column rejection: surface the original error.
            return rebuilt(), nil
        }
        if _, present := selectMap[column]; !present {
            return rebuilt(), nil
        }
        delete(selectMap, column)

        /*
         * A dropped column leaves its attribute null in state, which shows up
         * later as an "inconsistent result after apply" or a spurious diff.
         * Say so at WARN rather than letting the read look clean.
         */
        tflog.Warn(ctx, "OneUptime rejected a column in the select; dropping it and retrying", map[string]any{
            "path":   path,
            "column": column,
        })
    }

    return c.DoRequest(ctx, "POST", path, requestBody)
}

// apiErrorMessage extracts the server's human-readable error message from an
// error response body, falling back to the raw body.
func apiErrorMessage(body []byte) string {
    var parsed map[string]interface{}
    if err := json.Unmarshal(body, &parsed); err == nil {
        for _, key := range []string{"message", "error", "errorMessage"} {
            if msg, ok := parsed[key].(string); ok && msg != "" {
                return msg
            }
        }
    }
    trimmed := strings.TrimSpace(string(body))
    if trimmed == "" {
        return "(empty response body)"
    }
    return trimmed
}

// ParseResponse parses an HTTP response into a struct
func (c *Client) ParseResponse(resp *http.Response, target interface{}) error {
    defer resp.Body.Close()

    if resp.StatusCode >= 400 {
        body, _ := io.ReadAll(resp.Body)
        message := apiErrorMessage(body)

        // A name another record still has: what to do when it is one of this configuration's.
        if resp.StatusCode == http.StatusBadRequest && isNameTakenRefusal(body) {
            message += " " + c.nameTakenAdvice()
        }

        return fmt.Errorf("the OneUptime API returned status %d: %s", resp.StatusCode, message)
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
    client, err := NewClient(config.OneuptimeUrl, config.ApiKey, "dev")
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
