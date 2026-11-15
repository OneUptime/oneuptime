package provider

// PHONE NUMBERS.
//
// OneUptime keeps a phone number exactly as it was written when it reads as
// three digits, three and then four to seven (the E.123 check of
// Common/Types/Phone.ts): "+14155550100" and "(415) 555-0100" are kept as
// they are. Any other number of 8 to 15 digits, such as one grouped the way
// people say it ("+1 415 555 0100", "+44 20 7946 0958"), is kept as its
// digits: "+14155550100", "+442079460958". Anything else it refuses.
//
// So OneUptime may answer a number in another spelling than the one a
// configuration wrote, and an apply that compared the two as text failed with
// "Provider produced inconsistent result after apply"
// (OneUptime/oneuptime#7777). Here:
//
//   - PhoneType compares two numbers as OneUptime keeps them. After an apply
//     or a refresh, the state keeps the configuration's spelling of the
//     number OneUptime answers.
//   - PhoneKeepSameNumber plans no change for the same number written
//     another way, as right after an import, which reads OneUptime's
//     spelling.
//   - PhoneValidator refuses at plan time a number OneUptime would refuse at
//     apply.
//
// phoneAsStored is the server's rule. testdata/phone_numbers.json holds what
// the server's own code keeps for a list of numbers, written by the generator
// (Core/PhoneCases.ts), and phone_test.go checks that the two agree.

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types/basetypes"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// phoneColumnLength is ColumnLength.Phone: a longer number is not read as its
// digits.
const phoneColumnLength = 30

// jsWhitespace is what JavaScript's \s and trim() take as white space. Go's
// \s is ASCII only, and its unicode.IsSpace takes U+0085 and not U+FEFF.
const jsWhitespace = `\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

var (
	// Phone.ts's E.123 check: a number it keeps as it is written.
	phoneAsWrittenPattern = regexp.MustCompile(`^[+]?[(]?[0-9]{3}[)]?[-` + jsWhitespace + `.]?[0-9]{3}[-` + jsWhitespace + `.]?[0-9]{4,7}$`)
	// A number it keeps as its digits.
	phoneDigitsPattern = regexp.MustCompile(`^[+]?[0-9]{8,15}$`)
)

func isJSWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ',
		0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// utf16Length is JavaScript's length of the text: a character beyond the
// Basic Multilingual Plane counts twice.
func utf16Length(text string) int {
	length := 0
	for _, r := range text {
		if r >= 0x10000 {
			length += 2
		} else {
			length++
		}
	}
	return length
}

// phoneAsStored is the number OneUptime keeps for one written this way, and
// false when OneUptime refuses it: the phone setter of Phone.ts, step by
// step.
func phoneAsStored(written string) (string, bool) {
	trimmed := strings.TrimFunc(written, isJSWhitespace)
	if phoneAsWrittenPattern.MatchString(trimmed) {
		return trimmed, true
	}
	if utf16Length(trimmed) > phoneColumnLength {
		return "", false
	}
	digits := strings.Map(func(r rune) rune {
		if isJSWhitespace(r) || r == '(' || r == ')' || r == '.' || r == '-' {
			return -1
		}
		return r
	}, trimmed)
	if phoneDigitsPattern.MatchString(digits) {
		return digits, true
	}
	return "", false
}

// samePhoneAsStored says whether OneUptime keeps the two the same: the same
// text, or two numbers it keeps as one.
func samePhoneAsStored(first, second string) bool {
	if first == second {
		return true
	}
	firstStored, ok := phoneAsStored(first)
	if !ok {
		return false
	}
	secondStored, ok := phoneAsStored(second)
	return ok && firstStored == secondStored
}

// PhoneType is a Plugin Framework string type for phone numbers. Its semantic
// equality compares two numbers as OneUptime keeps them.
type PhoneType struct {
	basetypes.StringType
}

var _ basetypes.StringTypable = PhoneType{}

func (t PhoneType) Equal(o attr.Type) bool {
	other, ok := o.(PhoneType)
	if !ok {
		return false
	}
	return t.StringType.Equal(other.StringType)
}

func (t PhoneType) String() string {
	return "PhoneType"
}

func (t PhoneType) ValueType(_ context.Context) attr.Value {
	return PhoneValue{}
}

func (t PhoneType) ValueFromString(_ context.Context, in basetypes.StringValue) (basetypes.StringValuable, diag.Diagnostics) {
	return PhoneValue{StringValue: in}, nil
}

func (t PhoneType) ValueFromTerraform(ctx context.Context, in tftypes.Value) (attr.Value, error) {
	val, err := t.StringType.ValueFromTerraform(ctx, in)
	if err != nil {
		return nil, err
	}
	sv, ok := val.(basetypes.StringValue)
	if !ok {
		return nil, fmt.Errorf("unexpected base value type: %T", val)
	}
	return PhoneValue{StringValue: sv}, nil
}

// PhoneValue is the value half of PhoneType. It embeds the standard
// StringValue, so ValueString, IsNull and IsUnknown work as they do on any
// string.
type PhoneValue struct {
	basetypes.StringValue
}

var _ basetypes.StringValuableWithSemanticEquals = PhoneValue{}

func (v PhoneValue) Type(_ context.Context) attr.Type {
	return PhoneType{}
}

func (v PhoneValue) Equal(o attr.Value) bool {
	other, ok := o.(PhoneValue)
	if !ok {
		return false
	}
	return v.StringValue.Equal(other.StringValue)
}

// StringSemanticEquals reports two numbers as equal when OneUptime keeps them
// as the same number: "+1 415 555 0100" and the "+14155550100" OneUptime
// answers for it. The framework then keeps the configuration's spelling in
// state after a create, an update or a read.
func (v PhoneValue) StringSemanticEquals(_ context.Context, otherValuable basetypes.StringValuable) (bool, diag.Diagnostics) {
	var diags diag.Diagnostics
	other, ok := otherValuable.(PhoneValue)
	if !ok {
		return false, diags
	}
	if v.IsNull() || v.IsUnknown() || other.IsNull() || other.IsUnknown() {
		return v.StringValue.Equal(other.StringValue), diags
	}
	return samePhoneAsStored(v.ValueString(), other.ValueString()), diags
}

// NewPhoneNull returns a typed null value.
func NewPhoneNull() PhoneValue {
	return PhoneValue{StringValue: basetypes.NewStringNull()}
}

// NewPhoneUnknown returns a typed unknown value.
func NewPhoneUnknown() PhoneValue {
	return PhoneValue{StringValue: basetypes.NewStringUnknown()}
}

// NewPhoneValue wraps a concrete string.
func NewPhoneValue(s string) PhoneValue {
	return PhoneValue{StringValue: basetypes.NewStringValue(s)}
}

// ---------------------------------------------------------------------------
// The plan: the same number, however it is written.

type phoneSameNumberModifier struct{}

// PhoneKeepSameNumber keeps the prior number in the plan when OneUptime keeps
// the configuration's as the same number: right after an import read
// "+14155550100", a configuration's "+1 415 555 0100" is no change. Like the
// modifiers of importsettle.go, it comes before RequiresReplace, so the same
// number written another way replaces nothing either.
func PhoneKeepSameNumber() planmodifier.String {
	return phoneSameNumberModifier{}
}

func (m phoneSameNumberModifier) Description(ctx context.Context) string {
	return m.MarkdownDescription(ctx)
}

func (m phoneSameNumberModifier) MarkdownDescription(_ context.Context) string {
	return "A phone number OneUptime keeps as the one in state is no change, however it is written."
}

func (m phoneSameNumberModifier) PlanModifyString(_ context.Context, req planmodifier.StringRequest, resp *planmodifier.StringResponse) {
	if req.StateValue.IsNull() || req.StateValue.IsUnknown() ||
		req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() ||
		req.PlanValue.IsNull() || req.PlanValue.IsUnknown() {
		return
	}

	if req.PlanValue.ValueString() == req.StateValue.ValueString() {
		return
	}

	if samePhoneAsStored(req.PlanValue.ValueString(), req.StateValue.ValueString()) {
		resp.PlanValue = req.StateValue
	}
}

// ---------------------------------------------------------------------------
// Validation: a number OneUptime takes.

type phoneValidator struct{}

// PhoneValidator refuses at plan time a phone number OneUptime refuses at
// apply ("Phone is not in valid format").
func PhoneValidator() validator.String {
	return phoneValidator{}
}

func (v phoneValidator) Description(_ context.Context) string {
	return "a phone number of 8 to 15 digits, with an optional leading +, grouped with spaces, dashes, dots or brackets"
}

func (v phoneValidator) MarkdownDescription(ctx context.Context) string {
	return v.Description(ctx)
}

func (v phoneValidator) ValidateString(_ context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	written := req.ConfigValue.ValueString()
	if _, ok := phoneAsStored(written); ok {
		return
	}

	resp.Diagnostics.AddAttributeError(
		req.Path,
		"Invalid Phone Number",
		fmt.Sprintf(
			"OneUptime does not take %q as a phone number. Write 8 to 15 digits, with an optional leading +, "+
				"grouped with spaces, dashes, dots or brackets if you like: %q or %q.",
			written, "+14155550100", "+1 415 555 0100",
		),
	)
}
