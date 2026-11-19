package config

// What OneUptime moves on its own, through a monitor's reconciles (#9985):
// its current status, which its checks move, and a telemetry monitor's
// evaluation times, which every evaluation moves. Each test drives a
// Monitor the way the provider does (fakeapi_test.go): it creates the
// record, lets the next reconcile late-initialize the spec, moves the
// record as OneUptime does, and reconciles again.

import (
	"strings"
	"testing"

	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/crossplane/v1alpha1"
)

const (
	operationalStatusID = "11111111-0000-4000-8000-000000000001"
	offlineStatusID     = "11111111-0000-4000-8000-000000000002"

	firstEvaluation  = "2026-11-19T10:00:00.000Z"
	secondEvaluation = "2026-11-19T10:01:00.000Z"
	thirdEvaluation  = "2026-11-19T10:02:00.000Z"
)

// monitorAsOneUptimeCreatesIt fills a new monitor in as OneUptime does: its
// project's operational status, monitoring on, and - for a telemetry
// monitor - an evaluation already run and the next one due.
func monitorAsOneUptimeCreatesIt(record map[string]any) {
	if record["currentMonitorStatusId"] == nil {
		record["currentMonitorStatusId"] = operationalStatusID
	}
	for field, value := range map[string]any{
		"disableActiveMonitoring": false,
		"keepResponseContent":     true,
		"isArchived":              false,
		"description":             "",
	} {
		if record[field] == nil {
			record[field] = value
		}
	}
	if record["monitorType"] == "Metrics" {
		record["telemetryMonitorLastMonitorAt"] = firstEvaluation
		record["telemetryMonitorNextMonitorAt"] = secondEvaluation
	}
}

func ptrTo[T any](v T) *T {
	return &v
}

// newMonitor is a Monitor manifest under the default management policy.
func newMonitor(name, monitorType string) *v1alpha1.Monitor {
	mg := &v1alpha1.Monitor{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "team-a", UID: types.UID("uid-" + name)},
	}
	mg.Spec.ForProvider.Name = ptrTo(name)
	mg.Spec.ForProvider.MonitorType = ptrTo(monitorType)
	mg.SetManagementPolicies(xpv2.ManagementPolicies{xpv2.ManagementActionAll})
	return mg
}

// The fields OneUptime moves on its own, which the spec must never hold
// after late initialization.
var monitorFieldsOneUptimeMoves = []string{
	"currentMonitorStatusId",
	"telemetryMonitorLastMonitorAt",
	"telemetryMonitorNextMonitorAt",
}

func assertNotLateInitialized(t *testing.T, forProvider any, fields []string) {
	t.Helper()
	set := jsonFields(t, forProvider)
	for _, field := range fields {
		if value, ok := set[field]; ok {
			t.Errorf("late initialization copied %s (%v) into spec.forProvider, which now holds %v", field, value, sortedFieldNames(set))
		}
	}
}

func TestAMetricsMonitorLeavesItsStatusAndEvaluationTimesToOneUptime(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)

	mg := newMonitor("checkout-latency", "Metrics")
	r.create("oneuptime_monitor", mg)
	id := meta.GetExternalName(mg)

	// The next reconcile late-initializes the spec from the record.
	if _, err := r.reconcile("oneuptime_monitor", mg); err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}
	assertNotLateInitialized(t, mg.Spec.ForProvider, monitorFieldsOneUptimeMoves)
	if mg.Status.AtProvider.CurrentMonitorStatusID == nil || *mg.Status.AtProvider.CurrentMonitorStatusID != operationalStatusID {
		t.Errorf("status.atProvider does not show the monitor's status: %v", mg.Status.AtProvider.CurrentMonitorStatusID)
	}

	// Its next evaluation finds the metric over its threshold.
	api.set("monitor", id, map[string]any{
		"currentMonitorStatusId":        offlineStatusID,
		"telemetryMonitorLastMonitorAt": secondEvaluation,
		"telemetryMonitorNextMonitorAt": thirdEvaluation,
	})
	obs, err := r.reconcile("oneuptime_monitor", mg)
	if isReplacementError(err) {
		t.Fatalf("every reconcile after an evaluation fails, and the monitor stops syncing: %v", err)
	}
	if err != nil {
		t.Fatalf("the reconcile after an evaluation: %v", err)
	}
	if !obs.ResourceUpToDate {
		t.Error("the monitor is not up to date after OneUptime moved what it owns")
	}
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Errorf("the provider wrote to the monitor: %+v", updates)
	}
	if got := api.record("monitor", id)["currentMonitorStatusId"]; got != offlineStatusID {
		t.Errorf("the monitor's status is %v, want the one its check set, %s", got, offlineStatusID)
	}
	if got := mg.Status.AtProvider.CurrentMonitorStatusID; got == nil || *got != offlineStatusID {
		t.Errorf("status.atProvider shows the status %v, want %s", got, offlineStatusID)
	}
}

func TestAMonitorIsNotPutBackInTheStatusItWasCreatedIn(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)

	mg := newMonitor("homepage", "Website")
	r.create("oneuptime_monitor", mg)
	id := meta.GetExternalName(mg)
	if _, err := r.reconcile("oneuptime_monitor", mg); err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}

	// A check finds the homepage down, three times over.
	for i := 0; i < 3; i++ {
		api.set("monitor", id, map[string]any{"currentMonitorStatusId": offlineStatusID})
		obs, err := r.reconcile("oneuptime_monitor", mg)
		if err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
		if !obs.ResourceUpToDate {
			t.Errorf("reconcile %d: the monitor is not up to date after its check moved its status", i)
		}
	}
	for _, update := range api.updates("monitor", id) {
		if value, ok := update.Data["currentMonitorStatusId"]; ok {
			t.Errorf("the provider set the monitor's status back to %v", value)
		}
	}
	if got := api.record("monitor", id)["currentMonitorStatusId"]; got != offlineStatusID {
		t.Errorf("the monitor's status is %v, want %s", got, offlineStatusID)
	}
}

// spec.initProvider is what the record is created with, and then OneUptime's:
// late initialization leaves it out of spec.forProvider (#9985).
func TestAStatusGivenInInitProviderStartsTheMonitorAndIsNeverPutBack(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)

	mg := newMonitor("api", "Website")
	mg.Spec.InitProvider.CurrentMonitorStatusID = ptrTo(offlineStatusID)
	r.create("oneuptime_monitor", mg)
	id := meta.GetExternalName(mg)

	creates := api.creates("monitor")
	if len(creates) != 1 || creates[0].Data["currentMonitorStatusId"] != offlineStatusID {
		t.Fatalf("the monitor was not created in the status spec.initProvider gives: %+v", creates)
	}
	if _, err := r.reconcile("oneuptime_monitor", mg); err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}
	assertNotLateInitialized(t, mg.Spec.ForProvider, []string{"currentMonitorStatusId"})

	// Its first check finds it up.
	api.set("monitor", id, map[string]any{"currentMonitorStatusId": operationalStatusID})
	obs, err := r.reconcile("oneuptime_monitor", mg)
	if err != nil {
		t.Fatalf("the reconcile after a check: %v", err)
	}
	if !obs.ResourceUpToDate {
		t.Error("the monitor is not up to date after its check moved its status")
	}
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Errorf("the provider wrote to the monitor: %+v", updates)
	}
}

// What a replacement error says, as the provider reports it: the issue's.
func isReplacementError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "require resource replacement")
}
