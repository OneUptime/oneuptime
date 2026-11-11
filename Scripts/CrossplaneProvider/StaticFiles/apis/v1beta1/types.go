package v1beta1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"
)

// A ProviderConfigSpec says which OneUptime project the managed resources of
// its namespace belong to.
type ProviderConfigSpec struct {
	// The address of your OneUptime, such as https://oneuptime.com or your
	// own installation's. Leave out /api: the provider adds it. Left out, it
	// is the oneuptime_url of JSON credentials, else https://oneuptime.com.
	// +optional
	URL string `json:"url,omitempty"`

	// Credentials point at the project API key, in a Secret of the
	// ProviderConfig's own namespace.
	Credentials ProviderCredentials `json:"credentials"`
}

// ProviderCredentials point at an API key in a Secret of the ProviderConfig's
// namespace. A ProviderConfig cannot read another namespace's Secrets; a
// ClusterProviderConfig can.
type ProviderCredentials struct {
	// Source of the API key. A ProviderConfig reads it from a Secret.
	// +kubebuilder:validation:Enum=Secret
	// +kubebuilder:default=Secret
	// +optional
	Source xpv2.CredentialsSource `json:"source,omitempty"`

	// The key of a Secret in the ProviderConfig's namespace that holds the
	// API key, either on its own or as JSON with an api_key field.
	SecretRef xpv2.LocalSecretKeySelector `json:"secretRef"`
}

// A ClusterProviderConfigSpec says which OneUptime project the managed
// resources that name it belong to, in any namespace.
type ClusterProviderConfigSpec struct {
	// The address of your OneUptime, such as https://oneuptime.com or your
	// own installation's. Leave out /api: the provider adds it. Left out, it
	// is the oneuptime_url of JSON credentials, else https://oneuptime.com.
	// +optional
	URL string `json:"url,omitempty"`

	// Credentials point at the project API key.
	Credentials ClusterProviderCredentials `json:"credentials"`
}

// ClusterProviderCredentials point at an API key in a Secret of any
// namespace, an environment variable or a file of the provider's pod.
type ClusterProviderCredentials struct {
	// Source of the API key.
	// +kubebuilder:validation:Enum=Secret;Environment;Filesystem
	Source xpv2.CredentialsSource `json:"source"`

	xpv2.CommonCredentialSelectors `json:",inline"`
}

// A ProviderConfigStatus reflects the observed state of a ProviderConfig.
type ProviderConfigStatus struct {
	xpv2.ProviderConfigStatus `json:",inline"`
}

// +kubebuilder:object:root=true

// A ProviderConfig connects the managed resources of its namespace to a
// OneUptime project.
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="URL",type="string",JSONPath=".spec.url"
// +kubebuilder:printcolumn:name="SECRET-NAME",type="string",JSONPath=".spec.credentials.secretRef.name",priority=1
// +kubebuilder:printcolumn:name="AGE",type="date",JSONPath=".metadata.creationTimestamp"
// +kubebuilder:resource:scope=Namespaced,categories={crossplane,provider,oneuptime}
type ProviderConfig struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   ProviderConfigSpec   `json:"spec"`
	Status ProviderConfigStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// ProviderConfigList contains a list of ProviderConfig.
type ProviderConfigList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ProviderConfig `json:"items"`
}

// +kubebuilder:object:root=true

// A ProviderConfigUsage indicates that a resource is using a ProviderConfig.
// +kubebuilder:printcolumn:name="AGE",type="date",JSONPath=".metadata.creationTimestamp"
// +kubebuilder:printcolumn:name="CONFIG-NAME",type="string",JSONPath=".providerConfigRef.name"
// +kubebuilder:printcolumn:name="RESOURCE-KIND",type="string",JSONPath=".resourceRef.kind"
// +kubebuilder:printcolumn:name="RESOURCE-NAME",type="string",JSONPath=".resourceRef.name"
// +kubebuilder:resource:scope=Namespaced,categories={crossplane,provider,oneuptime}
type ProviderConfigUsage struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	xpv2.TypedProviderConfigUsage `json:",inline"`
}

// +kubebuilder:object:root=true

// ProviderConfigUsageList contains a list of ProviderConfigUsage
type ProviderConfigUsageList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ProviderConfigUsage `json:"items"`
}

// +kubebuilder:object:root=true

// A ClusterProviderConfig connects managed resources in any namespace to a
// OneUptime project.
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="URL",type="string",JSONPath=".spec.url"
// +kubebuilder:printcolumn:name="SOURCE",type="string",JSONPath=".spec.credentials.source",priority=1
// +kubebuilder:printcolumn:name="AGE",type="date",JSONPath=".metadata.creationTimestamp"
// +kubebuilder:resource:scope=Cluster,categories={crossplane,provider,oneuptime}
type ClusterProviderConfig struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   ClusterProviderConfigSpec `json:"spec"`
	Status ProviderConfigStatus      `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// ClusterProviderConfigList contains a list of ClusterProviderConfig.
type ClusterProviderConfigList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ClusterProviderConfig `json:"items"`
}
