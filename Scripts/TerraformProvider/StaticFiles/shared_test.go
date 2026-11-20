package provider

/*
 * What people and OneUptime both change (#10052), one attribute at a time:
 * planSharedAttribute, the plan of one such attribute of a record that
 * exists, given its configuration, the state (OneUptime's value) and what a
 * Crossplane manifest last applied of it.
 */

import (
	"math/big"
	"sort"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	labelProduction = "1abe1000-0000-4000-8000-000000000001"
	labelTeamA      = "1abe1000-0000-4000-8000-000000000002"
	labelByRule     = "1abe1000-0000-4000-8000-000000000003"
	labelOld        = "1abe1000-0000-4000-8000-000000000004"
)

var labelsType = tftypes.Set{ElementType: tftypes.String}

func labelSet(ids ...string) tftypes.Value {
	values := make([]tftypes.Value, 0, len(ids))
	for _, id := range ids {
		values = append(values, tftypes.NewValue(tftypes.String, id))
	}
	return tftypes.NewValue(labelsType, values)
}

func noLabels() tftypes.Value {
	return tftypes.NewValue(labelsType, nil)
}

// The IDs a set holds, in order, for a test to compare.
func idsIn(t *testing.T, value tftypes.Value) []string {
	t.Helper()
	ids, ok := entriesOf(value)
	if !ok {
		t.Fatalf("%s is no list of IDs", value)
	}
	sorted := append([]string{}, ids...)
	sort.Strings(sorted)
	return sorted
}

func sortedIDs(ids ...string) []string {
	sorted := append([]string{}, ids...)
	sort.Strings(sorted)
	return sorted
}

func sameIDs(t *testing.T, got tftypes.Value, want ...string) {
	t.Helper()
	if strings.Join(idsIn(t, got), ",") != strings.Join(sortedIDs(want...), ",") {
		t.Fatalf("planned %v, want %v", idsIn(t, got), sortedIDs(want...))
	}
}

func applied(fields map[string]any) *LastApplied {
	return &LastApplied{Recorded: true, Fields: fields}
}

var labels = sharedAttribute{name: "labels", entries: true}
var isResolved = sharedAttribute{name: "is_resolved"}

func TestALeftOutValueKeepsOneUptimesUnderTerraformAndCrossplane(t *testing.T) {
	resolved := tftypes.NewValue(tftypes.Bool, true)
	// The framework planned the attribute's default, false.
	defaulted := tftypes.NewValue(tftypes.Bool, false)

	for _, lastApplied := range []*LastApplied{nil, {}, applied(map[string]any{})} {
		value, changed := planSharedAttribute(isResolved, tftypes.NewValue(tftypes.Bool, nil), resolved, defaulted, lastApplied)
		if !changed || !value.Equal(resolved) {
			t.Fatalf("left out, the plan reopens what OneUptime resolved: %s (%v)", value, lastApplied)
		}
	}

	// Left out, a list keeps every entry OneUptime has.
	value, changed := planSharedAttribute(labels, noLabels(), labelSet(labelProduction, labelByRule), labelSet(), nil)
	if !changed {
		t.Fatal("left out, the plan empties the labels")
	}
	sameIDs(t, value, labelProduction, labelByRule)
}

func TestAConfiguredValueIsHeldToUnderTerraform(t *testing.T) {
	configured := tftypes.NewValue(tftypes.Bool, false)
	resolved := tftypes.NewValue(tftypes.Bool, true)
	value, changed := planSharedAttribute(isResolved, configured, resolved, configured, nil)
	if changed || !value.Equal(configured) {
		t.Fatalf("Terraform plans the configuration's value, and the plan says so: %s", value)
	}

	// And a list is the configuration's: the plan shows the rule's label going.
	value, changed = planSharedAttribute(labels, labelSet(labelProduction), labelSet(labelProduction, labelByRule), labelSet(labelProduction), nil)
	if changed {
		t.Fatalf("Terraform's plan of configured labels is the configuration's: %s", value)
	}
}

func TestUnderCrossplaneAValueIsSentWhenTheManifestChangesIt(t *testing.T) {
	notResolved := tftypes.NewValue(tftypes.Bool, false)
	resolved := tftypes.NewValue(tftypes.Bool, true)

	// The manifest said false when it was last applied, and still does:
	// OneUptime resolved the exception since, and it stays resolved.
	value, changed := planSharedAttribute(isResolved, notResolved, resolved, notResolved, applied(map[string]any{"is_resolved": false}))
	if !changed || !value.Equal(resolved) {
		t.Fatalf("the provider reopens what OneUptime resolved: %s", value)
	}

	// The manifest now says true: a change of the manifest's, sent.
	value, changed = planSharedAttribute(isResolved, resolved, notResolved, resolved, applied(map[string]any{"is_resolved": false}))
	if changed || !value.Equal(resolved) {
		t.Fatalf("the manifest's change is not sent: %s", value)
	}

	// The manifest gives a value it did not give when last applied: sent.
	value, changed = planSharedAttribute(isResolved, resolved, notResolved, resolved, applied(map[string]any{}))
	if changed || !value.Equal(resolved) {
		t.Fatalf("a value the manifest starts giving is not sent: %s", value)
	}

	// Nothing applied yet - a resource adopted by its ID: what the manifest says is sent.
	value, changed = planSharedAttribute(isResolved, resolved, notResolved, resolved, &LastApplied{})
	if changed || !value.Equal(resolved) {
		t.Fatalf("an adopted resource's manifest is not sent: %s", value)
	}
}

func TestUnderCrossplaneAValueOneUptimeClearedStaysCleared(t *testing.T) {
	site := tftypes.NewValue(tftypes.String, "517e0000-0000-4000-8000-000000000001")
	cleared := tftypes.NewValue(tftypes.String, nil)
	value, changed := planSharedAttribute(sharedAttribute{name: "site_id"}, site, cleared, site, applied(map[string]any{"site_id": "517e0000-0000-4000-8000-000000000001"}))
	if !changed || !value.IsNull() {
		t.Fatalf("the provider puts back a site OneUptime cleared: %s", value)
	}
}

func TestUnderCrossplaneNumbersAndTextCompareAsAManifestGivesThem(t *testing.T) {
	cases := []struct {
		name   string
		config tftypes.Value
		last   any
		same   bool
	}{
		{"text", tftypes.NewValue(tftypes.String, "Disk full"), "Disk full", true},
		{"other text", tftypes.NewValue(tftypes.String, "Disk full"), "Disk nearly full", false},
		{"a number as JSON reads it", tftypes.NewValue(tftypes.Number, big.NewFloat(3)), float64(3), true},
		{"another number", tftypes.NewValue(tftypes.Number, big.NewFloat(3)), float64(4), false},
		{"a switch", tftypes.NewValue(tftypes.Bool, true), true, true},
		{"text for a switch", tftypes.NewValue(tftypes.Bool, true), "true", false},
		{"nothing", tftypes.NewValue(tftypes.String, "Disk full"), nil, false},
	}
	for _, c := range cases {
		if got := sameAsApplied(c.config, c.last); got != c.same {
			t.Errorf("%s: same = %v, want %v", c.name, got, c.same)
		}
	}
}

func TestUnderCrossplaneALabelARuleAddedStays(t *testing.T) {
	// Created with production; a label rule added its own.
	value, changed := planSharedAttribute(labels, labelSet(labelProduction), labelSet(labelProduction, labelByRule), labelSet(labelProduction), applied(map[string]any{"labels": []any{labelProduction}}))
	if !changed {
		t.Fatal("the plan takes the rule's label off")
	}
	sameIDs(t, value, labelProduction, labelByRule)
	if !value.Equal(labelSet(labelProduction, labelByRule)) {
		t.Fatalf("a record holding every declared label is planned as a change: %s", value)
	}
}

func TestUnderCrossplaneALabelTheManifestAddsIsAddedBesideTheRules(t *testing.T) {
	value, changed := planSharedAttribute(labels, labelSet(labelProduction, labelTeamA), labelSet(labelProduction, labelByRule), labelSet(labelProduction, labelTeamA), applied(map[string]any{"labels": []any{labelProduction}}))
	if !changed {
		t.Fatal("the plan is the manifest's labels alone")
	}
	sameIDs(t, value, labelProduction, labelTeamA, labelByRule)
}

func TestUnderCrossplaneALabelTakenOutOfTheManifestGoes(t *testing.T) {
	value, changed := planSharedAttribute(labels, labelSet(labelProduction), labelSet(labelProduction, labelOld, labelByRule), labelSet(labelProduction), applied(map[string]any{"labels": []any{labelProduction, labelOld}}))
	if !changed {
		t.Fatal("the plan is the manifest's labels alone")
	}
	sameIDs(t, value, labelProduction, labelByRule)

	// Every label taken out of the manifest, the list left in it empty.
	value, _ = planSharedAttribute(labels, labelSet(), labelSet(labelOld, labelByRule), labelSet(), applied(map[string]any{"labels": []any{labelOld}}))
	sameIDs(t, value, labelByRule)
}

// A manifest cannot hold an empty list (Kubernetes drops it from the
// manifest), so taking the last label out of it leaves the list out.
func TestUnderCrossplaneAListTakenOutOfTheManifestLosesTheEntriesItDeclared(t *testing.T) {
	value, changed := planSharedAttribute(labels, noLabels(), labelSet(labelOld, labelByRule), labelSet(labelOld, labelByRule), applied(map[string]any{"labels": []any{labelOld}}))
	if !changed {
		t.Fatal("the label the manifest declared stays")
	}
	sameIDs(t, value, labelByRule)

	// One an earlier version copied in, recorded as declaring nothing known: kept.
	value, _ = planSharedAttribute(labels, noLabels(), labelSet(labelOld, labelByRule), labelSet(labelOld, labelByRule), applied(map[string]any{"labels": nil}))
	sameIDs(t, value, labelOld, labelByRule)

	// Under Terraform, a list left out is OneUptime's, as ever.
	value, _ = planSharedAttribute(labels, noLabels(), labelSet(labelOld, labelByRule), labelSet(labelOld, labelByRule), nil)
	sameIDs(t, value, labelOld, labelByRule)
}

func TestUnderCrossplaneADeclaredLabelRemovedOutsideIsPutBack(t *testing.T) {
	value, _ := planSharedAttribute(labels, labelSet(labelProduction, labelTeamA), labelSet(labelProduction, labelByRule), labelSet(labelProduction, labelTeamA), applied(map[string]any{"labels": []any{labelProduction, labelTeamA}}))
	sameIDs(t, value, labelProduction, labelTeamA, labelByRule)
}

func TestUnderCrossplaneNothingRecordedTakesNoLabelOff(t *testing.T) {
	// A resource an earlier version left, whose spec.forProvider late
	// initialization filled with what the record had then: nothing is known
	// to have been declared, so nothing is taken off.
	for _, lastApplied := range []*LastApplied{{}, applied(map[string]any{})} {
		value, _ := planSharedAttribute(labels, labelSet(labelProduction), labelSet(labelProduction, labelOld, labelByRule), labelSet(labelProduction), lastApplied)
		sameIDs(t, value, labelProduction, labelOld, labelByRule)
	}
}

func TestUnderCrossplaneLabelsCompareWhateverTheirCase(t *testing.T) {
	upper := strings.ToUpper(labelProduction)
	value, _ := planSharedAttribute(labels, labelSet(upper), labelSet(labelProduction, labelByRule), labelSet(upper), applied(map[string]any{"labels": []any{upper}}))
	sameIDs(t, value, labelProduction, labelByRule)
}

func TestUnderCrossplaneARecordWithNoLabelsGetsTheManifests(t *testing.T) {
	value, _ := planSharedAttribute(labels, labelSet(labelProduction), noLabels(), labelSet(labelProduction), applied(map[string]any{"labels": []any{labelProduction}}))
	sameIDs(t, value, labelProduction)
}

func TestAValueKnownOnlyAtApplyIsPlannedAsWritten(t *testing.T) {
	unknown := tftypes.NewValue(labelsType, tftypes.UnknownValue)
	value, changed := planSharedAttribute(labels, unknown, labelSet(labelByRule), unknown, applied(map[string]any{}))
	if changed || value.IsKnown() {
		t.Fatalf("a value known only at apply was planned: %s", value)
	}
}
