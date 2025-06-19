package oneuptime

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/resource"
)

// New returns a new provider instance.
func New() provider.Provider {
	return &OneuptimeProvider{}
}

// OneuptimeProvider defines the provider implementation.
type OneuptimeProvider struct{}

// Metadata returns the provider type name.
func (p *OneuptimeProvider) Metadata(ctx context.Context, req provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "oneuptime"
}

// Schema defines the provider-level schema for configuration data.
func (p *OneuptimeProvider) Schema(ctx context.Context, req provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = OneuptimeProviderSchema(ctx)
}

// Configure prepares a OneUptime API client for data sources and resources.
func (p *OneuptimeProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	// Configuration logic will be implemented here
}

// DataSources defines the data sources implemented in the provider.
func (p *OneuptimeProvider) DataSources(ctx context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		// Data sources will be added here
	}
}

// Resources defines the resources implemented in the provider.
func (p *OneuptimeProvider) Resources(ctx context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		// Resources will be added here
	}
}
