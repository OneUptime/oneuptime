package provider

/*
 * WHAT ONEUPTIME HOLDS OF A MONITOR'S STEPS BEYOND WHAT TERRAFORM WROTE
 * (OneUptime/oneuptime#10907).
 *
 * A monitor's steps come back from OneUptime fuller than a configuration
 * writes them: a criteria's flags written out (is_enabled = true,
 * create_incidents = false), a step's request_type as GET, a recovery
 * condition's All. None of that is a change - OneUptime writes it whenever a
 * setting is left out, or reads its absence the same way - and a plan that
 * showed it after every apply would be noise.
 *
 * monitor_steps used to tell the two apart by subset: whatever the state
 * held, if OneUptime held it too, the steps were the same. That also passed
 * a setting someone added in the Dashboard to a criteria Terraform wrote -
 * active hours, a recovery condition, an incident template - so a refresh
 * kept the old state, the plan showed no change, and the next apply that
 * wrote the steps removed the setting with nothing in the plan saying so.
 *
 * So a key OneUptime holds and Terraform did not write is no change only
 * when its value is what the setting is when it is not set: what OneUptime
 * writes for it, or reads its absence as (monitorStepsUnsetValues). Anything
 * else is a setting of its own, and the steps differ:
 *
 *   - on a refresh the state takes OneUptime's steps, and the plan shows the
 *     setting going (an apply then removes it, as the plan says), until the
 *     configuration writes it too;
 *   - right after an import the plan shows it the same way, rather than
 *     keeping it until some later apply removes it unannounced;
 *   - after an apply, OneUptime's own defaults still read as the planned
 *     steps, so an apply never fails as "Provider produced inconsistent
 *     result after apply".
 *
 * What a step's escape hatches hold - a type-specific sub-config written
 * with jsonencode(), a filter's metric, SNMP, database or custom code
 * options, a criteria's incident grouping - is kept as the user wrote it,
 * and OneUptime may fill keys in inside it: those are compared by subset, as
 * before. A sub-config the configuration does not write at all is
 * OneUptime's: it hydrates some of them itself.
 *
 * And the state keeps no default it does not need (MonitorStepsKeepWritten):
 * OneUptime's own defaults that the prior value leaves out are left out of
 * what a read or an apply puts in state, so a plan of a setting added in the
 * Dashboard shows that setting, not every default beside it.
 */

import (
	"context"
	"reflect"

	"github.com/hashicorp/terraform-plugin-framework/types"
)

// Where in a monitor's steps, as the API takes them, a value sits.
type monitorStepsLevel int

const (
	// {_type: "MonitorSteps", value: {...}} and its value.
	monitorStepsAtEnvelope monitorStepsLevel = iota
	monitorStepsAtEnvelopeValue
	// {_type: "MonitorStep", value: {...}}, and a step.
	monitorStepsAtStepWrapper
	monitorStepsAtStep
	// {_type: "MonitorCriteria", value: {...}} and its value.
	monitorStepsAtCriteriaEnvelope
	monitorStepsAtCriteriaEnvelopeValue
	// {_type: "MonitorCriteriaInstance", value: {...}}, and a criteria.
	monitorStepsAtCriteriaWrapper
	monitorStepsAtCriteria
	// A filter, or a recovery filter, and its window.
	monitorStepsAtFilter
	monitorStepsAtWindow
	// A criteria's incident and alert templates.
	monitorStepsAtIncident
	monitorStepsAtAlert
	// Compared whole: a destination, a port, headers, active hours, a list of ids.
	monitorStepsAtWhole
	// An escape hatch written with jsonencode(): compared by subset.
	monitorStepsAtRaw
)

/*
 * What each setting is when it is not set, by where it sits: the value
 * OneUptime writes for it when a write leaves it out, or reads its absence
 * as (Common/Types/Monitor MonitorStep, MonitorCriteriaInstance,
 * CriteriaFilter; MonitorIncident and MonitorAlert for a template's flags).
 * Numbers as encoding/json reads them, float64.
 */
var monitorStepsUnsetValues = map[monitorStepsLevel]map[string]interface{}{
	monitorStepsAtStep: {
		// MonitorStep.fromJSON writes GET when none is sent.
		"requestType": "GET",
		// Read as off when absent.
		"doNotFollowRedirects":        false,
		"allowSelfSignedCertificates": false,
		// A body with no format is JSON (MonitorRequestBodyFormatUtil).
		"requestBodyFormat": "json",
	},
	monitorStepsAtCriteria: {
		// MonitorCriteriaInstance.fromJSON writes these when none is sent.
		"changeMonitorStatus": false,
		"createIncidents":     false,
		"createAlerts":        false,
		"isEnabled":           true,
		// And All for a recovery condition written without one.
		"recoveryFilterCondition": "All",
		// Only true turns it on.
		"openForEveryEmail": false,
	},
	monitorStepsAtFilter: {
		"evaluateOverTime": false,
	},
	monitorStepsAtWindow: {
		// CriteriaFilterUtil's reading of a window with these left out.
		"onNoDataPolicy":  "Ignore",
		"percentile":      float64(95),
		"countFilterType": "Greater Than",
		"countValue":      float64(0),
		"changeType":      "Amount",
		"changeValue":     float64(0),
	},
	monitorStepsAtIncident: {
		// An incident is opened public, shown on status pages, and left open.
		"isPrivate":                false,
		"showIncidentOnStatusPage": true,
		"autoResolveIncident":      false,
	},
	monitorStepsAtAlert: {
		"isPrivate":        false,
		"autoResolveAlert": false,
	},
}

// The level a key's value sits at, under a value at this level.
func monitorStepsChildLevel(level monitorStepsLevel, key string) monitorStepsLevel {
	switch level {
	case monitorStepsAtEnvelope:
		if key == "value" {
			return monitorStepsAtEnvelopeValue
		}
	case monitorStepsAtEnvelopeValue:
		if key == "monitorStepsInstanceArray" {
			return monitorStepsAtStepWrapper
		}
	case monitorStepsAtStepWrapper:
		if key == "value" {
			return monitorStepsAtStep
		}
	case monitorStepsAtStep:
		if key == "monitorCriteria" {
			return monitorStepsAtCriteriaEnvelope
		}
		if monitorStepsIsSubConfigKey(key) {
			return monitorStepsAtRaw
		}
	case monitorStepsAtCriteriaEnvelope:
		if key == "value" {
			return monitorStepsAtCriteriaEnvelopeValue
		}
	case monitorStepsAtCriteriaEnvelopeValue:
		if key == "monitorCriteriaInstanceArray" {
			return monitorStepsAtCriteriaWrapper
		}
	case monitorStepsAtCriteriaWrapper:
		if key == "value" {
			return monitorStepsAtCriteria
		}
	case monitorStepsAtCriteria:
		switch key {
		case "filters", "recoveryFilters":
			return monitorStepsAtFilter
		case "incidents":
			return monitorStepsAtIncident
		case "alerts":
			return monitorStepsAtAlert
		case "incidentGrouping":
			return monitorStepsAtRaw
		}
	case monitorStepsAtFilter:
		switch key {
		case "evaluateOverTimeOptions":
			return monitorStepsAtWindow
		case "metricMonitorOptions", "snmpMonitorOptions", "databaseMonitorOptions", "customCodeMonitorOptions":
			return monitorStepsAtRaw
		}
	case monitorStepsAtRaw:
		return monitorStepsAtRaw
	}
	return monitorStepsAtWhole
}

// A step's type-specific sub-config, written with jsonencode().
func monitorStepsIsSubConfigKey(key string) bool {
	for _, sub := range monitorStepsSubConfigs {
		if sub.apiKey == key {
			return true
		}
	}
	return false
}

/*
 * Whether a key OneUptime holds and the configuration does not write means
 * nothing the configuration does not say: the setting's unset value, a
 * sub-config OneUptime may hydrate, or the options of a window that is off.
 */
func monitorStepsIsUnset(level monitorStepsLevel, key string, value interface{}, held map[string]interface{}) bool {
	if level == monitorStepsAtStep && monitorStepsIsSubConfigKey(key) {
		return true
	}

	// A window's options say nothing while the window is off.
	if level == monitorStepsAtFilter && key == "evaluateOverTimeOptions" {
		if on, _ := held["evaluateOverTime"].(bool); !on {
			return true
		}
	}

	unset, ok := monitorStepsUnsetValues[level][key]
	return ok && reflect.DeepEqual(unset, value)
}

/*
 * monitorStepsHoldsOnlyWhatIsWritten: OneUptime's steps (held) say what the
 * written ones say - every key written is held with the same value, and
 * every key held but not written is one the setting holds when it is not
 * set. Both as the API takes them, read as plain JSON and normalized the
 * same way (normalizeURLWrapperLeaves, normalizeMonitorStepsValues). Lists
 * are compared position by position, and have the same length.
 */
func monitorStepsHoldsOnlyWhatIsWritten(written, held interface{}) bool {
	return monitorStepsHoldsOnlyWhatIsWrittenAt(written, held, monitorStepsAtEnvelope)
}

func monitorStepsHoldsOnlyWhatIsWrittenAt(written, held interface{}, level monitorStepsLevel) bool {
	if level == monitorStepsAtRaw {
		return jsonIsSubset(written, held)
	}

	switch w := written.(type) {
	case map[string]interface{}:
		h, ok := held.(map[string]interface{})
		if !ok {
			return false
		}
		for key, writtenValue := range w {
			heldValue, exists := h[key]
			if !exists {
				return false
			}
			if !monitorStepsHoldsOnlyWhatIsWrittenAt(writtenValue, heldValue, monitorStepsChildLevel(level, key)) {
				return false
			}
		}
		for key, heldValue := range h {
			if _, isWritten := w[key]; isWritten {
				continue
			}
			if !monitorStepsIsUnset(level, key, heldValue, h) {
				return false
			}
		}
		return true
	case []interface{}:
		h, ok := held.([]interface{})
		if !ok || len(w) != len(h) {
			return false
		}
		for i := range w {
			if !monitorStepsHoldsOnlyWhatIsWrittenAt(w[i], h[i], level) {
				return false
			}
		}
		return true
	case string:
		h, ok := held.(string)
		return ok && (w == h || sameInstant(w, h))
	default:
		return reflect.DeepEqual(written, held)
	}
}

/*
 * monitorStepsWithoutUnsetValues: the steps OneUptime holds (held, as plain
 * JSON), less every key the written steps do not write that means nothing
 * they do not say (monitorStepsIsUnset) - what the comparison above lets
 * pass, so the two never disagree. Lists the two do not hold as many items
 * of are kept whole: what OneUptime added or removed is shown as it is.
 */
func monitorStepsWithoutUnsetValues(written, held interface{}) interface{} {
	return monitorStepsWithoutUnsetValuesAt(written, held, monitorStepsAtEnvelope)
}

func monitorStepsWithoutUnsetValuesAt(written, held interface{}, level monitorStepsLevel) interface{} {
	if level == monitorStepsAtRaw || level == monitorStepsAtWhole {
		return held
	}

	switch h := held.(type) {
	case map[string]interface{}:
		w, ok := written.(map[string]interface{})
		if !ok {
			return held
		}
		out := make(map[string]interface{}, len(h))
		for key, heldValue := range h {
			writtenValue, isWritten := w[key]
			if !isWritten {
				if !monitorStepsIsUnset(level, key, heldValue, h) {
					out[key] = heldValue
				}
				continue
			}
			out[key] = monitorStepsWithoutUnsetValuesAt(writtenValue, heldValue, monitorStepsChildLevel(level, key))
		}
		return out
	case []interface{}:
		w, ok := written.([]interface{})
		if !ok || len(w) != len(h) {
			return held
		}
		out := make([]interface{}, len(h))
		for i := range h {
			out[i] = monitorStepsWithoutUnsetValuesAt(w[i], h[i], level)
		}
		return out
	default:
		return held
	}
}

/*
 * MonitorStepsKeepWritten is the steps a read or an apply puts in state:
 * OneUptime's (held), less the unset values the prior steps (the state a
 * read refreshes, the plan an apply carries out) do not write. With nothing
 * else held, that is the prior steps; with a setting added in the
 * Dashboard, the prior steps and that setting - which the plan then shows.
 * The steps OneUptime holds as they are when there are no prior steps (an
 * import), or when either side cannot be read.
 */
func MonitorStepsKeepWritten(ctx context.Context, prior types.List, held types.List) types.List {
	if prior.IsNull() || prior.IsUnknown() || held.IsNull() || held.IsUnknown() {
		return held
	}

	priorSteps, priorDiags := MonitorStepsToAPI(ctx, prior)
	heldSteps, heldDiags := MonitorStepsToAPI(ctx, held)
	if priorDiags.HasError() || heldDiags.HasError() || priorSteps == nil || heldSteps == nil {
		return held
	}

	priorPlain, priorErr := toPlainJSON(priorSteps)
	heldPlain, heldErr := toPlainJSON(heldSteps)
	if priorErr != nil || heldErr != nil {
		return held
	}

	kept, keptDiags := MonitorStepsFromAPI(ctx, monitorStepsWithoutUnsetValues(priorPlain, heldPlain))
	if keptDiags.HasError() || kept.IsNull() {
		return held
	}

	// Kept only when it still says what OneUptime holds.
	keptSteps, keptStepsDiags := MonitorStepsToAPI(ctx, kept)
	keptPlain, keptErr := toPlainJSON(keptSteps)
	if keptStepsDiags.HasError() || keptErr != nil || !monitorStepsHoldsOnlyWhatIsWritten(keptPlain, heldPlain) {
		return held
	}

	return kept
}
