package provider

// Typed nested schema + wire conversions for the oneuptime_monitor
// `monitor_steps` attribute.
//
// On the wire the API speaks the MonitorSteps envelope format:
//
//	{
//	  "_type": "MonitorSteps",
//	  "value": {
//	    "monitorStepsInstanceArray": [
//	      {
//	        "_type": "MonitorStep",
//	        "value": {
//	          "monitorDestination": {"_type": "URL", "value": "https://..."},
//	          "requestType": "GET",
//	          "monitorCriteria": {
//	            "_type": "MonitorCriteria",
//	            "value": {
//	              "monitorCriteriaInstanceArray": [
//	                {"_type": "MonitorCriteriaInstance", "value": {...}}
//	              ]
//	            }
//	          }
//	        }
//	      }
//	    ]
//	  }
//	}
//
// Terraform users write typed nested HCL instead; these helpers translate
// both directions:
//
//   - MonitorStepsToAPI:   typed list -> wire envelope. Unset optionals are
//     omitted entirely (never sent as "", false, null or empty containers).
//     Server-generated ids are never sent — the server owns them.
//   - MonitorStepsFromAPI: wire envelope (or bare value map) -> typed list.
//     Only schema-known fields are mapped; server-generated ids, the
//     server-hydrated snmpMonitor carrier and any unknown keys are dropped
//     so server-side extras never cause drift. Empty strings and empty
//     containers normalize to null (the schema forbids them in config, so
//     absent-or-empty always means "unset").
//
// Round-trip guarantee: for any list L produced from valid user config,
// MonitorStepsFromAPI(MonitorStepsToAPI(L)) == L.

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"net/url"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/int64validator"
	"github.com/hashicorp/terraform-plugin-framework-validators/listvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/mapvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/listplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-framework/types/basetypes"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// ---------------------------------------------------------------------------
// Enum value lists (mirrors Common/Types/Monitor/CriteriaFilter.ts and
// friends — keep in sync with the TypeScript source of truth).
// ---------------------------------------------------------------------------

var monitorStepsDestinationTypeValues = []string{"URL", "IP", "Hostname"}

// HTTPMethod enum (Common/Types/API/HTTPMethod.ts).
var monitorStepsRequestTypeValues = []string{"GET", "POST", "DELETE", "PUT", "HEAD", "PATCH"}

// FilterCondition enum (Common/Types/Filter/FilterCondition.ts).
var monitorStepsFilterConditionValues = []string{"All", "Any"}

// ScreenSizeType enum (Common/Types/ScreenSizeType.ts).
var monitorStepsScreenSizeTypeValues = []string{"Mobile", "Tablet", "Desktop"}

// BrowserType enum (Common/Types/BrowserType.ts).
var monitorStepsBrowserTypeValues = []string{"Chromium", "Firefox"}

// EvaluateOverTimeType enum (Common/Types/Monitor/CriteriaFilter.ts). The
// "Minimum Value" spelling matches the server enum member MunimumValue's
// string value.
var monitorStepsEvaluateOverTimeTypeValues = []string{
	"Average",
	"Sum",
	"Maximum Value",
	"Minimum Value",
	"All Values",
	"Any Value",
}

// NoDataPolicy enum (Common/Types/Monitor/CriteriaFilter.ts). Governs what
// an over-time filter does while its evaluation window does not hold enough
// data to judge it.
var monitorStepsNoDataPolicyValues = []string{
	"Ignore",
	"Treat As Zero",
	"Trigger",
}

// CheckOn enum (Common/Types/Monitor/CriteriaFilter.ts).
var monitorStepsCheckOnValues = []string{
	"Response Time (in ms)",
	"Packet Loss (in %)",
	"Jitter (in ms)",
	"Response Status Code",
	"Response Header",
	"Response Header Value",
	"Response Body",
	"Is Online",
	"Incoming Request",
	"Server Process Name",
	"Server Process Command",
	"Server Process PID",
	"Request Body",
	"Request Header",
	"Request Header Value",
	"JavaScript Expression",
	"Disk Usage (in %)",
	"CPU Usage (in %)",
	"Memory Usage (in %)",
	"Load Average (1 minute)",
	"Load Average (5 minute)",
	"Load Average (15 minute)",
	"Swap Usage (in %)",
	"CPU IO Wait (in %)",
	"Expires In Hours",
	"Expires In Days",
	"Is Self Signed Certificate",
	"Is Expired Certificate",
	"Is Valid Certificate",
	"Is Not A Valid Certificate",
	"Is Request Timeout",
	"Result Value",
	"Error",
	"Execution Time (in ms)",
	"Screen Size",
	"Browser Type",
	"Log Count",
	"Span Count",
	"Exception Count",
	"Profile Count",
	"Metric Value",
	"Email Subject",
	"Email From Address",
	"Email Body",
	"Email To Address",
	"Email Received",
	"SNMP OID Value",
	"SNMP OID Exists",
	"SNMP Response Time (in ms)",
	"SNMP Device Is Online",
	"SNMP Interface Is Down",
	"SNMP Trap Received (Trap OID)",
	"SNMP Interface Utilization (in %)",
	"SNMP Interface Errors (per second)",
	"DNS Response Time (in ms)",
	"DNS Is Online",
	"DNS Record Value",
	"DNSSEC Is Valid",
	"DNS Record Exists",
	"Domain Expires In Days",
	"Domain Registrar",
	"Domain Name Server",
	"Domain Status Code",
	"Domain Is Expired",
	"DNSSEC Chain Is Valid",
	"DNSSEC DNSKEY Record Exists",
	"DNSSEC DS Record Exists At Parent",
	"DNSSEC Signature Expires In Days",
	"DNSSEC Resolver Consensus (AD Flag)",
	"DNSSEC Nameservers Are Consistent",
	"SQL Is Online",
	"SQL Query Row Count",
	"SQL Query Scalar Value",
	"SQL Query Execution Time (in ms)",
	"SQL Query Error",
	"Database Is Online",
	"Database Metric",
	"Database Collection Error",
	"External Status Page Is Online",
	"External Status Page Overall Status",
	"External Status Page Component Status",
	"External Status Page Active Incidents",
	"External Status Page Response Time (in ms)",
}

// FilterType enum (Common/Types/Monitor/CriteriaFilter.ts). "Recieved" is
// intentionally misspelled — it matches the server enum values.
var monitorStepsFilterTypeValues = []string{
	"Equal To",
	"Not Equal To",
	"Greater Than",
	"Less Than",
	"Greater Than Or Equal To",
	"Less Than Or Equal To",
	"Contains",
	"Not Contains",
	"Starts With",
	"Ends With",
	"Is Empty",
	"Is Not Empty",
	"True",
	"False",
	"Not Recieved In Minutes",
	"Recieved In Minutes",
	"Evaluates To True",
	"Is Executing",
	"Is Not Executing",
	"Anomalously High",
	"Anomalously Low",
	"Anomalous",
}

// Enum validators, exposed at package level so tests can exercise them
// directly.
var (
	monitorStepsDestinationTypeValidator      = stringvalidator.OneOf(monitorStepsDestinationTypeValues...)
	monitorStepsRequestTypeValidator          = stringvalidator.OneOf(monitorStepsRequestTypeValues...)
	monitorStepsFilterConditionValidator      = stringvalidator.OneOf(monitorStepsFilterConditionValues...)
	monitorStepsScreenSizeTypeValidator       = stringvalidator.OneOf(monitorStepsScreenSizeTypeValues...)
	monitorStepsBrowserTypeValidator          = stringvalidator.OneOf(monitorStepsBrowserTypeValues...)
	monitorStepsEvaluateOverTimeTypeValidator = stringvalidator.OneOf(monitorStepsEvaluateOverTimeTypeValues...)
	monitorStepsNoDataPolicyValidator         = stringvalidator.OneOf(monitorStepsNoDataPolicyValues...)
	monitorStepsCheckOnValidator              = stringvalidator.OneOf(monitorStepsCheckOnValues...)
	monitorStepsFilterTypeValidator           = stringvalidator.OneOf(monitorStepsFilterTypeValues...)
)

// ---------------------------------------------------------------------------
// Escape-hatch sub-monitor configs.
//
// A MonitorStep can carry one deeply-nested, monitor-type-specific config
// object (log query, SQL connection, Kubernetes scope, ...). These shapes
// are large and evolve independently of the provider, so each is exposed as
// an optional string attribute holding the sub-config's raw JSON (write it
// with jsonencode()). The server-hydrated snmpMonitor carrier is
// intentionally absent: it is populated server-side for Network Device
// monitors and is never set by users.
// ---------------------------------------------------------------------------

type monitorStepsSubConfig struct {
	tfName string
	apiKey string
}

var monitorStepsSubConfigs = []monitorStepsSubConfig{
	{"log_monitor", "logMonitor"},
	{"trace_monitor", "traceMonitor"},
	{"metric_monitor", "metricMonitor"},
	{"exception_monitor", "exceptionMonitor"},
	{"profile_monitor", "profileMonitor"},
	{"network_device_monitor", "networkDeviceMonitor"},
	{"dns_monitor", "dnsMonitor"},
	{"domain_monitor", "domainMonitor"},
	{"dnssec_monitor", "dnssecMonitor"},
	{"sql_monitor", "sqlMonitor"},
	{"database_monitor", "databaseMonitor"},
	{"external_status_page_monitor", "externalStatusPageMonitor"},
	{"kubernetes_monitor", "kubernetesMonitor"},
	{"docker_monitor", "dockerMonitor"},
	{"host_monitor", "hostMonitor"},
	{"podman_monitor", "podmanMonitor"},
	{"proxmox_monitor", "proxmoxMonitor"},
	{"docker_swarm_monitor", "dockerSwarmMonitor"},
	{"ceph_monitor", "cephMonitor"},
	{"iot_monitor", "iotMonitor"},
}

// ---------------------------------------------------------------------------
// Attribute type trees
// ---------------------------------------------------------------------------

func monitorStepsFilterAttrTypes() map[string]attr.Type {
	return map[string]attr.Type{
		"check_on":                          types.StringType,
		"filter_type":                       types.StringType,
		"value":                             types.StringType,
		"evaluate_over_time":                types.BoolType,
		"evaluate_over_time_minutes":        types.Int64Type,
		"evaluate_over_time_type":           types.StringType,
		"evaluate_over_time_no_data_policy": types.StringType,
		"disk_path":                         types.StringType,
		"metric_monitor_options":            types.StringType,
		"snmp_monitor_options":              types.StringType,
		"database_monitor_options":          types.StringType,
	}
}

func monitorStepsIncidentAttrTypes() map[string]attr.Type {
	return map[string]attr.Type{
		"title":                        types.StringType,
		"description":                  types.StringType,
		"incident_severity_id":         types.StringType,
		"auto_resolve_incident":        types.BoolType,
		"remediation_notes":            types.StringType,
		"on_call_policy_ids":           types.ListType{ElemType: types.StringType},
		"label_ids":                    types.ListType{ElemType: types.StringType},
		"owner_team_ids":               types.ListType{ElemType: types.StringType},
		"owner_user_ids":               types.ListType{ElemType: types.StringType},
		"show_incident_on_status_page": types.BoolType,
		"is_private":                   types.BoolType,
	}
}

func monitorStepsAlertAttrTypes() map[string]attr.Type {
	return map[string]attr.Type{
		"title":              types.StringType,
		"description":        types.StringType,
		"alert_severity_id":  types.StringType,
		"auto_resolve_alert": types.BoolType,
		"remediation_notes":  types.StringType,
		"on_call_policy_ids": types.ListType{ElemType: types.StringType},
		"label_ids":          types.ListType{ElemType: types.StringType},
		"owner_team_ids":     types.ListType{ElemType: types.StringType},
		"owner_user_ids":     types.ListType{ElemType: types.StringType},
		"is_private":         types.BoolType,
	}
}

func monitorStepsCriteriaAttrTypes() map[string]attr.Type {
	return map[string]attr.Type{
		"name":                  types.StringType,
		"description":           types.StringType,
		"filter_condition":      types.StringType,
		"monitor_status_id":     types.StringType,
		"change_monitor_status": types.BoolType,
		"create_incidents":      types.BoolType,
		"create_alerts":         types.BoolType,
		"is_enabled":            types.BoolType,
		"incident_grouping":     types.StringType,
		"filters":               types.ListType{ElemType: types.ObjectType{AttrTypes: monitorStepsFilterAttrTypes()}},
		"incidents":             types.ListType{ElemType: types.ObjectType{AttrTypes: monitorStepsIncidentAttrTypes()}},
		"alerts":                types.ListType{ElemType: types.ObjectType{AttrTypes: monitorStepsAlertAttrTypes()}},
	}
}

func monitorStepsStepAttrTypes() map[string]attr.Type {
	attrTypes := map[string]attr.Type{
		"monitor_destination":            types.StringType,
		"monitor_destination_type":       types.StringType,
		"port":                           types.Int64Type,
		"request_type":                   types.StringType,
		"request_headers":                types.MapType{ElemType: types.StringType},
		"request_body":                   types.StringType,
		"do_not_follow_redirects":        types.BoolType,
		"allow_self_signed_certificates": types.BoolType,
		"tls_client_certificate":         types.StringType,
		"tls_client_key":                 types.StringType,
		"tls_client_key_passphrase":      types.StringType,
		"custom_code":                    types.StringType,
		"screen_size_types":              types.ListType{ElemType: types.StringType},
		"browser_types":                  types.ListType{ElemType: types.StringType},
		"retry_count_on_error":           types.Int64Type,
		"request_timeout_in_ms":          types.Int64Type,
		"retry_count":                    types.Int64Type,
		"criteria":                       types.ListType{ElemType: types.ObjectType{AttrTypes: monitorStepsCriteriaAttrTypes()}},
	}
	for _, sub := range monitorStepsSubConfigs {
		attrTypes[sub.tfName] = types.StringType
	}
	return attrTypes
}

// MonitorStepsListType returns the exact attr.Type of the monitor_steps
// attribute — a list of step objects. Generated code uses it for typed null
// initialization.
func MonitorStepsListType() attr.Type {
	return NewMonitorStepsType()
}

// MonitorStepsNull returns a typed null monitor_steps list.
func MonitorStepsNull() types.List {
	return types.ListNull(types.ObjectType{AttrTypes: monitorStepsStepAttrTypes()})
}

/*
 * MonitorStepsType / MonitorStepsValue: a custom list type whose semantic
 * equality treats the planned (sparse, user-authored) form as equal to the
 * server's default-filled echo. Comparison happens through the wire
 * envelope — unset optionals are omitted there — with URL destinations
 * normalized the way the server normalizes them.
 */
type MonitorStepsType struct {
	basetypes.ListType
}

// NewMonitorStepsType returns the custom type carrying the full step
// element type.
func NewMonitorStepsType() MonitorStepsType {
	return MonitorStepsType{
		ListType: basetypes.ListType{
			ElemType: types.ObjectType{AttrTypes: monitorStepsStepAttrTypes()},
		},
	}
}

var _ basetypes.ListTypable = MonitorStepsType{}

func (t MonitorStepsType) Equal(o attr.Type) bool {
	other, ok := o.(MonitorStepsType)
	if !ok {
		return false
	}
	return t.ListType.Equal(other.ListType)
}

func (t MonitorStepsType) String() string {
	return "MonitorStepsType"
}

func (t MonitorStepsType) ValueType(_ context.Context) attr.Value {
	return MonitorStepsValue{}
}

func (t MonitorStepsType) ValueFromList(_ context.Context, in basetypes.ListValue) (basetypes.ListValuable, diag.Diagnostics) {
	return MonitorStepsValue{ListValue: in}, nil
}

func (t MonitorStepsType) ValueFromTerraform(ctx context.Context, in tftypes.Value) (attr.Value, error) {
	val, err := t.ListType.ValueFromTerraform(ctx, in)
	if err != nil {
		return nil, err
	}
	lv, ok := val.(basetypes.ListValue)
	if !ok {
		return nil, fmt.Errorf("unexpected base value type: %T", val)
	}
	return MonitorStepsValue{ListValue: lv}, nil
}

// MonitorStepsValue embeds the standard ListValue so the usual accessors
// (IsNull, IsUnknown, Elements) keep working at generated call sites.
type MonitorStepsValue struct {
	basetypes.ListValue
}

var _ basetypes.ListValuableWithSemanticEquals = MonitorStepsValue{}

func (v MonitorStepsValue) Type(_ context.Context) attr.Type {
	return NewMonitorStepsType()
}

func (v MonitorStepsValue) Equal(o attr.Value) bool {
	other, ok := o.(MonitorStepsValue)
	if !ok {
		return false
	}
	return v.ListValue.Equal(other.ListValue)
}

/*
 * ListSemanticEquals: the framework calls this with the receiver being the
 * newer value (apply result or refreshed read) and the argument the prior
 * value (planned config or prior state). The prior form may be a sparse
 * subset of the newer, server-default-filled form; the newer side may never
 * disagree with the prior on a key both carry.
 */
func (v MonitorStepsValue) ListSemanticEquals(ctx context.Context, otherValuable basetypes.ListValuable) (bool, diag.Diagnostics) {
	var diags diag.Diagnostics
	other, ok := otherValuable.(MonitorStepsValue)
	if !ok {
		return false, diags
	}
	if v.IsNull() || v.IsUnknown() || other.IsNull() || other.IsUnknown() {
		return v.ListValue.Equal(other.ListValue), diags
	}
	if v.ListValue.Equal(other.ListValue) {
		return true, diags
	}

	mine, mineDiags := MonitorStepsToAPI(ctx, v.ListValue)
	theirs, theirsDiags := MonitorStepsToAPI(ctx, other.ListValue)
	if mineDiags.HasError() || theirsDiags.HasError() {
		return false, diags
	}

	minePlain, mineErr := toPlainJSON(mine)
	theirsPlain, theirsErr := toPlainJSON(theirs)
	if mineErr != nil || theirsErr != nil {
		return false, diags
	}

	// The server normalizes URL destinations (e.g. appends a trailing slash
	// to bare origins); normalize both sides before structural comparison.
	minePlain = normalizeURLWrapperLeaves(minePlain)
	theirsPlain = normalizeURLWrapperLeaves(theirsPlain)

	return jsonIsSubset(theirsPlain, minePlain), diags
}

// toPlainJSON round-trips a value through encoding/json so numeric types
// normalize (int64 vs float64) before structural comparison.
func toPlainJSON(value interface{}) (interface{}, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var plain interface{}
	if err := json.Unmarshal(raw, &plain); err != nil {
		return nil, err
	}
	return plain, nil
}

// NewMonitorStepsValueNull returns a typed null value of the custom type.
func NewMonitorStepsValueNull() MonitorStepsValue {
	return MonitorStepsValue{ListValue: MonitorStepsNull()}
}

// normalizeURLWrapperLeaves trims the trailing slash from bare-origin URL
// wrapper values ({_type: "URL", value: "https://x.com/"}), matching the
// server's normalization so it never reads as a value change.
func normalizeURLWrapperLeaves(value interface{}) interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		if typeName, ok := typed["_type"].(string); ok && typeName == "URL" {
			if raw, ok := typed["value"].(string); ok {
				typed["value"] = normalizeBareOriginURL(raw)
			}
		}
		for key, child := range typed {
			typed[key] = normalizeURLWrapperLeaves(child)
		}
		return typed
	case []interface{}:
		for i, child := range typed {
			typed[i] = normalizeURLWrapperLeaves(child)
		}
		return typed
	default:
		return value
	}
}

func normalizeBareOriginURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return value
	}
	if parsed.Path == "/" && parsed.RawQuery == "" && parsed.Fragment == "" {
		return strings.TrimSuffix(value, "/")
	}
	return value
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

func monitorStepsFilterSchema() schema.NestedAttributeObject {
	return schema.NestedAttributeObject{
		Attributes: map[string]schema.Attribute{
			"check_on": schema.StringAttribute{
				MarkdownDescription: "What this filter inspects (e.g. `Is Online`, `Response Status Code`, `Response Time (in ms)`).",
				Required:            true,
				Validators:          []validator.String{monitorStepsCheckOnValidator},
			},
			"filter_type": schema.StringAttribute{
				MarkdownDescription: "Comparison operator for the filter (e.g. `True`, `Equal To`, `Greater Than`).",
				Optional:            true,
				Validators:          []validator.String{monitorStepsFilterTypeValidator},
			},
			"value": schema.StringAttribute{
				MarkdownDescription: "Threshold or comparison value. Always a string — write numbers as strings (e.g. `\"200\"`).",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"evaluate_over_time": schema.BoolAttribute{
				MarkdownDescription: "Evaluate this filter over a time window instead of the latest probe result.",
				Optional:            true,
			},
			"evaluate_over_time_minutes": schema.Int64Attribute{
				MarkdownDescription: "Length of the evaluation window in minutes (used with `evaluate_over_time`).",
				Optional:            true,
				Validators:          []validator.Int64{int64validator.AtLeast(1)},
			},
			"evaluate_over_time_type": schema.StringAttribute{
				MarkdownDescription: "Aggregation applied over the evaluation window (e.g. `Average`, `Sum`, `Any Value`). `All Values` only matches once the window is actually covered by data, so give it a window at least twice the monitoring interval.",
				Optional:            true,
				Validators:          []validator.String{monitorStepsEvaluateOverTimeTypeValidator},
			},
			"evaluate_over_time_no_data_policy": schema.StringAttribute{
				MarkdownDescription: "What the filter does while the evaluation window does not hold enough data to judge it — for example a monitor that has just been created. `Ignore` (the default) does not match, `Trigger` treats the missing data as the failure, and `Treat As Zero` compares the window as a single zero.",
				Optional:            true,
				Validators:          []validator.String{monitorStepsNoDataPolicyValidator},
			},
			"disk_path": schema.StringAttribute{
				MarkdownDescription: "Disk path for `Disk Usage (in %)` filters on Server monitors (e.g. `/` or `C:`).",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"metric_monitor_options": schema.StringAttribute{
				MarkdownDescription: "Raw JSON escape hatch for metric filter options (metricAlias, metricAggregationType, anomaly detection, ...). Write it with `jsonencode()`.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"snmp_monitor_options": schema.StringAttribute{
				MarkdownDescription: "Raw JSON escape hatch for SNMP filter options (oid, interfaceName). Write it with `jsonencode()`.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"database_monitor_options": schema.StringAttribute{
				MarkdownDescription: "Raw JSON escape hatch for Database Health filter options (metricType). Required on every `Database Metric` filter — it names the series the threshold applies to. Write it with `jsonencode()`.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
		},
	}
}

func monitorStepsIncidentSchema() schema.NestedAttributeObject {
	return schema.NestedAttributeObject{
		Attributes: map[string]schema.Attribute{
			"title": schema.StringAttribute{
				MarkdownDescription: "Title of the incident created when this criteria matches.",
				Required:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the incident created when this criteria matches.",
				Required:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"incident_severity_id": schema.StringAttribute{
				MarkdownDescription: "ID of the incident severity to use.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"auto_resolve_incident": schema.BoolAttribute{
				MarkdownDescription: "Automatically resolve the incident when the criteria stops matching.",
				Optional:            true,
			},
			"remediation_notes": schema.StringAttribute{
				MarkdownDescription: "Remediation notes attached to the incident.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"on_call_policy_ids": schema.ListAttribute{
				MarkdownDescription: "IDs of on-call duty policies to execute when the incident is created. Omit instead of passing an empty list.",
				Optional:            true,
				ElementType:         types.StringType,
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"label_ids": schema.ListAttribute{
				MarkdownDescription: "IDs of labels to attach to the incident. Omit instead of passing an empty list.",
				Optional:            true,
				ElementType:         types.StringType,
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"owner_team_ids": schema.ListAttribute{
				MarkdownDescription: "IDs of teams to add as incident owners. Omit instead of passing an empty list.",
				Optional:            true,
				ElementType:         types.StringType,
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"owner_user_ids": schema.ListAttribute{
				MarkdownDescription: "IDs of users to add as incident owners. Omit instead of passing an empty list.",
				Optional:            true,
				ElementType:         types.StringType,
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"show_incident_on_status_page": schema.BoolAttribute{
				MarkdownDescription: "Show the incident on status pages this monitor is attached to.",
				Optional:            true,
			},
			"is_private": schema.BoolAttribute{
				MarkdownDescription: "Mark the incident as private.",
				Optional:            true,
			},
		},
	}
}

func monitorStepsAlertSchema() schema.NestedAttributeObject {
	return schema.NestedAttributeObject{
		Attributes: map[string]schema.Attribute{
			"title": schema.StringAttribute{
				MarkdownDescription: "Title of the alert created when this criteria matches.",
				Required:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the alert created when this criteria matches.",
				Required:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"alert_severity_id": schema.StringAttribute{
				MarkdownDescription: "ID of the alert severity to use.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"auto_resolve_alert": schema.BoolAttribute{
				MarkdownDescription: "Automatically resolve the alert when the criteria stops matching.",
				Optional:            true,
			},
			"remediation_notes": schema.StringAttribute{
				MarkdownDescription: "Remediation notes attached to the alert.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"on_call_policy_ids": schema.ListAttribute{
				MarkdownDescription: "IDs of on-call duty policies to execute when the alert is created. Omit instead of passing an empty list.",
				Optional:            true,
				ElementType:         types.StringType,
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"label_ids": schema.ListAttribute{
				MarkdownDescription: "IDs of labels to attach to the alert. Omit instead of passing an empty list.",
				Optional:            true,
				ElementType:         types.StringType,
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"owner_team_ids": schema.ListAttribute{
				MarkdownDescription: "IDs of teams to add as alert owners. Omit instead of passing an empty list.",
				Optional:            true,
				ElementType:         types.StringType,
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"owner_user_ids": schema.ListAttribute{
				MarkdownDescription: "IDs of users to add as alert owners. Omit instead of passing an empty list.",
				Optional:            true,
				ElementType:         types.StringType,
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"is_private": schema.BoolAttribute{
				MarkdownDescription: "Mark the alert as private.",
				Optional:            true,
			},
		},
	}
}

func monitorStepsCriteriaSchema() schema.NestedAttributeObject {
	return schema.NestedAttributeObject{
		Attributes: map[string]schema.Attribute{
			"name": schema.StringAttribute{
				MarkdownDescription: "Human-readable name of this criteria (e.g. `Check if online`).",
				Required:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of what this criteria checks.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"filter_condition": schema.StringAttribute{
				MarkdownDescription: "How the filters combine: `All` (every filter must match) or `Any` (one match is enough).",
				Required:            true,
				Validators:          []validator.String{monitorStepsFilterConditionValidator},
			},
			"monitor_status_id": schema.StringAttribute{
				MarkdownDescription: "ID of the monitor status (e.g. Operational, Offline) to set when this criteria matches.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"change_monitor_status": schema.BoolAttribute{
				MarkdownDescription: "Change the monitor status to `monitor_status_id` when this criteria matches. Defaults to false server-side.",
				Optional:            true,
			},
			"create_incidents": schema.BoolAttribute{
				MarkdownDescription: "Create the incidents declared in `incidents` when this criteria matches. Defaults to false server-side.",
				Optional:            true,
			},
			"create_alerts": schema.BoolAttribute{
				MarkdownDescription: "Create the alerts declared in `alerts` when this criteria matches. Defaults to false server-side.",
				Optional:            true,
			},
			"is_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether this criteria is evaluated. Defaults to true server-side.",
				Optional:            true,
			},
			"incident_grouping": schema.StringAttribute{
				MarkdownDescription: "Raw JSON escape hatch for per-criteria incident grouping (Incoming Request monitors only; groupByJSONPath, resolvedWhenJSONPath, resolvedWhenValue). Write it with `jsonencode()`.",
				Optional:            true,
				Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"filters": schema.ListNestedAttribute{
				MarkdownDescription: "Conditions evaluated against the probe result. At least one filter is required.",
				Required:            true,
				NestedObject:        monitorStepsFilterSchema(),
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"incidents": schema.ListNestedAttribute{
				MarkdownDescription: "Incident templates created when this criteria matches and `create_incidents` is true. Omit instead of passing an empty list.",
				Optional:            true,
				NestedObject:        monitorStepsIncidentSchema(),
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
			"alerts": schema.ListNestedAttribute{
				MarkdownDescription: "Alert templates created when this criteria matches and `create_alerts` is true. Omit instead of passing an empty list.",
				Optional:            true,
				NestedObject:        monitorStepsAlertSchema(),
				Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
			},
		},
	}
}

func monitorStepsStepSchema() schema.NestedAttributeObject {
	attrs := map[string]schema.Attribute{
		"monitor_destination": schema.StringAttribute{
			MarkdownDescription: "The URL, IP address or hostname this step probes (e.g. `https://example.com`, `8.8.8.8`, `example.com`). Requires `monitor_destination_type`.",
			Optional:            true,
			Validators: []validator.String{
				stringvalidator.LengthAtLeast(1),
				stringvalidator.AlsoRequires(path.MatchRelative().AtParent().AtName("monitor_destination_type")),
			},
		},
		"monitor_destination_type": schema.StringAttribute{
			MarkdownDescription: "Kind of destination: `URL` (Website, API, SSL Certificate monitors), `IP` or `Hostname` (Ping, Port monitors).",
			Optional:            true,
			Validators: []validator.String{
				monitorStepsDestinationTypeValidator,
				stringvalidator.AlsoRequires(path.MatchRelative().AtParent().AtName("monitor_destination")),
			},
		},
		"port": schema.Int64Attribute{
			MarkdownDescription: "TCP port to probe (Port monitors).",
			Optional:            true,
			Validators:          []validator.Int64{int64validator.Between(1, 65535)},
		},
		"request_type": schema.StringAttribute{
			MarkdownDescription: "HTTP method for API monitors (`GET`, `POST`, `PUT`, `DELETE`, `HEAD`, `PATCH`). The server defaults to `GET` when omitted.",
			Optional:            true,
			Validators:          []validator.String{monitorStepsRequestTypeValidator},
		},
		"request_headers": schema.MapAttribute{
			MarkdownDescription: "HTTP request headers sent by API and Website monitors. Omit instead of passing an empty map.",
			Optional:            true,
			ElementType:         types.StringType,
			Validators:          []validator.Map{mapvalidator.SizeAtLeast(1)},
		},
		"request_body": schema.StringAttribute{
			MarkdownDescription: "HTTP request body sent by API monitors.",
			Optional:            true,
			Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
		},
		"do_not_follow_redirects": schema.BoolAttribute{
			MarkdownDescription: "Do not follow HTTP redirects (API and Website monitors).",
			Optional:            true,
		},
		"allow_self_signed_certificates": schema.BoolAttribute{
			MarkdownDescription: "Accept self-signed TLS certificates (API and Website monitors).",
			Optional:            true,
		},
		"tls_client_certificate": schema.StringAttribute{
			MarkdownDescription: "Client certificate (PEM or `{{monitorSecrets.name}}` reference) for mTLS (API and Website monitors).",
			Optional:            true,
			Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
		},
		"tls_client_key": schema.StringAttribute{
			MarkdownDescription: "Client private key (PEM or `{{monitorSecrets.name}}` reference) for mTLS (API and Website monitors).",
			Optional:            true,
			Sensitive:           true,
			Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
		},
		"tls_client_key_passphrase": schema.StringAttribute{
			MarkdownDescription: "Passphrase for the client private key.",
			Optional:            true,
			Sensitive:           true,
			Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
		},
		"custom_code": schema.StringAttribute{
			MarkdownDescription: "JavaScript (Custom Code monitors) or Playwright script (Synthetic monitors) executed by this step.",
			Optional:            true,
			Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
		},
		"screen_size_types": schema.ListAttribute{
			MarkdownDescription: "Screen sizes for Synthetic monitors: `Mobile`, `Tablet`, `Desktop`.",
			Optional:            true,
			ElementType:         types.StringType,
			Validators: []validator.List{
				listvalidator.SizeAtLeast(1),
				listvalidator.ValueStringsAre(monitorStepsScreenSizeTypeValidator),
			},
		},
		"browser_types": schema.ListAttribute{
			MarkdownDescription: "Browsers for Synthetic monitors: `Chromium`, `Firefox`.",
			Optional:            true,
			ElementType:         types.StringType,
			Validators: []validator.List{
				listvalidator.SizeAtLeast(1),
				listvalidator.ValueStringsAre(monitorStepsBrowserTypeValidator),
			},
		},
		"retry_count_on_error": schema.Int64Attribute{
			MarkdownDescription: "Number of retries on script error (Synthetic monitors).",
			Optional:            true,
			Validators:          []validator.Int64{int64validator.AtLeast(1)},
		},
		"request_timeout_in_ms": schema.Int64Attribute{
			MarkdownDescription: "Per-step request timeout in milliseconds for probe-based monitors. Capped at 60000 ms server-side.",
			Optional:            true,
			Validators:          []validator.Int64{int64validator.AtLeast(1)},
		},
		"retry_count": schema.Int64Attribute{
			MarkdownDescription: "Per-step retry count for probe-based monitors when a check fails. Capped at 3 server-side.",
			Optional:            true,
			Validators:          []validator.Int64{int64validator.AtLeast(0)},
		},
		"criteria": schema.ListNestedAttribute{
			MarkdownDescription: "Ordered criteria evaluated after each check. The first matching criteria decides the monitor status and incident/alert actions.",
			Required:            true,
			NestedObject:        monitorStepsCriteriaSchema(),
			Validators:          []validator.List{listvalidator.SizeAtLeast(1)},
		},
	}

	subDescriptions := map[string]string{
		"log_monitor":                  "Raw JSON escape hatch for the Logs monitor query config (attributes, body, severityTexts, telemetryServiceIds, lastXSecondsOfLogs).",
		"trace_monitor":                "Raw JSON escape hatch for the Traces monitor query config.",
		"metric_monitor":               "Raw JSON escape hatch for the Metrics monitor query config (metricViewConfig, rollingTime). The server normalizes this object, so provide the full shape to avoid drift.",
		"exception_monitor":            "Raw JSON escape hatch for the Exceptions monitor query config.",
		"profile_monitor":              "Raw JSON escape hatch for the Profiles monitor query config.",
		"network_device_monitor":       "Raw JSON escape hatch for the Network Device monitor config (networkDeviceId).",
		"dns_monitor":                  "Raw JSON escape hatch for the DNS monitor config (queryName, recordType, ...).",
		"domain_monitor":               "Raw JSON escape hatch for the Domain monitor config (domainName, lookupMethod, timeout, retries). lookupMethod is one of Auto, RDAP, WHOIS and defaults to Auto.",
		"dnssec_monitor":               "Raw JSON escape hatch for the DNSSEC monitor config (domainName, resolvers).",
		"sql_monitor":                  "Raw JSON escape hatch for the SQL Query monitor config (databaseType, host, port, databaseName, query, ...).",
		"database_monitor":             "Raw JSON escape hatch for the Database Health monitor config (databaseType, host, port, databaseName, username, password, enabledMetricGroups, ...).",
		"external_status_page_monitor": "Raw JSON escape hatch for the External Status Page monitor config (statusPageUrl, providerType).",
		"kubernetes_monitor":           "Raw JSON escape hatch for the Kubernetes monitor config (clusterIdentifier, ...).",
		"docker_monitor":               "Raw JSON escape hatch for the Docker monitor config (hostIdentifier, ...).",
		"host_monitor":                 "Raw JSON escape hatch for the Host monitor config (hostIdentifier, ...).",
		"podman_monitor":               "Raw JSON escape hatch for the Podman monitor config (hostIdentifier, ...).",
		"proxmox_monitor":              "Raw JSON escape hatch for the Proxmox monitor config (clusterIdentifier, ...).",
		"docker_swarm_monitor":         "Raw JSON escape hatch for the Docker Swarm monitor config (clusterIdentifier, ...).",
		"ceph_monitor":                 "Raw JSON escape hatch for the Ceph monitor config (clusterIdentifier, ...).",
		"iot_monitor":                  "Raw JSON escape hatch for the IoT monitor config (fleetIdentifier, ...).",
	}

	for _, sub := range monitorStepsSubConfigs {
		attrs[sub.tfName] = schema.StringAttribute{
			MarkdownDescription: subDescriptions[sub.tfName] + " Write it with `jsonencode()`.",
			Optional:            true,
			Validators:          []validator.String{stringvalidator.LengthAtLeast(1)},
		}
	}

	return schema.NestedAttributeObject{Attributes: attrs}
}

// MonitorStepsSchemaAttribute returns the typed nested schema for the
// monitor_steps attribute. Server-generated per-step and per-criteria ids are
// deliberately not part of the schema — the server owns them.
func MonitorStepsSchemaAttribute(description string) schema.ListNestedAttribute {
	return schema.ListNestedAttribute{
		MarkdownDescription: description,
		CustomType:          NewMonitorStepsType(),
		Optional:            true,
		/*
		 * Computed because the server generates default steps when a monitor
		 * is created without any (see MonitorService.onBeforeCreate). With a
		 * plain Optional attribute that would be "planned null, got steps" —
		 * the inconsistent-result class this provider just eliminated.
		 * UseStateForUnknown keeps refresh plans clean once state is settled.
		 */
		Computed: true,
		PlanModifiers: []planmodifier.List{
			listplanmodifier.UseStateForUnknown(),
		},
		NestedObject: monitorStepsStepSchema(),
		Validators:   []validator.List{listvalidator.SizeAtLeast(1)},
	}
}

// ---------------------------------------------------------------------------
// Terraform value accessors (typed list -> Go)
// ---------------------------------------------------------------------------

func monitorStepsAttrString(attrs map[string]attr.Value, name string) (string, bool) {
	v, ok := attrs[name].(types.String)
	if !ok || v.IsNull() || v.IsUnknown() {
		return "", false
	}
	return v.ValueString(), true
}

func monitorStepsAttrBool(attrs map[string]attr.Value, name string) (bool, bool) {
	v, ok := attrs[name].(types.Bool)
	if !ok || v.IsNull() || v.IsUnknown() {
		return false, false
	}
	return v.ValueBool(), true
}

func monitorStepsAttrInt64(attrs map[string]attr.Value, name string) (int64, bool) {
	v, ok := attrs[name].(types.Int64)
	if !ok || v.IsNull() || v.IsUnknown() {
		return 0, false
	}
	return v.ValueInt64(), true
}

func monitorStepsAttrStringList(attrs map[string]attr.Value, name string) ([]string, bool) {
	v, ok := attrs[name].(types.List)
	if !ok || v.IsNull() || v.IsUnknown() {
		return nil, false
	}
	out := make([]string, 0, len(v.Elements()))
	for _, el := range v.Elements() {
		s, ok := el.(types.String)
		if !ok || s.IsNull() || s.IsUnknown() {
			continue
		}
		out = append(out, s.ValueString())
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

func monitorStepsAttrStringMap(attrs map[string]attr.Value, name string) (map[string]interface{}, bool) {
	v, ok := attrs[name].(types.Map)
	if !ok || v.IsNull() || v.IsUnknown() {
		return nil, false
	}
	out := map[string]interface{}{}
	for key, el := range v.Elements() {
		s, ok := el.(types.String)
		if !ok || s.IsNull() || s.IsUnknown() {
			continue
		}
		out[key] = s.ValueString()
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

// monitorStepsAttrJSON parses an escape-hatch attribute (raw JSON string)
// into a JSON object.
func monitorStepsAttrJSON(attrs map[string]attr.Value, name string, attrPath string, diags *diag.Diagnostics) (map[string]interface{}, bool) {
	raw, ok := monitorStepsAttrString(attrs, name)
	if !ok {
		return nil, false
	}
	var parsed interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		diags.AddError(
			"Invalid JSON in monitor_steps",
			fmt.Sprintf("%s.%s is not valid JSON: %s", attrPath, name, err),
		)
		return nil, false
	}
	obj, ok := parsed.(map[string]interface{})
	if !ok {
		diags.AddError(
			"Invalid JSON in monitor_steps",
			fmt.Sprintf("%s.%s must be a JSON object, got %T", attrPath, name, parsed),
		)
		return nil, false
	}
	return obj, true
}

// ---------------------------------------------------------------------------
// ToAPI: typed list -> wire envelope
// ---------------------------------------------------------------------------

func monitorStepsFilterToAPI(attrs map[string]attr.Value, attrPath string, diags *diag.Diagnostics) map[string]interface{} {
	out := map[string]interface{}{}
	if v, ok := monitorStepsAttrString(attrs, "check_on"); ok {
		out["checkOn"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "filter_type"); ok {
		out["filterType"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "value"); ok {
		out["value"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "evaluate_over_time"); ok {
		out["evaluateOverTime"] = v
	}
	evalOpts := map[string]interface{}{}
	if v, ok := monitorStepsAttrInt64(attrs, "evaluate_over_time_minutes"); ok {
		evalOpts["timeValueInMinutes"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "evaluate_over_time_type"); ok {
		evalOpts["evaluateOverTimeType"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "evaluate_over_time_no_data_policy"); ok {
		evalOpts["onNoDataPolicy"] = v
	}
	if len(evalOpts) > 0 {
		out["evaluateOverTimeOptions"] = evalOpts
	}
	if v, ok := monitorStepsAttrString(attrs, "disk_path"); ok {
		out["serverMonitorOptions"] = map[string]interface{}{"diskPath": v}
	}
	if v, ok := monitorStepsAttrJSON(attrs, "metric_monitor_options", attrPath, diags); ok {
		out["metricMonitorOptions"] = v
	}
	if v, ok := monitorStepsAttrJSON(attrs, "snmp_monitor_options", attrPath, diags); ok {
		out["snmpMonitorOptions"] = v
	}
	if v, ok := monitorStepsAttrJSON(attrs, "database_monitor_options", attrPath, diags); ok {
		out["databaseMonitorOptions"] = v
	}
	return out
}

func monitorStepsIncidentToAPI(attrs map[string]attr.Value) map[string]interface{} {
	out := map[string]interface{}{}
	if v, ok := monitorStepsAttrString(attrs, "title"); ok {
		out["title"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "description"); ok {
		out["description"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "incident_severity_id"); ok {
		out["incidentSeverityId"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "auto_resolve_incident"); ok {
		out["autoResolveIncident"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "remediation_notes"); ok {
		out["remediationNotes"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "on_call_policy_ids"); ok {
		out["onCallPolicyIds"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "label_ids"); ok {
		out["labelIds"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "owner_team_ids"); ok {
		out["ownerTeamIds"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "owner_user_ids"); ok {
		out["ownerUserIds"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "show_incident_on_status_page"); ok {
		out["showIncidentOnStatusPage"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "is_private"); ok {
		out["isPrivate"] = v
	}
	return out
}

func monitorStepsAlertToAPI(attrs map[string]attr.Value) map[string]interface{} {
	out := map[string]interface{}{}
	if v, ok := monitorStepsAttrString(attrs, "title"); ok {
		out["title"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "description"); ok {
		out["description"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "alert_severity_id"); ok {
		out["alertSeverityId"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "auto_resolve_alert"); ok {
		out["autoResolveAlert"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "remediation_notes"); ok {
		out["remediationNotes"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "on_call_policy_ids"); ok {
		out["onCallPolicyIds"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "label_ids"); ok {
		out["labelIds"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "owner_team_ids"); ok {
		out["ownerTeamIds"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "owner_user_ids"); ok {
		out["ownerUserIds"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "is_private"); ok {
		out["isPrivate"] = v
	}
	return out
}

func monitorStepsObjectListElements(attrs map[string]attr.Value, name string) ([]types.Object, bool) {
	v, ok := attrs[name].(types.List)
	if !ok || v.IsNull() || v.IsUnknown() {
		return nil, false
	}
	out := make([]types.Object, 0, len(v.Elements()))
	for _, el := range v.Elements() {
		obj, ok := el.(types.Object)
		if !ok || obj.IsNull() || obj.IsUnknown() {
			continue
		}
		out = append(out, obj)
	}
	return out, true
}

func monitorStepsCriteriaToAPI(attrs map[string]attr.Value, attrPath string, diags *diag.Diagnostics) map[string]interface{} {
	value := map[string]interface{}{}
	if v, ok := monitorStepsAttrString(attrs, "name"); ok {
		value["name"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "description"); ok {
		value["description"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "filter_condition"); ok {
		value["filterCondition"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "monitor_status_id"); ok {
		value["monitorStatusId"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "change_monitor_status"); ok {
		value["changeMonitorStatus"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "create_incidents"); ok {
		value["createIncidents"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "create_alerts"); ok {
		value["createAlerts"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "is_enabled"); ok {
		value["isEnabled"] = v
	}
	if v, ok := monitorStepsAttrJSON(attrs, "incident_grouping", attrPath, diags); ok {
		value["incidentGrouping"] = v
	}

	if filterObjs, ok := monitorStepsObjectListElements(attrs, "filters"); ok {
		filters := make([]interface{}, 0, len(filterObjs))
		for i, obj := range filterObjs {
			filters = append(filters, monitorStepsFilterToAPI(obj.Attributes(), fmt.Sprintf("%s.filters[%d]", attrPath, i), diags))
		}
		value["filters"] = filters
	}

	if incidentObjs, ok := monitorStepsObjectListElements(attrs, "incidents"); ok {
		incidents := make([]interface{}, 0, len(incidentObjs))
		for _, obj := range incidentObjs {
			incidents = append(incidents, monitorStepsIncidentToAPI(obj.Attributes()))
		}
		value["incidents"] = incidents
	}

	if alertObjs, ok := monitorStepsObjectListElements(attrs, "alerts"); ok {
		alerts := make([]interface{}, 0, len(alertObjs))
		for _, obj := range alertObjs {
			alerts = append(alerts, monitorStepsAlertToAPI(obj.Attributes()))
		}
		value["alerts"] = alerts
	}

	return map[string]interface{}{
		"_type": "MonitorCriteriaInstance",
		"value": value,
	}
}

func monitorStepsStepToAPI(attrs map[string]attr.Value, attrPath string, diags *diag.Diagnostics) map[string]interface{} {
	value := map[string]interface{}{}

	dest, destOK := monitorStepsAttrString(attrs, "monitor_destination")
	destType, destTypeOK := monitorStepsAttrString(attrs, "monitor_destination_type")
	if destOK {
		if !destTypeOK {
			diags.AddError(
				"Invalid monitor_steps",
				fmt.Sprintf("%s: monitor_destination_type is required when monitor_destination is set", attrPath),
			)
		} else {
			value["monitorDestination"] = map[string]interface{}{
				"_type": destType,
				"value": dest,
			}
		}
	} else if destTypeOK {
		diags.AddError(
			"Invalid monitor_steps",
			fmt.Sprintf("%s: monitor_destination is required when monitor_destination_type is set", attrPath),
		)
	}

	if v, ok := monitorStepsAttrInt64(attrs, "port"); ok {
		value["monitorDestinationPort"] = map[string]interface{}{
			"_type": "Port",
			"value": v,
		}
	}
	if v, ok := monitorStepsAttrString(attrs, "request_type"); ok {
		value["requestType"] = v
	}
	if v, ok := monitorStepsAttrStringMap(attrs, "request_headers"); ok {
		value["requestHeaders"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "request_body"); ok {
		value["requestBody"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "do_not_follow_redirects"); ok {
		value["doNotFollowRedirects"] = v
	}
	if v, ok := monitorStepsAttrBool(attrs, "allow_self_signed_certificates"); ok {
		value["allowSelfSignedCertificates"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "tls_client_certificate"); ok {
		value["tlsClientCertificate"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "tls_client_key"); ok {
		value["tlsClientKey"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "tls_client_key_passphrase"); ok {
		value["tlsClientKeyPassphrase"] = v
	}
	if v, ok := monitorStepsAttrString(attrs, "custom_code"); ok {
		value["customCode"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "screen_size_types"); ok {
		value["screenSizeTypes"] = v
	}
	if v, ok := monitorStepsAttrStringList(attrs, "browser_types"); ok {
		value["browserTypes"] = v
	}
	if v, ok := monitorStepsAttrInt64(attrs, "retry_count_on_error"); ok {
		value["retryCountOnError"] = v
	}
	if v, ok := monitorStepsAttrInt64(attrs, "request_timeout_in_ms"); ok {
		value["requestTimeoutInMs"] = v
	}
	if v, ok := monitorStepsAttrInt64(attrs, "retry_count"); ok {
		value["retryCount"] = v
	}

	for _, sub := range monitorStepsSubConfigs {
		if v, ok := monitorStepsAttrJSON(attrs, sub.tfName, attrPath, diags); ok {
			value[sub.apiKey] = v
		}
	}

	if criteriaObjs, ok := monitorStepsObjectListElements(attrs, "criteria"); ok {
		instances := make([]interface{}, 0, len(criteriaObjs))
		for i, obj := range criteriaObjs {
			instances = append(instances, monitorStepsCriteriaToAPI(obj.Attributes(), fmt.Sprintf("%s.criteria[%d]", attrPath, i), diags))
		}
		value["monitorCriteria"] = map[string]interface{}{
			"_type": "MonitorCriteria",
			"value": map[string]interface{}{
				"monitorCriteriaInstanceArray": instances,
			},
		}
	}

	return map[string]interface{}{
		"_type": "MonitorStep",
		"value": value,
	}
}

// MonitorStepsToAPI converts the typed monitor_steps list into the wire
// envelope the OneUptime API expects. Null or unknown lists convert to nil
// (the field is omitted from the request). Server-generated ids are never
// sent — the server assigns them.
func MonitorStepsToAPI(ctx context.Context, list types.List) (interface{}, diag.Diagnostics) {
	var diags diag.Diagnostics
	_ = ctx

	if list.IsNull() || list.IsUnknown() {
		return nil, diags
	}

	steps := make([]interface{}, 0, len(list.Elements()))
	for i, el := range list.Elements() {
		obj, ok := el.(types.Object)
		if !ok || obj.IsNull() || obj.IsUnknown() {
			continue
		}
		steps = append(steps, monitorStepsStepToAPI(obj.Attributes(), fmt.Sprintf("monitor_steps[%d]", i), &diags))
	}

	return map[string]interface{}{
		"_type": "MonitorSteps",
		"value": map[string]interface{}{
			"monitorStepsInstanceArray": steps,
		},
	}, diags
}

// ---------------------------------------------------------------------------
// FromAPI: wire envelope -> typed list
// ---------------------------------------------------------------------------

// monitorStepsNullAttrValues returns an attribute value map with every
// attribute set to its typed null.
func monitorStepsNullAttrValues(attrTypes map[string]attr.Type) map[string]attr.Value {
	out := make(map[string]attr.Value, len(attrTypes))
	for name, t := range attrTypes {
		switch tt := t.(type) {
		case basetypes.StringType:
			out[name] = types.StringNull()
		case basetypes.BoolType:
			out[name] = types.BoolNull()
		case basetypes.Int64Type:
			out[name] = types.Int64Null()
		case basetypes.ListType:
			out[name] = types.ListNull(tt.ElemType)
		case basetypes.MapType:
			out[name] = types.MapNull(tt.ElemType)
		case basetypes.ObjectType:
			out[name] = types.ObjectNull(tt.AttrTypes)
		default:
			// The attribute trees above only use the types handled here.
			out[name] = types.StringNull()
		}
	}
	return out
}

// monitorStepsAPIUnwrap unwraps a {_type: ..., value: {...}} envelope,
// returning the inner value map. Bare maps pass through unchanged.
func monitorStepsAPIUnwrap(m map[string]interface{}) map[string]interface{} {
	if _, hasType := m["_type"]; hasType {
		if inner, ok := m["value"].(map[string]interface{}); ok {
			return inner
		}
	}
	return m
}

// monitorStepsAPIString coerces a response value into a string. It accepts
// plain strings and {_type/..., value: "..."} wrapper objects (e.g. ObjectID
// envelopes). Empty strings report not-ok: the schema forbids them in
// config, so absent-or-empty always means "unset".
func monitorStepsAPIString(v interface{}) (string, bool) {
	switch t := v.(type) {
	case string:
		if t == "" {
			return "", false
		}
		return t, true
	case map[string]interface{}:
		if inner, ok := t["value"].(string); ok && inner != "" {
			return inner, true
		}
	}
	return "", false
}

func monitorStepsAPIBool(v interface{}) (bool, bool) {
	b, ok := v.(bool)
	return b, ok
}

func monitorStepsAPIInt64(v interface{}) (int64, bool) {
	switch t := v.(type) {
	case float64:
		return int64(t), true
	case int:
		return int64(t), true
	case int64:
		return t, true
	case json.Number:
		if i, err := t.Int64(); err == nil {
			return i, true
		}
	case map[string]interface{}:
		// Wrapper objects like {"_type": "Port", "value": 443}.
		if inner, ok := t["value"]; ok {
			return monitorStepsAPIInt64(inner)
		}
	}
	return 0, false
}

// monitorStepsAPINumberOrString renders a filter value (string | number on
// the wire) as the schema's string form.
func monitorStepsAPINumberOrString(v interface{}) (string, bool) {
	switch t := v.(type) {
	case string:
		if t == "" {
			return "", false
		}
		return t, true
	case float64:
		return monitorStepsFormatFloat(t), true
	case int:
		return fmt.Sprintf("%d", t), true
	case int64:
		return fmt.Sprintf("%d", t), true
	case json.Number:
		return t.String(), true
	}
	return "", false
}

func monitorStepsFormatFloat(f float64) string {
	// Render whole numbers without a decimal point ("200", not "200.0")
	// and keep fractional values exact ("99.5").
	b, _ := json.Marshal(f)
	return string(b)
}

func monitorStepsAPIStringList(v interface{}) ([]attr.Value, bool) {
	arr, ok := v.([]interface{})
	if !ok || len(arr) == 0 {
		return nil, false
	}
	out := make([]attr.Value, 0, len(arr))
	for _, el := range arr {
		if s, ok := monitorStepsAPIString(el); ok {
			out = append(out, types.StringValue(s))
		}
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

// monitorStepsAPIJSONString renders a response sub-object back into the
// escape hatch's canonical raw-JSON string form (compact, keys sorted — the
// same form terraform's jsonencode() produces).
func monitorStepsAPIJSONString(v interface{}) (string, bool) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return "", false
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "", false
	}
	return string(b), true
}

func monitorStepsFilterFromAPI(v interface{}, diags *diag.Diagnostics) (types.Object, bool) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return types.ObjectNull(monitorStepsFilterAttrTypes()), false
	}
	// Legacy rows may store filters wrapped as {_type: "CriteriaFilter",
	// value: {...}} — unwrap so both shapes import cleanly.
	m = monitorStepsAPIUnwrap(m)

	attrs := monitorStepsNullAttrValues(monitorStepsFilterAttrTypes())
	if s, ok := monitorStepsAPIString(m["checkOn"]); ok {
		attrs["check_on"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["filterType"]); ok {
		attrs["filter_type"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPINumberOrString(m["value"]); ok {
		attrs["value"] = types.StringValue(s)
	}
	if b, ok := monitorStepsAPIBool(m["evaluateOverTime"]); ok {
		attrs["evaluate_over_time"] = types.BoolValue(b)
	}
	if opts, ok := m["evaluateOverTimeOptions"].(map[string]interface{}); ok {
		if n, ok := monitorStepsAPIInt64(opts["timeValueInMinutes"]); ok {
			attrs["evaluate_over_time_minutes"] = types.Int64Value(n)
		}
		if s, ok := monitorStepsAPIString(opts["evaluateOverTimeType"]); ok {
			attrs["evaluate_over_time_type"] = types.StringValue(s)
		}
		if s, ok := monitorStepsAPIString(opts["onNoDataPolicy"]); ok {
			attrs["evaluate_over_time_no_data_policy"] = types.StringValue(s)
		}
	}
	if opts, ok := m["serverMonitorOptions"].(map[string]interface{}); ok {
		if s, ok := monitorStepsAPIString(opts["diskPath"]); ok {
			attrs["disk_path"] = types.StringValue(s)
		}
	}
	if s, ok := monitorStepsAPIJSONString(m["metricMonitorOptions"]); ok {
		attrs["metric_monitor_options"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIJSONString(m["snmpMonitorOptions"]); ok {
		attrs["snmp_monitor_options"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIJSONString(m["databaseMonitorOptions"]); ok {
		attrs["database_monitor_options"] = types.StringValue(s)
	}
	// metricCriteriaContext (evaluation-time context) and any unknown keys
	// are intentionally dropped.

	obj, d := types.ObjectValue(monitorStepsFilterAttrTypes(), attrs)
	diags.Append(d...)
	return obj, !d.HasError()
}

func monitorStepsIncidentFromAPI(v interface{}, diags *diag.Diagnostics) (types.Object, bool) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return types.ObjectNull(monitorStepsIncidentAttrTypes()), false
	}
	m = monitorStepsAPIUnwrap(m)

	attrs := monitorStepsNullAttrValues(monitorStepsIncidentAttrTypes())
	if s, ok := monitorStepsAPIString(m["title"]); ok {
		attrs["title"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["description"]); ok {
		attrs["description"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["incidentSeverityId"]); ok {
		attrs["incident_severity_id"] = types.StringValue(s)
	}
	if b, ok := monitorStepsAPIBool(m["autoResolveIncident"]); ok {
		attrs["auto_resolve_incident"] = types.BoolValue(b)
	}
	if s, ok := monitorStepsAPIString(m["remediationNotes"]); ok {
		attrs["remediation_notes"] = types.StringValue(s)
	}
	stringListKeys := map[string]string{
		"on_call_policy_ids": "onCallPolicyIds",
		"label_ids":          "labelIds",
		"owner_team_ids":     "ownerTeamIds",
		"owner_user_ids":     "ownerUserIds",
	}
	for tfName, apiKey := range stringListKeys {
		if els, ok := monitorStepsAPIStringList(m[apiKey]); ok {
			l, d := types.ListValue(types.StringType, els)
			diags.Append(d...)
			attrs[tfName] = l
		}
	}
	if b, ok := monitorStepsAPIBool(m["showIncidentOnStatusPage"]); ok {
		attrs["show_incident_on_status_page"] = types.BoolValue(b)
	}
	if b, ok := monitorStepsAPIBool(m["isPrivate"]); ok {
		attrs["is_private"] = types.BoolValue(b)
	}
	// id and incidentMemberRoles are intentionally dropped.

	obj, d := types.ObjectValue(monitorStepsIncidentAttrTypes(), attrs)
	diags.Append(d...)
	return obj, !d.HasError()
}

func monitorStepsAlertFromAPI(v interface{}, diags *diag.Diagnostics) (types.Object, bool) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return types.ObjectNull(monitorStepsAlertAttrTypes()), false
	}
	m = monitorStepsAPIUnwrap(m)

	attrs := monitorStepsNullAttrValues(monitorStepsAlertAttrTypes())
	if s, ok := monitorStepsAPIString(m["title"]); ok {
		attrs["title"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["description"]); ok {
		attrs["description"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["alertSeverityId"]); ok {
		attrs["alert_severity_id"] = types.StringValue(s)
	}
	if b, ok := monitorStepsAPIBool(m["autoResolveAlert"]); ok {
		attrs["auto_resolve_alert"] = types.BoolValue(b)
	}
	if s, ok := monitorStepsAPIString(m["remediationNotes"]); ok {
		attrs["remediation_notes"] = types.StringValue(s)
	}
	stringListKeys := map[string]string{
		"on_call_policy_ids": "onCallPolicyIds",
		"label_ids":          "labelIds",
		"owner_team_ids":     "ownerTeamIds",
		"owner_user_ids":     "ownerUserIds",
	}
	for tfName, apiKey := range stringListKeys {
		if els, ok := monitorStepsAPIStringList(m[apiKey]); ok {
			l, d := types.ListValue(types.StringType, els)
			diags.Append(d...)
			attrs[tfName] = l
		}
	}
	if b, ok := monitorStepsAPIBool(m["isPrivate"]); ok {
		attrs["is_private"] = types.BoolValue(b)
	}
	// id is intentionally dropped.

	obj, d := types.ObjectValue(monitorStepsAlertAttrTypes(), attrs)
	diags.Append(d...)
	return obj, !d.HasError()
}

func monitorStepsCriteriaFromAPI(v interface{}, diags *diag.Diagnostics) (types.Object, bool) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return types.ObjectNull(monitorStepsCriteriaAttrTypes()), false
	}
	m = monitorStepsAPIUnwrap(m)

	attrs := monitorStepsNullAttrValues(monitorStepsCriteriaAttrTypes())
	if s, ok := monitorStepsAPIString(m["name"]); ok {
		attrs["name"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["description"]); ok {
		attrs["description"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["filterCondition"]); ok {
		attrs["filter_condition"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["monitorStatusId"]); ok {
		attrs["monitor_status_id"] = types.StringValue(s)
	}
	if b, ok := monitorStepsAPIBool(m["changeMonitorStatus"]); ok {
		attrs["change_monitor_status"] = types.BoolValue(b)
	}
	if b, ok := monitorStepsAPIBool(m["createIncidents"]); ok {
		attrs["create_incidents"] = types.BoolValue(b)
	}
	if b, ok := monitorStepsAPIBool(m["createAlerts"]); ok {
		attrs["create_alerts"] = types.BoolValue(b)
	}
	if b, ok := monitorStepsAPIBool(m["isEnabled"]); ok {
		attrs["is_enabled"] = types.BoolValue(b)
	}
	if s, ok := monitorStepsAPIJSONString(m["incidentGrouping"]); ok {
		attrs["incident_grouping"] = types.StringValue(s)
	}

	if raw, ok := m["filters"].([]interface{}); ok && len(raw) > 0 {
		els := make([]attr.Value, 0, len(raw))
		for _, f := range raw {
			if obj, ok := monitorStepsFilterFromAPI(f, diags); ok {
				els = append(els, obj)
			}
		}
		if len(els) > 0 {
			l, d := types.ListValue(types.ObjectType{AttrTypes: monitorStepsFilterAttrTypes()}, els)
			diags.Append(d...)
			attrs["filters"] = l
		}
	}
	// The server echoes incidents/alerts as [] when unset — treat
	// absent-or-empty as unset so unused templates stay null.
	if raw, ok := m["incidents"].([]interface{}); ok && len(raw) > 0 {
		els := make([]attr.Value, 0, len(raw))
		for _, inc := range raw {
			if obj, ok := monitorStepsIncidentFromAPI(inc, diags); ok {
				els = append(els, obj)
			}
		}
		if len(els) > 0 {
			l, d := types.ListValue(types.ObjectType{AttrTypes: monitorStepsIncidentAttrTypes()}, els)
			diags.Append(d...)
			attrs["incidents"] = l
		}
	}
	if raw, ok := m["alerts"].([]interface{}); ok && len(raw) > 0 {
		els := make([]attr.Value, 0, len(raw))
		for _, al := range raw {
			if obj, ok := monitorStepsAlertFromAPI(al, diags); ok {
				els = append(els, obj)
			}
		}
		if len(els) > 0 {
			l, d := types.ListValue(types.ObjectType{AttrTypes: monitorStepsAlertAttrTypes()}, els)
			diags.Append(d...)
			attrs["alerts"] = l
		}
	}
	// id is intentionally dropped.

	obj, d := types.ObjectValue(monitorStepsCriteriaAttrTypes(), attrs)
	diags.Append(d...)
	return obj, !d.HasError()
}

func monitorStepsStepFromAPI(v interface{}, diags *diag.Diagnostics) (types.Object, bool) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return types.ObjectNull(monitorStepsStepAttrTypes()), false
	}
	m = monitorStepsAPIUnwrap(m)

	attrs := monitorStepsNullAttrValues(monitorStepsStepAttrTypes())

	if dest, ok := m["monitorDestination"].(map[string]interface{}); ok {
		if s, ok := monitorStepsAPIString(dest["value"]); ok {
			if destType, ok := dest["_type"].(string); ok {
				for _, known := range monitorStepsDestinationTypeValues {
					if destType == known {
						attrs["monitor_destination"] = types.StringValue(s)
						attrs["monitor_destination_type"] = types.StringValue(destType)
						break
					}
				}
			}
		}
	}
	if n, ok := monitorStepsAPIInt64(m["monitorDestinationPort"]); ok {
		attrs["port"] = types.Int64Value(n)
	}
	if s, ok := monitorStepsAPIString(m["requestType"]); ok {
		attrs["request_type"] = types.StringValue(s)
	}
	if headers, ok := m["requestHeaders"].(map[string]interface{}); ok && len(headers) > 0 {
		els := make(map[string]attr.Value, len(headers))
		for key, hv := range headers {
			if s, ok := hv.(string); ok {
				els[key] = types.StringValue(s)
			}
		}
		if len(els) > 0 {
			mv, d := types.MapValue(types.StringType, els)
			diags.Append(d...)
			attrs["request_headers"] = mv
		}
	}
	if s, ok := monitorStepsAPIString(m["requestBody"]); ok {
		attrs["request_body"] = types.StringValue(s)
	}
	if b, ok := monitorStepsAPIBool(m["doNotFollowRedirects"]); ok {
		attrs["do_not_follow_redirects"] = types.BoolValue(b)
	}
	if b, ok := monitorStepsAPIBool(m["allowSelfSignedCertificates"]); ok {
		attrs["allow_self_signed_certificates"] = types.BoolValue(b)
	}
	if s, ok := monitorStepsAPIString(m["tlsClientCertificate"]); ok {
		attrs["tls_client_certificate"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["tlsClientKey"]); ok {
		attrs["tls_client_key"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["tlsClientKeyPassphrase"]); ok {
		attrs["tls_client_key_passphrase"] = types.StringValue(s)
	}
	if s, ok := monitorStepsAPIString(m["customCode"]); ok {
		attrs["custom_code"] = types.StringValue(s)
	}
	if els, ok := monitorStepsAPIStringList(m["screenSizeTypes"]); ok {
		l, d := types.ListValue(types.StringType, els)
		diags.Append(d...)
		attrs["screen_size_types"] = l
	}
	if els, ok := monitorStepsAPIStringList(m["browserTypes"]); ok {
		l, d := types.ListValue(types.StringType, els)
		diags.Append(d...)
		attrs["browser_types"] = l
	}
	if n, ok := monitorStepsAPIInt64(m["retryCountOnError"]); ok {
		attrs["retry_count_on_error"] = types.Int64Value(n)
	}
	if n, ok := monitorStepsAPIInt64(m["requestTimeoutInMs"]); ok {
		attrs["request_timeout_in_ms"] = types.Int64Value(n)
	}
	if n, ok := monitorStepsAPIInt64(m["retryCount"]); ok {
		attrs["retry_count"] = types.Int64Value(n)
	}

	for _, sub := range monitorStepsSubConfigs {
		if s, ok := monitorStepsAPIJSONString(m[sub.apiKey]); ok {
			attrs[sub.tfName] = types.StringValue(s)
		}
	}

	if criteria, ok := m["monitorCriteria"].(map[string]interface{}); ok {
		inner := monitorStepsAPIUnwrap(criteria)
		if raw, ok := inner["monitorCriteriaInstanceArray"].([]interface{}); ok && len(raw) > 0 {
			els := make([]attr.Value, 0, len(raw))
			for _, c := range raw {
				if obj, ok := monitorStepsCriteriaFromAPI(c, diags); ok {
					els = append(els, obj)
				}
			}
			if len(els) > 0 {
				l, d := types.ListValue(types.ObjectType{AttrTypes: monitorStepsCriteriaAttrTypes()}, els)
				diags.Append(d...)
				attrs["criteria"] = l
			}
		}
	}
	// id and the server-hydrated snmpMonitor carrier are intentionally
	// dropped, as is any key not modeled by the schema.

	obj, d := types.ObjectValue(monitorStepsStepAttrTypes(), attrs)
	diags.Append(d...)
	return obj, !d.HasError()
}

// MonitorStepsFromAPI converts an API response value into the typed
// monitor_steps list. It accepts the {_type: "MonitorSteps", value: {...}}
// envelope, an already-unwrapped value map, or nil. Unset or absent input
// yields the typed null list. Only schema-known fields are mapped:
// server-generated ids, the server-hydrated snmpMonitor carrier and unknown
// keys are dropped so server-side extras never cause drift.
func MonitorStepsFromAPI(ctx context.Context, value interface{}) (types.List, diag.Diagnostics) {
	var diags diag.Diagnostics
	_ = ctx

	if value == nil {
		return MonitorStepsNull(), diags
	}

	m, ok := value.(map[string]interface{})
	if !ok {
		diags.AddError(
			"Invalid monitorSteps in API response",
			fmt.Sprintf("expected a MonitorSteps object, got %T", value),
		)
		return MonitorStepsNull(), diags
	}

	inner := m
	if wrapped, ok := m["value"].(map[string]interface{}); ok {
		inner = wrapped
	} else if t, hasType := m["_type"].(string); hasType && t == "MonitorSteps" && m["value"] == nil {
		// An empty envelope ({_type: "MonitorSteps"} with no value) means
		// the field is unset.
		return MonitorStepsNull(), diags
	}

	rawSteps, ok := inner["monitorStepsInstanceArray"].([]interface{})
	if !ok {
		if inner["monitorStepsInstanceArray"] == nil {
			keys := make([]string, 0, len(inner))
			for k := range inner {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			diags.AddError(
				"Invalid monitorSteps in API response",
				fmt.Sprintf("monitorStepsInstanceArray not found (keys: %v)", keys),
			)
		} else {
			diags.AddError(
				"Invalid monitorSteps in API response",
				fmt.Sprintf("monitorStepsInstanceArray is %T, expected an array", inner["monitorStepsInstanceArray"]),
			)
		}
		return MonitorStepsNull(), diags
	}

	els := make([]attr.Value, 0, len(rawSteps))
	for _, s := range rawSteps {
		if obj, ok := monitorStepsStepFromAPI(s, &diags); ok {
			els = append(els, obj)
		}
	}
	if diags.HasError() {
		return MonitorStepsNull(), diags
	}

	list, d := types.ListValue(types.ObjectType{AttrTypes: monitorStepsStepAttrTypes()}, els)
	diags.Append(d...)
	if diags.HasError() {
		return MonitorStepsNull(), diags
	}
	return list, diags
}
