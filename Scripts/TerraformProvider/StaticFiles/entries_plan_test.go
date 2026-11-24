package provider

/*
 * A monitor's labels under Terraform (#10134, #10135), through the
 * provider's real protocol server - the way terraform plan, apply and
 * import drive it - against the fake OneUptime API of
 * serverowned_plan_test.go, whose updates add and take off single entries
 * as OneUptime's do. A label rule adds its label to the monitor on its own
 * (addedByRule).
 *
 *   - A configuration that lists labels manages those labels: the rule's
 *     stays, and is never shown as a change; a label it adds is added, one
 *     it takes out is taken off, one someone took off is put back.
 *   - An update sends the labels it adds and takes off, never the whole
 *     list, so a label a rule adds between the read and the update stays.
 *   - Left out, the labels are OneUptime's; an import adopts the record's.
 *   - exclusive_lists = true holds them as earlier versions did: the
 *     configuration's list is the monitor's whole list.
 *   - A create's answer that names fields it left out is a warning (#10136).
 */

import (
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	labelAddedJustNow = "1abe1000-0000-4000-8000-000000000005"
	labelSomeoneAdded = "1abe1000-0000-4000-8000-000000000006"
)

// exclusiveTerraform is the harness against `api`, its provider configured
// with exclusive_lists = true.
func exclusiveTerraform(t *testing.T, api *serverOwnedAPI) *serverOwnedTerraform {
	t.Helper()
	tf := newServerOwnedTerraform(t)
	if api != nil {
		tf.api = api
	}
	server := providerserver.NewProtocol6(New("test")())()
	schemas, err := server.GetProviderSchema(tf.ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url":   tftypes.NewValue(tftypes.String, tf.api.server.URL),
		"api_key":         tftypes.NewValue(tftypes.String, serverOwnedAPIKey),
		"exclusive_lists": tftypes.NewValue(tftypes.Bool, true),
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

// importMonitor imports a monitor by its ID, and reads it, as terraform
// import and an import block do.
func (tf *serverOwnedTerraform) importMonitor(id string) tftypes.Value {
	tf.t.Helper()
	imported, err := tf.server.ImportResourceState(tf.ctx, &tfprotov6.ImportResourceStateRequest{
		TypeName: "oneuptime_monitor",
		ID:       id,
	})
	if err != nil {
		tf.t.Fatalf("ImportResourceState: %s", err)
	}
	failOnErrors(tf.t, "importing", imported.Diagnostics)
	if len(imported.ImportedResources) != 1 {
		tf.t.Fatalf("%d resources imported, want 1", len(imported.ImportedResources))
	}
	state := tf.decode(imported.ImportedResources[0].State)
	tf.keepPrivate(state, imported.ImportedResources[0].Private)
	return tf.refresh(state)
}

// applyFor plans and applies, and answers the apply's diagnostics: for an
// apply that warns or fails.
func (tf *serverOwnedTerraform) applyFor(prior, config tftypes.Value) []*tfprotov6.Diagnostic {
	tf.t.Helper()
	_, response := tf.plan(prior, config)
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
	return applied.Diagnostics
}

// plansLabels says a plan changes the labels, to `labels`, and replaces
// nothing: every attribute OneUptime sets is known after the apply too.
func (tf *serverOwnedTerraform) plansLabels(state, config tftypes.Value, labels string) {
	tf.t.Helper()
	changed, replaced := tf.changes(state, config)
	if len(replaced) != 0 {
		tf.t.Fatalf("the plan replaces the monitor for %v", replaced)
	}
	if !strings.Contains(" "+strings.Join(changed, " ")+" ", " labels ") {
		tf.t.Fatalf("the plan changes %v, not the labels", changed)
	}
	planned, _ := tf.plan(state, config)
	if got := labelsInState(tf.t, planned); got != labels {
		tf.t.Fatalf("the plan holds labels %s, want %s", got, labels)
	}
}

// labelsInState is the state's labels, sorted and joined; "null" for none.
func labelsInState(t *testing.T, state tftypes.Value) string {
	t.Helper()
	labels := attributesOf(t, state)["labels"]
	if labels.IsNull() {
		return "null"
	}
	return strings.Join(sortedIDs(idsIn(t, labels)...), ",")
}

// sentEntries is what an update sent of a list entry by entry: the
// entries it added, and the ones it took off, each sorted and joined.
func sentEntries(body map[string]interface{}, list string) (string, string) {
	joined := func(key string) string {
		lists, _ := body[key].(map[string]interface{})
		entries, _ := lists[list].([]interface{})
		ids := []string{}
		for _, entry := range entries {
			if id, ok := entry.(string); ok {
				ids = append(ids, id)
			}
		}
		return strings.Join(sortedIDs(ids...), ",")
	}
	return joined("addToList"), joined("removeFromList")
}

func TestUnderTerraformAConfigurationThatListsLabelsKeepsTheRulesLabel(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t, labelProduction)
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)

	if got := labelsInState(t, state); got != labelProduction {
		t.Fatalf("the state holds %s, want the configuration's label alone", got)
	}
	tf.requireNoChanges(state, labelledMonitor(tf, labelProduction))

	// A change of something else sends no label, and the rule's stays.
	renamed := tf.config(map[string]tftypes.Value{
		"name":         str("Homepage (EU)"),
		"monitor_type": str("Manual"),
		"labels":       stringSet(labelProduction),
	})
	state = tf.apply(state, renamed)
	for _, body := range tf.api.updateBodies {
		if _, sent := body["addToList"]; sent {
			t.Fatalf("renaming sent labels: %v", body)
		}
		if _, sent := body["data"].(map[string]interface{})["labels"]; sent {
			t.Fatalf("renaming sent the labels whole: %v", body)
		}
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the monitor has %s, want its label and the rule's", got)
	}
	tf.requireNoChanges(tf.refresh(state), renamed)
}

func TestUnderTerraformALabelTheConfigurationAddsIsAddedAloneAndTheRulesStays(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t, labelProduction)
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)

	config := labelledMonitor(tf, labelProduction, labelTeamA)
	tf.plansLabels(state, config, joinedIDs(labelProduction, labelTeamA))
	state = tf.apply(state, config)

	if len(tf.api.updateBodies) != 1 {
		t.Fatalf("%d updates, want 1", len(tf.api.updateBodies))
	}
	added, removed := sentEntries(tf.api.updateBodies[0], "labels")
	if added != labelTeamA || removed != "" {
		t.Fatalf("the update added %q and took off %q, want only %s added", added, removed, labelTeamA)
	}
	if _, sent := tf.api.updateBodies[0]["data"].(map[string]interface{})["labels"]; sent {
		t.Fatalf("the update sent the labels whole: %v", tf.api.updateBodies[0])
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelTeamA, labelByRule) {
		t.Fatalf("the monitor has %s", got)
	}
	if got := labelsInState(t, state); got != joinedIDs(labelProduction, labelTeamA) {
		t.Fatalf("the state holds %s, want the configuration's", got)
	}
	tf.requireNoChanges(tf.refresh(state), config)
}

func TestUnderTerraformALabelTakenOutOfTheConfigurationGoesAndTheRulesStays(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t, labelProduction, labelOld)
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)

	config := labelledMonitor(tf, labelProduction)
	state = tf.apply(state, config)

	added, removed := sentEntries(tf.api.updateBodies[0], "labels")
	if added != "" || removed != labelOld {
		t.Fatalf("the update added %q and took off %q, want only %s taken off", added, removed, labelOld)
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the monitor has %s, want the configuration's and the rule's", got)
	}
	tf.requireNoChanges(tf.refresh(state), config)
}

func TestUnderTerraformAnEmptyListTakesOffEveryLabelTheConfigurationDeclared(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t, labelProduction)
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)

	tf.apply(state, labelledMonitor(tf, []string{}...))

	if got := labelIDsOf(t, tf.api, id); got != labelByRule {
		t.Fatalf("the monitor has %s, want the rule's label alone", got)
	}
}

func TestUnderTerraformADeclaredLabelSomeoneTookOffIsPutBack(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t, labelProduction, labelTeamA)
	api.move(id, map[string]interface{}{"labels": []interface{}{
		map[string]interface{}{"_id": labelProduction},
		map[string]interface{}{"_id": labelByRule},
	}})
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)
	if got := labelsInState(t, state); got != labelProduction {
		t.Fatalf("the refresh holds %s, want the declared label the monitor still has", got)
	}

	config := labelledMonitor(tf, labelProduction, labelTeamA)
	state = tf.apply(state, config)

	added, _ := sentEntries(tf.api.updateBodies[0], "labels")
	if added != labelTeamA {
		t.Fatalf("the update added %q, want %s put back", added, labelTeamA)
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelTeamA, labelByRule) {
		t.Fatalf("the monitor has %s", got)
	}
	tf.requireNoChanges(tf.refresh(state), config)
}

func TestUnderTerraformALabelARuleAddsWhileTheUpdateRunsStays(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t, labelProduction)
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)

	// The rule adds a label after the refresh read the monitor.
	addedByRule(tf.api, id, labelAddedJustNow)
	tf.apply(state, labelledMonitor(tf, labelProduction, labelTeamA))

	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelTeamA, labelByRule, labelAddedJustNow) {
		t.Fatalf("the monitor has %s, want the rule's label added just now kept", got)
	}
}

func TestUnderTerraformLabelsLeftOutAreOneUptimesAndAFirstDeclarationAddsOnly(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t)
	if got := labelsInState(t, state); got != "null" {
		t.Fatalf("a monitor created without labels holds %s, want none", got)
	}
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)
	if got := labelsInState(t, state); got != "null" {
		t.Fatalf("the refresh holds %s, want none: the labels are OneUptime's", got)
	}
	tf.requireNoChanges(state, labelledMonitor(tf))

	// Declared later: the plan adds the configuration's label, and takes nothing off.
	state = tf.apply(state, labelledMonitor(tf, labelProduction))
	added, removed := sentEntries(tf.api.updateBodies[0], "labels")
	if added != labelProduction || removed != "" {
		t.Fatalf("the update added %q and took off %q", added, removed)
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the monitor has %s", got)
	}
	tf.requireNoChanges(tf.refresh(state), labelledMonitor(tf, labelProduction))
}

func TestUnderTerraformAStateAnEarlierVersionWroteTakesNoLabelOff(t *testing.T) {
	runUnderTerraform(t)
	api, state, id := createLabelled(t, labelProduction)
	// An earlier version kept no private state of the labels it declared.
	api.private[id] = nil

	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)
	config := labelledMonitor(tf, labelProduction)
	state = tf.apply(state, config)

	_, removed := sentEntries(tf.api.updateBodies[0], "labels")
	if removed != "" {
		t.Fatalf("the first apply after the upgrade took off %s", removed)
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the monitor has %s, want the rule's label kept", got)
	}
	tf.requireNoChanges(tf.refresh(state), config)
}

func TestUnderTerraformAnImportAdoptsTheMonitorsLabels(t *testing.T) {
	runUnderTerraform(t)
	api, _, id := createLabelled(t, labelProduction)

	tf := sharedTerraform(t, api, nil)
	state := tf.importMonitor(id)
	if got := labelsInState(t, state); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the import holds %s, want every label the monitor has", got)
	}

	// A configuration written from the record - every label it has - plans nothing.
	tf.requireNoChanges(state, labelledMonitor(tf, labelProduction, labelByRule))

	// One that leaves a label out shows it taken off, and the apply takes it off.
	config := labelledMonitor(tf, labelProduction)
	tf.plansLabels(state, config, labelProduction)
	tf.apply(state, config)
	if got := labelIDsOf(t, tf.api, id); got != labelProduction {
		t.Fatalf("the monitor has %s", got)
	}
}

func TestExclusiveListsMakeTheConfigurationsListTheMonitorsWholeList(t *testing.T) {
	runUnderTerraform(t)
	tf := exclusiveTerraform(t, nil)
	state := tf.apply(tftypes.NewValue(tf.objectType(), nil), labelledMonitor(tf, labelProduction))
	id := stringOf(t, state, "id")
	addedByRule(tf.api, id, labelByRule)

	state = tf.refresh(state)
	if got := labelsInState(t, state); got != joinedIDs(labelProduction, labelByRule) {
		t.Fatalf("the state holds %s, want the monitor's whole list", got)
	}

	// The plan shows the rule's label going, as earlier versions did.
	config := labelledMonitor(tf, labelProduction)
	tf.plansLabels(state, config, labelProduction)
	tf.apply(state, config)

	sent, ok := sentLabels(tf.api.updates[0])
	if !ok || sent != labelProduction {
		t.Fatalf("the update sent labels %q, want the whole list", sent)
	}
	if _, entryByEntry := tf.api.updateBodies[0]["removeFromList"]; entryByEntry {
		t.Fatalf("the update sent single entries: %v", tf.api.updateBodies[0])
	}
	if got := labelIDsOf(t, tf.api, id); got != labelProduction {
		t.Fatalf("the monitor has %s, want the configuration's alone", got)
	}
}

func TestAnOlderOneUptimeThatChangesNoSingleEntryIsAnError(t *testing.T) {
	runUnderTerraform(t)
	api, state, _ := createLabelled(t, labelProduction)
	api.ignoresListChanges = true
	tf := sharedTerraform(t, api, nil)
	state = tf.refresh(state)

	diagnostics := tf.applyFor(state, labelledMonitor(tf, labelProduction, labelTeamA))
	found := false
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError && diagnostic.Summary == "OneUptime did not change labels" {
			found = true
			if !strings.Contains(diagnostic.Detail, "did not add "+labelTeamA) {
				t.Errorf("the error does not name the label: %s", diagnostic.Detail)
			}
		}
	}
	if !found {
		t.Fatalf("an update OneUptime did not apply went unsaid: %v", diagnostics)
	}
}

func TestUnderCrossplaneAnUpdateSendsTheManifestsLabelsEntryByEntry(t *testing.T) {
	runUnderCrossplane(t)
	api, state, id := createLabelled(t, labelProduction)
	tf := sharedTerraform(t, api, recordedLabels(labelProduction))
	state = tf.refresh(state)

	// Someone adds a label after the observe read the monitor.
	addedByRule(tf.api, id, labelSomeoneAdded)
	state = tf.apply(state, labelledMonitor(tf, labelProduction, labelTeamA))

	if len(tf.api.updateBodies) != 1 {
		t.Fatalf("%d updates, want 1", len(tf.api.updateBodies))
	}
	added, removed := sentEntries(tf.api.updateBodies[0], "labels")
	if added != labelTeamA || removed != "" {
		t.Fatalf("the update added %q and took off %q, want %s added alone", added, removed, labelTeamA)
	}
	if got := labelIDsOf(t, tf.api, id); got != joinedIDs(labelProduction, labelTeamA, labelByRule, labelSomeoneAdded) {
		t.Fatalf("the monitor has %s, want the label added meanwhile kept", got)
	}

	// The next observe reads it, and the manifest's labels plan nothing.
	next := sharedTerraform(t, tf.api, recordedLabels(labelProduction, labelTeamA))
	state = next.refresh(state)
	if got := labelsInState(t, state); got != joinedIDs(labelProduction, labelTeamA, labelByRule, labelSomeoneAdded) {
		t.Fatalf("the observe holds %s, want every label the monitor has", got)
	}
	next.requireNoChanges(state, labelledMonitor(next, labelProduction, labelTeamA))
}

func TestACreateWhoseAnswerNamesFieldsLeftOutWarns(t *testing.T) {
	runUnderTerraform(t)
	tf := sharedTerraform(t, nil, nil)
	tf.api.createLeftOut = "incomingRequestReceivedAt"

	diagnostics := tf.applyFor(tftypes.NewValue(tf.objectType(), nil), labelledMonitor(tf))
	found := false
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			t.Fatalf("the create failed: %s - %s", diagnostic.Summary, diagnostic.Detail)
		}
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityWarning && diagnostic.Summary == "OneUptime created the monitor without incomingRequestReceivedAt" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no warning names the field left out: %v", diagnostics)
	}
}
