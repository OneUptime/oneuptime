package kinds

import (
	"regexp"
	"slices"
	"strings"
	"testing"
)

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

// The names controller-gen gives a kind's CRD: the kind's plural in lower
// case, as the package's CRDs have them, and the kind in lower case.
func TestCRDOf(t *testing.T) {
	cases := map[string]CRD{
		"Monitor":                 {"Monitor", "MonitorList", "monitors", "monitor"},
		"StatusPage":              {"StatusPage", "StatusPageList", "statuspages", "statuspage"},
		"IncidentSeverity":        {"IncidentSeverity", "IncidentSeverityList", "incidentseverities", "incidentseverity"},
		"MonitorStatusDefinition": {"MonitorStatusDefinition", "MonitorStatusDefinitionList", "monitorstatusdefinitions", "monitorstatusdefinition"},
		"OnCallPolicy":            {"OnCallPolicy", "OnCallPolicyList", "oncallpolicies", "oncallpolicy"},
		"APIKey":                  {"APIKey", "APIKeyList", "apikeys", "apikey"},
		"AIAgent":                 {"AIAgent", "AIAgentList", "aiagents", "aiagent"},
		"ProviderConfig":          {"ProviderConfig", "ProviderConfigList", "providerconfigs", "providerconfig"},
		"ProviderConfigUsage":     {"ProviderConfigUsage", "ProviderConfigUsageList", "providerconfigusages", "providerconfigusage"},
		"ClusterProviderConfig":   {"ClusterProviderConfig", "ClusterProviderConfigList", "clusterproviderconfigs", "clusterproviderconfig"},
		// A plural already: its plural is its singular.
		"OnCallScheduleLayers": {"OnCallScheduleLayers", "OnCallScheduleLayersList", "oncallschedulelayers", "oncallschedulelayers"},
		// Without a path, the plural OnCallScheduleLayers has (#10144).
		"OnCallScheduleLayer": {"OnCallScheduleLayer", "OnCallScheduleLayerList", "oncallschedulelayers", "oncallschedulelayer"},
	}
	for kind, want := range cases {
		if got := CRDOf(kind, ""); got != want {
			t.Errorf("CRDOf(%q, \"\") = %+v, want %+v", kind, got, want)
		}
	}
	// A path is the plural; the singular stays the kind's.
	want := CRD{"OnCallScheduleLayer", "OnCallScheduleLayerList", "oncallschedulelayerdefinitions", "oncallschedulelayer"}
	if got := CRDOf("OnCallScheduleLayer", "oncallschedulelayerdefinitions"); got != want {
		t.Errorf("CRDOf with a path = %+v, want %+v", got, want)
	}
}

// #10144: OnCallScheduleLayer has a plural of its own, and
// OnCallScheduleLayers keeps the one its CRD has had.
func TestPath(t *testing.T) {
	cases := map[string]string{
		"OnCallScheduleLayer":     "oncallschedulelayerdefinitions",
		"OnCallScheduleLayers":    "",
		"OnCallScheduleLayerUser": "",
		"Monitor":                 "",
	}
	for kind, want := range cases {
		if got := Path(kind); got != want {
			t.Errorf("Path(%q) = %q, want %q", kind, got, want)
		}
	}
	crds := map[string]CRD{
		"oneuptime_on_call_schedule_layer":  CRDOf("OnCallScheduleLayer", Path("OnCallScheduleLayer")),
		"oneuptime_on_call_schedule_layers": CRDOf("OnCallScheduleLayers", Path("OnCallScheduleLayers")),
	}
	if clashes := Clashes(crds); len(clashes) != 0 {
		t.Errorf("the layer kinds' CRDs still have names in common: %q", clashes)
	}
}

// A path is a plural the API server takes (a DNS-1035 label), starts with
// the kind's name in lower case, so the CRD is found by it, and is not
// controller-gen's own plural, which it would be given anyway.
func TestEveryPathIsAPluralOfItsOwn(t *testing.T) {
	label := regexp.MustCompile(`^[a-z]([-a-z0-9]*[a-z0-9])?$`)
	for kind, path := range paths {
		if !label.MatchString(path) || len(path) > 63 {
			t.Errorf("%s: %q is no plural the API server takes", kind, path)
		}
		if !strings.HasPrefix(path, strings.ToLower(kind)) {
			t.Errorf("%s: %q does not start with the kind's name", kind, path)
		}
		if path == CRDOf(kind, "").Plural {
			t.Errorf("%s: %q is controller-gen's own plural", kind, path)
		}
	}
}

func TestClashes(t *testing.T) {
	cases := []struct {
		name string
		crds map[string]CRD
		want []string
	}{
		{
			name: "no name in common",
			crds: map[string]CRD{
				"oneuptime_monitor":     CRDOf("Monitor", ""),
				"oneuptime_status_page": CRDOf("StatusPage", ""),
				// Its plural is its singular: one name of one CRD.
				"oneuptime_on_call_schedule_layers": CRDOf("OnCallScheduleLayers", ""),
			},
		},
		{
			// #10144: both CRDs oncallschedulelayers, in one file.
			name: "one plural",
			crds: map[string]CRD{
				"oneuptime_on_call_schedule_layer":  CRDOf("OnCallScheduleLayer", ""),
				"oneuptime_on_call_schedule_layers": CRDOf("OnCallScheduleLayers", ""),
			},
			want: []string{"oncallschedulelayers: the plural or singular of OnCallScheduleLayer (oneuptime_on_call_schedule_layer) and OnCallScheduleLayers (oneuptime_on_call_schedule_layers)"},
		},
		{
			// Two files, and the API server would serve the second CRD it
			// was given by none of its names.
			name: "a plural that is another's singular",
			crds: map[string]CRD{
				"a": {Kind: "Series", ListKind: "SeriesList", Plural: "serieses", Singular: "series"},
				"b": {Kind: "Serie", ListKind: "SerieList", Plural: "series", Singular: "serie"},
			},
			want: []string{"series: the plural or singular of Serie (b) and Series (a)"},
		},
		{
			name: "a kind that is another's list kind",
			crds: map[string]CRD{
				"a": CRDOf("Monitor", ""),
				"b": CRDOf("MonitorList", "monitorlistdefinitions"),
			},
			want: []string{"MonitorList: the kind or list kind of Monitor (a) and MonitorList (b)"},
		},
		{
			// A managed resource of a ProviderConfig's kind: controller-gen
			// would make one CRD of both versions.
			name: "one kind",
			crds: map[string]CRD{
				"oneuptime_provider_config": CRDOf("ProviderConfig", ""),
				"ProviderConfig":            CRDOf("ProviderConfig", ""),
			},
			want: []string{
				"ProviderConfig: the kind or list kind of ProviderConfig (ProviderConfig) and ProviderConfig (oneuptime_provider_config)",
				"ProviderConfigList: the kind or list kind of ProviderConfig (ProviderConfig) and ProviderConfig (oneuptime_provider_config)",
				"providerconfig: the plural or singular of ProviderConfig (ProviderConfig) and ProviderConfig (oneuptime_provider_config)",
				"providerconfigs: the plural or singular of ProviderConfig (ProviderConfig) and ProviderConfig (oneuptime_provider_config)",
			},
		},
	}
	for _, c := range cases {
		if got := Clashes(c.crds); !slices.Equal(got, c.want) {
			t.Errorf("%s: Clashes = %q, want %q", c.name, got, c.want)
		}
	}
}
