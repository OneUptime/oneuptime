// Package schemadump writes the Terraform provider's schema in the JSON
// form `terraform providers schema -json` prints, which is what Upjet
// generates the managed resources from. It reads the schema from the
// provider itself, in process, so generation needs no Terraform CLI.
package schemadump

import (
	"context"
	"fmt"
	"sort"

	tfjson "github.com/hashicorp/terraform-json"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
	"github.com/zclconf/go-cty/cty"
	ctyjson "github.com/zclconf/go-cty/cty/json"
)

// ProviderAddress is the provider's address in the dump.
const ProviderAddress = "registry.terraform.io/oneuptime/oneuptime"

// Result is the dump and the resources it leaves out.
type Result struct {
	Schemas *tfjson.ProviderSchemas
	// Deprecated are the resources the dump leaves out: the old names a
	// renamed resource keeps in Terraform, so configurations that use them
	// still work. Kubernetes has no configurations from before, so each
	// resource has one kind, under its current name.
	Deprecated []string
}

// Dump reads the schema of every resource of p, with its descriptions
// written for Kubernetes (see Describe).
func Dump(ctx context.Context, p provider.Provider) (*Result, error) {
	server := providerserver.NewProtocol6(p)()
	resp, err := server.GetProviderSchema(ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		return nil, err
	}
	for _, d := range resp.Diagnostics {
		if d.Severity == tfprotov6.DiagnosticSeverityError {
			return nil, fmt.Errorf("%s: %s", d.Summary, d.Detail)
		}
	}

	result := &Result{}
	kept := map[string]*tfprotov6.Schema{}
	for name, s := range resp.ResourceSchemas {
		if s.Block != nil && s.Block.Deprecated {
			result.Deprecated = append(result.Deprecated, name)
			continue
		}
		kept[name] = s
	}
	sort.Strings(result.Deprecated)
	isResource := func(name string) bool {
		_, ok := kept[name]
		return ok
	}

	resources := make(map[string]*tfjson.Schema, len(kept))
	for name, s := range kept {
		resources[name] = convertSchema(s, isResource)
	}
	result.Schemas = &tfjson.ProviderSchemas{
		FormatVersion: "1.0",
		Schemas: map[string]*tfjson.ProviderSchema{
			ProviderAddress: {
				ConfigSchema:    convertSchema(resp.Provider, isResource),
				ResourceSchemas: resources,
			},
		},
	}
	return result, nil
}

func convertSchema(s *tfprotov6.Schema, isResource func(string) bool) *tfjson.Schema {
	return &tfjson.Schema{Version: uint64(s.Version), Block: convertBlock(s.Block, isResource)} //nolint:gosec // a schema version is never negative
}

func descriptionKind(k tfprotov6.StringKind) tfjson.SchemaDescriptionKind {
	if k == tfprotov6.StringKindMarkdown {
		return tfjson.SchemaDescriptionKindMarkdown
	}
	return tfjson.SchemaDescriptionKindPlain
}

func convertBlock(b *tfprotov6.SchemaBlock, isResource func(string) bool) *tfjson.SchemaBlock {
	out := &tfjson.SchemaBlock{
		Attributes:      map[string]*tfjson.SchemaAttribute{},
		NestedBlocks:    map[string]*tfjson.SchemaBlockType{},
		Description:     Describe(b.Description, isResource),
		DescriptionKind: descriptionKind(b.DescriptionKind),
		Deprecated:      b.Deprecated,
	}
	for _, a := range b.Attributes {
		out.Attributes[a.Name] = convertAttribute(a, isResource)
	}
	for _, nb := range b.BlockTypes {
		out.NestedBlocks[nb.TypeName] = &tfjson.SchemaBlockType{
			NestingMode: blockNesting(nb.Nesting),
			Block:       convertBlock(nb.Block, isResource),
			MinItems:    uint64(nb.MinItems), //nolint:gosec // never negative
			MaxItems:    uint64(nb.MaxItems), //nolint:gosec // never negative
		}
	}
	return out
}

func convertAttribute(a *tfprotov6.SchemaAttribute, isResource func(string) bool) *tfjson.SchemaAttribute {
	out := &tfjson.SchemaAttribute{
		Description:     Describe(a.Description, isResource),
		DescriptionKind: descriptionKind(a.DescriptionKind),
		Deprecated:      a.Deprecated,
		Required:        a.Required,
		Optional:        a.Optional,
		Computed:        a.Computed,
		Sensitive:       a.Sensitive,
	}
	if a.NestedType != nil {
		nested := &tfjson.SchemaNestedAttributeType{
			Attributes:  map[string]*tfjson.SchemaAttribute{},
			NestingMode: objectNesting(a.NestedType.Nesting),
		}
		for _, na := range a.NestedType.Attributes {
			nested.Attributes[na.Name] = convertAttribute(na, isResource)
		}
		out.AttributeNestedType = nested
		return out
	}
	out.AttributeType = ctyType(a.Type)
	return out
}

func ctyType(t tftypes.Type) cty.Type {
	b, err := t.MarshalJSON()
	if err != nil {
		panic(err)
	}
	ct, err := ctyjson.UnmarshalType(b)
	if err != nil {
		panic(err)
	}
	return ct
}

func blockNesting(n tfprotov6.SchemaNestedBlockNestingMode) tfjson.SchemaNestingMode {
	switch n {
	case tfprotov6.SchemaNestedBlockNestingModeSingle:
		return tfjson.SchemaNestingModeSingle
	case tfprotov6.SchemaNestedBlockNestingModeGroup:
		return tfjson.SchemaNestingModeGroup
	case tfprotov6.SchemaNestedBlockNestingModeList:
		return tfjson.SchemaNestingModeList
	case tfprotov6.SchemaNestedBlockNestingModeSet:
		return tfjson.SchemaNestingModeSet
	case tfprotov6.SchemaNestedBlockNestingModeMap:
		return tfjson.SchemaNestingModeMap
	}
	panic(fmt.Sprintf("unknown block nesting mode %v", n))
}

func objectNesting(n tfprotov6.SchemaObjectNestingMode) tfjson.SchemaNestingMode {
	switch n {
	case tfprotov6.SchemaObjectNestingModeSingle:
		return tfjson.SchemaNestingModeSingle
	case tfprotov6.SchemaObjectNestingModeList:
		return tfjson.SchemaNestingModeList
	case tfprotov6.SchemaObjectNestingModeSet:
		return tfjson.SchemaNestingModeSet
	case tfprotov6.SchemaObjectNestingModeMap:
		return tfjson.SchemaNestingModeMap
	}
	panic(fmt.Sprintf("unknown object nesting mode %v", n))
}
