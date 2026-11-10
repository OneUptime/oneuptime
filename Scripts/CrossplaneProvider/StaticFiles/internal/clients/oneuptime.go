// Package clients connects a managed resource to the OneUptime project its
// ProviderConfig (or ClusterProviderConfig) has the API key of.
package clients

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/crossplane/crossplane-runtime/v2/pkg/resource"
	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"
	"github.com/crossplane/upjet/v2/pkg/terraform"
	"github.com/pkg/errors"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/oneuptime/terraform-provider-oneuptime/xpprovider"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/v1beta1"
)

const (
	// DefaultURL is the OneUptime a ProviderConfig without a url manages.
	DefaultURL = "https://oneuptime.com"

	errNoProviderConfig     = "no providerConfigRef provided"
	errGetProviderConfig    = "cannot get referenced ProviderConfig"
	errTrackUsage           = "cannot track ProviderConfig usage"
	errExtractCredentials   = "cannot read the API key"
	errUnmarshalCredentials = "cannot read the API key: the credentials are JSON without an api_key"
	errNoAPIKey             = "the credentials hold no API key"
)

// Credentials are what a ProviderConfig's credentials hold: the API key on
// its own, or a JSON object with api_key (and, optionally, oneuptime_url).
type Credentials struct {
	APIKey string
	URL    string
}

// ParseCredentials reads the credentials a ProviderConfig points at.
func ParseCredentials(data []byte) (Credentials, error) {
	text := strings.TrimSpace(string(data))
	if text == "" {
		return Credentials{}, errors.New(errNoAPIKey)
	}
	if !strings.HasPrefix(text, "{") {
		return Credentials{APIKey: text}, nil
	}
	values := map[string]string{}
	if err := json.Unmarshal([]byte(text), &values); err != nil {
		return Credentials{}, errors.Wrap(err, errUnmarshalCredentials)
	}
	creds := Credentials{
		APIKey: strings.TrimSpace(firstOf(values, "api_key", "apiKey")),
		URL:    strings.TrimSpace(firstOf(values, "oneuptime_url", "oneuptimeUrl", "url")),
	}
	if creds.APIKey == "" {
		return Credentials{}, errors.New(errUnmarshalCredentials)
	}
	return creds, nil
}

func firstOf(values map[string]string, keys ...string) string {
	for _, k := range keys {
		if v, ok := values[k]; ok && v != "" {
			return v
		}
	}
	return ""
}

// Configuration is the Terraform provider configuration of a ProviderConfig:
// its url, else the one in its credentials, else OneUptime Cloud.
func Configuration(url string, creds Credentials) map[string]any {
	url = strings.TrimSpace(url)
	if url == "" {
		url = creds.URL
	}
	if url == "" {
		url = DefaultURL
	}
	return map[string]any{
		"oneuptime_url": url,
		"api_key":       creds.APIKey,
	}
}

// TerraformSetupBuilder returns the function that connects a managed
// resource to the project of its ProviderConfig.
func TerraformSetupBuilder(version string) terraform.SetupFn {
	return func(ctx context.Context, c client.Client, mg resource.Managed) (terraform.Setup, error) {
		ps := terraform.Setup{}
		mr, ok := mg.(resource.ModernManaged)
		if !ok {
			return ps, errors.Errorf("%T is not a namespaced managed resource", mg)
		}
		pc, err := resolveProviderConfig(ctx, c, mr)
		if err != nil {
			return ps, err
		}
		data, err := resource.CommonCredentialExtractor(ctx, pc.source, c, pc.selectors)
		if err != nil {
			return ps, errors.Wrap(err, errExtractCredentials)
		}
		creds, err := ParseCredentials(data)
		if err != nil {
			return ps, err
		}
		ps.Configuration = Configuration(pc.url, creds)
		// A provider of its own for each connection: two ProviderConfigs
		// never share a configured client.
		ps.FrameworkProvider = xpprovider.FrameworkProvider(version)
		return ps, nil
	}
}

// providerConfig is a ProviderConfig or a ClusterProviderConfig, read the
// same way: where the API key is, and which OneUptime it is for.
type providerConfig struct {
	url       string
	source    xpv2.CredentialsSource
	selectors xpv2.CommonCredentialSelectors
}

// fromProviderConfig reads a namespaced ProviderConfig. Its Secret is always
// one of its own namespace, so no namespace can read another's API key.
func fromProviderConfig(pc *v1beta1.ProviderConfig) providerConfig {
	ref := pc.Spec.Credentials.SecretRef
	return providerConfig{
		url:       pc.Spec.URL,
		source:    xpv2.CredentialsSourceSecret,
		selectors: xpv2.CommonCredentialSelectors{SecretRef: ref.ToSecretKeySelector(pc.GetNamespace())},
	}
}

// fromClusterProviderConfig reads a ClusterProviderConfig, which a platform
// team sets up for every namespace.
func fromClusterProviderConfig(cpc *v1beta1.ClusterProviderConfig) providerConfig {
	return providerConfig{
		url:       cpc.Spec.URL,
		source:    cpc.Spec.Credentials.Source,
		selectors: cpc.Spec.Credentials.CommonCredentialSelectors,
	}
}

func resolveProviderConfig(ctx context.Context, c client.Client, mg resource.ModernManaged) (providerConfig, error) {
	ref := mg.GetProviderConfigReference()
	if ref == nil {
		return providerConfig{}, errors.New(errNoProviderConfig)
	}
	var pc providerConfig
	switch ref.Kind {
	case v1beta1.ProviderConfigKind:
		obj := &v1beta1.ProviderConfig{}
		if err := c.Get(ctx, types.NamespacedName{Name: ref.Name, Namespace: mg.GetNamespace()}, obj); err != nil {
			return providerConfig{}, errors.Wrap(err, errGetProviderConfig)
		}
		pc = fromProviderConfig(obj)
	case v1beta1.ClusterProviderConfigKind:
		obj := &v1beta1.ClusterProviderConfig{}
		if err := c.Get(ctx, types.NamespacedName{Name: ref.Name}, obj); err != nil {
			return providerConfig{}, errors.Wrap(err, errGetProviderConfig)
		}
		pc = fromClusterProviderConfig(obj)
	default:
		return providerConfig{}, errors.Errorf("unsupported provider config kind %q", ref.Kind)
	}
	tracker := resource.NewProviderConfigUsageTracker(c, &v1beta1.ProviderConfigUsage{})
	if err := tracker.Track(ctx, mg); err != nil {
		return providerConfig{}, errors.Wrap(err, errTrackUsage)
	}
	return pc, nil
}
