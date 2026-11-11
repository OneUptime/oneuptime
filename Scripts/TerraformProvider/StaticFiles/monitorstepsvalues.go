package provider

/*
 * The values in a monitor's steps that OneUptime reads when they are written
 * another way (OneUptime/oneuptime#6722, #6723).
 *
 * A step keeps how far back each check reads as `rollingTime` in its
 * settings - metric_monitor, kubernetes_monitor and the other settings that
 * hold one, raw JSON here - and a filter keeps its metric aggregation and
 * no-data policy in metric_monitor_options, raw JSON too. The server reads a
 * value written another way as the one it means, stores that one and answers
 * it back: "15 minutes", "15m" and "PT15M" are "Past 15 Minutes", "avg" is
 * "Average". A value that means none is refused.
 *
 * So here:
 *   - normalizeMonitorStepsValues reads both sides of a comparison
 *     (ListSemanticEquals, the import modifier) as the server stores them. A
 *     configuration that wrote "15 minutes" is no change when the server
 *     answers "Past 15 Minutes"; before, the apply failed with "Provider
 *     produced inconsistent result after apply", and every plan after it
 *     changed the steps.
 *   - The validators refuse at plan time, in the server's words, a value the
 *     server would refuse at apply. A rolling time is checked only in the
 *     settings the monitor's own type reads (metric_monitor for a Metrics
 *     monitor), as the server checks only those.
 *
 * Every rule here is the server's: RollingTimeUtil.fromValue
 * (Common/Types/RollingTime/RollingTimeUtil.ts), MonitorStepRollingTime and
 * CriteriaFilterValues (Common/Types/Monitor/). monitorstepsvalues_test.go
 * checks them against testdata/monitor_steps_values.json, which the
 * generator writes from the server's own code each time it runs
 * (Scripts/TerraformProvider/Core/MonitorStepsValuesCases.ts), so a rule
 * changed there and not here fails `go test`.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// ---------------------------------------------------------------------------
// Rolling times
// ---------------------------------------------------------------------------

// Each rolling time as OneUptime writes it, and how long its window is in
// minutes (RollingTime.ts, and RollingTimeUtil.ts WINDOW_IN_MINUTES), in the
// enum's order. A day is 24 hours.
var monitorStepsRollingTimes = []struct {
	value   string
	minutes int64
}{
	{"Past 1 Minute", 1},
	{"Past 5 Minutes", 5},
	{"Past 10 Minutes", 10},
	{"Past 15 Minutes", 15},
	{"Past 30 Minutes", 30},
	{"Past 1 Hour", 60},
	{"Past 2 Hours", 2 * 60},
	{"Past 3 Hours", 3 * 60},
	{"Past 6 Hours", 6 * 60},
	{"Past 12 Hours", 12 * 60},
	{"Past 1 Day", 24 * 60},
	{"Past 2 Days", 2 * 24 * 60},
	{"Past 3 Days", 3 * 24 * 60},
	{"Past 7 Days", 7 * 24 * 60},
	{"Past 14 Days", 14 * 24 * 60},
	{"Past 30 Days", 30 * 24 * 60},
	{"Past 60 Days", 60 * 24 * 60},
	{"Past 90 Days", 90 * 24 * 60},
	{"Past 180 Days", 180 * 24 * 60},
	{"Past 365 Days", 365 * 24 * 60},
}

// The rolling time a step's metric settings are stored with when they name
// none, or a value JavaScript reads as false (MonitorStepMetricMonitor.ts).
const monitorStepsDefaultRollingTime = "Past 1 Minute"

// The settings that keep a rolling time, and the monitor type that reads
// each (MonitorStepRollingTime.ts ROLLING_TIME_STEP_KEYS). The keys are the
// API keys of monitorStepsSubConfigs.
var monitorStepsRollingTimeSettings = []struct {
	apiKey      string
	monitorType string
}{
	{"metricMonitor", "Metrics"},
	{"kubernetesMonitor", "Kubernetes"},
	{"dockerMonitor", "Docker"},
	{"hostMonitor", "Host"},
	{"podmanMonitor", "Podman"},
	{"dockerSwarmMonitor", "Docker Swarm"},
	{"proxmoxMonitor", "Proxmox"},
	{"openstackMonitor", "OpenStack"},
	{"vmwareMonitor", "VMware"},
	{"cephMonitor", "Ceph"},
	{"storageArrayMonitor", "Storage Array"},
	{"iotMonitor", "IoT Device"},
}

// The longest text read as a length of time (MAX_LENGTH_TEXT_LENGTH).
const monitorStepsRollingTimeMaxLength = 64

// The enum's key name for Past 1 Day, whose words say an hour: whoever wrote
// it meant one or the other, so it reads as neither
// (KEY_NAME_THAT_SAYS_ANOTHER_LENGTH).
const monitorStepsRollingTimeKeyName = "past1hours"

// A length in words or short units, read from text already lower case with
// each run of spaces, dashes and underscores one space (LENGTH_IN_WORDS).
var monitorStepsLengthInWords = regexp.MustCompile(`^(?:(past|last|previous) ?)?(\d{1,9}(?:\.\d{1,9})?)? ?([a-z]{1,7})$`)

// An ISO 8601 duration without years or months, read lower case
// (ISO_8601_DURATION).
var monitorStepsISO8601Duration = regexp.MustCompile(`^p(?:(\d{1,9})w)?(?:(\d{1,9})d)?(?:t(?:(\d{1,9})h)?(?:(\d{1,9})m)?(?:(\d{1,9})s)?)?$`)

// Each unit a length may be written in, in seconds (UNIT_IN_SECONDS).
var monitorStepsUnitInSeconds = map[string]int64{
	"s":       1,
	"sec":     1,
	"secs":    1,
	"second":  1,
	"seconds": 1,
	"m":       60,
	"min":     60,
	"mins":    60,
	"minute":  60,
	"minutes": 60,
	"h":       60 * 60,
	"hr":      60 * 60,
	"hrs":     60 * 60,
	"hour":    60 * 60,
	"hours":   60 * 60,
	"d":       24 * 60 * 60,
	"day":     24 * 60 * 60,
	"days":    24 * 60 * 60,
	"w":       7 * 24 * 60 * 60,
	"wk":      7 * 24 * 60 * 60,
	"wks":     7 * 24 * 60 * 60,
	"week":    7 * 24 * 60 * 60,
	"weeks":   7 * 24 * 60 * 60,
}

// The units "past" or "last" may stand before with no number: "past hour"
// (UNITS_WITHOUT_A_NUMBER).
var monitorStepsUnitsWithoutANumber = map[string]bool{
	"minute": true,
	"hour":   true,
	"day":    true,
	"week":   true,
}

// monitorStepsRollingTimeValues is every rolling time, as OneUptime writes it.
func monitorStepsRollingTimeValues() []string {
	values := make([]string, 0, len(monitorStepsRollingTimes))
	for _, rollingTime := range monitorStepsRollingTimes {
		values = append(values, rollingTime.value)
	}
	return values
}

// monitorStepsRollingTimeMonitorType is the monitor type that reads the
// rolling time of a step's settings, by the settings' API key, or "" for
// settings that keep none.
func monitorStepsRollingTimeMonitorType(apiKey string) string {
	for _, settings := range monitorStepsRollingTimeSettings {
		if settings.apiKey == apiKey {
			return settings.monitorType
		}
	}
	return ""
}

/*
 * monitorStepsReadRollingTime is the rolling time a value means, as the
 * server reads it (RollingTimeUtil.fromValue), or false when it means none:
 *   - each rolling time as OneUptime writes it, in any case and spacing, with
 *     dashes or underscores between the words;
 *   - a number and a unit, after "past", "last" or "previous" or not:
 *     "15 minutes", "15m", "last 15 minutes", "24h", "1 week";
 *   - "past" or "last" and a unit: "past hour";
 *   - an ISO 8601 duration: "PT15M", "PT1H", "P1D", "P1W".
 *
 * A length is the rolling time exactly as long: "60 minutes" is Past 1 Hour,
 * "2 weeks" Past 14 Days. A length no rolling time is as long as ("20
 * minutes"), a month or a year, a number with no unit, the enum's key name
 * "Past1Hours", and anything else mean none.
 */
func monitorStepsReadRollingTime(value interface{}) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}

	for _, rollingTime := range monitorStepsRollingTimes {
		if text == rollingTime.value {
			return text, true
		}
	}

	trimmed := strings.TrimFunc(text, jsIsWhitespace)
	length := jsLength(trimmed)
	if length == 0 || length > monitorStepsRollingTimeMaxLength {
		return "", false
	}

	lowered := strings.Trim(jsJoinSeparators(jsToLower(trimmed), " "), " ")
	if lowered == monitorStepsRollingTimeKeyName {
		return "", false
	}

	seconds, ok := monitorStepsReadISO8601Duration(lowered)
	if !ok {
		seconds, ok = monitorStepsReadLengthInWords(lowered)
	}
	if !ok {
		return "", false
	}

	return monitorStepsRollingTimeOfWindow(math.Round(seconds * 1000))
}

// monitorStepsRollingTimeOfWindow is the rolling time whose window is exactly
// this many milliseconds long (RollingTimeUtil.fromWindowInMs).
func monitorStepsRollingTimeOfWindow(windowInMs float64) (string, bool) {
	if math.IsNaN(windowInMs) || math.IsInf(windowInMs, 0) || windowInMs <= 0 {
		return "", false
	}
	for _, rollingTime := range monitorStepsRollingTimes {
		if float64(rollingTime.minutes*60*1000) == windowInMs {
			return rollingTime.value, true
		}
	}
	return "", false
}

// monitorStepsReadISO8601Duration is the length an ISO 8601 duration says,
// in seconds, or false when the text is none.
func monitorStepsReadISO8601Duration(text string) (float64, bool) {
	match := monitorStepsISO8601Duration.FindStringSubmatchIndex(text)
	if match == nil {
		return 0, false
	}

	// Weeks, days, hours, minutes and seconds, in the order they are written.
	partUnits := []int64{
		monitorStepsUnitInSeconds["week"],
		monitorStepsUnitInSeconds["day"],
		monitorStepsUnitInSeconds["hour"],
		monitorStepsUnitInSeconds["minute"],
		monitorStepsUnitInSeconds["second"],
	}

	seconds := 0.0
	hasPart := false
	for index, unitInSeconds := range partUnits {
		start, end := match[2*(index+1)], match[2*(index+1)+1]
		if start < 0 {
			continue
		}
		part, err := strconv.ParseFloat(text[start:end], 64)
		if err != nil {
			return 0, false
		}
		hasPart = true
		seconds += part * float64(unitInSeconds)
	}

	// "P" or "PT" alone is no length, nor is a "T" with no time after it.
	hasTimePart := match[6] >= 0 || match[8] >= 0 || match[10] >= 0
	if !hasPart || (strings.Contains(text, "t") && !hasTimePart) {
		return 0, false
	}

	return seconds, true
}

// monitorStepsReadLengthInWords is the length written in words or short
// units, in seconds, or false when the text is none.
func monitorStepsReadLengthInWords(text string) (float64, bool) {
	match := monitorStepsLengthInWords.FindStringSubmatchIndex(text)
	if match == nil {
		return 0, false
	}

	hasLookBack := match[2] >= 0
	unit := text[match[6]:match[7]]

	unitInSeconds, ok := monitorStepsUnitInSeconds[unit]
	if !ok {
		return 0, false
	}

	if match[4] < 0 {
		// "past hour" is an hour; "hour" alone, or "past h", is not written
		// as a length.
		if hasLookBack && monitorStepsUnitsWithoutANumber[unit] {
			return float64(unitInSeconds), true
		}
		return 0, false
	}

	count, err := strconv.ParseFloat(text[match[4]:match[5]], 64)
	if err != nil {
		return 0, false
	}
	return count * float64(unitInSeconds), true
}

// monitorStepsUnreadableRollingTime is the server's refusal of the rolling
// time in a step's settings, keyed by apiKey
// (MonitorStepRollingTime.getUnreadableError), or false when the server reads
// it or the settings keep none.
func monitorStepsUnreadableRollingTime(apiKey string, settings interface{}) (string, bool) {
	object, ok := settings.(map[string]interface{})
	if !ok {
		return "", false
	}

	written, has := object["rollingTime"]
	// None at all reads as the default, as it always has.
	if !has || written == nil || written == "" {
		return "", false
	}

	if _, ok := monitorStepsReadRollingTime(written); ok {
		return "", false
	}

	return fmt.Sprintf(
		`%s.rollingTime %s is not a rolling time. Use one of %s - or a length exactly as long as one of them, such as "15 minutes", "1h" or "PT15M".`,
		apiKey,
		monitorStepsWrittenValueText(written),
		monitorStepsValuesText(monitorStepsRollingTimeValues()),
	), true
}

// ---------------------------------------------------------------------------
// A filter's metric aggregation and no-data policy
// ---------------------------------------------------------------------------

// The longest text read as a criteria value (MAX_VALUE_TEXT_LENGTH).
const monitorStepsMaxValueTextLength = 128

// monitorStepsValueSet is the values one field takes, and the names each is
// read by (CriteriaFilterValues.ts makeValueSet).
type monitorStepsValueSet struct {
	values []string
	// Each value by its letters and digits, and by each other name for it.
	byLetters map[string]string
	// The letters two values share: neither is guessed.
	ambiguous map[string]bool
	// Each value by a symbol written for it.
	bySymbol map[string]string
}

func newMonitorStepsValueSet(values []string, otherNames map[string]string, symbols map[string]string) monitorStepsValueSet {
	set := monitorStepsValueSet{
		values:    values,
		byLetters: map[string]string{},
		ambiguous: map[string]bool{},
		bySymbol:  map[string]string{},
	}
	add := func(name string, value string) {
		key := monitorStepsLettersAndDigits(name)
		if set.ambiguous[key] {
			return
		}
		if known, ok := set.byLetters[key]; ok && known != value {
			delete(set.byLetters, key)
			set.ambiguous[key] = true
			return
		}
		set.byLetters[key] = value
	}
	for _, value := range values {
		add(value, value)
	}
	for name, value := range otherNames {
		add(name, value)
	}
	for symbol, value := range symbols {
		set.bySymbol[symbol] = value
	}
	return set
}

// read is the value a written one means, as the server reads it
// (CriteriaFilterValues.ts readValue), or false when it means none.
func (set monitorStepsValueSet) read(value interface{}) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}

	for _, known := range set.values {
		if text == known {
			return text, true
		}
	}

	trimmed := strings.TrimFunc(text, jsIsWhitespace)
	length := jsLength(trimmed)
	if length == 0 || length > monitorStepsMaxValueTextLength {
		return "", false
	}

	// Spaces, underscores and dashes are no part of a symbol: "> =" is ">=".
	if symbol, ok := set.bySymbol[jsJoinSeparators(trimmed, "")]; ok {
		return symbol, true
	}

	key := monitorStepsLettersAndDigits(trimmed)
	if key == "" || set.ambiguous[key] {
		return "", false
	}
	known, ok := set.byLetters[key]
	return known, ok
}

// A filter's metric aggregation, as its metric_monitor_options and its
// evaluate-over-time options take it (EVALUATE_OVER_TIME_TYPES).
var monitorStepsEvaluateOverTimeTypesRead = newMonitorStepsValueSet(
	monitorStepsEvaluateOverTimeTypeValues,
	map[string]string{
		"avg":     "Average",
		"mean":    "Average",
		"max":     "Maximum Value",
		"maximum": "Maximum Value",
		"min":     "Minimum Value",
		"minimum": "Minimum Value",
		"any":     "Any Value",
		"all":     "All Values",
	},
	nil,
)

// A filter's no-data policy (NO_DATA_POLICIES).
var monitorStepsNoDataPoliciesRead = newMonitorStepsValueSet(monitorStepsNoDataPolicyValues, nil, nil)

// The values of a filter's metric_monitor_options that the server reads
// written another way, by their key.
var monitorStepsMetricMonitorOptionsRead = []struct {
	key string
	set monitorStepsValueSet
}{
	{"metricAggregationType", monitorStepsEvaluateOverTimeTypesRead},
	{"onNoDataPolicy", monitorStepsNoDataPoliciesRead},
}

// monitorStepsUnreadableCriteriaValue is the server's refusal of a value in a
// criteria's filter (CriteriaFilterValues.ts getUnreadableValueError), or
// false when the server reads it or it is not written at all.
func monitorStepsUnreadableCriteriaValue(set monitorStepsValueSet, value interface{}, at string, criteriaName string) (string, bool) {
	if value == nil || value == "" {
		return "", false
	}
	if _, ok := set.read(value); ok {
		return "", false
	}
	return fmt.Sprintf(
		"Criteria %s: %s %s is not a value OneUptime reads there. Use one of %s.",
		jsQuotedString(criteriaName, -1),
		at,
		monitorStepsWrittenValueText(value),
		monitorStepsValuesText(set.values),
	), true
}

// ---------------------------------------------------------------------------
// Steps read as the server stores them
// ---------------------------------------------------------------------------

/*
 * normalizeMonitorStepsValues reads a monitor's steps in their wire form
 * (MonitorStepsToAPI's, as plain JSON) as the server stores them: each value
 * written another way is the one it means, where the server reads it - the
 * rolling time of each step's settings (MonitorStep.fromJSON) and the
 * aggregation and no-data policy of each filter's metric options
 * (MonitorCriteriaInstance.fromJSON). A value that means none is left as it
 * is written, except in a step's metric settings, which the server stores
 * with the default rolling time when theirs reads as false in JavaScript
 * (null, "", 0 or false). It changes value in place and returns it.
 */
func normalizeMonitorStepsValues(value interface{}) interface{} {
	steps, _ := monitorStepsWireValue(value)["monitorStepsInstanceArray"].([]interface{})
	for _, rawStep := range steps {
		step := monitorStepsWireValue(rawStep)

		for _, settings := range monitorStepsRollingTimeSettings {
			object, ok := step[settings.apiKey].(map[string]interface{})
			if !ok {
				continue
			}
			written, has := object["rollingTime"]
			if !has {
				continue
			}
			if rollingTime, ok := monitorStepsReadRollingTime(written); ok {
				object["rollingTime"] = rollingTime
			} else if settings.apiKey == "metricMonitor" && jsIsFalsy(written) {
				object["rollingTime"] = monitorStepsDefaultRollingTime
			}
		}

		criteria := monitorStepsWireValue(step["monitorCriteria"])
		instances, _ := criteria["monitorCriteriaInstanceArray"].([]interface{})
		for _, rawInstance := range instances {
			filters, _ := monitorStepsWireValue(rawInstance)["filters"].([]interface{})
			for _, rawFilter := range filters {
				filter, _ := rawFilter.(map[string]interface{})
				options, ok := filter["metricMonitorOptions"].(map[string]interface{})
				if !ok {
					continue
				}
				for _, option := range monitorStepsMetricMonitorOptionsRead {
					if read, ok := option.set.read(options[option.key]); ok {
						options[option.key] = read
					}
				}
			}
		}
	}
	return value
}

// monitorStepsWireValue is the inside of a {_type, value} envelope, a map
// that is none as it is, and nil for anything else.
func monitorStepsWireValue(value interface{}) map[string]interface{} {
	object, ok := value.(map[string]interface{})
	if !ok {
		return nil
	}
	return monitorStepsAPIUnwrap(object)
}

// ---------------------------------------------------------------------------
// Validators: refused at plan time, as the server refuses them at apply
// ---------------------------------------------------------------------------

// monitorStepsRollingTimeValidator refuses a rolling time that means none, in
// the settings (apiKey) the monitor's own type reads - the root monitor_type
// attribute of the monitor or monitor template - with the server's words.
type monitorStepsRollingTimeValidator struct {
	apiKey      string
	monitorType string
}

var _ validator.String = monitorStepsRollingTimeValidator{}

func (v monitorStepsRollingTimeValidator) Description(ctx context.Context) string {
	return v.MarkdownDescription(ctx)
}

func (v monitorStepsRollingTimeValidator) MarkdownDescription(_ context.Context) string {
	return fmt.Sprintf("On a %s monitor, rollingTime must be a rolling time OneUptime reads.", v.monitorType)
}

func (v monitorStepsRollingTimeValidator) ValidateString(ctx context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	// JSON that is not an object is refused where the steps are written.
	var settings interface{}
	if json.Unmarshal([]byte(req.ConfigValue.ValueString()), &settings) != nil {
		return
	}

	message, unreadable := monitorStepsUnreadableRollingTime(v.apiKey, settings)
	if !unreadable {
		return
	}

	// Only the settings the monitor's own type reads: those are the ones its
	// checks use, and the only ones the server refuses.
	var monitorType types.String
	if diags := req.Config.GetAttribute(ctx, path.Root("monitor_type"), &monitorType); diags.HasError() {
		return
	}
	if monitorType.IsNull() || monitorType.IsUnknown() || monitorType.ValueString() != v.monitorType {
		return
	}

	resp.Diagnostics.AddAttributeError(req.Path, "Unreadable rolling time", message)
}

// monitorStepsMetricMonitorOptionsValidator refuses a filter's metric
// aggregation or no-data policy that means none of their values, as the
// server does on every monitor type, with the server's words.
type monitorStepsMetricMonitorOptionsValidator struct{}

var _ validator.String = monitorStepsMetricMonitorOptionsValidator{}

func (v monitorStepsMetricMonitorOptionsValidator) Description(ctx context.Context) string {
	return v.MarkdownDescription(ctx)
}

func (v monitorStepsMetricMonitorOptionsValidator) MarkdownDescription(_ context.Context) string {
	return "metricAggregationType and onNoDataPolicy must be values OneUptime reads."
}

func (v monitorStepsMetricMonitorOptionsValidator) ValidateString(ctx context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	var parsed interface{}
	if json.Unmarshal([]byte(req.ConfigValue.ValueString()), &parsed) != nil {
		return
	}
	options, ok := parsed.(map[string]interface{})
	if !ok {
		return
	}

	// The server names the criteria and the filter's place in it:
	// monitor_steps[0].criteria[1].filters[2].metric_monitor_options.
	filterPath := req.Path.ParentPath()
	at := "filters"
	if step, _ := filterPath.Steps().LastStep(); step != nil {
		if index, ok := step.(path.PathStepElementKeyInt); ok {
			at = fmt.Sprintf("filters[%d]", int64(index))
		}
	}
	criteriaName := ""
	var name types.String
	if diags := req.Config.GetAttribute(ctx, filterPath.ParentPath().ParentPath().AtName("name"), &name); !diags.HasError() && !name.IsNull() && !name.IsUnknown() {
		criteriaName = name.ValueString()
	}

	for _, option := range monitorStepsMetricMonitorOptionsRead {
		message, unreadable := monitorStepsUnreadableCriteriaValue(option.set, options[option.key], at+".metricMonitorOptions."+option.key, criteriaName)
		if unreadable {
			resp.Diagnostics.AddAttributeError(req.Path, "Unreadable metric_monitor_options value", message)
		}
	}
}

// monitorStepsSubConfigValidators are the validators of a step's raw JSON
// settings beyond their length: the rolling time, in the settings that keep
// one.
func monitorStepsSubConfigValidators(apiKey string) []validator.String {
	monitorType := monitorStepsRollingTimeMonitorType(apiKey)
	if monitorType == "" {
		return nil
	}
	return []validator.String{monitorStepsRollingTimeValidator{apiKey: apiKey, monitorType: monitorType}}
}

// ---------------------------------------------------------------------------
// Text as the server writes it
// ---------------------------------------------------------------------------

// The longest part of a written value an error quotes back
// (MAX_QUOTED_LENGTH).
const monitorStepsMaxQuotedLength = 64

// monitorStepsValuesText lists values, quoted, for a sentence: "A", "B" or
// "C" (RollingTimeUtil.getValuesText, CriteriaFilterValues.ts
// describeValues).
func monitorStepsValuesText(values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, `"`+value+`"`)
	}
	if len(quoted) <= 1 {
		return strings.Join(quoted, "")
	}
	return strings.Join(quoted[:len(quoted)-1], ", ") + " or " + quoted[len(quoted)-1]
}

// monitorStepsWrittenValueText is a written value as an error quotes it back
// (describeWrittenValue): a string in JSON quotes, cut after 64 characters; a
// number or a boolean as JavaScript writes it; a list or an object by kind.
func monitorStepsWrittenValueText(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return jsQuotedString(typed, monitorStepsMaxQuotedLength)
	case float64:
		return jsNumberText(typed)
	case bool:
		return strconv.FormatBool(typed)
	case []interface{}:
		return "a list"
	default:
		return "a value of type object"
	}
}

// ---------------------------------------------------------------------------
// JavaScript's string rules, which the server's readers follow
// ---------------------------------------------------------------------------

// jsIsWhitespace: a character JavaScript's trim() and \s take as white space
// (WhiteSpace and LineTerminator). Go's unicode.IsSpace differs: it takes
// U+0085 and not U+FEFF.
func jsIsWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
		return true
	}
	return r >= '\u2000' && r <= '\u200a'
}

// jsLength is a string's length as JavaScript counts it, in UTF-16 units.
func jsLength(text string) int {
	return len(utf16.Encode([]rune(text)))
}

// jsToLower is toLowerCase(): Go's simple mapping, but for the one letter
// JavaScript lowers to two characters, "İ" (U+0130), whose first is an "i".
func jsToLower(text string) string {
	return strings.ToLower(strings.ReplaceAll(text, "\u0130", "i\u0307"))
}

// jsJoinSeparators replaces each run of white space, underscores and dashes
// with joint (text.replace(/[\s_-]+/g, joint)).
func jsJoinSeparators(text string, joint string) string {
	var out strings.Builder
	inRun := false
	for _, r := range text {
		if jsIsWhitespace(r) || r == '_' || r == '-' {
			if !inRun {
				out.WriteString(joint)
			}
			inRun = true
			continue
		}
		inRun = false
		out.WriteRune(r)
	}
	return out.String()
}

// monitorStepsLettersAndDigits is a text's letters and digits, lower case:
// "Greater Than" is "greaterthan" (CriteriaFilterValues.ts
// lettersAndDigitsOf).
func monitorStepsLettersAndDigits(text string) string {
	var out strings.Builder
	for _, r := range jsToLower(text) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			out.WriteRune(r)
		}
	}
	return out.String()
}

// jsIsFalsy: a JSON value JavaScript reads as false.
func jsIsFalsy(value interface{}) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case bool:
		return !typed
	case string:
		return typed == ""
	case float64:
		return typed == 0 || math.IsNaN(typed)
	}
	return false
}

// jsQuotedString is JSON.stringify of a string, cut after maxUnits UTF-16
// units with "…" when longer (maxUnits < 0: never). JavaScript escapes only
// the quote, the backslash and control characters - Go's encoding/json also
// escapes <, >, & and U+2028/U+2029 - and a surrogate the cut leaves alone.
func jsQuotedString(text string, maxUnits int) string {
	units := utf16.Encode([]rune(text))
	cut := maxUnits >= 0 && len(units) > maxUnits
	if cut {
		units = units[:maxUnits]
	}

	var out strings.Builder
	out.WriteByte('"')
	for i := 0; i < len(units); i++ {
		unit := units[i]
		switch {
		case unit == '"':
			out.WriteString(`\"`)
		case unit == '\\':
			out.WriteString(`\\`)
		case unit == '\b':
			out.WriteString(`\b`)
		case unit == '\f':
			out.WriteString(`\f`)
		case unit == '\n':
			out.WriteString(`\n`)
		case unit == '\r':
			out.WriteString(`\r`)
		case unit == '\t':
			out.WriteString(`\t`)
		case unit < 0x20:
			fmt.Fprintf(&out, `\u%04x`, unit)
		case unit >= 0xd800 && unit < 0xdc00 && i+1 < len(units) && units[i+1] >= 0xdc00 && units[i+1] < 0xe000:
			out.WriteRune(utf16.DecodeRune(rune(unit), rune(units[i+1])))
			i++
		case unit >= 0xd800 && unit < 0xe000:
			fmt.Fprintf(&out, `\u%04x`, unit)
		default:
			out.WriteRune(rune(unit))
		}
	}
	if cut {
		out.WriteString("…")
	}
	out.WriteByte('"')
	return out.String()
}

// jsNumberText is a number as JavaScript writes it (Number.prototype.toString):
// "15", "1.5", "1e+21", "1e-7".
func jsNumberText(number float64) string {
	switch {
	case math.IsNaN(number):
		return "NaN"
	case math.IsInf(number, 1):
		return "Infinity"
	case math.IsInf(number, -1):
		return "-Infinity"
	case number == 0:
		return "0"
	}

	sign := ""
	if number < 0 {
		sign = "-"
		number = -number
	}

	// The shortest digits that read back as the number, and where the point
	// goes: digits × 10^(point - len(digits)).
	mantissa, exponent, _ := strings.Cut(strconv.FormatFloat(number, 'e', -1, 64), "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	power, _ := strconv.Atoi(exponent)
	point := power + 1
	count := len(digits)

	switch {
	case count <= point && point <= 21:
		return sign + digits + strings.Repeat("0", point-count)
	case 0 < point && point <= 21:
		return sign + digits[:point] + "." + digits[point:]
	case -6 < point && point <= 0:
		return sign + "0." + strings.Repeat("0", -point) + digits
	}

	exponentSign := "+"
	if point-1 < 0 {
		exponentSign = "-"
	}
	exponentText := strconv.Itoa(int(math.Abs(float64(point - 1))))
	if count == 1 {
		return sign + digits + "e" + exponentSign + exponentText
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + exponentSign + exponentText
}
