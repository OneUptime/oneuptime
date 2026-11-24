package provider

/*
 * A SETTING ADDED IN THE DASHBOARD TO STEPS TERRAFORM WROTE
 * (OneUptime/oneuptime#10907).
 *
 * What OneUptime writes of its own when a configuration leaves a setting out
 * is no change; a setting someone added in the Dashboard is, and the plan
 * shows it - not every default beside it - and the apply that follows does
 * what the plan said. Checked against what the server's own code answers for
 * steps written sparsely (testdata/monitor_steps_server_defaults.json, which
 * the generator writes from Core/MonitorStepsServerDefaultsCases.ts), and
 * through the provider's real protocol server against the fake API of
 * monitorstepsvalues_roundtrip_test.go.
 */

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

type monitorStepsServerDefaultsCase struct {
	Name     string                 `json:"name"`
	Sent     map[string]interface{} `json:"sent"`
	Answered map[string]interface{} `json:"answered"`
}

func loadMonitorStepsServerDefaultsCases(t *testing.T) []monitorStepsServerDefaultsCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "monitor_steps_server_defaults.json"))
	if err != nil {
		t.Fatalf("reading the cases the generator writes from the server's own code: %s", err)
	}
	var cases struct {
		Cases []monitorStepsServerDefaultsCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("parsing the server's cases: %s", err)
	}
	if len(cases.Cases) < 8 {
		t.Fatalf("the server's cases hold %d cases, fewer than they should", len(cases.Cases))
	}
	return cases.Cases
}

func (c monitorStepsServerDefaultsCase) answeredCopy(t *testing.T) map[string]interface{} {
	t.Helper()
	return monitorStepsTestJSONCopy(t, c.Answered)
}

func driftCase(t *testing.T, cases []monitorStepsServerDefaultsCase, name string) monitorStepsServerDefaultsCase {
	t.Helper()
	for _, c := range cases {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("the server's cases have no case %q", name)
	return monitorStepsServerDefaultsCase{}
}

// The steps of a wire value, as a read takes them.
func driftSteps(t *testing.T, wire interface{}) types.List {
	t.Helper()
	list, diags := MonitorStepsFromAPI(context.Background(), monitorStepsTestJSONCopy(t, wire))
	monitorStepsTestFatalOnDiagError(t, "reading the steps", diags)
	return list
}

// Whether held reads as the steps written: what a refresh and an apply decide.
func driftSame(t *testing.T, written, held types.List) bool {
	t.Helper()
	equal, diags := MonitorStepsValue{ListValue: held}.ListSemanticEquals(context.Background(), MonitorStepsValue{ListValue: written})
	if diags.HasError() {
		t.Fatalf("comparing the steps: %v", diags)
	}
	return equal
}

// The steps as the API takes them, as plain JSON.
func driftPlain(t *testing.T, list types.List) interface{} {
	t.Helper()
	steps, diags := MonitorStepsToAPI(context.Background(), list)
	monitorStepsTestFatalOnDiagError(t, "writing the steps", diags)
	plain, err := toPlainJSON(steps)
	if err != nil {
		t.Fatalf("reading the steps as JSON: %s", err)
	}
	return plain
}

// The keys of a plain JSON value, path by path, sorted: what it says, not its values.
func driftKeys(value interface{}, prefix string, out *[]string) {
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, child := range typed {
			*out = append(*out, prefix+"."+key)
			driftKeys(child, prefix+"."+key, out)
		}
	case []interface{}:
		for i, child := range typed {
			driftKeys(child, prefix+"["+string(rune('0'+i))+"]", out)
		}
	}
}

func driftKeysOf(t *testing.T, list types.List) []string {
	t.Helper()
	keys := []string{}
	driftKeys(driftPlain(t, list), "", &keys)
	sort.Strings(keys)
	return keys
}

// The one criteria of the one step of a wire value, to change in place.
func driftCriteria(t *testing.T, wire map[string]interface{}) map[string]interface{} {
	t.Helper()
	return recoveryHoursCriteriaOf(t, wire)
}

func driftStep(t *testing.T, wire map[string]interface{}) map[string]interface{} {
	t.Helper()
	return monitorStepsWireValue(monitorStepsWireValue(wire)["monitorStepsInstanceArray"].([]interface{})[0])
}

// A criteria attribute of the one step's one criteria.
func driftCriteriaAttribute(t *testing.T, list types.List, name string) attr.Value {
	t.Helper()
	step := list.Elements()[0].(types.Object)
	criteria := step.Attributes()["criteria"].(types.List).Elements()[0].(types.Object)
	return criteria.Attributes()[name]
}

// Weekdays from 08:00 to 18:00 in Oslo, as the Dashboard's picker keeps them.
func driftActiveHours(t *testing.T) map[string]interface{} {
	t.Helper()
	return monitorStepsTestJSONCopy(t, monitorStepsActiveHoursToAPI(recoveryHoursAttrs(t, []int64{0, 1, 2, 3, 4}, "08:00", "18:00"), "Europe/Oslo"))
}

// ---------------------------------------------------------------------------
// What the server answers for steps written sparsely
// ---------------------------------------------------------------------------

func TestMonitorStepsDrift_WhatOneUptimeAnswersForStepsWrittenSparselyIsNoChange(t *testing.T) {
	ctx := context.Background()
	heldMore := 0

	for _, c := range loadMonitorStepsServerDefaultsCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			written := driftSteps(t, c.Sent)
			held := driftSteps(t, c.Answered)

			// Read the way the comparison reads them: a bare origin without its slash.
			normalized := func(list types.List) interface{} {
				return normalizeMonitorStepsValues(normalizeURLWrapperLeaves(driftPlain(t, list)))
			}
			if !jsonIsSubset(normalized(written), normalized(held)) {
				t.Fatalf("OneUptime's answer does not hold the steps sent: the cases are not what they say")
			}
			if !reflect.DeepEqual(driftKeysOf(t, written), driftKeysOf(t, held)) {
				heldMore++
			}

			// After an apply and on a refresh: no change, and no inconsistent result.
			if !driftSame(t, written, held) {
				t.Fatalf("what OneUptime writes of its own reads as a change:\nwritten %v\nheld    %v", driftKeysOf(t, written), driftKeysOf(t, held))
			}

			// Right after an import: no change.
			if !monitorStepsSameAfterImport(ctx, written, held) {
				t.Fatalf("right after an import, OneUptime's own defaults read as a change")
			}

			// The state keeps none of them: it says what the configuration says.
			kept := MonitorStepsKeepWritten(ctx, written, held)
			if got, want := driftKeysOf(t, kept), driftKeysOf(t, written); !reflect.DeepEqual(got, want) {
				t.Fatalf("the state keeps\n%v\nnot what the configuration writes\n%v", got, want)
			}
			if !driftSame(t, written, kept) {
				t.Fatalf("the steps kept in state read as a change")
			}
		})
	}

	// The cases do hold defaults OneUptime writes of its own.
	if heldMore == 0 {
		t.Fatalf("no case's answer holds anything the steps sent leave out")
	}
}

// ---------------------------------------------------------------------------
// A setting added in the Dashboard
// ---------------------------------------------------------------------------

func TestMonitorStepsDrift_ASettingAddedInTheDashboardIsAChange(t *testing.T) {
	ctx := context.Background()
	cases := loadMonitorStepsServerDefaultsCases(t)
	page := driftCase(t, cases, "a page checked for being online, every setting but its destination and criteria left out")
	written := driftSteps(t, page.Sent)

	additions := []struct {
		name string
		add  func(step map[string]interface{}, criteria map[string]interface{})
		// The attribute of the criteria the state then holds, or "" for a step's.
		shownIn string
	}{
		{"active hours on a criteria that had none", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["activeHours"] = driftActiveHours(t)
			criteria["activeHoursTimezone"] = "Europe/Oslo"
		}, "active_hours"},
		{"a recovery condition", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["recoveryFilters"] = []interface{}{map[string]interface{}{
				"checkOn":          "Is Online",
				"filterType":       "True",
				"evaluateOverTime": true,
				"evaluateOverTimeOptions": map[string]interface{}{
					"timeValueInMinutes":   float64(10),
					"evaluateOverTimeType": "All Values",
				},
			}}
			criteria["recoveryFilterCondition"] = "All"
		}, "recovery_filters"},
		{"an incident template on a criteria that opened none", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["createIncidents"] = true
			criteria["incidents"] = []interface{}{map[string]interface{}{
				"id":                 "a1000000-0000-4000-8000-0000000109c1",
				"title":              "The shop is down",
				"description":        "Opened in the Dashboard.",
				"incidentSeverityId": "a1000000-0000-4000-8000-0000000109b3",
			}}
		}, "incidents"},
		{"an alert template", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["alerts"] = []interface{}{map[string]interface{}{
				"title":           "The shop is down",
				"description":     "Opened in the Dashboard.",
				"alertSeverityId": "a1000000-0000-4000-8000-0000000109b3",
			}}
		}, "alerts"},
		{"the criteria turned off", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["isEnabled"] = false
		}, "is_enabled"},
		{"incidents turned on", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["createIncidents"] = true
		}, "create_incidents"},
		{"a status it sets", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["monitorStatusId"] = "a1000000-0000-4000-8000-0000000109b2"
			criteria["changeMonitorStatus"] = true
		}, "monitor_status_id"},
		{"a description", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["description"] = "Written in the Dashboard."
		}, "description"},
		{"incident grouping", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["incidentGrouping"] = map[string]interface{}{"groupBy": "payload.region"}
		}, "incident_grouping"},
		{"a window on its filter", func(_ map[string]interface{}, criteria map[string]interface{}) {
			filter := criteria["filters"].([]interface{})[0].(map[string]interface{})
			filter["evaluateOverTime"] = true
			filter["evaluateOverTimeOptions"] = map[string]interface{}{
				"timeValueInMinutes":   float64(5),
				"evaluateOverTimeType": "All Values",
			}
		}, "filters"},
		{"a second filter", func(_ map[string]interface{}, criteria map[string]interface{}) {
			criteria["filters"] = append(criteria["filters"].([]interface{}), map[string]interface{}{
				"checkOn": "Response Time (in ms)", "filterType": "Greater Than", "value": float64(500),
			})
		}, "filters"},
		{"a request header", func(step map[string]interface{}, _ map[string]interface{}) {
			step["requestHeaders"] = map[string]interface{}{"X-From-Dashboard": "1"}
		}, ""},
		{"retries", func(step map[string]interface{}, _ map[string]interface{}) {
			step["retryCountOnError"] = float64(3)
		}, ""},
		{"another request type", func(step map[string]interface{}, _ map[string]interface{}) {
			step["requestType"] = "HEAD"
		}, ""},
	}

	for _, addition := range additions {
		t.Run(addition.name, func(t *testing.T) {
			wire := page.answeredCopy(t)
			addition.add(driftStep(t, wire), driftCriteria(t, wire))
			held := driftSteps(t, wire)

			if driftSame(t, written, held) {
				t.Fatalf("%s reads as no change: a refresh keeps the old state and the plan hides it", addition.name)
			}
			if monitorStepsSameAfterImport(ctx, written, held) {
				t.Fatalf("right after an import, %s reads as no change", addition.name)
			}

			// The state takes the setting, and none of OneUptime's defaults.
			kept := MonitorStepsKeepWritten(ctx, written, held)
			if driftSame(t, written, kept) {
				t.Fatalf("the steps kept in state lose %s", addition.name)
			}
			if addition.shownIn != "" && driftCriteriaAttribute(t, kept, addition.shownIn).IsNull() {
				t.Fatalf("the state's criteria holds no %s", addition.shownIn)
			}
			for _, defaulted := range []string{"change_monitor_status", "create_alerts", "is_enabled"} {
				// What the addition itself sets is the addition, not a default.
				if defaulted == addition.shownIn || (addition.shownIn == "monitor_status_id" && defaulted == "change_monitor_status") {
					continue
				}
				if !driftCriteriaAttribute(t, kept, defaulted).IsNull() {
					t.Fatalf("the state keeps OneUptime's own %s, which the plan would show beside %s", defaulted, addition.name)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// What means the same as unset, written out in the Dashboard
// ---------------------------------------------------------------------------

func TestMonitorStepsDrift_WhatMeansUnsetIsNoChangeAndItsOppositeIs(t *testing.T) {
	ctx := context.Background()
	cases := loadMonitorStepsServerDefaultsCases(t)
	templates := driftCase(t, cases, "a criteria that opens an incident and an alert, the templates' flags left out")
	windows := driftCase(t, cases, "windows that count, a percentile and a previous check, each one's no-data setting left out")
	api := driftCase(t, cases, "an API request with a method, headers and a body, its body's format and redirects left out")

	incidentOf := func(criteria map[string]interface{}) map[string]interface{} {
		return criteria["incidents"].([]interface{})[0].(map[string]interface{})
	}
	alertOf := func(criteria map[string]interface{}) map[string]interface{} {
		return criteria["alerts"].([]interface{})[0].(map[string]interface{})
	}
	filterOf := func(criteria map[string]interface{}, index int) map[string]interface{} {
		return criteria["filters"].([]interface{})[index].(map[string]interface{})
	}
	windowOf := func(criteria map[string]interface{}, index int) map[string]interface{} {
		return filterOf(criteria, index)["evaluateOverTimeOptions"].(map[string]interface{})
	}

	cases2 := []struct {
		name string
		of   monitorStepsServerDefaultsCase
		set  func(step map[string]interface{}, criteria map[string]interface{})
		same bool
	}{
		{"an incident that is not private", templates, func(_, c map[string]interface{}) { incidentOf(c)["isPrivate"] = false }, true},
		{"an incident that is private", templates, func(_, c map[string]interface{}) { incidentOf(c)["isPrivate"] = true }, false},
		{"an incident shown on status pages", templates, func(_, c map[string]interface{}) { incidentOf(c)["showIncidentOnStatusPage"] = true }, true},
		{"an incident kept off status pages", templates, func(_, c map[string]interface{}) { incidentOf(c)["showIncidentOnStatusPage"] = false }, false},
		{"an incident left open", templates, func(_, c map[string]interface{}) { incidentOf(c)["autoResolveIncident"] = false }, true},
		{"an incident that resolves itself", templates, func(_, c map[string]interface{}) { incidentOf(c)["autoResolveIncident"] = true }, false},
		{"an alert that is not private", templates, func(_, c map[string]interface{}) { alertOf(c)["isPrivate"] = false }, true},
		{"an alert left open", templates, func(_, c map[string]interface{}) { alertOf(c)["autoResolveAlert"] = false }, true},
		{"an alert that resolves itself", templates, func(_, c map[string]interface{}) { alertOf(c)["autoResolveAlert"] = true }, false},
		{"a criteria not opened for every email", templates, func(_, c map[string]interface{}) { c["openForEveryEmail"] = false }, true},
		{"a criteria opened for every email", templates, func(_, c map[string]interface{}) { c["openForEveryEmail"] = true }, false},
		{"a filter with no window", templates, func(_, c map[string]interface{}) { filterOf(c, 0)["evaluateOverTime"] = false }, true},
		{"a window that is off, its options kept", templates, func(_, c map[string]interface{}) {
			filterOf(c, 0)["evaluateOverTime"] = false
			filterOf(c, 0)["evaluateOverTimeOptions"] = map[string]interface{}{"timeValueInMinutes": float64(5), "evaluateOverTimeType": "All Values"}
		}, true},
		{"a window that is on, its options set in the Dashboard", templates, func(_, c map[string]interface{}) {
			filterOf(c, 0)["evaluateOverTime"] = true
			filterOf(c, 0)["evaluateOverTimeOptions"] = map[string]interface{}{"timeValueInMinutes": float64(5), "evaluateOverTimeType": "All Values"}
		}, false},
		{"a window that ignores no data", windows, func(_, c map[string]interface{}) { windowOf(c, 0)["onNoDataPolicy"] = "Ignore" }, true},
		{"a window that triggers on no data", windows, func(_, c map[string]interface{}) { windowOf(c, 0)["onNoDataPolicy"] = "Trigger" }, false},
		{"a percentile window's count left at its default", windows, func(_, c map[string]interface{}) {
			windowOf(c, 1)["countFilterType"] = "Greater Than"
			windowOf(c, 1)["countValue"] = float64(0)
		}, true},
		{"a count of more than 1", windows, func(_, c map[string]interface{}) { windowOf(c, 1)["countValue"] = float64(1) }, false},
		{"a body in JSON", api, func(s, _ map[string]interface{}) { s["requestBodyFormat"] = "json" }, true},
		{"a body as text", api, func(s, _ map[string]interface{}) { s["requestBodyFormat"] = "text" }, false},
		{"redirects followed", api, func(s, _ map[string]interface{}) { s["doNotFollowRedirects"] = false }, true},
		{"redirects not followed", api, func(s, _ map[string]interface{}) { s["doNotFollowRedirects"] = true }, false},
		{"self-signed certificates refused", api, func(s, _ map[string]interface{}) { s["allowSelfSignedCertificates"] = false }, true},
		{"self-signed certificates allowed", api, func(s, _ map[string]interface{}) { s["allowSelfSignedCertificates"] = true }, false},
	}

	for _, tc := range cases2 {
		t.Run(tc.name, func(t *testing.T) {
			written := driftSteps(t, tc.of.Sent)
			wire := tc.of.answeredCopy(t)
			tc.set(driftStep(t, wire), driftCriteria(t, wire))
			held := driftSteps(t, wire)

			if got := driftSame(t, written, held); got != tc.same {
				t.Fatalf("%s: the same steps = %t, want %t", tc.name, got, tc.same)
			}
			if got := monitorStepsSameAfterImport(ctx, written, held); got != tc.same {
				t.Fatalf("%s: the same steps right after an import = %t, want %t", tc.name, got, tc.same)
			}

			kept := MonitorStepsKeepWritten(ctx, written, held)
			if tc.same && !reflect.DeepEqual(driftKeysOf(t, kept), driftKeysOf(t, written)) {
				t.Fatalf("%s: the state keeps\n%v\nnot what the configuration writes\n%v", tc.name, driftKeysOf(t, kept), driftKeysOf(t, written))
			}
			if !tc.same && driftSame(t, written, kept) {
				t.Fatalf("%s: the state loses it", tc.name)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// The escape hatches written with jsonencode()
// ---------------------------------------------------------------------------

func TestMonitorStepsDrift_EscapeHatchesKeepWhatOneUptimeFillsIn(t *testing.T) {
	cases := loadMonitorStepsServerDefaultsCases(t)
	metrics := driftCase(t, cases, "a metrics step whose query names no aggregation, and a filter's metric options")
	written := driftSteps(t, metrics.Sent)

	settingsOf := func(step map[string]interface{}) map[string]interface{} {
		return step["metricMonitor"].(map[string]interface{})
	}
	optionsOf := func(criteria map[string]interface{}) map[string]interface{} {
		return criteria["filters"].([]interface{})[0].(map[string]interface{})["metricMonitorOptions"].(map[string]interface{})
	}

	for _, tc := range []struct {
		name string
		set  func(step map[string]interface{}, criteria map[string]interface{})
		same bool
	}{
		{"a key OneUptime fills in inside the sub-config", func(s, _ map[string]interface{}) { settingsOf(s)["filledIn"] = "by OneUptime" }, true},
		{"a key OneUptime fills in inside a filter's options", func(_, c map[string]interface{}) { optionsOf(c)["filledIn"] = "by OneUptime" }, true},
		{"a sub-config the configuration does not write", func(s, _ map[string]interface{}) {
			s["logMonitor"] = map[string]interface{}{"lastXSecondsOfLogs": float64(60)}
		}, true},
		{"the sub-config's own value changed", func(s, _ map[string]interface{}) { settingsOf(s)["rollingTime"] = "Past 1 Hour" }, false},
		{"a filter option's own value changed", func(_, c map[string]interface{}) { optionsOf(c)["metricAggregationType"] = "Sum" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wire := metrics.answeredCopy(t)
			tc.set(driftStep(t, wire), driftCriteria(t, wire))
			if got := driftSame(t, written, driftSteps(t, wire)); got != tc.same {
				t.Fatalf("%s: the same steps = %t, want %t", tc.name, got, tc.same)
			}
		})
	}
}

// Two steps, or two criteria, are compared one by one, and their number counts.
func TestMonitorStepsDrift_AStepOrACriteriaAddedInTheDashboardIsAChange(t *testing.T) {
	cases := loadMonitorStepsServerDefaultsCases(t)
	twoSteps := driftCase(t, cases, "two steps, the second a port")
	written := driftSteps(t, twoSteps.Sent)

	if !driftSame(t, written, driftSteps(t, twoSteps.Answered)) {
		t.Fatalf("two steps as OneUptime answers them read as a change")
	}

	// A third step.
	wire := twoSteps.answeredCopy(t)
	instances := monitorStepsWireValue(wire)["monitorStepsInstanceArray"].([]interface{})
	monitorStepsWireValue(wire)["monitorStepsInstanceArray"] = append(instances, monitorStepsTestJSONCopy(t, instances[0]))
	if driftSame(t, written, driftSteps(t, wire)) {
		t.Fatalf("a step added in the Dashboard reads as no change")
	}

	// A second criteria on the first step.
	wire = twoSteps.answeredCopy(t)
	criteria := monitorStepsWireValue(monitorStepsWireValue(monitorStepsWireValue(wire)["monitorStepsInstanceArray"].([]interface{})[0])["monitorCriteria"])
	list := criteria["monitorCriteriaInstanceArray"].([]interface{})
	criteria["monitorCriteriaInstanceArray"] = append(list, monitorStepsTestJSONCopy(t, list[0]))
	held := driftSteps(t, wire)
	if driftSame(t, written, held) {
		t.Fatalf("a criteria added in the Dashboard reads as no change")
	}

	// Kept whole: the plan shows the list as OneUptime holds it.
	kept := MonitorStepsKeepWritten(context.Background(), written, held)
	keptCriteria := kept.Elements()[0].(types.Object).Attributes()["criteria"].(types.List)
	heldCriteria := held.Elements()[0].(types.Object).Attributes()["criteria"].(types.List)
	if !keptCriteria.Equal(heldCriteria) {
		t.Fatalf("a list of another length is not kept as OneUptime holds it:\n%s\nnot\n%s", keptCriteria, heldCriteria)
	}
	if driftSame(t, written, kept) {
		t.Fatalf("the steps kept in state lose the criteria added in the Dashboard")
	}
}

// ---------------------------------------------------------------------------
// Through the provider's real protocol server
// ---------------------------------------------------------------------------

// A monitor Terraform writes: offline on its one criteria.
func driftConfiguredCriteria() map[string]interface{} {
	return map[string]interface{}{
		"name":                "Offline",
		"filterCondition":     "All",
		"filters":             []interface{}{map[string]interface{}{"checkOn": "Is Online", "filterType": "False"}},
		"monitorStatusId":     "a1000000-0000-4000-8000-0000000109b2",
		"changeMonitorStatus": true,
	}
}

// The steps as a configuration writes them, every value it is given kept.
func driftConfiguredSteps(t *testing.T, tf *stepValuesTerraform, criteria map[string]interface{}) tftypes.Value {
	t.Helper()
	list, diags := MonitorStepsFromAPI(tf.ctx, monitorStepsTestJSONCopy(t, monitorStepWire("https://example.com", criteria, nil)))
	if diags.HasError() {
		t.Fatalf("reading the configured steps: %v", diags)
	}
	value, err := list.ToTerraformValue(tf.ctx)
	if err != nil {
		t.Fatalf("encoding the configured steps: %s", err)
	}
	return value
}

func driftStoredCriteria(t *testing.T, api *stepValuesAPI, id string) map[string]interface{} {
	t.Helper()
	api.mu.Lock()
	defer api.mu.Unlock()
	return monitorStepsTestJSONCopy(t, recoveryHoursCriteriaOf(t, api.rows["/monitor"][id]["monitorSteps"]))
}

// Someone changes the stored criteria in the Dashboard.
func driftInTheDashboard(t *testing.T, api *stepValuesAPI, id string, change func(criteria map[string]interface{})) {
	t.Helper()
	api.mu.Lock()
	defer api.mu.Unlock()
	change(recoveryHoursCriteriaOf(t, api.rows["/monitor"][id]["monitorSteps"]))
}

func driftStateCriteriaAttribute(t *testing.T, state settled, name string) tftypes.Value {
	t.Helper()
	steps := attributesOf(t, state.state)["monitor_steps"]
	var elements []tftypes.Value
	if err := steps.As(&elements); err != nil || len(elements) == 0 {
		t.Fatalf("the state holds no steps: %v", err)
	}
	var criteria []tftypes.Value
	if err := attributesOf(t, elements[0])["criteria"].As(&criteria); err != nil || len(criteria) == 0 {
		t.Fatalf("the state's step holds no criteria: %v", err)
	}
	return attributesOf(t, criteria[0])[name]
}

func TestMonitorStepsDrift_ASettingAddedInTheDashboardShowsInThePlanAndTheApplyDoesWhatItSaid(t *testing.T) {
	for _, tc := range []struct {
		name     string
		add      func(t *testing.T, criteria map[string]interface{})
		storeKey string
		shownIn  string
	}{
		{"active hours", func(t *testing.T, criteria map[string]interface{}) {
			criteria["activeHours"] = driftActiveHours(t)
			criteria["activeHoursTimezone"] = "Europe/Oslo"
		}, "activeHours", "active_hours"},
		{"a recovery condition", func(_ *testing.T, criteria map[string]interface{}) {
			criteria["recoveryFilters"] = []interface{}{map[string]interface{}{
				"checkOn": "Is Online", "filterType": "True", "evaluateOverTime": true,
				"evaluateOverTimeOptions": map[string]interface{}{"timeValueInMinutes": float64(10), "evaluateOverTimeType": "All Values"},
			}}
			criteria["recoveryFilterCondition"] = "All"
		}, "recoveryFilters", "recovery_filters"},
		{"an incident template on a criteria that opened none", func(_ *testing.T, criteria map[string]interface{}) {
			criteria["createIncidents"] = true
			criteria["incidents"] = []interface{}{map[string]interface{}{
				"id":                 "a1000000-0000-4000-8000-0000000109c1",
				"title":              "The shop is down",
				"incidentSeverityId": "a1000000-0000-4000-8000-0000000109b3",
			}}
		}, "incidents", "incidents"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api := newStepValuesAPI(t)
			tf := newStepValuesTerraform(t, api)

			// Written by Terraform.
			config := recoveryHoursConfig(tf, "Shop", driftConfiguredSteps(t, tf, driftConfiguredCriteria()))
			created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, config)
			id := stringAttribute(t, created.state, "id")
			requireStepsAsConfigured(t, "after the create", created, config)

			// OneUptime's own defaults plan no change.
			refreshed := tf.refresh("oneuptime_monitor", created)
			if changed := tf.changes("oneuptime_monitor", refreshed, config); len(changed) > 0 {
				t.Fatalf("the plan after the create changes %v", changed)
			}

			// Set in the Dashboard.
			driftInTheDashboard(t, api, id, func(criteria map[string]interface{}) { tc.add(t, criteria) })

			// The refresh takes it into state - and none of OneUptime's defaults beside it.
			drifted := tf.refresh("oneuptime_monitor", refreshed)
			if driftStateCriteriaAttribute(t, drifted, tc.shownIn).IsNull() {
				t.Fatalf("the refreshed state holds no %s", tc.shownIn)
			}
			for _, defaulted := range []string{"is_enabled", "create_alerts"} {
				if !driftStateCriteriaAttribute(t, drifted, defaulted).IsNull() {
					t.Fatalf("the refreshed state holds OneUptime's own %s, which the plan would show beside %s", defaulted, tc.name)
				}
			}

			// The plan says so.
			if changed := tf.changes("oneuptime_monitor", drifted, config); !containsString(changed, "monitor_steps") {
				t.Fatalf("%s set in the Dashboard plans %v, not a change of monitor_steps", tc.name, changed)
			}

			// The apply does what the plan said: the setting is gone, nothing else changed.
			writes := api.writesTo("/monitor")
			applied := tf.apply("oneuptime_monitor", drifted, config)
			if api.writesTo("/monitor") != writes+1 {
				t.Fatalf("the apply did not write the monitor")
			}
			stored := driftStoredCriteria(t, api, id)
			if _, kept := stored[tc.storeKey]; kept {
				t.Fatalf("after the apply OneUptime still keeps %s: %v", tc.storeKey, stored[tc.storeKey])
			}
			if stored["monitorStatusId"] != "a1000000-0000-4000-8000-0000000109b2" || stored["changeMonitorStatus"] != true {
				t.Fatalf("the apply changed what the configuration writes: %v", stored)
			}
			requireStepsAsConfigured(t, "after the apply", applied, config)

			// And the plan after it is empty.
			if changed := tf.changes("oneuptime_monitor", tf.refresh("oneuptime_monitor", applied), config); len(changed) > 0 {
				t.Fatalf("the plan after the apply changes %v", changed)
			}
		})
	}
}

func TestMonitorStepsDrift_AnApplyThatChangesNothingInTheStepsKeepsTheDashboardsSettingUntilItIsPlanned(t *testing.T) {
	api := newStepValuesAPI(t)
	tf := newStepValuesTerraform(t, api)

	config := recoveryHoursConfig(tf, "Shop", driftConfiguredSteps(t, tf, driftConfiguredCriteria()))
	created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, config)
	id := stringAttribute(t, created.state, "id")

	driftInTheDashboard(t, api, id, func(criteria map[string]interface{}) {
		criteria["activeHours"] = driftActiveHours(t)
		criteria["activeHoursTimezone"] = "Europe/Oslo"
	})

	// Written into the configuration too: the plan is empty, and OneUptime keeps them.
	withHours := driftConfiguredCriteria()
	withHours["activeHours"] = driftActiveHours(t)
	withHours["activeHoursTimezone"] = "Europe/Oslo"
	configWithHours := recoveryHoursConfig(tf, "Shop", driftConfiguredSteps(t, tf, withHours))

	drifted := tf.refresh("oneuptime_monitor", created)
	if changed := tf.changes("oneuptime_monitor", drifted, configWithHours); len(changed) > 0 {
		t.Fatalf("the configuration that writes the Dashboard's hours plans %v", changed)
	}
	if _, kept := driftStoredCriteria(t, api, id)["activeHours"]; !kept {
		t.Fatalf("OneUptime no longer keeps the hours")
	}
}

func TestMonitorStepsDrift_ADashboardSaveThatChangesNothingPlansNoChange(t *testing.T) {
	api := newStepValuesAPI(t)
	tf := newStepValuesTerraform(t, api)

	config := recoveryHoursConfig(tf, "Shop", driftConfiguredSteps(t, tf, driftConfiguredCriteria()))
	created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, config)
	id := stringAttribute(t, created.state, "id")

	// The Dashboard's form writes out what OneUptime reads as unset anyway.
	driftInTheDashboard(t, api, id, func(criteria map[string]interface{}) {
		criteria["openForEveryEmail"] = false
		criteria["isEnabled"] = true
		criteria["createIncidents"] = false
		filter := criteria["filters"].([]interface{})[0].(map[string]interface{})
		filter["evaluateOverTime"] = false
	})
	api.mu.Lock()
	step := monitorStepsWireValue(monitorStepsWireValue(api.rows["/monitor"][id]["monitorSteps"])["monitorStepsInstanceArray"].([]interface{})[0])
	step["requestType"] = "GET"
	step["doNotFollowRedirects"] = false
	api.mu.Unlock()

	refreshed := tf.refresh("oneuptime_monitor", created)
	if changed := tf.changes("oneuptime_monitor", refreshed, config); len(changed) > 0 {
		t.Fatalf("a Dashboard save that changes nothing plans %v", changed)
	}
}

func TestMonitorStepsDrift_ImportedWithoutTheDashboardsSettingPlansItsRemoval(t *testing.T) {
	cases := loadRecoveryHoursCases(t)
	api := newStepValuesAPI(t)
	tf := newStepValuesTerraform(t, api)

	// Made in the Dashboard with a recovery condition and active hours.
	dashboard := recoveryHoursDashboardCriteria(t, cases)
	id := api.add(t, "/monitor", map[string]interface{}{
		"name":         "Office access point",
		"monitorType":  "Website",
		"monitorSteps": monitorStepWire("https://example.com/", dashboard, map[string]interface{}{"requestType": "GET"}),
	})
	imported := tf.importResource("oneuptime_monitor", id)

	// Written in HCL without the active hours: the plan says it removes them.
	withoutHours := map[string]interface{}{}
	for key, value := range dashboard {
		if key == "activeHours" || key == "activeHoursTimezone" {
			continue
		}
		withoutHours[key] = value
	}
	config := recoveryHoursConfig(tf, "Office access point", recoveryHoursConfiguredSteps(t, tf, withoutHours))
	if changed := tf.changes("oneuptime_monitor", imported, config); !containsString(changed, "monitor_steps") {
		t.Fatalf("an import whose configuration leaves the Dashboard's hours out plans %v, not their removal", changed)
	}

	// Written with them: no change, as before.
	full := recoveryHoursConfig(tf, "Office access point", recoveryHoursConfiguredSteps(t, tf, dashboard))
	if changed := tf.changes("oneuptime_monitor", imported, full); containsString(changed, "monitor_steps") {
		t.Fatalf("an import whose configuration writes everything plans %v", changed)
	}
}
