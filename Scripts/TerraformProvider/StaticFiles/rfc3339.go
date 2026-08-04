package provider

import (
	"context"
	"fmt"
	"time"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/types/basetypes"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// RFC3339Type is a Plugin Framework string type for timestamp fields. Its
// semantic equality compares parsed instants, so server-side normalization
// ("2026-01-01T00:00:00Z" coming back as "2026-01-01T00:00:00.000Z", or an
// offset being rewritten to UTC) is not reported as drift. This was the root
// cause of the expires_at/starts_at "inconsistent result after apply" class.
type RFC3339Type struct {
	basetypes.StringType
}

var _ basetypes.StringTypable = RFC3339Type{}

func (t RFC3339Type) Equal(o attr.Type) bool {
	other, ok := o.(RFC3339Type)
	if !ok {
		return false
	}
	return t.StringType.Equal(other.StringType)
}

func (t RFC3339Type) String() string {
	return "RFC3339Type"
}

func (t RFC3339Type) ValueType(_ context.Context) attr.Value {
	return RFC3339Value{}
}

func (t RFC3339Type) ValueFromString(_ context.Context, in basetypes.StringValue) (basetypes.StringValuable, diag.Diagnostics) {
	return RFC3339Value{StringValue: in}, nil
}

func (t RFC3339Type) ValueFromTerraform(ctx context.Context, in tftypes.Value) (attr.Value, error) {
	val, err := t.StringType.ValueFromTerraform(ctx, in)
	if err != nil {
		return nil, err
	}
	sv, ok := val.(basetypes.StringValue)
	if !ok {
		return nil, fmt.Errorf("unexpected base value type: %T", val)
	}
	return RFC3339Value{StringValue: sv}, nil
}

// RFC3339Value is the value half of RFC3339Type. It embeds the standard
// StringValue, so the usual accessors (ValueString, IsNull, IsUnknown) keep
// working without change at call sites.
type RFC3339Value struct {
	basetypes.StringValue
}

var _ basetypes.StringValuableWithSemanticEquals = RFC3339Value{}

func (v RFC3339Value) Type(_ context.Context) attr.Type {
	return RFC3339Type{}
}

func (v RFC3339Value) Equal(o attr.Value) bool {
	other, ok := o.(RFC3339Value)
	if !ok {
		return false
	}
	return v.StringValue.Equal(other.StringValue)
}

// StringSemanticEquals reports two timestamps as equal when they denote the
// same instant, regardless of formatting differences (fractional-second
// precision, +00:00 vs Z). Values that do not parse as RFC3339 fall back to
// byte equality, which already failed by the time the framework calls this.
func (v RFC3339Value) StringSemanticEquals(_ context.Context, otherValuable basetypes.StringValuable) (bool, diag.Diagnostics) {
	var diags diag.Diagnostics
	other, ok := otherValuable.(RFC3339Value)
	if !ok {
		return false, diags
	}
	if v.IsNull() || v.IsUnknown() || other.IsNull() || other.IsUnknown() {
		return v.StringValue.Equal(other.StringValue), diags
	}
	if v.StringValue.Equal(other.StringValue) {
		return true, diags
	}
	mine, err := parseRFC3339(v.ValueString())
	if err != nil {
		return false, diags
	}
	theirs, err := parseRFC3339(other.ValueString())
	if err != nil {
		return false, diags
	}
	return mine.Equal(theirs), diags
}

// NewRFC3339Null returns a typed null value.
func NewRFC3339Null() RFC3339Value {
	return RFC3339Value{StringValue: basetypes.NewStringNull()}
}

// NewRFC3339Unknown returns a typed unknown value.
func NewRFC3339Unknown() RFC3339Value {
	return RFC3339Value{StringValue: basetypes.NewStringUnknown()}
}

// NewRFC3339Value wraps a concrete string.
func NewRFC3339Value(s string) RFC3339Value {
	return RFC3339Value{StringValue: basetypes.NewStringValue(s)}
}

// parseRFC3339 accepts both plain RFC3339 and fractional-second variants.
func parseRFC3339(s string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, s)
}
