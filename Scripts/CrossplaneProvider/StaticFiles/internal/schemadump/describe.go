package schemadump

import (
	"regexp"
	"strings"

	"github.com/oneuptime/crossplane-provider-oneuptime/internal/kinds"
)

var (
	// `oneuptime_monitor_status`: what a Terraform user writes.
	terraformNamePattern = regexp.MustCompile("`" + kinds.ResourcePrefix + "_([a-z0-9_]+)`")
	// `user_email`: an attribute's Terraform name.
	attributeNamePattern = regexp.MustCompile("`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`")
)

// The Terraform words of the provider's descriptions, and what a Kubernetes
// user reads instead. A JSON attribute is a string in both.
var phrases = []struct{ terraform, kubernetes string }{
	{" (see the data source)", ""},
	{"A JSON value: write it with `jsonencode()`.", "A JSON value, as a string."},
	{"A JSON value: read it with `jsondecode()`.", "A JSON value, as a string."},
	{"Write it with `jsonencode()`.", "Write it as a JSON string."},
	{"write it with `jsonencode()`", "write it as a JSON string"},
	{"read it with `jsondecode()`", "read it as a JSON string"},
}

// Describe rewrites the description of a Terraform resource or attribute
// for its managed resource: a resource is named by its kind (`Label`, not
// `oneuptime_label`), an attribute by its field (`userEmail`, not
// `user_email`), and JSON is a string, without Terraform's functions.
// isResource says whether a Terraform name is one of the provider's
// resources; a record the provider only reads, such as a user, is named in
// words.
func Describe(text string, isResource func(terraformName string) bool) string {
	for _, p := range phrases {
		text = strings.ReplaceAll(text, p.terraform, p.kubernetes)
	}
	text = terraformNamePattern.ReplaceAllStringFunc(text, func(match string) string {
		terraformName := strings.Trim(match, "`")
		if isResource(terraformName) {
			return "`" + kinds.Of(terraformName) + "`"
		}
		words := strings.ReplaceAll(strings.TrimPrefix(terraformName, kinds.ResourcePrefix+"_"), "_", " ")
		return "OneUptime " + words
	})
	return attributeNamePattern.ReplaceAllStringFunc(text, func(match string) string {
		return "`" + kinds.FieldName(strings.Trim(match, "`")) + "`"
	})
}
