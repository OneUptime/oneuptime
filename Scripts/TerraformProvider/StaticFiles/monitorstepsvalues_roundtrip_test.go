package provider

/*
 * A monitor and a monitor template whose steps write values OneUptime reads
 * another way - the rolling time "15 minutes", the aggregation "avg" -
 * through the provider's real protocol server, as terraform validate, plan,
 * apply, refresh and import drive it, against a fake API that stores and
 * answers them as OneUptime does: "Past 15 Minutes", "Average"
 * (OneUptime/oneuptime#6723).
 *
 * Before, the apply failed with "Provider produced inconsistent result after
 * apply" and left the monitor tainted, and the plan after an import changed
 * its steps. A value OneUptime would refuse at apply is refused by terraform
 * validate, in the server's words, and only where the server refuses it.
 */

import (
	"context"
	"encoding/json"
	"fmt"
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
	stepValuesAPIKey    = "monitor-step-values-key"
	stepValuesProjectID = "a1000000-0000-4000-8000-000000000201"
	stepValuesCreatedAt = "2026-11-11T08:00:00.000Z"
)

// The resources whose steps are monitor steps, and where the API keeps them.
var stepValuesResources = []struct {
	typeName      string
	table         string
	nameAttribute string
	apiName       string
}{
	{"oneuptime_monitor", "/monitor", "name", "name"},
	{"oneuptime_monitor_template", "/monitor-template", "template_name", "templateName"},
}

/*
 * What the fake API stores for each spelling a test writes. A stand-in for
 * the server's reading, written out so that this test does not check the
 * provider's reading against itself: monitorstepsvalues_test.go checks that
 * one against the server's, case by case.
 */
var stepValuesStoredRollingTimes = map[string]string{
	"15 minutes": "Past 15 Minutes",
	"30m":        "Past 30 Minutes",
	"PT1H":       "Past 1 Hour",
}

var stepValuesStoredOptions = map[string]string{
	"avg":     "Average",
	"maximum": "Maximum Value",
	"trigger": "Trigger",
}

// The metric query of the customer's monitor, with made-up names.
var stepValuesMetricView = map[string]interface{}{
	"queryConfigs": []interface{}{
		map[string]interface{}{
			"metricAliasData": map[string]interface{}{"metricVariable": "a", "title": "HTTP 5xx"},
			"metricQueryData": map[string]interface{}{
				"filterData": map[string]interface{}{"metricName": "azure_http5xx_total", "aggegationType": "Sum"},
			},
		},
	},
	"formulaConfigs": []interface{}{},
}

// stepValuesAPI is the fake OneUptime API: monitors and monitor templates,
// kept and answered as OneUptime keeps them.
type stepValuesAPI struct {
	t      *testing.T
	server *httptest.Server

	mu      sync.Mutex
	rows    map[string]map[string]map[string]interface{}
	writes  map[string]int
	created int
}

func newStepValuesAPI(t *testing.T) *stepValuesAPI {
	t.Helper()
	api := &stepValuesAPI{t: t, rows: map[string]map[string]map[string]interface{}{}, writes: map[string]int{}}
	for _, resource := range stepValuesResources {
		api.rows[resource.table] = map[string]map[string]interface{}{}
	}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

// stepValuesStore is a write's monitor steps as OneUptime stores them: a
// rolling time and a metric option written another way as the one it means,
// and each criteria's defaults written out.
func stepValuesStore(t *testing.T, sent interface{}) interface{} {
	raw, err := json.Marshal(sent)
	if err != nil {
		t.Errorf("copying the steps: %s", err)
	}
	var steps interface{}
	if err := json.Unmarshal(raw, &steps); err != nil {
		t.Errorf("copying the steps: %s", err)
	}

	instances, _ := monitorStepsWireValue(steps)["monitorStepsInstanceArray"].([]interface{})
	for _, rawStep := range instances {
		step := monitorStepsWireValue(rawStep)
		for _, key := range []string{"metricMonitor", "kubernetesMonitor"} {
			settings, _ := step[key].(map[string]interface{})
			if written, ok := settings["rollingTime"].(string); ok {
				if stored, ok := stepValuesStoredRollingTimes[written]; ok {
					settings["rollingTime"] = stored
				}
			}
		}

		criteria, _ := monitorStepsWireValue(step["monitorCriteria"])["monitorCriteriaInstanceArray"].([]interface{})
		for _, rawCriteria := range criteria {
			criteria := monitorStepsWireValue(rawCriteria)
			for key, value := range serverCriteriaDefaults {
				if _, has := criteria[key]; !has {
					criteria[key] = value
				}
			}
			filters, _ := criteria["filters"].([]interface{})
			for _, rawFilter := range filters {
				filter, _ := rawFilter.(map[string]interface{})
				options, _ := filter["metricMonitorOptions"].(map[string]interface{})
				for _, key := range []string{"metricAggregationType", "onNoDataPolicy"} {
					if written, ok := options[key].(string); ok {
						if stored, ok := stepValuesStoredOptions[written]; ok {
							options[key] = stored
						}
					}
				}
			}
		}
	}
	return steps
}

// keep writes a create's or an update's data into the row.
func (a *stepValuesAPI) keep(row map[string]interface{}, data map[string]interface{}) {
	for key, value := range data {
		if key == "monitorSteps" {
			value = stepValuesStore(a.t, value)
		}
		row[key] = value
	}
}

// What OneUptime keeps of a new monitor that no write sets.
var stepValuesMonitorDefaults = map[string]interface{}{
	"disableActiveMonitoringBecauseOfScheduledMaintenanceEvent": false,
	"disableActiveMonitoringBecauseOfManualIncident":            false,
	"isOwnerNotifiedOfResourceCreation":                         false,
	"isNoProbeEnabledOnThisMonitor":                             false,
	"isAllProbesDisconnectedFromThisMonitor":                    false,
}

// answer is a row as the API answers it.
func (a *stepValuesAPI) answer(id string, row map[string]interface{}) map[string]interface{} {
	answer := map[string]interface{}{
		"_id":       id,
		"projectId": map[string]interface{}{"_type": "ObjectID", "value": stepValuesProjectID},
		"createdAt": map[string]interface{}{"_type": "DateTime", "value": stepValuesCreatedAt},
		"updatedAt": map[string]interface{}{"_type": "DateTime", "value": stepValuesCreatedAt},
	}
	if _, isMonitor := a.rows["/monitor"][id]; isMonitor {
		for key, value := range stepValuesMonitorDefaults {
			answer[key] = value
		}
	}
	for key, value := range row {
		answer[key] = value
	}
	return answer
}

func (a *stepValuesAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if r.Header.Get("APIKey") != stepValuesAPIKey {
		a.reply(w, http.StatusUnauthorized, map[string]interface{}{"message": "Invalid API Key"})
		return
	}

	var body map[string]interface{}
	raw, _ := io.ReadAll(r.Body)
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			a.t.Errorf("%s %s sent a body that is not JSON: %s", r.Method, r.URL.Path, err)
		}
	}
	data, _ := body["data"].(map[string]interface{})

	path := strings.TrimPrefix(r.URL.Path, "/api")
	for _, resource := range stepValuesResources {
		rows := a.rows[resource.table]
		switch {
		case path == resource.table && r.Method == http.MethodPost:
			a.created++
			id := fmt.Sprintf("a1000000-0000-4000-8000-%012d", 300+a.created)
			rows[id] = map[string]interface{}{}
			a.keep(rows[id], data)
			a.writes[resource.table]++
			a.reply(w, http.StatusOK, a.answer(id, rows[id]))
			return
		case strings.HasPrefix(path, resource.table+"/"):
			rest := strings.TrimPrefix(path, resource.table+"/")
			id := strings.TrimSuffix(rest, "/get-item")
			row, ok := rows[id]
			if !ok {
				a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
				return
			}
			switch {
			case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
				a.reply(w, http.StatusOK, map[string]interface{}{"data": a.answer(id, row)})
			case r.Method == http.MethodPut && id == rest:
				a.keep(row, data)
				a.writes[resource.table]++
				a.reply(w, http.StatusOK, map[string]interface{}{})
			case r.Method == http.MethodDelete && id == rest:
				delete(rows, id)
				a.reply(w, http.StatusOK, map[string]interface{}{})
			default:
				a.t.Errorf("unexpected request: %s %s", r.Method, path)
				a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
			}
			return
		}
	}

	a.t.Errorf("unexpected request: %s %s", r.Method, path)
	a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
}

func (a *stepValuesAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

// storedSteps is the step and the filter OneUptime keeps of a row's steps.
func (a *stepValuesAPI) storedSteps(t *testing.T, table, id string) (map[string]interface{}, map[string]interface{}) {
	t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	row, ok := a.rows[table][id]
	if !ok {
		t.Fatalf("the API keeps no %s %s", table, id)
	}
	return monitorStepsValuesWireParts(t, row["monitorSteps"])
}

func (a *stepValuesAPI) writesTo(table string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.writes[table]
}

// A row made in the dashboard, its steps as OneUptime keeps them.
func (a *stepValuesAPI) add(t *testing.T, table string, row map[string]interface{}) string {
	t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.created++
	id := fmt.Sprintf("a1000000-0000-4000-8000-%012d", 300+a.created)
	a.rows[table][id] = map[string]interface{}{}
	a.keep(a.rows[table][id], row)
	return id
}

// stepValuesTerraform drives the provider as Terraform does, carrying each
// resource's private state from one call to the next.
type stepValuesTerraform struct {
	t       *testing.T
	ctx     context.Context
	server  tfprotov6.ProviderServer
	schemas map[string]*tfprotov6.Schema
}

func newStepValuesTerraform(t *testing.T, api *stepValuesAPI) *stepValuesTerraform {
	t.Helper()
	tf := &stepValuesTerraform{t: t, ctx: context.Background()}
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(tf.ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, stepValuesAPIKey),
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

func (tf *stepValuesTerraform) objectType(typeName string) tftypes.Object {
	tf.t.Helper()
	schema := tf.schemas[typeName]
	if schema == nil {
		tf.t.Fatalf("the provider has no resource %s", typeName)
	}
	return schema.ValueType().(tftypes.Object)
}

func (tf *stepValuesTerraform) encode(typeName string, value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(tf.objectType(typeName), value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *stepValuesTerraform) decode(typeName string, value *tfprotov6.DynamicValue) tftypes.Value {
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

// steps is a monitor_steps value: one step with these settings, whose one
// criteria, named criteriaName, has one filter with these metric options.
func (tf *stepValuesTerraform) steps(settings map[string]interface{}, options map[string]interface{}, criteriaName string) tftypes.Value {
	tf.t.Helper()
	wire := monitorStepsValuesWire(settings, options)
	step, _ := monitorStepsValuesWireParts(tf.t, wire)
	criteria := monitorStepsWireValue(step["monitorCriteria"])["monitorCriteriaInstanceArray"].([]interface{})
	monitorStepsWireValue(criteria[0])["name"] = criteriaName

	list, diags := MonitorStepsFromAPI(tf.ctx, wire)
	if diags.HasError() {
		tf.t.Fatalf("reading the steps: %v", diags)
	}
	value, err := list.ToTerraformValue(tf.ctx)
	if err != nil {
		tf.t.Fatalf("encoding the steps: %s", err)
	}
	return value
}

// metricSettings is a step's metric_monitor: the customer's query, read
// over this rolling time.
func stepValuesMetricSettings(rollingTime string) map[string]interface{} {
	return map[string]interface{}{
		"metricMonitor": map[string]interface{}{"metricViewConfig": stepValuesMetricView, "rollingTime": rollingTime},
	}
}

func stepValuesOptions(aggregation string, noData string) map[string]interface{} {
	return map[string]interface{}{"metricAlias": "a", "metricAggregationType": aggregation, "onNoDataPolicy": noData}
}

// config is a resource block of this type with these steps.
func (tf *stepValuesTerraform) config(typeName, nameAttribute, monitorType string, steps tftypes.Value) tftypes.Value {
	return objectWith(tf.objectType(typeName), map[string]tftypes.Value{
		nameAttribute:   tftypes.NewValue(tftypes.String, "HTTP 5xx"),
		"monitor_type":  tftypes.NewValue(tftypes.String, monitorType),
		"monitor_steps": steps,
	})
}

// validate is terraform validate: the errors it shows.
func (tf *stepValuesTerraform) validate(typeName string, config tftypes.Value) []*tfprotov6.Diagnostic {
	tf.t.Helper()
	response, err := tf.server.ValidateResourceConfig(tf.ctx, &tfprotov6.ValidateResourceConfigRequest{
		TypeName: typeName,
		Config:   tf.encode(typeName, config),
	})
	if err != nil {
		tf.t.Fatalf("ValidateResourceConfig: %s", err)
	}
	errors := []*tfprotov6.Diagnostic{}
	for _, diagnostic := range response.Diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			errors = append(errors, diagnostic)
		}
	}
	return errors
}

func (tf *stepValuesTerraform) isComputed(typeName string, name string) bool {
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
func (tf *stepValuesTerraform) proposedNew(typeName string, prior, config tftypes.Value) tftypes.Value {
	if prior.IsNull() {
		return config
	}
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

func (tf *stepValuesTerraform) plan(typeName string, prior settled, config tftypes.Value) *tfprotov6.PlanResourceChangeResponse {
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
func (tf *stepValuesTerraform) changes(typeName string, prior settled, config tftypes.Value) []string {
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

// apply plans and applies, and checks the result as Terraform does: every
// attribute the plan knew is what it said, or the apply fails with
// "Provider produced inconsistent result after apply".
func (tf *stepValuesTerraform) apply(typeName string, prior settled, config tftypes.Value) settled {
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

func (tf *stepValuesTerraform) refresh(typeName string, prior settled) settled {
	tf.t.Helper()
	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     typeName,
		CurrentState: tf.encode(typeName, prior.state),
		Private:      prior.private,
	})
	if err != nil {
		tf.t.Fatalf("ReadResource: %s", err)
	}
	failOnErrors(tf.t, "refreshing "+typeName, read.Diagnostics)
	return settled{state: tf.decode(typeName, read.NewState), private: read.Private}
}

// importResource is terraform import: the import, then the read after it.
func (tf *stepValuesTerraform) importResource(typeName, id string) settled {
	tf.t.Helper()
	imported, err := tf.server.ImportResourceState(tf.ctx, &tfprotov6.ImportResourceStateRequest{TypeName: typeName, ID: id})
	if err != nil {
		tf.t.Fatalf("ImportResourceState: %s", err)
	}
	failOnErrors(tf.t, "importing "+typeName, imported.Diagnostics)
	if len(imported.ImportedResources) != 1 {
		tf.t.Fatalf("importing %s gave %d resources", id, len(imported.ImportedResources))
	}
	return tf.refresh(typeName, settled{state: tf.decode(typeName, imported.ImportedResources[0].State), private: imported.ImportedResources[0].Private})
}

// requireStepsAsConfigured fails unless the state keeps the configuration's
// steps as they are written.
func requireStepsAsConfigured(t *testing.T, doing string, state settled, config tftypes.Value) {
	t.Helper()
	got := attributesOf(t, state.state)["monitor_steps"]
	want := attributesOf(t, config)["monitor_steps"]
	if !got.Equal(want) {
		t.Fatalf("%s, the state's steps are\n%s\nnot the configuration's\n%s", doing, got, want)
	}
}

func TestMonitorStepsValues_WrittenAnotherWayAppliesAndPlansNoChange(t *testing.T) {
	for _, resource := range stepValuesResources {
		t.Run(resource.typeName, func(t *testing.T) {
			api := newStepValuesAPI(t)
			tf := newStepValuesTerraform(t, api)

			// The customer's monitor, its rolling time and its aggregation
			// written as an AI agent wrote them.
			config := tf.config(resource.typeName, resource.nameAttribute, "Metrics",
				tf.steps(stepValuesMetricSettings("15 minutes"), stepValuesOptions("avg", "trigger"), "HTTP 5xx"))
			if errors := tf.validate(resource.typeName, config); len(errors) > 0 {
				t.Fatalf("terraform validate: %s - %s", errors[0].Summary, errors[0].Detail)
			}

			// Fails here when the provider takes what OneUptime stores for a
			// change of the plan.
			created := tf.apply(resource.typeName, settled{state: tftypes.NewValue(tf.objectType(resource.typeName), nil)}, config)
			id := stringAttribute(t, created.state, "id")

			step, filter := api.storedSteps(t, resource.table, id)
			if got := step["metricMonitor"].(map[string]interface{})["rollingTime"]; got != "Past 15 Minutes" {
				t.Fatalf("the fake API stores the rolling time as %v, not as OneUptime does", got)
			}
			options := filter["metricMonitorOptions"].(map[string]interface{})
			if options["metricAggregationType"] != "Average" || options["onNoDataPolicy"] != "Trigger" {
				t.Fatalf("the fake API stores the metric options as %v, not as OneUptime does", options)
			}
			requireStepsAsConfigured(t, "after the apply", created, config)

			refreshed := tf.refresh(resource.typeName, created)
			requireStepsAsConfigured(t, "after a refresh", refreshed, config)
			if changed := tf.changes(resource.typeName, refreshed, config); len(changed) > 0 {
				t.Fatalf("the plan after a refresh changes %v", changed)
			}

			// Another rolling time is a change, and is applied as one: the
			// update's result is checked as the create's was.
			if writes := api.writesTo(resource.table); writes != 1 {
				t.Fatalf("the API was written %d times before the update, not once", writes)
			}
			longer := tf.config(resource.typeName, resource.nameAttribute, "Metrics",
				tf.steps(stepValuesMetricSettings("30m"), stepValuesOptions("maximum", "trigger"), "HTTP 5xx"))
			changed := tf.changes(resource.typeName, refreshed, longer)
			if !containsString(changed, "monitor_steps") {
				t.Fatalf("another rolling time and aggregation plan %v, not a change of monitor_steps", changed)
			}
			updated := tf.apply(resource.typeName, refreshed, longer)
			step, filter = api.storedSteps(t, resource.table, id)
			if got := step["metricMonitor"].(map[string]interface{})["rollingTime"]; got != "Past 30 Minutes" {
				t.Fatalf("the update stored the rolling time %v", got)
			}
			if got := filter["metricMonitorOptions"].(map[string]interface{})["metricAggregationType"]; got != "Maximum Value" {
				t.Fatalf("the update stored the aggregation %v", got)
			}
			requireStepsAsConfigured(t, "after the update", updated, longer)
			if changed := tf.changes(resource.typeName, tf.refresh(resource.typeName, updated), longer); len(changed) > 0 {
				t.Fatalf("the plan after the update changes %v", changed)
			}
		})
	}
}

func TestMonitorStepsValues_ImportedAndWrittenAnotherWayPlansNoChange(t *testing.T) {
	for _, resource := range stepValuesResources {
		t.Run(resource.typeName, func(t *testing.T) {
			api := newStepValuesAPI(t)
			tf := newStepValuesTerraform(t, api)

			// A monitor made in the dashboard, as OneUptime keeps it.
			id := api.add(t, resource.table, map[string]interface{}{
				resource.apiName: "HTTP 5xx",
				"monitorType":    "Metrics",
				"monitorSteps":   monitorStepsValuesWire(stepValuesMetricSettings("Past 1 Hour"), stepValuesOptions("Average", "Trigger")),
			})

			imported := tf.importResource(resource.typeName, id)

			// Imported into a configuration that writes them another way.
			config := tf.config(resource.typeName, resource.nameAttribute, "Metrics",
				tf.steps(stepValuesMetricSettings("PT1H"), stepValuesOptions("avg", "trigger"), "HTTP 5xx"))
			// Only the steps are checked: what else an import settles is
			// import_plan_test.go's.
			if changed := tf.changes(resource.typeName, imported, config); containsString(changed, "monitor_steps") {
				t.Fatalf("the plan after the import changes the steps: %v", changed)
			}

			// Another rolling time is still a change.
			other := tf.config(resource.typeName, resource.nameAttribute, "Metrics",
				tf.steps(stepValuesMetricSettings("15 minutes"), stepValuesOptions("avg", "trigger"), "HTTP 5xx"))
			if changed := tf.changes(resource.typeName, imported, other); !containsString(changed, "monitor_steps") {
				t.Fatalf("another rolling time after the import plans %v, not a change of monitor_steps", changed)
			}
		})
	}
}

func TestMonitorStepsValues_ValidateRefusesWhatOneUptimeRefuses(t *testing.T) {
	cases := loadMonitorStepsValuesCases(t)
	refusals := map[string]string{}
	for _, c := range cases.RollingTimeErrorsBySettings {
		if c.Written == "20 minutes" && c.Error != nil {
			refusals[c.APIKey] = *c.Error
		}
	}
	optionRefusal := ""
	for _, c := range cases.CriteriaValueCases {
		if c.Key == "metricAggregationType" && c.Written == "x" && c.Error != nil {
			optionRefusal = *c.Error
		}
	}
	if refusals["metricMonitor"] == "" || refusals["kubernetesMonitor"] == "" || optionRefusal == "" {
		t.Fatal("the cases hold no refusal of \"20 minutes\" in metric and Kubernetes settings, or of the aggregation \"x\"")
	}

	settingsAt := func(attribute string) *tftypes.AttributePath {
		return tftypes.NewAttributePath().WithAttributeName("monitor_steps").WithElementKeyInt(0).WithAttributeName(attribute)
	}
	optionsAt := settingsAt("criteria").WithElementKeyInt(0).WithAttributeName("filters").WithElementKeyInt(0).WithAttributeName("metric_monitor_options")

	for _, resource := range stepValuesResources {
		t.Run(resource.typeName, func(t *testing.T) {
			tf := newStepValuesTerraform(t, newStepValuesAPI(t))
			config := func(monitorType tftypes.Value, settings map[string]interface{}, options map[string]interface{}) tftypes.Value {
				return objectWith(tf.objectType(resource.typeName), map[string]tftypes.Value{
					resource.nameAttribute: tftypes.NewValue(tftypes.String, "HTTP 5xx"),
					"monitor_type":         monitorType,
					"monitor_steps":        tf.steps(settings, options, cases.CriteriaName),
				})
			}
			metrics := tftypes.NewValue(tftypes.String, "Metrics")
			kubernetes := tftypes.NewValue(tftypes.String, "Kubernetes")
			fineOptions := stepValuesOptions("avg", "trigger")
			kubernetesSettings := map[string]interface{}{"kubernetesMonitor": map[string]interface{}{"rollingTime": "20 minutes"}}

			refused := []struct {
				name   string
				config tftypes.Value
				at     *tftypes.AttributePath
				detail string
			}{
				{"a Metrics monitor's rolling time", config(metrics, stepValuesMetricSettings("20 minutes"), fineOptions), settingsAt("metric_monitor"), refusals["metricMonitor"]},
				{"a Kubernetes monitor's rolling time", config(kubernetes, kubernetesSettings, fineOptions), settingsAt("kubernetes_monitor"), refusals["kubernetesMonitor"]},
				{"an aggregation", config(metrics, stepValuesMetricSettings("15 minutes"), stepValuesOptions("x", "trigger")), optionsAt, optionRefusal},
			}
			for _, c := range refused {
				errors := tf.validate(resource.typeName, c.config)
				if len(errors) != 1 {
					t.Fatalf("%s: terraform validate shows %d errors, not one", c.name, len(errors))
				}
				if errors[0].Detail != c.detail {
					t.Fatalf("%s is refused with\n%s\nOneUptime refuses it with\n%s", c.name, errors[0].Detail, c.detail)
				}
				if errors[0].Attribute == nil || !errors[0].Attribute.Equal(c.at) {
					t.Fatalf("%s is refused at %v, not at %v", c.name, errors[0].Attribute, c.at)
				}
			}

			allowed := []struct {
				name   string
				config tftypes.Value
			}{
				// A Kubernetes monitor reads no metric settings, and OneUptime
				// refuses nothing in them.
				{"metric settings on a Kubernetes monitor", config(kubernetes, stepValuesMetricSettings("20 minutes"), fineOptions)},
				{"Kubernetes settings on a Metrics monitor", config(metrics, kubernetesSettings, fineOptions)},
				// A type not known before the plan: the apply refuses it.
				{"a monitor type not known yet", config(tftypes.NewValue(tftypes.String, tftypes.UnknownValue), stepValuesMetricSettings("20 minutes"), fineOptions)},
				{"lengths written another way", config(metrics, stepValuesMetricSettings("PT1H"), stepValuesOptions("maximum", "trigger"))},
			}
			for _, c := range allowed {
				if errors := tf.validate(resource.typeName, c.config); len(errors) > 0 {
					t.Fatalf("%s: terraform validate shows %s - %s", c.name, errors[0].Summary, errors[0].Detail)
				}
			}
		})
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
