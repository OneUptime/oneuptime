package provider

/*
 * WHAT TERRAFORM CANNOT WRITE OF A MONITOR'S STEPS, KEPT AS ONEUPTIME HOLDS
 * IT (OneUptime/oneuptime#10984).
 *
 * An update that changes monitor_steps sends the whole steps, and OneUptime
 * replaces the steps it holds with them. Whatever the configuration can say
 * is the configuration's: a setting it leaves out is removed, as the plan
 * shows (#10907). A setting this provider has no attribute for can be
 * neither written nor shown in a plan, though, and every apply that changed
 * the steps used to remove it without a word: a setting a newer OneUptime
 * holds that this version of the provider does not know yet, or the carrier
 * of the retired SNMP monitor type (snmpMonitor) an old step may still hold.
 *
 * So before such an update the provider reads the steps OneUptime holds
 * (MonitorStepsHeld) and keeps every key of a step, a criteria, an incident
 * template and an alert template that it cannot read back: one
 * MonitorStepsFromAPI does not read, found by reading the held steps and
 * writing them again. Each is kept on the item that stands in for the one
 * it was on, matched as the server matches them to keep their ids
 * (MonitorStepsIdentityUtil): steps by position, criteria by a name and
 * templates by a title that each side holds once, then by position. The
 * ids themselves are the server's and are never sent.
 *
 * A filter has no id and no name: the server stores the filters sent, in
 * order. Every key OneUptime stores on one, its window and its server
 * options has an attribute, which monitorstepsunmanaged_test.go checks
 * against every key of OneUptime's own API schema
 * (testdata/monitor_steps_api_keys.json). A key a newer OneUptime adds there
 * is kept on the planned filter at the same place that checks the same
 * thing (checkOn), as are the more of its jsonencode() options.
 *
 * A setting written with jsonencode() - a step's dns_monitor or
 * metric_monitor, a criteria's incident_grouping, a filter's
 * metric_monitor_options - is compared by what it writes: OneUptime may hold
 * more in it, a default of its own or a key set in the Dashboard, and the
 * plan shows no change for that (jsonIsSubset). So the apply keeps that more
 * too (monitorStepsKeepUnwrittenJSON): each key OneUptime holds in it that
 * the plan does not write, unless the state the plan was made from wrote it
 * - then the configuration took the key out, and the plan shows it going.
 */

import (
	"context"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/types"
)

/*
 * Keys of a monitor's steps this provider has no attribute for, by where
 * they sit, and why: each one is decided here, and the guard test fails on
 * a key OneUptime adds until it is decided. None is removed by an apply that
 * changes the steps.
 */
var monitorStepsKeysWithoutAttribute = map[string]map[string]string{
	"steps": {
		"defaultMonitorStatusId": "OneUptime keeps the one it holds when a write sends none (MonitorStepsIdentityUtil.assignIds).",
	},
	"step": {
		"id":          "The server's: it matches each step to the one it stands in for.",
		"snmpMonitor": "Filled in by the server for the retired SNMP monitor type and Network Device monitor tests; never a setting. Kept as OneUptime holds it.",
	},
	"criteria": {
		"id": "The server's: it matches each criteria by name, then position.",
	},
	"incident": {
		"id": "The server's: it matches each template by title, then position.",
	},
	"alert": {
		"id": "The server's: it matches each template by title, then position.",
	},
}

// Keys never kept from what OneUptime holds: the server's own.
var monitorStepsNeverKept = map[string]bool{
	"id": true,
	// Filled in for a probe and never stored (MonitorStep.toDatabaseJSON).
	"totpSecrets":        true,
	"secretValuesToHide": true,
}

/*
 * MonitorStepsHeld is the steps OneUptime holds of a record now, read the
 * way the record is read back after a write: the read endpoint's answer to
 * a select of the one field.
 */
func MonitorStepsHeld(ctx context.Context, client *Client, readPath string, apiFieldName string) (interface{}, error) {
	httpResp, err := client.PostWithSelect(ctx, readPath, map[string]interface{}{apiFieldName: true})
	if err != nil {
		return nil, err
	}

	var read map[string]interface{}
	if err := client.ParseResponse(httpResp, &read); err != nil {
		return nil, err
	}

	record := read
	if wrapper, ok := read["data"].(map[string]interface{}); ok {
		record = wrapper
	}

	return record[apiFieldName], nil
}

/*
 * MonitorStepsKeepUnmanaged is the steps an update sends: the planned
 * steps (outgoing, as MonitorStepsToAPI writes them) with every key of what
 * OneUptime holds (held) that this provider cannot read back put on the
 * matched item, where the plan does not write it, and the more OneUptime
 * holds in a setting written with jsonencode() than the plan writes, where
 * the state the plan was made from (prior) does not write it either. The
 * planned steps as they are when there is nothing held, or when the held
 * steps cannot be read: then nothing can tell which of their keys the
 * provider reads.
 */
func MonitorStepsKeepUnmanaged(ctx context.Context, outgoing interface{}, prior types.List, held interface{}) interface{} {
	if outgoing == nil || held == nil {
		return outgoing
	}

	heldList, heldDiags := MonitorStepsFromAPI(ctx, held)
	if heldDiags.HasError() || heldList.IsNull() {
		return outgoing
	}

	// What the provider can say of the held steps: their keys it reads.
	readBack, readBackDiags := MonitorStepsToAPI(ctx, heldList)
	if readBackDiags.HasError() {
		return outgoing
	}

	outgoingPlain, outgoingErr := toPlainJSON(outgoing)
	heldPlain, heldErr := toPlainJSON(held)
	readBackPlain, readBackErr := toPlainJSON(readBack)
	if outgoingErr != nil || heldErr != nil || readBackErr != nil {
		return outgoing
	}

	// The state the plan was made from; none when there is none to read.
	var priorPlain interface{}
	if !prior.IsNull() && !prior.IsUnknown() {
		if priorSteps, priorDiags := MonitorStepsToAPI(ctx, prior); !priorDiags.HasError() && priorSteps != nil {
			priorPlain, _ = toPlainJSON(priorSteps)
		}
	}

	monitorStepsKeepUnreadSteps(outgoingPlain, priorPlain, heldPlain, readBackPlain)

	return outgoingPlain
}

/*
 * The item of the prior state that stands for held item j: the one at the
 * same place. A refresh leaves the state item for item what OneUptime holds
 * (MonitorStepsKeepWritten); a list of another length was not refreshed,
 * and stands for nothing.
 */
func monitorStepsPriorAt(prior []interface{}, held []interface{}, j int) map[string]interface{} {
	if len(prior) != len(held) || j < 0 || j >= len(prior) {
		return nil
	}
	return monitorStepsWireValue(prior[j])
}

// The items of a wrapped list: a step's steps, a step's criteria.
func monitorStepsItems(envelope interface{}, key string) []interface{} {
	value := monitorStepsWireValue(envelope)
	if value == nil {
		return nil
	}
	items, _ := value[key].([]interface{})
	return items
}

func monitorStepsKeepUnreadSteps(outgoing, prior, held, readBack interface{}) {
	outgoingSteps := monitorStepsItems(outgoing, "monitorStepsInstanceArray")
	priorSteps := monitorStepsItems(prior, "monitorStepsInstanceArray")
	heldSteps := monitorStepsItems(held, "monitorStepsInstanceArray")
	readBackSteps := monitorStepsItems(readBack, "monitorStepsInstanceArray")

	// A held step the provider could not read leaves no key to tell apart.
	if len(heldSteps) != len(readBackSteps) {
		return
	}

	matches := monitorStepsMatchStored(
		make([]string, len(outgoingSteps)),
		monitorStepsStoredItems(heldSteps, ""),
	)

	for i, j := range matches {
		if j < 0 {
			continue
		}

		outgoingStep := monitorStepsWireValue(outgoingSteps[i])
		heldStep := monitorStepsWireValue(heldSteps[j])
		readBackStep := monitorStepsWireValue(readBackSteps[j])
		if outgoingStep == nil || heldStep == nil || readBackStep == nil {
			continue
		}

		priorStep := monitorStepsPriorAt(priorSteps, heldSteps, j)

		monitorStepsKeepUnreadKeys(outgoingStep, heldStep, readBackStep)
		for _, sub := range monitorStepsSubConfigs {
			monitorStepsKeepUnwrittenJSONAt(outgoingStep, priorStep, heldStep, sub.apiKey, monitorStepsAtStep)
		}
		monitorStepsKeepUnreadCriteria(outgoingStep, priorStep, heldStep, readBackStep)
	}
}

func monitorStepsKeepUnreadCriteria(outgoingStep, priorStep, heldStep, readBackStep map[string]interface{}) {
	outgoingCriteria := monitorStepsItems(outgoingStep["monitorCriteria"], "monitorCriteriaInstanceArray")
	priorCriteria := monitorStepsItems(priorStep["monitorCriteria"], "monitorCriteriaInstanceArray")
	heldCriteria := monitorStepsItems(heldStep["monitorCriteria"], "monitorCriteriaInstanceArray")
	readBackCriteria := monitorStepsItems(readBackStep["monitorCriteria"], "monitorCriteriaInstanceArray")

	if len(heldCriteria) != len(readBackCriteria) {
		return
	}

	matches := monitorStepsMatchStored(
		monitorStepsNames(outgoingCriteria, "name"),
		monitorStepsStoredItems(heldCriteria, "name"),
	)

	for i, j := range matches {
		if j < 0 {
			continue
		}

		outgoingOne := monitorStepsWireValue(outgoingCriteria[i])
		heldOne := monitorStepsWireValue(heldCriteria[j])
		readBackOne := monitorStepsWireValue(readBackCriteria[j])
		if outgoingOne == nil || heldOne == nil || readBackOne == nil {
			continue
		}

		priorOne := monitorStepsPriorAt(priorCriteria, heldCriteria, j)

		monitorStepsKeepUnreadKeys(outgoingOne, heldOne, readBackOne)
		monitorStepsKeepUnwrittenJSONAt(outgoingOne, priorOne, heldOne, "incidentGrouping", monitorStepsAtCriteria)
		for _, key := range []string{"filters", "recoveryFilters"} {
			monitorStepsKeepHeldFilterSettings(outgoingOne, priorOne, heldOne, readBackOne, key)
		}

		for _, key := range []string{"incidents", "alerts"} {
			monitorStepsKeepUnreadTemplates(outgoingOne, heldOne, readBackOne, key)
		}
	}
}

// The settings of a filter written with jsonencode().
var monitorStepsFilterJSONKeys = []string{"metricMonitorOptions", "snmpMonitorOptions", "databaseMonitorOptions", "customCodeMonitorOptions"}

// The objects of a filter the provider writes attribute by attribute.
var monitorStepsFilterObjectKeys = []string{"evaluateOverTimeOptions", "serverMonitorOptions"}

/*
 * A criteria's filters have no id: the server stores the ones sent, in
 * order. A planned filter stands for the held one at its place that checks
 * the same thing (checkOn), and for the prior one at that place, when the
 * prior criteria has as many. It keeps what that one holds that the
 * provider cannot read back, on it and on its window and server options,
 * and the more of its jsonencode() options.
 */
func monitorStepsKeepHeldFilterSettings(outgoingCriteria, priorCriteria, heldCriteria, readBackCriteria map[string]interface{}, key string) {
	outgoingFilters, _ := outgoingCriteria[key].([]interface{})
	heldFilters, _ := heldCriteria[key].([]interface{})
	priorFilters, _ := priorCriteria[key].([]interface{})
	readBackFilters, _ := readBackCriteria[key].([]interface{})

	for i, raw := range outgoingFilters {
		if i >= len(heldFilters) {
			break
		}
		filter, _ := raw.(map[string]interface{})
		heldFilter, _ := heldFilters[i].(map[string]interface{})
		if filter == nil || heldFilter == nil || filter["checkOn"] != heldFilter["checkOn"] {
			continue
		}
		var priorFilter map[string]interface{}
		if len(priorFilters) == len(heldFilters) {
			priorFilter, _ = priorFilters[i].(map[string]interface{})
		}
		for _, optionKey := range monitorStepsFilterJSONKeys {
			monitorStepsKeepUnwrittenJSONAt(filter, priorFilter, heldFilter, optionKey, monitorStepsAtFilter)
		}

		// What the provider cannot read back: only when the held filters read back one for one.
		if len(readBackFilters) != len(heldFilters) {
			continue
		}
		readBackFilter, _ := readBackFilters[i].(map[string]interface{})
		if readBackFilter == nil {
			continue
		}
		monitorStepsKeepUnreadKeys(filter, heldFilter, readBackFilter)
		for _, objectKey := range monitorStepsFilterObjectKeys {
			object, _ := filter[objectKey].(map[string]interface{})
			heldObject, _ := heldFilter[objectKey].(map[string]interface{})
			readBackObject, _ := readBackFilter[objectKey].(map[string]interface{})
			if object != nil && heldObject != nil && readBackObject != nil {
				monitorStepsKeepUnreadKeys(object, heldObject, readBackObject)
			}
		}
	}
}

/*
 * monitorStepsKeepUnwrittenJSONAt keeps what OneUptime holds of the setting
 * at key of an item (one written with jsonencode()) that the plan shows no
 * change for: inside it, the keys the plan does not write
 * (monitorStepsKeepUnwrittenJSON); and the whole setting when the plan does
 * not write it, where that is no change (monitorStepsIsUnset: a step's
 * sub-config) and the prior item does not write it either.
 */
func monitorStepsKeepUnwrittenJSONAt(outgoing, prior, held map[string]interface{}, key string, level monitorStepsLevel) {
	heldValue, holds := held[key]
	if !holds {
		return
	}

	plannedValue, plans := outgoing[key]
	if !plans {
		if _, priorWrites := prior[key]; !priorWrites && monitorStepsIsUnset(level, key, heldValue, held) {
			outgoing[key] = heldValue
		}
		return
	}

	outgoing[key] = monitorStepsKeepUnwrittenJSON(plannedValue, prior[key], heldValue)
}

/*
 * monitorStepsKeepUnwrittenJSON is the planned JSON with each key the held
 * JSON has, and neither the planned nor the prior JSON writes, put back in
 * it: in an object at any depth, and in the items of a list that has as
 * many on both sides, item by item, as jsonIsSubset compares them. A key
 * the prior JSON writes and the planned one does not is one the
 * configuration took out: it stays out.
 */
func monitorStepsKeepUnwrittenJSON(planned, prior, held interface{}) interface{} {
	switch p := planned.(type) {
	case map[string]interface{}:
		h, ok := held.(map[string]interface{})
		if !ok {
			return planned
		}
		priorMap, _ := prior.(map[string]interface{})
		for key, heldValue := range h {
			plannedValue, plans := p[key]
			if !plans {
				if _, priorWrites := priorMap[key]; !priorWrites {
					p[key] = heldValue
				}
				continue
			}
			p[key] = monitorStepsKeepUnwrittenJSON(plannedValue, priorMap[key], heldValue)
		}
		return p
	case []interface{}:
		h, ok := held.([]interface{})
		if !ok || len(h) != len(p) {
			return planned
		}
		priorList, _ := prior.([]interface{})
		for i := range p {
			var priorItem interface{}
			if len(priorList) == len(p) {
				priorItem = priorList[i]
			}
			p[i] = monitorStepsKeepUnwrittenJSON(p[i], priorItem, h[i])
		}
		return p
	default:
		return planned
	}
}

func monitorStepsKeepUnreadTemplates(outgoingCriteria, heldCriteria, readBackCriteria map[string]interface{}, key string) {
	outgoingTemplates, _ := outgoingCriteria[key].([]interface{})
	heldTemplates, _ := heldCriteria[key].([]interface{})
	readBackTemplates, _ := readBackCriteria[key].([]interface{})

	if len(heldTemplates) != len(readBackTemplates) {
		return
	}

	matches := monitorStepsMatchStored(
		monitorStepsNames(outgoingTemplates, "title"),
		monitorStepsStoredItems(heldTemplates, "title"),
	)

	for i, j := range matches {
		if j < 0 {
			continue
		}

		outgoingOne := monitorStepsWireValue(outgoingTemplates[i])
		heldOne := monitorStepsWireValue(heldTemplates[j])
		readBackOne := monitorStepsWireValue(readBackTemplates[j])
		if outgoingOne == nil || heldOne == nil || readBackOne == nil {
			continue
		}

		monitorStepsKeepUnreadKeys(outgoingOne, heldOne, readBackOne)
	}
}

/*
 * monitorStepsKeepUnreadKeys puts on the outgoing item each key of the held
 * item that the provider does not read back and the outgoing item does not
 * write: as OneUptime holds it.
 */
func monitorStepsKeepUnreadKeys(outgoing, held, readBack map[string]interface{}) {
	for key, value := range held {
		if monitorStepsNeverKept[key] {
			continue
		}
		if _, read := readBack[key]; read {
			continue
		}
		if _, written := outgoing[key]; written {
			continue
		}
		outgoing[key] = value
	}
}

// Each item's name or title, as the server reads one to match by.
func monitorStepsNames(items []interface{}, nameKey string) []string {
	names := make([]string, len(items))
	if nameKey == "" {
		return names
	}
	for i, item := range items {
		if value := monitorStepsWireValue(item); value != nil {
			names[i], _ = value[nameKey].(string)
		}
	}
	return names
}

// A stored item as the server matches against it: its id, and its name.
type monitorStepsStoredItem struct {
	id   string
	name string
}

func monitorStepsStoredItems(items []interface{}, nameKey string) []monitorStepsStoredItem {
	stored := make([]monitorStepsStoredItem, len(items))
	for i, item := range items {
		value := monitorStepsWireValue(item)
		if value == nil {
			continue
		}
		stored[i].id, _ = value["id"].(string)
		if nameKey != "" {
			stored[i].name, _ = value[nameKey].(string)
		}
	}
	return stored
}

/*
 * monitorStepsMatchStored is, for each incoming item, the index of the
 * stored item whose id the server gives it, or -1 for one that gets a new
 * id: MonitorStepsIdentityUtil.resolveIds for items sent without ids, as
 * this provider sends them. By a name - trimmed, and none when empty - that
 * one incoming item and one stored item hold, then by position; a stored
 * item, or an id, is taken once, and one with no id is never taken.
 */
func monitorStepsMatchStored(incoming []string, stored []monitorStepsStoredItem) []int {
	result := make([]int, len(incoming))
	for i := range result {
		result[i] = -1
	}

	usedIDs := map[string]bool{}
	isAvailable := func(index int) bool {
		return index < len(stored) && stored[index].id != "" && !usedIDs[stored[index].id]
	}

	pendingByName := map[string][]int{}
	nameOrder := []string{}
	for i, name := range incoming {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		if _, seen := pendingByName[trimmed]; !seen {
			nameOrder = append(nameOrder, trimmed)
		}
		pendingByName[trimmed] = append(pendingByName[trimmed], i)
	}

	for _, name := range nameOrder {
		indexes := pendingByName[name]
		if len(indexes) != 1 {
			continue
		}

		storedIndexes := []int{}
		for j, item := range stored {
			if strings.TrimSpace(item.name) == name {
				storedIndexes = append(storedIndexes, j)
			}
		}

		if len(storedIndexes) != 1 || !isAvailable(storedIndexes[0]) {
			continue
		}

		result[indexes[0]] = storedIndexes[0]
		usedIDs[stored[storedIndexes[0]].id] = true
	}

	for i := range incoming {
		if result[i] == -1 && isAvailable(i) {
			result[i] = i
			usedIDs[stored[i].id] = true
		}
	}

	return result
}
