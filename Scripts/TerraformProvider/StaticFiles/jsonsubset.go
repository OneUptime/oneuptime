package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/types/basetypes"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// JSONSubsetType is a Plugin Framework string type for complex-JSON fields.
// Its semantic-equality returns true when the planned JSON is a structural
// subset of the actual JSON: same shape, same scalars at every leaf, but the
// actual side may have additional keys filled in by the server (e.g. defaults).
// This prevents "Provider produced inconsistent result after apply" without
// having to teach the provider about every server-side default.
type JSONSubsetType struct {
	basetypes.StringType
}

var _ basetypes.StringTypable = JSONSubsetType{}

func (t JSONSubsetType) Equal(o attr.Type) bool {
	other, ok := o.(JSONSubsetType)
	if !ok {
		return false
	}
	return t.StringType.Equal(other.StringType)
}

func (t JSONSubsetType) String() string {
	return "JSONSubsetType"
}

func (t JSONSubsetType) ValueType(_ context.Context) attr.Value {
	return JSONSubsetValue{}
}

func (t JSONSubsetType) ValueFromString(_ context.Context, in basetypes.StringValue) (basetypes.StringValuable, diag.Diagnostics) {
	return JSONSubsetValue{StringValue: in}, nil
}

func (t JSONSubsetType) ValueFromTerraform(ctx context.Context, in tftypes.Value) (attr.Value, error) {
	val, err := t.StringType.ValueFromTerraform(ctx, in)
	if err != nil {
		return nil, err
	}
	sv, ok := val.(basetypes.StringValue)
	if !ok {
		return nil, fmt.Errorf("unexpected base value type: %T", val)
	}
	return JSONSubsetValue{StringValue: sv}, nil
}

// JSONSubsetValue is the value half of JSONSubsetType. It embeds the standard
// StringValue, so all the usual accessors (ValueString, IsNull, IsUnknown)
// keep working without change at call sites.
type JSONSubsetValue struct {
	basetypes.StringValue
}

var _ basetypes.StringValuableWithSemanticEquals = JSONSubsetValue{}

func (v JSONSubsetValue) Type(_ context.Context) attr.Type {
	return JSONSubsetType{}
}

func (v JSONSubsetValue) Equal(o attr.Value) bool {
	other, ok := o.(JSONSubsetValue)
	if !ok {
		return false
	}
	return v.StringValue.Equal(other.StringValue)
}

// StringSemanticEquals reports the new state and the prior planned value as
// equal when the planned JSON is a structural subset of the new-state JSON.
//
// The Plugin Framework invokes this as
// proposedNewValuable.StringSemanticEquals(ctx, priorValuable), so the
// receiver (newState below) is the post-apply / refreshed value and the
// argument (plan) is the prior planned value. We treat them as equal iff
// plan ⊆ newState — i.e. the only difference is keys the server filled in
// as defaults.
func (v JSONSubsetValue) StringSemanticEquals(_ context.Context, priorValuable basetypes.StringValuable) (bool, diag.Diagnostics) {
	var diags diag.Diagnostics
	newState := v
	plan, ok := priorValuable.(JSONSubsetValue)
	if !ok {
		return false, diags
	}
	// Null/unknown is a byte-level concept; subset semantics don't apply.
	if newState.IsNull() || newState.IsUnknown() || plan.IsNull() || plan.IsUnknown() {
		return newState.StringValue.Equal(plan.StringValue), diags
	}
	// Identical strings are trivially equal — skip the JSON parse.
	if newState.StringValue.Equal(plan.StringValue) {
		return true, diags
	}
	// For values that aren't JSON (color codes, base64, etc.) byte equality
	// is the only meaningful comparison, and it already failed above.
	var planJSON, stateJSON interface{}
	if json.Unmarshal([]byte(plan.ValueString()), &planJSON) != nil {
		return false, diags
	}
	if json.Unmarshal([]byte(newState.ValueString()), &stateJSON) != nil {
		return false, diags
	}
	return jsonIsSubset(planJSON, stateJSON), diags
}

// NewJSONSubsetNull returns a typed null value.
func NewJSONSubsetNull() JSONSubsetValue {
	return JSONSubsetValue{StringValue: basetypes.NewStringNull()}
}

// NewJSONSubsetUnknown returns a typed unknown value.
func NewJSONSubsetUnknown() JSONSubsetValue {
	return JSONSubsetValue{StringValue: basetypes.NewStringUnknown()}
}

// NewJSONSubsetValue wraps a concrete string.
func NewJSONSubsetValue(s string) JSONSubsetValue {
	return JSONSubsetValue{StringValue: basetypes.NewStringValue(s)}
}

// jsonIsSubset returns true when every leaf in plan exists with the same
// value in actual. Maps: every key in plan must exist in actual (with a
// subset value); actual may have extra keys. Slices: same length, positional
// subset comparison. Scalars: reflect.DeepEqual.
func jsonIsSubset(plan, actual interface{}) bool {
	switch p := plan.(type) {
	case map[string]interface{}:
		a, ok := actual.(map[string]interface{})
		if !ok {
			return false
		}
		for key, pv := range p {
			av, exists := a[key]
			if !exists {
				return false
			}
			if !jsonIsSubset(pv, av) {
				return false
			}
		}
		return true
	case []interface{}:
		a, ok := actual.([]interface{})
		if !ok {
			return false
		}
		if len(p) != len(a) {
			return false
		}
		for i := range p {
			if !jsonIsSubset(p[i], a[i]) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(plan, actual)
	}
}
