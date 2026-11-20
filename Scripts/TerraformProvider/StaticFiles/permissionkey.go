package provider

// A PERMISSION'S KEY.
//
// A team's, an API key's and a custom role's permission is a permission's
// key: IncidentMember, ReadProjectIncident. OneUptime's API spec documented
// it as an object until OneUptime#10300, so this provider made it a JSON
// attribute, and its reference and the Dashboard's Developer pages said to
// write it with jsonencode(): permission = jsonencode("IncidentMember"), the
// key as a JSON string, quotes and all. OneUptime answered the key without
// them, and every apply of that form failed with "Provider produced
// inconsistent result after apply".
//
// The spec now says what a permission is, and the provider takes the key as
// it is written: permission = "IncidentMember". The jsonencode() form is
// still the same permission, in a configuration and in a state an earlier
// version of the provider wrote:
//
//   - PermissionKeyOf is the key either form names, and what is sent;
//   - PermissionKeyType compares two values by the key they name, so a
//     create, an update and a refresh keep the form the plan or the state
//     holds when OneUptime answers that key;
//   - PermissionKeepSameKey plans no change for the same key written the
//     other way: a configuration may move from one form to the other, and a
//     row imported, which reads the plain key, plans no change under either;
//   - PermissionKeyValidator refuses at plan time what names no key - an
//     object, as the reference's example wrote one, a list, nothing at all -
//     which OneUptime refused at apply.
//
// The attribute is a string, as it always was, so no state needs an upgrade:
// a state holding either form is read as it is.

import (
	"context"
	"encoding/json"
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

// A permission's key is one word of letters and digits, as every one in
// Common/Types/Permission.ts is: IncidentMember, ReadProjectIncident. Which
// of them a team, an API key or a custom role may be given is OneUptime's to
// say, so a permission added after this provider was built is taken too.
var permissionKeyPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*$`)

// permissionKeyNamed is the key a written value names - the value itself,
// or the string it holds as JSON, as jsonencode() writes it - and false when
// it names none.
func permissionKeyNamed(written string) (string, bool) {
	key := written
	if strings.HasPrefix(written, `"`) {
		if err := json.Unmarshal([]byte(written), &key); err != nil {
			return "", false
		}
	}
	return key, permissionKeyPattern.MatchString(key)
}

// PermissionKeyOf is the key a written value names, as OneUptime takes it:
// IncidentMember, for "IncidentMember" and for jsonencode("IncidentMember").
// A value that names no key is sent as it is written, for OneUptime to
// refuse in its own words - PermissionKeyValidator refuses it at plan time
// first.
func PermissionKeyOf(written string) string {
	if key, ok := permissionKeyNamed(written); ok {
		return key
	}
	return written
}

// samePermissionKey says whether two written values name the same key.
func samePermissionKey(first, second string) bool {
	if first == second {
		return true
	}
	firstKey, ok := permissionKeyNamed(first)
	if !ok {
		return false
	}
	secondKey, ok := permissionKeyNamed(second)
	return ok && firstKey == secondKey
}

// PermissionKeyType is a Plugin Framework string type for a permission. Its
// semantic equality compares two values by the key they name.
type PermissionKeyType struct {
	basetypes.StringType
}

var _ basetypes.StringTypable = PermissionKeyType{}

func (t PermissionKeyType) Equal(o attr.Type) bool {
	other, ok := o.(PermissionKeyType)
	if !ok {
		return false
	}
	return t.StringType.Equal(other.StringType)
}

func (t PermissionKeyType) String() string {
	return "PermissionKeyType"
}

func (t PermissionKeyType) ValueType(_ context.Context) attr.Value {
	return PermissionKeyValue{}
}

func (t PermissionKeyType) ValueFromString(_ context.Context, in basetypes.StringValue) (basetypes.StringValuable, diag.Diagnostics) {
	return PermissionKeyValue{StringValue: in}, nil
}

func (t PermissionKeyType) ValueFromTerraform(ctx context.Context, in tftypes.Value) (attr.Value, error) {
	val, err := t.StringType.ValueFromTerraform(ctx, in)
	if err != nil {
		return nil, err
	}
	sv, ok := val.(basetypes.StringValue)
	if !ok {
		return nil, fmt.Errorf("unexpected base value type: %T", val)
	}
	return PermissionKeyValue{StringValue: sv}, nil
}

// PermissionKeyValue is the value half of PermissionKeyType. It embeds the
// standard StringValue, so ValueString, IsNull and IsUnknown work as they do
// on any string.
type PermissionKeyValue struct {
	basetypes.StringValue
}

var _ basetypes.StringValuableWithSemanticEquals = PermissionKeyValue{}

func (v PermissionKeyValue) Type(_ context.Context) attr.Type {
	return PermissionKeyType{}
}

func (v PermissionKeyValue) Equal(o attr.Value) bool {
	other, ok := o.(PermissionKeyValue)
	if !ok {
		return false
	}
	return v.StringValue.Equal(other.StringValue)
}

// StringSemanticEquals reports two values as equal when they name the same
// key: "IncidentMember", as OneUptime answers it, and jsonencode()'s
// "\"IncidentMember\"". The framework then keeps the plan's form in state
// after a create or an update, and the state's after a refresh.
func (v PermissionKeyValue) StringSemanticEquals(_ context.Context, otherValuable basetypes.StringValuable) (bool, diag.Diagnostics) {
	var diags diag.Diagnostics
	other, ok := otherValuable.(PermissionKeyValue)
	if !ok {
		return false, diags
	}
	if v.IsNull() || v.IsUnknown() || other.IsNull() || other.IsUnknown() {
		return v.StringValue.Equal(other.StringValue), diags
	}
	return samePermissionKey(v.ValueString(), other.ValueString()), diags
}

// NewPermissionKeyNull returns a typed null value.
func NewPermissionKeyNull() PermissionKeyValue {
	return PermissionKeyValue{StringValue: basetypes.NewStringNull()}
}

// NewPermissionKeyUnknown returns a typed unknown value.
func NewPermissionKeyUnknown() PermissionKeyValue {
	return PermissionKeyValue{StringValue: basetypes.NewStringUnknown()}
}

// NewPermissionKeyValue wraps a concrete string.
func NewPermissionKeyValue(s string) PermissionKeyValue {
	return PermissionKeyValue{StringValue: basetypes.NewStringValue(s)}
}

// ---------------------------------------------------------------------------
// The plan: the same key, however it is written.

type permissionSameKeyModifier struct{}

// PermissionKeepSameKey keeps the state's permission in the plan when the
// configuration names the same key written the other way: a state an earlier
// version wrote as jsonencode("IncidentMember") under a configuration that
// now writes "IncidentMember", or a row imported, which reads the plain key,
// under a configuration that writes jsonencode(). Terraform takes a planned
// value equal to the prior one where the configuration's means the same.
func PermissionKeepSameKey() planmodifier.String {
	return permissionSameKeyModifier{}
}

func (m permissionSameKeyModifier) Description(ctx context.Context) string {
	return m.MarkdownDescription(ctx)
}

func (m permissionSameKeyModifier) MarkdownDescription(_ context.Context) string {
	return "A permission that names the same key as the one in state is no change, written plainly or with jsonencode()."
}

func (m permissionSameKeyModifier) PlanModifyString(_ context.Context, req planmodifier.StringRequest, resp *planmodifier.StringResponse) {
	if req.StateValue.IsNull() || req.StateValue.IsUnknown() ||
		req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() ||
		req.PlanValue.IsNull() || req.PlanValue.IsUnknown() {
		return
	}

	if req.PlanValue.ValueString() == req.StateValue.ValueString() {
		return
	}

	if samePermissionKey(req.PlanValue.ValueString(), req.StateValue.ValueString()) {
		resp.PlanValue = req.StateValue
	}
}

// ---------------------------------------------------------------------------
// Validation: a value that names a key.

type permissionKeyValidator struct{}

// PermissionKeyValidator refuses at plan time a permission that names no
// key, which OneUptime refused at apply ("OneUptime has no permission called
// ...").
func PermissionKeyValidator() validator.String {
	return permissionKeyValidator{}
}

func (v permissionKeyValidator) Description(_ context.Context) string {
	return `a permission's key, such as "IncidentMember", or the same key written with jsonencode()`
}

func (v permissionKeyValidator) MarkdownDescription(ctx context.Context) string {
	return v.Description(ctx)
}

func (v permissionKeyValidator) ValidateString(_ context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	written := req.ConfigValue.ValueString()
	if _, ok := permissionKeyNamed(written); ok {
		return
	}

	resp.Diagnostics.AddAttributeError(req.Path, "Invalid Permission", permissionKeyProblem(written))
}

// permissionKeyProblem says why a value names no key, and how to write one.
func permissionKeyProblem(written string) string {
	trimmed := strings.TrimSpace(written)
	if trimmed == "" || trimmed == `""` {
		return `The permission is empty. Write a permission's key, such as permission = "IncidentMember".`
	}

	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		return fmt.Sprintf(
			`A permission is a permission's key, such as "IncidentMember", not a JSON object or list: %s names none. `+
				`Write permission = "IncidentMember".`,
			written,
		)
	}

	return fmt.Sprintf(
		`%q is not a permission's key. A key is one word of letters and digits, such as "IncidentMember" or `+
			`"ReadProjectIncident". The permissions a team may be given are listed in OneUptime's API reference.`,
		written,
	)
}
