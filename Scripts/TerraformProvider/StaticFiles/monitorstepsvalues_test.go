package provider

/*
 * The values in a monitor's steps the provider reads as the server does
 * (monitorstepsvalues.go, OneUptime/oneuptime#6723).
 *
 * The rules are checked against testdata/monitor_steps_values.json, which
 * the generator writes from the server's own code each time it runs
 * (Scripts/TerraformProvider/Core/MonitorStepsValuesCases.ts): the tables,
 * how every case reads, the words every refusal is in, and what the server
 * stores. A rule the server changes and the provider does not fails here.
 * The rest are the provider's own: the comparison after an apply, a
 * refresh and an import, and the validators.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// monitorStepsValuesCases is testdata/monitor_steps_values.json.
type monitorStepsValuesCases struct {
	About        string `json:"about"`
	RollingTimes []struct {
		Value   string `json:"value"`
		Minutes int64  `json:"minutes"`
	} `json:"rollingTimes"`
	DefaultRollingTime  string `json:"defaultRollingTime"`
	RollingTimeSettings []struct {
		MonitorType string `json:"monitorType"`
		APIKey      string `json:"apiKey"`
	} `json:"rollingTimeSettings"`
	EvaluateOverTimeTypes       []string `json:"evaluateOverTimeTypes"`
	NoDataPolicies              []string `json:"noDataPolicies"`
	RollingTimeErrorsBySettings []struct {
		MonitorType string      `json:"monitorType"`
		APIKey      string      `json:"apiKey"`
		Written     interface{} `json:"written"`
		Error       *string     `json:"error"`
	} `json:"rollingTimeErrorsBySettings"`
	RollingTimeCases []struct {
		Written interface{} `json:"written"`
		Read    *string     `json:"read"`
		Error   *string     `json:"error"`
	} `json:"rollingTimeCases"`
	CriteriaName       string `json:"criteriaName"`
	CriteriaValueCases []struct {
		Key     string      `json:"key"`
		Written interface{} `json:"written"`
		Read    *string     `json:"read"`
		Error   *string     `json:"error"`
	} `json:"criteriaValueCases"`
	StoredRollingTimes []struct {
		Written interface{}                       `json:"written"`
		Stored  map[string]map[string]interface{} `json:"stored"`
	} `json:"storedRollingTimes"`
	StoredMetricMonitorOptions []struct {
		Written interface{}            `json:"written"`
		Stored  map[string]interface{} `json:"stored"`
	} `json:"storedMetricMonitorOptions"`
}

func loadMonitorStepsValuesCases(t *testing.T) monitorStepsValuesCases {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "monitor_steps_values.json"))
	if err != nil {
		t.Fatalf("reading the cases the generator writes from the server's code (Scripts/TerraformProvider/Core/MonitorStepsValuesCases.ts) - generate the provider again: %s", err)
	}
	var cases monitorStepsValuesCases
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("reading testdata/monitor_steps_values.json: %s", err)
	}
	return cases
}

// monitorStepsCaseText is a case's value as a failure names it.
func monitorStepsCaseText(value interface{}) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%#v", value)
	}
	return string(raw)
}

func monitorStepsValuesOptional(value string, ok bool) *string {
	if !ok {
		return nil
	}
	return &value
}

func monitorStepsValuesSame(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func monitorStepsValuesShow(value *string) string {
	if value == nil {
		return "nothing"
	}
	return fmt.Sprintf("%q", *value)
}

// ---------------------------------------------------------------------------
// The server's rules, case by case
// ---------------------------------------------------------------------------

// The file holds the cases: a generator that wrote few or none would leave
// every test below passing.
func TestMonitorStepsValues_TheServersCasesAreThere(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)

	if len(cases.RollingTimeCases) < 500 || len(cases.CriteriaValueCases) < 100 ||
		len(cases.StoredRollingTimes) < 20 || len(cases.StoredMetricMonitorOptions) < 15 ||
		len(cases.RollingTimeErrorsBySettings) < 12 {
		t.Fatalf("the generator wrote %d rolling time, %d criteria value, %d + %d stored and %d error cases: too few",
			len(cases.RollingTimeCases), len(cases.CriteriaValueCases), len(cases.StoredRollingTimes),
			len(cases.StoredMetricMonitorOptions), len(cases.RollingTimeErrorsBySettings))
	}

	read, refused := 0, 0
	readAs := map[string]bool{}
	for _, c := range cases.RollingTimeCases {
		if c.Read != nil {
			read++
			readAs[*c.Read] = true
		}
		if c.Error != nil {
			refused++
		}
	}
	if read < 300 || refused < 100 {
		t.Fatalf("%d rolling time cases read as one and %d refused: the cases must hold plenty of both", read, refused)
	}
	for _, rollingTime := range monitorStepsRollingTimes {
		if !readAs[rollingTime.value] {
			t.Errorf("no case reads as %q", rollingTime.value)
		}
	}
}

func TestMonitorStepsValues_TablesAreTheServers(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)

	got := []string{}
	for _, rollingTime := range monitorStepsRollingTimes {
		got = append(got, fmt.Sprintf("%s=%d", rollingTime.value, rollingTime.minutes))
	}
	want := []string{}
	for _, rollingTime := range cases.RollingTimes {
		want = append(want, fmt.Sprintf("%s=%d", rollingTime.Value, rollingTime.Minutes))
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("the rolling times and their minutes are\n%v\nthe server's are\n%v", got, want)
	}

	if monitorStepsDefaultRollingTime != cases.DefaultRollingTime {
		t.Errorf("the default rolling time is %q, the server's %q", monitorStepsDefaultRollingTime, cases.DefaultRollingTime)
	}

	got = []string{}
	for _, settings := range monitorStepsRollingTimeSettings {
		got = append(got, settings.monitorType+"="+settings.apiKey)
	}
	want = []string{}
	for _, settings := range cases.RollingTimeSettings {
		want = append(want, settings.MonitorType+"="+settings.APIKey)
	}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("the settings that keep a rolling time are\n%v\nthe server's are\n%v", got, want)
	}

	// Each is a step attribute, so its rolling time is validated and read.
	for _, settings := range monitorStepsRollingTimeSettings {
		found := false
		for _, sub := range monitorStepsSubConfigs {
			if sub.apiKey == settings.apiKey {
				found = true
			}
		}
		if !found {
			t.Errorf("%s keeps a rolling time but is no step attribute (monitorStepsSubConfigs)", settings.apiKey)
		}
	}

	if !reflect.DeepEqual(monitorStepsEvaluateOverTimeTypeValues, cases.EvaluateOverTimeTypes) {
		t.Errorf("the aggregations are %v, the server's %v", monitorStepsEvaluateOverTimeTypeValues, cases.EvaluateOverTimeTypes)
	}
	if !reflect.DeepEqual(monitorStepsNoDataPolicyValues, cases.NoDataPolicies) {
		t.Errorf("the no-data policies are %v, the server's %v", monitorStepsNoDataPolicyValues, cases.NoDataPolicies)
	}
}

func TestMonitorStepsValues_RollingTimesReadAsTheServerReadsThem(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)

	failures := 0
	for _, c := range cases.RollingTimeCases {
		read := monitorStepsValuesOptional(monitorStepsReadRollingTime(c.Written))
		refusal := monitorStepsValuesOptional(monitorStepsUnreadableRollingTime("metricMonitor", map[string]interface{}{"rollingTime": c.Written}))

		if !monitorStepsValuesSame(read, c.Read) {
			failures++
			t.Errorf("%s reads as %s, the server reads it as %s", monitorStepsCaseText(c.Written), monitorStepsValuesShow(read), monitorStepsValuesShow(c.Read))
		}
		if !monitorStepsValuesSame(refusal, c.Error) {
			failures++
			t.Errorf("%s is refused with %s, the server refuses it with %s", monitorStepsCaseText(c.Written), monitorStepsValuesShow(refusal), monitorStepsValuesShow(c.Error))
		}
		if failures > 40 {
			t.Fatal("more than 40 cases read otherwise than on the server")
		}
	}
}

func TestMonitorStepsValues_RefusalsNameTheSettings(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)

	for _, c := range cases.RollingTimeErrorsBySettings {
		if monitorStepsRollingTimeMonitorType(c.APIKey) != c.MonitorType {
			t.Errorf("%s is read by %q, the server's %q", c.APIKey, monitorStepsRollingTimeMonitorType(c.APIKey), c.MonitorType)
		}
		refusal := monitorStepsValuesOptional(monitorStepsUnreadableRollingTime(c.APIKey, map[string]interface{}{"rollingTime": c.Written}))
		if !monitorStepsValuesSame(refusal, c.Error) {
			t.Errorf("%s in %s is refused with %s, the server refuses it with %s", monitorStepsCaseText(c.Written), c.APIKey, monitorStepsValuesShow(refusal), monitorStepsValuesShow(c.Error))
		}
	}
}

func TestMonitorStepsValues_CriteriaValuesReadAsTheServerReadsThem(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)

	sets := map[string]monitorStepsValueSet{}
	for _, option := range monitorStepsMetricMonitorOptionsRead {
		sets[option.key] = option.set
	}

	failures := 0
	for _, c := range cases.CriteriaValueCases {
		set, ok := sets[c.Key]
		if !ok {
			t.Fatalf("the server reads metricMonitorOptions.%s; the provider does not", c.Key)
		}
		read := monitorStepsValuesOptional(set.read(c.Written))
		refusal := monitorStepsValuesOptional(monitorStepsUnreadableCriteriaValue(set, c.Written, "filters[0].metricMonitorOptions."+c.Key, cases.CriteriaName))

		if !monitorStepsValuesSame(read, c.Read) {
			failures++
			t.Errorf("%s as %s reads as %s, the server reads it as %s", monitorStepsCaseText(c.Written), c.Key, monitorStepsValuesShow(read), monitorStepsValuesShow(c.Read))
		}
		if !monitorStepsValuesSame(refusal, c.Error) {
			failures++
			t.Errorf("%s as %s is refused with %s, the server refuses it with %s", monitorStepsCaseText(c.Written), c.Key, monitorStepsValuesShow(refusal), monitorStepsValuesShow(c.Error))
		}
		if failures > 40 {
			t.Fatal("more than 40 cases read otherwise than on the server")
		}
	}
}

// monitorStepsValuesWire is steps as the provider sends them: one step with
// these settings, and one criteria whose one filter has these metric options.
func monitorStepsValuesWire(settings map[string]interface{}, options map[string]interface{}) map[string]interface{} {
	filter := map[string]interface{}{"checkOn": "Metric Value", "filterType": "Greater Than", "value": "0"}
	if options != nil {
		filter["metricMonitorOptions"] = options
	}
	step := map[string]interface{}{
		"monitorCriteria": map[string]interface{}{
			"_type": "MonitorCriteria",
			"value": map[string]interface{}{
				"monitorCriteriaInstanceArray": []interface{}{
					map[string]interface{}{
						"_type": "MonitorCriteriaInstance",
						"value": map[string]interface{}{
							"name":            "HTTP 5xx",
							"filterCondition": "Any",
							"filters":         []interface{}{filter},
						},
					},
				},
			},
		},
	}
	for key, value := range settings {
		step[key] = value
	}
	return map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{"_type": "MonitorStep", "value": step},
			},
		},
	}
}

// The wire steps' one step, and its one filter.
func monitorStepsValuesWireParts(t *testing.T, wire interface{}) (map[string]interface{}, map[string]interface{}) {
	t.Helper()
	steps := monitorStepsWireValue(wire)["monitorStepsInstanceArray"].([]interface{})
	step := monitorStepsWireValue(steps[0])
	instances := monitorStepsWireValue(step["monitorCriteria"])["monitorCriteriaInstanceArray"].([]interface{})
	filters := monitorStepsWireValue(instances[0])["filters"].([]interface{})
	return step, filters[0].(map[string]interface{})
}

func TestMonitorStepsValues_StepsReadAsTheServerStoresThem(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)

	for _, c := range cases.StoredRollingTimes {
		settings := map[string]interface{}{}
		for _, keeps := range monitorStepsRollingTimeSettings {
			settings[keeps.apiKey] = map[string]interface{}{"rollingTime": c.Written}
		}
		step, _ := monitorStepsValuesWireParts(t, normalizeMonitorStepsValues(monitorStepsValuesWire(settings, nil)))

		for apiKey, stored := range c.Stored {
			got := step[apiKey].(map[string]interface{})
			gotValue, gotHas := got["rollingTime"]
			wantValue, wantHas := stored["rollingTime"]
			if gotHas != wantHas || !reflect.DeepEqual(gotValue, wantValue) {
				t.Errorf("%s written in %s reads as %s; the server stores %s", monitorStepsCaseText(c.Written), apiKey, monitorStepsCaseText(gotValue), monitorStepsCaseText(wantValue))
			}
		}
	}

	for _, c := range cases.StoredMetricMonitorOptions {
		options := map[string]interface{}{"metricAggregationType": c.Written, "onNoDataPolicy": c.Written}
		_, filter := monitorStepsValuesWireParts(t, normalizeMonitorStepsValues(monitorStepsValuesWire(nil, options)))

		got := filter["metricMonitorOptions"].(map[string]interface{})
		for key, want := range c.Stored {
			if !reflect.DeepEqual(got[key], want) {
				t.Errorf("%s written as %s reads as %s; the server stores %s", monitorStepsCaseText(c.Written), key, monitorStepsCaseText(got[key]), monitorStepsCaseText(want))
			}
		}
	}
}

// Only where the server reads them: a rolling time in settings that keep
// none, and a value outside a filter's metric options, are left as written.
func TestMonitorStepsValues_OnlyWhereTheServerReadsThem(t *testing.T) {
	wire := monitorStepsValuesWire(map[string]interface{}{
		"logMonitor":    map[string]interface{}{"rollingTime": "15 minutes"},
		"metricMonitor": map[string]interface{}{"lastRollingTime": "15 minutes", "metricViewConfig": map[string]interface{}{"rollingTime": "15 minutes"}},
	}, map[string]interface{}{"metricAlias": "avg", "metricAggregationType": "avg"})
	step, filter := monitorStepsValuesWireParts(t, wire)
	filter["evaluateOverTimeOptions"] = map[string]interface{}{"evaluateOverTimeType": "avg"}

	normalizeMonitorStepsValues(wire)

	if got := step["logMonitor"].(map[string]interface{})["rollingTime"]; got != "15 minutes" {
		t.Errorf("a Logs monitor's settings keep no rolling time; read as %v", got)
	}
	metric := step["metricMonitor"].(map[string]interface{})
	if metric["lastRollingTime"] != "15 minutes" || metric["metricViewConfig"].(map[string]interface{})["rollingTime"] != "15 minutes" {
		t.Errorf("only the settings' own rollingTime is read: %v", metric)
	}
	options := filter["metricMonitorOptions"].(map[string]interface{})
	if options["metricAlias"] != "avg" || options["metricAggregationType"] != "Average" {
		t.Errorf("only the aggregation and the no-data policy of metric options are read: %v", options)
	}
	if got := filter["evaluateOverTimeOptions"].(map[string]interface{})["evaluateOverTimeType"]; got != "avg" {
		t.Errorf("the provider takes only OneUptime's own evaluate-over-time values; read as %v", got)
	}

	// Steps of any other shape are left as they are, and do not panic.
	for _, value := range []interface{}{nil, "steps", []interface{}{}, map[string]interface{}{}, map[string]interface{}{"value": "x"},
		map[string]interface{}{"_type": "MonitorSteps", "value": map[string]interface{}{"monitorStepsInstanceArray": []interface{}{nil, "x", map[string]interface{}{"_type": "MonitorStep"}}}}} {
		normalizeMonitorStepsValues(value)
	}
}

// ---------------------------------------------------------------------------
// After an apply, a refresh and an import
// ---------------------------------------------------------------------------

// monitorStepsValuesSteps is a step list with these settings and metric
// options, as a configuration writes them or, with the server's ids and
// defaults (asServer), as an apply or a refresh reads them back.
func monitorStepsValuesSteps(t *testing.T, settings map[string]interface{}, options map[string]interface{}, asServer bool) MonitorStepsValue {
	t.Helper()
	wire := monitorStepsValuesWire(settings, options)
	if asServer {
		step, filter := monitorStepsValuesWireParts(t, wire)
		step["id"] = "a1000000-0000-4000-8000-000000000101"
		if metric, ok := step["metricMonitor"].(map[string]interface{}); ok {
			metric["metricViewConfig"] = map[string]interface{}{"queryConfigs": []interface{}{}, "formulaConfigs": []interface{}{}}
		}
		instances := monitorStepsWireValue(step["monitorCriteria"])["monitorCriteriaInstanceArray"].([]interface{})
		for key, value := range serverCriteriaDefaults {
			monitorStepsWireValue(instances[0])[key] = value
		}
		if options, ok := filter["metricMonitorOptions"].(map[string]interface{}); ok {
			options["metricAlias"] = "a"
		}
	}
	list, diags := MonitorStepsFromAPI(context.Background(), wire)
	if diags.HasError() {
		t.Fatalf("reading the steps: %v", diags)
	}
	return MonitorStepsValue{ListValue: list}
}

func monitorStepsValuesRollingTime(apiKey string, rollingTime interface{}) map[string]interface{} {
	return map[string]interface{}{apiKey: map[string]interface{}{"rollingTime": rollingTime}}
}

func TestMonitorStepsValues_WrittenAnotherWayIsNoChange(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name        string
		configured  map[string]interface{}
		options     map[string]interface{}
		server      map[string]interface{}
		serverOpts  map[string]interface{}
		sameMeaning bool
	}{
		{"the customer's rolling time, stored as the one it means", monitorStepsValuesRollingTime("metricMonitor", "15 minutes"), nil, monitorStepsValuesRollingTime("metricMonitor", "Past 15 Minutes"), nil, true},
		{"ISO 8601", monitorStepsValuesRollingTime("metricMonitor", "PT15M"), nil, monitorStepsValuesRollingTime("metricMonitor", "Past 15 Minutes"), nil, true},
		{"another case and spacing", monitorStepsValuesRollingTime("metricMonitor", "past_15_minutes"), nil, monitorStepsValuesRollingTime("metricMonitor", "Past 15 Minutes"), nil, true},
		{"in the settings of another type that keeps one", monitorStepsValuesRollingTime("kubernetesMonitor", "1h"), nil, monitorStepsValuesRollingTime("kubernetesMonitor", "Past 1 Hour"), nil, true},
		{"a length of another rolling time", monitorStepsValuesRollingTime("metricMonitor", "15 minutes"), nil, monitorStepsValuesRollingTime("metricMonitor", "Past 30 Minutes"), nil, false},
		{"a length no rolling time has, stored as written", monitorStepsValuesRollingTime("metricMonitor", "20 minutes"), nil, monitorStepsValuesRollingTime("metricMonitor", "20 minutes"), nil, true},
		{"a length no rolling time has is not guessed", monitorStepsValuesRollingTime("metricMonitor", "20 minutes"), nil, monitorStepsValuesRollingTime("metricMonitor", "Past 15 Minutes"), nil, false},
		{"no metric rolling time, stored as the default", monitorStepsValuesRollingTime("metricMonitor", nil), nil, monitorStepsValuesRollingTime("metricMonitor", "Past 1 Minute"), nil, true},
		{"no rolling time elsewhere is kept as none", monitorStepsValuesRollingTime("kubernetesMonitor", nil), nil, monitorStepsValuesRollingTime("kubernetesMonitor", "Past 1 Minute"), nil, false},
		{"settings that keep no rolling time", monitorStepsValuesRollingTime("logMonitor", "15 minutes"), nil, monitorStepsValuesRollingTime("logMonitor", "Past 15 Minutes"), nil, false},
		{"an aggregation's other name", nil, map[string]interface{}{"metricAggregationType": "avg"}, nil, map[string]interface{}{"metricAggregationType": "Average"}, true},
		{"a no-data policy in another case", nil, map[string]interface{}{"onNoDataPolicy": "trigger"}, nil, map[string]interface{}{"onNoDataPolicy": "Trigger"}, true},
		{"another aggregation", nil, map[string]interface{}{"metricAggregationType": "avg"}, nil, map[string]interface{}{"metricAggregationType": "Sum"}, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			configured := monitorStepsValuesSteps(t, c.configured, c.options, false)
			echoed := monitorStepsValuesSteps(t, c.server, c.serverOpts, true)

			// The framework asks the newer value (the apply's result, the
			// refresh) whether the prior one (the plan, the state) means it.
			equal, diags := echoed.ListSemanticEquals(ctx, configured)
			if diags.HasError() {
				t.Fatalf("unexpected diagnostics: %v", diags)
			}
			if equal != c.sameMeaning {
				t.Fatalf("the server's steps semantically equal to the configuration's: %v, want %v", equal, c.sameMeaning)
			}

			// Right after an import, the same rule.
			if same := monitorStepsSameAfterImport(ctx, configured.ListValue, echoed.ListValue); same != c.sameMeaning {
				t.Fatalf("the same steps right after an import: %v, want %v", same, c.sameMeaning)
			}
		})
	}
}

// Steps that say the same thing are the same whichever side writes a value
// another way: the newer value may hold the other spelling too - an answer
// from a OneUptime that stored values as written, before it read them.
func TestMonitorStepsValues_EitherSideMayWriteItAnotherWay(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name         string
		a, b         map[string]interface{}
		aOpts, bOpts map[string]interface{}
		sameMeaning  bool
	}{
		{"a rolling time", monitorStepsValuesRollingTime("metricMonitor", "15 minutes"), monitorStepsValuesRollingTime("metricMonitor", "Past 15 Minutes"), nil, nil, true},
		{"two spellings of one", monitorStepsValuesRollingTime("hostMonitor", "1h"), monitorStepsValuesRollingTime("hostMonitor", "60 minutes"), nil, nil, true},
		{"no metric rolling time and the default", monitorStepsValuesRollingTime("metricMonitor", nil), monitorStepsValuesRollingTime("metricMonitor", "Past 1 Minute"), nil, nil, true},
		{"an aggregation", nil, nil, map[string]interface{}{"metricAggregationType": "max"}, map[string]interface{}{"metricAggregationType": "Maximum Value"}, true},
		{"two lengths", monitorStepsValuesRollingTime("metricMonitor", "20 minutes"), monitorStepsValuesRollingTime("metricMonitor", "Past 30 Minutes"), nil, nil, false},
		{"two aggregations", nil, nil, map[string]interface{}{"metricAggregationType": "min"}, map[string]interface{}{"metricAggregationType": "Maximum Value"}, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a := monitorStepsValuesSteps(t, c.a, c.aOpts, false)
			b := monitorStepsValuesSteps(t, c.b, c.bOpts, false)

			for index, pair := range [][2]MonitorStepsValue{{a, b}, {b, a}} {
				equal, diags := pair[0].ListSemanticEquals(ctx, pair[1])
				if diags.HasError() {
					t.Fatalf("unexpected diagnostics: %v", diags)
				}
				if equal != c.sameMeaning {
					t.Fatalf("pair %d semantically equal: %v, want %v", index, equal, c.sameMeaning)
				}
				if same := monitorStepsSameAfterImport(ctx, pair[0].ListValue, pair[1].ListValue); same != c.sameMeaning {
					t.Fatalf("pair %d the same after an import: %v, want %v", index, same, c.sameMeaning)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

// monitorStepsValuesTypeConfig is a configuration with a monitor_type and
// one settings attribute, as a validator of a step's settings reads it.
func monitorStepsValuesTypeConfig(monitorType tftypes.Value, withType bool) tfsdk.Config {
	attributes := map[string]schema.Attribute{"settings": schema.StringAttribute{Optional: true}}
	attributeTypes := map[string]tftypes.Type{"settings": tftypes.String}
	values := map[string]tftypes.Value{"settings": tftypes.NewValue(tftypes.String, nil)}
	if withType {
		attributes["monitor_type"] = schema.StringAttribute{Optional: true}
		attributeTypes["monitor_type"] = tftypes.String
		values["monitor_type"] = monitorType
	}
	return tfsdk.Config{
		Schema: schema.Schema{Attributes: attributes},
		Raw:    tftypes.NewValue(tftypes.Object{AttributeTypes: attributeTypes}, values),
	}
}

func monitorStepsValuesValidate(v validator.String, config tfsdk.Config, at path.Path, value types.String) []string {
	resp := &validator.StringResponse{}
	v.ValidateString(context.Background(), validator.StringRequest{Path: at, Config: config, ConfigValue: value}, resp)
	details := []string{}
	for _, diagnostic := range resp.Diagnostics.Errors() {
		details = append(details, diagnostic.Detail())
	}
	return details
}

func TestMonitorStepsValues_AnUnreadableRollingTimeIsRefusedAtPlan(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)
	serverRefusal := ""
	for _, c := range cases.RollingTimeErrorsBySettings {
		if c.APIKey == "metricMonitor" && c.Written == "20 minutes" && c.Error != nil {
			serverRefusal = *c.Error
		}
	}
	if serverRefusal == "" {
		t.Fatal("the cases hold no refusal of \"20 minutes\" in a Metrics monitor's settings")
	}

	metrics := tftypes.NewValue(tftypes.String, "Metrics")
	metricSettings := monitorStepsRollingTimeValidator{apiKey: "metricMonitor", monitorType: "Metrics"}
	at := path.Root("settings")

	refused := []struct {
		name     string
		settings string
	}{
		{"a length no rolling time has", `{"metricViewConfig":{"queryConfigs":[]},"rollingTime":"20 minutes"}`},
		{"white space alone", `{"rollingTime":"   "}`},
		{"a number", `{"rollingTime":15}`},
		{"the enum's key name", `{"rollingTime":"Past1Hours"}`},
	}
	for _, c := range refused {
		t.Run("refused: "+c.name, func(t *testing.T) {
			details := monitorStepsValuesValidate(metricSettings, monitorStepsValuesTypeConfig(metrics, true), at, types.StringValue(c.settings))
			if len(details) != 1 {
				t.Fatalf("refused with %v, want one refusal", details)
			}
			if c.name == "a length no rolling time has" && details[0] != serverRefusal {
				t.Fatalf("refused with\n%s\nthe server refuses it with\n%s", details[0], serverRefusal)
			}
		})
	}

	allowed := []struct {
		name        string
		monitorType tftypes.Value
		withType    bool
		settings    types.String
	}{
		{"a rolling time", metrics, true, types.StringValue(`{"rollingTime":"Past 15 Minutes"}`)},
		{"a length written another way", metrics, true, types.StringValue(`{"rollingTime":"15 minutes"}`)},
		{"no rolling time", metrics, true, types.StringValue(`{"metricViewConfig":{}}`)},
		{"a null rolling time", metrics, true, types.StringValue(`{"rollingTime":null}`)},
		{"an empty rolling time", metrics, true, types.StringValue(`{"rollingTime":""}`)},
		{"settings another type reads", tftypes.NewValue(tftypes.String, "Kubernetes"), true, types.StringValue(`{"rollingTime":"20 minutes"}`)},
		{"a type not known yet", tftypes.NewValue(tftypes.String, tftypes.UnknownValue), true, types.StringValue(`{"rollingTime":"20 minutes"}`)},
		{"no type", tftypes.NewValue(tftypes.String, nil), true, types.StringValue(`{"rollingTime":"20 minutes"}`)},
		{"a resource with no monitor_type", tftypes.Value{}, false, types.StringValue(`{"rollingTime":"20 minutes"}`)},
		{"settings not known yet", metrics, true, types.StringUnknown()},
		{"no settings", metrics, true, types.StringNull()},
		{"text that is not JSON (refused where steps are written)", metrics, true, types.StringValue(`{"rollingTime":`)},
		{"JSON that is no object", metrics, true, types.StringValue(`["20 minutes"]`)},
	}
	for _, c := range allowed {
		t.Run("allowed: "+c.name, func(t *testing.T) {
			if details := monitorStepsValuesValidate(metricSettings, monitorStepsValuesTypeConfig(c.monitorType, c.withType), at, c.settings); len(details) > 0 {
				t.Fatalf("refused with %v", details)
			}
		})
	}
}

func TestMonitorStepsValues_EachTypesSettingsAreValidated(t *testing.T) {
	attrs := monitorStepsStepSchema().Attributes

	for _, sub := range monitorStepsSubConfigs {
		attribute, ok := attrs[sub.tfName].(schema.StringAttribute)
		if !ok {
			t.Fatalf("%s is no string attribute", sub.tfName)
		}
		found := []monitorStepsRollingTimeValidator{}
		for _, v := range attribute.Validators {
			if rollingTime, ok := v.(monitorStepsRollingTimeValidator); ok {
				found = append(found, rollingTime)
			}
		}

		monitorType := monitorStepsRollingTimeMonitorType(sub.apiKey)
		switch {
		case monitorType == "" && len(found) > 0:
			t.Errorf("%s keeps no rolling time, yet validates one", sub.tfName)
		case monitorType != "" && (len(found) != 1 || found[0].apiKey != sub.apiKey || found[0].monitorType != monitorType):
			t.Errorf("%s is read by a %s monitor; its rolling time validators are %v", sub.tfName, monitorType, found)
		}

		// Each type's settings are refused only on a monitor of that type.
		if monitorType == "" {
			continue
		}
		for _, settings := range monitorStepsRollingTimeSettings {
			config := monitorStepsValuesTypeConfig(tftypes.NewValue(tftypes.String, settings.monitorType), true)
			details := monitorStepsValuesValidate(found[0], config, path.Root("settings"), types.StringValue(`{"rollingTime":"20 minutes"}`))
			if refused := len(details) > 0; refused != (settings.monitorType == monitorType) {
				t.Errorf("%s on a %s monitor refused: %v", sub.tfName, settings.monitorType, refused)
			}
		}
	}
}

// metricOptionsConfig is a monitor configuration with one step: its one
// criteria named name, with a filter that has these metric options.
func monitorStepsValuesOptionsConfig(t *testing.T, name string, options string) tfsdk.Config {
	t.Helper()
	ctx := context.Background()
	wire := monitorStepsValuesWire(map[string]interface{}{"metricMonitor": map[string]interface{}{"rollingTime": "Past 5 Minutes"}}, nil)
	step, filter := monitorStepsValuesWireParts(t, wire)
	instances := monitorStepsWireValue(step["monitorCriteria"])["monitorCriteriaInstanceArray"].([]interface{})
	monitorStepsWireValue(instances[0])["name"] = name
	var parsed interface{}
	if err := json.Unmarshal([]byte(options), &parsed); err != nil {
		t.Fatalf("the options are not JSON: %s", err)
	}
	filter["metricMonitorOptions"] = parsed

	steps, diags := MonitorStepsFromAPI(ctx, wire)
	if diags.HasError() {
		t.Fatalf("reading the steps: %v", diags)
	}
	stepsValue, err := steps.ToTerraformValue(ctx)
	if err != nil {
		t.Fatalf("encoding the steps: %s", err)
	}

	resourceSchema := schema.Schema{Attributes: map[string]schema.Attribute{
		"monitor_type":  schema.StringAttribute{Required: true},
		"monitor_steps": MonitorStepsSchemaAttribute("steps"),
	}}
	objectType := resourceSchema.Type().TerraformType(ctx).(tftypes.Object)
	return tfsdk.Config{
		Schema: resourceSchema,
		Raw: tftypes.NewValue(objectType, map[string]tftypes.Value{
			"monitor_type":  tftypes.NewValue(tftypes.String, "Metrics"),
			"monitor_steps": stepsValue,
		}),
	}
}

func TestMonitorStepsValues_UnreadableMetricOptionsAreRefusedAtPlan(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)
	at := path.Root("monitor_steps").AtListIndex(0).AtName("criteria").AtListIndex(0).AtName("filters").AtListIndex(0).AtName("metric_monitor_options")
	checked := 0

	for _, c := range cases.CriteriaValueCases {
		written, err := json.Marshal(map[string]interface{}{c.Key: c.Written, "metricAlias": "a"})
		if err != nil {
			t.Fatalf("encoding %v: %s", c.Written, err)
		}
		config := monitorStepsValuesOptionsConfig(t, cases.CriteriaName, string(written))
		details := monitorStepsValuesValidate(monitorStepsMetricMonitorOptionsValidator{}, config, at, types.StringValue(string(written)))

		want := []string{}
		if c.Error != nil {
			want = append(want, *c.Error)
		}
		if !reflect.DeepEqual(details, want) {
			t.Errorf("%s as %s is refused with %v; the server refuses it with %v", monitorStepsCaseText(c.Written), c.Key, details, want)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no criteria value cases")
	}

	// Both refused at once, each in its words; and nothing to refuse where
	// the options are not known yet, are not JSON, or are no object.
	both := `{"metricAggregationType":"avgg","onNoDataPolicy":"never"}`
	details := monitorStepsValuesValidate(monitorStepsMetricMonitorOptionsValidator{}, monitorStepsValuesOptionsConfig(t, "Errors", both), at, types.StringValue(both))
	if len(details) != 2 || !strings.Contains(details[0], `metricAggregationType "avgg"`) || !strings.Contains(details[1], `onNoDataPolicy "never"`) {
		t.Fatalf("refused with %v", details)
	}
	for _, value := range []types.String{types.StringUnknown(), types.StringNull(), types.StringValue(`{"metricAggregationType":`), types.StringValue(`["avgg"]`)} {
		if details := monitorStepsValuesValidate(monitorStepsMetricMonitorOptionsValidator{}, monitorStepsValuesOptionsConfig(t, "Errors", `{}`), at, value); len(details) > 0 {
			t.Fatalf("%s refused with %v", value, details)
		}
	}

	attribute := monitorStepsFilterSchema().Attributes["metric_monitor_options"].(schema.StringAttribute)
	found := false
	for _, v := range attribute.Validators {
		if _, ok := v.(monitorStepsMetricMonitorOptionsValidator); ok {
			found = true
		}
	}
	if !found {
		t.Fatal("metric_monitor_options has no validator of its aggregation and no-data policy")
	}
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

func TestMonitorStepsValues_DescriptionsListTheValues(t *testing.T) {
	attrs := monitorStepsStepSchema().Attributes
	metric := attrs["metric_monitor"].(schema.StringAttribute).MarkdownDescription
	for _, rollingTime := range monitorStepsRollingTimes {
		if !strings.Contains(metric, "`"+rollingTime.value+"`") {
			t.Errorf("metric_monitor's description does not list %q", rollingTime.value)
		}
	}
	for _, spelling := range []string{"`15 minutes`", "`1h`", "`PT15M`"} {
		if !strings.Contains(metric, spelling) {
			t.Errorf("metric_monitor's description does not show %s", spelling)
		}
	}

	for _, sub := range monitorStepsSubConfigs {
		if sub.apiKey == "metricMonitor" || monitorStepsRollingTimeMonitorType(sub.apiKey) == "" {
			continue
		}
		description := attrs[sub.tfName].(schema.StringAttribute).MarkdownDescription
		if !strings.Contains(description, "rollingTime takes the values listed for `metric_monitor`") {
			t.Errorf("%s's description does not say which rolling times it takes: %s", sub.tfName, description)
		}
	}

	options := monitorStepsFilterSchema().Attributes["metric_monitor_options"].(schema.StringAttribute).MarkdownDescription
	for _, value := range append(append([]string{}, monitorStepsEvaluateOverTimeTypeValues...), monitorStepsNoDataPolicyValues...) {
		if !strings.Contains(options, "`"+value+"`") {
			t.Errorf("metric_monitor_options' description does not list %q", value)
		}
	}
}

// ---------------------------------------------------------------------------
// JavaScript's text rules
// ---------------------------------------------------------------------------

func TestMonitorStepsValues_TextAsJavaScriptWritesIt(t *testing.T) {
	numbers := map[float64]string{
		0: "0", 15: "15", -15: "-15", 1.5: "1.5", 0.1: "0.1", 1e21: "1e+21", 1e20: "100000000000000000000",
		1.5e21: "1.5e+21", 1e-7: "1e-7", 1.25e-7: "1.25e-7", 0.000001: "0.000001", 123456789012345680000: "123456789012345680000",
	}
	for number, want := range numbers {
		if got := jsNumberText(number); got != want {
			t.Errorf("%v is written %q, JavaScript writes %q", number, got, want)
		}
	}

	quoted := map[string]string{
		`a"b\c`:         `"a\"b\\c"`,
		"tab\there\n":   `"tab\there\n"`,
		"\u0001\b\f\r":  `"\u0001\b\f\r"`,
		"<&>\u2028":     "\"<&>\u2028\"",
		"\U0001F600":    "\"\U0001F600\"",
		"\u00e9\u0085x": "\"\u00e9\u0085x\"",
	}
	for text, want := range quoted {
		if got := jsQuotedString(text, -1); got != want {
			t.Errorf("%q is quoted %s, JavaScript quotes %s", text, got, want)
		}
	}

	// Cut after 64 UTF-16 units: a pair the cut splits is escaped.
	if got := jsQuotedString(strings.Repeat("a", 63)+"\U0001F600", 64); got != `"`+strings.Repeat("a", 63)+`\ud83d…"` {
		t.Errorf("a pair cut in two is quoted %s", got)
	}
	if got := jsQuotedString(strings.Repeat("a", 64), 64); got != `"`+strings.Repeat("a", 64)+`"` {
		t.Errorf("64 units are quoted %s", got)
	}

	for _, r := range []rune{'\ufeff', '\u00a0', '\u2028', '\u3000', '\u200a', '\t'} {
		if !jsIsWhitespace(r) {
			t.Errorf("%U is white space to JavaScript", r)
		}
	}
	for _, r := range []rune{'\u0085', '\u200b', '\u180e', 'x', '_'} {
		if jsIsWhitespace(r) {
			t.Errorf("%U is no white space to JavaScript", r)
		}
	}

	if got := jsToLower("PAST \u0130 \u212a"); got != "past i\u0307 k" {
		t.Errorf("lowered as %q", got)
	}
	if got := jsLength("a\U0001F600"); got != 3 {
		t.Errorf("a and an emoji are %d UTF-16 units, not 3", got)
	}
	if got := jsJoinSeparators(" a__b - c\u00a0", " "); got != " a b c " {
		t.Errorf("separators joined as %q", got)
	}
	for _, falsy := range []interface{}{nil, false, "", 0.0} {
		if !jsIsFalsy(falsy) {
			t.Errorf("%#v is false to JavaScript", falsy)
		}
	}
	for _, truthy := range []interface{}{true, "0", " ", 1.0, []interface{}{}, map[string]interface{}{}} {
		if jsIsFalsy(truthy) {
			t.Errorf("%#v is true to JavaScript", truthy)
		}
	}
}

var _ attr.Value = MonitorStepsValue{}
