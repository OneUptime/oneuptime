package xpprovider

import (
	"context"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/resource"
)

// The Crossplane provider configures what FrameworkProvider returns with
// oneuptime_url and api_key, and names its managed resources after the
// Terraform resources it lists: all three must hold for it to work.
func TestFrameworkProviderIsTheOneUptimeProvider(t *testing.T) {
	ctx := context.Background()
	p := FrameworkProvider("1.2.3")

	var meta provider.MetadataResponse
	p.Metadata(ctx, provider.MetadataRequest{}, &meta)
	if meta.TypeName != "oneuptime" {
		t.Fatalf("type name = %q, want oneuptime", meta.TypeName)
	}
	if meta.Version != "1.2.3" {
		t.Fatalf("version = %q, want the one passed in", meta.Version)
	}

	var schema provider.SchemaResponse
	p.Schema(ctx, provider.SchemaRequest{}, &schema)
	if schema.Diagnostics.HasError() {
		t.Fatalf("schema: %v", schema.Diagnostics)
	}
	for _, name := range []string{"oneuptime_url", "api_key"} {
		if _, ok := schema.Schema.Attributes[name]; !ok {
			t.Errorf("the provider configuration has no %s", name)
		}
	}

	names := map[string]bool{}
	for _, newResource := range p.Resources(ctx) {
		var resp resource.MetadataResponse
		newResource().Metadata(ctx, resource.MetadataRequest{ProviderTypeName: meta.TypeName}, &resp)
		names[resp.TypeName] = true
	}
	for _, name := range []string{"oneuptime_monitor", "oneuptime_status_page", "oneuptime_team", "oneuptime_label"} {
		if !names[name] {
			t.Errorf("the provider has no %s resource", name)
		}
	}
}

// Every call starts a provider of its own, so two ProviderConfigs (two
// projects, or two OneUptime servers) never share a configured client.
func TestFrameworkProviderReturnsANewInstanceEachTime(t *testing.T) {
	if FrameworkProvider("a") == FrameworkProvider("a") {
		t.Fatal("two calls returned the same provider instance")
	}
}
