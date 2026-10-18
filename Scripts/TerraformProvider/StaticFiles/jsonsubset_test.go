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

// The framework calls SemanticEquals with receiver = the newer/refreshed
// value and argument = the prior/planned value. A sparse plan compared
// against the server's default-filled echo must be equal in that direction.
func TestJSONSubsetSemanticEquals_ServerFilledDefaults(t *testing.T) {
	sparse := NewJSONSubsetValue(`{"_type":"RestrictionTimes","value":{"restictionType":"None"}}`)
	full := NewJSONSubsetValue(`{"_type":"RestrictionTimes","value":{"restictionType":"None","weeklyRestrictionTimes":[]}}`)

	equal, diags := full.StringSemanticEquals(context.Background(), sparse)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}
	if !equal {
		t.Fatal("server echo with extra keys must equal the sparse plan")
	}
}

func TestJSONSubsetSemanticEquals_ConflictingValuesStillUnequal(t *testing.T) {
	a := NewJSONSubsetValue(`{"value":{"intervalType":"Day"}}`)
	b := NewJSONSubsetValue(`{"value":{"intervalType":"Week","extra":true}}`)
	equal, _ := a.StringSemanticEquals(context.Background(), b)
	if equal {
		t.Fatal("values that disagree on a shared key must stay unequal")
	}
	equal, _ = b.StringSemanticEquals(context.Background(), a)
	if equal {
		t.Fatal("values that disagree on a shared key must stay unequal (reversed)")
	}
}

// OneUptime/terraform-provider-oneuptime#11. restriction_times holds DateTime
// values, and the server writes them back with toISOString(): in UTC, always
// with milliseconds. A configuration without them - what timeadd() returns -
// failed every apply with "Provider produced inconsistent result".
func TestJSONSubsetSemanticEquals_DateTimeWithoutMillisecondsIsTheSameInstant(t *testing.T) {
	planned := NewJSONSubsetValue(`{"_type":"RestrictionTimes","value":{"restictionType":"Weekly","dayRestrictionTimes":null,"weeklyRestrictionTimes":[{"startDay":"Monday","endDay":"Monday","startTime":{"_type":"DateTime","value":"2026-08-17T07:00:00Z"},"endTime":{"_type":"DateTime","value":"2026-08-17T16:00:00Z"}}]}}`)
	returned := NewJSONSubsetValue(`{"_type":"RestrictionTimes","value":{"restictionType":"Weekly","dayRestrictionTimes":null,"weeklyRestrictionTimes":[{"startDay":"Monday","endDay":"Monday","startTime":{"_type":"DateTime","value":"2026-08-17T07:00:00.000Z"},"endTime":{"_type":"DateTime","value":"2026-08-17T16:00:00.000Z"}}]}}`)

	equal, diags := returned.StringSemanticEquals(context.Background(), planned)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}
	if !equal {
		t.Fatal("a DateTime written without milliseconds must equal the server's echo with them")
	}
}

func TestJSONSubsetSemanticEquals_DateTimeInAnotherOffsetIsTheSameInstant(t *testing.T) {
	planned := NewJSONSubsetValue(`{"startTime":{"_type":"DateTime","value":"2026-08-17T09:00:00+02:00"}}`)
	returned := NewJSONSubsetValue(`{"startTime":{"_type":"DateTime","value":"2026-08-17T07:00:00.000Z"}}`)

	if equal, _ := returned.StringSemanticEquals(context.Background(), planned); !equal {
		t.Fatal("the same instant written in another offset must be equal")
	}
}

func TestJSONSubsetSemanticEquals_DifferentInstantsStayUnequal(t *testing.T) {
	planned := NewJSONSubsetValue(`{"startTime":{"_type":"DateTime","value":"2026-08-17T07:00:00Z"}}`)
	returned := NewJSONSubsetValue(`{"startTime":{"_type":"DateTime","value":"2026-08-17T07:00:01.000Z"}}`)

	if equal, _ := returned.StringSemanticEquals(context.Background(), planned); equal {
		t.Fatal("timestamps a second apart must stay unequal")
	}
}

// Only full RFC 3339 timestamps compare as instants: other strings, a date on
// its own among them, still have to match exactly.
func TestJSONSubsetSemanticEquals_OtherStringsStillMatchExactly(t *testing.T) {
	cases := []struct {
		name     string
		planned  string
		returned string
	}{
		{"a date without a time", `{"day":"2026-08-17"}`, `{"day":"2026-08-17T00:00:00.000Z"}`},
		{"a word in another case", `{"startDay":"Monday"}`, `{"startDay":"monday"}`},
		{"a timestamp and a word", `{"at":"2026-08-17T07:00:00Z"}`, `{"at":"later"}`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			planned := NewJSONSubsetValue(testCase.planned)
			returned := NewJSONSubsetValue(testCase.returned)
			if equal, _ := returned.StringSemanticEquals(context.Background(), planned); equal {
				t.Fatalf("%s must stay unequal to %s", testCase.planned, testCase.returned)
			}
		})
	}
}
