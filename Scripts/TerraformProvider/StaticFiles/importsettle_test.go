package provider

/*
 * The plan modifiers that let an import settle (importsettle.go and the
 * monitor steps' in monitorsteps.go), called the way the framework calls
 * them: each keeps the state's value only when the configuration says the
 * same thing another way, and never otherwise - a real change, a value not
 * known yet, or a resource being created all plan as they always did. How
 * they read the private state an import leaves, through the framework's own,
 * is import_plan_test.go's.
 */

import (
	"context"
	"math/big"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// fakePrivate is a resource's private state, as the framework keeps it.
type fakePrivate struct {
	data map[string][]byte
}

func (p *fakePrivate) GetKey(_ context.Context, key string) ([]byte, diag.Diagnostics) {
	if p == nil || p.data == nil {
		return nil, nil
	}
	return p.data[key], nil
}

func (p *fakePrivate) SetKey(_ context.Context, key string, value []byte) diag.Diagnostics {
	if p.data == nil {
		p.data = map[string][]byte{}
	}
	if len(value) == 0 {
		delete(p.data, key)
		return nil
	}
	p.data[key] = value
	return nil
}

func planString(t *testing.T, modifier planmodifier.String, state, config types.String) types.String {
	t.Helper()
	req := planmodifier.StringRequest{
		Path:        path.Root("starts_at"),
		StateValue:  state,
		ConfigValue: config,
		PlanValue:   config,
	}
	resp := &planmodifier.StringResponse{PlanValue: req.PlanValue}
	modifier.PlanModifyString(context.Background(), req, resp)
	if resp.Diagnostics.HasError() {
		t.Fatalf("the plan modifier failed: %v", resp.Diagnostics)
	}
	return resp.PlanValue
}

func TestRFC3339KeepSameInstantKeepsTheStateForTheSameInstant(t *testing.T) {
	modifier := RFC3339KeepSameInstant()

	for _, tc := range []struct{ state, config string }{
		// What an import reads, and how a configuration writes it.
		{"2030-01-01T00:00:00.000Z", "2030-01-01T00:00:00Z"},
		{"2030-01-01T09:00:00.000Z", "2030-01-01T10:00:00+01:00"},
		{"2030-01-01T00:00:00Z", "2030-01-01T00:00:00.000000Z"},
	} {
		got := planString(t, modifier, types.StringValue(tc.state), types.StringValue(tc.config))
		if got.ValueString() != tc.state {
			t.Errorf("%q in the configuration over %q in state plans %q, want the state's", tc.config, tc.state, got.ValueString())
		}
	}
}

func TestRFC3339KeepSameInstantPlansEveryOtherTimestampAsWritten(t *testing.T) {
	modifier := RFC3339KeepSameInstant()

	cases := []struct {
		name          string
		state, config types.String
	}{
		{"another instant", types.StringValue("2030-01-01T00:00:00.000Z"), types.StringValue("2030-01-01T00:00:01Z")},
		{"a create", types.StringNull(), types.StringValue("2030-01-01T00:00:00Z")},
		{"a value known at apply", types.StringValue("2030-01-01T00:00:00.000Z"), types.StringUnknown()},
		{"not a timestamp", types.StringValue("soon"), types.StringValue("later")},
		{"a timestamp over one that is not", types.StringValue("soon"), types.StringValue("2030-01-01T00:00:00Z")},
	}
	for _, tc := range cases {
		got := planString(t, modifier, tc.state, tc.config)
		if !got.Equal(tc.config) {
			t.Errorf("%s: planned %s, want the configuration's %s", tc.name, got, tc.config)
		}
	}
}

func planNumber(t *testing.T, state, config types.Number) types.Number {
	t.Helper()
	req := planmodifier.NumberRequest{
		Path:        path.Root("uptime_percent_greater_than_or_equal_to"),
		StateValue:  state,
		ConfigValue: config,
		PlanValue:   config,
	}
	resp := &planmodifier.NumberResponse{PlanValue: req.PlanValue}
	NumberKeepSameAPINumber().PlanModifyNumber(context.Background(), req, resp)
	if resp.Diagnostics.HasError() {
		t.Fatalf("the plan modifier failed: %v", resp.Diagnostics)
	}
	return resp.PlanValue
}

func configBigNumber(t *testing.T, text string) *big.Float {
	t.Helper()
	number, ok := parseAPINumberText(text)
	if !ok {
		t.Fatalf("%q is not a number", text)
	}
	return number
}

func TestNumberKeepSameAPINumberKeepsTheNumberOneUptimeKeeps(t *testing.T) {
	// 100 * (1 - 1 / 1440), as Terraform computes it: hundreds of digits.
	oneMinuteDown := new(big.Float).SetPrec(512).Quo(
		new(big.Float).SetPrec(512).SetInt64(143900),
		new(big.Float).SetPrec(512).SetInt64(1440),
	)
	// The 64-bit float OneUptime keeps it as, which an import reads.
	imported := configBigNumber(t, "99.93055555555556")

	got := planNumber(t, types.NumberValue(imported), types.NumberValue(oneMinuteDown))
	if got.ValueBigFloat().Cmp(imported) != 0 {
		t.Fatalf("planned %s, want the imported %s", got.ValueBigFloat().Text('g', 30), imported.Text('g', 30))
	}
}

func TestNumberKeepSameAPINumberPlansEveryOtherNumberAsWritten(t *testing.T) {
	cases := []struct {
		name          string
		state, config types.Number
	}{
		{"another number", types.NumberValue(configBigNumber(t, "99.65")), types.NumberValue(configBigNumber(t, "99.66"))},
		{"a create", types.NumberNull(), types.NumberValue(configBigNumber(t, "1"))},
		{"a value known at apply", types.NumberValue(configBigNumber(t, "1")), types.NumberUnknown()},
		{"the same number", types.NumberValue(configBigNumber(t, "99.65")), types.NumberValue(configBigNumber(t, "99.65"))},
	}
	for _, tc := range cases {
		got := planNumber(t, tc.state, tc.config)
		if !got.Equal(tc.config) {
			t.Errorf("%s: planned %s, want the configuration's %s", tc.name, got, tc.config)
		}
	}
}

const importedRestrictionTimes = `{"_type":"RestrictionTimes","value":{"restictionType":"None","weeklyRestrictionTimes":[]}}`

func TestJSONSameAfterImport(t *testing.T) {
	cases := []struct {
		name              string
		planned, imported string
		sameAfterAnImport bool
	}{
		{"the keys a configuration writes, and one OneUptime fills in",
			`{"_type":"RestrictionTimes","value":{"restictionType":"None"}}`, importedRestrictionTimes, true},
		{"another value",
			`{"_type":"RestrictionTimes","value":{"restictionType":"Daily"}}`, importedRestrictionTimes, false},
		{"a key the import does not have",
			`{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null}}`, importedRestrictionTimes, false},
		{"a bare origin without its trailing slash",
			`{"_type":"URL","value":"https://example.com"}`, `{"_type":"URL","value":"https://example.com/"}`, true},
		{"a timestamp without milliseconds",
			`{"startTime":{"_type":"DateTime","value":"2030-01-05T09:00:00Z"}}`, `{"startTime":{"_type":"DateTime","value":"2030-01-05T09:00:00.000Z"},"endTime":null}`, true},
		{"a list of another length",
			`{"items":[1]}`, `{"items":[1,2]}`, false},
		{"text that is not JSON",
			`#FF0000`, `#ff0000`, false},
	}
	for _, tc := range cases {
		if got := jsonSameAfterImport(tc.planned, tc.imported); got != tc.sameAfterAnImport {
			t.Errorf("%s: jsonSameAfterImport = %t, want %t", tc.name, got, tc.sameAfterAnImport)
		}
	}
}

func TestJSONSubsetKeepImportedPlansTheConfigurationWithNoImportBehindIt(t *testing.T) {
	sparse := `{"_type":"RestrictionTimes","value":{"restictionType":"None"}}`
	req := planmodifier.StringRequest{
		Path:        path.Root("restriction_times"),
		StateValue:  types.StringValue(importedRestrictionTimes),
		ConfigValue: types.StringValue(sparse),
		PlanValue:   types.StringValue(sparse),
	}
	resp := &planmodifier.StringResponse{PlanValue: req.PlanValue}
	JSONSubsetKeepImported().PlanModifyString(context.Background(), req, resp)

	// A resource Terraform made, or one an update has written since: the
	// configuration is what it says, and taking a key out of it is a change.
	if resp.PlanValue.ValueString() != sparse {
		t.Fatalf("with no import, planned %s, want the configuration's", resp.PlanValue)
	}
}

func TestImportedFromServerNamesEachAttributeUntilAnUpdateWritesIt(t *testing.T) {
	ctx := context.Background()
	private := &fakePrivate{}
	if diags := markImportedFromServer(ctx, private, []string{"rotation", "restriction_times"}); diags.HasError() {
		t.Fatalf("marking the import: %v", diags)
	}

	if got := string(private.data[importedFromServerKey]); got != `["restriction_times","rotation"]` {
		t.Fatalf("the import left %s in the private state", got)
	}
	for _, name := range []string{"restriction_times", "rotation"} {
		if !isImportedFromServer(ctx, private, path.Root(name)) {
			t.Fatalf("%s does not hold what was imported", name)
		}
	}
	if isImportedFromServer(ctx, private, path.Root("custom_fields")) {
		t.Fatalf("custom_fields, which the import did not name, holds what was imported")
	}

	// An update that writes restriction_times from the configuration takes it
	// off; rotation, which it did not write, still holds what was imported.
	if diags := keepImportedFromServer(ctx, private, map[string]bool{"restriction_times": true, "rotation": false}); diags.HasError() {
		t.Fatalf("keeping the import: %v", diags)
	}
	if isImportedFromServer(ctx, private, path.Root("restriction_times")) {
		t.Fatalf("restriction_times still holds what was imported after an update wrote it")
	}
	if !isImportedFromServer(ctx, private, path.Root("rotation")) {
		t.Fatalf("rotation, which the update did not write, no longer holds what was imported")
	}

	// Once nothing holds what was imported, the key goes.
	if diags := keepImportedFromServer(ctx, private, map[string]bool{"rotation": true}); diags.HasError() {
		t.Fatalf("keeping the import: %v", diags)
	}
	if _, kept := private.data[importedFromServerKey]; kept {
		t.Fatalf("the private state still holds %s after every attribute was written", importedFromServerKey)
	}
}

func TestImportedFromServerWithNoPrivateState(t *testing.T) {
	ctx := context.Background()
	var none *fakePrivate

	// A nil private state inside the interface is no private state: nothing
	// to mark, forget or find, and no panic.
	if diags := markImportedFromServer(ctx, none, []string{"rotation"}); diags.HasError() {
		t.Fatalf("marking with no private state: %v", diags)
	}
	if diags := forgetImportedFromServer(ctx, none); diags.HasError() {
		t.Fatalf("forgetting with no private state: %v", diags)
	}
	if isImportedFromServer(ctx, none, path.Root("rotation")) {
		t.Fatalf("no private state says rotation was imported")
	}
	if isImportedFromServer(ctx, nil, path.Root("rotation")) {
		t.Fatalf("a nil interface says rotation was imported")
	}

	// A create forgets what an earlier import named.
	private := &fakePrivate{}
	markImportedFromServer(ctx, private, []string{"rotation"})
	forgetImportedFromServer(ctx, private)
	if isImportedFromServer(ctx, private, path.Root("rotation")) {
		t.Fatalf("after a create, rotation still holds what was imported")
	}

	// Private state that is not the list an import writes is ignored.
	private.data = map[string][]byte{importedFromServerKey: []byte(`true`)}
	if isImportedFromServer(ctx, private, path.Root("rotation")) {
		t.Fatalf("a private state that is not a list of attributes says rotation was imported")
	}
}

// monitorStepsFromWire is a monitor_steps list as an API answer reads.
func monitorStepsFromWire(t *testing.T, wire map[string]interface{}) types.List {
	t.Helper()
	list, diags := MonitorStepsFromAPI(context.Background(), wire)
	if diags.HasError() {
		t.Fatalf("reading monitor steps: %v", diags)
	}
	return list
}

func monitorStepWire(destination string, criteria map[string]interface{}, extra map[string]interface{}) map[string]interface{} {
	step := map[string]interface{}{
		"monitorDestination": map[string]interface{}{"_type": "URL", "value": destination},
		"monitorCriteria": map[string]interface{}{
			"_type": "MonitorCriteria",
			"value": map[string]interface{}{
				"monitorCriteriaInstanceArray": []interface{}{
					map[string]interface{}{"_type": "MonitorCriteriaInstance", "value": criteria},
				},
			},
		},
	}
	for key, value := range extra {
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

func onlineCriteria(extra map[string]interface{}) map[string]interface{} {
	criteria := map[string]interface{}{
		"name":            "Check if online",
		"filterCondition": "All",
		"filters": []interface{}{
			map[string]interface{}{"checkOn": "Is Online", "filterType": "True"},
		},
	}
	for key, value := range extra {
		criteria[key] = value
	}
	return criteria
}

// What OneUptime keeps of a criteria a configuration never gave the flags of.
var serverCriteriaDefaults = map[string]interface{}{
	"changeMonitorStatus": false,
	"createIncidents":     false,
	"createAlerts":        false,
	"isEnabled":           true,
}

func TestMonitorStepsSameAfterImport(t *testing.T) {
	ctx := context.Background()
	imported := monitorStepsFromWire(t, monitorStepWire("https://example.com/", onlineCriteria(serverCriteriaDefaults), map[string]interface{}{"requestType": "GET"}))

	cases := []struct {
		name string
		wire map[string]interface{}
		same bool
	}{
		{"the steps as a configuration writes them",
			monitorStepWire("https://example.com", onlineCriteria(nil), nil), true},
		{"a default written out",
			monitorStepWire("https://example.com", onlineCriteria(map[string]interface{}{"isEnabled": true}), map[string]interface{}{"requestType": "GET"}), true},
		{"a criteria turned off",
			monitorStepWire("https://example.com", onlineCriteria(map[string]interface{}{"isEnabled": false}), nil), false},
		{"another destination",
			monitorStepWire("https://example.org", onlineCriteria(nil), nil), false},
		{"a path the server keeps as it is",
			monitorStepWire("https://example.com/health", onlineCriteria(nil), nil), false},
		{"another request type",
			monitorStepWire("https://example.com", onlineCriteria(nil), map[string]interface{}{"requestType": "POST"}), false},
	}
	for _, tc := range cases {
		planned := monitorStepsFromWire(t, tc.wire)
		if got := monitorStepsSameAfterImport(ctx, planned, imported); got != tc.same {
			t.Errorf("%s: monitorStepsSameAfterImport = %t, want %t", tc.name, got, tc.same)
		}
	}

	// No steps on either side is never the same.
	if monitorStepsSameAfterImport(ctx, MonitorStepsNull(), imported) {
		t.Errorf("no steps planned is the same as the imported ones")
	}
}

func TestMonitorStepsKeepImportedLeavesStepsKnownOnlyAtApplyAlone(t *testing.T) {
	ctx := context.Background()
	imported := monitorStepsFromWire(t, monitorStepWire("https://example.com/", onlineCriteria(serverCriteriaDefaults), nil))

	// The same steps, but the criteria's status is a data source's id not read
	// yet: unknown in the configuration, so nothing to compare.
	planned := monitorStepsFromWire(t, monitorStepWire("https://example.com", onlineCriteria(nil), nil))
	step := planned.Elements()[0].(types.Object)
	criteria := step.Attributes()["criteria"].(types.List).Elements()[0].(types.Object)

	criteriaAttributes := map[string]attr.Value{}
	for name, value := range criteria.Attributes() {
		criteriaAttributes[name] = value
	}
	criteriaAttributes["monitor_status_id"] = types.StringUnknown()
	unknownCriteria := types.ObjectValueMust(monitorStepsCriteriaAttrTypes(), criteriaAttributes)

	stepAttributes := map[string]attr.Value{}
	for name, value := range step.Attributes() {
		stepAttributes[name] = value
	}
	stepAttributes["criteria"] = types.ListValueMust(types.ObjectType{AttrTypes: monitorStepsCriteriaAttrTypes()}, []attr.Value{unknownCriteria})
	unknownStep := types.ObjectValueMust(monitorStepsStepAttrTypes(), stepAttributes)
	withUnknown := types.ListValueMust(types.ObjectType{AttrTypes: monitorStepsStepAttrTypes()}, []attr.Value{unknownStep})

	// Compared as the API takes them, the unknown status is left out - which
	// is why the modifier checks the configuration is wholly known first.
	configured, err := withUnknown.ToTerraformValue(ctx)
	if err != nil {
		t.Fatalf("reading the configuration: %s", err)
	}
	if configured.IsFullyKnown() {
		t.Fatalf("steps with a status known only at apply read as wholly known")
	}

	resp := &planmodifier.ListResponse{PlanValue: withUnknown}
	MonitorStepsKeepImported().PlanModifyList(ctx, planmodifier.ListRequest{
		Path:        path.Root("monitor_steps"),
		StateValue:  imported,
		ConfigValue: withUnknown,
		PlanValue:   withUnknown,
	}, resp)
	if !resp.PlanValue.Equal(withUnknown) {
		t.Fatalf("steps with a value known only at apply planned as the imported ones")
	}

	// With no import behind it, steps a configuration writes plan as written.
	resp = &planmodifier.ListResponse{PlanValue: planned}
	MonitorStepsKeepImported().PlanModifyList(ctx, planmodifier.ListRequest{
		Path:        path.Root("monitor_steps"),
		StateValue:  imported,
		ConfigValue: planned,
		PlanValue:   planned,
	}, resp)
	if !resp.PlanValue.Equal(planned) {
		t.Fatalf("with no import, the monitor steps planned as the state's")
	}
}
