package v1beta1

import (
	"os"
	"path/filepath"
	"testing"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"sigs.k8s.io/yaml"
)

// crd reads the CRD controller-gen wrote from these types into the package,
// as a cluster installs it.
func crd(t *testing.T, plural string) apiextensionsv1.CustomResourceDefinition {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "package", "crds", Group+"_"+plural+".yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var c apiextensionsv1.CustomResourceDefinition
	if err := yaml.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Spec.Versions) != 1 || c.Spec.Versions[0].Name != Version {
		t.Fatalf("%s: versions %v, want %s alone", plural, c.Spec.Versions, Version)
	}
	return c
}

func specOf(t *testing.T, c apiextensionsv1.CustomResourceDefinition) apiextensionsv1.JSONSchemaProps {
	t.Helper()
	spec, ok := c.Spec.Versions[0].Schema.OpenAPIV3Schema.Properties["spec"]
	if !ok {
		t.Fatalf("%s has no spec", c.Name)
	}
	return spec
}

// The API server fills a default in before the provider reads the object, so
// a default url would hide the oneuptime_url of JSON credentials: a
// self-hosted OneUptime named only there would get OneUptime Cloud instead.
func TestURLHasNoDefault(t *testing.T) {
	for _, plural := range []string{"providerconfigs", "clusterproviderconfigs"} {
		url, ok := specOf(t, crd(t, plural)).Properties["url"]
		if !ok {
			t.Fatalf("%s has no url", plural)
		}
		if url.Default != nil {
			t.Errorf("%s: url defaults to %s", plural, url.Default.Raw)
		}
	}
}

// A ProviderConfig reads a Secret of its own namespace only: its secretRef has
// no namespace to point anywhere else.
func TestAProviderConfigNamesNoOtherNamespace(t *testing.T) {
	c := crd(t, "providerconfigs")
	if c.Spec.Scope != apiextensionsv1.NamespaceScoped {
		t.Fatalf("providerconfigs are %s, want Namespaced", c.Spec.Scope)
	}
	credentials := specOf(t, c).Properties["credentials"]
	secretRef, ok := credentials.Properties["secretRef"]
	if !ok {
		t.Fatal("a ProviderConfig's credentials have no secretRef")
	}
	if _, ok := secretRef.Properties["namespace"]; ok {
		t.Error("a ProviderConfig's secretRef takes a namespace")
	}
	for _, field := range []string{"env", "fs"} {
		if _, ok := credentials.Properties[field]; ok {
			t.Errorf("a ProviderConfig's credentials take %s, a source of the provider's own pod", field)
		}
	}
	if got := credentials.Properties["source"].Enum; len(got) != 1 || string(got[0].Raw) != `"Secret"` {
		t.Errorf("a ProviderConfig's credentials take sources %v, want Secret alone", got)
	}
}

func TestAClusterProviderConfigIsClusterWide(t *testing.T) {
	c := crd(t, "clusterproviderconfigs")
	if c.Spec.Scope != apiextensionsv1.ClusterScoped {
		t.Fatalf("clusterproviderconfigs are %s, want Cluster", c.Spec.Scope)
	}
	secretRef := specOf(t, c).Properties["credentials"].Properties["secretRef"]
	if _, ok := secretRef.Properties["namespace"]; !ok {
		t.Error("a ClusterProviderConfig's secretRef takes no namespace")
	}
}
