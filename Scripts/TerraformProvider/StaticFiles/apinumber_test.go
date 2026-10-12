package provider

/*
 * numberFromAPI, the one way the provider reads a number the API answered.
 *
 * WHAT THIS FILE PINS
 *
 * Issue #4719: a status page bar color rule's uptime percent is a decimal
 * column, which Postgres hands back as text, and OneUptime servers answered
 * it as text - "uptimePercentGreaterThanOrEqualTo": "100". The provider read
 * only JSON numbers, so the text read as null, and Terraform failed every
 * apply of the rule:
 *
 *   Provider produced inconsistent result after apply
 *   .uptime_percent_greater_than_or_equal_to: was cty.NumberIntVal(100), but now null.
 *
 * So every test here checks what Terraform itself would check. A
 * configuration's number reaches the provider over the plugin protocol in
 * msgpack, read at 512 bits (plannedNumber); the provider's answer goes back
 * the same way (sentToTerraform); and Terraform calls the two the same when
 * they print the same (terraformNumbersEqual, cty's rule). The tests ask for
 * more than that rule, though: the number the provider answers must be
 * exactly the one Terraform planned, so no comparison anywhere - the
 * framework's, a plan modifier's, Terraform's - can tell them apart.
 */

import (
	"context"
	"encoding/json"
	"math"
	"math/big"
	"strconv"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// configNumber is a configuration's number as Terraform reads it
// (cty.ParseNumberVal): 512 bits, rounded to nearest even.
func configNumber(t *testing.T, text string) *big.Float {
	t.Helper()
	number, _, err := big.ParseFloat(text, 10, 512, big.ToNearestEven)
	if err != nil {
		t.Fatalf("%q is not a number: %s", text, err)
	}
	return number
}

// overTheWire sends a number across the plugin protocol and reads it back,
// as both ends do: msgpack, which carries it as an integer when it is one,
// as a float64 when that holds it exactly, and as its text otherwise.
func overTheWire(t *testing.T, number *big.Float) *big.Float {
	t.Helper()
	wire, err := tfprotov6.NewDynamicValue(tftypes.Number, tftypes.NewValue(tftypes.Number, number))
	if err != nil {
		t.Fatalf("encoding %s: %s", number.Text('f', -1), err)
	}
	received, err := wire.Unmarshal(tftypes.Number)
	if err != nil {
		t.Fatalf("decoding %s: %s", number.Text('f', -1), err)
	}
	var decoded big.Float
	if err := received.As(&decoded); err != nil {
		t.Fatalf("reading %s: %s", number.Text('f', -1), err)
	}
	return &decoded
}

// plannedNumber is a configuration's number as the provider receives it in
// a plan.
func plannedNumber(t *testing.T, text string) types.Number {
	t.Helper()
	return types.NumberValue(overTheWire(t, configNumber(t, text)))
}

// sentToTerraform is the number Terraform receives for the provider's value.
func sentToTerraform(t *testing.T, value types.Number) *big.Float {
	t.Helper()
	terraformValue, err := value.ToTerraformValue(context.Background())
	if err != nil {
		t.Fatalf("converting %s: %s", value, err)
	}
	var number big.Float
	if err := terraformValue.As(&number); err != nil {
		t.Fatalf("reading %s: %s", value, err)
	}
	return overTheWire(t, &number)
}

// terraformNumbersEqual is how Terraform compares two numbers when it checks
// an apply's result against its plan (cty's Value.Equals): the same when
// they print the same, -0 and 0 alike.
func terraformNumbersEqual(a *big.Float, b *big.Float) bool {
	text := func(number *big.Float) string {
		printed := number.Text('f', -1)
		if printed == "-0" {
			return "0"
		}
		return printed
	}
	return text(a) == text(b)
}

// jsonNumber is what encoding/json makes of a number in a response body -
// what the provider's client hands the generated code.
func jsonNumber(t *testing.T, raw string) interface{} {
	t.Helper()
	var decoded map[string]interface{}
	if err := json.Unmarshal([]byte(`{"value": `+raw+`}`), &decoded); err != nil {
		t.Fatalf("decoding %s: %s", raw, err)
	}
	return decoded["value"]
}

// storedText is the text Postgres hands back for a number the API stored:
// the server reads the request's JSON number as a JavaScript number, and
// Postgres keeps its digits as written.
func storedText(number *big.Float) string {
	asFloat, _ := number.Float64()
	return strconv.FormatFloat(asFloat, 'f', -1, 64)
}

func TestParseAPINumberReadsEveryShapeTheAPIAnswersANumberIn(t *testing.T) {
	cases := []struct {
		name   string
		answer interface{}
		want   string
	}{
		// What issue #4719's server answered.
		{"integer text", "100", "100"},
		{"decimal text", "99.65", "99.65"},
		// A numeric keeps the scale it was written with: the dashboard's form wrote "100.00".
		{"text with trailing zeros", "100.00", "100"},
		{"text with a trailing zero", "99.650", "99.65"},
		{"zero as text", "0", "0"},
		{"zero with a scale", "0.00", "0"},
		{"negative text", "-12.5", "-12.5"},
		{"small text", "0.0000003", "0.0000003"},
		{"text with an exponent", "3e-07", "0.0000003"},
		{"text with spaces around it", " 99.65 ", "99.65"},
		{"text with a plus sign", "+5", "5"},
		{"text longer than a float64", "0.12345678901234567890123", "0.12345678901234567890123"},
		{"an integer larger than a float64 holds exactly", "9007199254740993", "9007199254740993"},

		// What servers with the fix answer, decoded the way the client decodes it.
		{"JSON integer", jsonNumber(t, "100"), "100"},
		{"JSON decimal", jsonNumber(t, "99.65"), "99.65"},
		{"JSON zero", jsonNumber(t, "0"), "0"},
		{"JSON negative", jsonNumber(t, "-12.5"), "-12.5"},
		{"JSON small number", jsonNumber(t, "3e-7"), "0.0000003"},
		{"JSON large number", jsonNumber(t, "1e21"), "1000000000000000000000"},

		// Wrapped: {_type, value}.
		{"wrapped text", map[string]interface{}{"_type": "Decimal", "value": "99.65"}, "99.65"},
		{"wrapped JSON number", map[string]interface{}{"_type": "Port", "value": jsonNumber(t, "443")}, "443"},

		// Go's own number types, should anything hand one over.
		{"int", 7, "7"},
		{"int64", int64(-7), "-7"},
		{"float32", float32(1.5), "1.5"},
		{"json.Number", json.Number("99.65"), "99.65"},
		{"negative zero", jsonNumber(t, "-0"), "0"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseAPINumber(tc.answer)
			if !ok {
				t.Fatalf("%#v did not read as a number", tc.answer)
			}
			want := configNumber(t, tc.want)
			if got.Cmp(want) != 0 {
				t.Errorf("%#v read as %s, want %s", tc.answer, got.Text('f', -1), tc.want)
			}
			if got.Sign() == 0 && got.Signbit() {
				t.Errorf("%#v read as -0, want 0", tc.answer)
			}
			if got.Prec() != apiNumberPrecision {
				t.Errorf("%#v read at %d bits, want the %d Terraform reads a configuration at", tc.answer, got.Prec(), apiNumberPrecision)
			}
		})
	}
}

func TestParseAPINumberRefusesWhatSpellsNoNumber(t *testing.T) {
	cases := []struct {
		name   string
		answer interface{}
	}{
		{"missing", nil},
		{"empty text", ""},
		{"blank text", "   "},
		{"words", "abc"},
		{"a number followed by words", "12abc"},
		{"Postgres' NaN", "NaN"},
		{"Postgres' Infinity", "Infinity"},
		{"Postgres' -Infinity", "-Infinity"},
		{"Go's Inf", "+Inf"},
		{"lower-case inf", "inf"},
		{"hex", "0x10"},
		{"underscores", "1_000"},
		{"a comma decimal", "99,65"},
		{"NaN", math.NaN()},
		{"infinity", math.Inf(1)},
		{"minus infinity", math.Inf(-1)},
		{"true", true},
		{"a list", []interface{}{jsonNumber(t, "1")}},
		{"a wrapper without a value", map[string]interface{}{"_type": "Decimal"}},
		{"a wrapper with a null value", map[string]interface{}{"_type": "Decimal", "value": nil}},
		{"a wrapper inside a wrapper", map[string]interface{}{"value": map[string]interface{}{"value": "1"}}},
		{"a wrapper with words", map[string]interface{}{"_type": "Decimal", "value": "abc"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, ok := parseAPINumber(tc.answer); ok {
				t.Errorf("%#v read as %s, want no number", tc.answer, got.Text('f', -1))
			}
		})
	}
}

// The numbers people write for the decimal columns the API has: uptime and
// SLO percentages, burn rate thresholds, budgets, prices, coordinates.
var configuredDecimals = []string{
	"100",
	"99.65",
	"99.9",
	"99.99",
	"99.999",
	"95",
	"0",
	"0.1",
	"0.5",
	"14.4",
	"-12.5",
	"37.7749295",
	"-122.4194155",
	"0.0000003",
	"2.5",
	"1234567.891",
	"0.30000000000000004",
}

// The reported failure, for the API's answer in every shape it comes in: a
// rule configured with a number reads back as exactly that number.
func TestNumberFromAPIReadsBackTheConfiguredNumber(t *testing.T) {
	for _, text := range configuredDecimals {
		config := configNumber(t, text)
		stored := storedText(config)

		answers := map[string]interface{}{
			"as text, the way servers before the fix answered": stored,
			"as a JSON number": jsonNumber(t, strconv.FormatFloat(mustFloat64(t, config), 'g', -1, 64)),
			"wrapped":          map[string]interface{}{"_type": "Decimal", "value": stored},
		}

		for shape, answer := range answers {
			t.Run(text+" "+shape, func(t *testing.T) {
				planned := plannedNumber(t, text)
				got := numberFromAPI(planned, answer)

				if got.IsNull() || got.IsUnknown() {
					t.Fatalf("%#v read as %s", answer, got)
				}
				if got.ValueBigFloat().Cmp(planned.ValueBigFloat()) != 0 {
					t.Errorf("%#v read as %s, want exactly the planned %s", answer, got.ValueBigFloat().Text('f', -1), text)
				}
				if received := sentToTerraform(t, got); !terraformNumbersEqual(received, config) {
					t.Errorf("Terraform would see %s after planning %s: inconsistent result after apply", received.Text('f', -1), text)
				}
			})
		}
	}
}

// An import has no previous value: what the API answered is the state, and
// it has to be the configuration's number, or the next plan shows a change.
func TestNumberFromAPIWithNothingPlannedReadsTheConfiguredNumber(t *testing.T) {
	for _, text := range configuredDecimals {
		config := configNumber(t, text)

		for _, previous := range []types.Number{types.NumberNull(), types.NumberUnknown()} {
			for _, answer := range []interface{}{
				storedText(config),
				jsonNumber(t, strconv.FormatFloat(mustFloat64(t, config), 'g', -1, 64)),
			} {
				got := numberFromAPI(previous, answer)
				if got.IsNull() || got.IsUnknown() {
					t.Fatalf("%#v read as %s", answer, got)
				}
				if got.ValueBigFloat().Cmp(config) != 0 {
					t.Errorf("%#v read as %s, want exactly %s", answer, got.ValueBigFloat().Text('f', -1), text)
				}
				if received := sentToTerraform(t, got); !terraformNumbersEqual(received, config) {
					t.Errorf("Terraform would see %s for a configuration's %s", received.Text('f', -1), text)
				}
			}
		}
	}
}

// A configuration can hold more digits than the API keeps: 100 * (1 - 1 /
// 1440) - a day with a minute of downtime - has hundreds. The API keeps the
// nearest float64 and answers it; the configuration's number is kept, so the
// apply completes and the next plan is empty.
func TestNumberFromAPIKeepsTheDigitsTheAPICannotKeep(t *testing.T) {
	// What HCL computes for 100 * (1 - 1 / 1440), at 512 bits.
	oneMinuteADay := new(big.Float).SetPrec(512).Quo(
		new(big.Float).SetPrec(512).SetInt64(143900),
		new(big.Float).SetPrec(512).SetInt64(1440),
	)
	nearestFloat, _ := oneMinuteADay.Float64()

	if strconv.FormatFloat(nearestFloat, 'f', -1, 64) == oneMinuteADay.Text('f', -1) {
		t.Fatalf("the configured number fits a float64; this test needs one that does not")
	}

	// The plan in Create and Update; the prior state, which the state file
	// keeps as the same digits, in every refresh.
	previous := types.NumberValue(overTheWire(t, oneMinuteADay))

	for _, answer := range []interface{}{
		strconv.FormatFloat(nearestFloat, 'f', -1, 64),
		jsonNumber(t, strconv.FormatFloat(nearestFloat, 'g', -1, 64)),
		map[string]interface{}{"_type": "Decimal", "value": strconv.FormatFloat(nearestFloat, 'f', -1, 64)},
	} {
		got := numberFromAPI(previous, answer)
		if !got.Equal(previous) {
			t.Errorf("%#v replaced %s with %s", answer, oneMinuteADay.Text('f', -1), got.ValueBigFloat().Text('f', -1))
		}
		if received := sentToTerraform(t, got); !terraformNumbersEqual(received, oneMinuteADay) {
			t.Errorf("Terraform would see %s: inconsistent result after apply", received.Text('f', -1))
		}
	}
}

// A different number is a change, however small, and is read as the API's.
func TestNumberFromAPIReadsAChangedNumber(t *testing.T) {
	cases := []struct {
		previous string
		answer   interface{}
		want     string
	}{
		{"99.65", "99.66", "99.66"},
		{"99.65", jsonNumber(t, "99.9"), "99.9"},
		{"100", "99.99999999999999", "99.99999999999999"},
		{"100", "0", "0"},
		{"0", "100.00", "100"},
		{"0.1", jsonNumber(t, "0.30000000000000004"), "0.30000000000000004"},
		{"-12.5", "12.5", "12.5"},
	}

	for _, tc := range cases {
		got := numberFromAPI(plannedNumber(t, tc.previous), tc.answer)
		if got.IsNull() || got.ValueBigFloat().Cmp(configNumber(t, tc.want)) != 0 {
			t.Errorf("previous %s, answered %#v: read as %s, want %s", tc.previous, tc.answer, got, tc.want)
		}
	}
}

// Nothing to read is null - never the previous value, never unknown.
func TestNumberFromAPIReadsNothingAsNull(t *testing.T) {
	for _, answer := range []interface{}{nil, "", "abc", "NaN", map[string]interface{}{"_type": "Decimal"}} {
		for _, previous := range []types.Number{plannedNumber(t, "99.65"), types.NumberNull(), types.NumberUnknown()} {
			got := numberFromAPI(previous, answer)
			if !got.IsNull() {
				t.Errorf("previous %s, answered %#v: read as %s, want null", previous, answer, got)
			}
		}
	}
}

func TestSameAPINumber(t *testing.T) {
	oneThird := new(big.Float).SetPrec(512).Quo(big.NewFloat(1).SetPrec(512), big.NewFloat(3).SetPrec(512))
	nearestThird, _ := oneThird.Float64()

	cases := []struct {
		name string
		a    *big.Float
		b    *big.Float
		same bool
	}{
		{"equal", configNumber(t, "99.65"), configNumber(t, "99.65"), true},
		{"equal at different precisions", configNumber(t, "100"), big.NewFloat(100), true},
		{"a float64 and its decimal", big.NewFloat(99.65), configNumber(t, "99.65"), true},
		{"more digits than a float64, the same float64", oneThird, big.NewFloat(nearestThird), true},
		{"zero and negative zero", configNumber(t, "0"), new(big.Float).Neg(configNumber(t, "0")), true},
		{"different", configNumber(t, "99.65"), configNumber(t, "99.66"), false},
		{"neighbouring float64s", big.NewFloat(1), big.NewFloat(math.Nextafter(1, 2)), false},
		{"beyond a float64, different", configNumber(t, "1e400"), configNumber(t, "2e400"), false},
		{"beyond a float64, equal", configNumber(t, "1e400"), configNumber(t, "1e400"), true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sameAPINumber(tc.a, tc.b); got != tc.same {
				t.Errorf("sameAPINumber(%s, %s) = %t, want %t", tc.a.Text('g', 20), tc.b.Text('g', 20), got, tc.same)
			}
			if got := sameAPINumber(tc.b, tc.a); got != tc.same {
				t.Errorf("sameAPINumber(%s, %s) = %t, want %t", tc.b.Text('g', 20), tc.a.Text('g', 20), got, tc.same)
			}
		})
	}
}

func mustFloat64(t *testing.T, number *big.Float) float64 {
	t.Helper()
	asFloat, _ := number.Float64()
	if math.IsInf(asFloat, 0) {
		t.Fatalf("%s does not fit a float64", number.Text('g', 10))
	}
	return asFloat
}
