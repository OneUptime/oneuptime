package provider

/*
 * A project's own Twilio account and mail server - oneuptime_call_and_sms_config
 * and oneuptime_smtp_config (OneUptime/oneuptime#7737) - through the
 * provider's real protocol server, as terraform plan, apply, refresh and
 * import drive it, against a fake API that keeps and answers them as
 * OneUptime does: the phone number, the mail server's address, its port and
 * its sender wrapped in their types, the credentials decrypted for a key
 * that may read them, and the project's defaults for SMS and calls set by
 * the server (ProjectCallSMSConfigService, TwilioConfigDefaults).
 *
 * What the docs (self-hosted/twilio-integration.md, emails/smtp.md) say a
 * configuration does is held here:
 *
 *   - the Auth Token and the password are sent on create and by an update
 *     that changes them, and read back, so a plan after an apply, a refresh
 *     or an import changes nothing;
 *   - a configuration that leaves is_project_default out sends false, so
 *     OneUptime does not make it the project's default as it makes the first
 *     config of a project that says nothing;
 *   - is_project_default_for_sms and is_project_default_for_calls are never
 *     sent: OneUptime sets them, and Terraform reads them;
 *   - two configurations with the same used_for that both set
 *     is_project_default take the default from each other on every apply,
 *     and one for SMS and one for calls are both the default;
 *   - a phone number applies however it is written: OneUptime keeps
 *     "+1 415 555 0100" as "+14155550100", and the state keeps the
 *     configuration's spelling, a refresh and an import plan no change, and
 *     the number is sent as the string written (phone.go,
 *     OneUptime/oneuptime#7777).
 *
 * Terraform is driven as monitorstepsvalues_roundtrip_test.go drives it
 * (stepValuesTerraform), with the provider configured against this API.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
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
	ownChannelsAPIKey     = "own-notification-channels-key"
	ownChannelsProjectID  = "a1000000-0000-4000-8000-000000000701"
	ownChannelsCreatedAt  = "2026-11-13T08:00:00.000Z"
	ownChannelsAccountSID = "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
	ownChannelsPhone      = "+14155550100"

	callSMSConfigType = "oneuptime_call_and_sms_config"
	smtpConfigType    = "oneuptime_smtp_config"

	callSMSConfigTable = "/call-sms-config"
	smtpConfigTable    = "/smtp-config"
)

// The columns OneUptime answers wrapped in their types.
var ownChannelsWrapped = map[string]string{
	"twilioPrimaryPhoneNumber": "Phone",
	"hostname":                 "Hostname",
	"port":                     "Port",
	"fromEmail":                "Email",
}

// How OneUptime keeps each number these tests write (Common/Types/Phone.ts:
// as written when its E.123 check takes it, otherwise as its digits). It is
// written out here, not computed with phone.go's rule, which is what these
// tests check; TestCallAndSMSConfig_PhoneNumbersApplyHoweverTheyAreWritten
// holds it to the server's own cases.
var ownChannelsStoredPhones = map[string]string{
	"+14155550100":     "+14155550100",
	"+1 415 555 0100":  "+14155550100",
	"+1 415 555 0101":  "+14155550101",
	"+44 20 7946 0958": "+442079460958",
	"14155550100":      "14155550100",
	"(415) 555-0100":   "(415) 555-0100",
	"+1-555-123-4567":  "+15551234567",
}

// ownChannelsAPI is the fake OneUptime API: a project's Twilio configs and
// SMTP configs, kept and answered as OneUptime keeps them.
type ownChannelsAPI struct {
	t      *testing.T
	server *httptest.Server

	mu   sync.Mutex
	rows map[string]map[string]map[string]interface{}
	// Every create's and update's data, per table, in the order sent.
	sent    map[string][]map[string]interface{}
	created int
}

func newOwnChannelsAPI(t *testing.T) *ownChannelsAPI {
	t.Helper()
	api := &ownChannelsAPI{
		t: t,
		rows: map[string]map[string]map[string]interface{}{
			callSMSConfigTable: {},
			smtpConfigTable:    {},
		},
		sent: map[string][]map[string]interface{}{},
	}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

// What a config used for this sends: SMS, calls or both (TwilioConfigUse).
func ownChannelsKinds(usedFor interface{}) (sms bool, calls bool) {
	switch usedFor {
	case "SMS only":
		return true, false
	case "Calls only":
		return false, true
	default:
		return true, true
	}
}

// makeDefault makes the config the project default for everything it is
// used for, taking that from the project's other configs: one left the
// default for nothing reads false.
func (a *ownChannelsAPI) makeDefault(id string) {
	rows := a.rows[callSMSConfigTable]
	sms, calls := ownChannelsKinds(rows[id]["usedFor"])
	for otherID, other := range rows {
		if otherID == id {
			continue
		}
		if sms {
			other["isProjectDefaultForSms"] = false
		}
		if calls {
			other["isProjectDefaultForCalls"] = false
		}
		other["isProjectDefault"] = other["isProjectDefaultForSms"] == true || other["isProjectDefaultForCalls"] == true
	}
	rows[id]["isProjectDefault"] = true
	rows[id]["isProjectDefaultForSms"] = sms
	rows[id]["isProjectDefaultForCalls"] = calls
}

// makeDefaultForNothing is an explicit false.
func (a *ownChannelsAPI) makeDefaultForNothing(id string) {
	row := a.rows[callSMSConfigTable][id]
	row["isProjectDefault"] = false
	row["isProjectDefaultForSms"] = false
	row["isProjectDefaultForCalls"] = false
}

// settleDefaults does what a write's isProjectDefault asks. A create that
// says nothing makes a project's first config its default.
func (a *ownChannelsAPI) settleDefaults(id string, data map[string]interface{}, isCreate bool) {
	isDefault, given := data["isProjectDefault"].(bool)
	if !given {
		if !isCreate {
			return
		}
		isDefault = len(a.rows[callSMSConfigTable]) == 1
	}
	if isDefault {
		a.makeDefault(id)
	} else {
		a.makeDefaultForNothing(id)
	}
}

// keepPhone is the phone number a write sends, as OneUptime keeps it: "" when
// it sends none, and false when it is not the string a configuration writes
// or is a number these tests do not write.
func (a *ownChannelsAPI) keepPhone(data map[string]interface{}) (string, bool) {
	value, given := data["twilioPrimaryPhoneNumber"]
	if !given {
		return "", true
	}
	written, isString := value.(string)
	if !isString {
		a.t.Errorf("the phone number was sent as %#v, not as the string a configuration writes", value)
		return "", false
	}
	stored, known := ownChannelsStoredPhones[written]
	if !known {
		a.t.Errorf("the phone number %q was sent, which ownChannelsStoredPhones does not name", written)
		return "", false
	}
	return stored, true
}

// answer is a row as the API answers it.
func (a *ownChannelsAPI) answer(table, id string) map[string]interface{} {
	answer := map[string]interface{}{
		"_id":       id,
		"projectId": map[string]interface{}{"_type": "ObjectID", "value": ownChannelsProjectID},
		"createdAt": map[string]interface{}{"_type": "DateTime", "value": ownChannelsCreatedAt},
		"updatedAt": map[string]interface{}{"_type": "DateTime", "value": ownChannelsCreatedAt},
	}
	for key, value := range a.rows[table][id] {
		if wrapper, wrapped := ownChannelsWrapped[key]; wrapped && value != nil {
			answer[key] = map[string]interface{}{"_type": wrapper, "value": value}
			continue
		}
		answer[key] = value
	}
	return answer
}

func (a *ownChannelsAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if r.Header.Get("APIKey") != ownChannelsAPIKey {
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
	for _, table := range []string{callSMSConfigTable, smtpConfigTable} {
		rows := a.rows[table]
		switch {
		case path == table && r.Method == http.MethodPost:
			phone, ok := a.keepPhone(data)
			if !ok {
				a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "Phone is not in valid format"})
				return
			}
			a.created++
			id := fmt.Sprintf("a1000000-0000-4000-8000-%012d", 700+a.created)
			rows[id] = map[string]interface{}{}
			for key, value := range data {
				rows[id][key] = value
			}
			if phone != "" {
				rows[id]["twilioPrimaryPhoneNumber"] = phone
			}
			a.sent[table] = append(a.sent[table], data)
			if table == callSMSConfigTable {
				// What the config is the default for is the server's to say.
				rows[id]["isProjectDefaultForSms"] = false
				rows[id]["isProjectDefaultForCalls"] = false
				a.settleDefaults(id, data, true)
			}
			a.reply(w, http.StatusOK, a.answer(table, id))
			return
		case strings.HasPrefix(path, table+"/"):
			rest := strings.TrimPrefix(path, table+"/")
			id := strings.TrimSuffix(rest, "/get-item")
			row, ok := rows[id]
			if !ok {
				a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
				return
			}
			switch {
			case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
				a.reply(w, http.StatusOK, map[string]interface{}{"data": a.answer(table, id)})
			case r.Method == http.MethodPut && id == rest:
				phone, ok := a.keepPhone(data)
				if !ok {
					a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "Phone is not in valid format"})
					return
				}
				for key, value := range data {
					row[key] = value
				}
				if phone != "" {
					row["twilioPrimaryPhoneNumber"] = phone
				}
				a.sent[table] = append(a.sent[table], data)
				if table == callSMSConfigTable {
					a.settleDefaults(id, data, false)
				}
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

func (a *ownChannelsAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

// sentTo is every create's and update's data the table was sent.
func (a *ownChannelsAPI) sentTo(table string) []map[string]interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]map[string]interface{}{}, a.sent[table]...)
}

// lastSent is the data of the table's last create or update.
func (a *ownChannelsAPI) lastSent(t *testing.T, table string) map[string]interface{} {
	t.Helper()
	sent := a.sentTo(table)
	if len(sent) == 0 {
		t.Fatalf("nothing was sent to %s", table)
	}
	return sent[len(sent)-1]
}

// newOwnChannelsTerraform is Terraform with the provider configured against
// the fake API.
func newOwnChannelsTerraform(t *testing.T, api *ownChannelsAPI) *stepValuesTerraform {
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
		"api_key":       tftypes.NewValue(tftypes.String, ownChannelsAPIKey),
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

// ownChannelsNothing is the state of a resource not yet created.
func ownChannelsNothing(tf *stepValuesTerraform, typeName string) settled {
	return settled{state: tftypes.NewValue(tf.objectType(typeName), nil)}
}

// twilioConfig is the docs' example - a configuration for calls and SMS, its
// token from a variable - with these attributes besides.
func twilioConfig(tf *stepValuesTerraform, name, token string, more map[string]tftypes.Value) tftypes.Value {
	values := map[string]tftypes.Value{
		"name":                        tftypes.NewValue(tftypes.String, name),
		"used_for":                    tftypes.NewValue(tftypes.String, "Calls and SMS"),
		"twilio_account_sid":          tftypes.NewValue(tftypes.String, ownChannelsAccountSID),
		"twilio_auth_token":           tftypes.NewValue(tftypes.String, token),
		"twilio_primary_phone_number": tftypes.NewValue(tftypes.String, ownChannelsPhone),
	}
	for key, value := range more {
		values[key] = value
	}
	return objectWith(tf.objectType(callSMSConfigType), values)
}

func projectDefault(isDefault bool) map[string]tftypes.Value {
	return map[string]tftypes.Value{"is_project_default": tftypes.NewValue(tftypes.Bool, isDefault)}
}

// smtpConfig is a mail server signed in to with a username and a password.
func smtpConfig(tf *stepValuesTerraform, password string) tftypes.Value {
	return objectWith(tf.objectType(smtpConfigType), map[string]tftypes.Value{
		"name":       tftypes.NewValue(tftypes.String, "Production mail"),
		"hostname":   tftypes.NewValue(tftypes.String, "smtp.example.com"),
		"port":       tftypes.NewValue(tftypes.Number, big.NewFloat(587)),
		"username":   tftypes.NewValue(tftypes.String, "alerts"),
		"password":   tftypes.NewValue(tftypes.String, password),
		"from_email": tftypes.NewValue(tftypes.String, "alerts@example.com"),
		"from_name":  tftypes.NewValue(tftypes.String, "OneUptime Alerts"),
	})
}

func ownChannelsBool(t *testing.T, object tftypes.Value, name string) bool {
	t.Helper()
	var value bool
	if err := attributesOf(t, object)[name].As(&value); err != nil {
		t.Fatalf("reading %s: %s", name, err)
	}
	return value
}

func TestCallAndSMSConfig_AppliesSendsTheTokenAndPlansNoChange(t *testing.T) {
	api := newOwnChannelsAPI(t)
	tf := newOwnChannelsTerraform(t, api)

	config := twilioConfig(tf, "Production Twilio", "token-one", projectDefault(true))
	created := tf.apply(callSMSConfigType, ownChannelsNothing(tf, callSMSConfigType), config)
	id := stringAttribute(t, created.state, "id")

	create := api.lastSent(t, callSMSConfigTable)
	if create["twilioAuthToken"] != "token-one" {
		t.Fatalf("the create sent the token as %#v", create["twilioAuthToken"])
	}
	if create["twilioAccountSID"] != ownChannelsAccountSID || create["twilioPrimaryPhoneNumber"] != ownChannelsPhone {
		t.Fatalf("the create sent the account as %#v and the number as %#v", create["twilioAccountSID"], create["twilioPrimaryPhoneNumber"])
	}
	if create["isProjectDefault"] != true || create["usedFor"] != "Calls and SMS" {
		t.Fatalf("the create sent isProjectDefault %#v and usedFor %#v", create["isProjectDefault"], create["usedFor"])
	}
	for _, computed := range []string{"isProjectDefaultForSms", "isProjectDefaultForCalls"} {
		if _, sent := create[computed]; sent {
			t.Fatalf("the create sent %s, which OneUptime sets", computed)
		}
	}

	// OneUptime made it the default for SMS and calls; Terraform reads that.
	if !ownChannelsBool(t, created.state, "is_project_default_for_sms") || !ownChannelsBool(t, created.state, "is_project_default_for_calls") {
		t.Fatalf("after the apply, the state does not read the defaults OneUptime set: %s", created.state)
	}
	if got := stringAttribute(t, created.state, "twilio_auth_token"); got != "token-one" {
		t.Fatalf("after the apply, the state's token is %q", got)
	}
	if got := stringAttribute(t, created.state, "twilio_primary_phone_number"); got != ownChannelsPhone {
		t.Fatalf("after the apply, the state's number is %q", got)
	}

	refreshed := tf.refresh(callSMSConfigType, created)
	if changed := tf.changes(callSMSConfigType, refreshed, config); len(changed) > 0 {
		t.Fatalf("the plan after a refresh changes %v", changed)
	}

	// A new token is a change of the token, and the update sends it alone.
	rotated := twilioConfig(tf, "Production Twilio", "token-two", projectDefault(true))
	if changed := tf.changes(callSMSConfigType, refreshed, rotated); !containsString(changed, "twilio_auth_token") {
		t.Fatalf("a new token plans %v, not a change of twilio_auth_token", changed)
	}
	updated := tf.apply(callSMSConfigType, refreshed, rotated)
	update := api.lastSent(t, callSMSConfigTable)
	if len(update) != 1 || update["twilioAuthToken"] != "token-two" {
		t.Fatalf("the update sent %v, not the new token alone", update)
	}
	if changed := tf.changes(callSMSConfigType, tf.refresh(callSMSConfigType, updated), rotated); len(changed) > 0 {
		t.Fatalf("the plan after the update changes %v", changed)
	}

	// Imported, it reads the token back: the plan changes nothing.
	imported := tf.importResource(callSMSConfigType, id)
	if got := stringAttribute(t, imported.state, "twilio_auth_token"); got != "token-two" {
		t.Fatalf("after the import, the state's token is %q", got)
	}
	if changed := tf.changes(callSMSConfigType, imported, rotated); len(changed) > 0 {
		t.Fatalf("the plan after the import changes %v", changed)
	}

	// The token is sensitive: plans, logs and outputs never print it.
	for _, attribute := range tf.schemas[callSMSConfigType].Block.Attributes {
		if attribute.Sensitive != (attribute.Name == "twilio_auth_token") {
			t.Fatalf("%s is sensitive: %v", attribute.Name, attribute.Sensitive)
		}
	}
}

func TestCallAndSMSConfig_LeftOutProjectDefaultSendsFalse(t *testing.T) {
	api := newOwnChannelsAPI(t)
	tf := newOwnChannelsTerraform(t, api)

	// The project's first config, which OneUptime makes the default when the
	// create says nothing.
	config := twilioConfig(tf, "Backup Twilio", "token-one", nil)
	created := tf.apply(callSMSConfigType, ownChannelsNothing(tf, callSMSConfigType), config)

	if sent, given := api.lastSent(t, callSMSConfigTable)["isProjectDefault"]; !given || sent != false {
		t.Fatalf("a configuration that leaves is_project_default out sent %#v (given: %v), not false", sent, given)
	}
	for _, name := range []string{"is_project_default", "is_project_default_for_sms", "is_project_default_for_calls"} {
		if ownChannelsBool(t, created.state, name) {
			t.Fatalf("after the apply, %s is true", name)
		}
	}
	if changed := tf.changes(callSMSConfigType, tf.refresh(callSMSConfigType, created), config); len(changed) > 0 {
		t.Fatalf("the plan after a refresh changes %v", changed)
	}
}

func TestCallAndSMSConfig_TwoDefaultsWithTheSameUseTakeItFromEachOther(t *testing.T) {
	t.Run("the same used_for", func(t *testing.T) {
		api := newOwnChannelsAPI(t)
		tf := newOwnChannelsTerraform(t, api)

		first := twilioConfig(tf, "Twilio A", "token-a", projectDefault(true))
		second := twilioConfig(tf, "Twilio B", "token-b", projectDefault(true))
		a := tf.apply(callSMSConfigType, ownChannelsNothing(tf, callSMSConfigType), first)
		b := tf.apply(callSMSConfigType, ownChannelsNothing(tf, callSMSConfigType), second)

		// B took the default from A, whose next plan takes it back...
		a = tf.refresh(callSMSConfigType, a)
		if ownChannelsBool(t, a.state, "is_project_default") {
			t.Fatalf("A is still the default after B took it")
		}
		if changed := tf.changes(callSMSConfigType, a, first); !containsString(changed, "is_project_default") {
			t.Fatalf("A's plan after B took the default changes %v", changed)
		}
		a = tf.apply(callSMSConfigType, a, first)
		if update := api.lastSent(t, callSMSConfigTable); update["isProjectDefault"] != true {
			t.Fatalf("A's update sent %v", update)
		}

		// ... from B, whose next plan takes it back again.
		b = tf.refresh(callSMSConfigType, b)
		if ownChannelsBool(t, b.state, "is_project_default") {
			t.Fatalf("B is still the default after A took it back")
		}
		if changed := tf.changes(callSMSConfigType, b, second); !containsString(changed, "is_project_default") {
			t.Fatalf("B's plan after A took the default back changes %v", changed)
		}
	})

	t.Run("one for SMS, one for calls", func(t *testing.T) {
		api := newOwnChannelsAPI(t)
		tf := newOwnChannelsTerraform(t, api)

		sms := twilioConfig(tf, "Twilio SMS", "token-a", map[string]tftypes.Value{
			"used_for":           tftypes.NewValue(tftypes.String, "SMS only"),
			"is_project_default": tftypes.NewValue(tftypes.Bool, true),
		})
		calls := twilioConfig(tf, "Twilio calls", "token-b", map[string]tftypes.Value{
			"used_for":           tftypes.NewValue(tftypes.String, "Calls only"),
			"is_project_default": tftypes.NewValue(tftypes.Bool, true),
		})
		s := tf.apply(callSMSConfigType, ownChannelsNothing(tf, callSMSConfigType), sms)
		c := tf.apply(callSMSConfigType, ownChannelsNothing(tf, callSMSConfigType), calls)

		s = tf.refresh(callSMSConfigType, s)
		c = tf.refresh(callSMSConfigType, c)
		if !ownChannelsBool(t, s.state, "is_project_default_for_sms") || ownChannelsBool(t, s.state, "is_project_default_for_calls") {
			t.Fatalf("the SMS config reads %s", s.state)
		}
		if !ownChannelsBool(t, c.state, "is_project_default_for_calls") || ownChannelsBool(t, c.state, "is_project_default_for_sms") {
			t.Fatalf("the calls config reads %s", c.state)
		}
		if changed := tf.changes(callSMSConfigType, s, sms); len(changed) > 0 {
			t.Fatalf("the SMS config's plan changes %v", changed)
		}
		if changed := tf.changes(callSMSConfigType, c, calls); len(changed) > 0 {
			t.Fatalf("the calls config's plan changes %v", changed)
		}
	})
}

func TestSMTPConfig_AppliesSendsThePasswordAndPlansNoChange(t *testing.T) {
	api := newOwnChannelsAPI(t)
	tf := newOwnChannelsTerraform(t, api)

	config := smtpConfig(tf, "password-one")
	created := tf.apply(smtpConfigType, ownChannelsNothing(tf, smtpConfigType), config)
	id := stringAttribute(t, created.state, "id")

	create := api.lastSent(t, smtpConfigTable)
	if create["password"] != "password-one" || create["hostname"] != "smtp.example.com" ||
		create["fromEmail"] != "alerts@example.com" || create["port"] != float64(587) {
		t.Fatalf("the create sent %v", create)
	}
	if got := stringAttribute(t, created.state, "password"); got != "password-one" {
		t.Fatalf("after the apply, the state's password is %q", got)
	}

	refreshed := tf.refresh(smtpConfigType, created)
	if changed := tf.changes(smtpConfigType, refreshed, config); len(changed) > 0 {
		t.Fatalf("the plan after a refresh changes %v", changed)
	}

	// A new password is sent alone.
	rotated := smtpConfig(tf, "password-two")
	updated := tf.apply(smtpConfigType, refreshed, rotated)
	if update := api.lastSent(t, smtpConfigTable); len(update) != 1 || update["password"] != "password-two" {
		t.Fatalf("the update sent %v, not the new password alone", update)
	}
	if changed := tf.changes(smtpConfigType, tf.refresh(smtpConfigType, updated), rotated); len(changed) > 0 {
		t.Fatalf("the plan after the update changes %v", changed)
	}

	imported := tf.importResource(smtpConfigType, id)
	if got := stringAttribute(t, imported.state, "password"); got != "password-two" {
		t.Fatalf("after the import, the state's password is %q", got)
	}
	if changed := tf.changes(smtpConfigType, imported, rotated); len(changed) > 0 {
		t.Fatalf("the plan after the import changes %v", changed)
	}

	// The password, the OAuth client secret and the providers' keys are
	// sensitive, and nothing else is.
	secrets := []string{
		"amazon_ses_secret_access_key",
		"client_secret",
		"mailgun_api_key",
		"password",
		"postmark_server_token",
		"resend_api_key",
		"sendgrid_api_key",
	}
	for _, attribute := range tf.schemas[smtpConfigType].Block.Attributes {
		if attribute.Sensitive != containsString(secrets, attribute.Name) {
			t.Fatalf("%s is sensitive: %v", attribute.Name, attribute.Sensitive)
		}
	}
}

// withPhone is the attributes to write the Twilio account's number this way.
func withPhone(written string) map[string]tftypes.Value {
	return map[string]tftypes.Value{"twilio_primary_phone_number": tftypes.NewValue(tftypes.String, written)}
}

func TestCallAndSMSConfig_PhoneNumbersApplyHoweverTheyAreWritten(t *testing.T) {
	// The fake API's numbers are the server's: each its cases name is kept
	// as they say (testdata/phone_numbers.json, from Phone.ts).
	named := 0
	for _, tc := range readPhoneCases(t).Cases {
		stored, known := ownChannelsStoredPhones[tc.Written]
		if !known {
			continue
		}
		named++
		if tc.Stored == nil || *tc.Stored != stored {
			t.Fatalf("the fake API keeps %q as %q, the server as %v", tc.Written, stored, tc.Stored)
		}
	}
	if named < 6 {
		t.Fatalf("the server's cases name %d of the fake API's numbers, expected 6", named)
	}

	for _, written := range []string{
		// Grouped as people say them, which OneUptime keeps as their digits.
		"+1 415 555 0100",
		"+44 20 7946 0958",
		// The spec's own example.
		"+1-555-123-4567",
		// Kept as written.
		"(415) 555-0100",
		// Digits alone: sent as a string, never as a JSON number.
		"14155550100",
	} {
		t.Run(written, func(t *testing.T) {
			api := newOwnChannelsAPI(t)
			tf := newOwnChannelsTerraform(t, api)

			config := twilioConfig(tf, "Production Twilio", "token-one", withPhone(written))
			if errors := tf.validate(callSMSConfigType, config); len(errors) > 0 {
				t.Fatalf("terraform validate: %s - %s", errors[0].Summary, errors[0].Detail)
			}

			// Fails here with "Provider produced inconsistent result after
			// apply" when the provider compares the number OneUptime
			// answers as text.
			created := tf.apply(callSMSConfigType, ownChannelsNothing(tf, callSMSConfigType), config)
			id := stringAttribute(t, created.state, "id")

			if sent := api.lastSent(t, callSMSConfigTable)["twilioPrimaryPhoneNumber"]; sent != written {
				t.Fatalf("the create sent the number as %#v, not as the string %q", sent, written)
			}
			if got := stringAttribute(t, created.state, "twilio_primary_phone_number"); got != written {
				t.Fatalf("after the apply, the state's number is %q, not the configuration's", got)
			}

			refreshed := tf.refresh(callSMSConfigType, created)
			if got := stringAttribute(t, refreshed.state, "twilio_primary_phone_number"); got != written {
				t.Fatalf("after a refresh, the state's number is %q, not the configuration's", got)
			}
			if changed := tf.changes(callSMSConfigType, refreshed, config); len(changed) > 0 {
				t.Fatalf("the plan after a refresh changes %v", changed)
			}

			// An import reads the number as OneUptime keeps it, which is the
			// configuration's number.
			imported := tf.importResource(callSMSConfigType, id)
			if got := stringAttribute(t, imported.state, "twilio_primary_phone_number"); got != ownChannelsStoredPhones[written] {
				t.Fatalf("after the import, the state's number is %q, not OneUptime's %q", got, ownChannelsStoredPhones[written])
			}
			if changed := tf.changes(callSMSConfigType, imported, config); len(changed) > 0 {
				t.Fatalf("the plan after the import changes %v", changed)
			}

			if writes := len(api.sentTo(callSMSConfigTable)); writes != 1 {
				t.Fatalf("the API was written %d times, not once", writes)
			}
		})
	}
}

func TestCallAndSMSConfig_TheSameNumberWrittenAnotherWayIsNoChange(t *testing.T) {
	api := newOwnChannelsAPI(t)
	tf := newOwnChannelsTerraform(t, api)

	created := tf.apply(callSMSConfigType, ownChannelsNothing(tf, callSMSConfigType), twilioConfig(tf, "Production Twilio", "token-one", nil))

	// The number as Twilio shows it, then grouped: the same number.
	for _, written := range []string{"+1 415 555 0100", " +14155550100", "+1 (415) 555-0100"} {
		if changed := tf.changes(callSMSConfigType, created, twilioConfig(tf, "Production Twilio", "token-one", withPhone(written))); len(changed) > 0 {
			t.Fatalf("%q over %q plans %v", written, ownChannelsPhone, changed)
		}
	}

	// Another number is a change: sent alone, as the string written, and
	// applied cleanly.
	another := twilioConfig(tf, "Production Twilio", "token-one", withPhone("+1 415 555 0101"))
	if changed := tf.changes(callSMSConfigType, created, another); !containsString(changed, "twilio_primary_phone_number") {
		t.Fatalf("another number plans %v, not a change of twilio_primary_phone_number", changed)
	}
	updated := tf.apply(callSMSConfigType, created, another)
	if update := api.lastSent(t, callSMSConfigTable); len(update) != 1 || update["twilioPrimaryPhoneNumber"] != "+1 415 555 0101" {
		t.Fatalf("the update sent %v, not the new number alone", update)
	}
	if got := stringAttribute(t, updated.state, "twilio_primary_phone_number"); got != "+1 415 555 0101" {
		t.Fatalf("after the update, the state's number is %q, not the configuration's", got)
	}
	if changed := tf.changes(callSMSConfigType, tf.refresh(callSMSConfigType, updated), another); len(changed) > 0 {
		t.Fatalf("the plan after the update changes %v", changed)
	}

	// A number OneUptime refuses fails terraform validate, before anything
	// is sent.
	errors := tf.validate(callSMSConfigType, twilioConfig(tf, "Production Twilio", "token-one", withPhone("+1 415 555 CALL")))
	if len(errors) != 1 || errors[0].Summary != "Invalid Phone Number" ||
		errors[0].Attribute == nil || !strings.Contains(errors[0].Attribute.String(), "twilio_primary_phone_number") {
		t.Fatalf("a number OneUptime refuses gives %v", errors)
	}
}
