package provider

/*
 * WHAT A DELETE SAYS BESIDES THE RECORD (#9832), through the real protocol
 * server against a stand-in for the custom role API:
 *
 *   - workflows_run_as_on_delete is kept as configured: no create or update
 *     sends it, no read clears it, and setting it alone calls no API;
 *   - the delete sends what state holds, in the DELETE's body, as
 *     miscDataProps - and a role that says nothing is deleted with no body,
 *     as before;
 *   - a delete OneUptime refuses for a choice none was given says, in
 *     Terraform's words, what to set; the role stays in state;
 *   - the plan refuses Project Owner, a role ID that is not an ID, and a
 *     role ID without "CustomRole" (or "CustomRole" without one).
 */

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	customRoleType    = "oneuptime_custom_role"
	customRoleAPIPath = "/api/custom-role"
	customRoleAPIKey  = "delete-choices-key"

	runAsAttribute     = "workflows_run_as_on_delete"
	runAsRoleAttribute = "workflows_run_as_custom_role_id_on_delete"

	otherRoleID = "5a0e0000-0000-4000-8000-0000000000aa"
)

// What OneUptime answers a delete of a role that workflows run as, when the
// delete does not say what they run as instead
// (getCustomRoleDeleteWorkflowsMessage, Common/Types/Workflow/WorkflowRunAs.ts).
const workflowsRunAsRefusal = `The workflow "Close stale incidents" runs as the custom role "Incident Responder". Deleting the role would stop it until someone changes what it runs as, so say what it runs as instead: choose it as you delete the role in the Dashboard, or send miscDataProps.workflowsRunAs as "Default", or as "CustomRole" with miscDataProps.workflowsRunAsCustomRoleId naming another custom role you could give a team.`

// ---------------------------------------------------------------------------
// The body, the hint and the validator on their own.

func TestDeleteChoicesBodyIsWhatStateHolds(t *testing.T) {
	body := deleteChoicesBody([]deleteChoice{
		{key: "workflowsRunAs", attribute: runAsAttribute, value: types.StringValue("CustomRole")},
		{key: "workflowsRunAsCustomRoleId", attribute: runAsRoleAttribute, value: types.StringValue(" " + otherRoleID + " ")},
	})

	want := map[string]interface{}{
		"miscDataProps": map[string]interface{}{
			"workflowsRunAs":             "CustomRole",
			"workflowsRunAsCustomRoleId": otherRoleID,
		},
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("the body is %v, not %v", body, want)
	}

	// Only what is set is sent.
	body = deleteChoicesBody([]deleteChoice{
		{key: "workflowsRunAs", attribute: runAsAttribute, value: types.StringValue("Default")},
		{key: "workflowsRunAsCustomRoleId", attribute: runAsRoleAttribute, value: types.StringNull()},
	})
	want = map[string]interface{}{
		"miscDataProps": map[string]interface{}{"workflowsRunAs": "Default"},
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("the body is %v, not %v", body, want)
	}
}

func TestDeleteChoicesBodyIsNoneWhenNothingIsSet(t *testing.T) {
	for _, value := range []types.String{types.StringNull(), types.StringUnknown(), types.StringValue(""), types.StringValue("  ")} {
		body := deleteChoicesBody([]deleteChoice{
			{key: "workflowsRunAs", attribute: runAsAttribute, value: value},
		})
		if body != nil {
			t.Fatalf("%s sent a body: %v", value, body)
		}
	}
}

func TestDeleteChoicesHintSaysWhatToSetWhenNoneWasGiven(t *testing.T) {
	none := []deleteChoice{
		{key: "workflowsRunAs", attribute: runAsAttribute, value: types.StringNull()},
		{key: "workflowsRunAsCustomRoleId", attribute: runAsRoleAttribute, value: types.StringNull()},
	}
	refused := fmt.Errorf("the OneUptime API returned status 400: %s", workflowsRunAsRefusal)

	if got := deleteChoicesHint(refused, none, "Set it."); got != "\n\nSet it." {
		t.Fatalf("the hint is %q", got)
	}

	// Refused for anything else: the API's words alone.
	if got := deleteChoicesHint(errors.New("the OneUptime API returned status 403: You do not have permission to delete Custom Role."), none, "Set it."); got != "" {
		t.Fatalf("an unrelated refusal got the hint %q", got)
	}

	// A choice was given: what is wrong with it is the API's to say.
	given := []deleteChoice{
		{key: "workflowsRunAs", attribute: runAsAttribute, value: types.StringValue("CustomRole")},
		{key: "workflowsRunAsCustomRoleId", attribute: runAsRoleAttribute, value: types.StringValue(otherRoleID)},
	}
	if got := deleteChoicesHint(refused, given, "Set it."); got != "" {
		t.Fatalf("a delete that gave a choice got the hint %q", got)
	}

	if got := deleteChoicesHint(nil, none, "Set it."); got != "" {
		t.Fatalf("no error got the hint %q", got)
	}
}

// ---------------------------------------------------------------------------
// A stand-in for the custom role API.

type customRoleAPI struct {
	t      *testing.T
	mu     sync.Mutex
	server *httptest.Server
	roles  map[string]map[string]interface{}
	// How many of each request it was sent: "POST", "PUT", "DELETE".
	sent map[string]int
	// The body of each DELETE, as sent: "" for none.
	deleteBodies []string
	// Workflows run as every role: a delete that says nothing is refused.
	workflowsRunAsRoles bool
	created             int
}

func newCustomRoleAPI(t *testing.T) *customRoleAPI {
	t.Helper()
	api := &customRoleAPI{
		t:     t,
		roles: map[string]map[string]interface{}{},
		sent:  map[string]int{},
	}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

func (a *customRoleAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if r.Header.Get("APIKey") != customRoleAPIKey {
		a.reply(w, http.StatusUnauthorized, map[string]interface{}{"message": "Invalid API Key"})
		return
	}

	raw, err := io.ReadAll(r.Body)
	if err != nil {
		a.t.Errorf("reading %s %s: %s", r.Method, r.URL.Path, err)
	}
	var body map[string]interface{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			a.t.Errorf("%s %s sent a body that is not a JSON object: %s (%s)", r.Method, r.URL.Path, raw, err)
		}
	}

	rest := strings.TrimPrefix(r.URL.Path, customRoleAPIPath)
	id := strings.TrimSuffix(strings.TrimPrefix(rest, "/"), "/get-item")

	switch {
	case r.Method == http.MethodPost && rest == "":
		a.sent["POST"]++
		data, _ := body["data"].(map[string]interface{})
		for key := range data {
			if strings.HasPrefix(key, "workflowsRunAs") {
				a.t.Errorf("the create sent %s, which only a delete takes", key)
			}
		}
		a.created++
		roleID := fmt.Sprintf("5a0e0000-0000-4000-8000-%012d", a.created)
		role := map[string]interface{}{"_id": roleID, "permissionCount": 0}
		for key, value := range data {
			role[key] = value
		}
		a.roles[roleID] = role
		a.reply(w, http.StatusOK, map[string]interface{}{"data": role})
	case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
		role, ok := a.roles[id]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Custom Role not found."})
			return
		}
		a.reply(w, http.StatusOK, map[string]interface{}{"data": role})
	case r.Method == http.MethodPut && rest != "":
		a.sent["PUT"]++
		role, ok := a.roles[id]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Custom Role not found."})
			return
		}
		data, _ := body["data"].(map[string]interface{})
		for key, value := range data {
			if strings.HasPrefix(key, "workflowsRunAs") {
				a.t.Errorf("the update sent %s, which only a delete takes", key)
			}
			role[key] = value
		}
		a.reply(w, http.StatusOK, map[string]interface{}{})
	case r.Method == http.MethodDelete && rest != "":
		a.sent["DELETE"]++
		a.deleteBodies = append(a.deleteBodies, string(raw))
		misc, _ := body["miscDataProps"].(map[string]interface{})
		if a.workflowsRunAsRoles && misc["workflowsRunAs"] == nil {
			a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": workflowsRunAsRefusal})
			return
		}
		delete(a.roles, id)
		a.reply(w, http.StatusOK, map[string]interface{}{})
	default:
		a.t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
	}
}

func (a *customRoleAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

func (a *customRoleAPI) count(method string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sent[method]
}

func (a *customRoleAPI) lastDeleteBody() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.deleteBodies) == 0 {
		a.t.Fatalf("no DELETE was sent")
	}
	return a.deleteBodies[len(a.deleteBodies)-1]
}

func (a *customRoleAPI) has(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, ok := a.roles[id]
	return ok
}

// ---------------------------------------------------------------------------
// The provider, driven the way Terraform drives it.

type customRoleTerraform struct {
	t            *testing.T
	ctx          context.Context
	server       tfprotov6.ProviderServer
	schema       *tfprotov6.Schema
	resourceType tftypes.Object
}

func newCustomRoleTerraform(t *testing.T, api *customRoleAPI) *customRoleTerraform {
	t.Helper()
	ctx := context.Background()
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	schema := schemas.ResourceSchemas[customRoleType]
	if schema == nil {
		t.Fatalf("the provider has no %s resource", customRoleType)
	}

	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, customRoleAPIKey),
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

	return &customRoleTerraform{
		t:            t,
		ctx:          ctx,
		server:       server,
		schema:       schema,
		resourceType: schema.ValueType().(tftypes.Object),
	}
}

// config is a role's resource block, with what its delete says.
func (tf *customRoleTerraform) config(runAs string, runAsRole string) tftypes.Value {
	values := map[string]tftypes.Value{
		"name": tftypes.NewValue(tftypes.String, "Incident Responder"),
	}
	if runAs != "" {
		values[runAsAttribute] = tftypes.NewValue(tftypes.String, runAs)
	}
	if runAsRole != "" {
		values[runAsRoleAttribute] = tftypes.NewValue(tftypes.String, runAsRole)
	}
	return objectWith(tf.resourceType, values)
}

func (tf *customRoleTerraform) encode(value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(tf.resourceType, value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *customRoleTerraform) decode(value *tfprotov6.DynamicValue) tftypes.Value {
	tf.t.Helper()
	if value == nil {
		tf.t.Fatalf("the provider returned no value")
	}
	decoded, err := value.Unmarshal(tf.resourceType)
	if err != nil {
		tf.t.Fatalf("decoding: %s", err)
	}
	return decoded
}

func (tf *customRoleTerraform) isComputed(name string) bool {
	for _, attribute := range tf.schema.Block.Attributes {
		if attribute.Name == name {
			return attribute.Computed
		}
	}
	tf.t.Fatalf("%s has no attribute %s", customRoleType, name)
	return false
}

// proposedNew is the configuration, and the prior state for every computed
// attribute it leaves out.
func (tf *customRoleTerraform) proposedNew(prior, config tftypes.Value) tftypes.Value {
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

// validate is terraform validate's check of a configuration.
func (tf *customRoleTerraform) validate(config tftypes.Value) []*tfprotov6.Diagnostic {
	tf.t.Helper()
	validated, err := tf.server.ValidateResourceConfig(tf.ctx, &tfprotov6.ValidateResourceConfigRequest{
		TypeName: customRoleType,
		Config:   tf.encode(config),
	})
	if err != nil {
		tf.t.Fatalf("ValidateResourceConfig: %s", err)
	}
	return validated.Diagnostics
}

// plan plans the configuration over the prior state.
func (tf *customRoleTerraform) plan(prior, config tftypes.Value) *tfprotov6.PlanResourceChangeResponse {
	tf.t.Helper()
	planned, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         customRoleType,
		PriorState:       tf.encode(prior),
		ProposedNewState: tf.encode(tf.proposedNew(prior, config)),
		Config:           tf.encode(config),
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	failOnErrors(tf.t, "planning", planned.Diagnostics)
	return planned
}

// apply plans and applies the configuration, failing where Terraform fails
// an apply whose result lost something the plan knew.
func (tf *customRoleTerraform) apply(prior, config tftypes.Value) tftypes.Value {
	tf.t.Helper()
	planned := tf.plan(prior, config)

	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       customRoleType,
		PriorState:     tf.encode(prior),
		PlannedState:   planned.PlannedState,
		Config:         tf.encode(config),
		PlannedPrivate: planned.PlannedPrivate,
	})
	if err != nil {
		tf.t.Fatalf("ApplyResourceChange: %s", err)
	}
	failOnErrors(tf.t, "applying", applied.Diagnostics)

	state := tf.decode(applied.NewState)
	got := attributesOf(tf.t, state)
	for name, want := range attributesOf(tf.t, tf.decode(planned.PlannedState)) {
		if want.IsKnown() && !sameToTerraform(tf.t, want, got[name]) {
			tf.t.Fatalf("Provider produced inconsistent result after apply: .%s: was %s, but now %s", name, want, got[name])
		}
	}
	return state
}

// destroy is terraform destroy of the role: what it says, and the state left.
func (tf *customRoleTerraform) destroy(prior tftypes.Value) ([]*tfprotov6.Diagnostic, tftypes.Value) {
	tf.t.Helper()
	gone := tftypes.NewValue(tf.resourceType, nil)

	planned, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         customRoleType,
		PriorState:       tf.encode(prior),
		ProposedNewState: tf.encode(gone),
		Config:           tf.encode(gone),
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	failOnErrors(tf.t, "planning the destroy", planned.Diagnostics)

	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:     customRoleType,
		PriorState:   tf.encode(prior),
		PlannedState: planned.PlannedState,
		Config:       tf.encode(gone),
	})
	if err != nil {
		tf.t.Fatalf("ApplyResourceChange: %s", err)
	}

	left := gone
	if applied.NewState != nil {
		left = tf.decode(applied.NewState)
	}
	return applied.Diagnostics, left
}

func (tf *customRoleTerraform) refresh(state tftypes.Value) tftypes.Value {
	tf.t.Helper()
	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     customRoleType,
		CurrentState: tf.encode(state),
	})
	if err != nil {
		tf.t.Fatalf("ReadResource: %s", err)
	}
	failOnErrors(tf.t, "refreshing", read.Diagnostics)
	return tf.decode(read.NewState)
}

// importRole is terraform import of the role by its id, and the refresh after.
func (tf *customRoleTerraform) importRole(id string) tftypes.Value {
	tf.t.Helper()
	imported, err := tf.server.ImportResourceState(tf.ctx, &tfprotov6.ImportResourceStateRequest{
		TypeName: customRoleType,
		ID:       id,
	})
	if err != nil {
		tf.t.Fatalf("ImportResourceState: %s", err)
	}
	failOnErrors(tf.t, "importing", imported.Diagnostics)
	if len(imported.ImportedResources) != 1 {
		tf.t.Fatalf("the import gave %d resources", len(imported.ImportedResources))
	}
	return tf.refresh(tf.decode(imported.ImportedResources[0].State))
}

// stateOf is what the state holds of an attribute: "" for null.
func stateOf(t *testing.T, object tftypes.Value, name string) string {
	t.Helper()
	value := attributesOf(t, object)[name]
	if value.IsNull() {
		return ""
	}
	return stringAttribute(t, object, name)
}

// errorTextOf is the text of every error a response holds.
func errorTextOf(diagnostics []*tfprotov6.Diagnostic) string {
	var text []string
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			text = append(text, diagnostic.Summary+": "+diagnostic.Detail)
		}
	}
	return strings.Join(text, "\n")
}

// ---------------------------------------------------------------------------
// Through the provider.

func TestDeleteChoiceIsKeptAsConfiguredAndSentWithTheDelete(t *testing.T) {
	api := newCustomRoleAPI(t)
	tf := newCustomRoleTerraform(t, api)
	gone := tftypes.NewValue(tf.resourceType, nil)

	state := tf.apply(gone, tf.config("", ""))
	id := stateOf(t, state, "id")
	if stateOf(t, state, runAsAttribute) != "" {
		t.Fatalf("a role created without %s holds %q", runAsAttribute, stateOf(t, state, runAsAttribute))
	}

	// Set alone, it changes nothing on the server: no update is sent.
	state = tf.apply(state, tf.config("Default", ""))
	if got := stateOf(t, state, runAsAttribute); got != "Default" {
		t.Fatalf("state holds %s = %q, not \"Default\"", runAsAttribute, got)
	}
	if puts := api.count("PUT"); puts != 0 {
		t.Fatalf("setting %s sent %d updates; it is only sent with the delete", runAsAttribute, puts)
	}

	// No read clears it: it is nothing the API holds.
	state = tf.refresh(state)
	if got := stateOf(t, state, runAsAttribute); got != "Default" {
		t.Fatalf("a refresh left %s = %q", runAsAttribute, got)
	}

	// The next plan is empty.
	planned := tf.decode(tf.plan(state, tf.config("Default", "")).PlannedState)
	if !planned.Equal(state) {
		t.Fatalf("a plan of the same configuration is not empty:\n  state:   %s\n  planned: %s", state, planned)
	}

	// Workflows run as the role: the delete must say what they run as.
	api.workflowsRunAsRoles = true
	diagnostics, left := tf.destroy(state)
	if text := errorTextOf(diagnostics); text != "" {
		t.Fatalf("the destroy failed: %s", text)
	}
	if !left.IsNull() {
		t.Fatalf("the destroyed role is still in state: %s", left)
	}
	if api.has(id) {
		t.Fatalf("the role is still there")
	}
	assertJSON(t, api.lastDeleteBody(), `{"miscDataProps":{"workflowsRunAs":"Default"}}`)
}

func TestDeleteChoiceNamesAnotherRole(t *testing.T) {
	api := newCustomRoleAPI(t)
	tf := newCustomRoleTerraform(t, api)
	gone := tftypes.NewValue(tf.resourceType, nil)

	state := tf.apply(gone, tf.config("CustomRole", otherRoleID))
	if got := stateOf(t, state, runAsRoleAttribute); got != otherRoleID {
		t.Fatalf("state holds %s = %q", runAsRoleAttribute, got)
	}

	api.workflowsRunAsRoles = true
	diagnostics, _ := tf.destroy(state)
	if text := errorTextOf(diagnostics); text != "" {
		t.Fatalf("the destroy failed: %s", text)
	}
	assertJSON(t, api.lastDeleteBody(), `{"miscDataProps":{"workflowsRunAs":"CustomRole","workflowsRunAsCustomRoleId":"`+otherRoleID+`"}}`)
}

func TestDeleteThatSaysNothingSendsNoBody(t *testing.T) {
	api := newCustomRoleAPI(t)
	tf := newCustomRoleTerraform(t, api)

	state := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config("", ""))

	diagnostics, left := tf.destroy(state)
	if text := errorTextOf(diagnostics); text != "" {
		t.Fatalf("the destroy failed: %s", text)
	}
	if !left.IsNull() {
		t.Fatalf("the destroyed role is still in state: %s", left)
	}
	// Not even "null": the delete it always was.
	if body := api.lastDeleteBody(); body != "" {
		t.Fatalf("a delete that says nothing sent the body %q", body)
	}
}

func TestRefusedDeleteSaysWhatToSetInTerraform(t *testing.T) {
	api := newCustomRoleAPI(t)
	tf := newCustomRoleTerraform(t, api)

	state := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config("", ""))
	id := stateOf(t, state, "id")

	api.workflowsRunAsRoles = true
	diagnostics, left := tf.destroy(state)

	text := errorTextOf(diagnostics)
	for _, want := range []string{
		// The API's own words, naming the workflows.
		`The workflow "Close stale incidents" runs as the custom role "Incident Responder".`,
		// And how to say it in Terraform.
		"set " + runAsAttribute + " on this " + customRoleType,
		runAsRoleAttribute + ` when ` + runAsAttribute + ` is "CustomRole"`,
		"run terraform apply, then destroy it again",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("the refusal does not say %q:\n%s", want, text)
		}
	}

	// The role is still there, and still in state.
	if !api.has(id) {
		t.Fatalf("the refused delete deleted the role")
	}
	if left.IsNull() || stateOf(t, left, "id") != id {
		t.Fatalf("a refused delete dropped the role from state: %s", left)
	}

	// Said, and applied: the next destroy goes through.
	state = tf.apply(left, tf.config("Default", ""))
	diagnostics, left = tf.destroy(state)
	if text := errorTextOf(diagnostics); text != "" {
		t.Fatalf("the destroy failed: %s", text)
	}
	if !left.IsNull() || api.has(id) {
		t.Fatalf("the role was not deleted")
	}
}

func TestImportedRoleSaysNothingForItsDelete(t *testing.T) {
	api := newCustomRoleAPI(t)
	tf := newCustomRoleTerraform(t, api)

	created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config("Default", ""))
	id := stateOf(t, created, "id")

	imported := tf.importRole(id)
	if got := stateOf(t, imported, "name"); got != "Incident Responder" {
		t.Fatalf("the import read the name %q", got)
	}
	// Nothing on the server says it: an import leaves it unset.
	if got := stateOf(t, imported, runAsAttribute); got != "" {
		t.Fatalf("an import read %s = %q", runAsAttribute, got)
	}

	// Set again, it is applied without a write.
	puts := api.count("PUT")
	state := tf.apply(imported, tf.config("Default", ""))
	if got := stateOf(t, state, runAsAttribute); got != "Default" {
		t.Fatalf("state holds %s = %q", runAsAttribute, got)
	}
	if api.count("PUT") != puts {
		t.Fatalf("applying %s after an import sent an update", runAsAttribute)
	}
}

func TestPlanRefusesWhatOneUptimeWouldRefuse(t *testing.T) {
	api := newCustomRoleAPI(t)
	tf := newCustomRoleTerraform(t, api)

	for _, valid := range []struct{ runAs, role string }{
		{"", ""},
		{"Default", ""},
		{"CustomRole", otherRoleID},
	} {
		if text := errorTextOf(tf.validate(tf.config(valid.runAs, valid.role))); text != "" {
			t.Fatalf("%q with %q was refused: %s", valid.runAs, valid.role, text)
		}
	}

	for _, refused := range []struct {
		runAs, role string
		says        string
	}{
		// Deleting a role never raises what a workflow can do.
		{"ProjectOwner", "", "Default"},
		{"Admin", "", "CustomRole"},
		{"CustomRole", "", "needs " + runAsRoleAttribute},
		{"Default", otherRoleID, "goes with " + runAsAttribute + ` = "CustomRole"`},
		{"", otherRoleID, "goes with " + runAsAttribute + ` = "CustomRole"`},
		{"CustomRole", "incident-responder", "is not the ID of a oneuptime_custom_role"},
	} {
		text := errorTextOf(tf.validate(tf.config(refused.runAs, refused.role)))
		if !strings.Contains(text, refused.says) {
			t.Fatalf("%q with %q: the plan does not say %q:\n%s", refused.runAs, refused.role, refused.says, text)
		}
	}

	// A role known only at apply is left to the apply.
	unknown := objectWith(tf.resourceType, map[string]tftypes.Value{
		"name":             tftypes.NewValue(tftypes.String, "Incident Responder"),
		runAsAttribute:     tftypes.NewValue(tftypes.String, "CustomRole"),
		runAsRoleAttribute: tftypes.NewValue(tftypes.String, tftypes.UnknownValue),
	})
	if text := errorTextOf(tf.validate(unknown)); text != "" {
		t.Fatalf("a role known only at apply was refused: %s", text)
	}
}

func TestDeleteChoicesAreOptionalAndNeverComputed(t *testing.T) {
	api := newCustomRoleAPI(t)
	tf := newCustomRoleTerraform(t, api)

	for _, name := range []string{runAsAttribute, runAsRoleAttribute} {
		var found *tfprotov6.SchemaAttribute
		for _, attribute := range tf.schema.Block.Attributes {
			if attribute.Name == name {
				found = attribute
			}
		}
		if found == nil {
			t.Fatalf("%s has no attribute %s", customRoleType, name)
		}
		if !found.Optional || found.Computed || found.Required {
			t.Fatalf("%s is not optional alone: optional %v, computed %v, required %v", name, found.Optional, found.Computed, found.Required)
		}
		if !strings.Contains(found.Description, "Sent only when Terraform deletes the custom role") {
			t.Fatalf("%s does not say when it is sent: %s", name, found.Description)
		}
	}
}

// assertJSON fails unless got is the JSON want, whatever its spacing or order.
func assertJSON(t *testing.T, got string, want string) {
	t.Helper()
	var gotValue, wantValue interface{}
	if err := json.Unmarshal([]byte(got), &gotValue); err != nil {
		t.Fatalf("%q is not JSON: %s", got, err)
	}
	if err := json.Unmarshal([]byte(want), &wantValue); err != nil {
		t.Fatalf("the expected %q is not JSON: %s", want, err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("sent %s, not %s", got, want)
	}
}
