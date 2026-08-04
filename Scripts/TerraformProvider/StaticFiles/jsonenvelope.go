package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
)

// jsonEnvelopeValidator validates complex-JSON string attributes at plan
// time: the value must be parseable JSON (when it is JSON at all), every
// {_type: ...} wrapper must name a real OneUptime object type, and Date/
// DateTime wrapper values must parse. Users previously discovered these
// mistakes as opaque API 400/500s at apply time.
type jsonEnvelopeValidator struct{}

// JSONEnvelopeValidator returns the shared plan-time validator for
// complex-JSON string attributes.
func JSONEnvelopeValidator() validator.String {
	return jsonEnvelopeValidator{}
}

func (v jsonEnvelopeValidator) Description(_ context.Context) string {
	return "value must be valid JSON; {_type: ...} envelopes must use known OneUptime object types"
}

func (v jsonEnvelopeValidator) MarkdownDescription(ctx context.Context) string {
	return v.Description(ctx)
}

func (v jsonEnvelopeValidator) ValidateString(_ context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	raw := strings.TrimSpace(req.ConfigValue.ValueString())
	// Some complex-typed fields legitimately hold raw scalar strings (e.g.
	// a Color "#FF0000"). Only values that look like JSON are validated.
	if raw == "" || (raw[0] != '{' && raw[0] != '[') {
		return
	}

	var parsed interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		resp.Diagnostics.AddAttributeError(
			req.Path,
			"Invalid JSON",
			fmt.Sprintf(
				"The value looks like JSON but does not parse: %s. "+
					"Use jsonencode() to build this attribute instead of hand-writing JSON strings.",
				err,
			),
		)
		return
	}

	walkEnvelope(req, resp, parsed)
}

// walkEnvelope recursively checks every {_type: ...} wrapper in the value.
func walkEnvelope(req validator.StringRequest, resp *validator.StringResponse, value interface{}) {
	switch typed := value.(type) {
	case map[string]interface{}:
		if typeName, ok := typed["_type"].(string); ok {
			if !validOneUptimeObjectTypes[typeName] {
				resp.Diagnostics.AddAttributeError(
					req.Path,
					"Unknown OneUptime Type",
					fmt.Sprintf(
						"_type %q is not a OneUptime object type. Check the spelling against the docs "+
							"(https://oneuptime.com/docs/terraform/monitor-steps) — for timestamps use %q.",
						typeName, "DateTime",
					),
				)
			} else if typeName == "DateTime" {
				if val, ok := typed["value"].(string); ok {
					if _, err := time.Parse(time.RFC3339Nano, val); err != nil {
						resp.Diagnostics.AddAttributeError(
							req.Path,
							"Invalid DateTime Value",
							fmt.Sprintf(
								"%q is not an RFC3339 timestamp (expected e.g. 2030-01-01T00:00:00Z).",
								val,
							),
						)
					}
				}
			}
		}
		for _, child := range typed {
			walkEnvelope(req, resp, child)
		}
	case []interface{}:
		for _, child := range typed {
			walkEnvelope(req, resp, child)
		}
	}
}
