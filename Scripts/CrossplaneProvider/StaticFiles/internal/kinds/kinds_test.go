package kinds

import "testing"

func TestOf(t *testing.T) {
	cases := map[string]string{
		"oneuptime_monitor":                     "Monitor",
		"oneuptime_status_page":                 "StatusPage",
		"oneuptime_on_call_duty_policy":         "OnCallDutyPolicy",
		"oneuptime_team":                        "Team",
		"oneuptime_api_key":                     "APIKey",
		"oneuptime_ai_agent":                    "AIAgent",
		"oneuptime_telemetry_ingestion_key":     "TelemetryIngestionKey",
		"oneuptime_monitor_status":              "MonitorStatusDefinition",
		"oneuptime_postmortem_status":           "PostmortemStatusDefinition",
		"oneuptime_security_case_status":        "SecurityCaseStatusDefinition",
		"oneuptime_incident_state":              "IncidentState",
		"oneuptime_status_page_announcement":    "StatusPageAnnouncement",
		"oneuptime_scheduled_maintenance_state": "ScheduledMaintenanceState",
	}
	for terraformName, want := range cases {
		if got := Of(terraformName); got != want {
			t.Errorf("Of(%q) = %q, want %q", terraformName, got, want)
		}
	}
}

// A kind never ends in a word Upjet adds to a kind's own types.
func TestOfNeverEndsInAGeneratedTypeSuffix(t *testing.T) {
	for _, terraformName := range []string{"oneuptime_x_spec", "oneuptime_x_status", "oneuptime_x_list"} {
		kind := Of(terraformName)
		for _, ending := range reservedEndings {
			if len(kind) >= len(ending) && kind[len(kind)-len(ending):] == ending {
				t.Errorf("Of(%q) = %q ends in %s", terraformName, kind, ending)
			}
		}
	}
}

func TestFieldName(t *testing.T) {
	cases := map[string]string{
		"name":                  "name",
		"monitor_status_id":     "monitorStatusId",
		"labels":                "labels",
		"user_email":            "userEmail",
		"is_archived":           "isArchived",
		"monitor_steps":         "monitorSteps",
		"incident_severity_id":  "incidentSeverityId",
		"on_call_duty_policies": "onCallDutyPolicies",
	}
	for attribute, want := range cases {
		if got := FieldName(attribute); got != want {
			t.Errorf("FieldName(%q) = %q, want %q", attribute, got, want)
		}
	}
}
