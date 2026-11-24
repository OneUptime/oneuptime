package provider

/*
 * RequireChangedTogether on its own, on a resource shaped like a monitor
 * secret: a type that changes only together with a new value. The plans
 * through the real protocol server, and the requests they make, are in
 * changestogether_plan_test.go.
 */

import (
	"context"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

var togetherSchema = schema.Schema{
	Attributes: map[string]schema.Attribute{
		"id":           schema.StringAttribute{Computed: true},
		"name":         schema.StringAttribute{Required: true},
		"secret_type":  schema.StringAttribute{Optional: true, Computed: true},
		"secret_value": schema.StringAttribute{Optional: true, Sensitive: true},
		"token":        schema.StringAttribute{Optional: true, Sensitive: true},
		"token_salt":   schema.StringAttribute{Optional: true},
	},
}

func togetherType(t *testing.T) tftypes.Object {
	t.Helper()
	objectType, ok := togetherSchema.Type().TerraformType(context.Background()).(tftypes.Object)
	if !ok {
		t.Fatalf("the schema's type is not an object")
	}
	return objectType
}

// togetherObject is a secret: its id, name, type and value (nil for null,
// tftypes.UnknownValue for a value known only at apply).
func togetherObject(t *testing.T, secretType interface{}, secretValue interface{}) tftypes.Value {
	t.Helper()
	return tftypes.NewValue(togetherType(t), map[string]tftypes.Value{
		"id":           tftypes.NewValue(tftypes.String, "5ec7e700-0000-4000-8000-000000000001"),
		"name":         tftypes.NewValue(tftypes.String, "GITHUB_SIGN_IN"),
		"secret_type":  tftypes.NewValue(tftypes.String, secretType),
		"secret_value": tftypes.NewValue(tftypes.String, secretValue),
		"token":        tftypes.NewValue(tftypes.String, nil),
		"token_salt":   tftypes.NewValue(tftypes.String, nil),
	})
}

// planTogether runs RequireChangedTogether on a plan from prior to planned,
// as the resource's ModifyPlan does, and returns its diagnostics' summaries
// and details.
func planTogether(t *testing.T, prior tftypes.Value, planned tftypes.Value, attribute string, companion string) []string {
	t.Helper()
	request := resource.ModifyPlanRequest{
		State: tfsdk.State{Schema: togetherSchema, Raw: prior},
		Plan:  tfsdk.Plan{Schema: togetherSchema, Raw: planned},
	}
	response := &resource.ModifyPlanResponse{Plan: request.Plan}

	RequireChangedTogether(context.Background(), request, response, attribute, companion)

	found := []string{}
	for _, diagnostic := range response.Diagnostics.Errors() {
		found = append(found, diagnostic.Summary()+" | "+diagnostic.Detail())
	}

	// It refuses or lets through: it never plans anything itself.
	if !response.Plan.Raw.Equal(planned) {
		t.Errorf("requireChangedTogether changed the plan")
	}
	return found
}

func TestChangedTogetherRefusesATypeChangedAlone(t *testing.T) {
	refusals := planTogether(t,
		togetherObject(t, "Text", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
		togetherObject(t, "TOTP", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
		"secret_type", "secret_value")

	if len(refusals) != 1 {
		t.Fatalf("a type changed alone: want one refusal, got %q", refusals)
	}
	want := `secret_type changes only with a new secret_value | This plan changes secret_type from "Text" to "TOTP" and keeps secret_value as it is. OneUptime changes secret_type only in the same write as a new secret_value, so the apply would fail. Give secret_value its new value in this change, or keep secret_type as it is.`
	if refusals[0] != want {
		t.Errorf("the refusal says\n  %s\nwant\n  %s", refusals[0], want)
	}
}

func TestChangedTogetherRefusesEitherWay(t *testing.T) {
	// A one-time code secret made Text with the setup key it holds: OneUptime
	// would send the key where the code went.
	refusals := planTogether(t,
		togetherObject(t, "TOTP", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
		togetherObject(t, "Text", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
		"secret_type", "secret_value")

	if len(refusals) != 1 || !strings.Contains(refusals[0], `from "TOTP" to "Text"`) {
		t.Errorf("a one-time code secret made Text with its own key: want one refusal naming the change, got %q", refusals)
	}
}

func TestChangedTogetherLetsATypeAndANewValueThrough(t *testing.T) {
	cases := []struct {
		name           string
		prior, planned tftypes.Value
	}{
		{
			"Text to TOTP with a setup key",
			togetherObject(t, "Text", "hunter2"),
			togetherObject(t, "TOTP", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
		},
		{
			"TOTP to Text with a password",
			togetherObject(t, "TOTP", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
			togetherObject(t, "Text", "correct horse battery staple"),
		},
		{
			// An import cannot read the value back: whatever is configured
			// now is new.
			"an imported secret, whose value no read returns",
			togetherObject(t, "Text", nil),
			togetherObject(t, "TOTP", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
		},
		{
			// Made by another resource in the same apply: OneUptime judges
			// it then.
			"a value known only at apply",
			togetherObject(t, "Text", "hunter2"),
			togetherObject(t, "TOTP", tftypes.UnknownValue),
		},
	}

	for _, c := range cases {
		if refusals := planTogether(t, c.prior, c.planned, "secret_type", "secret_value"); len(refusals) != 0 {
			t.Errorf("%s: refused: %q", c.name, refusals)
		}
	}
}

func TestChangedTogetherLetsEverythingElseThrough(t *testing.T) {
	cases := []struct {
		name           string
		prior, planned tftypes.Value
	}{
		{
			"a new value alone",
			togetherObject(t, "TOTP", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
			togetherObject(t, "TOTP", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"),
		},
		{
			"nothing changed",
			togetherObject(t, "Text", "hunter2"),
			togetherObject(t, "Text", "hunter2"),
		},
		{
			"a type known only at apply",
			togetherObject(t, "Text", "hunter2"),
			togetherObject(t, tftypes.UnknownValue, "hunter2"),
		},
		{
			"a create",
			tftypes.NewValue(togetherType(t), nil),
			togetherObject(t, "TOTP", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
		},
		{
			"a destroy",
			togetherObject(t, "TOTP", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
			tftypes.NewValue(togetherType(t), nil),
		},
	}

	for _, c := range cases {
		if refusals := planTogether(t, c.prior, c.planned, "secret_type", "secret_value"); len(refusals) != 0 {
			t.Errorf("%s: refused: %q", c.name, refusals)
		}
	}
}

func TestChangedTogetherRefusesAnEmptyValue(t *testing.T) {
	cases := []struct {
		name           string
		prior, planned tftypes.Value
	}{
		{
			"the value taken out of the configuration",
			togetherObject(t, "Text", "hunter2"),
			togetherObject(t, "TOTP", nil),
		},
		{
			"the value emptied",
			togetherObject(t, "Text", "hunter2"),
			togetherObject(t, "TOTP", ""),
		},
		{
			"only spaces",
			togetherObject(t, "Text", "hunter2"),
			togetherObject(t, "TOTP", "   "),
		},
		{
			"never set",
			togetherObject(t, "Text", nil),
			togetherObject(t, "TOTP", nil),
		},
	}

	for _, c := range cases {
		refusals := planTogether(t, c.prior, c.planned, "secret_type", "secret_value")
		if len(refusals) != 1 || !strings.Contains(refusals[0], "leaves secret_value empty") {
			t.Errorf("%s: want one refusal saying the value is empty, got %q", c.name, refusals)
		}
	}
}

func TestChangedTogetherNeverShowsASensitiveValue(t *testing.T) {
	prior := togetherObject(t, "Text", "hunter2")
	planned := togetherObject(t, "Text", "hunter2")

	// A sensitive attribute that changes only with another: its values stay
	// out of the sentence.
	prior = withAttribute(t, togetherType(t), prior, "token", tftypes.NewValue(tftypes.String, "old-token-value"))
	planned = withAttribute(t, togetherType(t), planned, "token", tftypes.NewValue(tftypes.String, "new-token-value"))
	prior = withAttribute(t, togetherType(t), prior, "token_salt", tftypes.NewValue(tftypes.String, "salt"))
	planned = withAttribute(t, togetherType(t), planned, "token_salt", tftypes.NewValue(tftypes.String, "salt"))

	refusals := planTogether(t, prior, planned, "token", "token_salt")
	if len(refusals) != 1 {
		t.Fatalf("want one refusal, got %q", refusals)
	}
	for _, secret := range []string{"old-token-value", "new-token-value"} {
		if strings.Contains(refusals[0], secret) {
			t.Errorf("the refusal shows a sensitive value: %s", refusals[0])
		}
	}
	if !strings.HasPrefix(refusals[0], "token changes only with a new token_salt | This plan changes token and keeps token_salt as it is.") {
		t.Errorf("the refusal says %s", refusals[0])
	}
}

func TestChangedTogetherIgnoresAttributesTheResourceHasNot(t *testing.T) {
	prior := togetherObject(t, "Text", "hunter2")
	planned := togetherObject(t, "TOTP", "hunter2")

	if refusals := planTogether(t, prior, planned, "secret_kind", "secret_value"); len(refusals) != 0 {
		t.Errorf("an attribute the resource has not: refused %q", refusals)
	}
	if refusals := planTogether(t, prior, planned, "secret_type", "secret_text"); len(refusals) != 0 {
		t.Errorf("a companion the resource has not: refused %q", refusals)
	}
}
