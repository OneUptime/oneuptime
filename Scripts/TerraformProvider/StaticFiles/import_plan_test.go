package provider

/*
 * Imports that settle, through the provider's real protocol server, the way
 * terraform import and the plan after it drive it - private state included,
 * which is where an import names what it read - against a fake OneUptime API
 * that answers a record as OneUptime keeps it:
 *
 *   - a schedule layer's times in UTC with milliseconds, and its restriction
 *     times with the "weeklyRestrictionTimes": [] OneUptime fills in;
 *   - a monitor's steps with every criteria's defaults written out, the
 *     request type it defaults to, and a bare origin with its trailing slash.
 *
 * Imported into a configuration written by hand - "2030-01-01T00:00:00Z",
 * restriction times without the empty list, steps without the defaults - the
 * next plan must change nothing (it planned an update of each before). A real
 * change must still plan as one, and once an update has written an attribute
 * from the configuration, taking a key out of it is a change again.
 */

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	settleAPIKey     = "import-settle-key"
	settleProjectID  = "5e771e00-0000-4000-8000-000000000001"
	settleScheduleID = "5e771e00-0000-4000-8000-0000000000a1"
	settleLayerID    = "5e771e00-0000-4000-8000-0000000000b1"
	settleMonitorID  = "5e771e00-0000-4000-8000-0000000000c1"
	settleCreatedAt  = "2026-11-02T08:00:00.000Z"
)

// settleAPI keeps rows as OneUptime keeps them and answers them so.
type settleAPI struct {
	t      *testing.T
	server *httptest.Server

	mu      sync.Mutex
	rows    map[string]map[string]map[string]interface{}
	updates map[string][]map[string]interface{}
}

func newSettleAPI(t *testing.T) *settleAPI {
	t.Helper()
	api := &settleAPI{
		t:       t,
		rows:    map[string]map[string]map[string]interface{}{"/on-call-duty-schedule-layer": {}, "/monitor": {}},
		updates: map[string][]map[string]interface{}{},
	}

	// A layer made in the dashboard.
	api.rows["/on-call-duty-schedule-layer"][settleLayerID] = map[string]interface{}{
		"onCallDutyPolicyScheduleId": settleScheduleID,
		"name":                       "Business hours",
		"description":                "Weekdays",
		"order":                      1,
		"startsAt":                   map[string]interface{}{"_type": "DateTime", "value": "2030-01-01T00:00:00.000Z"},
		"handOffTime":                map[string]interface{}{"_type": "DateTime", "value": "2030-01-01T09:00:00.000Z"},
		"rotation": map[string]interface{}{
			"_type": "Recurring",
			"value": map[string]interface{}{
				"intervalType":  "Day",
				"intervalCount": map[string]interface{}{"_type": "PositiveNumber", "value": 1},
			},
		},
		"restrictionTimes": map[string]interface{}{
			"_type": "RestrictionTimes",
			"value": map[string]interface{}{"restictionType": "None", "weeklyRestrictionTimes": []interface{}{}},
		},
	}

	// A monitor made in the dashboard: OneUptime keeps its criteria's
	// defaults, the request type it defaults to, and a bare origin with its
	// trailing slash.
	api.rows["/monitor"][settleMonitorID] = map[string]interface{}{
		"name":                    "Storefront",
		"monitorType":             "Website",
		"isArchived":              false,
		"disableActiveMonitoring": false,
		"keepResponseContent":     true,
		"monitorSteps": monitorStepWire("https://example.com/", onlineCriteria(serverCriteriaDefaults), map[string]interface{}{
			"requestType": "GET",
		}),
	}

	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

// answer is a row as the API answers it.
func (a *settleAPI) answer(id string, row map[string]interface{}) map[string]interface{} {
	answer := map[string]interface{}{
		"_id":       id,
		"projectId": map[string]interface{}{"_type": "ObjectID", "value": settleProjectID},
		"createdAt": map[string]interface{}{"_type": "DateTime", "value": settleCreatedAt},
		"updatedAt": map[string]interface{}{"_type": "DateTime", "value": settleCreatedAt},
	}
	for key, value := range row {
		answer[key] = value
	}
	return answer
}

// keep is how OneUptime keeps what a write sends: timestamps in UTC with
// milliseconds, restriction times with every list they may hold.
func keep(key string, value interface{}) interface{} {
	switch key {
	case "startsAt", "handOffTime":
		if text, ok := value.(string); ok {
			if instant, err := parseRFC3339(text); err == nil {
				return map[string]interface{}{"_type": "DateTime", "value": instant.UTC().Format("2006-01-02T15:04:05.000Z")}
			}
		}
	case "restrictionTimes":
		if wrapper, ok := value.(map[string]interface{}); ok {
			if inner, ok := wrapper["value"].(map[string]interface{}); ok {
				if _, has := inner["weeklyRestrictionTimes"]; !has {
					inner["weeklyRestrictionTimes"] = []interface{}{}
				}
			}
		}
	}
	return value
}

func (a *settleAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	path := strings.TrimPrefix(r.URL.Path, "/api")
	if r.Header.Get("APIKey") != settleAPIKey {
		a.reply(w, http.StatusUnauthorized, map[string]interface{}{"message": "Invalid API Key"})
		return
	}

	var body map[string]interface{}
	raw, _ := io.ReadAll(r.Body)
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			a.t.Errorf("%s %s sent a body that is not JSON: %s", r.Method, path, err)
		}
	}

	for table, rows := range a.rows {
		if !strings.HasPrefix(path, table+"/") {
			continue
		}
		rest := strings.TrimPrefix(path, table+"/")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
			id := strings.TrimSuffix(rest, "/get-item")
			row, ok := rows[id]
			if !ok {
				a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
				return
			}
			a.reply(w, http.StatusOK, map[string]interface{}{"data": a.answer(id, row)})
		case r.Method == http.MethodPut:
			row, ok := rows[rest]
			if !ok {
				a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
				return
			}
			data, _ := body["data"].(map[string]interface{})
			a.updates[table] = append(a.updates[table], data)
			for key, value := range data {
				row[key] = keep(key, value)
			}
			a.reply(w, http.StatusOK, map[string]interface{}{})
		default:
			a.t.Errorf("unexpected request: %s %s", r.Method, path)
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
		}
		return
	}

	a.t.Errorf("unexpected request: %s %s", r.Method, path)
	a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
}

func (a *settleAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

func (a *settleAPI) updatesOf(table string) []map[string]interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]map[string]interface{}(nil), a.updates[table]...)
}

// settleTerraform drives the provider as terraform import, plan and apply
// do, carrying each resource's private state from one call to the next.
type settleTerraform struct {
	t       *testing.T
	ctx     context.Context
	api     *settleAPI
	server  tfprotov6.ProviderServer
	schemas map[string]*tfprotov6.Schema
}

// settled is a resource's state and the private state beside it.
type settled struct {
	state   tftypes.Value
	private []byte
}

func newSettleTerraform(t *testing.T) *settleTerraform {
	t.Helper()
	tf := &settleTerraform{t: t, ctx: context.Background(), api: newSettleAPI(t)}
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(tf.ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, tf.api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, settleAPIKey),
	}))
	if err != nil {
		t.Fatalf("encoding the provider configuration: %s", err)
	}
	configured, err := server.ConfigureProvider(tf.ctx, &tfprotov6.ConfigureProviderRequest{TerraformVersion: "1.9.8", Config: &providerConfig})
	if err != nil {
		t.Fatalf("ConfigureProvider: %s", err)
	}
	failOnErrors(t, "configuring the provider", configured.Diagnostics)

	tf.server = server
	tf.schemas = schemas.ResourceSchemas
	return tf
}

func (tf *settleTerraform) objectType(typeName string) tftypes.Object {
	tf.t.Helper()
	schema := tf.schemas[typeName]
	if schema == nil {
		tf.t.Fatalf("the provider has no resource %s", typeName)
	}
	return schema.ValueType().(tftypes.Object)
}

func (tf *settleTerraform) encode(typeName string, value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(tf.objectType(typeName), value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *settleTerraform) decode(typeName string, value *tfprotov6.DynamicValue) tftypes.Value {
	tf.t.Helper()
	if value == nil {
		tf.t.Fatalf("the provider returned no value")
	}
	decoded, err := value.Unmarshal(tf.objectType(typeName))
	if err != nil {
		tf.t.Fatalf("decoding: %s", err)
	}
	return decoded
}

// importResource is terraform import: the import, then the read after it.
func (tf *settleTerraform) importResource(typeName, id string) settled {
	tf.t.Helper()
	imported, err := tf.server.ImportResourceState(tf.ctx, &tfprotov6.ImportResourceStateRequest{TypeName: typeName, ID: id})
	if err != nil {
		tf.t.Fatalf("ImportResourceState: %s", err)
	}
	failOnErrors(tf.t, "importing "+typeName, imported.Diagnostics)
	if len(imported.ImportedResources) != 1 {
		tf.t.Fatalf("importing %s gave %d resources", id, len(imported.ImportedResources))
	}

	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     typeName,
		CurrentState: imported.ImportedResources[0].State,
		Private:      imported.ImportedResources[0].Private,
	})
	if err != nil {
		tf.t.Fatalf("ReadResource: %s", err)
	}
	failOnErrors(tf.t, "reading "+typeName+" after the import", read.Diagnostics)
	return settled{state: tf.decode(typeName, read.NewState), private: read.Private}
}

func (tf *settleTerraform) isComputed(typeName string, name string) bool {
	for _, attribute := range tf.schemas[typeName].Block.Attributes {
		if attribute.Name == name {
			return attribute.Computed
		}
	}
	tf.t.Fatalf("%s has no attribute %s", typeName, name)
	return false
}

// proposedNew is what Terraform proposes: the configuration, with the prior
// state's value for every computed attribute it leaves out.
func (tf *settleTerraform) proposedNew(typeName string, prior, config tftypes.Value) tftypes.Value {
	priorValues := attributesOf(tf.t, prior)
	proposed := map[string]tftypes.Value{}
	for name, configured := range attributesOf(tf.t, config) {
		proposed[name] = configured
		if configured.IsNull() && tf.isComputed(typeName, name) {
			proposed[name] = priorValues[name]
		}
	}
	return tftypes.NewValue(tf.objectType(typeName), proposed)
}

func (tf *settleTerraform) plan(typeName string, prior settled, config tftypes.Value) *tfprotov6.PlanResourceChangeResponse {
	tf.t.Helper()
	planned, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         typeName,
		PriorState:       tf.encode(typeName, prior.state),
		ProposedNewState: tf.encode(typeName, tf.proposedNew(typeName, prior.state, config)),
		Config:           tf.encode(typeName, config),
		PriorPrivate:     prior.private,
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	failOnErrors(tf.t, "planning "+typeName, planned.Diagnostics)
	return planned
}

// changes is what Terraform would show for the plan: each attribute the
// plan sets to anything but its value in state, unknown ones included.
func (tf *settleTerraform) changes(typeName string, prior settled, config tftypes.Value) []string {
	tf.t.Helper()
	response := tf.plan(typeName, prior, config)
	planned := attributesOf(tf.t, tf.decode(typeName, response.PlannedState))
	before := attributesOf(tf.t, prior.state)
	changed := []string{}
	for name, value := range planned {
		if !value.IsKnown() || !sameToTerraform(tf.t, before[name], value) {
			changed = append(changed, name)
		}
	}
	for _, path := range response.RequiresReplace {
		changed = append(changed, "replace "+path.String())
	}
	return changed
}

func (tf *settleTerraform) requireNoChanges(typeName string, prior settled, config tftypes.Value) {
	tf.t.Helper()
	if changed := tf.changes(typeName, prior, config); len(changed) > 0 {
		tf.t.Fatalf("the plan after the import of %s changes %v", typeName, changed)
	}
}

// apply plans and applies, and checks the result as Terraform does: every
// attribute the plan knew is what it said.
func (tf *settleTerraform) apply(typeName string, prior settled, config tftypes.Value) settled {
	tf.t.Helper()
	planResponse := tf.plan(typeName, prior, config)
	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       typeName,
		PriorState:     tf.encode(typeName, prior.state),
		PlannedState:   planResponse.PlannedState,
		Config:         tf.encode(typeName, config),
		PlannedPrivate: planResponse.PlannedPrivate,
	})
	if err != nil {
		tf.t.Fatalf("ApplyResourceChange: %s", err)
	}
	failOnErrors(tf.t, "applying "+typeName, applied.Diagnostics)

	planned := attributesOf(tf.t, tf.decode(typeName, planResponse.PlannedState))
	state := tf.decode(typeName, applied.NewState)
	got := attributesOf(tf.t, state)
	for name, want := range planned {
		if want.IsKnown() && !sameToTerraform(tf.t, want, got[name]) {
			tf.t.Fatalf("Provider produced inconsistent result after apply: .%s: was %s, but now %s", name, want, got[name])
		}
	}
	return settled{state: state, private: applied.Private}
}

func (tf *settleTerraform) layerConfig(values map[string]tftypes.Value) tftypes.Value {
	written := map[string]tftypes.Value{
		"on_call_duty_policy_schedule_id": tftypes.NewValue(tftypes.String, settleScheduleID),
		"name":                            tftypes.NewValue(tftypes.String, "Business hours"),
		"description":                     tftypes.NewValue(tftypes.String, "Weekdays"),
		"order":                           tftypes.NewValue(tftypes.Number, configNumberValue(tf.t, "1")),
		// How a configuration writes them: no milliseconds.
		"starts_at":     tftypes.NewValue(tftypes.String, "2030-01-01T00:00:00Z"),
		"hand_off_time": tftypes.NewValue(tftypes.String, "2030-01-01T09:00:00Z"),
		// jsonencode() of what the configuration writes: keys sorted, and no
		// weeklyRestrictionTimes, which OneUptime fills in.
		"rotation":          tftypes.NewValue(tftypes.String, `{"_type":"Recurring","value":{"intervalCount":{"_type":"PositiveNumber","value":1},"intervalType":"Day"}}`),
		"restriction_times": tftypes.NewValue(tftypes.String, `{"_type":"RestrictionTimes","value":{"restictionType":"None"}}`),
	}
	for name, value := range values {
		written[name] = value
	}
	return objectWith(tf.objectType("oneuptime_on_call_schedule_layer"), written)
}

func configNumberValue(t *testing.T, text string) interface{} {
	t.Helper()
	number, ok := parseAPINumberText(text)
	if !ok {
		t.Fatalf("%q is not a number", text)
	}
	return number
}

func TestImportedScheduleLayerPlansNoChangesForAHandWrittenConfiguration(t *testing.T) {
	tf := newSettleTerraform(t)
	layer := tf.importResource("oneuptime_on_call_schedule_layer", settleLayerID)

	// The import reads what OneUptime keeps.
	values := attributesOf(t, layer.state)
	if got := settledString(t, values["starts_at"]); got != "2030-01-01T00:00:00.000Z" {
		t.Fatalf("the import read starts_at %s", got)
	}
	if got := settledString(t, values["restriction_times"]); !strings.Contains(got, "weeklyRestrictionTimes") {
		t.Fatalf("the import read restriction_times %s", got)
	}
	if got := importedAttributes(t, layer.private); len(got) != 2 || got[0] != "restriction_times" || got[1] != "rotation" {
		t.Fatalf("the import named %v in the private state, want [restriction_times rotation]", got)
	}

	tf.requireNoChanges("oneuptime_on_call_schedule_layer", layer, tf.layerConfig(nil))
}

func TestImportedScheduleLayerStillPlansARealChange(t *testing.T) {
	tf := newSettleTerraform(t)
	layer := tf.importResource("oneuptime_on_call_schedule_layer", settleLayerID)

	for _, tc := range []struct {
		attribute string
		value     tftypes.Value
	}{
		{"starts_at", tftypes.NewValue(tftypes.String, "2030-01-01T00:00:01Z")},
		{"restriction_times", tftypes.NewValue(tftypes.String, `{"_type":"RestrictionTimes","value":{"restictionType":"Daily"}}`)},
		{"rotation", tftypes.NewValue(tftypes.String, `{"_type":"Recurring","value":{"intervalCount":{"_type":"PositiveNumber","value":2},"intervalType":"Day"}}`)},
		{"order", tftypes.NewValue(tftypes.Number, configNumberValue(t, "2"))},
		{"name", tftypes.NewValue(tftypes.String, "Nights")},
	} {
		changed := tf.changes("oneuptime_on_call_schedule_layer", layer, tf.layerConfig(map[string]tftypes.Value{tc.attribute: tc.value}))
		found := false
		for _, name := range changed {
			if name == tc.attribute {
				found = true
			}
		}
		if !found {
			t.Errorf("changing %s after the import plans changes to %v only", tc.attribute, changed)
		}
	}
}

func TestAnUpdateAfterAnImportWritesWhatTheConfigurationSays(t *testing.T) {
	tf := newSettleTerraform(t)
	layer := tf.importResource("oneuptime_on_call_schedule_layer", settleLayerID)

	// The first change after the import: a new name and new restriction times.
	daily := `{"_type":"RestrictionTimes","value":{"restictionType":"Daily"}}`
	config := tf.layerConfig(map[string]tftypes.Value{
		"name":              tftypes.NewValue(tftypes.String, "Daytime"),
		"restriction_times": tftypes.NewValue(tftypes.String, daily),
	})
	layer = tf.apply("oneuptime_on_call_schedule_layer", layer, config)

	updates := tf.api.updatesOf("/on-call-duty-schedule-layer")
	if len(updates) != 1 {
		t.Fatalf("the update sent %d requests, want 1", len(updates))
	}
	// Only what changed is sent: not the timestamps an import read with
	// milliseconds, nor the rotation it kept as OneUptime has it.
	for _, unchanged := range []string{"startsAt", "handOffTime", "rotation", "order"} {
		if _, sent := updates[0][unchanged]; sent {
			t.Errorf("the update sent %s, which did not change", unchanged)
		}
	}
	if _, sent := updates[0]["restrictionTimes"]; !sent {
		t.Fatalf("the update did not send the new restriction times")
	}

	// Its restriction times are what the configuration says now: the next
	// plan of the same configuration changes nothing...
	tf.requireNoChanges("oneuptime_on_call_schedule_layer", layer, config)
	if got := importedAttributes(t, layer.private); len(got) != 1 || got[0] != "rotation" {
		t.Fatalf("after the update wrote restriction_times and not the rotation, the private state names %v, want [rotation]", got)
	}

	// Taking a key out of the restriction times the update wrote is a change
	// again, as it is for any resource Terraform wrote.
	withKey := tf.layerConfig(map[string]tftypes.Value{
		"name":              tftypes.NewValue(tftypes.String, "Daytime"),
		"restriction_times": tftypes.NewValue(tftypes.String, `{"_type":"RestrictionTimes","value":{"restictionType":"Daily","dayRestrictionTimes":{"startTime":null}}}`),
	})
	layer = tf.apply("oneuptime_on_call_schedule_layer", layer, withKey)
	changed := tf.changes("oneuptime_on_call_schedule_layer", layer, config)
	found := false
	for _, name := range changed {
		if name == "restriction_times" {
			found = true
		}
	}
	if !found {
		t.Fatalf("taking dayRestrictionTimes out of the restriction times an update wrote plans changes to %v only", changed)
	}
}

func TestImportedMonitorPlansNoChangesForHandWrittenSteps(t *testing.T) {
	tf := newSettleTerraform(t)
	monitor := tf.importResource("oneuptime_monitor", settleMonitorID)

	objectType := tf.objectType("oneuptime_monitor")
	stepsType := objectType.AttributeTypes["monitor_steps"]

	// The steps as a configuration writes them: no defaults, no trailing
	// slash, no request type.
	written, diags := MonitorStepsFromAPI(tf.ctx, monitorStepWire("https://example.com", onlineCriteria(nil), nil))
	if diags.HasError() {
		t.Fatalf("building the configuration's steps: %v", diags)
	}
	steps, err := written.ToTerraformValue(tf.ctx)
	if err != nil {
		t.Fatalf("encoding the steps: %s", err)
	}
	if !steps.Type().Equal(stepsType) {
		t.Fatalf("the steps are a %s, the schema's a %s", steps.Type(), stepsType)
	}

	config := objectWith(objectType, map[string]tftypes.Value{
		"name":          tftypes.NewValue(tftypes.String, "Storefront"),
		"monitor_type":  tftypes.NewValue(tftypes.String, "Website"),
		"monitor_steps": steps,
	})
	tf.requireNoChanges("oneuptime_monitor", monitor, config)

	// Another destination is still a change.
	moved, diags := MonitorStepsFromAPI(tf.ctx, monitorStepWire("https://example.org", onlineCriteria(nil), nil))
	if diags.HasError() {
		t.Fatalf("building the moved steps: %v", diags)
	}
	movedSteps, err := moved.ToTerraformValue(tf.ctx)
	if err != nil {
		t.Fatalf("encoding the moved steps: %s", err)
	}
	changed := tf.changes("oneuptime_monitor", monitor, objectWith(objectType, map[string]tftypes.Value{
		"name":          tftypes.NewValue(tftypes.String, "Storefront"),
		"monitor_type":  tftypes.NewValue(tftypes.String, "Website"),
		"monitor_steps": movedSteps,
	}))
	found := false
	for _, name := range changed {
		if name == "monitor_steps" {
			found = true
		}
	}
	if !found {
		t.Fatalf("another destination after the import plans changes to %v only", changed)
	}
}

func settledString(t *testing.T, value tftypes.Value) string {
	t.Helper()
	var text string
	if err := value.As(&text); err != nil {
		t.Fatalf("reading %s: %s", value, err)
	}
	return text
}

// importedAttributes is what the private state the framework hands Terraform
// says still holds what an import read.
func importedAttributes(t *testing.T, private []byte) []string {
	t.Helper()
	if len(private) == 0 {
		return nil
	}
	keys := map[string][]byte{}
	if err := json.Unmarshal(private, &keys); err != nil {
		t.Fatalf("reading the private state %s: %s", private, err)
	}
	value, ok := keys[importedFromServerKey]
	if !ok {
		return nil
	}
	var attributes []string
	if err := json.Unmarshal(value, &attributes); err != nil {
		t.Fatalf("reading %s: %s", value, err)
	}
	return attributes
}
