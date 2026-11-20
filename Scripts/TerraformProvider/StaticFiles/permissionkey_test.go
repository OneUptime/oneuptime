package provider

import (
	"context"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

func TestPermissionKeyOf_TheKeyEitherFormNames(t *testing.T) {
	cases := map[string]string{
		"IncidentMember":        "IncidentMember",
		`"IncidentMember"`:      "IncidentMember",
		"ReadProjectIncident":   "ReadProjectIncident",
		`"ReadProjectIncident"`: "ReadProjectIncident",
		`"IncidentMember"`:      "IncidentMember",
		"ProjectOwner":          "ProjectOwner",
		`"ProjectOwner"`:        "ProjectOwner",
		// What names no key is sent as written, for OneUptime to refuse.
		`{"read":true}`:     `{"read":true}`,
		`"IncidentMember`:   `"IncidentMember`,
		` IncidentMember `:  ` IncidentMember `,
		`"Incident Member"`: `"Incident Member"`,
		``:                  ``,
	}
	for written, want := range cases {
		if got := PermissionKeyOf(written); got != want {
			t.Errorf("PermissionKeyOf(%q) = %q, want %q", written, got, want)
		}
	}
}

func TestPermissionKeyNamed_OnlyOneWordOfLettersAndDigits(t *testing.T) {
	named := []string{"IncidentMember", `"IncidentMember"`, "ReadProjectIncident", "A", "Read2FA"}
	for _, written := range named {
		if _, ok := permissionKeyNamed(written); !ok {
			t.Errorf("%q names no key", written)
		}
	}

	unnamed := []string{
		"", `""`, " ", `{"read":true,"write":false,"delete":false}`, `["IncidentMember"]`,
		"42", "4Incident", " IncidentMember", "IncidentMember ", `"IncidentMember`,
		`"Incident Member"`, "Incident-Member", `""IncidentMember""`, `"\"IncidentMember\""`,
	}
	for _, written := range unnamed {
		if key, ok := permissionKeyNamed(written); ok {
			t.Errorf("%q names the key %q", written, key)
		}
	}
}

func TestSamePermissionKey(t *testing.T) {
	same := [][2]string{
		{"IncidentMember", "IncidentMember"},
		{"IncidentMember", `"IncidentMember"`},
		{`"IncidentMember"`, "IncidentMember"},
		{`"IncidentMember"`, `"IncidentMember"`},
		// Two values that name no key are the same only as the same text.
		{`{"read":true}`, `{"read":true}`},
	}
	for _, pair := range same {
		if !samePermissionKey(pair[0], pair[1]) {
			t.Errorf("%q and %q do not name the same key", pair[0], pair[1])
		}
	}

	different := [][2]string{
		{"IncidentMember", "ReadProjectIncident"},
		{`"IncidentMember"`, `"ReadProjectIncident"`},
		{"IncidentMember", `"ReadProjectIncident"`},
		{"IncidentMember", "incidentmember"},
		{"IncidentMember", " IncidentMember"},
		{`{"read":true}`, `{"read": true}`},
	}
	for _, pair := range different {
		if samePermissionKey(pair[0], pair[1]) {
			t.Errorf("%q and %q name the same key", pair[0], pair[1])
		}
	}
}

func TestPermissionKeyValue_SemanticEquality(t *testing.T) {
	ctx := context.Background()
	equal := func(a, b PermissionKeyValue) bool {
		t.Helper()
		got, diags := a.StringSemanticEquals(ctx, b)
		if diags.HasError() {
			t.Fatalf("StringSemanticEquals: %v", diags)
		}
		return got
	}

	if !equal(NewPermissionKeyValue("IncidentMember"), NewPermissionKeyValue(`"IncidentMember"`)) {
		t.Error("the key OneUptime answers is not the same as the planned jsonencode() form")
	}
	if !equal(NewPermissionKeyValue(`"IncidentMember"`), NewPermissionKeyValue("IncidentMember")) {
		t.Error("the jsonencode() form is not the same as the key in state")
	}
	if equal(NewPermissionKeyValue("ReadProjectIncident"), NewPermissionKeyValue(`"IncidentMember"`)) {
		t.Error("another key OneUptime answers is the same as the planned one")
	}
	if equal(NewPermissionKeyNull(), NewPermissionKeyValue("IncidentMember")) {
		t.Error("no permission is the same as one")
	}
	if !equal(NewPermissionKeyNull(), NewPermissionKeyNull()) {
		t.Error("two nulls are not the same")
	}
	if equal(NewPermissionKeyUnknown(), NewPermissionKeyValue("IncidentMember")) {
		t.Error("an unknown permission is the same as a known one")
	}

	// The type gives values of its own kind, from Terraform and from a string.
	fromTerraform, err := PermissionKeyType{}.ValueFromTerraform(ctx, tftypes.NewValue(tftypes.String, `"IncidentMember"`))
	if err != nil {
		t.Fatalf("ValueFromTerraform: %s", err)
	}
	value, ok := fromTerraform.(PermissionKeyValue)
	if !ok || value.ValueString() != `"IncidentMember"` {
		t.Fatalf("ValueFromTerraform gave %#v", fromTerraform)
	}
	if !value.Type(ctx).Equal(PermissionKeyType{}) {
		t.Error("a value's type is not PermissionKeyType")
	}
	fromString, diags := PermissionKeyType{}.ValueFromString(ctx, types.StringValue("IncidentMember"))
	if diags.HasError() {
		t.Fatalf("ValueFromString: %v", diags)
	}
	if _, ok := fromString.(PermissionKeyValue); !ok {
		t.Fatalf("ValueFromString gave %#v", fromString)
	}
}

func planPermission(t *testing.T, state, config types.String) types.String {
	t.Helper()
	req := planmodifier.StringRequest{
		Path:        path.Root("permission"),
		StateValue:  state,
		ConfigValue: config,
		PlanValue:   config,
	}
	resp := &planmodifier.StringResponse{PlanValue: req.PlanValue}
	PermissionKeepSameKey().PlanModifyString(context.Background(), req, resp)
	if resp.Diagnostics.HasError() {
		t.Fatalf("PlanModifyString: %v", resp.Diagnostics)
	}
	return resp.PlanValue
}

func TestPermissionKeepSameKey(t *testing.T) {
	key := types.StringValue("IncidentMember")
	encoded := types.StringValue(`"IncidentMember"`)
	other := types.StringValue("ReadProjectIncident")

	// The same key written the other way: the state's value, so no change.
	if got := planPermission(t, encoded, key); !got.Equal(encoded) {
		t.Errorf("state jsonencode(), configuration plain: planned %s", got)
	}
	if got := planPermission(t, key, encoded); !got.Equal(key) {
		t.Errorf("state plain, configuration jsonencode(): planned %s", got)
	}

	// The same text, another key, a create, or a value known only at apply: as configured.
	if got := planPermission(t, key, key); !got.Equal(key) {
		t.Errorf("the same text: planned %s", got)
	}
	if got := planPermission(t, encoded, other); !got.Equal(other) {
		t.Errorf("another key: planned %s, not the configuration's", got)
	}
	if got := planPermission(t, types.StringNull(), encoded); !got.Equal(encoded) {
		t.Errorf("a create: planned %s, not the configuration's", got)
	}
	if got := planPermission(t, key, types.StringUnknown()); !got.IsUnknown() {
		t.Errorf("a value known only at apply: planned %s", got)
	}
}

func validatePermission(written types.String) []string {
	req := validator.StringRequest{Path: path.Root("permission"), ConfigValue: written}
	resp := &validator.StringResponse{}
	PermissionKeyValidator().ValidateString(context.Background(), req, resp)
	var problems []string
	for _, diagnostic := range resp.Diagnostics.Errors() {
		problems = append(problems, diagnostic.Summary()+": "+diagnostic.Detail())
	}
	return problems
}

func TestPermissionKeyValidator(t *testing.T) {
	for _, written := range []string{"IncidentMember", `"IncidentMember"`, "ReadProjectIncident", "SomePermissionAddedLater"} {
		if problems := validatePermission(types.StringValue(written)); len(problems) > 0 {
			t.Errorf("%q was refused: %v", written, problems)
		}
	}
	for _, value := range []types.String{types.StringNull(), types.StringUnknown()} {
		if problems := validatePermission(value); len(problems) > 0 {
			t.Errorf("%s was refused: %v", value, problems)
		}
	}

	refusals := map[string]string{
		"":   "The permission is empty.",
		`""`: "The permission is empty.",
		`{"delete":false,"read":true,"write":false}`: "not a JSON object or list",
		`["IncidentMember"]`:                         "not a JSON object or list",
		"42":                                         `"42" is not a permission's key.`,
		" IncidentMember ":                           `" IncidentMember " is not a permission's key.`,
		`"IncidentMember`:                            `"\"IncidentMember" is not a permission's key.`,
		"Incident Member":                            `"Incident Member" is not a permission's key.`,
	}
	for written, want := range refusals {
		problems := validatePermission(types.StringValue(written))
		if len(problems) != 1 {
			t.Errorf("%q: %d problems, want 1: %v", written, len(problems), problems)
			continue
		}
		if !strings.HasPrefix(problems[0], "Invalid Permission: ") || !strings.Contains(problems[0], want) {
			t.Errorf("%q was refused with %q, which does not say %q", written, problems[0], want)
		}
		// Every refusal says how to write a permission.
		if !strings.Contains(problems[0], `"IncidentMember"`) {
			t.Errorf("%q was refused with %q, which shows no key", written, problems[0])
		}
	}
}
