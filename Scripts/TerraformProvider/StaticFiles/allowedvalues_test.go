package provider

import (
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// A choice says the values it takes: a column's allowedValues in Common
// (TableColumn.allowedValues), which the spec writes as the field's enum and
// the generator as a OneOf validator. A value outside them - a typo, the
// wrong case - is refused when Terraform validates the configuration, with
// the values it takes listed, before anything is asked of OneUptime. Before,
// only a monitor's type was checked; every other choice planned cleanly and
// failed, or was stored as it was, at apply.

type choice struct {
	resource  string
	attribute string
	wrong     string
	right     string
}

var choices = []choice{
	// A telemetry drop filter's action, typed string in its model.
	{resource: "oneuptime_log_drop_filter", attribute: "action", wrong: "Drop", right: "drop"},
	// A cloud account's provider, typed with its enum.
	{resource: "oneuptime_cloud_connection", attribute: "provider_value", wrong: "AWS", right: "aws"},
	// A custom field's type, which the spec called a JSON object.
	{resource: "oneuptime_incident_custom_field", attribute: "custom_field_type", wrong: "text", right: "Text"},
	// An on-call rule's when-to-page, from a base model all rules share.
	{resource: "oneuptime_incident_on_call_rule", attribute: "when_to_page", wrong: "Right away", right: "Right Away"},
}

func attributeOf(t *testing.T, tf *peopleTerraform, typeName, name string) *tfprotov6.SchemaAttribute {
	t.Helper()
	schema := tf.schemas[typeName]
	if schema == nil {
		t.Fatalf("the provider has no resource %s", typeName)
	}
	for _, attribute := range schema.Block.Attributes {
		if attribute.Name == name {
			return attribute
		}
	}
	t.Fatalf("%s has no attribute %s", typeName, name)
	return nil
}

// The refusals of a value: what a validator said, leaving out the attributes
// a configuration of one attribute does not set.
func errorsOf(diagnostics []*tfprotov6.Diagnostic) []*tfprotov6.Diagnostic {
	found := []*tfprotov6.Diagnostic{}
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError &&
			diagnostic.Summary != "Missing Configuration for Required Attribute" {
			found = append(found, diagnostic)
		}
	}
	return found
}

func TestAChoiceRefusesAValueOutsideItsValuesAtPlanTime(t *testing.T) {
	tf := newPeopleTerraform(t)

	for _, c := range choices {
		refused := tf.validate(c.resource, tf.config(c.resource, map[string]tftypes.Value{
			c.attribute: str(c.wrong),
		}))
		diagnostic := requireDiagnostic(t, refused, tfprotov6.DiagnosticSeverityError, "Invalid Attribute Value Match")
		// It says what was written, and what to write instead.
		if !strings.Contains(diagnostic.Detail, `"`+c.wrong+`"`) || !strings.Contains(diagnostic.Detail, `"`+c.right+`"`) {
			t.Fatalf("%s.%s: %s", c.resource, c.attribute, diagnostic.Detail)
		}

		taken := tf.validate(c.resource, tf.config(c.resource, map[string]tftypes.Value{
			c.attribute: str(c.right),
		}))
		if found := errorsOf(taken); len(found) > 0 {
			t.Fatalf("%s.%s refused %q: %s", c.resource, c.attribute, c.right, describeDiagnostics(found))
		}
	}

	tf.api.mu.Lock()
	defer tf.api.mu.Unlock()
	if len(tf.api.requests) > 0 {
		t.Fatalf("validating asked OneUptime: %v", tf.api.requests)
	}
}

// A value known only at apply - a reference to another resource - is left
// for the apply to send.
func TestAChoiceKnownOnlyAtApplyIsNotCheckedYet(t *testing.T) {
	tf := newPeopleTerraform(t)

	for _, c := range choices {
		unknown := tf.validate(c.resource, tf.config(c.resource, map[string]tftypes.Value{
			c.attribute: tftypes.NewValue(tftypes.String, tftypes.UnknownValue),
		}))
		if found := errorsOf(unknown); len(found) > 0 {
			t.Fatalf("%s.%s: %s", c.resource, c.attribute, describeDiagnostics(found))
		}
	}
}

// Written as the plain word the API takes, not as JSON.
func TestACustomFieldTypeIsAPlainString(t *testing.T) {
	tf := newPeopleTerraform(t)

	attribute := attributeOf(t, tf, "oneuptime_incident_custom_field", "custom_field_type")
	if !attribute.Type.Is(tftypes.String) {
		t.Fatalf("custom_field_type is %s", attribute.Type)
	}
	if strings.Contains(attribute.Description, "jsonencode") {
		t.Fatalf("custom_field_type says to write JSON: %s", attribute.Description)
	}
}

// A probe, an AI agent and a Runner are made from their name: OneUptime
// generates their key, which the configuration reads back to install them,
// and starts their version at 1.0.0. A key never has to be written into a
// configuration, and stays out of every plan and log (Sensitive).
func TestAProbeAnAIAgentAndARunnerNeedOnlyTheirName(t *testing.T) {
	tf := newPeopleTerraform(t)

	for _, filled := range []struct {
		resource  string
		attribute string
		sensitive bool
	}{
		{resource: "oneuptime_probe", attribute: "key", sensitive: true},
		{resource: "oneuptime_probe", attribute: "probe_version"},
		{resource: "oneuptime_ai_agent", attribute: "key", sensitive: true},
		{resource: "oneuptime_ai_agent", attribute: "ai_agent_version"},
		{resource: "oneuptime_runner", attribute: "key", sensitive: true},
	} {
		attribute := attributeOf(t, tf, filled.resource, filled.attribute)
		if attribute.Required || !attribute.Optional || !attribute.Computed {
			t.Fatalf("%s.%s: required %t, optional %t, computed %t", filled.resource, filled.attribute, attribute.Required, attribute.Optional, attribute.Computed)
		}
		if attribute.Sensitive != filled.sensitive {
			t.Fatalf("%s.%s: sensitive %t", filled.resource, filled.attribute, attribute.Sensitive)
		}
		if !strings.Contains(attribute.Description, "Leave it out and") {
			t.Fatalf("%s.%s does not say what happens when it is left out: %s", filled.resource, filled.attribute, attribute.Description)
		}
	}

	for _, resource := range []string{"oneuptime_probe", "oneuptime_ai_agent", "oneuptime_runner"} {
		required := []string{}
		for _, attribute := range tf.schemas[resource].Block.Attributes {
			if attribute.Required {
				required = append(required, attribute.Name)
			}
		}
		if strings.Join(required, ",") != "name" {
			t.Fatalf("%s requires %v, not just its name", resource, required)
		}
	}
}
