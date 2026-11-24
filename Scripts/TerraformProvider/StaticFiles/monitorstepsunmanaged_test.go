package provider

/*
 * WHAT TERRAFORM CANNOT WRITE OF A MONITOR'S STEPS, KEPT ON AN APPLY
 * (OneUptime/oneuptime#10984).
 *
 * Every key OneUptime's API schema holds at a step, a criteria, a filter, a
 * window and a template has an attribute or a decision
 * (testdata/monitor_steps_api_keys.json, from the API's own schemas). A key
 * the provider cannot read back survives an apply that changes the steps, on
 * the item the server matches it to (testdata/monitor_steps_identity_cases.json,
 * from MonitorStepsIdentityUtil), and nowhere else. The three settings the
 * provider writes since - incident_member_roles, do_not_sync_fields and
 * security_events_monitor - read back as written, show in the plan when set
 * in the Dashboard, and the apply does what the plan said. Through the
 * provider's real protocol server, against the fake API of
 * monitorstepsvalues_roundtrip_test.go, which here gives ids as the server
 * does.
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

	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	unmanagedOnlineStatus  = "a1000000-0000-4000-8000-0000000109b1"
	unmanagedOfflineStatus = "a1000000-0000-4000-8000-0000000109b2"
	unmanagedSeverity      = "a1000000-0000-4000-8000-0000000109b3"
	unmanagedRole          = "a1000000-0000-4000-8000-0000000109b5"
	unmanagedUser          = "a1000000-0000-4000-8000-0000000109b6"
	unmanagedOtherUser     = "a1000000-0000-4000-8000-0000000109b7"
)

// ---------------------------------------------------------------------------
// Every key OneUptime holds: an attribute or a decision
// ---------------------------------------------------------------------------

func loadUnmanagedAPIKeys(t *testing.T) map[string][]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "monitor_steps_api_keys.json"))
	if err != nil {
		t.Fatalf("reading the keys the generator writes from the API's schemas: %s", err)
	}
	var file struct {
		Levels map[string][]string `json:"levels"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parsing the API's keys: %s", err)
	}
	return file.Levels
}

// A step with every key OneUptime's API schema holds, at every level, set.
func unmanagedFullWire(t *testing.T) map[string]interface{} {
	t.Helper()
	window := map[string]interface{}{
		"timeValueInMinutes":   float64(10),
		"evaluateOverTimeType": "Percentile",
		"onNoDataPolicy":       "Trigger",
		"percentile":           float64(90),
		"countFilterType":      "Greater Than",
		"countValue":           float64(3),
		"changeType":           "Percentage",
		"changeValue":          float64(50),
	}
	filter := map[string]interface{}{
		"checkOn":                  "Response Time (in ms)",
		"filterType":               "Greater Than",
		"value":                    float64(500),
		"evaluateOverTime":         true,
		"evaluateOverTimeOptions":  window,
		"serverMonitorOptions":     map[string]interface{}{"diskPath": "/"},
		"metricMonitorOptions":     map[string]interface{}{"metricAlias": "a"},
		"snmpMonitorOptions":       map[string]interface{}{"oid": "1.3.6.1.2.1.1.3.0"},
		"databaseMonitorOptions":   map[string]interface{}{"metricType": "connections"},
		"customCodeMonitorOptions": map[string]interface{}{"resultValuePath": "data.count"},
	}
	ids := []interface{}{unmanagedSeverity}
	incident := map[string]interface{}{
		"id":                       "a1000000-0000-4000-8000-000000010981",
		"title":                    "The shop is down",
		"description":              "The shop does not answer.",
		"incidentSeverityId":       unmanagedSeverity,
		"autoResolveIncident":      true,
		"remediationNotes":         "Restart the shop.",
		"onCallPolicyIds":          ids,
		"labelIds":                 ids,
		"ownerTeamIds":             ids,
		"ownerUserIds":             ids,
		"incidentMemberRoles":      []interface{}{map[string]interface{}{"roleId": unmanagedRole, "userId": unmanagedUser}},
		"showIncidentOnStatusPage": false,
		"isPrivate":                true,
	}
	alert := map[string]interface{}{
		"id":               "a1000000-0000-4000-8000-000000010982",
		"title":            "The shop is down",
		"description":      "The shop does not answer.",
		"alertSeverityId":  unmanagedSeverity,
		"autoResolveAlert": true,
		"remediationNotes": "Restart the shop.",
		"onCallPolicyIds":  ids,
		"labelIds":         ids,
		"ownerTeamIds":     ids,
		"ownerUserIds":     ids,
		"isPrivate":        true,
	}
	criteria := map[string]interface{}{
		"id":                      "a1000000-0000-4000-8000-000000010983",
		"monitorStatusId":         unmanagedOfflineStatus,
		"filterCondition":         "All",
		"filters":                 []interface{}{filter},
		"incidents":               []interface{}{incident},
		"alerts":                  []interface{}{alert},
		"name":                    "Slow",
		"description":             "The shop is slow.",
		"changeMonitorStatus":     true,
		"createIncidents":         true,
		"createAlerts":            true,
		"isEnabled":               false,
		"incidentGrouping":        map[string]interface{}{"groupByJSONPath": "$.alertname"},
		"openForEveryEmail":       true,
		"recoveryFilters":         []interface{}{monitorStepsTestJSONCopy(t, filter)},
		"recoveryFilterCondition": "Any",
		"activeHours":             driftActiveHours(t),
		"activeHoursTimezone":     "Europe/Oslo",
	}
	step := map[string]interface{}{
		"id":                          "a1000000-0000-4000-8000-000000010984",
		"doNotSyncFields":             []interface{}{"monitorDestination"},
		"monitorDestination":          map[string]interface{}{"_type": "URL", "value": "https://example.com/health"},
		"requestType":                 "POST",
		"requestHeaders":              map[string]interface{}{"Authorization": "Bearer token"},
		"requestBody":                 "{}",
		"requestBodyFormat":           "text",
		"doNotFollowRedirects":        true,
		"allowSelfSignedCertificates": true,
		"tlsClientCertificate":        "certificate",
		"tlsClientKey":                "key",
		"tlsClientKeyPassphrase":      "passphrase",
		"monitorDestinationPort":      map[string]interface{}{"_type": "Port", "value": float64(8443)},
		"customCode":                  "return true;",
		"screenSizeTypes":             []interface{}{"Desktop"},
		"browserTypes":                []interface{}{"Chromium"},
		"retryCountOnError":           float64(2),
		"requestTimeoutInMs":          float64(5000),
		"retryCount":                  float64(1),
		"snmpMonitor":                 map[string]interface{}{"hostname": "10.0.0.1"},
		"monitorCriteria": map[string]interface{}{
			"_type": "MonitorCriteria",
			"value": map[string]interface{}{
				"monitorCriteriaInstanceArray": []interface{}{
					map[string]interface{}{"_type": "MonitorCriteriaInstance", "value": criteria},
				},
			},
		},
	}
	for _, sub := range monitorStepsSubConfigs {
		step[sub.apiKey] = map[string]interface{}{"setting": sub.tfName}
	}
	return map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{"_type": "MonitorStep", "value": step},
			},
			"defaultMonitorStatusId": unmanagedOnlineStatus,
		},
	}
}

// The keys a wire value holds at each level, by the names the API's keys file gives them.
func unmanagedKeysByLevel(wire interface{}) map[string]map[string]bool {
	levels := map[string]map[string]bool{}
	note := func(level string, value map[string]interface{}) {
		if value == nil {
			return
		}
		if levels[level] == nil {
			levels[level] = map[string]bool{}
		}
		for key := range value {
			levels[level][key] = true
		}
	}

	steps := monitorStepsWireValue(wire)
	note("steps", steps)
	for _, rawStep := range monitorStepsItems(wire, "monitorStepsInstanceArray") {
		step := monitorStepsWireValue(rawStep)
		note("step", step)
		for _, rawCriteria := range monitorStepsItems(step["monitorCriteria"], "monitorCriteriaInstanceArray") {
			criteria := monitorStepsWireValue(rawCriteria)
			note("criteria", criteria)
			for _, key := range []string{"filters", "recoveryFilters"} {
				filters, _ := criteria[key].([]interface{})
				for _, rawFilter := range filters {
					filter, _ := rawFilter.(map[string]interface{})
					note("filter", filter)
					window, _ := filter["evaluateOverTimeOptions"].(map[string]interface{})
					note("window", window)
					server, _ := filter["serverMonitorOptions"].(map[string]interface{})
					note("serverMonitorOptions", server)
				}
			}
			incidents, _ := criteria["incidents"].([]interface{})
			for _, rawIncident := range incidents {
				incident, _ := rawIncident.(map[string]interface{})
				note("incident", incident)
				roles, _ := incident["incidentMemberRoles"].([]interface{})
				for _, rawRole := range roles {
					role, _ := rawRole.(map[string]interface{})
					note("incidentMemberRole", role)
				}
			}
			alerts, _ := criteria["alerts"].([]interface{})
			for _, rawAlert := range alerts {
				alert, _ := rawAlert.(map[string]interface{})
				note("alert", alert)
			}
		}
	}
	return levels
}

func TestMonitorStepsUnmanaged_EveryKeyOneUptimeHoldsHasAnAttributeOrADecision(t *testing.T) {
	ctx := context.Background()
	apiKeys := loadUnmanagedAPIKeys(t)

	for _, level := range []string{"steps", "step", "criteria", "filter", "window", "serverMonitorOptions", "incident", "incidentMemberRole", "alert"} {
		if len(apiKeys[level]) == 0 {
			t.Fatalf("the API's keys hold no %s: the file is not what it says", level)
		}
	}

	full := unmanagedFullWire(t)
	sample := unmanagedKeysByLevel(full)

	list, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, full))
	monitorStepsTestFatalOnDiagError(t, "reading every key", diags)
	readBackWire, diags := MonitorStepsToAPI(ctx, list)
	monitorStepsTestFatalOnDiagError(t, "writing every key", diags)
	readBackPlain, err := toPlainJSON(readBackWire)
	if err != nil {
		t.Fatalf("reading the steps as JSON: %s", err)
	}
	readBack := unmanagedKeysByLevel(readBackPlain)

	for level, keys := range apiKeys {
		for _, key := range keys {
			if !sample[level][key] {
				t.Errorf("OneUptime's %s holds %q, which unmanagedFullWire does not set: set it there, then give the provider an attribute for it or a decision in monitorStepsKeysWithoutAttribute", level, key)
				continue
			}
			decision := monitorStepsKeysWithoutAttribute[level][key]
			if readBack[level][key] && decision != "" {
				t.Errorf("%s.%s has an attribute and a decision to keep it without one: one or the other", level, key)
			}
			if !readBack[level][key] && decision == "" {
				t.Errorf("%s.%s has no attribute, and no decision in monitorStepsKeysWithoutAttribute: give it an attribute if people would manage it as code, else say why it is kept as OneUptime holds it", level, key)
			}
		}
	}

	// Every decision is of a key OneUptime holds, and says why.
	for level, decisions := range monitorStepsKeysWithoutAttribute {
		for key, why := range decisions {
			found := false
			for _, apiKey := range apiKeys[level] {
				found = found || apiKey == key
			}
			if !found {
				t.Errorf("monitorStepsKeysWithoutAttribute decides %s.%s, which OneUptime's API does not hold", level, key)
			}
			if strings.TrimSpace(why) == "" {
				t.Errorf("%s.%s is decided without a reason", level, key)
			}
		}
	}
}

func TestMonitorStepsUnmanaged_TheThreeSettingsWrittenSinceHaveAttributes(t *testing.T) {
	step := monitorStepsStepAttrTypes()
	incident := monitorStepsIncidentAttrTypes()
	for _, name := range []string{"do_not_sync_fields", "security_events_monitor"} {
		if _, ok := step[name]; !ok {
			t.Errorf("a step has no %s", name)
		}
	}
	if _, ok := incident["incident_member_roles"]; !ok {
		t.Errorf("an incident template has no incident_member_roles")
	}
	if !monitorStepsIsSubConfigKey("securityEventsMonitor") {
		t.Errorf("securityEventsMonitor is not compared as the other escape hatches are")
	}
}

// ---------------------------------------------------------------------------
// Items matched as the server matches them
// ---------------------------------------------------------------------------

type unmanagedIdentityCase struct {
	Name     string   `json:"name"`
	Incoming []string `json:"incoming"`
	Stored   []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"stored"`
	Matches []int `json:"matches"`
}

func TestMonitorStepsUnmanaged_ItemsAreMatchedAsTheServerMatchesThem(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "monitor_steps_identity_cases.json"))
	if err != nil {
		t.Fatalf("reading the cases the generator writes from MonitorStepsIdentityUtil: %s", err)
	}
	var file struct {
		Cases []unmanagedIdentityCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parsing the identity cases: %s", err)
	}
	if len(file.Cases) < 12 {
		t.Fatalf("the identity cases hold %d cases, fewer than they should", len(file.Cases))
	}

	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			stored := make([]monitorStepsStoredItem, len(c.Stored))
			for i, item := range c.Stored {
				stored[i] = monitorStepsStoredItem{id: item.ID, name: item.Name}
			}
			if got := monitorStepsMatchStored(c.Incoming, stored); !reflect.DeepEqual(got, c.Matches) {
				t.Fatalf("matched %v, where the server matches %v", got, c.Matches)
			}
		})
	}
}

func TestMonitorStepsUnmanaged_DoNotSyncFieldsTakeTheFieldsTheServerOffers(t *testing.T) {
	values := monitorStepsDoNotSyncFieldValues
	if len(values) < 20 {
		t.Fatalf("only %d sync fields: the generated list is not the server's", len(values))
	}
	if !sort.StringsAreSorted(values) {
		t.Fatalf("the sync fields are not sorted: %v", values)
	}
	seen := map[string]bool{}
	for _, value := range values {
		if seen[value] {
			t.Fatalf("%q is listed twice", value)
		}
		seen[value] = true
	}
	for _, want := range []string{"monitorDestination", "requestHeaders", "dnsMonitor.queryName", "securityEventsMonitor"} {
		if !seen[want] {
			t.Errorf("%q, a field the server keeps, is not offered", want)
		}
	}
}

// ---------------------------------------------------------------------------
// MonitorStepsKeepUnmanaged on its own
// ---------------------------------------------------------------------------

// A step, as the API holds or takes it, with these criteria.
func unmanagedStepWire(step map[string]interface{}, criteria ...map[string]interface{}) map[string]interface{} {
	instances := make([]interface{}, 0, len(criteria))
	for _, one := range criteria {
		instances = append(instances, map[string]interface{}{"_type": "MonitorCriteriaInstance", "value": one})
	}
	value := map[string]interface{}{
		"monitorDestination": map[string]interface{}{"_type": "URL", "value": "https://example.com"},
		"monitorCriteria": map[string]interface{}{
			"_type": "MonitorCriteria",
			"value": map[string]interface{}{"monitorCriteriaInstanceArray": instances},
		},
	}
	for key, setting := range step {
		value[key] = setting
	}
	return map[string]interface{}{"_type": "MonitorStep", "value": value}
}

func unmanagedStepsWire(steps ...map[string]interface{}) map[string]interface{} {
	instances := make([]interface{}, 0, len(steps))
	for _, step := range steps {
		instances = append(instances, step)
	}
	return map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{"monitorStepsInstanceArray": instances},
	}
}

// A criteria named so, checking Is Online for this, setting this status.
func unmanagedCriteria(name string, filterType string, status string, extra map[string]interface{}) map[string]interface{} {
	criteria := map[string]interface{}{
		"name":                name,
		"filterCondition":     "All",
		"filters":             []interface{}{map[string]interface{}{"checkOn": "Is Online", "filterType": filterType}},
		"monitorStatusId":     status,
		"changeMonitorStatus": true,
	}
	for key, value := range extra {
		criteria[key] = value
	}
	return criteria
}

func unmanagedOffline(extra map[string]interface{}) map[string]interface{} {
	settings := map[string]interface{}{
		"createIncidents": true,
		"createAlerts":    true,
		"incidents": []interface{}{map[string]interface{}{
			"title": "The shop is down", "description": "The shop does not answer.", "incidentSeverityId": unmanagedSeverity,
		}},
		"alerts": []interface{}{map[string]interface{}{
			"title": "The shop is down", "description": "The shop does not answer.", "alertSeverityId": unmanagedSeverity,
		}},
	}
	for key, value := range extra {
		settings[key] = value
	}
	return unmanagedCriteria("Offline", "False", unmanagedOfflineStatus, settings)
}

func unmanagedOnline(extra map[string]interface{}) map[string]interface{} {
	return unmanagedCriteria("Online", "True", unmanagedOnlineStatus, extra)
}

// The planned steps as an update writes them, from a wire value.
func unmanagedOutgoing(t *testing.T, wire map[string]interface{}) interface{} {
	t.Helper()
	list, diags := MonitorStepsFromAPI(context.Background(), monitorStepsTestJSONCopy(t, wire))
	monitorStepsTestFatalOnDiagError(t, "reading the planned steps", diags)
	outgoing, diags := MonitorStepsToAPI(context.Background(), list)
	monitorStepsTestFatalOnDiagError(t, "writing the planned steps", diags)
	return outgoing
}

// A held value: the server's ids on it, as every stored item has them.
func unmanagedHeld(t *testing.T, wire map[string]interface{}) interface{} {
	t.Helper()
	return unmanagedServerIDs()(nil, monitorStepsTestJSONCopy(t, wire))
}

// The state a plan was made from, as the provider keeps it, from a wire value.
func unmanagedPrior(t *testing.T, wire map[string]interface{}) types.List {
	t.Helper()
	list, diags := MonitorStepsFromAPI(context.Background(), monitorStepsTestJSONCopy(t, wire))
	monitorStepsTestFatalOnDiagError(t, "reading the prior steps", diags)
	return list
}

// An update with no state to read the plan from.
func unmanagedKeepWithoutPrior(ctx context.Context, outgoing interface{}, held interface{}) interface{} {
	return MonitorStepsKeepUnmanaged(ctx, outgoing, types.ListNull(types.ObjectType{AttrTypes: monitorStepsStepAttrTypes()}), held)
}

// The value of a criteria of the step at index 0 by its name.
func unmanagedCriteriaNamed(steps interface{}, name string) map[string]interface{} {
	stepsList := monitorStepsItems(steps, "monitorStepsInstanceArray")
	if len(stepsList) == 0 {
		return nil
	}
	for _, raw := range monitorStepsItems(monitorStepsWireValue(stepsList[0])["monitorCriteria"], "monitorCriteriaInstanceArray") {
		criteria := monitorStepsWireValue(raw)
		if criteria["name"] == name {
			return criteria
		}
	}
	return nil
}

func unmanagedFirstStep(steps interface{}) map[string]interface{} {
	stepsList := monitorStepsItems(steps, "monitorStepsInstanceArray")
	if len(stepsList) == 0 {
		return nil
	}
	return monitorStepsWireValue(stepsList[0])
}

func unmanagedFirstTemplate(criteria map[string]interface{}, key string) map[string]interface{} {
	templates, _ := criteria[key].([]interface{})
	if len(templates) == 0 {
		return nil
	}
	template, _ := templates[0].(map[string]interface{})
	return template
}

func TestMonitorStepsKeepUnmanaged_KeepsWhatTheProviderCannotReadOnItsItem(t *testing.T) {
	ctx := context.Background()
	held := unmanagedHeld(t, unmanagedStepsWire(unmanagedStepWire(
		map[string]interface{}{"snmpMonitor": map[string]interface{}{"hostname": "10.0.0.1"}, "packetCapture": true},
		unmanagedOffline(map[string]interface{}{"escalateAfterMinutes": float64(30)}),
		unmanagedOnline(nil),
	)))
	heldCriteria := unmanagedCriteriaNamed(held, "Offline")
	unmanagedFirstTemplate(heldCriteria, "incidents")["postmortemTemplateId"] = "a1000000-0000-4000-8000-000000010990"
	unmanagedFirstTemplate(heldCriteria, "alerts")["runbookId"] = "a1000000-0000-4000-8000-000000010991"

	// The plan: the criteria reordered and the Online one's status changed.
	outgoing := unmanagedOutgoing(t, unmanagedStepsWire(unmanagedStepWire(
		nil,
		unmanagedCriteria("Online", "True", unmanagedOfflineStatus, nil),
		unmanagedOffline(nil),
	)))

	sent := unmanagedKeepWithoutPrior(ctx, outgoing, held)

	step := unmanagedFirstStep(sent)
	if !reflect.DeepEqual(step["snmpMonitor"], map[string]interface{}{"hostname": "10.0.0.1"}) || step["packetCapture"] != true {
		t.Fatalf("the step's keys the provider cannot read were not kept: %v", step)
	}
	offline := unmanagedCriteriaNamed(sent, "Offline")
	if offline["escalateAfterMinutes"] != float64(30) {
		t.Fatalf("the Offline criteria's own key was not kept on it: %v", offline)
	}
	if unmanagedFirstTemplate(offline, "incidents")["postmortemTemplateId"] != "a1000000-0000-4000-8000-000000010990" {
		t.Fatalf("the incident template's own key was not kept on it")
	}
	if unmanagedFirstTemplate(offline, "alerts")["runbookId"] != "a1000000-0000-4000-8000-000000010991" {
		t.Fatalf("the alert template's own key was not kept on it")
	}
	online := unmanagedCriteriaNamed(sent, "Online")
	if _, leaked := online["escalateAfterMinutes"]; leaked {
		t.Fatalf("the Offline criteria's key reached the Online one, at its old position")
	}
	if online["monitorStatusId"] != unmanagedOfflineStatus {
		t.Fatalf("the plan's own change was not sent: %v", online)
	}
}

func TestMonitorStepsKeepUnmanaged_KeepsNothingTheProviderCanSay(t *testing.T) {
	ctx := context.Background()
	held := unmanagedHeld(t, unmanagedStepsWire(unmanagedStepWire(
		map[string]interface{}{
			"requestType":        "POST",
			"requestHeaders":     map[string]interface{}{"Authorization": "Bearer token"},
			"totpSecrets":        map[string]interface{}{"OTP": map[string]interface{}{"seed": "secret"}},
			"secretValuesToHide": []interface{}{"hunter2"},
		},
		unmanagedOnline(map[string]interface{}{"description": "Up", "isEnabled": false}),
	)))

	sent := unmanagedKeepWithoutPrior(ctx, unmanagedOutgoing(t, unmanagedStepsWire(unmanagedStepWire(nil, unmanagedOnline(nil)))), held)

	step := unmanagedFirstStep(sent)
	for _, key := range []string{"requestType", "requestHeaders", "totpSecrets", "secretValuesToHide", "id"} {
		if _, kept := step[key]; kept {
			t.Errorf("the step's %s was kept, though the provider writes it or it is never stored: the plan removes it", key)
		}
	}
	online := unmanagedCriteriaNamed(sent, "Online")
	for _, key := range []string{"description", "isEnabled", "id"} {
		if _, kept := online[key]; kept {
			t.Errorf("the criteria's %s was kept, though the provider writes it", key)
		}
	}
}

func TestMonitorStepsKeepUnmanaged_WhatThePlanWritesWins(t *testing.T) {
	ctx := context.Background()
	held := unmanagedHeld(t, unmanagedStepsWire(unmanagedStepWire(
		map[string]interface{}{"customFutureSetting": "held"},
		unmanagedOnline(nil),
	)))
	outgoing := unmanagedOutgoing(t, unmanagedStepsWire(unmanagedStepWire(nil, unmanagedOnline(nil))))
	// A newer provider writes the key itself.
	monitorStepsWireValue(monitorStepsItems(outgoing, "monitorStepsInstanceArray")[0])["customFutureSetting"] = "planned"

	if got := unmanagedFirstStep(unmanagedKeepWithoutPrior(ctx, outgoing, held))["customFutureSetting"]; got != "planned" {
		t.Fatalf("the held value replaced the planned one: %v", got)
	}
}

func TestMonitorStepsKeepUnmanaged_NothingHeldOrNothingReadableSendsThePlanAsItIs(t *testing.T) {
	ctx := context.Background()
	outgoing := unmanagedOutgoing(t, unmanagedStepsWire(unmanagedStepWire(nil, unmanagedOnline(nil))))

	for name, held := range map[string]interface{}{
		"no steps held":                  nil,
		"steps the provider cannot read": map[string]interface{}{"_type": "MonitorSteps", "value": map[string]interface{}{"monitorStepsInstanceArray": "not a list"}},
		"not an object at all":           "steps",
	} {
		t.Run(name, func(t *testing.T) {
			if got := unmanagedKeepWithoutPrior(ctx, outgoing, held); !reflect.DeepEqual(got, outgoing) {
				t.Fatalf("sent %v, not the plan %v", got, outgoing)
			}
		})
	}

	if got := unmanagedKeepWithoutPrior(ctx, nil, unmanagedHeld(t, unmanagedStepsWire(unmanagedStepWire(nil, unmanagedOnline(nil))))); got != nil {
		t.Fatalf("no planned steps sent %v", got)
	}
}

func TestMonitorStepsKeepUnmanaged_AFilterKeepsWhatANewerOneUptimeHoldsOnIt(t *testing.T) {
	ctx := context.Background()
	responseTime := func(value string) map[string]interface{} {
		return map[string]interface{}{
			"checkOn":          "Response Time (in ms)",
			"filterType":       "Greater Than",
			"value":            value,
			"evaluateOverTime": true,
			"evaluateOverTimeOptions": map[string]interface{}{
				"timeValueInMinutes":   float64(10),
				"evaluateOverTimeType": "Average",
			},
		}
	}
	steps := func(filters ...interface{}) map[string]interface{} {
		return unmanagedStepsWire(unmanagedStepWire(nil, unmanagedOffline(map[string]interface{}{"filters": filters})))
	}
	firstFilter := func(sent interface{}) map[string]interface{} {
		return unmanagedFirstTemplate(unmanagedCriteriaNamed(sent, "Offline"), "filters")
	}

	heldFilter := responseTime("500")
	heldFilter["sampleSize"] = float64(3)
	heldFilter["evaluateOverTimeOptions"].(map[string]interface{})["alignToClock"] = true
	held := unmanagedHeld(t, steps(heldFilter))

	t.Run("on the filter at its place that checks the same thing, and on its window", func(t *testing.T) {
		planned := steps(responseTime("800"))
		filter := firstFilter(MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, planned), held))
		if filter["sampleSize"] != float64(3) {
			t.Fatalf("the filter lost the setting a newer OneUptime holds on it: %v", filter)
		}
		if filter["evaluateOverTimeOptions"].(map[string]interface{})["alignToClock"] != true {
			t.Fatalf("the filter's window lost the setting a newer OneUptime holds on it: %v", filter["evaluateOverTimeOptions"])
		}
		if planned := firstFilter(unmanagedOutgoing(t, planned)); !reflect.DeepEqual(filter["value"], planned["value"]) {
			t.Fatalf("the plan's own value was not sent: %v, not %v", filter["value"], planned["value"])
		}
	})

	t.Run("not on a filter at its place that checks another thing", func(t *testing.T) {
		planned := steps(map[string]interface{}{"checkOn": "Is Online", "filterType": "False"})
		filter := firstFilter(MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, planned), held))
		if _, leaked := filter["sampleSize"]; leaked {
			t.Fatalf("a filter that checks another thing took the held one's setting: %v", filter)
		}
	})

	t.Run("not on a filter the plan adds after the held ones", func(t *testing.T) {
		planned := steps(responseTime("800"), responseTime("900"))
		sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, planned), held)
		filters := unmanagedCriteriaNamed(sent, "Offline")["filters"].([]interface{})
		if _, leaked := filters[1].(map[string]interface{})["sampleSize"]; leaked {
			t.Fatalf("the added filter took the held one's setting: %v", filters[1])
		}
	})
}

func TestMonitorStepsKeepUnmanaged_AStepOrACriteriaTheServerGivesANewIDGetsNothing(t *testing.T) {
	ctx := context.Background()
	held := unmanagedHeld(t, unmanagedStepsWire(unmanagedStepWire(
		map[string]interface{}{"snmpMonitor": map[string]interface{}{"hostname": "10.0.0.1"}},
		unmanagedOnline(map[string]interface{}{"escalateAfterMinutes": float64(30)}),
	)))

	sent := unmanagedKeepWithoutPrior(ctx, unmanagedOutgoing(t, unmanagedStepsWire(
		unmanagedStepWire(nil, unmanagedOnline(nil)),
		unmanagedStepWire(nil, unmanagedOffline(nil)),
	)), held)

	steps := monitorStepsItems(sent, "monitorStepsInstanceArray")
	if _, kept := monitorStepsWireValue(steps[0])["snmpMonitor"]; !kept {
		t.Fatalf("the first step, the held one's, lost its carrier")
	}
	if _, leaked := monitorStepsWireValue(steps[1])["snmpMonitor"]; leaked {
		t.Fatalf("the added step took the held step's carrier")
	}
	if _, leaked := unmanagedCriteriaNamed(unmanagedStepsWire(steps[1].(map[string]interface{})), "Offline")["escalateAfterMinutes"]; leaked {
		t.Fatalf("the added step's criteria took the held criteria's key")
	}
}

// ---------------------------------------------------------------------------
// Through the protocol server
// ---------------------------------------------------------------------------

/*
 * unmanagedServerIDs gives a write's steps the ids the server gives them
 * (MonitorStepsIdentityUtil): each item takes the id of the held item it is
 * matched to, as monitorStepsMatchStored matches them - which
 * TestMonitorStepsUnmanaged_ItemsAreMatchedAsTheServerMatchesThem holds to
 * the server's own answers - and the rest get new ones.
 */
func unmanagedServerIDs() func(held interface{}, sent interface{}) interface{} {
	next := 0
	newID := func() string {
		next++
		return fmt.Sprintf("a1000000-0000-4000-8000-%012d", 900000+next)
	}

	var assign func(sentItems []interface{}, heldItems []interface{}, nameKey string, inner func(sent, held map[string]interface{}))
	assign = func(sentItems []interface{}, heldItems []interface{}, nameKey string, inner func(sent, held map[string]interface{})) {
		matches := monitorStepsMatchStored(monitorStepsNames(sentItems, nameKey), monitorStepsStoredItems(heldItems, nameKey))
		for i, item := range sentItems {
			value := monitorStepsWireValue(item)
			if value == nil {
				continue
			}
			var heldValue map[string]interface{}
			if matches[i] >= 0 {
				heldValue = monitorStepsWireValue(heldItems[matches[i]])
				value["id"] = heldValue["id"]
			} else {
				value["id"] = newID()
			}
			if inner != nil {
				inner(value, heldValue)
			}
		}
	}

	return func(held interface{}, sent interface{}) interface{} {
		assign(monitorStepsItems(sent, "monitorStepsInstanceArray"), monitorStepsItems(held, "monitorStepsInstanceArray"), "", func(step, heldStep map[string]interface{}) {
			var heldCriteria []interface{}
			if heldStep != nil {
				heldCriteria = monitorStepsItems(heldStep["monitorCriteria"], "monitorCriteriaInstanceArray")
			}
			assign(monitorStepsItems(step["monitorCriteria"], "monitorCriteriaInstanceArray"), heldCriteria, "name", func(criteria, heldOne map[string]interface{}) {
				for _, key := range []string{"incidents", "alerts"} {
					sentTemplates, _ := criteria[key].([]interface{})
					var heldTemplates []interface{}
					if heldOne != nil {
						heldTemplates, _ = heldOne[key].([]interface{})
					}
					assign(sentTemplates, heldTemplates, "title", nil)
				}
			})
		})
		return sent
	}
}

// The monitor_steps of a configuration that writes these criteria on one step.
func unmanagedConfiguredSteps(t *testing.T, tf *stepValuesTerraform, step map[string]interface{}, criteria ...map[string]interface{}) tftypes.Value {
	t.Helper()
	list, diags := MonitorStepsFromAPI(tf.ctx, monitorStepsTestJSONCopy(t, unmanagedStepsWire(unmanagedStepWire(step, criteria...))))
	monitorStepsTestFatalOnDiagError(t, "reading the configured steps", diags)
	value, err := list.ToTerraformValue(tf.ctx)
	if err != nil {
		t.Fatalf("encoding the configured steps: %s", err)
	}
	return value
}

func unmanagedNewMonitor(t *testing.T, criteria ...map[string]interface{}) (*stepValuesAPI, *stepValuesTerraform, settled, string) {
	t.Helper()
	api := newStepValuesAPI(t)
	api.storeSteps = unmanagedServerIDs()
	tf := newStepValuesTerraform(t, api)
	created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, criteria...)))
	return api, tf, created, stringAttribute(t, created.state, "id")
}

// The steps OneUptime holds of a record, as plain JSON.
func unmanagedStoredSteps(t *testing.T, api *stepValuesAPI, table, id string) interface{} {
	t.Helper()
	api.mu.Lock()
	defer api.mu.Unlock()
	return monitorStepsTestNormalizeJSON(t, api.rows[table][id]["monitorSteps"])
}

// Someone changes the stored steps in the Dashboard.
func unmanagedInTheDashboard(t *testing.T, api *stepValuesAPI, table, id string, change func(steps interface{})) {
	t.Helper()
	api.mu.Lock()
	defer api.mu.Unlock()
	change(api.rows[table][id]["monitorSteps"])
}

// A key only the Dashboard (or a newer OneUptime) sets, and where it sits.
type unmanagedKeptKey struct {
	name  string
	key   string
	value interface{}
	// Whether it sits on the step rather than on a criteria or its templates.
	onStep bool
	// The item the key sits on, of steps, given the criteria that holds it.
	on func(steps interface{}, criteriaName string) map[string]interface{}
}

var unmanagedKeptKeys = []unmanagedKeptKey{
	{"the snmpMonitor carrier of a step", "snmpMonitor", map[string]interface{}{"hostname": "10.0.0.1", "snmpVersion": "V2c"}, true,
		func(steps interface{}, _ string) map[string]interface{} { return unmanagedFirstStep(steps) }},
	{"a newer OneUptime's setting of a step", "packetCapture", map[string]interface{}{"enabled": true, "seconds": float64(30)}, true,
		func(steps interface{}, _ string) map[string]interface{} { return unmanagedFirstStep(steps) }},
	{"a newer OneUptime's setting of a criteria", "escalateAfterMinutes", float64(30), false,
		func(steps interface{}, criteria string) map[string]interface{} {
			return unmanagedCriteriaNamed(steps, criteria)
		}},
	{"a newer OneUptime's setting of an incident template", "postmortemTemplateId", "a1000000-0000-4000-8000-000000010990", false,
		func(steps interface{}, criteria string) map[string]interface{} {
			return unmanagedFirstTemplate(unmanagedCriteriaNamed(steps, criteria), "incidents")
		}},
	{"a newer OneUptime's setting of an alert template", "runbookId", "a1000000-0000-4000-8000-000000010991", false,
		func(steps interface{}, criteria string) map[string]interface{} {
			return unmanagedFirstTemplate(unmanagedCriteriaNamed(steps, criteria), "alerts")
		}},
	{"a newer OneUptime's setting of a filter", "sampleSize", float64(3), false,
		func(steps interface{}, criteria string) map[string]interface{} {
			return unmanagedFirstTemplate(unmanagedCriteriaNamed(steps, criteria), "filters")
		}},
}

// Applies that change other parts of the steps, and the criteria that holds the key after each.
var unmanagedStepChanges = []struct {
	name     string
	criteria func() []map[string]interface{}
	holder   string
}{
	{"a criteria's monitor status changed", func() []map[string]interface{} {
		return []map[string]interface{}{
			unmanagedOffline(map[string]interface{}{"monitorStatusId": unmanagedSeverity}),
			unmanagedOnline(nil),
		}
	}, "Offline"},
	{"a filter added to the other criteria", func() []map[string]interface{} {
		return []map[string]interface{}{
			unmanagedOffline(nil),
			unmanagedOnline(map[string]interface{}{"filters": []interface{}{
				map[string]interface{}{"checkOn": "Is Online", "filterType": "True"},
				map[string]interface{}{"checkOn": "Response Time (in ms)", "filterType": "Less Than", "value": "500"},
			}}),
		}
	}, "Offline"},
	{"a criteria added before it", func() []map[string]interface{} {
		return []map[string]interface{}{
			unmanagedCriteria("Degraded", "True", unmanagedSeverity, nil),
			unmanagedOffline(nil),
			unmanagedOnline(nil),
		}
	}, "Offline"},
	{"the criteria reordered", func() []map[string]interface{} {
		return []map[string]interface{}{unmanagedOnline(nil), unmanagedOffline(nil)}
	}, "Offline"},
	{"the criteria renamed, and matched by position", func() []map[string]interface{} {
		renamed := unmanagedOffline(nil)
		renamed["name"] = "Down"
		return []map[string]interface{}{renamed, unmanagedOnline(nil)}
	}, "Down"},
}

func TestMonitorStepsUnmanaged_ADashboardOnlySettingSurvivesAnApplyThatChangesTheSteps(t *testing.T) {
	for _, kept := range unmanagedKeptKeys {
		for _, change := range unmanagedStepChanges {
			t.Run(kept.name+", "+change.name, func(t *testing.T) {
				api, tf, created, id := unmanagedNewMonitor(t, unmanagedOffline(nil), unmanagedOnline(nil))

				unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
					kept.on(steps, "Offline")[kept.key] = kept.value
				})

				// The provider cannot read it: the plan cannot show it.
				refreshed := tf.refresh("oneuptime_monitor", created)
				if changed := tf.changes("oneuptime_monitor", refreshed, recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, unmanagedOffline(nil), unmanagedOnline(nil)))); len(changed) > 0 {
					t.Fatalf("a setting the provider cannot read plans %v", changed)
				}

				config := recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, change.criteria()...))
				writes := api.writesTo("/monitor")
				applied := tf.apply("oneuptime_monitor", refreshed, config)
				if api.writesTo("/monitor") != writes+1 {
					t.Fatalf("the apply did not write the monitor")
				}

				stored := unmanagedStoredSteps(t, api, "/monitor", id)
				holder := kept.on(stored, change.holder)
				if holder == nil || !reflect.DeepEqual(holder[kept.key], monitorStepsTestNormalizeJSON(t, kept.value)) {
					t.Fatalf("after the apply OneUptime no longer holds %s on %s: %v", kept.key, change.holder, holder)
				}

				// Nowhere else: not on the other criteria, nor their templates.
				for _, other := range []string{"Online", "Degraded"} {
					if kept.onStep || other == change.holder {
						continue
					}
					if elsewhere := kept.on(stored, other); elsewhere != nil {
						if _, leaked := elsewhere[kept.key]; leaked {
							t.Fatalf("%s reached the %s criteria too", kept.key, other)
						}
					}
				}

				// What the configuration writes is what OneUptime holds, and the plan after is empty.
				requireStepsAsConfigured(t, "after the apply", applied, config)
				if changed := tf.changes("oneuptime_monitor", tf.refresh("oneuptime_monitor", applied), config); len(changed) > 0 {
					t.Fatalf("the plan after the apply changes %v", changed)
				}
			})
		}
	}
}

func TestMonitorStepsUnmanaged_AnApplyThatRemovesTheItemRemovesWhatItHeld(t *testing.T) {
	t.Run("a criteria taken out takes its keys with it", func(t *testing.T) {
		api, tf, created, id := unmanagedNewMonitor(t, unmanagedOffline(nil), unmanagedOnline(nil))
		unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
			unmanagedCriteriaNamed(steps, "Offline")["escalateAfterMinutes"] = float64(30)
		})

		tf.apply("oneuptime_monitor", tf.refresh("oneuptime_monitor", created), recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, unmanagedOnline(nil))))

		stored := unmanagedStoredSteps(t, api, "/monitor", id)
		if unmanagedCriteriaNamed(stored, "Offline") != nil {
			t.Fatalf("the Offline criteria is still held")
		}
		if _, leaked := unmanagedCriteriaNamed(stored, "Online")["escalateAfterMinutes"]; leaked {
			t.Fatalf("the removed criteria's key reached the one left")
		}
	})

	t.Run("an incident template taken out takes its keys with it", func(t *testing.T) {
		api, tf, created, id := unmanagedNewMonitor(t, unmanagedOffline(nil), unmanagedOnline(nil))
		unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
			unmanagedFirstTemplate(unmanagedCriteriaNamed(steps, "Offline"), "incidents")["postmortemTemplateId"] = "a1000000-0000-4000-8000-000000010990"
		})

		withoutIncidents := unmanagedOffline(nil)
		delete(withoutIncidents, "incidents")
		withoutIncidents["createIncidents"] = false
		tf.apply("oneuptime_monitor", tf.refresh("oneuptime_monitor", created), recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, withoutIncidents, unmanagedOnline(nil))))

		offline := unmanagedCriteriaNamed(unmanagedStoredSteps(t, api, "/monitor", id), "Offline")
		if template := unmanagedFirstTemplate(offline, "incidents"); template != nil {
			t.Fatalf("an incident template is still held: %v", template)
		}
		if unmanagedFirstTemplate(offline, "alerts")["postmortemTemplateId"] != nil {
			t.Fatalf("the incident template's key reached the alert template")
		}
	})
}

func TestMonitorStepsUnmanaged_ASettingTheProviderWritesIsTheConfigurationsToRemove(t *testing.T) {
	api, tf, created, id := unmanagedNewMonitor(t, unmanagedOffline(nil), unmanagedOnline(nil))
	unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
		unmanagedFirstStep(steps)["requestType"] = "POST"
		unmanagedCriteriaNamed(steps, "Online")["description"] = "Set in the Dashboard"
	})

	config := recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, unmanagedOffline(nil), unmanagedOnline(nil)))
	drifted := tf.refresh("oneuptime_monitor", created)
	if changed := tf.changes("oneuptime_monitor", drifted, config); !containsString(changed, "monitor_steps") {
		t.Fatalf("settings the provider writes, set in the Dashboard, plan %v", changed)
	}

	tf.apply("oneuptime_monitor", drifted, config)

	stored := unmanagedStoredSteps(t, api, "/monitor", id)
	if _, kept := unmanagedFirstStep(stored)["requestType"]; kept {
		t.Fatalf("the apply kept the Dashboard's request type, which the plan said it would remove")
	}
	if _, kept := unmanagedCriteriaNamed(stored, "Online")["description"]; kept {
		t.Fatalf("the apply kept the Dashboard's description, which the plan said it would remove")
	}
}

func TestMonitorStepsUnmanaged_AnApplyThatChangesNoStepsSendsNone(t *testing.T) {
	api, tf, created, id := unmanagedNewMonitor(t, unmanagedOffline(nil), unmanagedOnline(nil))
	unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
		unmanagedFirstStep(steps)["snmpMonitor"] = map[string]interface{}{"hostname": "10.0.0.1"}
	})

	tf.apply("oneuptime_monitor", tf.refresh("oneuptime_monitor", created), recoveryHoursConfig(tf, "Shop renamed", unmanagedConfiguredSteps(t, tf, nil, unmanagedOffline(nil), unmanagedOnline(nil))))

	if _, kept := unmanagedFirstStep(unmanagedStoredSteps(t, api, "/monitor", id))["snmpMonitor"]; !kept {
		t.Fatalf("an apply that changed the name lost the step's carrier")
	}
}

func TestMonitorStepsUnmanaged_AnUpdateThatCannotReadTheHeldStepsWritesNone(t *testing.T) {
	api, tf, created, id := unmanagedNewMonitor(t, unmanagedOffline(nil), unmanagedOnline(nil))
	refreshed := tf.refresh("oneuptime_monitor", created)

	config := recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, unmanagedOnline(nil)))
	planned := tf.plan("oneuptime_monitor", refreshed, config)

	api.mu.Lock()
	api.failReadsOf = map[string]bool{id: true}
	api.mu.Unlock()

	writes := api.writesTo("/monitor")
	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       "oneuptime_monitor",
		PriorState:     tf.encode("oneuptime_monitor", refreshed.state),
		PlannedState:   planned.PlannedState,
		Config:         tf.encode("oneuptime_monitor", config),
		PlannedPrivate: planned.PlannedPrivate,
	})
	if err != nil {
		t.Fatalf("ApplyResourceChange: %s", err)
	}

	failed := false
	for _, diagnostic := range applied.Diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError && strings.Contains(diagnostic.Detail, "Unable to read the steps OneUptime holds") {
			failed = true
		}
	}
	if !failed {
		t.Fatalf("the apply did not fail on the read it could not make: %v", applied.Diagnostics)
	}
	if api.writesTo("/monitor") != writes {
		t.Fatalf("the apply wrote the steps although it could not read what OneUptime holds")
	}
}

// ---------------------------------------------------------------------------
// The three settings the provider writes since #10984
// ---------------------------------------------------------------------------

func unmanagedRoles(pairs ...[2]string) []interface{} {
	roles := make([]interface{}, 0, len(pairs))
	for _, pair := range pairs {
		roles = append(roles, map[string]interface{}{"roleId": pair[0], "userId": pair[1]})
	}
	return roles
}

func unmanagedOfflineWithRoles(roles []interface{}) map[string]interface{} {
	criteria := unmanagedOffline(nil)
	unmanagedFirstTemplate(criteria, "incidents")["incidentMemberRoles"] = roles
	return criteria
}

func TestMonitorStepsUnmanaged_IncidentMemberRolesAreWrittenReadAndPlanned(t *testing.T) {
	api := newStepValuesAPI(t)
	api.storeSteps = unmanagedServerIDs()
	tf := newStepValuesTerraform(t, api)

	config := recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, unmanagedOfflineWithRoles(unmanagedRoles([2]string{unmanagedRole, unmanagedUser})), unmanagedOnline(nil)))
	created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, config)
	id := stringAttribute(t, created.state, "id")
	requireStepsAsConfigured(t, "after the create", created, config)

	stored := unmanagedFirstTemplate(unmanagedCriteriaNamed(unmanagedStoredSteps(t, api, "/monitor", id), "Offline"), "incidents")
	if !reflect.DeepEqual(stored["incidentMemberRoles"], unmanagedRoles([2]string{unmanagedRole, unmanagedUser})) {
		t.Fatalf("OneUptime holds the roles %v", stored["incidentMemberRoles"])
	}

	refreshed := tf.refresh("oneuptime_monitor", created)
	if changed := tf.changes("oneuptime_monitor", refreshed, config); len(changed) > 0 {
		t.Fatalf("the plan after the create changes %v", changed)
	}

	// The Dashboard writes ids as ObjectID wrappers: the same roles.
	unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
		unmanagedFirstTemplate(unmanagedCriteriaNamed(steps, "Offline"), "incidents")["incidentMemberRoles"] = []interface{}{
			map[string]interface{}{
				"roleId": map[string]interface{}{"_type": "ObjectID", "value": unmanagedRole},
				"userId": map[string]interface{}{"_type": "ObjectID", "value": unmanagedUser},
			},
		}
	})
	rewrapped := tf.refresh("oneuptime_monitor", refreshed)
	if changed := tf.changes("oneuptime_monitor", rewrapped, config); len(changed) > 0 {
		t.Fatalf("the same roles written as the Dashboard writes them plan %v", changed)
	}

	// Someone gives a second person the role in the Dashboard: the plan says so.
	unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
		unmanagedFirstTemplate(unmanagedCriteriaNamed(steps, "Offline"), "incidents")["incidentMemberRoles"] = unmanagedRoles(
			[2]string{unmanagedRole, unmanagedUser},
			[2]string{unmanagedRole, unmanagedOtherUser},
		)
	})
	drifted := tf.refresh("oneuptime_monitor", rewrapped)
	if changed := tf.changes("oneuptime_monitor", drifted, config); !containsString(changed, "monitor_steps") {
		t.Fatalf("a role added in the Dashboard plans %v, not a change of monitor_steps", changed)
	}

	// The apply does what the plan said.
	applied := tf.apply("oneuptime_monitor", drifted, config)
	stored = unmanagedFirstTemplate(unmanagedCriteriaNamed(unmanagedStoredSteps(t, api, "/monitor", id), "Offline"), "incidents")
	if !reflect.DeepEqual(stored["incidentMemberRoles"], unmanagedRoles([2]string{unmanagedRole, unmanagedUser})) {
		t.Fatalf("after the apply OneUptime holds the roles %v", stored["incidentMemberRoles"])
	}
	if changed := tf.changes("oneuptime_monitor", tf.refresh("oneuptime_monitor", applied), config); len(changed) > 0 {
		t.Fatalf("the plan after the apply changes %v", changed)
	}
}

func TestMonitorStepsUnmanaged_IncidentMemberRolesOfAnIncompletePairAreNotRead(t *testing.T) {
	list, diags := MonitorStepsFromAPI(context.Background(), monitorStepsTestJSONCopy(t, unmanagedStepsWire(unmanagedStepWire(nil, unmanagedOfflineWithRoles([]interface{}{
		map[string]interface{}{"roleId": unmanagedRole},
		map[string]interface{}{"roleId": unmanagedRole, "userId": unmanagedUser},
	})))))
	monitorStepsTestFatalOnDiagError(t, "reading the roles", diags)
	wire, diags := MonitorStepsToAPI(context.Background(), list)
	monitorStepsTestFatalOnDiagError(t, "writing the roles", diags)
	plain, _ := toPlainJSON(wire)
	roles := unmanagedFirstTemplate(unmanagedCriteriaNamed(plain, "Offline"), "incidents")["incidentMemberRoles"]
	if !reflect.DeepEqual(roles, unmanagedRoles([2]string{unmanagedRole, unmanagedUser})) {
		t.Fatalf("read the roles as %v", roles)
	}
}

func TestMonitorStepsUnmanaged_DoNotSyncFieldsOfATemplateAreWrittenReadAndPlanned(t *testing.T) {
	api := newStepValuesAPI(t)
	api.storeSteps = unmanagedServerIDs()
	tf := newStepValuesTerraform(t, api)

	steps := unmanagedConfiguredSteps(t, tf, map[string]interface{}{"doNotSyncFields": []interface{}{"monitorDestination"}}, unmanagedOnline(nil))
	config := tf.config("oneuptime_monitor_template", "template_name", "Website", steps)
	created := tf.apply("oneuptime_monitor_template", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor_template"), nil)}, config)
	id := stringAttribute(t, created.state, "id")

	if got := unmanagedFirstStep(unmanagedStoredSteps(t, api, "/monitor-template", id))["doNotSyncFields"]; !reflect.DeepEqual(got, []interface{}{"monitorDestination"}) {
		t.Fatalf("OneUptime holds the template's sync fields %v", got)
	}
	refreshed := tf.refresh("oneuptime_monitor_template", created)
	if changed := tf.changes("oneuptime_monitor_template", refreshed, config); len(changed) > 0 {
		t.Fatalf("the plan after the create changes %v", changed)
	}

	unmanagedInTheDashboard(t, api, "/monitor-template", id, func(steps interface{}) {
		unmanagedFirstStep(steps)["doNotSyncFields"] = []interface{}{"monitorDestination", "requestTimeoutInMs"}
	})
	drifted := tf.refresh("oneuptime_monitor_template", refreshed)
	if changed := tf.changes("oneuptime_monitor_template", drifted, config); !containsString(changed, "monitor_steps") {
		t.Fatalf("a sync field added in the Dashboard plans %v", changed)
	}

	applied := tf.apply("oneuptime_monitor_template", drifted, config)
	if got := unmanagedFirstStep(unmanagedStoredSteps(t, api, "/monitor-template", id))["doNotSyncFields"]; !reflect.DeepEqual(got, []interface{}{"monitorDestination"}) {
		t.Fatalf("after the apply OneUptime holds the sync fields %v", got)
	}
	if changed := tf.changes("oneuptime_monitor_template", tf.refresh("oneuptime_monitor_template", applied), config); len(changed) > 0 {
		t.Fatalf("the plan after the apply changes %v", changed)
	}

	// None, as a monitor made from a template is given, reads as no setting.
	unmanagedInTheDashboard(t, api, "/monitor-template", id, func(steps interface{}) {
		unmanagedFirstStep(steps)["doNotSyncFields"] = []interface{}{}
	})
	withoutConfig := tf.config("oneuptime_monitor_template", "template_name", "Website", unmanagedConfiguredSteps(t, tf, nil, unmanagedOnline(nil)))
	if changed := tf.changes("oneuptime_monitor_template", tf.refresh("oneuptime_monitor_template", applied), withoutConfig); len(changed) > 0 {
		t.Fatalf("an empty list of sync fields plans %v", changed)
	}
}

func TestMonitorStepsUnmanaged_ASecurityEventsStepIsWrittenReadAndPlanned(t *testing.T) {
	api := newStepValuesAPI(t)
	api.storeSteps = unmanagedServerIDs()
	tf := newStepValuesTerraform(t, api)

	query := map[string]interface{}{
		"attributes":           map[string]interface{}{},
		"messageContains":      "Failed password",
		"severityNames":        []interface{}{"High"},
		"classNames":           []interface{}{"Authentication"},
		"telemetryServiceIds":  []interface{}{},
		"lastXSecondsOfEvents": float64(300),
	}
	bruteForce := map[string]interface{}{
		"name":            "Brute force",
		"filterCondition": "All",
		"filters": []interface{}{map[string]interface{}{
			"checkOn": "Security Event Count", "filterType": "Greater Than", "value": "20",
		}},
	}

	config := tf.config("oneuptime_monitor", "name", "Security Events", unmanagedConfiguredSteps(t, tf, map[string]interface{}{"securityEventsMonitor": query}, bruteForce))
	created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, config)
	id := stringAttribute(t, created.state, "id")

	if got := unmanagedFirstStep(unmanagedStoredSteps(t, api, "/monitor", id))["securityEventsMonitor"]; !reflect.DeepEqual(got, monitorStepsTestNormalizeJSON(t, query)) {
		t.Fatalf("OneUptime holds the Security Events step %v", got)
	}
	refreshed := tf.refresh("oneuptime_monitor", created)
	if changed := tf.changes("oneuptime_monitor", refreshed, config); len(changed) > 0 {
		t.Fatalf("the plan after the create changes %v", changed)
	}

	unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
		unmanagedFirstStep(steps)["securityEventsMonitor"].(map[string]interface{})["lastXSecondsOfEvents"] = float64(600)
	})
	drifted := tf.refresh("oneuptime_monitor", refreshed)
	if changed := tf.changes("oneuptime_monitor", drifted, config); !containsString(changed, "monitor_steps") {
		t.Fatalf("the Security Events step changed in the Dashboard plans %v", changed)
	}
	tf.apply("oneuptime_monitor", drifted, config)
	if got := unmanagedFirstStep(unmanagedStoredSteps(t, api, "/monitor", id))["securityEventsMonitor"].(map[string]interface{})["lastXSecondsOfEvents"]; got != float64(300) {
		t.Fatalf("after the apply the window is %v", got)
	}
}

func TestMonitorStepsUnmanaged_ValidateRefusesWhatOneUptimeWouldNotKeep(t *testing.T) {
	api := newStepValuesAPI(t)
	tf := newStepValuesTerraform(t, api)

	for name, step := range map[string]map[string]interface{}{
		"a sync field twice":           {"doNotSyncFields": []interface{}{"monitorDestination", "monitorDestination"}},
		"a field no template keeps":    {"doNotSyncFields": []interface{}{"monitorName"}},
		"an empty list of sync fields": {"doNotSyncFields": []interface{}{}},
	} {
		t.Run(name, func(t *testing.T) {
			list, diags := MonitorStepsFromAPI(tf.ctx, monitorStepsTestJSONCopy(t, unmanagedStepsWire(unmanagedStepWire(nil, unmanagedOnline(nil)))))
			monitorStepsTestFatalOnDiagError(t, "reading the steps", diags)
			value, err := list.ToTerraformValue(tf.ctx)
			if err != nil {
				t.Fatalf("encoding the steps: %s", err)
			}
			steps := unmanagedWithStepAttribute(t, tf, value, "do_not_sync_fields", step["doNotSyncFields"].([]interface{}))
			if errors := tf.validate("oneuptime_monitor_template", tf.config("oneuptime_monitor_template", "template_name", "Website", steps)); len(errors) == 0 {
				t.Fatalf("terraform validate took it")
			}
		})
	}

	t.Run("an incident role without its user", func(t *testing.T) {
		config := recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, nil, unmanagedOfflineWithRoles(unmanagedRoles([2]string{unmanagedRole, unmanagedUser})), unmanagedOnline(nil)))
		config = unmanagedReplaceString(t, tf, config, unmanagedUser, "")
		if errors := tf.validate("oneuptime_monitor", config); len(errors) == 0 {
			t.Fatalf("terraform validate took a role with an empty user id")
		}
	})
}

// The steps value with a list of strings set on its first step's attribute, written as HCL would.
func unmanagedWithStepAttribute(t *testing.T, tf *stepValuesTerraform, steps tftypes.Value, name string, values []interface{}) tftypes.Value {
	t.Helper()
	var elements []tftypes.Value
	if err := steps.As(&elements); err != nil || len(elements) == 0 {
		t.Fatalf("the steps hold no step: %v", err)
	}
	attributes := attributesOf(t, elements[0])
	listValues := make([]tftypes.Value, 0, len(values))
	for _, value := range values {
		listValues = append(listValues, tftypes.NewValue(tftypes.String, value))
	}
	attributes[name] = tftypes.NewValue(tftypes.List{ElementType: tftypes.String}, listValues)
	elements[0] = tftypes.NewValue(elements[0].Type(), attributes)
	return tftypes.NewValue(steps.Type(), elements)
}

// The configuration with every string value `from` written as `to`.
func unmanagedReplaceString(t *testing.T, tf *stepValuesTerraform, config tftypes.Value, from, to string) tftypes.Value {
	t.Helper()
	replaced, err := tftypes.Transform(config, func(path *tftypes.AttributePath, value tftypes.Value) (tftypes.Value, error) {
		if !value.Type().Is(tftypes.String) || !value.IsKnown() || value.IsNull() {
			return value, nil
		}
		var text string
		if err := value.As(&text); err != nil {
			return value, err
		}
		if text == from {
			return tftypes.NewValue(tftypes.String, to), nil
		}
		return value, nil
	})
	if err != nil {
		t.Fatalf("rewriting the configuration: %s", err)
	}
	return replaced
}

// ---------------------------------------------------------------------------
// Settings written with jsonencode(): the more OneUptime holds in them
// ---------------------------------------------------------------------------

// A step with this DNS query, and these criteria.
func unmanagedDNSSteps(query map[string]interface{}, criteria ...map[string]interface{}) map[string]interface{} {
	step := map[string]interface{}{}
	if query != nil {
		step["dnsMonitor"] = query
	}
	return unmanagedStepsWire(unmanagedStepWire(step, criteria...))
}

func unmanagedQuery(pairs ...interface{}) map[string]interface{} {
	query := map[string]interface{}{}
	for i := 0; i+1 < len(pairs); i += 2 {
		query[pairs[i].(string)] = pairs[i+1]
	}
	return query
}

func TestMonitorStepsKeepUnmanaged_KeepsWhatOneUptimeHoldsMoreInAJSONSetting(t *testing.T) {
	ctx := context.Background()
	written := unmanagedDNSSteps(unmanagedQuery("queryName", "example.com", "recordType", "A"), unmanagedOnline(nil))
	held := unmanagedHeld(t, unmanagedDNSSteps(unmanagedQuery(
		"queryName", "example.com", "recordType", "A", "port", float64(53), "dnsServers", []interface{}{"1.1.1.1"},
	), unmanagedOnline(nil)))

	sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, written), unmanagedPrior(t, written), held)

	want := unmanagedQuery("queryName", "example.com", "recordType", "A", "port", float64(53), "dnsServers", []interface{}{"1.1.1.1"})
	if got := unmanagedFirstStep(sent)["dnsMonitor"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("sent the query %v, not %v", got, want)
	}
}

func TestMonitorStepsKeepUnmanaged_AKeyTheConfigurationTookOutOfAJSONSettingStaysOut(t *testing.T) {
	ctx := context.Background()
	prior := unmanagedDNSSteps(unmanagedQuery("queryName", "example.com", "recordType", "A", "port", float64(5353)), unmanagedOnline(nil))
	planned := unmanagedDNSSteps(unmanagedQuery("queryName", "example.com", "recordType", "A"), unmanagedOnline(nil))
	held := unmanagedHeld(t, unmanagedDNSSteps(unmanagedQuery(
		"queryName", "example.com", "recordType", "A", "port", float64(5353), "dnsServers", []interface{}{"1.1.1.1"},
	), unmanagedOnline(nil)))

	sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, prior), held)

	want := unmanagedQuery("queryName", "example.com", "recordType", "A", "dnsServers", []interface{}{"1.1.1.1"})
	if got := unmanagedFirstStep(sent)["dnsMonitor"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("sent the query %v, not %v: the port the configuration took out is the plan's to remove", got, want)
	}
}

func TestMonitorStepsKeepUnmanaged_WhatTheJSONSettingWritesWins(t *testing.T) {
	ctx := context.Background()
	prior := unmanagedDNSSteps(unmanagedQuery("queryName", "example.com", "recordType", "A"), unmanagedOnline(nil))
	planned := unmanagedDNSSteps(unmanagedQuery("queryName", "example.org", "recordType", "AAAA"), unmanagedOnline(nil))
	held := unmanagedHeld(t, unmanagedDNSSteps(unmanagedQuery(
		"queryName", "example.com", "recordType", "A", "port", float64(53),
	), unmanagedOnline(nil)))

	sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, prior), held)

	want := unmanagedQuery("queryName", "example.org", "recordType", "AAAA", "port", float64(53))
	if got := unmanagedFirstStep(sent)["dnsMonitor"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("sent the query %v, not %v", got, want)
	}
}

func TestMonitorStepsKeepUnmanaged_KeepsMoreAtAnyDepthAndInTheItemsOfAListOfTheSameLength(t *testing.T) {
	ctx := context.Background()
	query := func(extra bool, queries int) map[string]interface{} {
		items := []interface{}{}
		for i := 0; i < queries; i++ {
			data := map[string]interface{}{"filterData": map[string]interface{}{"metricName": fmt.Sprintf("cpu.%d", i)}}
			if extra {
				data["groupBy"] = map[string]interface{}{"attributes": []interface{}{"host.name"}}
			}
			items = append(items, map[string]interface{}{"metricQueryData": data})
		}
		config := map[string]interface{}{"metricViewConfig": map[string]interface{}{"queryConfigs": items}}
		if extra {
			config["metricViewConfig"].(map[string]interface{})["formulaConfigs"] = []interface{}{}
		}
		return config
	}
	steps := func(metric map[string]interface{}) map[string]interface{} {
		return unmanagedStepsWire(unmanagedStepWire(map[string]interface{}{"metricMonitor": metric}, unmanagedOnline(nil)))
	}

	t.Run("in an object, and in the item of a list as long", func(t *testing.T) {
		sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, steps(query(false, 1))), unmanagedPrior(t, steps(query(false, 1))), unmanagedHeld(t, steps(query(true, 1))))
		if got, want := monitorStepsTestNormalizeJSON(t, unmanagedFirstStep(sent)["metricMonitor"]), monitorStepsTestNormalizeJSON(t, query(true, 1)); !reflect.DeepEqual(got, want) {
			t.Fatalf("sent %v, not %v", got, want)
		}
	})

	t.Run("a list of another length is the configuration's, whole", func(t *testing.T) {
		sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, steps(query(false, 2))), unmanagedPrior(t, steps(query(false, 1))), unmanagedHeld(t, steps(query(true, 1))))
		viewConfig := unmanagedFirstStep(sent)["metricMonitor"].(map[string]interface{})["metricViewConfig"].(map[string]interface{})
		if got, want := monitorStepsTestNormalizeJSON(t, viewConfig["queryConfigs"]), monitorStepsTestNormalizeJSON(t, query(false, 2)["metricViewConfig"].(map[string]interface{})["queryConfigs"]); !reflect.DeepEqual(got, want) {
			t.Fatalf("sent the queries %v, not the configuration's %v", got, want)
		}
		if _, kept := viewConfig["formulaConfigs"]; !kept {
			t.Fatalf("the object around the list lost what OneUptime holds more")
		}
	})
}

func TestMonitorStepsKeepUnmanaged_AStepSettingTheConfigurationDoesNotWrite(t *testing.T) {
	ctx := context.Background()
	planned := unmanagedDNSSteps(nil, unmanagedOnline(nil))
	held := unmanagedHeld(t, unmanagedDNSSteps(unmanagedQuery("queryName", "example.com", "recordType", "A"), unmanagedOnline(nil)))

	t.Run("is no change, and kept", func(t *testing.T) {
		sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, planned), held)
		if got := unmanagedFirstStep(sent)["dnsMonitor"]; !reflect.DeepEqual(got, unmanagedQuery("queryName", "example.com", "recordType", "A")) {
			t.Fatalf("sent the query %v", got)
		}
	})

	t.Run("unless the configuration took it out", func(t *testing.T) {
		prior := unmanagedDNSSteps(unmanagedQuery("queryName", "example.com", "recordType", "A"), unmanagedOnline(nil))
		sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, prior), held)
		if got, kept := unmanagedFirstStep(sent)["dnsMonitor"]; kept {
			t.Fatalf("sent the query %v the configuration took out", got)
		}
	})
}

func TestMonitorStepsKeepUnmanaged_AStateThatWasNotRefreshedStandsForNothing(t *testing.T) {
	ctx := context.Background()
	// Two steps in state, one held: the state does not line up with OneUptime's.
	prior := unmanagedStepsWire(
		unmanagedStepWire(map[string]interface{}{"dnsMonitor": unmanagedQuery("queryName", "example.com", "recordType", "A", "port", float64(5353))}, unmanagedOnline(nil)),
		unmanagedStepWire(nil, unmanagedOnline(nil)),
	)
	planned := unmanagedDNSSteps(unmanagedQuery("queryName", "example.com", "recordType", "A"), unmanagedOnline(nil))
	held := unmanagedHeld(t, unmanagedDNSSteps(unmanagedQuery("queryName", "example.com", "recordType", "A", "port", float64(5353)), unmanagedOnline(nil)))

	sent := MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, prior), held)
	if got := unmanagedFirstStep(sent)["dnsMonitor"].(map[string]interface{})["port"]; got != float64(5353) {
		t.Fatalf("with no state to tell what the configuration took out, the port OneUptime holds was not kept: %v", got)
	}
}

func TestMonitorStepsKeepUnmanaged_ACriteriasAndAFiltersJSONSettings(t *testing.T) {
	ctx := context.Background()
	snmpFilter := func(checkOn string, options map[string]interface{}) map[string]interface{} {
		return map[string]interface{}{"checkOn": checkOn, "filterType": "Greater Than", "value": "90", "snmpMonitorOptions": options}
	}
	criteria := func(grouping map[string]interface{}, filter map[string]interface{}) map[string]interface{} {
		extra := map[string]interface{}{"filters": []interface{}{filter}}
		if grouping != nil {
			extra["incidentGrouping"] = grouping
		}
		return unmanagedOffline(extra)
	}
	steps := func(one map[string]interface{}) map[string]interface{} {
		return unmanagedStepsWire(unmanagedStepWire(nil, one))
	}
	heldCriteria := criteria(
		map[string]interface{}{"groupByJSONPath": "$.alertname", "maxGroups": float64(50)},
		snmpFilter("SNMP Interface Utilization (in %)", map[string]interface{}{"interfaceName": "eth0", "direction": "in"}),
	)
	held := unmanagedHeld(t, steps(heldCriteria))

	t.Run("more inside each is kept", func(t *testing.T) {
		planned := steps(criteria(
			map[string]interface{}{"groupByJSONPath": "$.alertname"},
			snmpFilter("SNMP Interface Utilization (in %)", map[string]interface{}{"interfaceName": "eth0"}),
		))
		offline := unmanagedCriteriaNamed(MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, planned), held), "Offline")
		if got := offline["incidentGrouping"].(map[string]interface{})["maxGroups"]; got != float64(50) {
			t.Fatalf("the grouping lost what OneUptime holds more: %v", offline["incidentGrouping"])
		}
		filter := offline["filters"].([]interface{})[0].(map[string]interface{})
		if got := filter["snmpMonitorOptions"].(map[string]interface{})["direction"]; got != "in" {
			t.Fatalf("the filter's options lost what OneUptime holds more: %v", filter["snmpMonitorOptions"])
		}
	})

	t.Run("a filter at the place of one that checks another thing takes nothing of it", func(t *testing.T) {
		planned := steps(criteria(nil, snmpFilter("SNMP Interface Errors (per second)", map[string]interface{}{"interfaceName": "eth0"})))
		offline := unmanagedCriteriaNamed(MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, planned), held), "Offline")
		filter := offline["filters"].([]interface{})[0].(map[string]interface{})
		if _, leaked := filter["snmpMonitorOptions"].(map[string]interface{})["direction"]; leaked {
			t.Fatalf("a filter that checks another thing took the held one's options: %v", filter["snmpMonitorOptions"])
		}
	})

	t.Run("a grouping the configuration does not write is the plan's to remove", func(t *testing.T) {
		planned := steps(criteria(nil, snmpFilter("SNMP Interface Utilization (in %)", map[string]interface{}{"interfaceName": "eth0"})))
		offline := unmanagedCriteriaNamed(MonitorStepsKeepUnmanaged(ctx, unmanagedOutgoing(t, planned), unmanagedPrior(t, planned), held), "Offline")
		if grouping, kept := offline["incidentGrouping"]; kept {
			t.Fatalf("kept the grouping %v, which the plan shows going", grouping)
		}
	})
}

// Through the protocol server: a DNS monitor's query, written with jsonencode().
func unmanagedDNSConfig(t *testing.T, tf *stepValuesTerraform, query map[string]interface{}, criteria ...map[string]interface{}) tftypes.Value {
	t.Helper()
	return recoveryHoursConfig(tf, "Shop", unmanagedConfiguredSteps(t, tf, map[string]interface{}{"dnsMonitor": query}, criteria...))
}

func TestMonitorStepsUnmanaged_AKeySetInTheDashboardInsideAJSONSettingSurvivesAnApply(t *testing.T) {
	api := newStepValuesAPI(t)
	api.storeSteps = unmanagedServerIDs()
	tf := newStepValuesTerraform(t, api)

	written := unmanagedQuery("queryName", "example.com", "recordType", "A")
	created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, unmanagedDNSConfig(t, tf, written, unmanagedOffline(nil), unmanagedOnline(nil)))
	id := stringAttribute(t, created.state, "id")

	unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
		query := unmanagedFirstStep(steps)["dnsMonitor"].(map[string]interface{})
		query["dnsServers"] = []interface{}{"1.1.1.1"}
		query["port"] = float64(53)
	})

	// No change: the configuration's query says what it says.
	refreshed := tf.refresh("oneuptime_monitor", created)
	if changed := tf.changes("oneuptime_monitor", refreshed, unmanagedDNSConfig(t, tf, written, unmanagedOffline(nil), unmanagedOnline(nil))); len(changed) > 0 {
		t.Fatalf("a key added inside the query plans %v", changed)
	}

	// An apply that changes the criteria keeps it.
	config := unmanagedDNSConfig(t, tf, written, unmanagedOffline(map[string]interface{}{"monitorStatusId": unmanagedSeverity}), unmanagedOnline(nil))
	applied := tf.apply("oneuptime_monitor", refreshed, config)

	want := monitorStepsTestNormalizeJSON(t, unmanagedQuery("queryName", "example.com", "recordType", "A", "dnsServers", []interface{}{"1.1.1.1"}, "port", float64(53)))
	if got := unmanagedFirstStep(unmanagedStoredSteps(t, api, "/monitor", id))["dnsMonitor"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("after the apply OneUptime holds the query %v, not %v", got, want)
	}
	requireStepsAsConfigured(t, "after the apply", applied, config)
	if changed := tf.changes("oneuptime_monitor", tf.refresh("oneuptime_monitor", applied), config); len(changed) > 0 {
		t.Fatalf("the plan after the apply changes %v", changed)
	}

	// A key the configuration takes out goes, and what the Dashboard set stays.
	narrower := unmanagedDNSConfig(t, tf, unmanagedQuery("queryName", "example.com"), unmanagedOffline(map[string]interface{}{"monitorStatusId": unmanagedSeverity}), unmanagedOnline(nil))
	reread := tf.refresh("oneuptime_monitor", applied)
	if changed := tf.changes("oneuptime_monitor", reread, narrower); !containsString(changed, "monitor_steps") {
		t.Fatalf("a key taken out of the query plans %v", changed)
	}
	tf.apply("oneuptime_monitor", reread, narrower)
	want = monitorStepsTestNormalizeJSON(t, unmanagedQuery("queryName", "example.com", "dnsServers", []interface{}{"1.1.1.1"}, "port", float64(53)))
	if got := unmanagedFirstStep(unmanagedStoredSteps(t, api, "/monitor", id))["dnsMonitor"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("after taking recordType out OneUptime holds the query %v, not %v", got, want)
	}
}

func TestMonitorStepsUnmanaged_WhatOneUptimeAddsToAJSONSettingOfItsOwnIsNoChange(t *testing.T) {
	api := newStepValuesAPI(t)
	ids := unmanagedServerIDs()
	// As the server answers a Security Events step: with the watchlist filters it holds, none when none were sent.
	api.storeSteps = func(held interface{}, sent interface{}) interface{} {
		stored := ids(held, sent)
		for _, step := range monitorStepsItems(stored, "monitorStepsInstanceArray") {
			if query, ok := monitorStepsWireValue(step)["securityEventsMonitor"].(map[string]interface{}); ok {
				if _, holds := query["watchlistFilters"]; !holds {
					query["watchlistFilters"] = []interface{}{}
				}
			}
		}
		return stored
	}
	tf := newStepValuesTerraform(t, api)

	query := unmanagedQuery("messageContains", "Failed password", "lastXSecondsOfEvents", float64(300))
	bruteForce := map[string]interface{}{
		"name":            "Brute force",
		"filterCondition": "All",
		"filters":         []interface{}{map[string]interface{}{"checkOn": "Security Event Count", "filterType": "Greater Than", "value": "20"}},
	}
	config := tf.config("oneuptime_monitor", "name", "Security Events", unmanagedConfiguredSteps(t, tf, map[string]interface{}{"securityEventsMonitor": query}, bruteForce))
	created := tf.apply("oneuptime_monitor", settled{state: tftypes.NewValue(tf.objectType("oneuptime_monitor"), nil)}, config)
	id := stringAttribute(t, created.state, "id")
	requireStepsAsConfigured(t, "after the create", created, config)

	refreshed := tf.refresh("oneuptime_monitor", created)
	if changed := tf.changes("oneuptime_monitor", refreshed, config); len(changed) > 0 {
		t.Fatalf("the watchlist filters OneUptime adds plan %v", changed)
	}

	// A watchlist filter set in the Dashboard survives an apply that changes the criteria.
	filter := map[string]interface{}{"watchlistId": "a1000000-0000-4000-8000-000000010992", "field": "sourceIp"}
	unmanagedInTheDashboard(t, api, "/monitor", id, func(steps interface{}) {
		unmanagedFirstStep(steps)["securityEventsMonitor"].(map[string]interface{})["watchlistFilters"] = []interface{}{filter}
	})
	bruteForce["filters"] = []interface{}{map[string]interface{}{"checkOn": "Security Event Count", "filterType": "Greater Than", "value": "50"}}
	stricter := tf.config("oneuptime_monitor", "name", "Security Events", unmanagedConfiguredSteps(t, tf, map[string]interface{}{"securityEventsMonitor": query}, bruteForce))
	applied := tf.apply("oneuptime_monitor", tf.refresh("oneuptime_monitor", refreshed), stricter)

	held := unmanagedFirstStep(unmanagedStoredSteps(t, api, "/monitor", id))["securityEventsMonitor"].(map[string]interface{})
	if !reflect.DeepEqual(held["watchlistFilters"], monitorStepsTestNormalizeJSON(t, []interface{}{filter})) {
		t.Fatalf("after the apply OneUptime holds the watchlist filters %v", held["watchlistFilters"])
	}
	requireStepsAsConfigured(t, "after the apply", applied, stricter)
}
