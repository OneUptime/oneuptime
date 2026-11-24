package provider

/*
 * How a field a configuration leaves out of a record that exists plans
 * (crossplane.go): under Terraform an attribute with a default plans its
 * default, as ever; under Crossplane it keeps the record's value, so a
 * spec.initProvider field or a dashboard's change is never put back. On
 * its own, against a schema with each kind of attribute, and through the
 * real protocol server with a monitor.
 */

import (
	"context"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// runUnderCrossplane has the test plan as Crossplane does, and Terraform
// again after it.
func runUnderCrossplane(t *testing.T) {
	t.Helper()
	before := underCrossplane.Load()
	RunUnderCrossplane()
	t.Cleanup(func() { underCrossplane.Store(before) })
}

func runUnderTerraform(t *testing.T) {
	t.Helper()
	before := underCrossplane.Load()
	underCrossplane.Store(false)
	t.Cleanup(func() { underCrossplane.Store(before) })
}

var leftOutSchema = schema.Schema{
	Attributes: map[string]schema.Attribute{
		"id":          schema.StringAttribute{Computed: true},
		"name":        schema.StringAttribute{Required: true},
		"description": schema.StringAttribute{Optional: true, Computed: true},
		"enabled":     schema.BoolAttribute{Optional: true, Computed: true, Default: booldefault.StaticBool(false)},
		"webhook_url": schema.StringAttribute{Optional: true},
	},
}

var leftOutType = tftypes.Object{AttributeTypes: map[string]tftypes.Type{
	"id": tftypes.String, "name": tftypes.String, "description": tftypes.String,
	"enabled": tftypes.Bool, "webhook_url": tftypes.String,
}}

func leftOutObject(values map[string]tftypes.Value) tftypes.Value {
	all := map[string]tftypes.Value{}
	for name, attributeType := range leftOutType.AttributeTypes {
		all[name] = tftypes.NewValue(attributeType, nil)
	}
	for name, value := range values {
		all[name] = value
	}
	return tftypes.NewValue(leftOutType, all)
}

// planLeftOut is the plan KeepLeftOutUnderCrossplane makes of a record in
// `prior`, a configuration and the plan the framework made of it (defaults
// in), and what it replaces the record for.
func planLeftOut(t *testing.T, prior, config, planned tftypes.Value, replaces path.Paths) (map[string]tftypes.Value, path.Paths) {
	t.Helper()
	req := resource.ModifyPlanRequest{
		Config: tfsdk.Config{Schema: leftOutSchema, Raw: config},
		State:  tfsdk.State{Schema: leftOutSchema, Raw: prior},
		Plan:   tfsdk.Plan{Schema: leftOutSchema, Raw: planned},
	}
	resp := &resource.ModifyPlanResponse{Plan: req.Plan, RequiresReplace: replaces}
	KeepLeftOutUnderCrossplane(context.Background(), req, resp)
	values := map[string]tftypes.Value{}
	if err := resp.Plan.Raw.As(&values); err != nil {
		t.Fatal(err)
	}
	return values, resp.RequiresReplace
}

var (
	leftOutPrior = leftOutObject(map[string]tftypes.Value{
		"id":          tftypes.NewValue(tftypes.String, "5ec7e700-0000-4000-8000-000000000001"),
		"name":        tftypes.NewValue(tftypes.String, "Homepage"),
		"description": tftypes.NewValue(tftypes.String, "Changed in the dashboard"),
		"enabled":     tftypes.NewValue(tftypes.Bool, true),
		"webhook_url": tftypes.NewValue(tftypes.String, "https://hooks.example.com/1"),
	})
	// The configuration gives the name alone.
	leftOutConfig = leftOutObject(map[string]tftypes.Value{
		"name": tftypes.NewValue(tftypes.String, "Homepage"),
	})
	// What the framework plans of it: the default, the rest as it was, the
	// write-only URL taken out.
	leftOutPlanned = leftOutObject(map[string]tftypes.Value{
		"id":          tftypes.NewValue(tftypes.String, "5ec7e700-0000-4000-8000-000000000001"),
		"name":        tftypes.NewValue(tftypes.String, "Homepage"),
		"description": tftypes.NewValue(tftypes.String, "Changed in the dashboard"),
		"enabled":     tftypes.NewValue(tftypes.Bool, false),
	})
)

func TestUnderTerraformALeftOutAttributePlansItsDefault(t *testing.T) {
	runUnderTerraform(t)
	planned, replaces := planLeftOut(t, leftOutPrior, leftOutConfig, leftOutPlanned, path.Paths{path.Root("enabled")})
	if !planned["enabled"].Equal(tftypes.NewValue(tftypes.Bool, false)) {
		t.Errorf("enabled plans %s, want its default, false", planned["enabled"])
	}
	if len(replaces) != 1 {
		t.Errorf("the replacement was dropped: %v", replaces)
	}
}

func TestUnderCrossplaneALeftOutAttributeKeepsTheRecordsValue(t *testing.T) {
	runUnderCrossplane(t)
	planned, replaces := planLeftOut(t, leftOutPrior, leftOutConfig, leftOutPlanned, path.Paths{path.Root("enabled"), path.Root("name")})

	if !planned["enabled"].Equal(tftypes.NewValue(tftypes.Bool, true)) {
		t.Errorf("enabled plans %s, want the record's, true", planned["enabled"])
	}
	if !planned["description"].Equal(tftypes.NewValue(tftypes.String, "Changed in the dashboard")) {
		t.Errorf("description plans %s, want the record's", planned["description"])
	}
	// A write-only attribute left out is still taken out, as the configuration says.
	if !planned["webhook_url"].IsNull() {
		t.Errorf("webhook_url plans %s, want it taken out", planned["webhook_url"])
	}
	// The default planned a replacement; the value kept replaces nothing.
	if len(replaces) != 1 || !replaces[0].Equal(path.Root("name")) {
		t.Errorf("replaces for %v, want name alone", replaces)
	}
	// The plan the framework made is left as it was: a new one is planned.
	given := map[string]tftypes.Value{}
	if err := leftOutPlanned.As(&given); err != nil {
		t.Fatal(err)
	}
	if !given["enabled"].Equal(tftypes.NewValue(tftypes.Bool, false)) {
		t.Errorf("the framework's plan was changed in place: enabled is %s", given["enabled"])
	}
}

func TestUnderCrossplaneAConfiguredValueAndACreatePlanAsEver(t *testing.T) {
	runUnderCrossplane(t)

	// A value the configuration gives plans as it says.
	config := leftOutObject(map[string]tftypes.Value{
		"name":    tftypes.NewValue(tftypes.String, "Homepage"),
		"enabled": tftypes.NewValue(tftypes.Bool, false),
	})
	planned, _ := planLeftOut(t, leftOutPrior, config, leftOutPlanned, nil)
	if !planned["enabled"].Equal(tftypes.NewValue(tftypes.Bool, false)) {
		t.Errorf("a configured enabled plans %s, want false", planned["enabled"])
	}

	// A create has no record to keep: the default is what it creates.
	nothing := tftypes.NewValue(leftOutType, nil)
	created := leftOutObject(map[string]tftypes.Value{
		"id":      tftypes.NewValue(tftypes.String, tftypes.UnknownValue),
		"name":    tftypes.NewValue(tftypes.String, "Homepage"),
		"enabled": tftypes.NewValue(tftypes.Bool, false),
	})
	planned, _ = planLeftOut(t, nothing, leftOutConfig, created, nil)
	if !planned["enabled"].Equal(tftypes.NewValue(tftypes.Bool, false)) {
		t.Errorf("a create plans enabled %s, want its default", planned["enabled"])
	}
}

// Through the protocol server: a monitor whose manifest leaves out that its
// monitoring is off, as spec.initProvider does once the record exists.
func TestUnderCrossplaneAMonitorKeepsItsMonitoringOffWhenTheManifestLeavesItOut(t *testing.T) {
	tf := newServerOwnedTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(), nil)

	created := tf.config(map[string]tftypes.Value{
		"name":                      str("Homepage"),
		"monitor_type":              str("Manual"),
		"disable_active_monitoring": tftypes.NewValue(tftypes.Bool, true),
	})
	state := tf.apply(nothing, created)
	leftOut := tf.config(map[string]tftypes.Value{
		"name":         str("Homepage"),
		"monitor_type": str("Manual"),
	})

	runUnderTerraform(t)
	planned, _ := tf.plan(state, leftOut)
	if got := attributesOf(t, planned)["disable_active_monitoring"]; !got.Equal(tftypes.NewValue(tftypes.Bool, false)) {
		t.Errorf("under Terraform, leaving it out plans %s, want monitoring back on", got)
	}

	runUnderCrossplane(t)
	tf.requireNoChanges(state, leftOut)
}
