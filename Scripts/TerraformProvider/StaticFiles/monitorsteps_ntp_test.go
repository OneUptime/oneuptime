package provider

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// NTP monitors (issue #4617) need nothing new in monitor_steps: the server is
// monitor_destination with monitor_destination_type "Hostname" or "IP", the
// optional port is `port` (123 when unset), and the timeout and retries are
// request_timeout_in_ms and retry_count. What they do need is their check_on
// values, which the validator refused before.

var monitorStepsNtpCheckOnValues = []string{
	"NTP Is Online",
	"NTP Is Synchronized",
	"NTP Stratum",
	"NTP Clock Offset (in ms)",
	"NTP Response Time (in ms)",
	"NTP Root Dispersion (in ms)",
}

func TestMonitorStepsCheckOnValidatorAcceptsNtpValues(t *testing.T) {
	for _, v := range monitorStepsNtpCheckOnValues {
		if !monitorStepsRunStringValidator(t, monitorStepsCheckOnValidator, v) {
			t.Fatalf("NTP CheckOn value %q should be accepted", v)
		}
	}

	for _, v := range []string{"NTP Offset", "ntp is online", "NTP Clock Offset"} {
		if monitorStepsRunStringValidator(t, monitorStepsCheckOnValidator, v) {
			t.Fatalf("%q is not a CheckOn value and should be rejected", v)
		}
	}
}

// The values the API accepted but the provider refused until NTP was added.
func TestMonitorStepsCheckOnValidatorAcceptsEarlierMissingValues(t *testing.T) {
	for _, v := range []string{
		"Port DNS Lookup Time (in ms)",
		"Port TCP Connect Time (in ms)",
		"Security Event Count",
		"SNMP Walk Is Succeeding",
		"SNMP Table Value",
		"SNMP Table Row Count",
		"SNMP Table Row Is Unhealthy",
		"SNMP Trap Varbind Value",
		"SNMP Transceiver Not Detected",
		"SNMP Transceiver Past Alarm Threshold",
		"SNMP Transceiver Past Warning Threshold",
		"SNMP Transceiver Reading",
		"SNMP Transceiver RX Power Drop (in dB)",
	} {
		if !monitorStepsRunStringValidator(t, monitorStepsCheckOnValidator, v) {
			t.Fatalf("CheckOn value %q should be accepted", v)
		}
	}
}

func monitorStepsNtpUserList(t *testing.T) types.List {
	t.Helper()

	onlineFilters := monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(),
		monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
			"check_on":    types.StringValue("NTP Is Online"),
			"filter_type": types.StringValue("True"),
		}),
		monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
			"check_on":    types.StringValue("NTP Is Synchronized"),
			"filter_type": types.StringValue("True"),
		}),
		monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
			"check_on":    types.StringValue("NTP Clock Offset (in ms)"),
			"filter_type": types.StringValue("Less Than"),
			"value":       types.StringValue("1000"),
		}),
	)

	stratumFilters := monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(),
		monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
			"check_on":                   types.StringValue("NTP Stratum"),
			"filter_type":                types.StringValue("Greater Than"),
			"value":                      types.StringValue("2"),
			"evaluate_over_time":         types.BoolValue(true),
			"evaluate_over_time_minutes": types.Int64Value(10),
			"evaluate_over_time_type":    types.StringValue("All Values"),
		}),
	)

	onlineCriteria := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":             types.StringValue("Serves good time"),
		"filter_condition": types.StringValue("All"),
		"filters":          onlineFilters,
	})

	stratumCriteria := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":             types.StringValue("Lost its GPS"),
		"filter_condition": types.StringValue("Any"),
		"create_alerts":    types.BoolValue(true),
		"filters":          stratumFilters,
	})

	step := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), map[string]attr.Value{
		"monitor_destination":      types.StringValue("tick.example.com"),
		"monitor_destination_type": types.StringValue("Hostname"),
		"port":                     types.Int64Value(123),
		"request_timeout_in_ms":    types.Int64Value(5000),
		"retry_count":              types.Int64Value(2),
		"criteria":                 monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), stratumCriteria, onlineCriteria),
	})

	return monitorStepsTestList(t, step)
}

func TestMonitorStepsRoundTripNtpStep(t *testing.T) {
	ctx := context.Background()
	original := monitorStepsNtpUserList(t)

	wire, diags := MonitorStepsToAPI(ctx, original)
	monitorStepsTestFatalOnDiagError(t, "ToAPI", diags)

	golden := `{
	  "_type": "MonitorSteps",
	  "value": {
	    "monitorStepsInstanceArray": [
	      {
	        "_type": "MonitorStep",
	        "value": {
	          "monitorDestination": {"_type": "Hostname", "value": "tick.example.com"},
	          "monitorDestinationPort": {"_type": "Port", "value": 123},
	          "requestTimeoutInMs": 5000,
	          "retryCount": 2,
	          "monitorCriteria": {
	            "_type": "MonitorCriteria",
	            "value": {
	              "monitorCriteriaInstanceArray": [
	                {
	                  "_type": "MonitorCriteriaInstance",
	                  "value": {
	                    "name": "Lost its GPS",
	                    "filterCondition": "Any",
	                    "createAlerts": true,
	                    "filters": [
	                      {
	                        "checkOn": "NTP Stratum",
	                        "filterType": "Greater Than",
	                        "value": "2",
	                        "evaluateOverTime": true,
	                        "evaluateOverTimeOptions": {
	                          "timeValueInMinutes": 10,
	                          "evaluateOverTimeType": "All Values"
	                        }
	                      }
	                    ]
	                  }
	                },
	                {
	                  "_type": "MonitorCriteriaInstance",
	                  "value": {
	                    "name": "Serves good time",
	                    "filterCondition": "All",
	                    "filters": [
	                      {"checkOn": "NTP Is Online", "filterType": "True"},
	                      {"checkOn": "NTP Is Synchronized", "filterType": "True"},
	                      {"checkOn": "NTP Clock Offset (in ms)", "filterType": "Less Than", "value": "1000"}
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
	if actual := monitorStepsTestNormalizeJSON(t, wire); !reflect.DeepEqual(actual, goldenParsed) {
		actualJSON, _ := json.MarshalIndent(actual, "", "  ")
		t.Fatalf("NTP wire envelope mismatch:\n%s", actualJSON)
	}

	back, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, wire))
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)
	if !back.Equal(original) {
		t.Fatalf("NTP round trip mismatch.\noriginal: %s\nback:     %s", original, back)
	}
}

// A step that leaves the port unset sends none: the probe then uses 123.
func TestMonitorStepsNtpStepWithoutPortSendsNoPort(t *testing.T) {
	ctx := context.Background()

	filter := monitorStepsTestObj(t, monitorStepsFilterAttrTypes(), map[string]attr.Value{
		"check_on":    types.StringValue("NTP Is Online"),
		"filter_type": types.StringValue("False"),
	})
	criteria := monitorStepsTestObj(t, monitorStepsCriteriaAttrTypes(), map[string]attr.Value{
		"name":             types.StringValue("Not answering"),
		"filter_condition": types.StringValue("Any"),
		"filters":          monitorStepsTestObjList(t, monitorStepsFilterAttrTypes(), filter),
	})
	step := monitorStepsTestObj(t, monitorStepsStepAttrTypes(), map[string]attr.Value{
		"monitor_destination":      types.StringValue("192.0.2.123"),
		"monitor_destination_type": types.StringValue("IP"),
		"criteria":                 monitorStepsTestObjList(t, monitorStepsCriteriaAttrTypes(), criteria),
	})
	original := monitorStepsTestList(t, step)

	wire, diags := MonitorStepsToAPI(ctx, original)
	monitorStepsTestFatalOnDiagError(t, "ToAPI", diags)

	normalized := monitorStepsTestNormalizeJSON(t, wire).(map[string]interface{})
	steps := normalized["value"].(map[string]interface{})["monitorStepsInstanceArray"].([]interface{})
	stepValue := steps[0].(map[string]interface{})["value"].(map[string]interface{})

	if _, has := stepValue["monitorDestinationPort"]; has {
		t.Fatalf("an unset port must not be sent, got %v", stepValue["monitorDestinationPort"])
	}

	back, diags := MonitorStepsFromAPI(ctx, monitorStepsTestJSONCopy(t, wire))
	monitorStepsTestFatalOnDiagError(t, "FromAPI", diags)
	if !back.Equal(original) {
		t.Fatalf("round trip mismatch.\noriginal: %s\nback:     %s", original, back)
	}
}
