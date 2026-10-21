package provider

import (
	"context"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// The old names of renamed resources and data sources must keep working:
// registered, marked deprecated, with the same schema as the new name, and a
// resource's state must move over to the new name with a moved block.

func resourceTypeName(t *testing.T, r resource.Resource) string {
	t.Helper()
	resp := &resource.MetadataResponse{}
	r.Metadata(context.Background(), resource.MetadataRequest{ProviderTypeName: "oneuptime"}, resp)
	return resp.TypeName
}

func dataSourceTypeName(t *testing.T, d datasource.DataSource) string {
	t.Helper()
	resp := &datasource.MetadataResponse{}
	d.Metadata(context.Background(), datasource.MetadataRequest{ProviderTypeName: "oneuptime"}, resp)
	return resp.TypeName
}

func registeredResourceTypes(t *testing.T) map[string]bool {
	t.Helper()
	names := map[string]bool{}
	for _, newResource := range GetResources() {
		name := resourceTypeName(t, newResource())
		if names[name] {
			t.Fatalf("resource type %s is registered twice", name)
		}
		names[name] = true
	}
	return names
}

func TestLegacyResourceAliasesAreRegisteredUnderBothNames(t *testing.T) {
	registered := registeredResourceTypes(t)

	for _, alias := range legacyResourceAliases {
		if alias.Name == alias.LegacyName {
			t.Errorf("alias for %s repeats its own name", alias.Name)
		}
		if got := resourceTypeName(t, alias.New()); got != "oneuptime_"+alias.Name {
			t.Errorf("New for %s registers %s", alias.Name, got)
		}
		if got := resourceTypeName(t, alias.NewLegacy()); got != "oneuptime_"+alias.LegacyName {
			t.Errorf("NewLegacy for %s registers %s", alias.Name, got)
		}
		for _, name := range []string{alias.Name, alias.LegacyName} {
			if !registered["oneuptime_"+name] {
				t.Errorf("oneuptime_%s is not registered by GetResources", name)
			}
		}
	}
}

func TestLegacyResourceAliasesAreDeprecatedWithTheSameSchema(t *testing.T) {
	ctx := context.Background()

	for _, alias := range legacyResourceAliases {
		current := &resource.SchemaResponse{}
		alias.New().Schema(ctx, resource.SchemaRequest{}, current)
		legacy := &resource.SchemaResponse{}
		alias.NewLegacy().Schema(ctx, resource.SchemaRequest{}, legacy)

		if current.Schema.DeprecationMessage != "" {
			t.Errorf("oneuptime_%s is deprecated: %s", alias.Name, current.Schema.DeprecationMessage)
		}
		if !strings.Contains(legacy.Schema.DeprecationMessage, "oneuptime_"+alias.Name) ||
			!strings.Contains(legacy.Schema.DeprecationMessage, "moved") {
			t.Errorf("oneuptime_%s's deprecation does not point at oneuptime_%s and a moved block: %q", alias.LegacyName, alias.Name, legacy.Schema.DeprecationMessage)
		}

		if !current.Schema.Type().TerraformType(ctx).Equal(legacy.Schema.Type().TerraformType(ctx)) {
			t.Errorf("oneuptime_%s and oneuptime_%s have different schemas", alias.Name, alias.LegacyName)
		}
	}
}

// moveState runs a resource's state movers the way the framework does:
// decoding the raw source state with each mover's SourceSchema, ignoring
// attributes that schema does not have.
func moveState(t *testing.T, r resource.Resource, sourceTypeName string, sourceProvider string, rawJSON string) *resource.MoveStateResponse {
	t.Helper()
	ctx := context.Background()

	withMove, ok := r.(resource.ResourceWithMoveState)
	if !ok {
		t.Fatalf("%s does not implement MoveState", resourceTypeName(t, r))
	}

	target := &resource.SchemaResponse{}
	r.Schema(ctx, resource.SchemaRequest{}, target)
	targetType := target.Schema.Type().TerraformType(ctx)

	for _, mover := range withMove.MoveState(ctx) {
		req := resource.MoveStateRequest{
			SourceProviderAddress: sourceProvider,
			SourceRawState:        &tfprotov6.RawState{JSON: []byte(rawJSON)},
			SourceTypeName:        sourceTypeName,
		}
		if mover.SourceSchema != nil {
			value, err := req.SourceRawState.UnmarshalWithOpts(
				mover.SourceSchema.Type().TerraformType(ctx),
				tfprotov6.UnmarshalOpts{ValueFromJSONOpts: tftypes.ValueFromJSONOpts{IgnoreUndefinedAttributes: true}},
			)
			if err != nil {
				t.Fatalf("source state does not decode: %s", err)
			}
			req.SourceState = &tfsdk.State{Raw: value, Schema: *mover.SourceSchema}
		}

		resp := &resource.MoveStateResponse{
			TargetState: tfsdk.State{Schema: target.Schema, Raw: tftypes.NewValue(targetType, nil)},
		}
		mover.StateMover(ctx, req, resp)

		if resp.Diagnostics.HasError() || !resp.TargetState.Raw.IsNull() {
			return resp
		}
	}

	return nil
}

func TestLegacyResourceStateMovesToTheNewName(t *testing.T) {
	ctx := context.Background()

	for _, alias := range legacyResourceAliases {
		// "version" was dropped from the schema; old state still carries it.
		resp := moveState(t, alias.New(), "oneuptime_"+alias.LegacyName, "registry.terraform.io/oneuptime/oneuptime",
			`{"id": "7d4c3d6e-0f6e-4c1b-9b5a-0d6f1c2e3a4b", "version": 3}`)

		if resp == nil {
			t.Errorf("oneuptime_%s: no mover took state from oneuptime_%s", alias.Name, alias.LegacyName)
			continue
		}
		if resp.Diagnostics.HasError() {
			t.Errorf("oneuptime_%s: moving state failed: %v", alias.Name, resp.Diagnostics)
			continue
		}

		var id string
		if diags := resp.TargetState.GetAttribute(ctx, path.Root("id"), &id); diags.HasError() {
			t.Errorf("oneuptime_%s: moved state has no id: %v", alias.Name, diags)
			continue
		}
		if id != "7d4c3d6e-0f6e-4c1b-9b5a-0d6f1c2e3a4b" {
			t.Errorf("oneuptime_%s: moved state has id %q", alias.Name, id)
		}
	}
}

func TestLegacyResourceStateMoverIgnoresOtherSources(t *testing.T) {
	for _, alias := range legacyResourceAliases {
		for _, source := range []struct{ typeName, provider string }{
			{"oneuptime_some_other_type", "registry.terraform.io/oneuptime/oneuptime"},
			{"oneuptime_" + alias.LegacyName, "registry.terraform.io/someone-else/oneuptime"},
		} {
			if resp := moveState(t, alias.New(), source.typeName, source.provider, `{"id": "x"}`); resp != nil {
				t.Errorf("oneuptime_%s took state from %s (%s)", alias.Name, source.typeName, source.provider)
			}
		}

		// The alias itself takes no moves: there is nothing to move into it.
		if withMove, ok := alias.NewLegacy().(resource.ResourceWithMoveState); ok {
			if movers := withMove.MoveState(context.Background()); len(movers) != 0 {
				t.Errorf("oneuptime_%s offers state movers", alias.LegacyName)
			}
		}
	}
}

func TestOneUptimeProviderAddresses(t *testing.T) {
	for address, want := range map[string]bool{
		"registry.terraform.io/oneuptime/oneuptime": true,
		"registry.opentofu.org/oneuptime/oneuptime": true,
		"registry.terraform.io/OneUptime/OneUptime": true,
		"oneuptime/oneuptime":                       true,
		"registry.terraform.io/hashicorp/random":    false,
		"registry.terraform.io/acme/oneuptime":      false,
		"":                                          false,
	} {
		if got := isOneUptimeProviderAddress(address); got != want {
			t.Errorf("isOneUptimeProviderAddress(%q) = %v, want %v", address, got, want)
		}
	}
}

func TestLegacyDataSourceAliasesAreRegisteredAndDeprecated(t *testing.T) {
	ctx := context.Background()

	registered := map[string]bool{}
	for _, newDataSource := range GetDataSources() {
		name := dataSourceTypeName(t, newDataSource())
		if registered[name] {
			t.Fatalf("data source type %s is registered twice", name)
		}
		registered[name] = true
	}

	for _, alias := range legacyDataSourceAliases {
		for _, name := range []string{alias.Name, alias.LegacyName} {
			if !registered["oneuptime_"+name] {
				t.Errorf("data source oneuptime_%s is not registered", name)
			}
		}

		current := &datasource.SchemaResponse{}
		alias.New().Schema(ctx, datasource.SchemaRequest{}, current)
		legacy := &datasource.SchemaResponse{}
		alias.NewLegacy().Schema(ctx, datasource.SchemaRequest{}, legacy)

		if current.Schema.DeprecationMessage != "" {
			t.Errorf("data source oneuptime_%s is deprecated", alias.Name)
		}
		if !strings.Contains(legacy.Schema.DeprecationMessage, "oneuptime_"+alias.Name) {
			t.Errorf("data source oneuptime_%s's deprecation does not point at oneuptime_%s", alias.LegacyName, alias.Name)
		}
		if !current.Schema.Type().TerraformType(ctx).Equal(legacy.Schema.Type().TerraformType(ctx)) {
			t.Errorf("data sources oneuptime_%s and oneuptime_%s have different schemas", alias.Name, alias.LegacyName)
		}
	}
}
