package provider

/*
 * A JSON attribute whose value the API answers as an array - a runbook's
 * steps, for one - was read back as null: the read paths took a JSON value
 * only as an object or as a string. Every apply that set one then failed with
 * "Provider produced inconsistent result after apply", and the resource was
 * tainted (OneUptime/terraform-provider-oneuptime#18).
 *
 * These drive a runbook through the real protocol server against a fake API
 * that keeps steps as the array it was sent, as the server does: a create, a
 * refresh, an update and the data source all have to read the steps back.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	runbookType    = "oneuptime_runbook"
	runbookAPIPath = "/api/runbook"
	runbookAPIKey  = "runbook-roundtrip-key"
)

// The steps of issue #18, the way jsonencode() writes them.
const runbookOneStep = `[{"config":{},"description":"Do the first thing","id":"example-01","order":1,"title":"First step","type":"Manual"}]`

const runbookTwoSteps = `[{"config":{},"description":"Do the first thing","id":"example-01","order":1,"title":"First step","type":"Manual"},{"config":{},"description":"Then the second","id":"example-02","order":2,"title":"Second step","type":"Manual"}]`

// runbookAPI is the fake OneUptime API: the runbook endpoints. It keeps what
// a create or an update sent and answers it back, steps as the JSON array.
type runbookAPI struct {
	t        *testing.T
	mu       sync.Mutex
	server   *httptest.Server
	runbooks map[string]map[string]interface{}
	created  int
}

func newRunbookAPI(t *testing.T) *runbookAPI {
	t.Helper()
	api := &runbookAPI{t: t, runbooks: map[string]map[string]interface{}{}}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

func (a *runbookAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if r.Header.Get("APIKey") != runbookAPIKey {
		a.reply(w, http.StatusUnauthorized, map[string]interface{}{"message": "Invalid API Key"})
		return
	}

	var body map[string]interface{}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		a.t.Errorf("reading %s %s: %s", r.Method, r.URL.Path, err)
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			a.t.Errorf("%s %s sent a body that is not JSON: %s", r.Method, r.URL.Path, err)
		}
	}

	rest := strings.TrimPrefix(r.URL.Path, runbookAPIPath)
	switch {
	case r.Method == http.MethodPost && rest == "":
		data, _ := body["data"].(map[string]interface{})
		a.created++
		id := fmt.Sprintf("00000000-0000-4000-8000-%012d", a.created)
		runbook := map[string]interface{}{"_id": id}
		for key, value := range data {
			runbook[key] = value
		}
		a.runbooks[id] = runbook
		a.reply(w, http.StatusOK, runbook)
	case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
		runbook, ok := a.runbooks[strings.TrimSuffix(strings.TrimPrefix(rest, "/"), "/get-item")]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Runbook not found."})
			return
		}
		a.reply(w, http.StatusOK, runbook)
	case r.Method == http.MethodPut && rest != "":
		runbook, ok := a.runbooks[strings.TrimPrefix(rest, "/")]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Runbook not found."})
			return
		}
		data, _ := body["data"].(map[string]interface{})
		for key, value := range data {
			runbook[key] = value
		}
		a.reply(w, http.StatusOK, map[string]interface{}{})
	case r.Method == http.MethodDelete && rest != "":
		delete(a.runbooks, strings.TrimPrefix(rest, "/"))
		a.reply(w, http.StatusOK, map[string]interface{}{})
	default:
		a.t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
	}
}

// stepsOf is what the API keeps as a runbook's steps.
func (a *runbookAPI) stepsOf(id string) interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.runbooks[id]["steps"]
}

func (a *runbookAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

// runbookTerraform drives the provider the way Terraform does.
type runbookTerraform struct {
	t              *testing.T
	ctx            context.Context
	server         tfprotov6.ProviderServer
	resourceSchema *tfprotov6.Schema
	resourceType   tftypes.Object
	dataSourceType tftypes.Object
}

func newRunbookTerraform(t *testing.T, api *runbookAPI) *runbookTerraform {
	t.Helper()
	ctx := context.Background()
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	resourceSchema := schemas.ResourceSchemas[runbookType]
	dataSourceSchema := schemas.DataSourceSchemas[runbookType]
	if resourceSchema == nil || dataSourceSchema == nil {
		t.Fatalf("the provider has no %s resource and data source", runbookType)
	}

	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, runbookAPIKey),
	}))
	if err != nil {
		t.Fatalf("encoding the provider configuration: %s", err)
	}
	configured, err := server.ConfigureProvider(ctx, &tfprotov6.ConfigureProviderRequest{
		TerraformVersion: "1.9.8",
		Config:           &providerConfig,
	})
	if err != nil {
		t.Fatalf("ConfigureProvider: %s", err)
	}
	failOnErrors(t, "configuring the provider", configured.Diagnostics)

	return &runbookTerraform{
		t:              t,
		ctx:            ctx,
		server:         server,
		resourceSchema: resourceSchema,
		resourceType:   resourceSchema.ValueType().(tftypes.Object),
		dataSourceType: dataSourceSchema.ValueType().(tftypes.Object),
	}
}

// runbookConfig is a resource block like the one in issue #18.
func (tf *runbookTerraform) runbookConfig(steps string) tftypes.Value {
	return objectWith(tf.resourceType, map[string]tftypes.Value{
		"name":        tftypes.NewValue(tftypes.String, "Example"),
		"description": tftypes.NewValue(tftypes.String, "Short description"),
		"is_enabled":  tftypes.NewValue(tftypes.Bool, true),
		"steps":       tftypes.NewValue(tftypes.String, steps),
	})
}

func (tf *runbookTerraform) encode(objectType tftypes.Object, value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(objectType, value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *runbookTerraform) decode(objectType tftypes.Object, value *tfprotov6.DynamicValue) tftypes.Value {
	tf.t.Helper()
	if value == nil {
		tf.t.Fatalf("the provider returned no value")
	}
	decoded, err := value.Unmarshal(objectType)
	if err != nil {
		tf.t.Fatalf("decoding: %s", err)
	}
	return decoded
}

// proposedNew is what Terraform proposes for a plan: the configuration, and
// the prior state's value for every computed attribute it leaves out.
func (tf *runbookTerraform) proposedNew(prior, config tftypes.Value) tftypes.Value {
	if prior.IsNull() {
		return config
	}
	priorValues := attributesOf(tf.t, prior)
	proposed := map[string]tftypes.Value{}
	for name, configured := range attributesOf(tf.t, config) {
		proposed[name] = configured
		if configured.IsNull() && tf.isComputed(name) {
			proposed[name] = priorValues[name]
		}
	}
	return tftypes.NewValue(tf.resourceType, proposed)
}

func (tf *runbookTerraform) isComputed(name string) bool {
	for _, attribute := range tf.resourceSchema.Block.Attributes {
		if attribute.Name == name {
			return attribute.Computed
		}
	}
	tf.t.Fatalf("%s has no attribute %s", runbookType, name)
	return false
}

// apply plans the configuration over the prior state, applies the plan and
// fails where Terraform fails an apply with "Provider produced inconsistent
// result after apply": an attribute the plan knew that the result lost.
func (tf *runbookTerraform) apply(prior, config tftypes.Value) tftypes.Value {
	tf.t.Helper()
	planResponse, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         runbookType,
		PriorState:       tf.encode(tf.resourceType, prior),
		ProposedNewState: tf.encode(tf.resourceType, tf.proposedNew(prior, config)),
		Config:           tf.encode(tf.resourceType, config),
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	failOnErrors(tf.t, "planning", planResponse.Diagnostics)
	planned := tf.decode(tf.resourceType, planResponse.PlannedState)

	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       runbookType,
		PriorState:     tf.encode(tf.resourceType, prior),
		PlannedState:   planResponse.PlannedState,
		Config:         tf.encode(tf.resourceType, config),
		PlannedPrivate: planResponse.PlannedPrivate,
	})
	if err != nil {
		tf.t.Fatalf("ApplyResourceChange: %s", err)
	}
	failOnErrors(tf.t, "applying", applied.Diagnostics)

	state := tf.decode(tf.resourceType, applied.NewState)
	got := attributesOf(tf.t, state)
	for name, want := range attributesOf(tf.t, planned) {
		if want.IsKnown() && !sameToTerraform(tf.t, want, got[name]) {
			tf.t.Fatalf("Provider produced inconsistent result after apply: .%s: was %s, but now %s", name, want, got[name])
		}
	}
	return state
}

func (tf *runbookTerraform) refresh(state tftypes.Value) tftypes.Value {
	tf.t.Helper()
	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     runbookType,
		CurrentState: tf.encode(tf.resourceType, state),
	})
	if err != nil {
		tf.t.Fatalf("ReadResource: %s", err)
	}
	failOnErrors(tf.t, "refreshing", read.Diagnostics)
	return tf.decode(tf.resourceType, read.NewState)
}

// lookUp reads the data source by id.
func (tf *runbookTerraform) lookUp(id string) tftypes.Value {
	tf.t.Helper()
	read, err := tf.server.ReadDataSource(tf.ctx, &tfprotov6.ReadDataSourceRequest{
		TypeName: runbookType,
		Config: tf.encode(tf.dataSourceType, objectWith(tf.dataSourceType, map[string]tftypes.Value{
			"id": tftypes.NewValue(tftypes.String, id),
		})),
	})
	if err != nil {
		tf.t.Fatalf("ReadDataSource: %s", err)
	}
	failOnErrors(tf.t, "looking the runbook up", read.Diagnostics)
	return tf.decode(tf.dataSourceType, read.State)
}

// requireSteps fails unless the object's steps are the JSON given, compared
// as JSON: the same values, whatever the spacing or key order.
func requireSteps(t *testing.T, object tftypes.Value, want string) {
	t.Helper()
	steps := attributesOf(t, object)["steps"]
	if steps.IsNull() || !steps.IsKnown() {
		t.Fatalf("steps were read back as %s, not %s", steps, want)
	}
	got := stringAttribute(t, object, "steps")

	var gotJSON, wantJSON interface{}
	if err := json.Unmarshal([]byte(got), &gotJSON); err != nil {
		t.Fatalf("steps are not JSON: %q", got)
	}
	if err := json.Unmarshal([]byte(want), &wantJSON); err != nil {
		t.Fatalf("the expected steps are not JSON: %q", want)
	}
	if !reflect.DeepEqual(gotJSON, wantJSON) {
		t.Fatalf("steps were read back as %s, not %s", got, want)
	}
}

func TestRunbookSteps_CreateRefreshAndUpdateKeepTheArray(t *testing.T) {
	api := newRunbookAPI(t)
	tf := newRunbookTerraform(t, api)

	// Fails here when steps read back as null, as issue #18 reports.
	created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.runbookConfig(runbookOneStep))
	requireSteps(t, created, runbookOneStep)

	// The fake answers what the server keeps: the steps as an array.
	if _, isArray := api.stepsOf(stringAttribute(t, created, "id")).([]interface{}); !isArray {
		t.Fatalf("the create sent steps as %T, not the array the server keeps", api.stepsOf(stringAttribute(t, created, "id")))
	}

	refreshed := tf.refresh(created)
	requireSteps(t, refreshed, runbookOneStep)

	updated := tf.apply(refreshed, tf.runbookConfig(runbookTwoSteps))
	requireSteps(t, updated, runbookTwoSteps)
	requireSteps(t, tf.refresh(updated), runbookTwoSteps)
}

func TestRunbookSteps_DataSourceReadsTheArray(t *testing.T) {
	api := newRunbookAPI(t)
	tf := newRunbookTerraform(t, api)

	created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.runbookConfig(runbookTwoSteps))

	requireSteps(t, tf.lookUp(stringAttribute(t, created, "id")), runbookTwoSteps)
}
