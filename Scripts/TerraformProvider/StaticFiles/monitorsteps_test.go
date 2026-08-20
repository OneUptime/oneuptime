package provider

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func monitorStepsTestObj(t *testing.T, attrTypes map[string]attr.Type, overrides map[string]attr.Value) types.Object {
	t.Helper()
	attrs := monitorStepsNullAttrValues(attrTypes)
	for k, v := range overrides {
		if _, ok := attrs[k]; !ok {
			t.Fatalf("unknown attribute %q in overrides", k)
		}
		attrs[k] = v
	}
	obj, d := types.ObjectValue(attrTypes, attrs)
	if d.HasError() {
		t.Fatalf("ObjectValue diagnostics: %v", d)
	}
	return obj
}

func monitorStepsTestStrList(t *testing.T, vals ...string) types.List {
	t.Helper()
	els := make([]attr.Value, 0, len(vals))
	for _, v := range vals {
		els = append(els, types.StringValue(v))
	}
	l, d := types.ListValue(types.StringType, els)
	if d.HasError() {
		t.Fatalf("ListValue diagnostics: %v", d)
	}
	return l
}

func monitorStepsTestObjList(t *testing.T, attrTypes map[string]attr.Type, objs ...types.Object) types.List {
	t.Helper()
	els := make([]attr.Value, 0, len(objs))
	for _, o := range objs {
		els = append(els, o)
	}
	l, d := types.ListValue(types.ObjectType{AttrTypes: attrTypes}, els)
	if d.HasError() {
		t.Fatalf("ListValue diagnostics: %v", d)
	}
	return l
}

func monitorStepsTestStrMap(t *testing.T, vals map[string]string) types.Map {
	t.Helper()
	els := make(map[string]attr.Value, len(vals))
	for k, v := range vals {
		els[k] = types.StringValue(v)
	}
	m, d := types.MapValue(types.StringType, els)
	if d.HasError() {
		t.Fatalf("MapValue diagnostics: %v", d)
	}
	return m
}

func monitorStepsTestList(t *testing.T, steps ...types.Object) types.List {
	t.Helper()
	return monitorStepsTestObjList(t, monitorStepsStepAttrTypes(), steps...)
}

// monitorStepsTestJSONCopy deep-copies a wire value through JSON, which also
// normalizes all numbers to float64 exactly like a decoded API response.
func monitorStepsTestJSONCopy(t *testing.T, v interface{}) map[string]interface{} {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func monitorStepsTestNormalizeJSON(t *testing.T, v interface{}) interface{} {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func monitorStepsTestFatalOnDiagError(t *testing.T, label string, diags diag.Diagnostics) {
	t.Helper()
	if diags.HasError() {
		t.Fatalf("%s returned error diagnostics: %v", label, diags)
	}
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

// monitorStepsMinimalUserList is the smallest realistic config: destination +
// type and a single criteria with a single filter. Everything else stays
// null.
func monitorStepsMinimalUserList(t *testing.T) types.List {
	t.Helper()

	filterObj := monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
		"check_on":    types.StringValue("Is Online"),
		"filter_type": types.StringValue("True"),
	})
	criteriaObj := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":             types.StringValue("Online"),
		"filter_condition": types.StringValue("All"),
		"filters":          monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(), filterObj),
	})
	stepObj := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), map[string]attr.Value{
		"monitor_destination":      types.StringValue("8.8.8.8"),
		"monitor_destination_type": types.StringValue("IP"),
		"criteria":                 monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), criteriaObj),
	})
	return monitorStepsTestList(t, stepObj)
}

// monitorStepsFullUserList populates every schema attribute.
func monitorStepsFullUserList(t *testing.T) types.List {
	t.Helper()

	onlineFilters := monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(),
		monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
			"check_on":    types.StringValue("Is Online"),
			"filter_type": types.StringValue("True"),
		}),
		monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
			"check_on":                          types.StringValue("Response Status Code"),
			"filter_type":                       types.StringValue("Equal To"),
			"value":                             types.StringValue("200"),
			"evaluate_over_time":                types.BoolValue(true),
			"evaluate_over_time_minutes":        types.Int64Value(5),
			"evaluate_over_time_type":           types.StringValue("Average"),
			"evaluate_over_time_no_data_policy": types.StringValue("Trigger"),
		}),
	)

	offlineFilters := monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(),
		monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
			"check_on":    types.StringValue("Is Online"),
			"filter_type": types.StringValue("False"),
		}),
		monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
			"check_on":               types.StringValue("Disk Usage (in %)"),
			"filter_type":            types.StringValue("Greater Than"),
			"value":                  types.StringValue("90"),
			"disk_path":              types.StringValue("/"),
			"metric_monitor_options": types.StringValue(`{"metricAlias":"m1"}`),
			"snmp_monitor_options":   types.StringValue(`{"oid":"1.3.6.1"}`),
		}),
	)

	incident := monitorStepsTestObj(t, monitorStepsIncidentAttrTypes(), map[string]attr.Value{
		"title":                        types.StringValue("Site is down"),
		"description":                  types.StringValue("The site did not respond."),
		"incident_severity_id":         types.StringValue("sev-1"),
		"auto_resolve_incident":        types.BoolValue(true),
		"remediation_notes":            types.StringValue("Check the load balancer."),
		"on_call_policy_ids":           monitorStepsTestStrList(t, "ocp-1", "ocp-2"),
		"label_ids":                    monitorStepsTestStrList(t, "lbl-1"),
		"owner_team_ids":               monitorStepsTestStrList(t, "team-1"),
		"owner_user_ids":               monitorStepsTestStrList(t, "user-1"),
		"show_incident_on_status_page": types.BoolValue(true),
		"is_private":                   types.BoolValue(false),
	})

	alert := monitorStepsTestObj(t, monitorStepsAlertAttrTypes(), map[string]attr.Value{
		"title":              types.StringValue("Site is down (alert)"),
		"description":        types.StringValue("The site did not respond (alert)."),
		"alert_severity_id":  types.StringValue("asev-1"),
		"auto_resolve_alert": types.BoolValue(true),
		"remediation_notes":  types.StringValue("Restart the pod."),
		"on_call_policy_ids": monitorStepsTestStrList(t, "ocp-3"),
		"label_ids":          monitorStepsTestStrList(t, "lbl-2"),
		"owner_team_ids":     monitorStepsTestStrList(t, "team-2"),
		"owner_user_ids":     monitorStepsTestStrList(t, "user-2"),
		"is_private":         types.BoolValue(true),
	})

	onlineCriteria := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":                  types.StringValue("Online"),
		"description":           types.StringValue("Website responds with 200."),
		"filter_condition":      types.StringValue("All"),
		"monitor_status_id":     types.StringValue("status-operational"),
		"change_monitor_status": types.BoolValue(true),
		"create_incidents":      types.BoolValue(false),
		"create_alerts":         types.BoolValue(false),
		"is_enabled":            types.BoolValue(true),
		"filters":               onlineFilters,
	})

	offlineCriteria := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":                  types.StringValue("Offline"),
		"description":           types.StringValue("Website is unreachable."),
		"filter_condition":      types.StringValue("Any"),
		"monitor_status_id":     types.StringValue("status-offline"),
		"change_monitor_status": types.BoolValue(true),
		"create_incidents":      types.BoolValue(true),
		"create_alerts":         types.BoolValue(true),
		"is_enabled":            types.BoolValue(true),
		"incident_grouping":     types.StringValue(`{"groupByJSONPath":"requestBody.alerts[*].labels.alertname"}`),
		"filters":               offlineFilters,
		"incidents":             monitorStepsTestObjList(t, monitorStepsIncidentAttrTypes(), incident),
		"alerts":                monitorStepsTestObjList(t, monitorStepsAlertAttrTypes(), alert),
	})

	stepOverrides := map[string]attr.Value{
		"monitor_destination":            types.StringValue("https://example.com"),
		"monitor_destination_type":       types.StringValue("URL"),
		"port":                           types.Int64Value(443),
		"request_type":                   types.StringValue("POST"),
		"request_headers":                monitorStepsTestStrMap(t, map[string]string{"Content-Type": "application/json", "X-Token": "abc"}),
		"request_body":                   types.StringValue(`{"ping":"pong"}`),
		"do_not_follow_redirects":        types.BoolValue(true),
		"allow_self_signed_certificates": types.BoolValue(true),
		"tls_client_certificate":         types.StringValue("PEM-CERT"),
		"tls_client_key":                 types.StringValue("PEM-KEY"),
		"tls_client_key_passphrase":      types.StringValue("passphrase"),
		"custom_code":                    types.StringValue("console.log('hi');"),
		"screen_size_types":              monitorStepsTestStrList(t, "Desktop", "Mobile"),
		"browser_types":                  monitorStepsTestStrList(t, "Chromium"),
		"retry_count_on_error":           types.Int64Value(2),
		"request_timeout_in_ms":          types.Int64Value(30000),
		"retry_count":                    types.Int64Value(2),
		"criteria":                       monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), onlineCriteria, offlineCriteria),
	}
	for _, sub := range monitorStepsSubConfigs {
		stepOverrides[sub.tfName] = types.StringValue(`{"key":"` + sub.tfName + `"}`)
	}

	step := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), stepOverrides)
	return monitorStepsTestList(t, step)
}

// ---------------------------------------------------------------------------
// Schema sanity
// ---------------------------------------------------------------------------

func TestMonitorStepsSchemaAttributeMatchesListType(t *testing.T) {
	attribute := MonitorStepsSchemaAttribute("MonitorSteps object")

	if !attribute.Optional {
		t.Fatal("monitor_steps attribute must be Optional")
	}
	if attribute.Required {
		t.Fatal("monitor_steps attribute must not be Required")
	}
	if attribute.MarkdownDescription != "MonitorSteps object" {
		t.Fatalf("unexpected description: %q", attribute.MarkdownDescription)
	}

	schemaType := attribute.GetType()
	listType := MonitorStepsListType()
	if !schemaType.Equal(listType) {
		t.Fatalf("schema type %s != MonitorStepsListType %s", schemaType, listType)
	}
}

func TestMonitorStepsNullIsTypedNull(t *testing.T) {
	null := MonitorStepsNull()
	if !null.IsNull() {
		t.Fatal("MonitorStepsNull must be null")
	}
	// The custom-typed null used by generated code carries MonitorStepsType.
	customNull := NewMonitorStepsValueNull()
	if !customNull.IsNull() {
		t.Fatal("NewMonitorStepsValueNull must be null")
	}
	if !customNull.Type(context.Background()).Equal(MonitorStepsListType()) {
		t.Fatalf("custom null type %s != MonitorStepsListType %s", customNull.Type(context.Background()), MonitorStepsListType())
	}
}

// ---------------------------------------------------------------------------
// ToAPI: null / unknown
// ---------------------------------------------------------------------------

func TestMonitorStepsToAPINullAndUnknown(t *testing.T) {
	ctx := context.Background()

	out, diags := MonitorStepsToAPI(ctx, MonitorStepsNull())
	monitorStepsTestFatalOnDiagError(t, "ToAPI(null)", diags)
	if out != nil {
		t.Fatalf("ToAPI(null) = %#v, want nil", out)
	}

	unknown := types.ListUnknown(types.ObjectType{AttrTypes: monitorStepsStepAttrTypes()})
	out, diags = MonitorStepsToAPI(ctx, unknown)
	monitorStepsTestFatalOnDiagError(t, "ToAPI(unknown)", diags)
	if out != nil {
		t.Fatalf("ToAPI(unknown) = %#v, want nil", out)
	}
}

// ---------------------------------------------------------------------------
// Round-trip: fully populated
// ---------------------------------------------------------------------------

func TestMonitorStepsRoundTripFullyPopulated(t *testing.T) {
	ctx := context.Background()
	original := monitorStepsFullUserList(t)

	wire, diags := MonitorStepsToAPI(ctx, original)
	monitorStepsTestFatalOnDiagError(t, "ToAPI", diags)
	if wire == nil {
		t.Fatal("ToAPI returned nil for a populated list")
	}

	subConfigsGolden := ""
	for _, sub := range monitorStepsSubConfigs {
		subConfigsGolden += `"` + sub.apiKey + `":{"key":"` + sub.tfName + `"},`
	}

	golden := `{
	  "_type": "MonitorSteps",
	  "value": {
	    "monitorStepsInstanceArray": [
	      {
	        "_type": "MonitorStep",
	        "value": {
	          "monitorDestination": {"_type": "URL", "value": "https://example.com"},
	          "monitorDestinationPort": {"_type": "Port", "value": 443},
	          "requestType": "POST",
	          "requestHeaders": {"Content-Type": "application/json", "X-Token": "abc"},
	          "requestBody": "{\"ping\":\"pong\"}",
	          "doNotFollowRedirects": true,
	          "allowSelfSignedCertificates": true,
	          "tlsClientCertificate": "PEM-CERT",
	          "tlsClientKey": "PEM-KEY",
	          "tlsClientKeyPassphrase": "passphrase",
	          "customCode": "console.log('hi');",
	          "screenSizeTypes": ["Desktop", "Mobile"],
	          "browserTypes": ["Chromium"],
	          "retryCountOnError": 2,
	          "requestTimeoutInMs": 30000,
	          "retryCount": 2,
	          ` + subConfigsGolden + `
	          "monitorCriteria": {
	            "_type": "MonitorCriteria",
	            "value": {
	              "monitorCriteriaInstanceArray": [
	                {
	                  "_type": "MonitorCriteriaInstance",
	                  "value": {
	                    "name": "Online",
	                    "description": "Website responds with 200.",
	                    "filterCondition": "All",
	                    "monitorStatusId": "status-operational",
	                    "changeMonitorStatus": true,
	                    "createIncidents": false,
	                    "createAlerts": false,
	                    "isEnabled": true,
	                    "filters": [
	                      {"checkOn": "Is Online", "filterType": "True"},
	                      {
	                        "checkOn": "Response Status Code",
	                        "filterType": "Equal To",
	                        "value": "200",
	                        "evaluateOverTime": true,
	                        "evaluateOverTimeOptions": {"timeValueInMinutes": 5, "evaluateOverTimeType": "Average", "onNoDataPolicy": "Trigger"}
	                      }
	                    ]
	                  }
	                },
	                {
	                  "_type": "MonitorCriteriaInstance",
	                  "value": {
	                    "name": "Offline",
	                    "description": "Website is unreachable.",
	                    "filterCondition": "Any",
	                    "monitorStatusId": "status-offline",
	                    "changeMonitorStatus": true,
	                    "createIncidents": true,
	                    "createAlerts": true,
	                    "isEnabled": true,
	                    "incidentGrouping": {"groupByJSONPath": "requestBody.alerts[*].labels.alertname"},
	                    "filters": [
	                      {"checkOn": "Is Online", "filterType": "False"},
	                      {
	                        "checkOn": "Disk Usage (in %)",
	                        "filterType": "Greater Than",
	                        "value": "90",
	                        "serverMonitorOptions": {"diskPath": "/"},
	                        "metricMonitorOptions": {"metricAlias": "m1"},
	                        "snmpMonitorOptions": {"oid": "1.3.6.1"}
	                      }
	                    ],
	                    "incidents": [
	                      {
	                        "title": "Site is down",
	                        "description": "The site did not respond.",
	                        "incidentSeverityId": "sev-1",
	                        "autoResolveIncident": true,
	                        "remediationNotes": "Check the load balancer.",
	                        "onCallPolicyIds": ["ocp-1", "ocp-2"],
	                        "labelIds": ["lbl-1"],
	                        "ownerTeamIds": ["team-1"],
	                        "ownerUserIds": ["user-1"],
	                        "showIncidentOnStatusPage": true,
	                        "isPrivate": false
	                      }
	                    ],
	                    "alerts": [
	                      {
	                        "title": "Site is down (alert)",
	                        "description": "The site did not respond (alert).",
	                        "alertSeverityId": "asev-1",
	                        "autoResolveAlert": true,
	                        "remediationNotes": "Restart the pod.",
	                        "onCallPolicyIds": ["ocp-3"],
	                        "labelIds": ["lbl-2"],
	                        "ownerTeamIds": ["team-2"],
	                        "ownerUserIds": ["user-2"],
	                        "isPrivate": true
	                      }
	                    ]
	                  }
	                }
	              ]
	            }
	          }
	        }
	      }
	    ]
	  }
	}`

	var goldenParsed interface{}
	if err := json.Unmarshal([]byte(golden), &goldenParsed); err != nil {
		t.Fatalf("golden JSON does not parse: %v", err)
	}
	actual := monitorStepsTestNormalizeJSON(t, wire)
	if !reflect.DeepEqual(actual, goldenParsed) {
		actualJSON, _ := json.MarshalIndent(actual, "", "  ")
		goldenJSON, _ := json.MarshalIndent(goldenParsed, "", "  ")
		t.Fatalf("wire envelope mismatch.\nactual:\n%s\ngolden:\n%s", actualJSON, goldenJSON)
	}

	// The envelope must never contain server-generated ids.
	wireJSON, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("marshal wire: %v", err)
	}
	var idProbe map[string]interface{}
	if err := json.Unmarshal(wireJSON, &idProbe); err != nil {
		t.Fatalf("unmarshal wire: %v", err)
	}
	assertNoIDKeys(t, idProbe, "$")

	// Full round trip.
	back, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, wire))
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)
	if !back.Equal(original) {
		t.Fatalf("round trip mismatch.\noriginal: %s\nback:     %s", original, back)
	}
}

func assertNoIDKeys(t *testing.T, v interface{}, at string) {
	t.Helper()
	switch tv := v.(type) {
	case map[string]interface{}:
		for k, child := range tv {
			if k == "id" {
				t.Fatalf("wire envelope contains an id key at %s", at)
			}
			assertNoIDKeys(t, child, at+"."+k)
		}
	case []interface{}:
		for i, child := range tv {
			assertNoIDKeys(t, child, at+"["+string(rune('0'+i%10))+"]")
		}
	}
}

// ---------------------------------------------------------------------------
// Round-trip: minimal, unset optionals stay null
// ---------------------------------------------------------------------------

func TestMonitorStepsRoundTripMinimal(t *testing.T) {
	ctx := context.Background()
	original := monitorStepsMinimalUserList(t)

	wire, diags := MonitorStepsToAPI(ctx, original)
	monitorStepsTestFatalOnDiagError(t, "ToAPI", diags)

	golden := `{
	  "_type": "MonitorSteps",
	  "value": {
	    "monitorStepsInstanceArray": [
	      {
	        "_type": "MonitorStep",
	        "value": {
	          "monitorDestination": {"_type": "IP", "value": "8.8.8.8"},
	          "monitorCriteria": {
	            "_type": "MonitorCriteria",
	            "value": {
	              "monitorCriteriaInstanceArray": [
	                {
	                  "_type": "MonitorCriteriaInstance",
	                  "value": {
	                    "name": "Online",
	                    "filterCondition": "All",
	                    "filters": [{"checkOn": "Is Online", "filterType": "True"}]
	                  }
	                }
	              ]
	            }
	          }
	        }
	      }
	    ]
	  }
	}`
	var goldenParsed interface{}
	if err := json.Unmarshal([]byte(golden), &goldenParsed); err != nil {
		t.Fatalf("golden JSON does not parse: %v", err)
	}
	if actual := monitorStepsTestNormalizeJSON(t, wire); !reflect.DeepEqual(actual, goldenParsed) {
		actualJSON, _ := json.MarshalIndent(actual, "", "  ")
		t.Fatalf("minimal wire envelope mismatch:\n%s", actualJSON)
	}

	back, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, wire))
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)
	if !back.Equal(original) {
		t.Fatalf("minimal round trip mismatch.\noriginal: %s\nback:     %s", original, back)
	}

	// Spot-check that unset optionals really are null after the round trip.
	stepAttrs := back.Elements()[0].(types.Object).Attributes()
	for _, name := range []string{"request_type", "request_body", "port", "custom_code", "log_monitor", "request_headers"} {
		v := stepAttrs[name]
		if !v.IsNull() {
			t.Fatalf("step attribute %q should be null after round trip, got %s", name, v)
		}
	}
	criteriaAttrs := stepAttrs["criteria"].(types.List).Elements()[0].(types.Object).Attributes()
	for _, name := range []string{"description", "monitor_status_id", "change_monitor_status", "create_incidents", "create_alerts", "is_enabled", "incidents", "alerts", "incident_grouping"} {
		v := criteriaAttrs[name]
		if !v.IsNull() {
			t.Fatalf("criteria attribute %q should be null after round trip, got %s", name, v)
		}
	}
	filterAttrs := criteriaAttrs["filters"].(types.List).Elements()[0].(types.Object).Attributes()
	for _, name := range []string{"value", "evaluate_over_time", "evaluate_over_time_minutes", "evaluate_over_time_type", "evaluate_over_time_no_data_policy", "disk_path", "metric_monitor_options", "snmp_monitor_options"} {
		v := filterAttrs[name]
		if !v.IsNull() {
			t.Fatalf("filter attribute %q should be null after round trip, got %s", name, v)
		}
	}
}

// ---------------------------------------------------------------------------
// FromAPI drops server extras
// ---------------------------------------------------------------------------

func TestMonitorStepsFromAPIDropsServerExtras(t *testing.T) {
	ctx := context.Background()
	original := monitorStepsMinimalUserList(t)

	wire, diags := MonitorStepsToAPI(ctx, original)
	monitorStepsTestFatalOnDiagError(t, "ToAPI", diags)

	// Simulate everything the server adds to a stored monitorSteps object:
	// generated ids at every level, the hydrated snmpMonitor carrier,
	// echoed empty containers, evaluation-time context and unknown keys.
	response := monitorStepsTestJSONCopy(t, wire)
	value := response["value"].(map[string]interface{})
	value["defaultMonitorStatusId"] = "64df2b8f0e3a4b0012345678"

	step := value["monitorStepsInstanceArray"].([]interface{})[0].(map[string]interface{})
	stepValue := step["value"].(map[string]interface{})
	stepValue["id"] = "64df2b8f0e3a4b0087654321"
	stepValue["snmpMonitor"] = map[string]interface{}{
		"hostname": "10.0.0.1",
		"port":     float64(161),
	}
	stepValue["someFutureKey"] = "ignore-me"
	stepValue["requestHeaders"] = map[string]interface{}{} // echoed empty map

	criteria := stepValue["monitorCriteria"].(map[string]interface{})["value"].(map[string]interface{})
	instance := criteria["monitorCriteriaInstanceArray"].([]interface{})[0].(map[string]interface{})
	instanceValue := instance["value"].(map[string]interface{})
	instanceValue["id"] = "64df2b8f0e3a4b0011112222"
	instanceValue["incidents"] = []interface{}{} // echoed empty array
	instanceValue["alerts"] = []interface{}{}    // echoed empty array
	instanceValue["someUnknownCriteriaKey"] = true

	filter := instanceValue["filters"].([]interface{})[0].(map[string]interface{})
	filter["metricCriteriaContext"] = map[string]interface{}{"metricName": "cpu"}
	filter["someUnknownFilterKey"] = float64(42)

	back, diags := MonitorStepsFromAPI(ctx, response)
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)
	if !back.Equal(original) {
		t.Fatalf("server extras caused drift.\noriginal: %s\nback:     %s", original, back)
	}
}

// A monitor created without monitor_steps gets server-default steps whose
// telemetry sub-configs (logMonitor & co.) are populated. Importing such a
// monitor maps them into the matching escape hatches.
func TestMonitorStepsFromAPIMapsInjectedSubConfigs(t *testing.T) {
	ctx := context.Background()

	logMonitor := map[string]interface{}{
		"attributes":          map[string]interface{}{},
		"body":                "",
		"severityTexts":       []interface{}{},
		"telemetryServiceIds": []interface{}{},
		"lastXSecondsOfLogs":  float64(60),
	}
	response := map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{
					"_type": "MonitorStep",
					"value": map[string]interface{}{
						"id":          "server-generated",
						"requestType": "GET",
						"logMonitor":  logMonitor,
					},
				},
			},
		},
	}

	list, diags := MonitorStepsFromAPI(ctx, response)
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)

	attrs := list.Elements()[0].(types.Object).Attributes()
	got := attrs["log_monitor"].(types.String)
	if got.IsNull() {
		t.Fatal("log_monitor should be mapped from the response")
	}
	expected, err := json.Marshal(logMonitor)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got.ValueString() != string(expected) {
		t.Fatalf("log_monitor = %q, want %q", got.ValueString(), string(expected))
	}
	if rt := attrs["request_type"].(types.String); rt.ValueString() != "GET" {
		t.Fatalf("request_type = %s, want GET", rt)
	}
	// Other escape hatches stay null.
	if !attrs["exception_monitor"].(types.String).IsNull() {
		t.Fatal("exception_monitor should stay null")
	}
}

// ---------------------------------------------------------------------------
// FromAPI input forms
// ---------------------------------------------------------------------------

func TestMonitorStepsFromAPIInputForms(t *testing.T) {
	ctx := context.Background()
	original := monitorStepsMinimalUserList(t)
	wire, diags := MonitorStepsToAPI(ctx, original)
	monitorStepsTestFatalOnDiagError(t, "ToAPI", diags)
	envelope := monitorStepsTestJSONCopy(t, wire)

	t.Run("nil", func(t *testing.T) {
		list, diags := MonitorStepsFromAPI(ctx, nil)
		monitorStepsTestFatalOnDiagError(t, "FromAPI(nil)", diags)
		if !list.IsNull() {
			t.Fatalf("FromAPI(nil) = %s, want null", list)
		}
	})

	t.Run("wrapper envelope", func(t *testing.T) {
		list, diags := MonitorStepsFromAPI(ctx, envelope)
		monitorStepsTestFatalOnDiagError(t, "FromAPI(envelope)", diags)
		if !list.Equal(original) {
			t.Fatalf("FromAPI(envelope) mismatch: %s", list)
		}
	})

	t.Run("bare value map", func(t *testing.T) {
		bare := envelope["value"].(map[string]interface{})
		list, diags := MonitorStepsFromAPI(ctx, bare)
		monitorStepsTestFatalOnDiagError(t, "FromAPI(bare)", diags)
		if !list.Equal(original) {
			t.Fatalf("FromAPI(bare) mismatch: %s", list)
		}
	})

	t.Run("empty envelope means unset", func(t *testing.T) {
		list, diags := MonitorStepsFromAPI(ctx, map[string]interface{}{"_type": "MonitorSteps", "value": nil})
		monitorStepsTestFatalOnDiagError(t, "FromAPI(empty envelope)", diags)
		if !list.IsNull() {
			t.Fatalf("FromAPI(empty envelope) = %s, want null", list)
		}
	})

	t.Run("garbage", func(t *testing.T) {
		garbage := []interface{}{
			"not-a-monitor-steps",
			float64(42),
			true,
			[]interface{}{"nope"},
			map[string]interface{}{"foo": "bar"},
			map[string]interface{}{"monitorStepsInstanceArray": "not-an-array"},
		}
		for _, g := range garbage {
			list, diags := MonitorStepsFromAPI(ctx, g) // must not panic
			if !diags.HasError() {
				t.Fatalf("FromAPI(%#v) should return error diagnostics", g)
			}
			if !list.IsNull() {
				t.Fatalf("FromAPI(%#v) = %s, want null", g, list)
			}
		}
	})
}

// ---------------------------------------------------------------------------
// FromAPI value coercions
// ---------------------------------------------------------------------------

func TestMonitorStepsFromAPINumericFilterValues(t *testing.T) {
	ctx := context.Background()
	response := map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{
					"_type": "MonitorStep",
					"value": map[string]interface{}{
						"monitorCriteria": map[string]interface{}{
							"_type": "MonitorCriteria",
							"value": map[string]interface{}{
								"monitorCriteriaInstanceArray": []interface{}{
									map[string]interface{}{
										"_type": "MonitorCriteriaInstance",
										"value": map[string]interface{}{
											"name":            "Numbers",
											"filterCondition": "All",
											"filters": []interface{}{
												map[string]interface{}{"checkOn": "Response Status Code", "filterType": "Equal To", "value": float64(200)},
												map[string]interface{}{"checkOn": "Response Time (in ms)", "filterType": "Less Than", "value": float64(99.5)},
												map[string]interface{}{"checkOn": "Response Body", "filterType": "Contains", "value": "ok"},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	list, diags := MonitorStepsFromAPI(ctx, response)
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)

	filters := list.Elements()[0].(types.Object).Attributes()["criteria"].(types.List).
		Elements()[0].(types.Object).Attributes()["filters"].(types.List).Elements()

	expected := []string{"200", "99.5", "ok"}
	for i, want := range expected {
		got := filters[i].(types.Object).Attributes()["value"].(types.String)
		if got.IsNull() || got.ValueString() != want {
			t.Fatalf("filter[%d].value = %s, want %q", i, got, want)
		}
	}
}

func TestMonitorStepsFromAPIObjectIDWrappers(t *testing.T) {
	ctx := context.Background()
	response := map[string]interface{}{
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{
					"_type": "MonitorStep",
					"value": map[string]interface{}{
						"monitorDestination":     map[string]interface{}{"_type": "Hostname", "value": "example.com"},
						"monitorDestinationPort": map[string]interface{}{"_type": "Port", "value": float64(443)},
						"monitorCriteria": map[string]interface{}{
							"_type": "MonitorCriteria",
							"value": map[string]interface{}{
								"monitorCriteriaInstanceArray": []interface{}{
									map[string]interface{}{
										"_type": "MonitorCriteriaInstance",
										"value": map[string]interface{}{
											"name":            "Wrapped ids",
											"filterCondition": "Any",
											"monitorStatusId": map[string]interface{}{"value": "status-1"},
											"filters": []interface{}{
												map[string]interface{}{"checkOn": "Is Online", "filterType": "False"},
											},
											"incidents": []interface{}{
												map[string]interface{}{
													"id":                 "incident-template-id",
													"title":              "Down",
													"description":        "It is down.",
													"incidentSeverityId": map[string]interface{}{"_type": "ObjectID", "value": "sev-9"},
													"onCallPolicyIds": []interface{}{
														map[string]interface{}{"_type": "ObjectID", "value": "ocp-9"},
														"ocp-10",
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	list, diags := MonitorStepsFromAPI(ctx, response)
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)

	stepAttrs := list.Elements()[0].(types.Object).Attributes()
	if got := stepAttrs["monitor_destination"].(types.String).ValueString(); got != "example.com" {
		t.Fatalf("monitor_destination = %q", got)
	}
	if got := stepAttrs["monitor_destination_type"].(types.String).ValueString(); got != "Hostname" {
		t.Fatalf("monitor_destination_type = %q", got)
	}
	if got := stepAttrs["port"].(types.Int64).ValueInt64(); got != 443 {
		t.Fatalf("port = %d", got)
	}

	criteriaAttrs := stepAttrs["criteria"].(types.List).Elements()[0].(types.Object).Attributes()
	if got := criteriaAttrs["monitor_status_id"].(types.String).ValueString(); got != "status-1" {
		t.Fatalf("monitor_status_id = %q", got)
	}

	incidentAttrs := criteriaAttrs["incidents"].(types.List).Elements()[0].(types.Object).Attributes()
	if got := incidentAttrs["incident_severity_id"].(types.String).ValueString(); got != "sev-9" {
		t.Fatalf("incident_severity_id = %q", got)
	}
	policies := incidentAttrs["on_call_policy_ids"].(types.List).Elements()
	if len(policies) != 2 ||
		policies[0].(types.String).ValueString() != "ocp-9" ||
		policies[1].(types.String).ValueString() != "ocp-10" {
		t.Fatalf("on_call_policy_ids = %v", policies)
	}
}

// Legacy rows created through the old jsonencode() interface stored filters
// wrapped in {_type: "CriteriaFilter", value: {...}} envelopes. Importing
// them must work.
func TestMonitorStepsFromAPILegacyWrappedFilters(t *testing.T) {
	ctx := context.Background()
	response := map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{
					"_type": "MonitorStep",
					"value": map[string]interface{}{
						"monitorDestination": map[string]interface{}{"_type": "URL", "value": "https://example.com"},
						"monitorCriteria": map[string]interface{}{
							"_type": "MonitorCriteria",
							"value": map[string]interface{}{
								"monitorCriteriaInstanceArray": []interface{}{
									map[string]interface{}{
										"_type": "MonitorCriteriaInstance",
										"value": map[string]interface{}{
											"name":            "Legacy",
											"filterCondition": "All",
											"filters": []interface{}{
												map[string]interface{}{
													"_type": "CriteriaFilter",
													"value": map[string]interface{}{
														"checkOn":    "Response Status Code",
														"filterType": "Equal To",
														"value":      "200",
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	list, diags := MonitorStepsFromAPI(ctx, response)
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)

	filterAttrs := list.Elements()[0].(types.Object).Attributes()["criteria"].(types.List).
		Elements()[0].(types.Object).Attributes()["filters"].(types.List).
		Elements()[0].(types.Object).Attributes()
	if got := filterAttrs["check_on"].(types.String).ValueString(); got != "Response Status Code" {
		t.Fatalf("check_on = %q", got)
	}
	if got := filterAttrs["filter_type"].(types.String).ValueString(); got != "Equal To" {
		t.Fatalf("filter_type = %q", got)
	}
	if got := filterAttrs["value"].(types.String).ValueString(); got != "200" {
		t.Fatalf("value = %q", got)
	}
}

// ---------------------------------------------------------------------------
// ToAPI error handling
// ---------------------------------------------------------------------------

func TestMonitorStepsToAPIInvalidEscapeHatchJSON(t *testing.T) {
	ctx := context.Background()

	filterObj := monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
		"check_on":    types.StringValue("Is Online"),
		"filter_type": types.StringValue("True"),
	})
	criteriaObj := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":             types.StringValue("Online"),
		"filter_condition": types.StringValue("All"),
		"filters":          monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(), filterObj),
	})
	stepObj := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), map[string]attr.Value{
		"monitor_destination":      types.StringValue("https://example.com"),
		"monitor_destination_type": types.StringValue("URL"),
		"log_monitor":              types.StringValue("this is not json"),
		"criteria":                 monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), criteriaObj),
	})
	list := monitorStepsTestList(t, stepObj)

	_, diags := MonitorStepsToAPI(ctx, list)
	if !diags.HasError() {
		t.Fatal("expected error diagnostics for invalid escape-hatch JSON")
	}
}

func TestMonitorStepsToAPIEscapeHatchMustBeObject(t *testing.T) {
	ctx := context.Background()

	filterObj := monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
		"check_on": types.StringValue("Is Online"),
	})
	criteriaObj := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":             types.StringValue("Online"),
		"filter_condition": types.StringValue("All"),
		"filters":          monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(), filterObj),
	})
	stepObj := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), map[string]attr.Value{
		"dns_monitor": types.StringValue(`["array","not","object"]`),
		"criteria":    monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), criteriaObj),
	})
	list := monitorStepsTestList(t, stepObj)

	_, diags := MonitorStepsToAPI(ctx, list)
	if !diags.HasError() {
		t.Fatal("expected error diagnostics for non-object escape-hatch JSON")
	}
}

func TestMonitorStepsToAPIDestinationRequiresType(t *testing.T) {
	ctx := context.Background()

	filterObj := monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
		"check_on": types.StringValue("Is Online"),
	})
	criteriaObj := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":             types.StringValue("Online"),
		"filter_condition": types.StringValue("All"),
		"filters":          monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(), filterObj),
	})
	stepObj := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), map[string]attr.Value{
		"monitor_destination": types.StringValue("https://example.com"),
		"criteria":            monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), criteriaObj),
	})
	list := monitorStepsTestList(t, stepObj)

	_, diags := MonitorStepsToAPI(ctx, list)
	if !diags.HasError() {
		t.Fatal("expected error diagnostics when monitor_destination is set without monitor_destination_type")
	}
}

// ---------------------------------------------------------------------------
// Enum validators
// ---------------------------------------------------------------------------

func monitorStepsRunStringValidator(t *testing.T, v validator.String, value string) bool {
	t.Helper()
	req := validator.StringRequest{
		Path:        path.Root("test"),
		ConfigValue: types.StringValue(value),
	}
	resp := &validator.StringResponse{}
	v.ValidateString(context.Background(), req, resp)
	return !resp.Diagnostics.HasError()
}

func TestMonitorStepsEnumValidators(t *testing.T) {
	cases := []struct {
		name      string
		validator validator.String
		valid     []string
		invalid   []string
	}{
		{
			name:      "destination type",
			validator: monitorStepsDestinationTypeValidator,
			valid:     []string{"URL", "IP", "Hostname"},
			invalid:   []string{"url", "Domain", ""},
		},
		{
			name:      "request type",
			validator: monitorStepsRequestTypeValidator,
			valid:     []string{"GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"},
			invalid:   []string{"get", "OPTIONS", "TRACE"},
		},
		{
			name:      "filter condition",
			validator: monitorStepsFilterConditionValidator,
			valid:     []string{"All", "Any"},
			invalid:   []string{"ALL", "None", "any"},
		},
		{
			name:      "screen size type",
			validator: monitorStepsScreenSizeTypeValidator,
			valid:     []string{"Mobile", "Tablet", "Desktop"},
			invalid:   []string{"TV", "desktop"},
		},
		{
			name:      "browser type",
			validator: monitorStepsBrowserTypeValidator,
			valid:     []string{"Chromium", "Firefox"},
			invalid:   []string{"Webkit", "Safari", "chrome"},
		},
		{
			name:      "evaluate over time type",
			validator: monitorStepsEvaluateOverTimeTypeValidator,
			valid:     []string{"Average", "Sum", "Maximum Value", "Minimum Value", "All Values", "Any Value"},
			invalid:   []string{"Median", "average"},
		},
		{
			name:      "check on",
			validator: monitorStepsCheckOnValidator,
			valid:     []string{"Is Online", "Response Status Code", "Response Time (in ms)", "Disk Usage (in %)", "Metric Value", "External Status Page Response Time (in ms)"},
			invalid:   []string{"IsOnline", "Status Code", "response status code"},
		},
		{
			name:      "filter type",
			validator: monitorStepsFilterTypeValidator,
			valid:     []string{"Equal To", "True", "False", "Greater Than", "Recieved In Minutes", "Anomalously High"},
			invalid:   []string{"Equals", "Received In Minutes", "true"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, v := range tc.valid {
				if !monitorStepsRunStringValidator(t, tc.validator, v) {
					t.Fatalf("%q should be accepted", v)
				}
			}
			for _, v := range tc.invalid {
				if monitorStepsRunStringValidator(t, tc.validator, v) {
					t.Fatalf("%q should be rejected", v)
				}
			}
		})
	}
}

// The check_on validator must accept every CheckOn enum value we ship.
func TestMonitorStepsCheckOnValidatorAcceptsAllValues(t *testing.T) {
	for _, v := range monitorStepsCheckOnValues {
		if !monitorStepsRunStringValidator(t, monitorStepsCheckOnValidator, v) {
			t.Fatalf("CheckOn value %q should be accepted", v)
		}
	}
	if len(monitorStepsCheckOnValues) < 70 {
		t.Fatalf("CheckOn enum looks truncated: %d values", len(monitorStepsCheckOnValues))
	}
}

func TestMonitorStepsFilterTypeValidatorAcceptsAllValues(t *testing.T) {
	for _, v := range monitorStepsFilterTypeValues {
		if !monitorStepsRunStringValidator(t, monitorStepsFilterTypeValidator, v) {
			t.Fatalf("FilterType value %q should be accepted", v)
		}
	}
	if len(monitorStepsFilterTypeValues) != 22 {
		t.Fatalf("FilterType enum has %d values, want 22", len(monitorStepsFilterTypeValues))
	}
}

// ---------------------------------------------------------------------------
// Semantic equality (MonitorStepsValue)
// ---------------------------------------------------------------------------

func TestMonitorStepsSemanticEquals_SparseConfigVsServerEcho(t *testing.T) {
	// A minimal user config: destination + one criteria with one filter.
	sparse := monitorStepsMinimalUserList(t)

	// The server echo of the same steps with defaults filled in: request
	// type, criteria booleans, injected telemetry sub-configs.
	fullAPI := map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{
					"_type": "MonitorStep",
					"id":    "server-generated-id",
					"value": map[string]interface{}{
						"monitorDestination": map[string]interface{}{
							"_type": "IP",
							"value": "8.8.8.8",
						},
						"requestType": "GET",
						"logMonitor":  map[string]interface{}{"attributes": []interface{}{}},
						"monitorCriteria": map[string]interface{}{
							"_type": "MonitorCriteria",
							"value": map[string]interface{}{
								"monitorCriteriaInstanceArray": []interface{}{
									map[string]interface{}{
										"_type": "MonitorCriteriaInstance",
										"id":    "criteria-id",
										"value": map[string]interface{}{
											"name":            "Online",
											"filterCondition": "All",
											"createIncidents": false,
											"createAlerts":    false,
											"isEnabled":       true,
											"filters": []interface{}{
												map[string]interface{}{
													"checkOn":    "Is Online",
													"filterType": "True",
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	echoed, diags := MonitorStepsFromAPI(context.Background(), fullAPI)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}

	sparseValue := MonitorStepsValue{ListValue: sparse}
	echoedValue := MonitorStepsValue{ListValue: echoed}

	// Apply-result direction: result.SemanticEquals(planned).
	equal, diags := echoedValue.ListSemanticEquals(context.Background(), sparseValue)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}
	if !equal {
		t.Fatal("server echo with defaults must semantically equal the sparse config")
	}

	// The reverse direction (sparse receiver vs full prior) is NOT equal —
	// that orientation never occurs in framework flows, and treating it as
	// equal would mask failed removals.
	equal, _ = sparseValue.ListSemanticEquals(context.Background(), echoedValue)
	if equal {
		t.Fatal("sparse receiver must not absorb a fuller prior value")
	}
}

func TestMonitorStepsSemanticEquals_RealDifferencesStillDetected(t *testing.T) {
	a := MonitorStepsValue{ListValue: monitorStepsMinimalUserList(t)}

	changedAPI := map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{
					"_type": "MonitorStep",
					"value": map[string]interface{}{
						"monitorDestination": map[string]interface{}{
							"_type": "IP",
							"value": "9.9.9.9",
						},
						"monitorCriteria": map[string]interface{}{
							"_type": "MonitorCriteria",
							"value": map[string]interface{}{
								"monitorCriteriaInstanceArray": []interface{}{
									map[string]interface{}{
										"_type": "MonitorCriteriaInstance",
										"value": map[string]interface{}{
											"name":            "Online",
											"filterCondition": "All",
											"filters": []interface{}{
												map[string]interface{}{"checkOn": "Is Online", "filterType": "True"},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
	changed, diags := MonitorStepsFromAPI(context.Background(), changedAPI)
	if diags.HasError() {
		t.Fatalf("unexpected diagnostics: %v", diags)
	}
	b := MonitorStepsValue{ListValue: changed}

	equal, _ := a.ListSemanticEquals(context.Background(), b)
	if equal {
		t.Fatal("different destinations must not compare equal")
	}
}

func TestMonitorStepsSemanticEquals_NullAndUnknown(t *testing.T) {
	value := MonitorStepsValue{ListValue: monitorStepsMinimalUserList(t)}
	null := NewMonitorStepsValueNull()

	equal, _ := null.ListSemanticEquals(context.Background(), value)
	if equal {
		t.Fatal("null must not equal a concrete value")
	}
	equal, _ = null.ListSemanticEquals(context.Background(), NewMonitorStepsValueNull())
	if !equal {
		t.Fatal("null must equal null")
	}
}

func TestMonitorStepsSemanticEquals_URLSlashNormalization(t *testing.T) {
	// The server appends a trailing slash to bare-origin URL destinations;
	// this must not read as a value change (E2E tests 26/35 regression).
	filterObj := monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
		"check_on":    types.StringValue("Is Online"),
		"filter_type": types.StringValue("True"),
	})
	criteriaObj := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":             types.StringValue("Check if online"),
		"filter_condition": types.StringValue("All"),
		"filters":          monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(), filterObj),
	})
	stepObj := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), map[string]attr.Value{
		"monitor_destination":      types.StringValue("https://example.com"),
		"monitor_destination_type": types.StringValue("URL"),
		"request_type":             types.StringValue("GET"),
		"criteria":                 monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), criteriaObj),
	})
	planned := MonitorStepsValue{ListValue: monitorStepsTestList(t, stepObj)}

	serverValue := map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": []interface{}{
				map[string]interface{}{
					"_type": "MonitorStep",
					"id":    "abc",
					"value": map[string]interface{}{
						"monitorDestination": map[string]interface{}{
							"_type": "URL",
							"value": "https://example.com/",
						},
						"requestType": "GET",
						"monitorCriteria": map[string]interface{}{
							"_type": "MonitorCriteria",
							"value": map[string]interface{}{
								"monitorCriteriaInstanceArray": []interface{}{
									map[string]interface{}{
										"_type": "MonitorCriteriaInstance",
										"id":    "def",
										"value": map[string]interface{}{
											"name":            "Check if online",
											"filterCondition": "All",
											"isEnabled":       true,
											"createIncidents": false,
											"createAlerts":    false,
											"filters": []interface{}{
												map[string]interface{}{
													"checkOn":    "Is Online",
													"filterType": "True",
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
	echoedList, diags := MonitorStepsFromAPI(context.Background(), serverValue)
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)
	echoed := MonitorStepsValue{ListValue: echoedList}

	equal, diags := echoed.ListSemanticEquals(context.Background(), planned)
	monitorStepsTestFatalOnDiagError(t, "ListSemanticEquals", diags)
	if !equal {
		t.Fatal("slash-normalized URL plus server defaults must be semantically equal")
	}

	// A genuinely different URL must still be unequal.
	otherStep := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), map[string]attr.Value{
		"monitor_destination":      types.StringValue("https://other.example.com"),
		"monitor_destination_type": types.StringValue("URL"),
		"request_type":             types.StringValue("GET"),
		"criteria":                 monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), criteriaObj),
	})
	other := MonitorStepsValue{ListValue: monitorStepsTestList(t, otherStep)}
	equal, _ = echoed.ListSemanticEquals(context.Background(), other)
	if equal {
		t.Fatal("different URLs must stay unequal")
	}
}
