package providerconfig

import (
	"github.com/crossplane/crossplane-runtime/v2/pkg/errors"
	"github.com/crossplane/crossplane-runtime/v2/pkg/event"
	"github.com/crossplane/crossplane-runtime/v2/pkg/reconciler/providerconfig"
	"github.com/crossplane/crossplane-runtime/v2/pkg/resource"
	"github.com/crossplane/upjet/v2/pkg/controller"
	ctrl "sigs.k8s.io/controller-runtime"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/v1beta1"
)

// SetupWebhookWithManager registers the conversion webhook for ProviderConfig.
func SetupWebhookWithManager(mgr ctrl.Manager) error {
	if err := ctrl.NewWebhookManagedBy(mgr, &v1beta1.ProviderConfig{}).
		Complete(); err != nil {
		return errors.Wrap(err, "cannot register webhook for the kind v1beta1.ProviderConfig")
	}
	return nil
}

// Setup adds a controller that reconciles ProviderConfigs and ClusterProviderConfigs
// by accounting for their current usage.
func Setup(mgr ctrl.Manager, o controller.Options) error {
	if err := setupCluster(mgr, o); err != nil {
		return err
	}
	return setupNamespaced(mgr, o)
}

// setupCluster adds a controller that reconciles ClusterProviderConfigs by accounting for
// their current usage.
func setupCluster(mgr ctrl.Manager, o controller.Options) error {
	name := providerconfig.ControllerName(v1beta1.ClusterProviderConfigGroupKind)

	of := resource.ProviderConfigKinds{
		Config:    v1beta1.ClusterProviderConfigGroupVersionKind,
		Usage:     v1beta1.ProviderConfigUsageGroupVersionKind,
		UsageList: v1beta1.ProviderConfigUsageListGroupVersionKind,
	}

	return ctrl.NewControllerManagedBy(mgr).
		Named(name).
		WithOptions(o.ForControllerRuntime()).
		For(&v1beta1.ClusterProviderConfig{}).
		Watches(&v1beta1.ProviderConfigUsage{}, &resource.EnqueueRequestForProviderConfig{}).
		Complete(providerconfig.NewReconciler(mgr, of,
			providerconfig.WithLogger(o.Logger.WithValues("controller", name)),
			providerconfig.WithRecorder(event.NewAPIRecorder(mgr.GetEventRecorderFor(name))))) //nolint:staticcheck // suppress until crossplane-runtime offers the new recorder api
}

// setupNamespaced adds a controller that reconciles ProviderConfigs by accounting for
// their current usage.
func setupNamespaced(mgr ctrl.Manager, o controller.Options) error {
	name := providerconfig.ControllerName(v1beta1.ProviderConfigGroupKind)

	of := resource.ProviderConfigKinds{
		Config:    v1beta1.ProviderConfigGroupVersionKind,
		Usage:     v1beta1.ProviderConfigUsageGroupVersionKind,
		UsageList: v1beta1.ProviderConfigUsageListGroupVersionKind,
	}

	return ctrl.NewControllerManagedBy(mgr).
		Named(name).
		WithOptions(o.ForControllerRuntime()).
		For(&v1beta1.ProviderConfig{}).
		Watches(&v1beta1.ProviderConfigUsage{}, &resource.EnqueueRequestForProviderConfig{}).
		Complete(providerconfig.NewReconciler(mgr, of,
			providerconfig.WithLogger(o.Logger.WithValues("controller", name)),
			providerconfig.WithRecorder(event.NewAPIRecorder(mgr.GetEventRecorderFor(name))))) //nolint:staticcheck // suppress until crossplane-runtime offers the new recorder api
}

// SetupGated adds a controller that reconciles ProviderConfigs and ClusterProviderConfigs
// by accounting for their current usage.
func SetupGated(mgr ctrl.Manager, o controller.Options) error {
	o.Gate.Register(func() {
		if err := Setup(mgr, o); err != nil {
			mgr.GetLogger().Error(err, "unable to setup reconcilers", "gvk", v1beta1.ClusterProviderConfigGroupVersionKind.String(), "gvk", v1beta1.ProviderConfigGroupVersionKind.String())
		}
	}, v1beta1.ClusterProviderConfigGroupVersionKind, v1beta1.ProviderConfigGroupVersionKind, v1beta1.ProviderConfigUsageGroupVersionKind)
	return nil
}
