package provider

import (
	"context"
	"testing"
)

// The Plugin Framework calls StringSemanticEquals as
// proposedNewValuable.StringSemanticEquals(ctx, priorValuable) — receiver is
// the post-apply server value, argument is the prior planned value. All tests
// below mirror that convention.

// Replays a "was" / "now" payload pattern from real CI failures (the server
// adds MonitorCriteriaInstance.isEnabled = true on create) and confirms
// JSONSubsetValue.StringSemanticEquals reports them equal so the framework
// absorbs the server default instead of raising "Provider produced
// inconsistent result after apply".
func TestStringSemanticEquals_AbsorbsServerIsEnabledDefault(t *testing.T) {
	planned := `{"_type":"MonitorSteps","value":{"monitorStepsInstanceArray":[{"_type":"MonitorStep","value":{"id":"step-ping-1","monitorCriteria":{"_type":"MonitorCriteria","value":{"monitorCriteriaInstanceArray":[{"_type":"MonitorCriteriaInstance","value":{"alerts":[],"changeMonitorStatus":true,"createAlerts":false,"createIncidents":false,"description":"Host responds to ping","filterCondition":"All","filters":[{"_type":"CriteriaFilter","value":{"checkOn":"Is Online","filterType":"True"}}],"id":"criteria-ping-online","incidents":[],"monitorStatusId":"5944e59e-1ce5-4122-95e0-53f102d76920","name":"Ping Success"}}]}},"monitorDestination":{"_type":"Hostname","value":"google.com"},"requestType":"GET"}}]}}`
	actual := `{"_type":"MonitorSteps","value":{"monitorStepsInstanceArray":[{"_type":"MonitorStep","value":{"id":"step-ping-1","monitorCriteria":{"_type":"MonitorCriteria","value":{"monitorCriteriaInstanceArray":[{"_type":"MonitorCriteriaInstance","value":{"alerts":[],"changeMonitorStatus":true,"createAlerts":false,"createIncidents":false,"description":"Host responds to ping","filterCondition":"All","filters":[{"_type":"CriteriaFilter","value":{"checkOn":"Is Online","filterType":"True"}}],"id":"criteria-ping-online","incidents":[],"isEnabled":true,"monitorStatusId":"5944e59e-1ce5-4122-95e0-53f102d76920","name":"Ping Success"}}]}},"monitorDestination":{"_type":"Hostname","value":"google.com"},"requestType":"GET"}}]}}`

	plannedV := NewJSONSubsetValue(planned)
	actualV := NewJSONSubsetValue(actual)
	eq, diags := actualV.StringSemanticEquals(context.Background(), plannedV)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}
	if !eq {
		t.Fatal("expected actual (with isEnabled:true) ≡ planned (no isEnabled) under subset semantics")
	}
}

func TestStringSemanticEquals_DetectsRealDiffs(t *testing.T) {
	plan := NewJSONSubsetValue(`{"_type":"MonitorCriteriaInstance","value":{"isEnabled":true,"name":"x"}}`)
	actual := NewJSONSubsetValue(`{"_type":"MonitorCriteriaInstance","value":{"isEnabled":false,"name":"x"}}`)
	eq, _ := actual.StringSemanticEquals(context.Background(), plan)
	if eq {
		t.Fatal("expected differing scalar leaves to be unequal")
	}
}

func TestStringSemanticEquals_PlanDroppedKeyIsEqualWhenServerKeepsIt(t *testing.T) {
	// User removes a key from HCL; server still has it. With subset semantics
	// the planned value (a subset of state) is treated as equal — the server
	// would re-default it anyway, so no destructive plan churn.
	plan := NewJSONSubsetValue(`{"a":1}`)
	actual := NewJSONSubsetValue(`{"a":1,"b":2}`)
	eq, _ := actual.StringSemanticEquals(context.Background(), plan)
	if !eq {
		t.Fatal("expected actual (superset) ≡ plan (subset)")
	}
}

func TestStringSemanticEquals_NewKeyInPlanDifferentFromState(t *testing.T) {
	// User adds a key the server hasn't seen yet — this MUST diff so apply runs.
	plan := NewJSONSubsetValue(`{"a":1,"b":2}`)
	actual := NewJSONSubsetValue(`{"a":1}`)
	eq, _ := actual.StringSemanticEquals(context.Background(), plan)
	if eq {
		t.Fatal("expected new key in plan to be unequal to state without it")
	}
}

func TestStringSemanticEquals_NullEquality(t *testing.T) {
	a := NewJSONSubsetNull()
	b := NewJSONSubsetNull()
	eq, _ := a.StringSemanticEquals(context.Background(), b)
	if !eq {
		t.Fatal("two null values must be equal")
	}
	c := NewJSONSubsetValue(`{"a":1}`)
	eq, _ = a.StringSemanticEquals(context.Background(), c)
	if eq {
		t.Fatal("null and concrete value must be unequal")
	}
}

func TestStringSemanticEquals_NonJSONFallsBackToByteEquality(t *testing.T) {
	// Some `string + isComplexObject` fields can carry non-JSON values
	// (color codes, base64). For those the type degrades to plain equality.
	a := NewJSONSubsetValue(`#FF0000`)
	b := NewJSONSubsetValue(`#FF0000`)
	eq, _ := a.StringSemanticEquals(context.Background(), b)
	if !eq {
		t.Fatal("identical non-JSON strings must be equal")
	}
	c := NewJSONSubsetValue(`#00FF00`)
	eq, _ = a.StringSemanticEquals(context.Background(), c)
	if eq {
		t.Fatal("differing non-JSON strings must be unequal")
	}
}
