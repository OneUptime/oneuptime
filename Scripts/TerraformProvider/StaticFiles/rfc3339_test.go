package provider

import (
	"context"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/types/basetypes"
)

// The framework invokes StringSemanticEquals as
// newState.StringSemanticEquals(ctx, plannedValue). These tests pin the
// call convention and the instant-equality semantics.

func semanticEqual(t *testing.T, newState, plan RFC3339Value) bool {
	t.Helper()
	equal, diags := newState.StringSemanticEquals(context.Background(), plan)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}
	return equal
}

func TestRFC3339SemanticEquals_NormalizedMilliseconds(t *testing.T) {
	// Server normalizes "...Z" to "...000Z" — the expires_at bug class.
	plan := NewRFC3339Value("2026-01-01T00:00:00Z")
	state := NewRFC3339Value("2026-01-01T00:00:00.000Z")
	if !semanticEqual(t, state, plan) {
		t.Fatal("expected millisecond-normalized timestamps to be semantically equal")
	}
}

func TestRFC3339SemanticEquals_OffsetVsUTC(t *testing.T) {
	plan := NewRFC3339Value("2026-06-01T12:00:00+00:00")
	state := NewRFC3339Value("2026-06-01T12:00:00Z")
	if !semanticEqual(t, state, plan) {
		t.Fatal("expected +00:00 and Z to be semantically equal")
	}
}

func TestRFC3339SemanticEquals_DifferentZoneSameInstant(t *testing.T) {
	plan := NewRFC3339Value("2026-06-01T14:00:00+02:00")
	state := NewRFC3339Value("2026-06-01T12:00:00Z")
	if !semanticEqual(t, state, plan) {
		t.Fatal("expected identical instants in different zones to be semantically equal")
	}
}

func TestRFC3339SemanticEquals_DifferentInstants(t *testing.T) {
	plan := NewRFC3339Value("2026-01-01T00:00:00Z")
	state := NewRFC3339Value("2026-01-01T00:00:01Z")
	if semanticEqual(t, state, plan) {
		t.Fatal("expected different instants to be unequal")
	}
}

func TestRFC3339SemanticEquals_IdenticalStrings(t *testing.T) {
	plan := NewRFC3339Value("2026-01-01T00:00:00Z")
	state := NewRFC3339Value("2026-01-01T00:00:00Z")
	if !semanticEqual(t, state, plan) {
		t.Fatal("expected identical strings to be equal")
	}
}

func TestRFC3339SemanticEquals_UnparseableFallsBackToBytes(t *testing.T) {
	plan := NewRFC3339Value("not-a-date")
	state := NewRFC3339Value("also-not-a-date")
	if semanticEqual(t, state, plan) {
		t.Fatal("expected different non-date strings to be unequal")
	}

	same := NewRFC3339Value("not-a-date")
	if !semanticEqual(t, same, plan) {
		t.Fatal("expected identical non-date strings to be equal")
	}
}

func TestRFC3339SemanticEquals_NullAndUnknown(t *testing.T) {
	value := NewRFC3339Value("2026-01-01T00:00:00Z")
	null := NewRFC3339Null()
	unknown := NewRFC3339Unknown()

	if semanticEqual(t, null, value) {
		t.Fatal("null should not equal a concrete value")
	}
	if !semanticEqual(t, null, NewRFC3339Null()) {
		t.Fatal("null should equal null")
	}
	if semanticEqual(t, unknown, value) {
		t.Fatal("unknown should not equal a concrete value")
	}
}

func TestRFC3339Type_ValueRoundTrip(t *testing.T) {
	v, diags := RFC3339Type{}.ValueFromString(
		context.Background(),
		basetypes.NewStringValue("2026-01-01T00:00:00Z"),
	)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}
	typed, ok := v.(RFC3339Value)
	if !ok {
		t.Fatalf("expected RFC3339Value, got %T", v)
	}
	if typed.ValueString() != "2026-01-01T00:00:00Z" {
		t.Fatalf("unexpected value: %s", typed.ValueString())
	}
}
