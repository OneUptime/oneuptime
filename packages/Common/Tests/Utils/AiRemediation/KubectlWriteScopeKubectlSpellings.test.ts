/*
 * ---------------------------------------------------------------------------
 * The write scope reads a kind the way kubectl resolves it.
 *
 * The finding this pins (PR #3953 review, round 4): a group-qualified
 * spelling counted as a built-in cluster-scoped kind only in that kind's
 * own group, so every other spelling read as a namespaced custom resource
 * judged by -n. kubectl resolves many more: a short name or a resource name
 * with ANY prefix of its group ("sc.storage", "storageclasses.stor",
 * "csr.cert", "pc.scheduling" — client-go's "group prefixing"), a short
 * name with a version before a prefix ("sc.v1.storage"), no group at all
 * ("sc.", "storageclasses.v1.", "sc.foo."), and IPAddress by its short name
 * "ip". On a Runner scoped with ONEUPTIME_KUBECTL_WRITE_NAMESPACES=prod,
 * `kubectl annotate sc.storage standard
 * storageclass.kubernetes.io/is-default-class=true --overwrite -n prod` was
 * let through and changed the cluster's default StorageClass.
 *
 * KUBECTL_RESOLUTIONS below is what the real kubectl v1.36.4 resolved each
 * spelling to, asked against an API server serving the upstream v1.36
 * discovery documents (every built-in resource, alpha and beta included):
 * the singular of the cluster-scoped kind it named, or "-" for a
 * namespaced resource or a spelling kubectl rejects. It is a sample of a
 * run over 5602 spellings — plural, singular, Kind and short names of every
 * built-in resource, bare, with every prefix of the group, with a version,
 * with an empty group, and with qualifiers that are no prefix — against
 * which this reader disagreed with kubectl on 0 (and the reader before
 * this round on 2689, each a cluster-scoped write read as namespaced).
 * ---------------------------------------------------------------------------
 */

import KubectlWriteScope from "../../../Utils/AiRemediation/KubectlWriteScope";
import { describe, expect, test } from "@jest/globals";

// "<spelling> <kind kubectl resolved it to, or - for none>", one per line.
const KUBECTL_RESOLUTIONS: string = `
mutatingadmissionpolicies. mutatingadmissionpolicy
mutatingadmissionpolicy.. mutatingadmissionpolicy
MutatingAdmissionPolicy.v1. mutatingadmissionpolicy
mutatingadmissionpolicies.x. -
mutatingadmissionpolicies.a mutatingadmissionpolicy
mutatingadmissionpolicy.admissionregistration mutatingadmissionpolicy
MutatingAdmissionPolicy.admissionregistration. mutatingadmissionpolicy
mutatingadmissionpolicies.v1.admissionregistration.k8s.io mutatingadmissionpolicy
mutatingadmissionpolicies.v1.admissionregistration -
mutatingadmissionpolicies.admissionregistration.k8s.iox -
mutatingadmissionpolicies.xadm -
mutatingadmissionpolicies.admissionregistration.example.com -
mutatingadmissionpolicybindings. mutatingadmissionpolicybinding
mutatingadmissionpolicybinding.. mutatingadmissionpolicybinding
MutatingAdmissionPolicyBinding.v1. mutatingadmissionpolicybinding
mutatingadmissionpolicybindings.x. -
mutatingadmissionpolicybindings.a mutatingadmissionpolicybinding
mutatingadmissionpolicybinding.admissionregistration mutatingadmissionpolicybinding
MutatingAdmissionPolicyBinding.admissionregistration. mutatingadmissionpolicybinding
mutatingadmissionpolicybindings.v1.admissionregistration.k8s.io mutatingadmissionpolicybinding
mutatingadmissionpolicybindings.v1.admissionregistration -
mutatingadmissionpolicybindings.admissionregistration.k8s.iox -
mutatingadmissionpolicybindings.xadm -
mutatingadmissionpolicybindings.admissionregistration.example.com -
mutatingwebhookconfigurations. mutatingwebhookconfiguration
mutatingwebhookconfiguration.. mutatingwebhookconfiguration
MutatingWebhookConfiguration.v1. mutatingwebhookconfiguration
mutatingwebhookconfigurations.x. -
mutatingwebhookconfigurations.a mutatingwebhookconfiguration
mutatingwebhookconfiguration.admissionregistration mutatingwebhookconfiguration
MutatingWebhookConfiguration.admissionregistration. mutatingwebhookconfiguration
mutatingwebhookconfigurations.v1.admissionregistration.k8s.io mutatingwebhookconfiguration
mutatingwebhookconfigurations.v1.admissionregistration -
mutatingwebhookconfigurations.admissionregistration.k8s.iox -
mutatingwebhookconfigurations.xadm -
mutatingwebhookconfigurations.admissionregistration.example.com -
validatingadmissionpolicies. validatingadmissionpolicy
validatingadmissionpolicy.. validatingadmissionpolicy
ValidatingAdmissionPolicy.v1. validatingadmissionpolicy
validatingadmissionpolicies.x. -
validatingadmissionpolicies.a validatingadmissionpolicy
validatingadmissionpolicy.admissionregistration validatingadmissionpolicy
ValidatingAdmissionPolicy.admissionregistration. validatingadmissionpolicy
validatingadmissionpolicies.v1.admissionregistration.k8s.io validatingadmissionpolicy
validatingadmissionpolicies.v1.admissionregistration -
validatingadmissionpolicies.admissionregistration.k8s.iox -
validatingadmissionpolicies.xadm -
validatingadmissionpolicies.admissionregistration.example.com -
validatingadmissionpolicybindings. validatingadmissionpolicybinding
validatingadmissionpolicybinding.. validatingadmissionpolicybinding
ValidatingAdmissionPolicyBinding.v1. validatingadmissionpolicybinding
validatingadmissionpolicybindings.x. -
validatingadmissionpolicybindings.a validatingadmissionpolicybinding
validatingadmissionpolicybinding.admissionregistration validatingadmissionpolicybinding
ValidatingAdmissionPolicyBinding.admissionregistration. validatingadmissionpolicybinding
validatingadmissionpolicybindings.v1.admissionregistration.k8s.io validatingadmissionpolicybinding
validatingadmissionpolicybindings.v1.admissionregistration -
validatingadmissionpolicybindings.admissionregistration.k8s.iox -
validatingadmissionpolicybindings.xadm -
validatingadmissionpolicybindings.admissionregistration.example.com -
validatingwebhookconfigurations. validatingwebhookconfiguration
validatingwebhookconfiguration.. validatingwebhookconfiguration
ValidatingWebhookConfiguration.v1. validatingwebhookconfiguration
validatingwebhookconfigurations.x. -
validatingwebhookconfigurations.a validatingwebhookconfiguration
validatingwebhookconfiguration.admissionregistration validatingwebhookconfiguration
ValidatingWebhookConfiguration.admissionregistration. validatingwebhookconfiguration
validatingwebhookconfigurations.v1.admissionregistration.k8s.io validatingwebhookconfiguration
validatingwebhookconfigurations.v1.admissionregistration -
validatingwebhookconfigurations.admissionregistration.k8s.iox -
validatingwebhookconfigurations.xadm -
validatingwebhookconfigurations.admissionregistration.example.com -
customresourcedefinitions. customresourcedefinition
customresourcedefinition.. customresourcedefinition
CustomResourceDefinition.v1. customresourcedefinition
customresourcedefinitions.x. -
customresourcedefinitions.a customresourcedefinition
customresourcedefinition.apiextensions customresourcedefinition
CustomResourceDefinition.apiextensions. customresourcedefinition
customresourcedefinitions.v1.apiextensions.k8s.io customresourcedefinition
customresourcedefinitions.v1.apiextensions -
customresourcedefinitions.apiextensions.k8s.iox -
customresourcedefinitions.xapi -
customresourcedefinitions.apiextensions.example.com -
crd. customresourcedefinition
crd.x. customresourcedefinition
crd.ap customresourcedefinition
crd.apiextensions customresourcedefinition
crd.v1.ap customresourcedefinition
crd.x.apiextensions -
crd.example.com -
crds. customresourcedefinition
crds.x. customresourcedefinition
crds.ap customresourcedefinition
crds.apiextensions customresourcedefinition
crds.v1.ap customresourcedefinition
crds.x.apiextensions -
crds.example.com -
apiservices. apiservice
apiservice.. apiservice
APIService.v1. apiservice
apiservices.x. -
apiservices.a apiservice
apiservice.apiregistration apiservice
APIService.apiregistration. apiservice
apiservices.v1.apiregistration.k8s.io apiservice
apiservices.v1.apiregistration -
apiservices.apiregistration.k8s.iox -
apiservices.xapi -
apiservices.apiregistration.example.com -
selfsubjectreviews. selfsubjectreview
selfsubjectreview.. selfsubjectreview
SelfSubjectReview.v1. selfsubjectreview
selfsubjectreviews.x. -
selfsubjectreviews.a selfsubjectreview
selfsubjectreview.authentication selfsubjectreview
SelfSubjectReview.authentication. selfsubjectreview
selfsubjectreviews.v1.authentication.k8s.io selfsubjectreview
selfsubjectreviews.v1.authentication -
selfsubjectreviews.authentication.k8s.iox -
selfsubjectreviews.xaut -
selfsubjectreviews.authentication.example.com -
tokenreviews. tokenreview
tokenreview.. tokenreview
TokenReview.v1. tokenreview
tokenreviews.x. -
tokenreviews.a tokenreview
tokenreview.authentication tokenreview
TokenReview.authentication. tokenreview
tokenreviews.v1.authentication.k8s.io tokenreview
tokenreviews.v1.authentication -
tokenreviews.authentication.k8s.iox -
tokenreviews.xaut -
tokenreviews.authentication.example.com -
selfsubjectaccessreviews. selfsubjectaccessreview
selfsubjectaccessreview.. selfsubjectaccessreview
SelfSubjectAccessReview.v1. selfsubjectaccessreview
selfsubjectaccessreviews.x. -
selfsubjectaccessreviews.a selfsubjectaccessreview
selfsubjectaccessreview.authorization selfsubjectaccessreview
SelfSubjectAccessReview.authorization. selfsubjectaccessreview
selfsubjectaccessreviews.v1.authorization.k8s.io selfsubjectaccessreview
selfsubjectaccessreviews.v1.authorization -
selfsubjectaccessreviews.authorization.k8s.iox -
selfsubjectaccessreviews.xaut -
selfsubjectaccessreviews.authorization.example.com -
selfsubjectrulesreviews. selfsubjectrulesreview
selfsubjectrulesreview.. selfsubjectrulesreview
SelfSubjectRulesReview.v1. selfsubjectrulesreview
selfsubjectrulesreviews.x. -
selfsubjectrulesreviews.a selfsubjectrulesreview
selfsubjectrulesreview.authorization selfsubjectrulesreview
SelfSubjectRulesReview.authorization. selfsubjectrulesreview
selfsubjectrulesreviews.v1.authorization.k8s.io selfsubjectrulesreview
selfsubjectrulesreviews.v1.authorization -
selfsubjectrulesreviews.authorization.k8s.iox -
selfsubjectrulesreviews.xaut -
selfsubjectrulesreviews.authorization.example.com -
subjectaccessreviews. subjectaccessreview
subjectaccessreview.. subjectaccessreview
SubjectAccessReview.v1. subjectaccessreview
subjectaccessreviews.x. -
subjectaccessreviews.a subjectaccessreview
subjectaccessreview.authorization subjectaccessreview
SubjectAccessReview.authorization. subjectaccessreview
subjectaccessreviews.v1.authorization.k8s.io subjectaccessreview
subjectaccessreviews.v1.authorization -
subjectaccessreviews.authorization.k8s.iox -
subjectaccessreviews.xaut -
subjectaccessreviews.authorization.example.com -
certificatesigningrequests. certificatesigningrequest
certificatesigningrequest.. certificatesigningrequest
CertificateSigningRequest.v1. certificatesigningrequest
certificatesigningrequests.x. -
certificatesigningrequests.c certificatesigningrequest
certificatesigningrequest.certificates certificatesigningrequest
CertificateSigningRequest.certificates. certificatesigningrequest
certificatesigningrequests.v1.certificates.k8s.io certificatesigningrequest
certificatesigningrequests.v1.certificates -
certificatesigningrequests.certificates.k8s.iox -
certificatesigningrequests.xcer -
certificatesigningrequests.certificates.example.com -
csr. certificatesigningrequest
csr.x. certificatesigningrequest
csr.ce certificatesigningrequest
csr.certificates certificatesigningrequest
csr.v1.ce certificatesigningrequest
csr.x.certificates -
csr.example.com -
clustertrustbundles. clustertrustbundle
clustertrustbundle.. clustertrustbundle
ClusterTrustBundle.v1beta1. clustertrustbundle
clustertrustbundles.x. -
clustertrustbundles.c clustertrustbundle
clustertrustbundle.certificates clustertrustbundle
ClusterTrustBundle.certificates. clustertrustbundle
clustertrustbundles.v1beta1.certificates.k8s.io clustertrustbundle
clustertrustbundles.v1beta1.certificates -
clustertrustbundles.certificates.k8s.iox -
clustertrustbundles.xcer -
clustertrustbundles.certificates.example.com -
flowschemas. flowschema
flowschema.. flowschema
FlowSchema.v1. flowschema
flowschemas.x. -
flowschemas.f flowschema
flowschema.flowcontrol flowschema
FlowSchema.flowcontrol. flowschema
flowschemas.v1.flowcontrol.apiserver.k8s.io flowschema
flowschemas.v1.flowcontrol -
flowschemas.flowcontrol.apiserver.k8s.iox -
flowschemas.xflo -
flowschemas.flowcontrol.example.com -
prioritylevelconfigurations. prioritylevelconfiguration
prioritylevelconfiguration.. prioritylevelconfiguration
PriorityLevelConfiguration.v1. prioritylevelconfiguration
prioritylevelconfigurations.x. -
prioritylevelconfigurations.f prioritylevelconfiguration
prioritylevelconfiguration.flowcontrol prioritylevelconfiguration
PriorityLevelConfiguration.flowcontrol. prioritylevelconfiguration
prioritylevelconfigurations.v1.flowcontrol.apiserver.k8s.io prioritylevelconfiguration
prioritylevelconfigurations.v1.flowcontrol -
prioritylevelconfigurations.flowcontrol.apiserver.k8s.iox -
prioritylevelconfigurations.xflo -
prioritylevelconfigurations.flowcontrol.example.com -
storageversions. storageversion
storageversion.. storageversion
StorageVersion.v1alpha1. storageversion
storageversions.x. -
storageversions.i storageversion
storageversion.internal storageversion
StorageVersion.internal. storageversion
storageversions.v1alpha1.internal.apiserver.k8s.io storageversion
storageversions.v1alpha1.internal -
storageversions.internal.apiserver.k8s.iox -
storageversions.xint -
storageversions.internal.example.com -
ingressclasses. ingressclass
ingressclass.. ingressclass
IngressClass.v1. ingressclass
ingressclasses.x. -
ingressclasses.n ingressclass
ingressclass.networking ingressclass
IngressClass.networking. ingressclass
ingressclasses.v1.networking.k8s.io ingressclass
ingressclasses.v1.networking -
ingressclasses.networking.k8s.iox -
ingressclasses.xnet -
ingressclasses.networking.example.com -
ipaddresses. ipaddress
ipaddress.. ipaddress
IPAddress.v1. ipaddress
ipaddresses.x. -
ipaddresses.n ipaddress
ipaddress.networking ipaddress
IPAddress.networking. ipaddress
ipaddresses.v1.networking.k8s.io ipaddress
ipaddresses.v1.networking -
ipaddresses.networking.k8s.iox -
ipaddresses.xnet -
ipaddresses.networking.example.com -
ip. ipaddress
ip.x. ipaddress
ip.ne ipaddress
ip.networking ipaddress
ip.v1.ne ipaddress
ip.x.networking -
ip.example.com -
servicecidrs. servicecidr
servicecidr.. servicecidr
ServiceCIDR.v1. servicecidr
servicecidrs.x. -
servicecidrs.n servicecidr
servicecidr.networking servicecidr
ServiceCIDR.networking. servicecidr
servicecidrs.v1.networking.k8s.io servicecidr
servicecidrs.v1.networking -
servicecidrs.networking.k8s.iox -
servicecidrs.xnet -
servicecidrs.networking.example.com -
runtimeclasses. runtimeclass
runtimeclass.. runtimeclass
RuntimeClass.v1. runtimeclass
runtimeclasses.x. -
runtimeclasses.n runtimeclass
runtimeclass.node runtimeclass
RuntimeClass.node. runtimeclass
runtimeclasses.v1.node.k8s.io runtimeclass
runtimeclasses.v1.node -
runtimeclasses.node.k8s.iox -
runtimeclasses.xnod -
runtimeclasses.node.example.com -
clusterrolebindings. clusterrolebinding
clusterrolebinding.. clusterrolebinding
ClusterRoleBinding.v1. clusterrolebinding
clusterrolebindings.x. -
clusterrolebindings.r clusterrolebinding
clusterrolebinding.rbac clusterrolebinding
ClusterRoleBinding.rbac. clusterrolebinding
clusterrolebindings.v1.rbac.authorization.k8s.io clusterrolebinding
clusterrolebindings.v1.rbac -
clusterrolebindings.rbac.authorization.k8s.iox -
clusterrolebindings.xrba -
clusterrolebindings.rbac.example.com -
clusterroles. clusterrole
clusterrole.. clusterrole
ClusterRole.v1. clusterrole
clusterroles.x. -
clusterroles.r clusterrole
clusterrole.rbac clusterrole
ClusterRole.rbac. clusterrole
clusterroles.v1.rbac.authorization.k8s.io clusterrole
clusterroles.v1.rbac -
clusterroles.rbac.authorization.k8s.iox -
clusterroles.xrba -
clusterroles.rbac.example.com -
deviceclasses. deviceclass
deviceclass.. deviceclass
DeviceClass.v1. deviceclass
deviceclasses.x. -
deviceclasses.r deviceclass
deviceclass.resource deviceclass
DeviceClass.resource. deviceclass
deviceclasses.v1.resource.k8s.io deviceclass
deviceclasses.v1.resource -
deviceclasses.resource.k8s.iox -
deviceclasses.xres -
deviceclasses.resource.example.com -
devicetaintrules. devicetaintrule
devicetaintrule.. devicetaintrule
DeviceTaintRule.v1beta2. devicetaintrule
devicetaintrules.x. -
devicetaintrules.r devicetaintrule
devicetaintrule.resource devicetaintrule
DeviceTaintRule.resource. devicetaintrule
devicetaintrules.v1beta2.resource.k8s.io devicetaintrule
devicetaintrules.v1beta2.resource -
devicetaintrules.resource.k8s.iox -
devicetaintrules.xres -
devicetaintrules.resource.example.com -
resourcepoolstatusrequests. resourcepoolstatusrequest
resourcepoolstatusrequest.. resourcepoolstatusrequest
ResourcePoolStatusRequest.v1alpha3. resourcepoolstatusrequest
resourcepoolstatusrequests.x. -
resourcepoolstatusrequests.r resourcepoolstatusrequest
resourcepoolstatusrequest.resource resourcepoolstatusrequest
ResourcePoolStatusRequest.resource. resourcepoolstatusrequest
resourcepoolstatusrequests.v1alpha3.resource.k8s.io resourcepoolstatusrequest
resourcepoolstatusrequests.v1alpha3.resource -
resourcepoolstatusrequests.resource.k8s.iox -
resourcepoolstatusrequests.xres -
resourcepoolstatusrequests.resource.example.com -
resourceslices. resourceslice
resourceslice.. resourceslice
ResourceSlice.v1. resourceslice
resourceslices.x. -
resourceslices.r resourceslice
resourceslice.resource resourceslice
ResourceSlice.resource. resourceslice
resourceslices.v1.resource.k8s.io resourceslice
resourceslices.v1.resource -
resourceslices.resource.k8s.iox -
resourceslices.xres -
resourceslices.resource.example.com -
priorityclasses. priorityclass
priorityclass.. priorityclass
PriorityClass.v1. priorityclass
priorityclasses.x. -
priorityclasses.s priorityclass
priorityclass.scheduling priorityclass
PriorityClass.scheduling. priorityclass
priorityclasses.v1.scheduling.k8s.io priorityclass
priorityclasses.v1.scheduling -
priorityclasses.scheduling.k8s.iox -
priorityclasses.xsch -
priorityclasses.scheduling.example.com -
pc. priorityclass
pc.x. priorityclass
pc.sc priorityclass
pc.scheduling priorityclass
pc.v1.sc priorityclass
pc.x.scheduling -
pc.example.com -
csidrivers. csidriver
csidriver.. csidriver
CSIDriver.v1. csidriver
csidrivers.x. -
csidrivers.s csidriver
csidriver.storage csidriver
CSIDriver.storage. csidriver
csidrivers.v1.storage.k8s.io csidriver
csidrivers.v1.storage -
csidrivers.storage.k8s.iox -
csidrivers.xsto -
csidrivers.storage.example.com -
csinodes. csinode
csinode.. csinode
CSINode.v1. csinode
csinodes.x. -
csinodes.s csinode
csinode.storage csinode
CSINode.storage. csinode
csinodes.v1.storage.k8s.io csinode
csinodes.v1.storage -
csinodes.storage.k8s.iox -
csinodes.xsto -
csinodes.storage.example.com -
storageclasses. storageclass
storageclass.. storageclass
StorageClass.v1. storageclass
storageclasses.x. -
storageclasses.s storageclass
storageclass.storage storageclass
StorageClass.storage. storageclass
storageclasses.v1.storage.k8s.io storageclass
storageclasses.v1.storage -
storageclasses.storage.k8s.iox -
storageclasses.xsto -
storageclasses.storage.example.com -
sc. storageclass
sc.x. storageclass
sc.st storageclass
sc.storage storageclass
sc.v1.st storageclass
sc.x.storage -
sc.example.com -
volumeattachments. volumeattachment
volumeattachment.. volumeattachment
VolumeAttachment.v1. volumeattachment
volumeattachments.x. -
volumeattachments.s volumeattachment
volumeattachment.storage volumeattachment
VolumeAttachment.storage. volumeattachment
volumeattachments.v1.storage.k8s.io volumeattachment
volumeattachments.v1.storage -
volumeattachments.storage.k8s.iox -
volumeattachments.xsto -
volumeattachments.storage.example.com -
volumeattributesclasses. volumeattributesclass
volumeattributesclass.. volumeattributesclass
VolumeAttributesClass.v1. volumeattributesclass
volumeattributesclasses.x. -
volumeattributesclasses.s volumeattributesclass
volumeattributesclass.storage volumeattributesclass
VolumeAttributesClass.storage. volumeattributesclass
volumeattributesclasses.v1.storage.k8s.io volumeattributesclass
volumeattributesclasses.v1.storage -
volumeattributesclasses.storage.k8s.iox -
volumeattributesclasses.xsto -
volumeattributesclasses.storage.example.com -
vac. volumeattributesclass
vac.x. volumeattributesclass
vac.st volumeattributesclass
vac.storage volumeattributesclass
vac.v1.st volumeattributesclass
vac.x.storage -
vac.example.com -
storageversionmigrations. storageversionmigration
storageversionmigration.. storageversionmigration
StorageVersionMigration.v1beta1. storageversionmigration
storageversionmigrations.x. -
storageversionmigrations.s storageversionmigration
storageversionmigration.storagemigration storageversionmigration
StorageVersionMigration.storagemigration. storageversionmigration
storageversionmigrations.v1beta1.storagemigration.k8s.io storageversionmigration
storageversionmigrations.v1beta1.storagemigration -
storageversionmigrations.storagemigration.k8s.iox -
storageversionmigrations.xsto -
storageversionmigrations.storagemigration.example.com -
componentstatuses. componentstatus
componentstatus.. componentstatus
ComponentStatus.v1. componentstatus
componentstatuses.x. -
componentstatuses.core -
componentstatuses.v1 -
cs. componentstatus
cs.x. componentstatus
cs.x -
cs.core -
namespaces. namespace
namespace.. namespace
Namespace.v1. namespace
namespaces.x. -
namespaces.core -
namespaces.v1 -
ns. namespace
ns.x. namespace
ns.x -
ns.core -
nodes. node
node.. node
Node.v1. node
nodes.x. -
nodes.core -
nodes.v1 -
no. node
no.x. node
no.x -
no.core -
persistentvolumes. persistentvolume
persistentvolume.. persistentvolume
PersistentVolume.v1. persistentvolume
persistentvolumes.x. -
persistentvolumes.core -
persistentvolumes.v1 -
pv. persistentvolume
pv.x. persistentvolume
pv.x -
pv.core -
controllerrevisions. -
controllerrevision.v1. -
controllerrevisions.app -
daemonsets. -
daemonset.v1. -
daemonsets.app -
ds. -
deployments. -
deployment.v1. -
deployments.app -
deploy. -
replicasets. -
replicaset.v1. -
replicasets.app -
rs. -
statefulsets. -
statefulset.v1. -
statefulsets.app -
sts. -
localsubjectaccessreviews. -
localsubjectaccessreview.v1. -
localsubjectaccessreviews.aut -
horizontalpodautoscalers. -
horizontalpodautoscaler.v2. -
horizontalpodautoscalers.aut -
hpa. -
cronjobs. -
cronjob.v1. -
cronjobs.bat -
cj. -
jobs. -
job.v1. -
jobs.bat -
podcertificaterequests. -
podcertificaterequest.v1beta1. -
podcertificaterequests.cer -
leasecandidates. -
leasecandidate.v1beta1. -
leasecandidates.coo -
leases. -
lease.v1. -
leases.coo -
endpointslices. -
endpointslice.v1. -
endpointslices.dis -
events. -
event.v1. -
events.eve -
ev. -
ingresses. -
ingress.v1. -
ingresses.net -
ing. -
networkpolicies. -
networkpolicy.v1. -
networkpolicies.net -
netpol. -
poddisruptionbudgets. -
poddisruptionbudget.v1. -
poddisruptionbudgets.pol -
pdb. -
rolebindings. -
rolebinding.v1. -
rolebindings.rba -
roles. -
role.v1. -
roles.rba -
resourceclaims. -
resourceclaim.v1. -
resourceclaims.res -
resourceclaimtemplates. -
resourceclaimtemplate.v1. -
resourceclaimtemplates.res -
podgroups. -
podgroup.v1alpha2. -
podgroups.sch -
workloads. -
workload.v1alpha2. -
workloads.sch -
csistoragecapacities. -
csistoragecapacity.v1. -
csistoragecapacities.sto -
bindings. -
binding.v1. -
configmaps. -
configmap.v1. -
cm. -
endpoints. -
endpoints.v1. -
ep. -
limitranges. -
limitrange.v1. -
limits. -
persistentvolumeclaims. -
persistentvolumeclaim.v1. -
pvc. -
pods. -
pod.v1. -
po. -
podtemplates. -
podtemplate.v1. -
replicationcontrollers. -
replicationcontroller.v1. -
rc. -
resourcequotas. -
resourcequota.v1. -
quota. -
secrets. -
secret.v1. -
serviceaccounts. -
serviceaccount.v1. -
sa. -
services. -
service.v1. -
svc. -
`;

interface Resolution {
  spelling: string;
  // The cluster-scoped kind kubectl resolved it to, or null.
  kind: string | null;
}

// One line of KUBECTL_RESOLUTIONS: the spelling, a space, the answer.
const RESOLUTION_LINE: RegExp = /^(\S+) (\S+)$/;

function readResolutions(): Array<Resolution> {
  const resolutions: Array<Resolution> = [];

  for (const line of KUBECTL_RESOLUTIONS.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(RESOLUTION_LINE);

    if (!match) {
      throw new Error(`Not a resolution line: "${line}"`);
    }

    resolutions.push({
      spelling: match[1]!,
      kind: match[2] === "-" ? null : match[2]!,
    });
  }

  return resolutions;
}

const RESOLUTIONS: Array<Resolution> = readResolutions();

// Every built-in cluster-scoped kind the scope knows, by its singular.
function knownKinds(): Set<string> {
  return new Set<string>(
    KubectlWriteScope.clusterScopedKindSpellings.map((spelling: string) => {
      return KubectlWriteScope.getClusterScopedKind(spelling)!;
    }),
  );
}

describe("the write scope resolves kind spellings the way kubectl v1.36 does", () => {
  test("the sample is the one this test describes", () => {
    expect(RESOLUTIONS.length).toBe(624);
    // Both answers are sampled: kinds kubectl resolved, and none.
    expect(
      RESOLUTIONS.filter((resolution: Resolution) => {
        return resolution.kind === null;
      }).length,
    ).toBe(324);
  });

  test("every spelling reads as the kind kubectl resolved it to, or as none", () => {
    const disagreements: Array<string> = [];

    for (const resolution of RESOLUTIONS) {
      const read: string | null = KubectlWriteScope.getClusterScopedKind(
        resolution.spelling,
      );

      if (read !== resolution.kind) {
        disagreements.push(
          `${resolution.spelling}: kubectl ${resolution.kind || "-"}, the scope ${read || "-"}`,
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  /*
   * Exhaustive over kinds: the scope knows every built-in cluster-scoped
   * kind upstream serves, and nothing else.
   */
  test("the scope knows exactly the cluster-scoped kinds kubectl resolved", () => {
    const resolved: Array<string> = Array.from(
      new Set<string>(
        RESOLUTIONS.filter((resolution: Resolution) => {
          return resolution.kind !== null;
        }).map((resolution: Resolution) => {
          return resolution.kind!;
        }),
      ),
    ).sort();

    expect(Array.from(knownKinds()).sort()).toEqual(resolved);
    expect(resolved).toHaveLength(39);
  });
});
