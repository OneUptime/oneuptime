package config

// What the provider records of a manifest's fields people and OneUptime
// both change (lastapplied.go, #10052): the rules of the record, one at a
// time, and that every resource with such fields keeps one, never copies
// them into spec.forProvider, and names them so they read back.

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"

	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/crossplane/v1alpha1"
)

const (
	productionLabel = "1abe1000-0000-4000-8000-000000000001"
	teamALabel      = "1abe1000-0000-4000-8000-000000000002"
	ruleLabel       = "1abe1000-0000-4000-8000-000000000003"
	monitorID       = "5ec7e700-0000-4000-8000-000000000042"
)

func recordOf(t *testing.T, mg *v1alpha1.Monitor) (lastApplied, bool) {
	t.Helper()
	return readLastApplied(mg)
}

func monitorShared() sharedFieldsOf {
	r := provider.Resources["oneuptime_monitor"]
	recorder := NewLastAppliedRecorder(r)
	if recorder == nil {
		panic("a monitor records nothing of what its manifest applied")
	}
	return recorder(nil).(*lastAppliedRecorder).shared
}

func labelledManifest(labels ...string) *v1alpha1.Monitor {
	mg := newMonitor("homepage", "Manual")
	mg.SetGeneration(1)
	for _, label := range labels {
		mg.Spec.ForProvider.Labels = append(mg.Spec.ForProvider.Labels, ptrTo(label))
	}
	return mg
}

func appliedAt(mg *v1alpha1.Monitor, generation int64) {
	mg.SetConditions(
		xpv2.Available(),
		xpv2.ReconcileSuccess().WithObservedGeneration(generation),
	)
}

func withRecord(t *testing.T, mg *v1alpha1.Monitor, record lastApplied) {
	t.Helper()
	text, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	meta.AddAnnotations(mg, map[string]string{LastAppliedAnnotation: string(text)})
}

func TestEveryResourceWithSharedFieldsRecordsWhatItsManifestApplied(t *testing.T) {
	withShared := 0
	for name, r := range provider.Resources {
		fields := SharedFields(name)
		recorder := NewLastAppliedRecorder(r)
		if (len(fields) > 0) != (recorder != nil) {
			t.Errorf("%s: %d shared fields, and a recorder: %v", name, len(fields), recorder != nil)
		}
		if len(fields) > 0 {
			withShared++
		}
	}
	// Every resource a label rule labels, and more.
	if withShared < 30 {
		t.Fatalf("%d resources have fields people and OneUptime both change; the models declare far more", withShared)
	}
}

func TestSharedFieldsAreNeverLateInitialized(t *testing.T) {
	for name, r := range provider.Resources {
		ignored := asSet(r.LateInitializer.IgnoredFields)
		conditional := asSet(r.LateInitializer.ConditionalIgnoredFields)
		for _, field := range SharedFields(name) {
			if _, settable := FieldOf(r.TerraformResource, field); !settable {
				t.Errorf("%s.%s: people set it, and a manifest cannot", name, field)
			}
			if !ignored[field] || conditional[field] {
				t.Errorf("%s.%s: late initialization may copy it into spec.forProvider", name, field)
			}
		}
	}
}

func TestASharedFieldsNameInTheRecordReadsBackAsItsTerraformName(t *testing.T) {
	for name := range provider.Resources {
		for _, field := range SharedFields(name) {
			if got := terraformName(manifestName(field)); got != field {
				t.Errorf("%s.%s is recorded as %s, which reads back as %s", name, field, manifestName(field), got)
			}
		}
	}
}

func TestOnlyAnUpdateSendsAClustersAISettings(t *testing.T) {
	updateOnly := SharedFieldsOnlyAnUpdateSends("oneuptime_kubernetes_cluster")
	if !updateOnly["is_ai_investigation_enabled"] {
		t.Errorf("a cluster's create sends is_ai_investigation_enabled: %v", updateOnly)
	}
	if SharedFieldsOnlyAnUpdateSends("oneuptime_monitor")["labels"] {
		t.Error("a monitor's create does not send its labels")
	}
}

func TestBeforeTheCreateTheRecordIsWhatTheCreateSends(t *testing.T) {
	mg := labelledManifest(productionLabel)

	next, changed, err := nextLastApplied(mg, monitorShared())
	if err != nil || !changed {
		t.Fatalf("nothing recorded before the create: %v, %v", changed, err)
	}
	want := lastApplied{Generation: 1, Fields: map[string]any{"labels": []any{productionLabel}}}
	if !sameRecord(next, want) {
		t.Fatalf("recorded %+v, want %+v", next, want)
	}

	// A cluster's AI setting is left out: the reconcile after the create sends it.
	cluster := &v1alpha1.KubernetesCluster{ObjectMeta: objectMeta("production")}
	cluster.SetGeneration(1)
	cluster.Spec.ForProvider.Name = ptrTo("Production")
	cluster.Spec.ForProvider.IsAIInvestigationEnabled = ptrTo(false)
	clusterShared := NewLastAppliedRecorder(provider.Resources["oneuptime_kubernetes_cluster"])(nil).(*lastAppliedRecorder).shared
	next, _, err = nextLastApplied(cluster, clusterShared)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := next.Fields["isAiInvestigationEnabled"]; ok {
		t.Errorf("a field only an update sends is recorded before the create: %+v", next)
	}
}

func TestAnEditIsRecordedOnceItIsApplied(t *testing.T) {
	mg := labelledManifest(productionLabel, teamALabel)
	meta.SetExternalName(mg, monitorID)
	mg.SetGeneration(2)
	withRecord(t, mg, lastApplied{Generation: 1, Fields: map[string]any{"labels": []any{productionLabel}}})

	// Not applied yet: the record stays, so the plan sends the edit.
	appliedAt(mg, 1)
	if _, changed, _ := nextLastApplied(mg, monitorShared()); changed {
		t.Fatal("an edit not yet applied was recorded")
	}

	// Applied at its generation: recorded.
	appliedAt(mg, 2)
	next, changed, err := nextLastApplied(mg, monitorShared())
	if err != nil || !changed {
		t.Fatalf("an applied edit was not recorded: %v, %v", changed, err)
	}
	labels, _ := next.Fields["labels"].([]any)
	if next.Generation != 2 || len(labels) != 2 {
		t.Fatalf("recorded %+v", next)
	}

	// A failed reconcile records nothing.
	mg.SetConditions(xpv2.ReconcileError(errFake).WithObservedGeneration(2))
	if _, changed, _ := nextLastApplied(mg, monitorShared()); changed {
		t.Fatal("a failed reconcile recorded the manifest as applied")
	}
}

func TestTheReconcileThatCreatesTheRecordAppliesOnlyWhatTheCreateSends(t *testing.T) {
	mg := labelledManifest(productionLabel)
	meta.SetExternalName(mg, monitorID)
	withRecord(t, mg, lastApplied{Generation: 1, Fields: map[string]any{"labels": []any{productionLabel}}})
	mg.SetConditions(
		xpv2.Creating().WithObservedGeneration(1),
		xpv2.ReconcileSuccess().WithObservedGeneration(1),
	)

	if _, changed, _ := nextLastApplied(mg, monitorShared()); changed {
		t.Fatal("the create's reconcile was taken for one that observed the record")
	}
}

func TestAResourceAnEarlierVersionLeftHasItsValuesTakenAsAppliedAndItsListsAsDeclaringNothing(t *testing.T) {
	mg := labelledManifest(productionLabel, ruleLabel)
	meta.SetExternalName(mg, monitorID)
	mg.Status.AtProvider.ID = ptrTo(monitorID)
	appliedAt(mg, 1)

	next, changed, err := nextLastApplied(mg, monitorShared())
	if err != nil || !changed {
		t.Fatalf("nothing recorded of a resource an earlier version left: %v, %v", changed, err)
	}
	labels, recorded := next.Fields["labels"]
	if !recorded || labels != nil {
		t.Fatalf("an earlier version's labels are recorded as %v, want null: declaring nothing known", labels)
	}

	// From the next reconcile on, at the same generation, they stay so.
	withRecord(t, mg, next)
	if _, changed, _ := nextLastApplied(mg, monitorShared()); changed {
		t.Fatal("the labels an earlier version copied were taken as declared")
	}
}

// The upgrade's first reconcile late-initializes fields an earlier version
// left out, which moves the generation on: the copied list stays null.
func TestACopiedListStaysUndeclaredUntilTheManifestChangesIt(t *testing.T) {
	mg := labelledManifest(productionLabel, ruleLabel)
	meta.SetExternalName(mg, monitorID)
	mg.Status.AtProvider.ID = ptrTo(monitorID)
	appliedAt(mg, 1)
	upgraded, _, _ := nextLastApplied(mg, monitorShared())
	withRecord(t, mg, upgraded)

	// Late initialization moved the generation on; the labels did not change.
	mg.SetGeneration(2)
	appliedAt(mg, 2)
	next, _, err := nextLastApplied(mg, monitorShared())
	if err != nil {
		t.Fatal(err)
	}
	if labels, ok := next.Fields["labels"]; !ok || labels != nil {
		t.Fatalf("the copied labels were taken as declared: %+v", next)
	}

	// The manifest changes them: declared from then on.
	withRecord(t, mg, next)
	mg.Spec.ForProvider.Labels = []*string{ptrTo(productionLabel)}
	mg.SetGeneration(3)
	appliedAt(mg, 3)
	next, _, err = nextLastApplied(mg, monitorShared())
	if err != nil {
		t.Fatal(err)
	}
	if labelsOfRecord(next) != productionLabel || len(next.Copied) != 0 {
		t.Fatalf("the manifest's change is not declared: %+v", next)
	}
}

func TestAResourceAdoptedByItsIDIsRecordedOnceObserved(t *testing.T) {
	mg := labelledManifest(productionLabel)
	meta.SetExternalName(mg, monitorID)

	if _, changed, _ := nextLastApplied(mg, monitorShared()); changed {
		t.Fatal("an adopted resource was recorded before its first reconcile sent its manifest")
	}
}

func TestLastAppliedReadsTheRecordByTerraformName(t *testing.T) {
	mg := labelledManifest(productionLabel)
	withRecord(t, mg, lastApplied{Generation: 1, Fields: map[string]any{"labels": []any{productionLabel}}})

	recorded, fields := LastAppliedOf(mg)
	if !recorded || !reflect.DeepEqual(fields, map[string]any{"labels": []any{productionLabel}}) {
		t.Fatalf("read %v, %v", recorded, fields)
	}

	// Unreadable: nothing recorded, so nothing is taken off.
	meta.AddAnnotations(mg, map[string]string{LastAppliedAnnotation: "{"})
	if recorded, _ := LastAppliedOf(mg); recorded {
		t.Fatal("an unreadable record was read")
	}
}

func sortedStrings(values []*string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if v != nil {
			out = append(out, *v)
		}
	}
	sort.Strings(out)
	return out
}
