package config

// Upgrading from a provider that late-initialized what OneUptime keeps
// (#9985): a manifest whose spec.forProvider version 15 filled with a
// monitor's status and its telemetry evaluation times, read by this version,
// with no hand edit. The fields only OneUptime writes are no fields of
// spec.forProvider any more, so the API server drops them from the stored
// object (pruning) and the provider never reads them; the status is still
// one, and is never compared once the monitor exists. Nothing is written
// back, and nothing fails.

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/crossplane/v1alpha1"
)

// A Metrics monitor's manifest as version 15 left it, late initialization
// and all, naming the record by its ID.
func monitorLeftByVersion15(t *testing.T, id, name, monitorType string) *v1alpha1.Monitor {
	t.Helper()
	manifest := `{
		"apiVersion": "crossplane.oneuptime.com/v1alpha1",
		"kind": "Monitor",
		"metadata": {
			"name": "` + name + `",
			"namespace": "team-a",
			"uid": "uid-` + name + `",
			"annotations": {"crossplane.io/external-name": "` + id + `"}
		},
		"spec": {
			"managementPolicies": ["*"],
			"forProvider": {
				"name": "` + name + `",
				"monitorType": "` + monitorType + `",
				"currentMonitorStatusId": "` + operationalStatusID + `",
				"keepResponseContent": true,
				"telemetryMonitorLastMonitorAt": "` + firstEvaluation + `",
				"telemetryMonitorNextMonitorAt": "` + secondEvaluation + `"
			}
		}
	}`
	mg := &v1alpha1.Monitor{}
	if err := json.Unmarshal([]byte(manifest), mg); err != nil {
		t.Fatal(err)
	}
	return mg
}

func TestAMonitorVersion15LateInitializedStopsFightingOneUptime(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	// The record as OneUptime has it now: offline, evaluated twice since.
	id := api.seed("monitor", map[string]any{
		"name":                          "checkout-latency",
		"monitorType":                   "Metrics",
		"currentMonitorStatusId":        offlineStatusID,
		"keepResponseContent":           true,
		"disableActiveMonitoring":       false,
		"isArchived":                    false,
		"description":                   "",
		"telemetryMonitorLastMonitorAt": thirdEvaluation,
		"telemetryMonitorNextMonitorAt": "2026-11-19T10:03:00.000Z",
	})
	r := newReconciler(t, api)

	mg := monitorLeftByVersion15(t, id, "checkout-latency", "Metrics")
	// What the API server keeps of it: the evaluation times are no fields now.
	set := jsonFields(t, mg.Spec.ForProvider)
	for _, gone := range []string{"telemetryMonitorLastMonitorAt", "telemetryMonitorNextMonitorAt"} {
		if _, ok := set[gone]; ok {
			t.Errorf("spec.forProvider still holds %s", gone)
		}
	}
	if set["currentMonitorStatusId"] != operationalStatusID {
		t.Fatalf("spec.forProvider lost the status version 15 copied: %v", set)
	}

	for i := 0; i < 3; i++ {
		obs, err := r.reconcile("oneuptime_monitor", mg)
		if isReplacementError(err) {
			t.Fatalf("reconcile %d still fails as the issue does: %v", i, err)
		}
		if err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
		if !obs.ResourceUpToDate {
			t.Errorf("reconcile %d: the monitor is not up to date", i)
		}
		// Its next evaluation.
		api.set("monitor", id, map[string]any{
			"telemetryMonitorLastMonitorAt": fmt.Sprintf("2026-11-19T10:1%d:00.000Z", i),
		})
	}
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Errorf("the provider wrote to the monitor: %+v", updates)
	}
	if got := api.record("monitor", id)["currentMonitorStatusId"]; got != offlineStatusID {
		t.Errorf("the monitor's status is %v, want OneUptime's, %s", got, offlineStatusID)
	}
}

func TestAWebsiteMonitorVersion15LateInitializedKeepsItsStatus(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	id := api.seed("monitor", map[string]any{
		"name":                    "homepage",
		"monitorType":             "Website",
		"currentMonitorStatusId":  offlineStatusID,
		"keepResponseContent":     true,
		"disableActiveMonitoring": false,
		"isArchived":              false,
		"description":             "",
	})
	r := newReconciler(t, api)

	mg := monitorLeftByVersion15(t, id, "homepage", "Website")
	obs, err := r.reconcile("oneuptime_monitor", mg)
	if err != nil {
		t.Fatalf("the first reconcile after the upgrade: %v", err)
	}
	if !obs.ResourceUpToDate {
		t.Error("the monitor's status in spec.forProvider is still compared with OneUptime's")
	}
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Errorf("the provider set the status back: %+v", updates)
	}
}
