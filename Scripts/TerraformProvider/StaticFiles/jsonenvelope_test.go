package provider

import (
	"context"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

func runEnvelopeValidator(t *testing.T, value types.String) *validator.StringResponse {
	t.Helper()
	req := validator.StringRequest{
		Path:        path.Root("monitor_criteria"),
		ConfigValue: value,
	}
	resp := &validator.StringResponse{}
	JSONEnvelopeValidator().ValidateString(context.Background(), req, resp)
	return resp
}

func TestEnvelopeValidator_ValidEnvelopePasses(t *testing.T) {
	value := `{"_type":"MonitorCriteria","value":{"monitorCriteriaInstanceArray":[]}}`
	resp := runEnvelopeValidator(t, types.StringValue(value))
	if resp.Diagnostics.HasError() {
		t.Fatalf("expected valid envelope to pass, got: %v", resp.Diagnostics)
	}
}

func TestEnvelopeValidator_ValidDateTimePasses(t *testing.T) {
	value := `{"_type":"DateTime","value":"2030-06-01T10:00:00.000Z"}`
	resp := runEnvelopeValidator(t, types.StringValue(value))
	if resp.Diagnostics.HasError() {
		t.Fatalf("expected valid DateTime to pass, got: %v", resp.Diagnostics)
	}
}

func TestEnvelopeValidator_UnknownTypeFails(t *testing.T) {
	// "Date-Time" and "date" were common misspellings in bug reports.
	value := `{"_type":"Date-Time","value":"2030-06-01T10:00:00Z"}`
	resp := runEnvelopeValidator(t, types.StringValue(value))
	if !resp.Diagnostics.HasError() {
		t.Fatal("expected unknown _type to fail validation")
	}
}

func TestEnvelopeValidator_BadDateTimeValueFails(t *testing.T) {
	// The exact mistake from issue #2242: a bare date where RFC3339 is needed.
	value := `{"_type":"DateTime","value":"June 1 2030"}`
	resp := runEnvelopeValidator(t, types.StringValue(value))
	if !resp.Diagnostics.HasError() {
		t.Fatal("expected unparseable DateTime value to fail validation")
	}
}

func TestEnvelopeValidator_NestedTypesAreChecked(t *testing.T) {
	value := `{"_type":"MonitorSteps","value":{"monitorStepsInstanceArray":[{"_type":"MonitorStepp","value":{}}]}}`
	resp := runEnvelopeValidator(t, types.StringValue(value))
	if !resp.Diagnostics.HasError() {
		t.Fatal("expected nested unknown _type to fail validation")
	}
}

func TestEnvelopeValidator_MalformedJSONFails(t *testing.T) {
	value := `{"_type":"MonitorCriteria","value":`
	resp := runEnvelopeValidator(t, types.StringValue(value))
	if !resp.Diagnostics.HasError() {
		t.Fatal("expected malformed JSON to fail validation")
	}
}

func TestEnvelopeValidator_RawScalarStringsSkip(t *testing.T) {
	// Complex-typed fields sometimes hold raw scalars (Color hex codes).
	for _, value := range []string{"#FF0000", "1.2.3", "", "plain text"} {
		resp := runEnvelopeValidator(t, types.StringValue(value))
		if resp.Diagnostics.HasError() {
			t.Fatalf("expected raw scalar %q to be skipped, got: %v", value, resp.Diagnostics)
		}
	}
}

func TestEnvelopeValidator_NullAndUnknownSkip(t *testing.T) {
	if resp := runEnvelopeValidator(t, types.StringNull()); resp.Diagnostics.HasError() {
		t.Fatal("null must not be validated")
	}
	if resp := runEnvelopeValidator(t, types.StringUnknown()); resp.Diagnostics.HasError() {
		t.Fatal("unknown must not be validated")
	}
}

func TestEnvelopeValidator_JSONArrayIsWalked(t *testing.T) {
	value := `[{"_type":"NotARealType","value":1}]`
	resp := runEnvelopeValidator(t, types.StringValue(value))
	if !resp.Diagnostics.HasError() {
		t.Fatal("expected array-wrapped unknown _type to fail validation")
	}
}
