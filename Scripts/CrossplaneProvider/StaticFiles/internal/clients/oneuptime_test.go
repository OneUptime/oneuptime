package clients

import (
	"context"
	"strings"
	"testing"

	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis"
	"github.com/oneuptime/crossplane-provider-oneuptime/apis/crossplane/v1alpha1"
	"github.com/oneuptime/crossplane-provider-oneuptime/apis/v1beta1"
)

func TestParseCredentials(t *testing.T) {
	cases := []struct {
		name    string
		data    string
		want    Credentials
		wantErr string
	}{
		{name: "the key on its own", data: "abc-123", want: Credentials{APIKey: "abc-123"}},
		{name: "a key with a trailing newline", data: "abc-123\n", want: Credentials{APIKey: "abc-123"}},
		{
			name: "JSON with the key and the address",
			data: `{"api_key": "abc-123", "oneuptime_url": "https://oneuptime.example.com"}`,
			want: Credentials{APIKey: "abc-123", URL: "https://oneuptime.example.com"},
		},
		{
			name: "JSON in camelCase",
			data: `{"apiKey": "abc-123", "url": "https://oneuptime.example.com"}`,
			want: Credentials{APIKey: "abc-123", URL: "https://oneuptime.example.com"},
		},
		{name: "JSON with the key only", data: `{"api_key": "abc-123"}`, want: Credentials{APIKey: "abc-123"}},
		{name: "JSON without a key", data: `{"oneuptime_url": "https://oneuptime.example.com"}`, wantErr: errUnmarshalCredentials},
		{name: "JSON that does not parse", data: `{"api_key": `, wantErr: errUnmarshalCredentials},
		{name: "nothing", data: "", wantErr: errNoAPIKey},
		{name: "only spaces", data: "  \n", wantErr: errNoAPIKey},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseCredentials([]byte(c.data))
			if c.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), c.wantErr) {
					t.Fatalf("error %v, want one saying %q", err, c.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestConfiguration(t *testing.T) {
	cases := []struct {
		name    string
		url     string
		creds   Credentials
		wantURL string
	}{
		{name: "the ProviderConfig's url", url: "https://a.example.com", creds: Credentials{APIKey: "k", URL: "https://b.example.com"}, wantURL: "https://a.example.com"},
		{name: "else the credentials' url", url: " ", creds: Credentials{APIKey: "k", URL: "https://b.example.com"}, wantURL: "https://b.example.com"},
		{name: "else OneUptime Cloud", creds: Credentials{APIKey: "k"}, wantURL: DefaultURL},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Configuration(c.url, c.creds)
			if got["oneuptime_url"] != c.wantURL || got["api_key"] != "k" || len(got) != 2 {
				t.Fatalf("got %v, want oneuptime_url %s and api_key k", got, c.wantURL)
			}
		})
	}
}

func newScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(s); err != nil {
		t.Fatal(err)
	}
	if err := apis.AddToScheme(s); err != nil {
		t.Fatal(err)
	}
	return s
}

func secret(namespace, name, key, value string) *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name},
		Data:       map[string][]byte{key: []byte(value)},
	}
}

func label(namespace string, ref *xpv2.ProviderConfigReference) *v1alpha1.Label {
	l := &v1alpha1.Label{
		TypeMeta:   metav1.TypeMeta{APIVersion: v1alpha1.CRDGroupVersion.String(), Kind: v1alpha1.Label_Kind},
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: "production", UID: "6b6c8b52-0d0f-4c2b-9a51-0c3f0b8b9c11"},
	}
	l.SetProviderConfigReference(ref)
	return l
}

func setup(t *testing.T, kube client.Client, mg *v1alpha1.Label) (map[string]any, error) {
	t.Helper()
	ps, err := TerraformSetupBuilder("v1.2.3")(context.Background(), kube, mg)
	if err != nil {
		return nil, err
	}
	if ps.FrameworkProvider == nil {
		t.Fatal("no Terraform provider to run the resource with")
	}
	return ps.Configuration, nil
}

func TestAProviderConfigUsesTheSecretOfItsNamespace(t *testing.T) {
	kube := fake.NewClientBuilder().WithScheme(newScheme(t)).WithObjects(
		secret("team-a", "oneuptime", "api-key", "key-of-team-a"),
		&v1beta1.ProviderConfig{
			ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "default"},
			Spec: v1beta1.ProviderConfigSpec{
				URL: "https://oneuptime.example.com",
				Credentials: v1beta1.ProviderCredentials{
					Source:    xpv2.CredentialsSourceSecret,
					SecretRef: xpv2.LocalSecretKeySelector{LocalSecretReference: xpv2.LocalSecretReference{Name: "oneuptime"}, Key: "api-key"},
				},
			},
		},
	).Build()
	mg := label("team-a", &xpv2.ProviderConfigReference{Kind: v1beta1.ProviderConfigKind, Name: "default"})

	cfg, err := setup(t, kube, mg)
	if err != nil {
		t.Fatal(err)
	}
	if cfg["api_key"] != "key-of-team-a" || cfg["oneuptime_url"] != "https://oneuptime.example.com" {
		t.Fatalf("configuration %v", cfg)
	}

	// Crossplane keeps a ProviderConfig while a resource uses it.
	usages := &v1beta1.ProviderConfigUsageList{}
	if err := kube.List(context.Background(), usages, client.InNamespace("team-a")); err != nil {
		t.Fatal(err)
	}
	if len(usages.Items) != 1 || usages.Items[0].ProviderConfigReference.Name != "default" || usages.Items[0].ResourceReference.Name != "production" {
		t.Fatalf("usages %+v, want one of default by production", usages.Items)
	}
}

// A namespace's ProviderConfig names a Secret by name only: with the same
// name in another namespace, the key there is never read.
func TestAProviderConfigCannotReadAnotherNamespacesSecret(t *testing.T) {
	kube := fake.NewClientBuilder().WithScheme(newScheme(t)).WithObjects(
		secret("team-b", "oneuptime", "api-key", "key-of-team-b"),
		&v1beta1.ProviderConfig{
			ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "default"},
			Spec: v1beta1.ProviderConfigSpec{
				Credentials: v1beta1.ProviderCredentials{
					SecretRef: xpv2.LocalSecretKeySelector{LocalSecretReference: xpv2.LocalSecretReference{Name: "oneuptime"}, Key: "api-key"},
				},
			},
		},
	).Build()
	mg := label("team-a", &xpv2.ProviderConfigReference{Kind: v1beta1.ProviderConfigKind, Name: "default"})

	if _, err := setup(t, kube, mg); err == nil || !strings.Contains(err.Error(), errExtractCredentials) {
		t.Fatalf("error %v, want the API key not to be found", err)
	}
}

// A ProviderConfig of another namespace is never used either.
func TestAResourceUsesTheProviderConfigOfItsOwnNamespace(t *testing.T) {
	kube := fake.NewClientBuilder().WithScheme(newScheme(t)).WithObjects(
		secret("team-b", "oneuptime", "api-key", "key-of-team-b"),
		&v1beta1.ProviderConfig{
			ObjectMeta: metav1.ObjectMeta{Namespace: "team-b", Name: "default"},
			Spec: v1beta1.ProviderConfigSpec{
				Credentials: v1beta1.ProviderCredentials{
					SecretRef: xpv2.LocalSecretKeySelector{LocalSecretReference: xpv2.LocalSecretReference{Name: "oneuptime"}, Key: "api-key"},
				},
			},
		},
	).Build()
	mg := label("team-a", &xpv2.ProviderConfigReference{Kind: v1beta1.ProviderConfigKind, Name: "default"})

	if _, err := setup(t, kube, mg); err == nil || !strings.Contains(err.Error(), errGetProviderConfig) {
		t.Fatalf("error %v, want the ProviderConfig not to be found", err)
	}
}

func TestAClusterProviderConfigReadsASecretOfAnyNamespace(t *testing.T) {
	kube := fake.NewClientBuilder().WithScheme(newScheme(t)).WithObjects(
		secret("crossplane-system", "oneuptime", "credentials", `{"api_key": "platform-key", "oneuptime_url": "https://oneuptime.internal"}`),
		&v1beta1.ClusterProviderConfig{
			ObjectMeta: metav1.ObjectMeta{Name: "default"},
			Spec: v1beta1.ClusterProviderConfigSpec{
				Credentials: v1beta1.ClusterProviderCredentials{
					Source: xpv2.CredentialsSourceSecret,
					CommonCredentialSelectors: xpv2.CommonCredentialSelectors{
						SecretRef: &xpv2.SecretKeySelector{
							SecretReference: xpv2.SecretReference{Namespace: "crossplane-system", Name: "oneuptime"},
							Key:             "credentials",
						},
					},
				},
			},
		},
	).Build()
	mg := label("team-a", &xpv2.ProviderConfigReference{Kind: v1beta1.ClusterProviderConfigKind, Name: "default"})

	cfg, err := setup(t, kube, mg)
	if err != nil {
		t.Fatal(err)
	}
	if cfg["api_key"] != "platform-key" || cfg["oneuptime_url"] != "https://oneuptime.internal" {
		t.Fatalf("configuration %v", cfg)
	}
}

func TestAClusterProviderConfigReadsAnEnvironmentVariable(t *testing.T) {
	t.Setenv("ONEUPTIME_API_KEY", "key-from-the-pod")
	kube := fake.NewClientBuilder().WithScheme(newScheme(t)).WithObjects(
		&v1beta1.ClusterProviderConfig{
			ObjectMeta: metav1.ObjectMeta{Name: "default"},
			Spec: v1beta1.ClusterProviderConfigSpec{
				Credentials: v1beta1.ClusterProviderCredentials{
					Source:                    xpv2.CredentialsSourceEnvironment,
					CommonCredentialSelectors: xpv2.CommonCredentialSelectors{Env: &xpv2.EnvSelector{Name: "ONEUPTIME_API_KEY"}},
				},
			},
		},
	).Build()
	mg := label("team-a", &xpv2.ProviderConfigReference{Kind: v1beta1.ClusterProviderConfigKind, Name: "default"})

	cfg, err := setup(t, kube, mg)
	if err != nil {
		t.Fatal(err)
	}
	if cfg["api_key"] != "key-from-the-pod" || cfg["oneuptime_url"] != DefaultURL {
		t.Fatalf("configuration %v", cfg)
	}
}

func TestAResourceWithoutAProviderConfigIsRefused(t *testing.T) {
	kube := fake.NewClientBuilder().WithScheme(newScheme(t)).Build()
	cases := map[string]struct {
		ref  *xpv2.ProviderConfigReference
		want string
	}{
		"no reference":           {ref: nil, want: errNoProviderConfig},
		"a missing config":       {ref: &xpv2.ProviderConfigReference{Kind: v1beta1.ClusterProviderConfigKind, Name: "missing"}, want: errGetProviderConfig},
		"a kind that is unknown": {ref: &xpv2.ProviderConfigReference{Kind: "StoreConfig", Name: "default"}, want: "unsupported provider config kind"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := setup(t, kube, label("team-a", c.ref)); err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("error %v, want one saying %q", err, c.want)
			}
		})
	}
}

func TestTheAPIKeyMustBeThere(t *testing.T) {
	kube := fake.NewClientBuilder().WithScheme(newScheme(t)).WithObjects(
		secret("team-a", "oneuptime", "api-key", "  "),
		&v1beta1.ProviderConfig{
			ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "default"},
			Spec: v1beta1.ProviderConfigSpec{
				Credentials: v1beta1.ProviderCredentials{
					SecretRef: xpv2.LocalSecretKeySelector{LocalSecretReference: xpv2.LocalSecretReference{Name: "oneuptime"}, Key: "api-key"},
				},
			},
		},
	).Build()
	mg := label("team-a", &xpv2.ProviderConfigReference{Kind: v1beta1.ProviderConfigKind, Name: "default"})
	if _, err := setup(t, kube, mg); err == nil || !strings.Contains(err.Error(), errNoAPIKey) {
		t.Fatalf("error %v, want one saying %q", err, errNoAPIKey)
	}
}
