package provider

/*
 * What OneUptime keeps once a monitor exists (#9985), through the
 * provider's real protocol server - the way terraform plan and terraform
 * apply drive it - against a fake OneUptime API that moves a monitor the way
 * OneUptime does on its own: a check moves its current status, an
 * evaluation moves a telemetry monitor's timestamps.
 *
 *   - current_monitor_status_id is the status the monitor is created in.
 *     After that a plan never changes it, whatever the configuration says,
 *     and no update sends it: Terraform used to set the status back to the
 *     configured one every time a check moved it.
 *   - telemetry_monitor_last_monitor_at and telemetry_monitor_next_monitor_at
 *     are read only: no configuration gives them, and their moving is never
 *     a change - let alone a replacement, which is what a configuration that
 *     gave them planned before.
 *
 * After every apply the tests check what Terraform checks: the result is
 * what the plan said for every attribute the plan knew.
 */

import (
	"context"
	"encoding/json"
	"fmt"
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
	serverOwnedAPIKey      = "server-owned-test-key"
	serverOwnedOperational = "11111111-0000-4000-8000-000000000001"
	serverOwnedOffline     = "11111111-0000-4000-8000-000000000002"
	serverOwnedDegraded    = "11111111-0000-4000-8000-000000000003"
	serverOwnedFirstRun    = "2026-11-19T10:00:00.000Z"
	serverOwnedSecondRun   = "2026-11-19T10:01:00.000Z"
	serverOwnedThirdRun    = "2026-11-19T10:02:00.000Z"
)

// serverOwnedAPI is the fake OneUptime API: the monitor endpoints.
type serverOwnedAPI struct {
	t      *testing.T
	server *httptest.Server

	mu       sync.Mutex
	monitors map[string]map[string]interface{}
	nextID   int
	creates  []map[string]interface{}
	updates  []map[string]interface{}
	// What OneUptime moves on its own while an update is being written.
	duringUpdate map[string]interface{}
	// Every flag a monitor has: OneUptime answers each, false when unset.
	flags []string
	// Every update's whole body - data, addToList, removeFromList - in order.
	updateBodies []map[string]interface{}
	// A OneUptime older than #10135: an update's addToList and
	// removeFromList are not read.
	ignoresListChanges bool
	// What a create's answer says it left out (#10136), by its header.
	createLeftOut string
	// What Terraform keeps of each monitor beside its state - the
	// provider's private state - as a state file keeps it, by the monitor's
	// ID: the harness carries it from an apply or a read to the next.
	private map[string][]byte
}

func newServerOwnedAPI(t *testing.T) *serverOwnedAPI {
	t.Helper()
	api := &serverOwnedAPI{t: t, monitors: map[string]map[string]interface{}{}, private: map[string][]byte{}}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

func (a *serverOwnedAPI) handle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("APIKey") != serverOwnedAPIKey {
		a.reply(w, http.StatusUnauthorized, map[string]interface{}{"message": "no API key"})
		return
	}
	body := map[string]interface{}{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	data, _ := body["data"].(map[string]interface{})
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/"), "/")
	if len(parts) == 0 || parts[0] != "monitor" {
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "no such endpoint: " + r.URL.Path})
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	switch {
	case r.Method == http.MethodPost && len(parts) == 1:
		a.nextID++
		id := fmt.Sprintf("5ec7e700-0000-4000-8000-%012d", a.nextID)
		monitor := map[string]interface{}{
			"_id":                     id,
			"projectId":               "5ec7e700-0000-4000-8000-0000000000aa",
			"currentMonitorStatusId":  serverOwnedOperational,
			"disableActiveMonitoring": false,
			"keepResponseContent":     true,
			"isArchived":              false,
		}
		for _, flag := range a.flags {
			if _, ok := monitor[flag]; !ok {
				monitor[flag] = false
			}
		}
		for k, v := range data {
			monitor[k] = v
		}
		if monitor["monitorType"] == "Metrics" {
			monitor["telemetryMonitorLastMonitorAt"] = serverOwnedFirstRun
			monitor["telemetryMonitorNextMonitorAt"] = serverOwnedSecondRun
		}
		a.monitors[id] = monitor
		a.creates = append(a.creates, data)
		if a.createLeftOut != "" {
			w.Header().Set("X-OneUptime-Fields-Left-Out", a.createLeftOut)
		}
		a.reply(w, http.StatusOK, monitor)
	case r.Method == http.MethodPost && len(parts) == 3 && parts[2] == "get-item":
		monitor, ok := a.monitors[parts[1]]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "not found"})
			return
		}
		a.reply(w, http.StatusOK, monitor)
	case r.Method == http.MethodPut && len(parts) == 2:
		monitor, ok := a.monitors[parts[1]]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "not found"})
			return
		}
		// An update names a list in data or entry by entry, not both (#10135).
		for _, key := range []string{"addToList", "removeFromList"} {
			lists, _ := body[key].(map[string]interface{})
			for name := range lists {
				if _, inData := data[name]; inData {
					a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": name + " is both in data and in addToList or removeFromList."})
					return
				}
			}
		}
		for k, v := range data {
			monitor[k] = v
		}
		if !a.ignoresListChanges {
			applyListChanges(monitor, body)
		}
		for k, v := range a.duringUpdate {
			monitor[k] = v
		}
		a.updates = append(a.updates, data)
		a.updateBodies = append(a.updateBodies, body)
		a.reply(w, http.StatusOK, map[string]interface{}{})
	case r.Method == http.MethodDelete && len(parts) == 2:
		delete(a.monitors, parts[1])
		a.reply(w, http.StatusOK, map[string]interface{}{})
	default:
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "no such endpoint: " + r.URL.Path})
	}
}

// applyListChanges adds an update's addToList entries to a record's lists
// and takes its removeFromList entries off them, as OneUptime's junction
// tables do: an entry added once, one taken off only if there, every other
// entry left as it is (#10135).
func applyListChanges(record map[string]interface{}, body map[string]interface{}) {
	idOf := func(entry interface{}) string {
		switch typed := entry.(type) {
		case string:
			return strings.ToLower(typed)
		case map[string]interface{}:
			id, _ := typed["_id"].(string)
			return strings.ToLower(id)
		}
		return ""
	}
	removes, _ := body["removeFromList"].(map[string]interface{})
	for name, entries := range removes {
		taken := map[string]bool{}
		for _, entry := range entries.([]interface{}) {
			taken[idOf(entry)] = true
		}
		kept := []interface{}{}
		existing, _ := record[name].([]interface{})
		for _, entry := range existing {
			if !taken[idOf(entry)] {
				kept = append(kept, entry)
			}
		}
		record[name] = kept
	}
	adds, _ := body["addToList"].(map[string]interface{})
	for name, entries := range adds {
		existing, _ := record[name].([]interface{})
		list := append([]interface{}{}, existing...)
		for _, entry := range entries.([]interface{}) {
			there := false
			for _, each := range list {
				if idOf(each) == idOf(entry) {
					there = true
				}
			}
			if !there {
				list = append(list, map[string]interface{}{"_id": idOf(entry)})
			}
		}
		record[name] = list
	}
}

func (a *serverOwnedAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// move changes a monitor the way OneUptime does on its own.
func (a *serverOwnedAPI) move(id string, values map[string]interface{}) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for k, v := range values {
		a.monitors[id][k] = v
	}
}

func (a *serverOwnedAPI) field(id, name string) interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.monitors[id][name]
}

// serverOwnedTerraform is Terraform driving the provider through its
// protocol server.
type serverOwnedTerraform struct {
	t       *testing.T
	ctx     context.Context
	api     *serverOwnedAPI
	server  tfprotov6.ProviderServer
	schemas map[string]*tfprotov6.Schema
}

func newServerOwnedTerraform(t *testing.T) *serverOwnedTerraform {
	t.Helper()
	tf := &serverOwnedTerraform{t: t, ctx: context.Background(), api: newServerOwnedAPI(t)}
	server := providerserver.NewProtocol6(New("test")())()
	schemas, err := server.GetProviderSchema(tf.ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, tf.api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, serverOwnedAPIKey),
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
	for _, attribute := range tf.schemas["oneuptime_monitor"].Block.Attributes {
		if attribute.Type != nil && attribute.Type.Is(tftypes.Bool) {
			tf.api.flags = append(tf.api.flags, apiName(attribute.Name))
		}
	}
	return tf
}

// apiName is an attribute's name in the API: is_archived is isArchived.
func apiName(attribute string) string {
	words := strings.Split(attribute, "_")
	for i := 1; i < len(words); i++ {
		if words[i] != "" {
			words[i] = strings.ToUpper(words[i][:1]) + words[i][1:]
		}
	}
	return strings.Join(words, "")
}

func (tf *serverOwnedTerraform) objectType() tftypes.Object {
	return tf.schemas["oneuptime_monitor"].ValueType().(tftypes.Object)
}

func (tf *serverOwnedTerraform) encode(value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(tf.objectType(), value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *serverOwnedTerraform) decode(value *tfprotov6.DynamicValue) tftypes.Value {
	tf.t.Helper()
	decoded, err := value.Unmarshal(tf.objectType())
	if err != nil {
		tf.t.Fatalf("decoding: %s", err)
	}
	return decoded
}

func (tf *serverOwnedTerraform) attribute(name string) *tfprotov6.SchemaAttribute {
	tf.t.Helper()
	for _, attribute := range tf.schemas["oneuptime_monitor"].Block.Attributes {
		if attribute.Name == name {
			return attribute
		}
	}
	tf.t.Fatalf("oneuptime_monitor has no attribute %s", name)
	return nil
}

func (tf *serverOwnedTerraform) config(values map[string]tftypes.Value) tftypes.Value {
	return objectWith(tf.objectType(), values)
}

// proposedNew is what Terraform proposes: the configuration, with the prior
// state's value for every computed attribute it leaves out.
func (tf *serverOwnedTerraform) proposedNew(prior, config tftypes.Value) tftypes.Value {
	if prior.IsNull() {
		return config
	}
	priorValues := attributesOf(tf.t, prior)
	proposed := map[string]tftypes.Value{}
	for name, configured := range attributesOf(tf.t, config) {
		proposed[name] = configured
		if configured.IsNull() && tf.attribute(name).Computed {
			proposed[name] = priorValues[name]
		}
	}
	return tftypes.NewValue(tf.objectType(), proposed)
}

// idOfState is a state's monitor ID, or "" for none.
func (tf *serverOwnedTerraform) idOfState(state tftypes.Value) string {
	if state.IsNull() {
		return ""
	}
	id := attributesOf(tf.t, state)["id"]
	var value string
	if id.IsNull() || !id.IsKnown() || id.As(&value) != nil {
		return ""
	}
	return value
}

// privateOf is what Terraform keeps beside a monitor's state.
func (tf *serverOwnedTerraform) privateOf(state tftypes.Value) []byte {
	tf.api.mu.Lock()
	defer tf.api.mu.Unlock()
	return tf.api.private[tf.idOfState(state)]
}

func (tf *serverOwnedTerraform) keepPrivate(state tftypes.Value, private []byte) {
	tf.api.mu.Lock()
	defer tf.api.mu.Unlock()
	if id := tf.idOfState(state); id != "" {
		tf.api.private[id] = private
	}
}

func (tf *serverOwnedTerraform) plan(prior, config tftypes.Value) (tftypes.Value, *tfprotov6.PlanResourceChangeResponse) {
	tf.t.Helper()
	planned, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         "oneuptime_monitor",
		PriorState:       tf.encode(prior),
		ProposedNewState: tf.encode(tf.proposedNew(prior, config)),
		Config:           tf.encode(config),
		PriorPrivate:     tf.privateOf(prior),
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	failOnErrors(tf.t, "planning", planned.Diagnostics)
	return tf.decode(planned.PlannedState), planned
}

// apply plans and applies, and checks the result the way Terraform does.
func (tf *serverOwnedTerraform) apply(prior, config tftypes.Value) tftypes.Value {
	tf.t.Helper()
	planned, response := tf.plan(prior, config)
	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       "oneuptime_monitor",
		PriorState:     tf.encode(prior),
		PlannedState:   response.PlannedState,
		Config:         tf.encode(config),
		PlannedPrivate: response.PlannedPrivate,
	})
	if err != nil {
		tf.t.Fatalf("ApplyResourceChange: %s", err)
	}
	failOnErrors(tf.t, "applying", applied.Diagnostics)
	state := tf.decode(applied.NewState)
	tf.keepPrivate(state, applied.Private)
	got := attributesOf(tf.t, state)
	for name, want := range attributesOf(tf.t, planned) {
		if !got[name].IsFullyKnown() {
			tf.t.Fatalf("Provider returned invalid result object after apply: .%s is unknown", name)
		}
		if want.IsKnown() && !sameToTerraform(tf.t, want, got[name]) {
			tf.t.Fatalf("Provider produced inconsistent result after apply: .%s: was %s, but now %s", name, want, got[name])
		}
	}
	return state
}

func (tf *serverOwnedTerraform) refresh(state tftypes.Value) tftypes.Value {
	tf.t.Helper()
	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     "oneuptime_monitor",
		CurrentState: tf.encode(state),
		Private:      tf.privateOf(state),
	})
	if err != nil {
		tf.t.Fatalf("ReadResource: %s", err)
	}
	failOnErrors(tf.t, "refreshing", read.Diagnostics)
	refreshed := tf.decode(read.NewState)
	tf.keepPrivate(refreshed, read.Private)
	return refreshed
}

// changes is what a plan changes, and what it replaces the monitor for.
func (tf *serverOwnedTerraform) changes(state, config tftypes.Value) ([]string, []string) {
	tf.t.Helper()
	planned, response := tf.plan(state, config)
	before := attributesOf(tf.t, state)
	changed := []string{}
	for name, value := range attributesOf(tf.t, planned) {
		if !value.IsKnown() || !sameToTerraform(tf.t, before[name], value) {
			changed = append(changed, name)
		}
	}
	replaced := []string{}
	for _, path := range response.RequiresReplace {
		replaced = append(replaced, path.String())
	}
	return changed, replaced
}

func (tf *serverOwnedTerraform) requireNoChanges(state, config tftypes.Value) {
	tf.t.Helper()
	changed, replaced := tf.changes(state, config)
	if len(changed) > 0 || len(replaced) > 0 {
		tf.t.Fatalf("the plan is not empty: it changes %v and replaces for %v", changed, replaced)
	}
}

func TestServerOwnedAttributesAreDeclaredAsOneUptimeKeepsThem(t *testing.T) {
	tf := newServerOwnedTerraform(t)

	status := tf.attribute("current_monitor_status_id")
	if !status.Optional || !status.Computed || status.Required {
		t.Errorf("current_monitor_status_id: optional %v, computed %v, required %v; want optional and computed", status.Optional, status.Computed, status.Required)
	}
	if !strings.Contains(status.Description, "the value given here is the one the record starts with") {
		t.Errorf("current_monitor_status_id does not say a configuration only starts it: %q", status.Description)
	}

	for _, name := range []string{"telemetry_monitor_last_monitor_at", "telemetry_monitor_next_monitor_at"} {
		attribute := tf.attribute(name)
		if attribute.Optional || attribute.Required || !attribute.Computed {
			t.Errorf("%s: optional %v, required %v, computed %v; want read only", name, attribute.Optional, attribute.Required, attribute.Computed)
		}
	}
}

func TestAMonitorStartsInTheConfiguredStatusAndKeepsTheOneItsChecksSet(t *testing.T) {
	tf := newServerOwnedTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(), nil)

	config := tf.config(map[string]tftypes.Value{
		"name":                      str("Homepage"),
		"monitor_type":              str("Manual"),
		"current_monitor_status_id": str(serverOwnedDegraded),
	})
	state := tf.apply(nothing, config)
	id := stringOf(t, state, "id")
	if len(tf.api.creates) != 1 || tf.api.creates[0]["currentMonitorStatusId"] != serverOwnedDegraded {
		t.Fatalf("the create did not start the monitor in the configured status: %v", tf.api.creates)
	}

	// Its checks move it, and the configuration still names the first status.
	tf.api.move(id, map[string]interface{}{"currentMonitorStatusId": serverOwnedOffline})
	state = tf.refresh(state)
	if got := stringOf(t, state, "current_monitor_status_id"); got != serverOwnedOffline {
		t.Fatalf("the refresh read the status %s, want %s", got, serverOwnedOffline)
	}
	tf.requireNoChanges(state, config)

	// A real change updates the monitor in place, without its status.
	renamed := tf.config(map[string]tftypes.Value{
		"name":                      str("Homepage (EU)"),
		"monitor_type":              str("Manual"),
		"current_monitor_status_id": str(serverOwnedDegraded),
	})
	changed, replaced := tf.changes(state, renamed)
	if len(replaced) != 0 {
		t.Fatalf("renaming plans a replacement, for %v", replaced)
	}
	if strings.Contains(strings.Join(changed, " "), "current_monitor_status_id") {
		t.Fatalf("renaming plans a change of the status too: %v", changed)
	}
	// Its check moves the status again while the update is written.
	tf.api.duringUpdate = map[string]interface{}{"currentMonitorStatusId": serverOwnedOperational}
	state = tf.apply(state, renamed)
	if len(tf.api.updates) != 1 {
		t.Fatalf("%d updates, want 1", len(tf.api.updates))
	}
	if _, sent := tf.api.updates[0]["currentMonitorStatusId"]; sent {
		t.Errorf("the update sent the status: %v", tf.api.updates[0])
	}
	if tf.api.updates[0]["name"] != "Homepage (EU)" {
		t.Errorf("the update did not send the new name: %v", tf.api.updates[0])
	}
	if got := tf.api.field(id, "currentMonitorStatusId"); got != serverOwnedOperational {
		t.Errorf("the monitor's status is %v, want the one its check set, %s", got, serverOwnedOperational)
	}

	// The next refresh reads the status the check set, and plans nothing.
	state = tf.refresh(state)
	tf.requireNoChanges(state, renamed)
}

func TestAMonitorThatLeavesItsStatusOutKeepsOneUptimes(t *testing.T) {
	tf := newServerOwnedTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(), nil)

	config := tf.config(map[string]tftypes.Value{
		"name":         str("API"),
		"monitor_type": str("Manual"),
	})
	state := tf.apply(nothing, config)
	id := stringOf(t, state, "id")
	if _, sent := tf.api.creates[0]["currentMonitorStatusId"]; sent {
		t.Errorf("the create sent a status nobody configured: %v", tf.api.creates[0])
	}
	if got := stringOf(t, state, "current_monitor_status_id"); got != serverOwnedOperational {
		t.Errorf("the state holds the status %s, want OneUptime's, %s", got, serverOwnedOperational)
	}

	tf.api.move(id, map[string]interface{}{"currentMonitorStatusId": serverOwnedOffline})
	state = tf.refresh(state)
	tf.requireNoChanges(state, config)
}

func TestATelemetryMonitorsEvaluationsAreNeverAChange(t *testing.T) {
	tf := newServerOwnedTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(), nil)

	config := tf.config(map[string]tftypes.Value{
		"name":         str("Checkout latency"),
		"monitor_type": str("Metrics"),
	})
	state := tf.apply(nothing, config)
	id := stringOf(t, state, "id")
	if got := stringOf(t, state, "telemetry_monitor_last_monitor_at"); got != serverOwnedFirstRun {
		t.Errorf("the state holds the last evaluation %s, want %s", got, serverOwnedFirstRun)
	}

	for _, run := range [][2]string{{serverOwnedSecondRun, serverOwnedThirdRun}, {serverOwnedThirdRun, "2026-11-19T10:03:00.000Z"}} {
		tf.api.move(id, map[string]interface{}{
			"telemetryMonitorLastMonitorAt": run[0],
			"telemetryMonitorNextMonitorAt": run[1],
			"currentMonitorStatusId":        serverOwnedOffline,
		})
		state = tf.refresh(state)
		if got := stringOf(t, state, "telemetry_monitor_last_monitor_at"); got != run[0] {
			t.Errorf("the refresh read the last evaluation %s, want %s", got, run[0])
		}
		tf.requireNoChanges(state, config)
	}

	// A real change goes through while an evaluation moves the timestamps.
	renamed := tf.config(map[string]tftypes.Value{
		"name":         str("Checkout latency (EU)"),
		"monitor_type": str("Metrics"),
	})
	tf.api.duringUpdate = map[string]interface{}{
		"telemetryMonitorLastMonitorAt": "2026-11-19T10:04:00.000Z",
		"telemetryMonitorNextMonitorAt": "2026-11-19T10:05:00.000Z",
	}
	state = tf.apply(state, renamed)
	for _, update := range tf.api.updates {
		for _, owned := range []string{"telemetryMonitorLastMonitorAt", "telemetryMonitorNextMonitorAt", "currentMonitorStatusId"} {
			if _, sent := update[owned]; sent {
				t.Errorf("the update sent %s: %v", owned, update)
			}
		}
	}
	state = tf.refresh(state)
	tf.requireNoChanges(state, renamed)
}
