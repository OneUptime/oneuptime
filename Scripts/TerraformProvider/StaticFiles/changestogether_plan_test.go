package provider

/*
 * A monitor secret's secret_type, which OneUptime changes only together with
 * a new secret_value (#9760), through the provider's real protocol server -
 * the way terraform plan and terraform apply drive it - against a fake
 * OneUptime API that keeps monitor secrets as OneUptime does: it refuses a
 * type sent without a value, in OneUptime's own words, and refuses a
 * one-time code secret's value that is no setup key.
 *
 * The three changes #9814 names:
 *
 *   - the type alone: the plan fails, on secret_type, and nothing is sent -
 *     where the update used to send the type alone and fail half-way through
 *     the apply;
 *   - the value alone: planned in place, and the update sends the value;
 *   - the type and a new value: planned in place, not as a replacement, and
 *     one update sends both, so the secret keeps its ID.
 *
 * After every apply the tests check what Terraform checks: the result is
 * what the plan said for every attribute the plan knew, and the next plan
 * changes nothing.
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
	monitorSecretType      = "oneuptime_monitor_secret"
	monitorSecretAPIPath   = "/api/monitor-secret"
	monitorSecretAPIKey    = "monitor-secret-test-key"
	monitorSecretProjectID = "5ec7e700-0000-4000-8000-0000000000aa"
	monitorSecretTimestamp = "2026-11-19T08:00:00.000Z"

	// Setup keys an authenticator app shows.
	monitorSecretSetupKey      = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
	monitorSecretOtherSetupKey = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

	// What OneUptime says to a type sent without a value
	// (MonitorSecretService's TYPE_CHANGE_NEEDS_VALUE_MESSAGE).
	monitorSecretTypeNeedsValue = "A secret's type changes only together with a new value, because the value it holds means something else in the other type. Enter the new value along with the type."
)

// monitorSecretAPI is the fake OneUptime API: the monitor secret endpoints.
type monitorSecretAPI struct {
	t      *testing.T
	server *httptest.Server

	mu      sync.Mutex
	secrets map[string]map[string]interface{}
	nextID  int
	// The data of every create and every update the provider sent.
	creates []map[string]interface{}
	updates []map[string]interface{}
	// The updates OneUptime refused, with why.
	refused []string
}

func newMonitorSecretAPI(t *testing.T) *monitorSecretAPI {
	t.Helper()
	api := &monitorSecretAPI{t: t, secrets: map[string]map[string]interface{}{}}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

// isSetupKey: what OneUptime reads as a setup key - base32, at least 16
// characters (Common/Utils/Totp/TotpSecret).
func isSetupKey(value interface{}) bool {
	text, ok := value.(string)
	if !ok || len(text) < 16 {
		return false
	}
	for _, character := range strings.ToUpper(text) {
		if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", character) {
			return false
		}
	}
	return true
}

// readValue checks a value for a type, as OneUptime does, and says why it
// cannot take it.
func readValue(secretType interface{}, value interface{}) string {
	if secretType == "TOTP" && !isSetupKey(value) {
		return "This setup key cannot make one-time codes."
	}
	if text, ok := value.(string); !ok || strings.TrimSpace(text) == "" {
		return monitorSecretTypeNeedsValue
	}
	return ""
}

func (a *monitorSecretAPI) answer(secret map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"_id":             secret["_id"],
		"projectId":       map[string]interface{}{"_type": "ObjectID", "value": monitorSecretProjectID},
		"name":            secret["name"],
		"description":     secret["description"],
		"secretType":      secret["secretType"],
		"monitorAccess":   secret["monitorAccess"],
		"monitors":        []interface{}{},
		"labels":          []interface{}{},
		"createdAt":       map[string]interface{}{"_type": "DateTime", "value": monitorSecretTimestamp},
		"updatedAt":       map[string]interface{}{"_type": "DateTime", "value": monitorSecretTimestamp},
		"createdByUserId": nil,
	}
}

func (a *monitorSecretAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if r.Header.Get("APIKey") != monitorSecretAPIKey {
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
	data, _ := body["data"].(map[string]interface{})

	rest := strings.TrimPrefix(r.URL.Path, monitorSecretAPIPath)
	switch {
	case r.Method == http.MethodPost && rest == "":
		a.creates = append(a.creates, data)
		secretType := data["secretType"]
		if secretType == nil {
			secretType = "Text"
		}
		if why := readValue(secretType, data["secretValue"]); why != "" && secretType == "TOTP" {
			a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": why})
			return
		}
		a.nextID++
		id := fmt.Sprintf("5ec7e700-0000-4000-8000-%012d", a.nextID)
		access := data["monitorAccess"]
		if access == nil {
			access = "Specific Monitors"
		}
		a.secrets[id] = map[string]interface{}{
			"_id":           id,
			"name":          data["name"],
			"description":   data["description"],
			"secretType":    secretType,
			"secretValue":   data["secretValue"],
			"monitorAccess": access,
		}
		a.reply(w, http.StatusOK, a.answer(a.secrets[id]))
	case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
		secret, ok := a.secrets[strings.TrimSuffix(strings.TrimPrefix(rest, "/"), "/get-item")]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
			return
		}
		a.reply(w, http.StatusOK, a.answer(secret))
	case r.Method == http.MethodPut && rest != "":
		secret, ok := a.secrets[strings.TrimPrefix(rest, "/")]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
			return
		}
		a.updates = append(a.updates, data)

		// MonitorSecretService.onBeforeUpdate: a type only with a value read
		// for it; a value alone is read for the type the secret has.
		secretType := secret["secretType"]
		if newType, sent := data["secretType"]; sent {
			value, valueSent := data["secretValue"]
			if !valueSent {
				a.refused = append(a.refused, monitorSecretTypeNeedsValue)
				a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": monitorSecretTypeNeedsValue})
				return
			}
			if why := readValue(newType, value); why != "" {
				a.refused = append(a.refused, why)
				a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": why})
				return
			}
			secretType = newType
		} else if value, sent := data["secretValue"]; sent && secretType == "TOTP" && !isSetupKey(value) {
			a.refused = append(a.refused, "This setup key cannot make one-time codes.")
			a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "This setup key cannot make one-time codes."})
			return
		}

		for key, value := range data {
			switch key {
			case "name", "description", "secretValue", "monitorAccess":
				secret[key] = value
			case "secretType":
				secret[key] = secretType
			default:
				a.t.Errorf("the update sent %s, which this test does not expect", key)
			}
		}
		a.reply(w, http.StatusOK, map[string]interface{}{})
	case r.Method == http.MethodDelete && rest != "":
		delete(a.secrets, strings.TrimPrefix(rest, "/"))
		a.reply(w, http.StatusOK, map[string]interface{}{})
	default:
		a.t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
	}
}

func (a *monitorSecretAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

// sentUpdates is a copy of the updates sent so far.
func (a *monitorSecretAPI) sentUpdates() []map[string]interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]map[string]interface{}{}, a.updates...)
}

// monitorSecretTerraform drives the provider the way Terraform does.
type monitorSecretTerraform struct {
	t          *testing.T
	ctx        context.Context
	api        *monitorSecretAPI
	server     tfprotov6.ProviderServer
	schema     *tfprotov6.Schema
	objectType tftypes.Object
}

func newMonitorSecretTerraform(t *testing.T) *monitorSecretTerraform {
	t.Helper()
	ctx := context.Background()
	api := newMonitorSecretAPI(t)
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	resourceSchema := schemas.ResourceSchemas[monitorSecretType]
	if resourceSchema == nil {
		t.Fatalf("the provider has no %s resource", monitorSecretType)
	}

	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, monitorSecretAPIKey),
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

	return &monitorSecretTerraform{
		t:          t,
		ctx:        ctx,
		api:        api,
		server:     server,
		schema:     resourceSchema,
		objectType: resourceSchema.ValueType().(tftypes.Object),
	}
}

// secret is a configuration: a name, and a type and a value (nil leaves
// either out; tftypes.UnknownValue is one known only at apply).
func (tf *monitorSecretTerraform) secret(secretType interface{}, secretValue interface{}) tftypes.Value {
	return objectWith(tf.objectType, map[string]tftypes.Value{
		"name":         tftypes.NewValue(tftypes.String, "GITHUB_SIGN_IN"),
		"secret_type":  tftypes.NewValue(tftypes.String, secretType),
		"secret_value": tftypes.NewValue(tftypes.String, secretValue),
	})
}

func (tf *monitorSecretTerraform) encode(value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(tf.objectType, value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *monitorSecretTerraform) decode(value *tfprotov6.DynamicValue) tftypes.Value {
	tf.t.Helper()
	if value == nil {
		tf.t.Fatalf("the provider returned no value")
	}
	decoded, err := value.Unmarshal(tf.objectType)
	if err != nil {
		tf.t.Fatalf("decoding: %s", err)
	}
	return decoded
}

func (tf *monitorSecretTerraform) isComputed(name string) bool {
	for _, attribute := range tf.schema.Block.Attributes {
		if attribute.Name == name {
			return attribute.Computed
		}
	}
	tf.t.Fatalf("%s has no attribute %s", monitorSecretType, name)
	return false
}

// proposedNew is what Terraform proposes: the configuration, with the prior
// state's value for every computed attribute the configuration leaves out.
func (tf *monitorSecretTerraform) proposedNew(prior, config tftypes.Value) tftypes.Value {
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
	return tftypes.NewValue(tf.objectType, proposed)
}

func (tf *monitorSecretTerraform) plan(prior, config tftypes.Value) *tfprotov6.PlanResourceChangeResponse {
	tf.t.Helper()
	planned, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         monitorSecretType,
		PriorState:       tf.encode(prior),
		ProposedNewState: tf.encode(tf.proposedNew(prior, config)),
		Config:           tf.encode(config),
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	return planned
}

// apply plans and applies, and checks the result the way Terraform does:
// every attribute the plan knew is what it said.
func (tf *monitorSecretTerraform) apply(prior, config tftypes.Value) tftypes.Value {
	tf.t.Helper()
	planned := tf.plan(prior, config)
	failOnErrors(tf.t, "planning", planned.Diagnostics)
	if len(planned.RequiresReplace) > 0 {
		tf.t.Fatalf("the plan replaces the secret, because of %v", planned.RequiresReplace)
	}

	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       monitorSecretType,
		PriorState:     tf.encode(prior),
		PlannedState:   planned.PlannedState,
		Config:         tf.encode(config),
		PlannedPrivate: planned.PlannedPrivate,
	})
	if err != nil {
		tf.t.Fatalf("ApplyResourceChange: %s", err)
	}
	failOnErrors(tf.t, "applying", applied.Diagnostics)

	plannedValues := attributesOf(tf.t, tf.decode(planned.PlannedState))
	state := tf.decode(applied.NewState)
	for name, value := range attributesOf(tf.t, state) {
		if plannedValues[name].IsFullyKnown() && !plannedValues[name].Equal(value) {
			tf.t.Errorf("Provider produced inconsistent result after apply: %s was planned as %s and is %s", name, plannedValues[name], value)
		}
		if !value.IsFullyKnown() {
			tf.t.Errorf("%s is still unknown after apply", name)
		}
	}
	return state
}

// requireNoChanges: the next plan changes nothing.
func (tf *monitorSecretTerraform) requireNoChanges(state, config tftypes.Value) {
	tf.t.Helper()
	planned := tf.plan(state, config)
	failOnErrors(tf.t, "planning again", planned.Diagnostics)
	if !tf.decode(planned.PlannedState).Equal(state) {
		tf.t.Errorf("the plan after apply changes the secret:\n  state: %s\n  plan:  %s", state, tf.decode(planned.PlannedState))
	}
}

// requireRefusedOnType: the plan failed, on secret_type, in so many words.
func (tf *monitorSecretTerraform) requireRefusedOnType(planned *tfprotov6.PlanResourceChangeResponse, words string) {
	tf.t.Helper()
	refusals := 0
	for _, diagnostic := range planned.Diagnostics {
		if diagnostic.Severity != tfprotov6.DiagnosticSeverityError {
			continue
		}
		refusals++
		if diagnostic.Summary != "secret_type changes only with a new secret_value" {
			tf.t.Errorf("the plan failed with %q", diagnostic.Summary)
		}
		if !strings.Contains(diagnostic.Detail, words) {
			tf.t.Errorf("the refusal says %q, without %q", diagnostic.Detail, words)
		}
		if diagnostic.Attribute == nil || !diagnostic.Attribute.Equal(tftypes.NewAttributePath().WithAttributeName("secret_type")) {
			tf.t.Errorf("the refusal points at %v, not secret_type", diagnostic.Attribute)
		}
	}
	if refusals != 1 {
		tf.t.Fatalf("want the plan refused once, got %d errors: %v", refusals, planned.Diagnostics)
	}
}

func monitorSecretAttribute(t *testing.T, state tftypes.Value, name string) string {
	t.Helper()
	var text string
	if err := attributesOf(t, state)[name].As(&text); err != nil {
		t.Fatalf("reading %s: %s", name, err)
	}
	return text
}

func TestMonitorSecretTypeChangedAloneFailsAtPlan(t *testing.T) {
	tf := newMonitorSecretTerraform(t)
	// A setup key kept as Text, from before one-time code secrets.
	state := tf.apply(tftypes.NewValue(tf.objectType, nil), tf.secret("Text", monitorSecretSetupKey))

	tf.requireRefusedOnType(
		tf.plan(state, tf.secret("TOTP", monitorSecretSetupKey)),
		`This plan changes secret_type from "Text" to "TOTP" and keeps secret_value as it is.`,
	)

	if updates := tf.api.sentUpdates(); len(updates) != 0 {
		t.Errorf("a refused plan sent updates: %v", updates)
	}
}

func TestMonitorSecretOneTimeCodeMadeTextWithItsOwnKeyFailsAtPlan(t *testing.T) {
	tf := newMonitorSecretTerraform(t)
	state := tf.apply(tftypes.NewValue(tf.objectType, nil), tf.secret("TOTP", monitorSecretSetupKey))

	// As Text, the setup key would be sent where the code went.
	tf.requireRefusedOnType(
		tf.plan(state, tf.secret("Text", monitorSecretSetupKey)),
		`from "TOTP" to "Text" and keeps secret_value as it is.`,
	)

	// Taking secret_type out of the configuration plans its default, Text:
	// the same change, refused the same way.
	tf.requireRefusedOnType(
		tf.plan(state, tf.secret(nil, monitorSecretSetupKey)),
		`from "TOTP" to "Text" and keeps secret_value as it is.`,
	)

	if updates := tf.api.sentUpdates(); len(updates) != 0 {
		t.Errorf("a refused plan sent updates: %v", updates)
	}
}

func TestMonitorSecretTypeChangedWithoutAnyValueFailsAtPlan(t *testing.T) {
	tf := newMonitorSecretTerraform(t)
	state := tf.apply(tftypes.NewValue(tf.objectType, nil), tf.secret("Text", "correct horse battery staple"))

	tf.requireRefusedOnType(tf.plan(state, tf.secret("TOTP", nil)), "leaves secret_value empty")
	tf.requireRefusedOnType(tf.plan(state, tf.secret("TOTP", "")), "leaves secret_value empty")
}

func TestMonitorSecretValueChangedAloneUpdatesInPlace(t *testing.T) {
	tf := newMonitorSecretTerraform(t)
	config := tf.secret("TOTP", monitorSecretSetupKey)
	state := tf.apply(tftypes.NewValue(tf.objectType, nil), config)
	id := monitorSecretAttribute(t, state, "id")

	config = tf.secret("TOTP", monitorSecretOtherSetupKey)
	state = tf.apply(state, config)

	updates := tf.api.sentUpdates()
	if len(updates) != 1 {
		t.Fatalf("want one update, got %v", updates)
	}
	if len(updates[0]) != 1 || updates[0]["secretValue"] != monitorSecretOtherSetupKey {
		t.Errorf("the update sent %v, want the new value alone", updates[0])
	}
	if monitorSecretAttribute(t, state, "id") != id {
		t.Errorf("the secret was replaced: %s became %s", id, monitorSecretAttribute(t, state, "id"))
	}
	if monitorSecretAttribute(t, state, "secret_type") != "TOTP" {
		t.Errorf("the secret is now %s", monitorSecretAttribute(t, state, "secret_type"))
	}
	tf.requireNoChanges(state, config)
}

func TestMonitorSecretTypeAndValueChangeTogetherInPlace(t *testing.T) {
	tf := newMonitorSecretTerraform(t)
	state := tf.apply(tftypes.NewValue(tf.objectType, nil), tf.secret("Text", "correct horse battery staple"))
	id := monitorSecretAttribute(t, state, "id")

	// Text to a one-time code, with the site's setup key.
	toCode := tf.secret("TOTP", monitorSecretSetupKey)
	state = tf.apply(state, toCode)
	tf.requireNoChanges(state, toCode)

	// And back to Text, with a password.
	toText := tf.secret("Text", "a new password")
	state = tf.apply(state, toText)
	tf.requireNoChanges(state, toText)

	updates := tf.api.sentUpdates()
	want := []map[string]interface{}{
		{"secretType": "TOTP", "secretValue": monitorSecretSetupKey},
		{"secretType": "Text", "secretValue": "a new password"},
	}
	if len(updates) != len(want) {
		t.Fatalf("want %d updates, one per change, got %v", len(want), updates)
	}
	for index := range want {
		if len(updates[index]) != len(want[index]) {
			t.Errorf("update %d sent %v, want %v", index+1, updates[index], want[index])
			continue
		}
		for key, value := range want[index] {
			if updates[index][key] != value {
				t.Errorf("update %d sent %v, want %v", index+1, updates[index], want[index])
			}
		}
	}
	if len(tf.api.refused) != 0 {
		t.Errorf("OneUptime refused: %v", tf.api.refused)
	}
	if monitorSecretAttribute(t, state, "id") != id {
		t.Errorf("the secret was replaced: %s became %s", id, monitorSecretAttribute(t, state, "id"))
	}
	if monitorSecretAttribute(t, state, "secret_type") != "Text" {
		t.Errorf("the secret is now %s", monitorSecretAttribute(t, state, "secret_type"))
	}
}

func TestMonitorSecretImportedChangesTypeWithTheConfiguredValue(t *testing.T) {
	tf := newMonitorSecretTerraform(t)
	state := tf.apply(tftypes.NewValue(tf.objectType, nil), tf.secret("Text", "correct horse battery staple"))

	// An import cannot read the value back: state holds none.
	imported := withAttribute(t, tf.objectType, state, "secret_value", tftypes.NewValue(tftypes.String, nil))

	config := tf.secret("TOTP", monitorSecretSetupKey)
	state = tf.apply(imported, config)
	tf.requireNoChanges(state, config)

	updates := tf.api.sentUpdates()
	if len(updates) != 1 || updates[0]["secretType"] != "TOTP" || updates[0]["secretValue"] != monitorSecretSetupKey {
		t.Errorf("want one update with the type and the configured value, got %v", updates)
	}
}

func TestMonitorSecretValueKnownOnlyAtApplyIsLeftToOneUptime(t *testing.T) {
	tf := newMonitorSecretTerraform(t)
	state := tf.apply(tftypes.NewValue(tf.objectType, nil), tf.secret("Text", "correct horse battery staple"))

	// Made by another resource in the same apply: the plan cannot tell.
	planned := tf.plan(state, tf.secret("TOTP", tftypes.UnknownValue))
	failOnErrors(t, "planning a value known only at apply", planned.Diagnostics)
	if len(planned.RequiresReplace) > 0 {
		t.Errorf("the plan replaces the secret, because of %v", planned.RequiresReplace)
	}
}
