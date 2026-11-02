package provider

import (
	"context"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

func validateRecordID(v recordIDValidator, value types.String) validator.StringResponse {
	resp := validator.StringResponse{}
	v.ValidateString(context.Background(), validator.StringRequest{
		Path:        path.Root("team_id"),
		ConfigValue: value,
	}, &resp)
	return resp
}

func TestRecordIDValidatorTakesAUUID(t *testing.T) {
	v := recordIDValidator{resourceType: "oneuptime_team"}

	for _, id := range []string{
		"550e8400-e29b-41d4-a716-446655440000",
		"550E8400-E29B-41D4-A716-446655440000",
		"5a0e0000-0000-4000-8000-000000000001",
	} {
		if resp := validateRecordID(v, types.StringValue(id)); resp.Diagnostics.HasError() {
			t.Fatalf("%s was refused: %v", id, resp.Diagnostics)
		}
	}

	// Known only at apply, or not set: nothing to check yet.
	for _, value := range []types.String{types.StringUnknown(), types.StringNull()} {
		if resp := validateRecordID(v, value); resp.Diagnostics.HasError() {
			t.Fatalf("%s was refused: %v", value, resp.Diagnostics)
		}
	}
}

func TestRecordIDValidatorRefusesANameAndSaysWhatToWrite(t *testing.T) {
	v := recordIDValidator{resourceType: "oneuptime_team"}

	for _, value := range []string{
		"sre",
		"",
		"550e8400e29b41d4a716446655440000",
		"550e8400-e29b-41d4-a716-44665544000",
		" 550e8400-e29b-41d4-a716-446655440000",
		"{550e8400-e29b-41d4-a716-446655440000}",
	} {
		resp := validateRecordID(v, types.StringValue(value))
		if !resp.Diagnostics.HasError() {
			t.Fatalf("%q was taken for an ID", value)
		}
		detail := resp.Diagnostics[0].Detail()
		if resp.Diagnostics[0].Summary() != "Not an ID" ||
			!strings.Contains(detail, "is not the ID of a oneuptime_team") ||
			!strings.Contains(detail, "oneuptime_team.<name>.id") {
			t.Fatalf("%q: %s: %s", value, resp.Diagnostics[0].Summary(), detail)
		}
	}
}

// A record OneUptime makes itself (an AI run, a scan) has a data source and
// no resource: the refusal points at the data source, never at a resource
// a configuration cannot have.
func TestRecordIDValidatorOfADataSourceOnlyTypePointsAtTheDataSource(t *testing.T) {
	one := validateRecordID(dataSourceRecordIDValidators("oneuptime_ai_run")[0].(recordIDValidator), types.StringValue("last-night"))
	if !one.Diagnostics.HasError() {
		t.Fatal("a name was taken for an ID")
	}
	if detail := one.Diagnostics[0].Detail(); !strings.Contains(detail, "is not the ID of a oneuptime_ai_run") ||
		!strings.Contains(detail, "Read the ID with the oneuptime_ai_run data source.") ||
		strings.Contains(detail, "oneuptime_ai_run.<name>.id") {
		t.Fatalf("detail: %s", detail)
	}

	// A set and a list of them say the same, and take UUIDs.
	for _, set := range dataSourceRecordIDSetValidators("oneuptime_ai_run") {
		resp := &validator.SetResponse{}
		set.ValidateSet(context.Background(), validator.SetRequest{
			Path:        path.Root("ai_run_ids"),
			ConfigValue: types.SetValueMust(types.StringType, []attr.Value{types.StringValue("last-night"), types.StringValue("550e8400-e29b-41d4-a716-446655440000")}),
		}, resp)
		if resp.Diagnostics.ErrorsCount() != 1 || !strings.Contains(resp.Diagnostics[0].Detail(), "Read the ID with the oneuptime_ai_run data source.") {
			t.Fatalf("set: %v", resp.Diagnostics)
		}
	}
	for _, list := range dataSourceRecordIDListValidators("oneuptime_ai_run") {
		resp := &validator.ListResponse{}
		list.ValidateList(context.Background(), validator.ListRequest{
			Path:        path.Root("ai_run_ids"),
			ConfigValue: types.ListValueMust(types.StringType, []attr.Value{types.StringValue("550e8400-e29b-41d4-a716-446655440000")}),
		}, resp)
		if resp.Diagnostics.HasError() {
			t.Fatalf("list: %v", resp.Diagnostics)
		}
	}

	// A person is still named by their address, whatever the type has.
	resp := validateRecordID(recordIDValidator{resourceType: personResourceType, dataSourceOnly: true}, types.StringValue("alice"))
	if detail := resp.Diagnostics[0].Detail(); !strings.Contains(detail, "is not a user ID") {
		t.Fatalf("person: %s", detail)
	}
}

func TestRecordIDValidatorPointsAPersonAtTheirAddress(t *testing.T) {
	resp := validateRecordID(recordIDValidator{resourceType: personResourceType, emailAttribute: "user_email"}, types.StringValue("alice@example.com"))
	if !resp.Diagnostics.HasError() {
		t.Fatal("an address was taken for a user ID")
	}
	if detail := resp.Diagnostics[0].Detail(); !strings.Contains(detail, "is not a user ID") || !strings.Contains(detail, "in user_email, instead") {
		t.Fatalf("detail: %s", detail)
	}
}

// Through the provider's protocol server, as terraform validate and plan
// call it: a name where a team's ID goes, and an address where a user ID
// goes, are refused before anything is asked of OneUptime.
func TestAnIDAttributeRefusesANameAtPlanTime(t *testing.T) {
	tf := newPeopleTerraform(t)

	byName := tf.validate(teamMemberType, tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id":    str("sre"),
		"user_email": str("alice@example.com"),
	}))
	requireDiagnostic(t, byName, tfprotov6.DiagnosticSeverityError, "is not the ID of a oneuptime_team")

	byAddress := tf.validate(teamMemberType, tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id": str(peopleTeamID),
		"user_id": str("alice@example.com"),
	}))
	requireDiagnostic(t, byAddress, tfprotov6.DiagnosticSeverityError, "in user_email, instead")

	byID := tf.validate(teamMemberType, tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id": str(peopleTeamID),
		"user_id": str(aliceID),
	}))
	for _, diagnostic := range byID {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			t.Fatalf("IDs were refused: %s: %s", diagnostic.Summary, diagnostic.Detail)
		}
	}

	// A data source looks up by an ID the same way.
	_, diagnostics := tf.lookUp("oneuptime_team_member", map[string]tftypes.Value{
		"team_id": str("sre"),
	})
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "is not the ID of a oneuptime_team")

	tf.api.mu.Lock()
	defer tf.api.mu.Unlock()
	for _, request := range tf.api.requests {
		if strings.Contains(request, "/team-member") {
			t.Fatalf("validating asked OneUptime: %s", request)
		}
	}
}
