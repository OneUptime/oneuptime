// Command generator writes the managed resources' API types, controllers and
// examples from the provider configuration.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/crossplane/upjet/v2/pkg/pipeline"
	tjtypes "github.com/crossplane/upjet/v2/pkg/types"

	"github.com/oneuptime/crossplane-provider-oneuptime/config"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] == "" {
		panic("root directory is required to be given as argument")
	}
	rootDir, err := filepath.Abs(os.Args[1])
	if err != nil {
		panic(fmt.Sprintf("cannot calculate the absolute path with %s", os.Args[1]))
	}
	pc := config.GetProvider()

	// Namespaced managed resources only, Crossplane v2's kind: Upjet's
	// pipeline.Run writes namespaced resources only beside cluster-scoped
	// ones, so its runner is driven here directly.
	runner := &pipeline.PipelineRunner{
		DirAPIs:               filepath.Join(rootDir, "apis"),
		DirControllers:        filepath.Join(rootDir, "internal", "controller"),
		DirExamples:           filepath.Join(rootDir, "examples-generated"),
		DirHack:               filepath.Join(rootDir, "hack"),
		ModulePathAPIs:        filepath.Join(pc.ModulePath, "apis"),
		ModulePathControllers: filepath.Join(pc.ModulePath, "internal", "controller"),
		Scope:                 tjtypes.CRDScopeNamespaced,
	}
	runner.Run(pc)
}
