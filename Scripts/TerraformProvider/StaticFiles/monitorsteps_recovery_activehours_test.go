package provider

/*
 * A criteria's recovery condition and active hours (OneUptime/oneuptime#10822).
 *
 * The provider read neither: an import dropped them, a configuration could
 * not write them, and an apply that wrote a monitor's steps removed a
 * recovery condition or active hours someone had set in the dashboard. Now:
 *
 *   - active_hours converts both ways exactly as the server's WorkingHours
 *     does, case by case against what the server's own code writes and
 *     reads (testdata/monitor_steps_active_hours.json, written by
 *     Core/MonitorStepsActiveHoursCases.ts);
 *   - a criteria's recovery_filters, recovery_filter_condition, active_hours
 *     and active_hours_timezone read back from the API and are sent again;
 *   - a monitor whose criteria have them set in the dashboard is imported,
 *     planned, applied and refreshed through the provider's real protocol
 *     server against the fake API of monitorstepsvalues_roundtrip_test.go,
 *     and keeps them.
 */

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// ---------------------------------------------------------------------------
// The cases the generator writes from the server's WorkingHours
// ---------------------------------------------------------------------------

type recoveryHoursSimple struct {
	Days []int64 `json:"days"`
	From string  `json:"from"`
	To   string  `json:"to"`
}

type recoveryHoursWrittenCase struct {
	Name     string                 `json:"name"`
	Days     []int64                `json:"days"`
	From     string                 `json:"from"`
	To       string                 `json:"to"`
	Timezone string                 `json:"timezone"`
	Stored   map[string]interface{} `json:"stored"`
	ReadBack *recoveryHoursSimple   `json:"readBack"`
}

type recoveryHoursStoredCase struct {
	Name     string                 `json:"name"`
	Timezone string                 `json:"timezone"`
	Stored   map[string]interface{} `json:"stored"`
	ReadBack *recoveryHoursSimple   `json:"readBack"`
}

type recoveryHoursCases struct {
	Written []recoveryHoursWrittenCase `json:"written"`
	Stored  []recoveryHoursStoredCase  `json:"stored"`
}

func loadRecoveryHoursCases(t *testing.T) recoveryHoursCases {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "monitor_steps_active_hours.json"))
	if err != nil {
		t.Fatalf("reading the active hours cases the generator writes: %s", err)
	}
	var cases recoveryHoursCases
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("parsing the active hours cases: %s", err)
	}
	if len(cases.Written) < 5 || len(cases.Stored) < 5 {
		t.Fatalf("the active hours cases hold %d written and %d stored cases, fewer than they should", len(cases.Written), len(cases.Stored))
	}
	return cases
}

func (c recoveryHoursCases) written(t *testing.T, name string) recoveryHoursWrittenCase {
	t.Helper()
	for _, written := range c.Written {
		if written.Name == name {
			return written
		}
	}
	t.Fatalf("the active hours cases have no written case %q", name)
	return recoveryHoursWrittenCase{}
}

// The active_hours attribute's values for these hours.
func recoveryHoursAttrs(t *testing.T, days []int64, from string, to string) map[string]attr.Value {
	t.Helper()
	dayValues := make([]attr.Value, 0, len(days))
	for _, day := range days {
		dayValues = append(dayValues, types.Int64Value(day))
	}
	dayList, d := types.ListValue(types.Int64Type, dayValues)
	if d.HasError() {
		t.Fatalf("ListValue diagnostics: %v", d)
	}
	return map[string]attr.Value{
		"days": dayList,
		"from": types.StringValue(from),
		"to":   types.StringValue(to),
	}
}

func recoveryHoursText(hours *recoveryHoursSimple) string {
	if hours == nil {
		return "none"
	}
	raw, _ := json.Marshal(hours)
	return string(raw)
}

func TestMonitorStepsActiveHours_WrittenAsTheServerWritesThem(t *testing.T) {
	cases := loadRecoveryHoursCases(t)

	for _, c := range cases.Written {
		t.Run(c.Name, func(t *testing.T) {
			got := monitorStepsTestNormalizeJSON(t, monitorStepsActiveHoursToAPI(recoveryHoursAttrs(t, c.Days, c.From, c.To), c.Timezone))
			want := monitorStepsTestNormalizeJSON(t, c.Stored)
			if !reflect.DeepEqual(got, want) {
				gotJSON, _ := json.MarshalIndent(got, "", "  ")
				wantJSON, _ := json.MarshalIndent(want, "", "  ")
				t.Fatalf("%v %s to %s in %s is written as\n%s\nthe server writes\n%s", c.Days, c.From, c.To, c.Timezone, gotJSON, wantJSON)
			}
		})
	}
}

func TestMonitorStepsActiveHours_ReadAsTheServerReadsThem(t *testing.T) {
	cases := loadRecoveryHoursCases(t)

	check := func(t *testing.T, stored map[string]interface{}, timezone string, want *recoveryHoursSimple) {
		t.Helper()
		hours, ok := monitorStepsActiveHoursFromAPI(monitorStepsTestJSONCopy(t, stored), timezone)
		var got *recoveryHoursSimple
		if ok {
			got = &recoveryHoursSimple{Days: hours.days, From: hours.from, To: hours.to}
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("read in %s as %s; the server reads %s", timezone, recoveryHoursText(got), recoveryHoursText(want))
		}
	}

	for _, c := range cases.Written {
		t.Run("written: "+c.Name, func(t *testing.T) {
			check(t, c.Stored, c.Timezone, c.ReadBack)
		})
	}
	for _, c := range cases.Stored {
		t.Run("stored: "+c.Name, func(t *testing.T) {
			check(t, c.Stored, c.Timezone, c.ReadBack)
		})
	}
}

// The cases hold what each reads as: these are what a person can check by eye.
func TestMonitorStepsActiveHours_CasesReadAsAPersonExpects(t *testing.T) {
	cases := loadRecoveryHoursCases(t)

	oslo := cases.written(t, "weekdays in Oslo")
	if recoveryHoursText(oslo.ReadBack) != `{"days":[0,1,2,3,4],"from":"08:00","to":"18:00"}` {
		t.Fatalf("weekdays in Oslo read back as %s", recoveryHoursText(oslo.ReadBack))
	}
	kolkata := cases.written(t, "days written twice and out of order, in Kolkata")
	if recoveryHoursText(kolkata.ReadBack) != `{"days":[0,3,6],"from":"09:30","to":"17:45"}` {
		t.Fatalf("Kolkata's hours read back as %s", recoveryHoursText(kolkata.ReadBack))
	}
	if unknown := cases.written(t, "a zone the server does not know is written on UTC's clock"); unknown.ReadBack != nil {
		t.Fatalf("hours in a zone nobody knows read back as %s", recoveryHoursText(unknown.ReadBack))
	}
	for _, stored := range cases.Stored {
		if stored.Name == "a daily window, as an on-call layer keeps one" && len(stored.ReadBack.Days) != 7 {
			t.Fatalf("a daily window reads back as %s, not every day", recoveryHoursText(stored.ReadBack))
		}
	}
}

func TestMonitorStepsActiveHours_ClockAndZoneValidators(t *testing.T) {
	ctx := context.Background()

	for _, tc := range []struct {
		value string
		ok    bool
	}{
		{"08:00", true}, {"8:00", true}, {"23:59", true}, {"00:00", true},
		{"24:00", false}, {"08:60", false}, {"8", false}, {"8am", false}, {"08:00:00", false}, {"", false},
	} {
		resp := &validator.StringResponse{}
		monitorStepsClockValidator.ValidateString(ctx, validator.StringRequest{Path: path.Root("from"), ConfigValue: types.StringValue(tc.value)}, resp)
		if resp.Diagnostics.HasError() == tc.ok {
			t.Errorf("the clock %q: errors %v, want ok %v", tc.value, resp.Diagnostics, tc.ok)
		}
	}

	for _, tc := range []struct {
		value string
		ok    bool
	}{
		{"Europe/Oslo", true}, {"America/Argentina/Buenos_Aires", true}, {"UTC", true}, {"Asia/Kathmandu", true},
		// The server reads these without regard to case; the provider could not.
		{"europe/oslo", false}, {"Local", false}, {"", false}, {"Atlantis/Lost_City", false}, {"+02:00", false},
	} {
		resp := &validator.StringResponse{}
		monitorStepsTimezoneValidator{}.ValidateString(ctx, validator.StringRequest{Path: path.Root("active_hours_timezone"), ConfigValue: types.StringValue(tc.value)}, resp)
		if resp.Diagnostics.HasError() == tc.ok {
			t.Errorf("the time zone %q: errors %v, want ok %v", tc.value, resp.Diagnostics, tc.ok)
		}
	}

	// Not checked while unknown: a zone another resource gives.
	resp := &validator.StringResponse{}
	monitorStepsTimezoneValidator{}.ValidateString(ctx, validator.StringRequest{Path: path.Root("active_hours_timezone"), ConfigValue: types.StringUnknown()}, resp)
	if resp.Diagnostics.HasError() {
		t.Fatalf("an unknown time zone was refused: %v", resp.Diagnostics)
	}
}

// ---------------------------------------------------------------------------
// A criteria's recovery condition and active hours, read and sent
// ---------------------------------------------------------------------------

// A criteria as the dashboard keeps one with a recovery condition and active
// hours: offline when down; recovered only once online for 10 minutes, and
// judged on weekdays from 08:00 to 18:00 in Oslo.
func recoveryHoursDashboardCriteria(t *testing.T, cases recoveryHoursCases) map[string]interface{} {
	t.Helper()
	criteria := map[string]interface{}{
		"name":            "Offline",
		"filterCondition": "All",
		"filters": []interface{}{
			map[string]interface{}{"checkOn": "Is Online", "filterType": "False"},
		},
		"recoveryFilters": []interface{}{
			map[string]interface{}{
				"checkOn":                 "Is Online",
				"filterType":              "True",
				"evaluateOverTime":        true,
				"evaluateOverTimeOptions": map[string]interface{}{"timeValueInMinutes": float64(10), "evaluateOverTimeType": "All Values"},
			},
		},
		"recoveryFilterCondition": "All",
		"activeHours":             cases.written(t, "weekdays in Oslo").Stored,
		"activeHoursTimezone":     "Europe/Oslo",
	}
	for key, value := range serverCriteriaDefaults {
		criteria[key] = value
	}
	return criteria
}

// The criteria of the steps' one step.
func recoveryHoursCriteriaOf(t *testing.T, steps interface{}) map[string]interface{} {
	t.Helper()
	instances := monitorStepsWireValue(monitorStepsWireValue(monitorStepsWireValue(steps)["monitorStepsInstanceArray"].([]interface{})[0])["monitorCriteria"])["monitorCriteriaInstanceArray"].([]interface{})
	return monitorStepsWireValue(instances[0])
}

func TestMonitorStepsCriteria_RecoveryConditionAndActiveHoursReadAndSentAgain(t *testing.T) {
	ctx := context.Background()
	cases := loadRecoveryHoursCases(t)
	stored := monitorStepWire("https://example.com/", recoveryHoursDashboardCriteria(t, cases), map[string]interface{}{"requestType": "GET"})

	list, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, stored))
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)
	if len(diags) > 0 {
		t.Fatalf("reading simple active hours gave diagnostics: %v", diags)
	}

	step := list.Elements()[0].(types.Object)
	criteria := step.Attributes()["criteria"].(types.List).Elements()[0].(types.Object).Attributes()
	if got := criteria["recovery_filter_condition"].(types.String).ValueString(); got != "All" {
		t.Fatalf("recovery_filter_condition is %q", got)
	}
	if got := criteria["active_hours_timezone"].(types.String).ValueString(); got != "Europe/Oslo" {
		t.Fatalf("active_hours_timezone is %q", got)
	}
	recovery := criteria["recovery_filters"].(types.List).Elements()
	if len(recovery) != 1 {
		t.Fatalf("recovery_filters holds %d filters", len(recovery))
	}
	if got := recovery[0].(types.Object).Attributes()["evaluate_over_time_type"].(types.String).ValueString(); got != "All Values" {
		t.Fatalf("the recovery filter's window is %q", got)
	}
	hours := criteria["active_hours"].(types.Object).Attributes()
	if got := hours["from"].(types.String).ValueString() + "-" + hours["to"].(types.String).ValueString(); got != "08:00-18:00" {
		t.Fatalf("active_hours read as %s", got)
	}
	if got := len(hours["days"].(types.List).Elements()); got != 5 {
		t.Fatalf("active_hours holds %d days", got)
	}

	// Sent again exactly as the dashboard kept them.
	sent, diags := MonitorStepsToAPI(ctx, list)
	monitorStepsTestFatalOnDiagError(t, "ToAPI", diags)
	sentCriteria := recoveryHoursCriteriaOf(t, monitorStepsTestNormalizeJSON(t, sent))
	storedCriteria := recoveryHoursCriteriaOf(t, monitorStepsTestNormalizeJSON(t, stored))
	for _, key := range []string{"recoveryFilters", "recoveryFilterCondition", "activeHours", "activeHoursTimezone"} {
		if !reflect.DeepEqual(sentCriteria[key], storedCriteria[key]) {
			gotJSON, _ := json.Marshal(sentCriteria[key])
			wantJSON, _ := json.Marshal(storedCriteria[key])
			t.Errorf("%s is sent as %s; the dashboard kept %s", key, gotJSON, wantJSON)
		}
	}
}

func TestMonitorStepsCriteria_HoursTerraformCannotWriteAreSaidSo(t *testing.T) {
	ctx := context.Background()
	cases := loadRecoveryHoursCases(t)
	criteria := recoveryHoursDashboardCriteria(t, cases)
	for _, stored := range cases.Stored {
		if stored.Name == "different hours on two days" {
			criteria["activeHours"] = stored.Stored
			criteria["activeHoursTimezone"] = stored.Timezone
		}
	}

	list, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, monitorStepWire("https://example.com/", criteria, nil)))
	if diags.HasError() {
		t.Fatalf("hours that are not simple failed the read: %v", diags)
	}
	warned := false
	for _, d := range diags {
		if d.Severity() == diag.SeverityWarning && strings.Contains(d.Detail(), `criteria "Offline"`) {
			warned = true
		}
	}
	if !warned {
		t.Fatalf("hours Terraform cannot write gave no warning naming the criteria: %v", diags)
	}

	step := list.Elements()[0].(types.Object)
	read := step.Attributes()["criteria"].(types.List).Elements()[0].(types.Object).Attributes()
	if !read["active_hours"].IsNull() {
		t.Fatalf("active_hours read as %s, not as none", read["active_hours"])
	}
}

func TestMonitorStepsCriteria_TheServersRecoveryConditionIsNoChange(t *testing.T) {
	ctx := context.Background()
	cases := loadRecoveryHoursCases(t)

	// Written without a recovery_filter_condition; OneUptime keeps "All".
	written := recoveryHoursDashboardCriteria(t, cases)
	delete(written, "recoveryFilterCondition")
	for key := range serverCriteriaDefaults {
		delete(written, key)
	}
	planned, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, monitorStepWire("https://example.com", written, nil)))
	monitorStepsTestFatalOnDiagError(t, "FromAPI(planned)", diags)
	echoed, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, monitorStepWire("https://example.com/", recoveryHoursDashboardCriteria(t, cases), map[string]interface{}{"requestType": "GET"})))
	monitorStepsTestFatalOnDiagError(t, "FromAPI(echoed)", diags)

	equal, d := MonitorStepsValue{ListValue: echoed}.ListSemanticEquals(ctx, MonitorStepsValue{ListValue: planned})
	if d.HasError() || !equal {
		t.Fatalf("the server's own recovery condition reads as a change: %v", d)
	}

	// Other active hours are a change.
	other := recoveryHoursDashboardCriteria(t, cases)
	other["activeHours"] = monitorStepsActiveHoursToAPI(recoveryHoursAttrs(t, []int64{0, 1, 2, 3, 4}, "07:00", "19:00"), "Europe/Oslo")
	moved, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, monitorStepWire("https://example.com/", other, map[string]interface{}{"requestType": "GET"})))
	monitorStepsTestFatalOnDiagError(t, "FromAPI(moved)", diags)
	equal, d = MonitorStepsValue{ListValue: moved}.ListSemanticEquals(ctx, MonitorStepsValue{ListValue: planned})
	if d.HasError() || equal {
		t.Fatalf("active hours moved to 07:00-19:00 read as no change: %v", d)
	}
}

// ---------------------------------------------------------------------------
// Through the provider's real protocol server
// ---------------------------------------------------------------------------

// The steps as a configuration writes them: what a person writes in HCL.
func recoveryHoursConfiguredSteps(t *testing.T, tf *stepValuesTerraform, criteria map[string]interface{}) tftypes.Value {
	t.Helper()
	written := map[string]interface{}{}
	for key, value := range criteria {
		if _, isDefault := serverCriteriaDefaults[key]; isDefault {
			continue
		}
		written[key] = value
	}
	list, diags := MonitorStepsFromAPI(tf.ctx, monitorStepsTestJSONCopy(t, monitorStepWire("https://example.com", written, nil)))
	if diags.HasError() {
		t.Fatalf("reading the configured steps: %v", diags)
	}
	value, err := list.ToTerraformValue(tf.ctx)
	if err != nil {
		t.Fatalf("encoding the configured steps: %s", err)
	}
	return value
}

func recoveryHoursConfig(tf *stepValuesTerraform, name string, steps tftypes.Value) tftypes.Value {
	return objectWith(tf.objectType("oneuptime_monitor"), map[string]tftypes.Value{
		"name":          tftypes.NewValue(tftypes.String, name),
		"monitor_type":  tftypes.NewValue(tftypes.String, "Website"),
		"monitor_steps": steps,
	})
}

// The stored criteria's four settings, as JSON, to compare.
func recoveryHoursStoredSettings(t *testing.T, api *stepValuesAPI, id string) string {
	t.Helper()
	api.mu.Lock()
	defer api.mu.Unlock()
	criteria := recoveryHoursCriteriaOf(t, monitorStepsTestNormalizeJSON(t, api.rows["/monitor"][id]["monitorSteps"]))
	settings := map[string]interface{}{}
	for _, key := range []string{"recoveryFilters", "recoveryFilterCondition", "activeHours", "activeHoursTimezone"} {
		settings[key] = criteria[key]
	}
	raw, _ := json.Marshal(settings)
	return string(raw)
}

func TestMonitorStepsRecoveryAndActiveHours_SetInTheDashboardKeptThroughPlanAndApply(t *testing.T) {
	cases := loadRecoveryHoursCases(t)
	api := newStepValuesAPI(t)
	tf := newStepValuesTerraform(t, api)

	// A monitor made in the dashboard, its criteria with a recovery
	// condition and active hours, as OneUptime keeps them.
	dashboard := recoveryHoursDashboardCriteria(t, cases)
	id := api.add(t, "/monitor", map[string]interface{}{
		"name":         "Office access point",
		"monitorType":  "Website",
		"monitorSteps": monitorStepWire("https://example.com/", dashboard, map[string]interface{}{"requestType": "GET"}),
	})
	kept := recoveryHoursStoredSettings(t, api, id)

	// Imported, and written in HCL as the dashboard's Terraform export
	// writes it: no change.
	imported := tf.importResource("oneuptime_monitor", id)
	config := recoveryHoursConfig(tf, "Office access point", recoveryHoursConfiguredSteps(t, tf, dashboard))
	if errors := tf.validate("oneuptime_monitor", config); len(errors) > 0 {
		t.Fatalf("terraform validate: %s - %s", errors[0].Summary, errors[0].Detail)
	}
	// Only the steps are checked: what else an import settles is
	// import_plan_test.go's.
	if changed := tf.changes("oneuptime_monitor", imported, config); containsString(changed, "monitor_steps") {
		t.Fatalf("the plan after the import changes the steps: %v", changed)
	}

	// An apply that writes the steps - another description - sends the
	// recovery condition and the hours back as they were kept.
	edited := map[string]interface{}{}
	for key, value := range dashboard {
		edited[key] = value
	}
	edited["description"] = "The office's access point is down."
	editedConfig := recoveryHoursConfig(tf, "Office access point", recoveryHoursConfiguredSteps(t, tf, edited))
	if changed := tf.changes("oneuptime_monitor", imported, editedConfig); !containsString(changed, "monitor_steps") {
		t.Fatalf("another description plans %v, not a change of monitor_steps", changed)
	}
	writes := api.writesTo("/monitor")
	applied := tf.apply("oneuptime_monitor", imported, editedConfig)
	if api.writesTo("/monitor") != writes+1 {
		t.Fatalf("the apply did not write the monitor")
	}
	if got := recoveryHoursStoredSettings(t, api, id); got != kept {
		t.Fatalf("after the apply OneUptime keeps\n%s\nnot what the dashboard set\n%s", got, kept)
	}

	// And a refresh plans no change.
	if changed := tf.changes("oneuptime_monitor", tf.refresh("oneuptime_monitor", applied), editedConfig); len(changed) > 0 {
		t.Fatalf("the plan after the apply changes %v", changed)
	}
}

func TestMonitorStepsRecoveryAndActiveHours_WrittenByTerraformAndMovedInTheDashboard(t *testing.T) {
	cases := loadRecoveryHoursCases(t)
	api := newStepValuesAPI(t)
	tf := newStepValuesTerraform(t, api)

	// Written by Terraform with no recovery_filter_condition.
	written := recoveryHoursDashboardCriteria(t, cases)
	delete(written, "recoveryFilterCondition")
	config := recoveryHoursConfig(tf, "Office access point", recoveryHoursConfiguredSteps(t, tf, written))
	created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, config)
	id := stringAttribute(t, created.state, "id")

	// OneUptime keeps the hours as its own code writes them, and its own
	// recovery condition, All.
	api.mu.Lock()
	criteria := recoveryHoursCriteriaOf(t, api.rows["/monitor"][id]["monitorSteps"])
	if !reflect.DeepEqual(monitorStepsTestNormalizeJSON(t, criteria["activeHours"]), monitorStepsTestNormalizeJSON(t, cases.written(t, "weekdays in Oslo").Stored)) {
		api.mu.Unlock()
		t.Fatalf("the apply stored the hours as %v, not as the dashboard writes them", criteria["activeHours"])
	}
	criteria["recoveryFilterCondition"] = "All"
	api.mu.Unlock()

	refreshed := tf.refresh("oneuptime_monitor", created)
	if changed := tf.changes("oneuptime_monitor", refreshed, config); len(changed) > 0 {
		t.Fatalf("the plan after the apply changes %v", changed)
	}

	// Someone moves the hours to 07:00-19:00 in the dashboard: the plan says
	// so, and the apply puts the configuration's back.
	api.mu.Lock()
	criteria = recoveryHoursCriteriaOf(t, api.rows["/monitor"][id]["monitorSteps"])
	criteria["activeHours"] = monitorStepsTestNormalizeJSON(t, monitorStepsActiveHoursToAPI(recoveryHoursAttrs(t, []int64{0, 1, 2, 3, 4}, "07:00", "19:00"), "Europe/Oslo"))
	api.mu.Unlock()

	moved := tf.refresh("oneuptime_monitor", refreshed)
	if changed := tf.changes("oneuptime_monitor", moved, config); !containsString(changed, "monitor_steps") {
		t.Fatalf("hours moved in the dashboard plan %v, not a change of monitor_steps", changed)
	}
	restored := tf.apply("oneuptime_monitor", moved, config)
	api.mu.Lock()
	criteria = recoveryHoursCriteriaOf(t, api.rows["/monitor"][id]["monitorSteps"])
	hours := monitorStepsTestNormalizeJSON(t, criteria["activeHours"])
	api.mu.Unlock()
	if !reflect.DeepEqual(hours, monitorStepsTestNormalizeJSON(t, cases.written(t, "weekdays in Oslo").Stored)) {
		t.Fatalf("the apply stored the hours as %v, not the configuration's", hours)
	}
	if changed := tf.changes("oneuptime_monitor", tf.refresh("oneuptime_monitor", restored), config); len(changed) > 0 {
		t.Fatalf("the plan after putting the hours back changes %v", changed)
	}
}
