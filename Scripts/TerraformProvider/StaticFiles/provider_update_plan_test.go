package provider

import (
	"context"
	"sort"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// TestUpdatePlansReplaceOnlyWhatChanged plans a create and then an update of
// every generated resource through the real protocol server, and requires the
// update to replace the resource for no attribute but the one it changed.
//
// The state between the two plans is the create plan with every unknown
// value null: what a resource looks like after the server returned nothing
// for the fields it fills in itself, such as a monitor's
// incoming_monitor_request or a probe's last_alive. Those fields are
// writable at create and never at update, so the generator gives them
// UseStateForUnknown followed by RequiresReplace. That only works from
// terraform-plugin-framework v1.15.1, where UseStateForUnknown keeps a null
// prior value: before it, the field plans as unknown, RequiresReplace sees
// null -> unknown, and every update of the resource destroys and re-creates
// it. go.mod's floors (Core/GoModuleGenerator.ts) are what the provider is
// built from whenever `go get -u` fails, so they must not fall below that
// version; this test fails on any build where they do.
func TestUpdatePlansReplaceOnlyWhatChanged(t *testing.T) {
	ctx := context.Background()
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema failed: %s", err)
	}

	names := make([]string, 0, len(schemas.ResourceSchemas))
	for name := range schemas.ResourceSchemas {
		names = append(names, name)
	}
	sort.Strings(names)

	planned := 0
	for _, name := range names {
		schema := schemas.ResourceSchemas[name]
		changed := writableStringAttribute(schema)
		if changed == "" {
			continue
		}
		objectType, ok := schema.ValueType().(tftypes.Object)
		if !ok {
			t.Errorf("%s: schema type is %s, not an object", name, schema.ValueType())
			continue
		}

		createConfig := objectWith(objectType, map[string]tftypes.Value{
			changed: tftypes.NewValue(tftypes.String, "before"),
		})
		created := planChange(ctx, t, server, name, objectType,
			tftypes.NewValue(objectType, nil), createConfig, createConfig)
		if created == nil {
			continue
		}

		state, err := tftypes.Transform(*created, func(_ *tftypes.AttributePath, value tftypes.Value) (tftypes.Value, error) {
			if !value.IsKnown() {
				return tftypes.NewValue(value.Type(), nil), nil
			}
			return value, nil
		})
		if err != nil {
			t.Errorf("%s: %s", name, err)
			continue
		}
		state = withAttribute(t, objectType, state, "id", tftypes.NewValue(tftypes.String, "00000000-0000-0000-0000-000000000001"))

		updateConfig := objectWith(objectType, map[string]tftypes.Value{
			changed: tftypes.NewValue(tftypes.String, "after"),
		})
		// What Terraform proposes: the config, with the prior state's value
		// for every computed attribute the config leaves null.
		proposed := withAttribute(t, objectType, state, changed, tftypes.NewValue(tftypes.String, "after"))

		response := planResponse(ctx, t, server, name, objectType, state, proposed, updateConfig)
		if response == nil {
			continue
		}
		planned++

		changedPath := tftypes.NewAttributePath().WithAttributeName(changed)
		for _, path := range response.RequiresReplace {
			if !path.Equal(changedPath) {
				t.Errorf("%s: changing %s plans a replacement because of %s", name, changed, path)
			}
		}
	}

	// A floor, not a count: if most resources stopped being planned, this
	// test would pass while checking nothing.
	if planned < 200 {
		t.Errorf("planned an update of %d resources, expected at least 200", planned)
	}
}

// writableStringAttribute names a string attribute the configuration can set
// (preferring description, the field updates most often touch), or "" when
// the resource has none.
func writableStringAttribute(schema *tfprotov6.Schema) string {
	if schema.Block == nil {
		return ""
	}
	for _, preferred := range []string{"description", "name"} {
		for _, attribute := range schema.Block.Attributes {
			if attribute.Name == preferred &&
				(attribute.Optional || attribute.Required) &&
				attribute.Type != nil && attribute.Type.Is(tftypes.String) {
				return attribute.Name
			}
		}
	}
	return ""
}

// objectWith is an object of the resource's type with every attribute null
// except the ones given.
func objectWith(objectType tftypes.Object, values map[string]tftypes.Value) tftypes.Value {
	attributes := make(map[string]tftypes.Value, len(objectType.AttributeTypes))
	for attributeName, attributeType := range objectType.AttributeTypes {
		attributes[attributeName] = tftypes.NewValue(attributeType, nil)
	}
	for attributeName, value := range values {
		attributes[attributeName] = value
	}
	return tftypes.NewValue(objectType, attributes)
}

// withAttribute is a copy of the object with one attribute set. A copy: As
// hands back the object's own map, so writing to it would change the
// object passed in too.
func withAttribute(t *testing.T, objectType tftypes.Object, object tftypes.Value, attributeName string, value tftypes.Value) tftypes.Value {
	t.Helper()
	current := map[string]tftypes.Value{}
	if err := object.As(&current); err != nil {
		t.Fatalf("reading %s: %s", objectType, err)
	}
	if _, ok := objectType.AttributeTypes[attributeName]; !ok {
		return object
	}
	attributes := make(map[string]tftypes.Value, len(current))
	for name, existing := range current {
		attributes[name] = existing
	}
	attributes[attributeName] = value
	return tftypes.NewValue(objectType, attributes)
}

// planChange plans the change and returns the planned state, or nil (having
// reported why) when the provider refused to plan it.
func planChange(ctx context.Context, t *testing.T, server tfprotov6.ProviderServer, name string, objectType tftypes.Object, prior, proposed, config tftypes.Value) *tftypes.Value {
	t.Helper()
	response := planResponse(ctx, t, server, name, objectType, prior, proposed, config)
	if response == nil {
		return nil
	}
	planned, err := response.PlannedState.Unmarshal(objectType)
	if err != nil {
		t.Errorf("%s: reading the planned state: %s", name, err)
		return nil
	}
	return &planned
}

func planResponse(ctx context.Context, t *testing.T, server tfprotov6.ProviderServer, name string, objectType tftypes.Object, prior, proposed, config tftypes.Value) *tfprotov6.PlanResourceChangeResponse {
	t.Helper()
	priorValue, err := tfprotov6.NewDynamicValue(objectType, prior)
	if err != nil {
		t.Fatalf("%s: %s", name, err)
	}
	proposedValue, err := tfprotov6.NewDynamicValue(objectType, proposed)
	if err != nil {
		t.Fatalf("%s: %s", name, err)
	}
	configValue, err := tfprotov6.NewDynamicValue(objectType, config)
	if err != nil {
		t.Fatalf("%s: %s", name, err)
	}

	response, err := server.PlanResourceChange(ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         name,
		PriorState:       &priorValue,
		ProposedNewState: &proposedValue,
		Config:           &configValue,
	})
	if err != nil {
		t.Errorf("%s: PlanResourceChange failed: %s", name, err)
		return nil
	}
	failed := false
	for _, diagnostic := range response.Diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			t.Errorf("%s: plan diagnostic: %s - %s", name, diagnostic.Summary, diagnostic.Detail)
			failed = true
		}
	}
	if failed || response.PlannedState == nil {
		return nil
	}
	return response
}
