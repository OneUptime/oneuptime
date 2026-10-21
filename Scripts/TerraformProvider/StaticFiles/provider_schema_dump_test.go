package provider

// Writes every resource and data source schema of the built provider as JSON,
// for the docs generator (Scripts/TerraformProvider/Core/DocumentationGenerator.ts).
// The docs are rendered from the schema Terraform actually sees - nested
// attributes, computed-only overrides, allowed values and all - instead of
// from a second copy of the generator's decisions.
//
// Skipped unless ONEUPTIME_PROVIDER_SCHEMA_OUT names the file to write:
//
//	ONEUPTIME_PROVIDER_SCHEMA_OUT=schema.json go test ./internal/provider -run TestWriteProviderSchemaForDocs

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	dschema "github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	rschema "github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types/basetypes"
)

type schemaDumpAttribute struct {
	Type          string                         `json:"type"`
	Description   string                         `json:"description,omitempty"`
	Required      bool                           `json:"required,omitempty"`
	Optional      bool                           `json:"optional,omitempty"`
	Computed      bool                           `json:"computed,omitempty"`
	Sensitive     bool                           `json:"sensitive,omitempty"`
	Deprecation   string                         `json:"deprecation,omitempty"`
	AllowedValues []string                       `json:"allowed_values,omitempty"`
	Default       string                         `json:"default,omitempty"`
	Nested        map[string]schemaDumpAttribute `json:"nested,omitempty"`
}

type schemaDumpBlock struct {
	Description string                         `json:"description,omitempty"`
	Deprecation string                         `json:"deprecation,omitempty"`
	Attributes  map[string]schemaDumpAttribute `json:"attributes"`
}

type schemaDump struct {
	Resources   map[string]schemaDumpBlock `json:"resources"`
	DataSources map[string]schemaDumpBlock `json:"data_sources"`
}

// stringvalidator.OneOf describes itself as: value must be one of: ["a" "b"]
var (
	oneOfPattern      = regexp.MustCompile(`must be one of`)
	oneOfValuePattern = regexp.MustCompile(`"(?:[^"\\]|\\.)*"`)
)

func allowedValues(ctx context.Context, validators []validator.String) []string {
	for _, v := range validators {
		description := v.Description(ctx)
		if !oneOfPattern.MatchString(description) {
			continue
		}
		values := []string{}
		for _, quoted := range oneOfValuePattern.FindAllString(description, -1) {
			if value, err := strconv.Unquote(quoted); err == nil {
				values = append(values, value)
			}
		}
		if len(values) > 0 {
			return values
		}
	}
	return nil
}

func elementTypeName(t attr.Type) string {
	switch t.(type) {
	case basetypes.StringType:
		return "String"
	case basetypes.NumberType, basetypes.Int64Type, basetypes.Float64Type:
		return "Number"
	case basetypes.BoolType:
		return "Boolean"
	}
	return "Object"
}

func describeDefault(ctx context.Context, d interface{ MarkdownDescription(context.Context) string }) string {
	if d == nil {
		return ""
	}
	return d.MarkdownDescription(ctx)
}

func describeResourceAttribute(ctx context.Context, a rschema.Attribute) schemaDumpAttribute {
	d := schemaDumpAttribute{
		Description: a.GetMarkdownDescription(),
		Required:    a.IsRequired(),
		Optional:    a.IsOptional(),
		Computed:    a.IsComputed(),
		Sensitive:   a.IsSensitive(),
		Deprecation: a.GetDeprecationMessage(),
	}
	if d.Description == "" {
		d.Description = a.GetDescription()
	}

	nested := func(attributes map[string]rschema.Attribute) map[string]schemaDumpAttribute {
		out := map[string]schemaDumpAttribute{}
		for name, child := range attributes {
			out[name] = describeResourceAttribute(ctx, child)
		}
		return out
	}

	switch v := a.(type) {
	case rschema.StringAttribute:
		d.Type = "String"
		d.AllowedValues = allowedValues(ctx, v.Validators)
		if v.Default != nil {
			d.Default = describeDefault(ctx, v.Default)
		}
	case rschema.BoolAttribute:
		d.Type = "Boolean"
		if v.Default != nil {
			d.Default = describeDefault(ctx, v.Default)
		}
	case rschema.NumberAttribute:
		d.Type = "Number"
		if v.Default != nil {
			d.Default = describeDefault(ctx, v.Default)
		}
	case rschema.Int64Attribute:
		d.Type = "Number"
	case rschema.Float64Attribute:
		d.Type = "Number"
	case rschema.ListAttribute:
		d.Type = "List of " + elementTypeName(v.ElementType)
	case rschema.SetAttribute:
		d.Type = "Set of " + elementTypeName(v.ElementType)
	case rschema.MapAttribute:
		d.Type = "Map of " + elementTypeName(v.ElementType)
	case rschema.ListNestedAttribute:
		d.Type = "Attributes List"
		d.Nested = nested(v.NestedObject.Attributes)
	case rschema.SetNestedAttribute:
		d.Type = "Attributes Set"
		d.Nested = nested(v.NestedObject.Attributes)
	case rschema.MapNestedAttribute:
		d.Type = "Attributes Map"
		d.Nested = nested(v.NestedObject.Attributes)
	case rschema.SingleNestedAttribute:
		d.Type = "Attributes"
		d.Nested = nested(v.Attributes)
	default:
		d.Type = fmt.Sprintf("%T", a)
	}

	return d
}

func describeDataSourceAttribute(ctx context.Context, a dschema.Attribute) schemaDumpAttribute {
	d := schemaDumpAttribute{
		Description: a.GetMarkdownDescription(),
		Required:    a.IsRequired(),
		Optional:    a.IsOptional(),
		Computed:    a.IsComputed(),
		Sensitive:   a.IsSensitive(),
		Deprecation: a.GetDeprecationMessage(),
	}
	if d.Description == "" {
		d.Description = a.GetDescription()
	}

	nested := func(attributes map[string]dschema.Attribute) map[string]schemaDumpAttribute {
		out := map[string]schemaDumpAttribute{}
		for name, child := range attributes {
			out[name] = describeDataSourceAttribute(ctx, child)
		}
		return out
	}

	switch v := a.(type) {
	case dschema.StringAttribute:
		d.Type = "String"
		d.AllowedValues = allowedValues(ctx, v.Validators)
	case dschema.BoolAttribute:
		d.Type = "Boolean"
	case dschema.NumberAttribute, dschema.Int64Attribute, dschema.Float64Attribute:
		d.Type = "Number"
	case dschema.ListAttribute:
		d.Type = "List of " + elementTypeName(v.ElementType)
	case dschema.SetAttribute:
		d.Type = "Set of " + elementTypeName(v.ElementType)
	case dschema.MapAttribute:
		d.Type = "Map of " + elementTypeName(v.ElementType)
	case dschema.ListNestedAttribute:
		d.Type = "Attributes List"
		d.Nested = nested(v.NestedObject.Attributes)
	case dschema.SetNestedAttribute:
		d.Type = "Attributes Set"
		d.Nested = nested(v.NestedObject.Attributes)
	case dschema.MapNestedAttribute:
		d.Type = "Attributes Map"
		d.Nested = nested(v.NestedObject.Attributes)
	case dschema.SingleNestedAttribute:
		d.Type = "Attributes"
		d.Nested = nested(v.Attributes)
	default:
		d.Type = fmt.Sprintf("%T", a)
	}

	return d
}

func buildSchemaDump(ctx context.Context) schemaDump {
	dump := schemaDump{
		Resources:   map[string]schemaDumpBlock{},
		DataSources: map[string]schemaDumpBlock{},
	}

	for _, newResource := range GetResources() {
		r := newResource()
		meta := &resource.MetadataResponse{}
		r.Metadata(ctx, resource.MetadataRequest{ProviderTypeName: "oneuptime"}, meta)
		s := &resource.SchemaResponse{}
		r.Schema(ctx, resource.SchemaRequest{}, s)

		block := schemaDumpBlock{
			Description: s.Schema.MarkdownDescription,
			Deprecation: s.Schema.DeprecationMessage,
			Attributes:  map[string]schemaDumpAttribute{},
		}
		for name, a := range s.Schema.Attributes {
			block.Attributes[name] = describeResourceAttribute(ctx, a)
		}
		dump.Resources[meta.TypeName] = block
	}

	for _, newDataSource := range GetDataSources() {
		d := newDataSource()
		meta := &datasource.MetadataResponse{}
		d.Metadata(ctx, datasource.MetadataRequest{ProviderTypeName: "oneuptime"}, meta)
		s := &datasource.SchemaResponse{}
		d.Schema(ctx, datasource.SchemaRequest{}, s)

		block := schemaDumpBlock{
			Description: s.Schema.MarkdownDescription,
			Deprecation: s.Schema.DeprecationMessage,
			Attributes:  map[string]schemaDumpAttribute{},
		}
		for name, a := range s.Schema.Attributes {
			block.Attributes[name] = describeDataSourceAttribute(ctx, a)
		}
		dump.DataSources[meta.TypeName] = block
	}

	return dump
}

func TestWriteProviderSchemaForDocs(t *testing.T) {
	out := os.Getenv("ONEUPTIME_PROVIDER_SCHEMA_OUT")
	if out == "" {
		t.Skip("set ONEUPTIME_PROVIDER_SCHEMA_OUT to write the provider schema for the docs generator")
	}

	content, err := json.MarshalIndent(buildSchemaDump(context.Background()), "", "  ")
	if err != nil {
		t.Fatalf("marshal schema: %s", err)
	}
	if err := os.WriteFile(out, content, 0o644); err != nil {
		t.Fatalf("write %s: %s", out, err)
	}
}

// The dump itself is pinned without the environment variable, so a type the
// walker does not know (rendered as its Go type name) fails the build rather
// than a docs page.
func TestProviderSchemaDumpKnowsEveryAttributeType(t *testing.T) {
	dump := buildSchemaDump(context.Background())

	known := regexp.MustCompile(`^(String|Number|Boolean|(List|Set|Map) of (String|Number|Boolean|Object)|Attributes( List| Set| Map)?)$`)

	var check func(where string, attributes map[string]schemaDumpAttribute)
	check = func(where string, attributes map[string]schemaDumpAttribute) {
		for name, a := range attributes {
			if !known.MatchString(a.Type) {
				t.Errorf("%s.%s has a type the docs cannot name: %s", where, name, a.Type)
			}
			if !a.Required && !a.Optional && !a.Computed {
				t.Errorf("%s.%s is neither required, optional nor computed", where, name)
			}
			check(where+"."+name, a.Nested)
		}
	}

	if len(dump.Resources) == 0 || len(dump.DataSources) == 0 {
		t.Fatalf("schema dump is empty: %d resources, %d data sources", len(dump.Resources), len(dump.DataSources))
	}

	for name, block := range dump.Resources {
		if _, ok := block.Attributes["id"]; !ok {
			t.Errorf("resource %s has no id", name)
		}
		check(name, block.Attributes)
	}
	for name, block := range dump.DataSources {
		check(name, block.Attributes)
	}
}
