// Command schema writes the Terraform provider's schema, which Upjet
// generates the managed resources from, to the file it is given
// (config/schema.json).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/oneuptime/terraform-provider-oneuptime/xpprovider"

	"github.com/oneuptime/crossplane-provider-oneuptime/internal/schemadump"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: schema <output file>")
		os.Exit(2)
	}
	result, err := schemadump.Dump(context.Background(), xpprovider.FrameworkProvider("crossplane"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot read the provider's schema:", err)
		os.Exit(1)
	}
	b, err := json.MarshalIndent(result.Schemas, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(os.Args[1], b, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("wrote %d resource schemas, leaving out %d deprecated names\n",
		len(result.Schemas.Schemas[schemadump.ProviderAddress].ResourceSchemas), len(result.Deprecated))
}
