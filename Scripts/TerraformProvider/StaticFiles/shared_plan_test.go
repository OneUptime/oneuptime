package provider

/*
 * What people and OneUptime both change (#10052), through the provider's
 * real protocol server - the way terraform plan and terraform apply drive
 * it, and the way the Crossplane provider drives it in process - against
 * the fake OneUptime API of serverowned_plan_test.go, with a monitor's
 * labels: a label rule adds its labels to a monitor on its own (the test
 * does as the rule does, adding one to the record).
 *
 *   - Left out of the configuration, the monitor keeps every label it has,
 *     under Terraform and under Crossplane.
 *   - Under Terraform, configured labels are the configuration's own
 *     entries (#10134, entries.go): the rule's label stays, and the plan
 *     never shows it going; entries_plan_test.go has the rest, and
 *     exclusive_lists, which holds them as earlier versions did.
 *   - Under Crossplane, the manifest's labels are held entry by entry: the
 *     rule's label stays, a label the manifest adds is added beside it, and
 *     one taken out of the manifest goes - by what the manifest last
 *     applied, which the Crossplane provider hands over (LastApplied). An
 *     update sends the labels it adds and takes off, not the whole list
 *     (#10135).
 */

import (
	"sort"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// sharedTerraform is serverOwnedTerraform's harness against `api` (a new
// one when nil), its provider Terraform's (lastApplied nil) or the one a
// Crossplane reconcile makes, given what its manifest last applied.
func sharedTerraform(t *testing.T, api *serverOwnedAPI, lastApplied *LastApplied) *serverOwnedTerraform {
	t.Helper()
	tf := newServerOwnedTerraform(t)
	if api != nil {
		tf.api = api
	}
	newProvider := New("test")
	if lastApplied != nil {
		newProvider = NewUnderCrossplane("test", *lastApplied)
	}
	server := providerserver.NewProtocol6(newProvider())()
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
	return tf
}

func recordedLabels(labels ...string) *LastApplied {
	fields := map[string]any{}
	if labels != nil {
		entries := []any{}
		for _, label := range labels {
			entries = append(entries, label)
		}
		fields["labels"] = entries
	}
	return &LastApplied{Recorded: true, Fields: fields}
}

// labelIDsOf is what the record has: the IDs of its labels, in order.
func labelIDsOf(t *testing.T, api *serverOwnedAPI, id string) string {
	t.Helper()
	items, _ := api.field(id, "labels").([]interface{})
	ids := []string{}
	for _, item := range items {
		switch typed := item.(type) {
		case map[string]interface{}:
			if value, ok := typed["_id"].(string); ok {
				ids = append(ids, value)
			}
		case string:
			ids = append(ids, typed)
		}
	}
	sort.Strings(ids)
	return strings.Join(ids, ",")
}

// sentLabels is what an update sent of the labels, in order.
func sentLabels(update map[string]interface{}) (string, bool) {
	items, sent := update["labels"].([]interface{})
	ids := []string{}
	for _, item := range items {
		if value, ok := item.(map[string]interface{})["_id"].(string); ok {
			ids = append(ids, value)
		}
	}
	sort.Strings(ids)
	return strings.Join(ids, ","), sent
}

func joinedIDs(ids ...string) string {
	return strings.Join(sortedIDs(ids...), ",")
}

// addedByRule adds a label to a monitor the way a label rule does.
func addedByRule(api *serverOwnedAPI, id string, labelID string) {
	items, _ := api.field(id, "labels").([]interface{})
	items = append(append([]interface{}{}, items...), map[string]interface{}{"_id": labelID})
	api.move(id, map[string]interface{}{"labels": items})
}

func labelledMonitor(tf *serverOwnedTerraform, labels ...string) tftypes.Value {
	values := map[string]tftypes.Value{
		"name":         str("Homepage"),
		"monitor_type": str("Manual"),
	}
	if labels != nil {
		values["labels"] = stringSet(labels...)
	}
	return tf.config(values)
}

// createLabelled creates a monitor with `labels`, as a create sends them
// under Terraform or under Crossplane alike, and has a rule add its label.
func createLabelled(t *testing.T, labels ...string) (*serverOwnedAPI, tftypes.Value, string) {
	t.Helper()
	tf := sharedTerraform(t, nil, nil)
	state := tf.apply(tftypes.NewValue(tf.objectType(), nil), labelledMonitor(tf, labels...))
	id := stringOf(t, state, "id")
	if len(labels) > 0 {
		sent, _ := sentLabels(tf.api.creates[0])
		if sent != joinedIDs(labels...) {
			t.Fatalf("the create sent labels %s, want %s", sent, joinedIDs(labels...))
		}
	}
	addedByRule(tf.api, id, labelByRule)
	return tf.api, state, id
}

func TestAMonitorsLabelsArePeoplesAndOneUptimesBoth(t *testing.T) {
	tf := newServerOwnedTerraform(t)
	labels := tf.attribute("labels")
	if !labels.Optional || !labels.Computed || labels.Required {
		t.Fatalf("labels: optional %v, computed %v, required %v; want optional and computed", labels.Optional, labels.Computed, labels.Required)
	}
	if !strings.Contains(labels.Description, "OneUptime changes it too") {
		t.Errorf("labels does not say OneUptime changes them too: %q", labels.Description)
	}
}

func TestUnderTerraformAMonitorThatLeavesItsLabelsOutKeepsTheRulesLabels(t *testing.T) {
	runUnderTerraform(t)
	api, state, _ := createLabelled(t)
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)
	tf.requireNoChanges(state, labelledMonitor(tf))
}

func TestUnderTerraformConfiguredLabelsAreTheConfigurationsOwnEntries(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t, labelProduction)
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)
	config := labelledMonitor(tf, labelProduction)

	// The plan holds the configuration's label, and the rule's is no change.
	planned, response := tf.plan(state, config)
	if len(response.RequiresReplace) != 0 {
		t.Fatalf("the plan replaces the monitor for %v", response.RequiresReplace)
	}
	if got := strings.Join(idsIn(t, attributesOf(t, planned)["labels"]), ","); got != labelProduction {
		t.Fatalf("the plan keeps labels %s, want the configuration's %s", got, labelProduction)
	}
	tf.requireNoChanges(state, config)
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the monitor has %s, want the configuration's label and the rule's", got)
	}
}

func TestUnderCrossplaneAMonitorThatLeavesItsLabelsOutKeepsTheRulesLabels(t *testing.T) {
	runUnderCrossplane(t)
	api, state, id := createLabelled(t)
	tf := sharedTerraform(t, api, recordedLabels())
	state = tf.refresh(state)
	tf.requireNoChanges(state, labelledMonitor(tf))
	if got := labelIDsOf(t, tf.api, id); got != labelByRule {
		t.Fatalf("the monitor has %s, want the rule's label", got)
	}
}

func TestUnderCrossplaneTheRulesLabelStaysBesideTheManifests(t *testing.T) {
	runUnderCrossplane(t)
	api, state, id := createLabelled(t, labelProduction)
	tf := sharedTerraform(t, api, recordedLabels(labelProduction))
	state = tf.refresh(state)
	tf.requireNoChanges(state, labelledMonitor(tf, labelProduction))
	if len(tf.api.updates) != 0 {
		t.Fatalf("the provider took the rule's label off: %v", tf.api.updates)
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the monitor has %s", got)
	}
}

func TestUnderCrossplaneALabelTheManifestAddsJoinsTheRules(t *testing.T) {
	runUnderCrossplane(t)
	api, state, id := createLabelled(t, labelProduction)
	tf := sharedTerraform(t, api, recordedLabels(labelProduction))
	state = tf.refresh(state)
	state = tf.apply(state, labelledMonitor(tf, labelProduction, labelTeamA))

	if len(tf.api.updates) != 1 {
		t.Fatalf("%d updates, want 1", len(tf.api.updates))
	}
	// The label the manifest adds, alone: never the whole list (#10135).
	if sent, ok := sentLabels(tf.api.updates[0]); ok {
		t.Fatalf("the update sent the labels whole: %s", sent)
	}
	if added, removed := sentEntries(tf.api.updateBodies[0], "labels"); added != labelTeamA || removed != "" {
		t.Fatalf("the update added %q and took off %q, want %s added alone", added, removed, labelTeamA)
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelTeamA, labelByRule) {
		t.Fatalf("the monitor has %s", got)
	}

	// The next reconcile, with the change recorded: nothing to do.
	next := sharedTerraform(t, tf.api, recordedLabels(labelProduction, labelTeamA))
	state = next.refresh(state)
	next.requireNoChanges(state, labelledMonitor(next, labelProduction, labelTeamA))
}

func TestUnderCrossplaneALabelTakenOutOfTheManifestGoesAndTheRulesStays(t *testing.T) {
	runUnderCrossplane(t)
	api, state, id := createLabelled(t, labelProduction, labelOld)
	tf := sharedTerraform(t, api, recordedLabels(labelProduction, labelOld))
	state = tf.refresh(state)
	tf.apply(state, labelledMonitor(tf, labelProduction))

	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the monitor has %s, want the manifest's and the rule's", got)
	}
}

func TestUnderCrossplaneADeclaredLabelSomeoneTookOffIsPutBack(t *testing.T) {
	runUnderCrossplane(t)
	api, state, id := createLabelled(t, labelProduction, labelTeamA)
	api.move(id, map[string]interface{}{"labels": []interface{}{
		map[string]interface{}{"_id": labelProduction},
		map[string]interface{}{"_id": labelByRule},
	}})
	tf := sharedTerraform(t, api, recordedLabels(labelProduction, labelTeamA))
	state = tf.refresh(state)
	tf.apply(state, labelledMonitor(tf, labelProduction, labelTeamA))

	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelTeamA, labelByRule) {
		t.Fatalf("the monitor has %s, want every declared label back, and the rule's", got)
	}
}

func TestUnderCrossplaneAManifestAnEarlierVersionFilledTakesNoLabelOff(t *testing.T) {
	runUnderCrossplane(t)
	api, state, id := createLabelled(t, labelProduction, labelOld)

	// Nothing recorded of the lists: the manifest may hold what an earlier
	// version's late initialization copied into it.
	tf := sharedTerraform(t, api, recordedLabels())
	state = tf.refresh(state)
	tf.requireNoChanges(state, labelledMonitor(tf, labelProduction))
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelOld, labelByRule) {
		t.Fatalf("the monitor has %s, want every label it had", got)
	}
}
