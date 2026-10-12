package provider

// Numbers as the OneUptime API answers them.
//
// A number attribute reaches the provider in more than one shape:
//
//   - a JSON number, 99.65, which encoding/json decodes as a float64;
//   - numeric text, "99.65" or "100.00". Postgres keeps a decimal column as
//     numeric and hands it back as text, and OneUptime servers before the
//     fix for issue #4719 answered that text as it was, for a field their
//     OpenAPI spec calls a number;
//   - either of those inside a {"_type": ..., "value": ...} wrapper.
//
// Every shape reads as the number it spells. Text used to read as null, so a
// status page bar color rule's uptime_percent_greater_than_or_equal_to came
// back null after every create and update, and Terraform failed the apply
// with "Provider produced inconsistent result after apply" (#4719).
//
// Numbers are read at the precision Terraform reads the numbers in a
// configuration with, so 99.65 written in a configuration and 99.65 or
// "99.65" answered by the API are exactly the same number - in the plan, in
// the state, and in every comparison Terraform or the framework makes.

import (
	"encoding/json"
	"math"
	"math/big"
	"strconv"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/types"
)

// apiNumberPrecision is the precision, in bits, Terraform parses the numbers
// of a configuration with (cty.ParseNumberVal).
const apiNumberPrecision = 512

// numberFromAPI is the value a number attribute takes from what the API
// answered for it.
//
// previous is the value the attribute held before the answer: the planned
// value in Create and Update, the prior state in Read, the configured lookup
// argument in a data source. When the API answered the same number, previous
// is kept as it is: a configuration can hold more digits than the API keeps
// (100 * (1 - 1 / 1440) has hundreds of them), and the API answering the
// nearest number it can keep is not a change.
//
// Anything that spells no number - a missing field, null, text like "abc" -
// reads as null: never unknown, so an apply can complete.
func numberFromAPI(previous types.Number, value interface{}) types.Number {
	number, ok := parseAPINumber(value)
	if !ok {
		return types.NumberNull()
	}

	if !previous.IsNull() && !previous.IsUnknown() && previous.ValueBigFloat() != nil &&
		sameAPINumber(previous.ValueBigFloat(), number) {
		return previous
	}

	return types.NumberValue(number)
}

// parseAPINumber reads a number the API answered, in any of the shapes it
// answers numbers in. ok is false when the value spells no finite number.
func parseAPINumber(value interface{}) (number *big.Float, ok bool) {
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, false
		}
		// The shortest text that is this float64, read the way a
		// configuration's 99.65 is read: the same number, exactly.
		return parseAPINumberText(strconv.FormatFloat(v, 'g', -1, 64))
	case float32:
		return parseAPINumber(float64(v))
	case int:
		return newAPINumber().SetInt64(int64(v)), true
	case int64:
		return newAPINumber().SetInt64(v), true
	case json.Number:
		return parseAPINumberText(v.String())
	case string:
		return parseAPINumberText(v)
	case map[string]interface{}:
		// {"_type": "Decimal", "value": "99.65"}: the number is the value,
		// one level deep.
		inner, hasValue := v["value"]
		if !hasValue {
			return nil, false
		}
		if _, nested := inner.(map[string]interface{}); nested {
			return nil, false
		}
		return parseAPINumber(inner)
	default:
		return nil, false
	}
}

// parseAPINumberText reads numeric text: "99.65", "100.00", "-12.5",
// "3e-07". Surrounding spaces are allowed; anything else that is not a
// finite decimal number - "", "abc", "NaN", "Infinity", "0x10" - is not.
func parseAPINumberText(text string) (*big.Float, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, false
	}

	number, _, err := big.ParseFloat(text, 10, apiNumberPrecision, big.ToNearestEven)
	if err != nil || number.IsInf() {
		return nil, false
	}

	// -0 is 0.
	if number.Sign() == 0 {
		return newAPINumber(), true
	}

	return number, true
}

// sameAPINumber says whether two numbers are the same number to the API:
// equal, or the same once rounded to the 64-bit float the API keeps a
// number as.
func sameAPINumber(a *big.Float, b *big.Float) bool {
	if a.Cmp(b) == 0 {
		return true
	}

	aFloat, _ := a.Float64()
	bFloat, _ := b.Float64()
	if math.IsInf(aFloat, 0) || math.IsInf(bFloat, 0) {
		// Beyond what a float can hold, rounding says nothing.
		return false
	}

	return aFloat == bFloat
}

func newAPINumber() *big.Float {
	return new(big.Float).SetPrec(apiNumberPrecision)
}
