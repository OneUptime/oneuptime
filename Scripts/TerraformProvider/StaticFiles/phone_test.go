package provider

/*
 * Phone numbers as OneUptime keeps them (phone.go, OneUptime/oneuptime#7777).
 *
 * The rule is checked against testdata/phone_numbers.json. The generator
 * writes it from the server's own code each time it runs
 * (Scripts/TerraformProvider/Core/PhoneCases.ts): each number as written and
 * what Common/Types/Phone.ts keeps for it, or that it refuses it. A rule the
 * server changes and the provider does not fails here. The rest are the
 * provider's own: the comparison after an apply, a refresh and an import,
 * the plan, and the validator.
 */

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-framework/types/basetypes"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// phoneCases is testdata/phone_numbers.json.
type phoneCases struct {
	About string `json:"about"`
	Cases []struct {
		Written string `json:"written"`
		// What OneUptime keeps, or nil when it refuses the number.
		Stored *string `json:"stored"`
	} `json:"cases"`
}

func readPhoneCases(t *testing.T) phoneCases {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "phone_numbers.json"))
	if err != nil {
		t.Fatalf("reading the cases the generator writes from the server's code (Scripts/TerraformProvider/Core/PhoneCases.ts) - generate the provider again: %s", err)
	}
	var cases phoneCases
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("reading testdata/phone_numbers.json: %s", err)
	}
	return cases
}

func TestPhoneAsStored_KeepsEachNumberAsTheServerDoes(t *testing.T) {
	cases := readPhoneCases(t)

	kept, refused := 0, 0
	for _, tc := range cases.Cases {
		got, ok := phoneAsStored(tc.Written)
		if tc.Stored == nil {
			refused++
			if ok {
				t.Errorf("%q: the server refuses it, the provider keeps it as %q", tc.Written, got)
			}
			continue
		}
		kept++
		if !ok {
			t.Errorf("%q: the server keeps it as %q, the provider refuses it", tc.Written, *tc.Stored)
			continue
		}
		if got != *tc.Stored {
			t.Errorf("%q: the server keeps it as %q, the provider as %q", tc.Written, *tc.Stored, got)
		}
	}

	// An empty or one-sided file would pass while checking nothing.
	if kept < 30 || refused < 10 {
		t.Fatalf("the cases keep %d numbers and refuse %d: expected at least 30 and 10", kept, refused)
	}
}

func TestPhoneAsStored_KeepsWhatTheServerKeepsAsItIs(t *testing.T) {
	// The server reads a stored number through the same rule each time it
	// reads the row (Phone.fromDatabase), and an import reads it into state.
	for _, tc := range readPhoneCases(t).Cases {
		if tc.Stored == nil {
			continue
		}
		if got, ok := phoneAsStored(*tc.Stored); !ok || got != *tc.Stored {
			t.Errorf("the stored %q reads as %q (taken: %v)", *tc.Stored, got, ok)
		}
	}
}

func phoneSemanticEqual(t *testing.T, newState, plan PhoneValue) bool {
	t.Helper()
	// The framework calls it as newState.StringSemanticEquals(ctx, plannedValue).
	equal, diags := newState.StringSemanticEquals(context.Background(), plan)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}
	return equal
}

func TestPhoneValue_TheSameNumberAsOneUptimeKeepsIt(t *testing.T) {
	for _, tc := range []struct {
		answered, written string
	}{
		{"+14155550100", "+1 415 555 0100"},
		{"+442079460958", "+44 20 7946 0958"},
		{"+14155550100", "+1 (415) 555-0100"},
		{"+15551234567", "+1-555-123-4567"},
		{"+14155550100", " +14155550100 "},
		{"(415) 555-0100", "(415) 555-0100"},
		// Two spellings of a number OneUptime keeps as its digits.
		{"+1 415 555 0100", "+1.415.555.0100"},
		// The same text, whatever it is.
		{"not a number", "not a number"},
	} {
		if !phoneSemanticEqual(t, NewPhoneValue(tc.answered), NewPhoneValue(tc.written)) {
			t.Errorf("%q answered for %q is not the same number", tc.answered, tc.written)
		}
	}
}

func TestPhoneValue_AnotherNumberIsAChange(t *testing.T) {
	for _, tc := range []struct {
		name              string
		answered, written PhoneValue
	}{
		{"another number", NewPhoneValue("+14155550101"), NewPhoneValue("+1 415 555 0100")},
		// OneUptime keeps "(415) 555-0100" as it is written, so it answers
		// that, never "4155550100", for it.
		{"kept as written", NewPhoneValue("4155550100"), NewPhoneValue("(415) 555-0100")},
		{"with and without the country code", NewPhoneValue("+14155550100"), NewPhoneValue("415 555 0100")},
		{"a number OneUptime refuses", NewPhoneValue("+14155550100"), NewPhoneValue("+1 415 555 0100 ext. 5")},
		{"refused over a number", NewPhoneValue("+1 415 555 0100 ext. 5"), NewPhoneValue("+14155550100")},
		{"null", NewPhoneNull(), NewPhoneValue("+14155550100")},
		{"null written", NewPhoneValue("+14155550100"), NewPhoneNull()},
		{"unknown", NewPhoneUnknown(), NewPhoneValue("+14155550100")},
	} {
		if phoneSemanticEqual(t, tc.answered, tc.written) {
			t.Errorf("%s: %s answered for %s is the same number", tc.name, tc.answered, tc.written)
		}
	}

	if !phoneSemanticEqual(t, NewPhoneNull(), NewPhoneNull()) || !phoneSemanticEqual(t, NewPhoneUnknown(), NewPhoneUnknown()) {
		t.Error("two nulls or two unknowns are not the same")
	}

	// Another type is never the same number.
	equal, _ := NewPhoneValue("+14155550100").StringSemanticEquals(context.Background(), NewRFC3339Value("+14155550100"))
	if equal {
		t.Error("a phone number is the same as a timestamp's text")
	}
}

func TestPhoneType_IsAStringTypeOfItsOwn(t *testing.T) {
	ctx := context.Background()
	phoneType := PhoneType{}

	value, err := phoneType.ValueFromTerraform(ctx, tftypes.NewValue(tftypes.String, "+1 415 555 0100"))
	if err != nil {
		t.Fatalf("ValueFromTerraform: %s", err)
	}
	phone, ok := value.(PhoneValue)
	if !ok || phone.ValueString() != "+1 415 555 0100" {
		t.Fatalf("ValueFromTerraform gave %#v", value)
	}
	if !phone.Type(ctx).Equal(phoneType) || phoneType.Equal(RFC3339Type{}) || phoneType.Equal(JSONSubsetType{}) {
		t.Fatal("PhoneType is not a type of its own")
	}
	if phoneType.String() != "PhoneType" {
		t.Fatalf("PhoneType's name is %q", phoneType.String())
	}
	if _, ok := phoneType.ValueType(ctx).(PhoneValue); !ok {
		t.Fatal("PhoneType's value type is not PhoneValue")
	}
	fromString, diags := phoneType.ValueFromString(ctx, basetypes.NewStringValue("+14155550100"))
	if diags.HasError() || !fromString.(PhoneValue).Equal(NewPhoneValue("+14155550100")) {
		t.Fatalf("ValueFromString gave %#v", fromString)
	}
	null, err := phoneType.ValueFromTerraform(ctx, tftypes.NewValue(tftypes.String, nil))
	if err != nil || !null.(PhoneValue).IsNull() {
		t.Fatalf("a null reads as %#v (%v)", null, err)
	}

	// Equal is exact: the plan shows the text a configuration writes.
	for _, other := range []attr.Value{NewPhoneValue("+14155550100"), basetypes.NewStringValue("+1 415 555 0100")} {
		if phone.Equal(other) {
			t.Errorf("%s is Equal to %s", phone, other)
		}
	}
	if !phone.Equal(NewPhoneValue("+1 415 555 0100")) {
		t.Error("a number is not Equal to itself")
	}
}

func TestPhoneKeepSameNumber_KeepsTheStateForTheSameNumber(t *testing.T) {
	modifier := PhoneKeepSameNumber()

	for _, tc := range []struct{ state, config string }{
		// What an import reads, and how a configuration writes it.
		{"+14155550100", "+1 415 555 0100"},
		{"+442079460958", "+44 20 7946 0958"},
		{"+15551234567", "+1-555-123-4567"},
		// What an earlier apply kept, and the same number written another way.
		{"+1 415 555 0100", "+14155550100"},
		{"+1 415 555 0100", "+1 (415) 555-0100"},
	} {
		got := planString(t, modifier, types.StringValue(tc.state), types.StringValue(tc.config))
		if got.ValueString() != tc.state {
			t.Errorf("%q in the configuration over %q in state plans %q, want the state's", tc.config, tc.state, got.ValueString())
		}
	}
}

func TestPhoneKeepSameNumber_PlansEveryOtherNumberAsWritten(t *testing.T) {
	modifier := PhoneKeepSameNumber()

	for _, tc := range []struct {
		name          string
		state, config types.String
	}{
		{"another number", types.StringValue("+14155550100"), types.StringValue("+1 415 555 0101")},
		{"kept as written", types.StringValue("4155550100"), types.StringValue("(415) 555-0100")},
		{"a create", types.StringNull(), types.StringValue("+1 415 555 0100")},
		{"left out", types.StringValue("+14155550100"), types.StringNull()},
		{"a value known at apply", types.StringValue("+14155550100"), types.StringUnknown()},
		{"a number OneUptime refuses", types.StringValue("+14155550100"), types.StringValue("+1 415 555 CALL")},
	} {
		got := planString(t, modifier, tc.state, tc.config)
		if !got.Equal(tc.config) {
			t.Errorf("%s: planned %s, want the configuration's %s", tc.name, got, tc.config)
		}
	}

	if modifier.Description(context.Background()) == "" || modifier.MarkdownDescription(context.Background()) == "" {
		t.Error("the plan modifier does not say what it does")
	}
}

func validatePhone(value types.String) []string {
	resp := &validator.StringResponse{}
	PhoneValidator().ValidateString(context.Background(), validator.StringRequest{
		Path:        path.Root("twilio_primary_phone_number"),
		ConfigValue: value,
	}, resp)
	errors := []string{}
	for _, diagnostic := range resp.Diagnostics.Errors() {
		errors = append(errors, diagnostic.Summary()+": "+diagnostic.Detail())
	}
	return errors
}

func TestPhoneValidator_RefusesWhatTheServerRefuses(t *testing.T) {
	for _, tc := range readPhoneCases(t).Cases {
		errors := validatePhone(types.StringValue(tc.Written))
		if tc.Stored != nil && len(errors) > 0 {
			t.Errorf("%q, which the server keeps, is refused: %v", tc.Written, errors)
		}
		if tc.Stored == nil {
			if len(errors) != 1 {
				t.Errorf("%q, which the server refuses, gives %d errors", tc.Written, len(errors))
				continue
			}
			for _, says := range []string{"Invalid Phone Number", "+14155550100", "+1 415 555 0100"} {
				if !strings.Contains(errors[0], says) {
					t.Errorf("%q is refused with %q, which does not say %q", tc.Written, errors[0], says)
				}
			}
		}
	}

	for _, value := range []types.String{types.StringNull(), types.StringUnknown()} {
		if errors := validatePhone(value); len(errors) > 0 {
			t.Errorf("%s is refused: %v", value, errors)
		}
	}
	if PhoneValidator().Description(context.Background()) == "" || PhoneValidator().MarkdownDescription(context.Background()) == "" {
		t.Error("the validator does not say what it takes")
	}
}
