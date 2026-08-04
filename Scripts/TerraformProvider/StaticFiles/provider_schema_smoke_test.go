package provider

import (
	"context"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
)

// TestProviderSchemaSmoke exercises the schema of every generated resource
// and data source through the real protocol server. The framework validates
// each schema (attribute names, plan-modifier/validator placement, nested
// shapes) while building the response, so a single schema defect anywhere in
// the ~600-type surface fails this test — E2E fixtures only ever cover a
// subset, this covers everything.
func TestProviderSchemaSmoke(t *testing.T) {
	server := providerserver.NewProtocol6(New("test")())()

	resp, err := server.GetProviderSchema(
		context.Background(),
		&tfprotov6.GetProviderSchemaRequest{},
	)
	if err != nil {
		t.Fatalf("GetProviderSchema failed: %s", err)
	}

	for _, diagnostic := range resp.Diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			t.Errorf("schema diagnostic: %s — %s", diagnostic.Summary, diagnostic.Detail)
		}
	}

	// Floors, not exact counts: the API surface grows, and a collapse below
	// these numbers means generation silently dropped most of the provider.
	if len(resp.ResourceSchemas) < 200 {
		t.Errorf("expected at least 200 resource schemas, got %d", len(resp.ResourceSchemas))
	}
	if len(resp.DataSourceSchemas) < 200 {
		t.Errorf("expected at least 200 data source schemas, got %d", len(resp.DataSourceSchemas))
	}

	// Marquee types that must always exist.
	for _, name := range []string{"oneuptime_monitor", "oneuptime_status_page", "oneuptime_label"} {
		if _, ok := resp.ResourceSchemas[name]; !ok {
			t.Errorf("resource schema missing: %s", name)
		}
		if _, ok := resp.DataSourceSchemas[name]; !ok {
			t.Errorf("data source schema missing: %s", name)
		}
	}

	// The provider schema itself must be present and expose the two config
	// attributes users rely on.
	if resp.Provider == nil || resp.Provider.Block == nil {
		t.Fatal("provider schema missing")
	}
	foundAPIKey := false
	for _, attribute := range resp.Provider.Block.Attributes {
		if attribute.Name == "api_key" {
			foundAPIKey = true
			if !attribute.Sensitive {
				t.Error("api_key must be sensitive")
			}
			if attribute.Required {
				t.Error("api_key must be optional (env var fallback)")
			}
		}
	}
	if !foundAPIKey {
		t.Error("provider schema missing api_key attribute")
	}
}
