package config

// Every kind has a CRD of its own (#10144). controller-gen names a CRD, and
// the file it writes it to, by its kind's plural, and wrote
// OnCallScheduleLayers' CRD over OnCallScheduleLayer's, whose plural was the
// same: the package had no CRD for OnCallScheduleLayer, and a cluster
// refused every one with "no matches for kind". The names are held twice: as
// the configuration gives them, which the generator checks too before it
// writes anything, and as the package's CRDs have them.

import (
	"os"
	"path/filepath"
	"testing"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"sigs.k8s.io/yaml"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/v1beta1"
	"github.com/oneuptime/crossplane-provider-oneuptime/internal/kinds"
)

// The ProviderConfigs' kinds, which are of the managed resources' API group
// too, at their own version.
var providerConfigKinds = []string{
	v1beta1.ProviderConfigKind,
	v1beta1.ProviderConfigUsageKind,
	v1beta1.ClusterProviderConfigKind,
}

// Every CRD of the group, as the configuration names it: the managed
// resources' by their Terraform names, the ProviderConfigs' by their kinds.
func configuredCRDs() map[string]kinds.CRD {
	crds := CRDs(provider)
	for _, kind := range providerConfigKinds {
		crds[kind] = kinds.CRDOf(kind, "")
	}
	return crds
}

func TestNoTwoKindsShareACRDName(t *testing.T) {
	crds := configuredCRDs()
	for _, clash := range kinds.Clashes(crds) {
		t.Error(clash)
	}
	for terraformName, r := range provider.Resources {
		if r.Path != kinds.Path(r.Kind) {
			t.Errorf("%s: path %q, want internal/kinds' %q", terraformName, r.Path, kinds.Path(r.Kind))
		}
	}
	// The kinds #10144 was found by: the new kind has a plural of its own,
	// and the one every package installed keeps its CRD.
	for terraformName, want := range map[string]kinds.CRD{
		"oneuptime_on_call_schedule_layer":  {Kind: "OnCallScheduleLayer", ListKind: "OnCallScheduleLayerList", Plural: "oncallschedulelayerdefinitions", Singular: "oncallschedulelayer"},
		"oneuptime_on_call_schedule_layers": {Kind: "OnCallScheduleLayers", ListKind: "OnCallScheduleLayersList", Plural: "oncallschedulelayers", Singular: "oncallschedulelayers"},
	} {
		if got := crds[terraformName]; got != want {
			t.Errorf("%s: CRD %+v, want %+v", terraformName, got, want)
		}
	}
}

// The package's CRDs, by the files controller-gen wrote them to.
func packageCRDs(t *testing.T) map[string]apiextensionsv1.CustomResourceDefinition {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("..", "package", "crds", "*.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("package/crds has no CRDs: generate the provider first")
	}
	crds := map[string]apiextensionsv1.CustomResourceDefinition{}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var crd apiextensionsv1.CustomResourceDefinition
		if err := yaml.Unmarshal(data, &crd); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		crds[filepath.Base(file)] = crd
	}
	return crds
}

// What generation wrote: for each managed resource's kind, and each
// ProviderConfig's, a CRD in a file of its own, named as the configuration
// says, of the kind's version alone.
func TestEveryKindHasACRDOfItsOwn(t *testing.T) {
	written := packageCRDs(t)
	fileOf := map[string]string{}
	names := map[string]kinds.CRD{}
	for file, crd := range written {
		n := crd.Spec.Names
		if crd.Spec.Group != Group || file != Group+"_"+n.Plural+".yaml" || crd.Name != n.Plural+"."+Group {
			t.Errorf("%s is the CRD %s, of the plural %s in %s", file, crd.Name, n.Plural, crd.Spec.Group)
		}
		if other, taken := fileOf[n.Kind]; taken {
			t.Errorf("%s and %s are both CRDs of %s", other, file, n.Kind)
		}
		fileOf[n.Kind] = file
		names[file] = kinds.CRD{Kind: n.Kind, ListKind: n.ListKind, Plural: n.Plural, Singular: n.Singular}
	}
	for _, clash := range kinds.Clashes(names) {
		t.Error(clash)
	}

	for of, want := range configuredCRDs() {
		file, ok := fileOf[want.Kind]
		if !ok {
			t.Errorf("%s: the package has no CRD for its kind %s", of, want.Kind)
			continue
		}
		delete(fileOf, want.Kind)
		if got := names[file]; got != want {
			t.Errorf("%s: %s names %+v, want %+v", of, file, got, want)
		}
		version := Version
		if _, managed := provider.Resources[of]; !managed {
			version = v1beta1.Version
		}
		if versions := written[file].Spec.Versions; len(versions) != 1 || versions[0].Name != version {
			t.Errorf("%s: %s has %d versions, want %s alone", of, file, len(versions), version)
		}
	}
	for kind, file := range fileOf {
		t.Errorf("%s is a CRD of %s, which is neither a managed resource's kind nor a ProviderConfig's", file, kind)
	}
}
