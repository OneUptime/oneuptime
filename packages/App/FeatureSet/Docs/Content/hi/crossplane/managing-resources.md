# संसाधनों का प्रबंधन

आपके पहले संसाधन चल जाने के बाद, यह पेज प्रदाता के संसाधनों के बारे में बताता है: काइंड और फ़ील्ड के नाम कैसे रखे जाते हैं, संसाधन एक-दूसरे का संदर्भ कैसे देते हैं, आपके प्रोजेक्ट में पहले से मौजूद चीज़ों को कैसे लाएँ, OneUptime के बनाए सीक्रेट, Kubernetes के बाहर किए गए बदलावों का क्या होता है, और कोई संसाधन तैयार न हो तो क्या देखें। प्रदाता इंस्टॉल करने और अपने पहले संसाधन बनाने के लिए, [Crossplane अवलोकन](/docs/crossplane/index) से शुरू करें।

:::cards
- [काइंड और फ़ील्ड](#काइंड-और-फ़ील्ड): वे Terraform संसाधन जिनसे ये बनते हैं, और इनके नाम कैसे रखे जाते हैं।
- [दूसरे संसाधनों का संदर्भ दें](#दूसरे-संसाधनों-का-संदर्भ-दें): ID के बजाय नाम, किसी मॉनिटर के चरणों की किसी भी गहराई पर।
- [जो आपके पास पहले से है, उसे आयात करें](#जो-आपके-पास-पहले-से-है-उसे-आयात-करें): किसी रिकॉर्ड को उसकी ID से ऑब्ज़र्व करें, फिर उसका प्रबंधन अपने हाथ में लें।
- [किसी संसाधन की समस्या हल करें](#किसी-संसाधन-की-समस्या-हल-करें): उसकी कंडीशन, उसके इवेंट और प्रदाता के लॉग।
:::

## काइंड और फ़ील्ड

[Terraform प्रदाता](/docs/terraform/index) का हर संसाधन एक काइंड है, जिसका नाम CamelCase में होता है: `oneuptime_status_page` से `StatusPage` बनता है, और `oneuptime_on_call_policy` से `OnCallPolicy`। जो नाम Spec, Status या List पर खत्म होता, उसमें Definition जोड़ दिया जाता है, इसलिए `oneuptime_monitor_status` से `MonitorStatusDefinition` बनता है। कुछ काइंड:

| काइंड | किसका रिकॉर्ड | Terraform संसाधन |
| --- | --- | --- |
| `Monitor` | एक मॉनिटर | `oneuptime_monitor` |
| `StatusPage` | एक स्थिति पृष्ठ | `oneuptime_status_page` |
| `OnCallPolicy` | एक ऑन-कॉल नीति | `oneuptime_on_call_policy` |
| `Team` | एक टीम | `oneuptime_team` |
| `Label` | एक लेबल | `oneuptime_label` |
| `IncidentSeverity` | एक घटना गंभीरता | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | एक मॉनिटर स्थिति | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | एक टेलीमेट्री इंजेशन कुंजी | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` वे सभी काइंड सूचीबद्ध करता है जिन्हें आपके क्लस्टर ने सक्रिय किया है।

किसी काइंड के फ़ील्ड Terraform संसाधन के आर्ग्युमेंट होते हैं, camelCase में, `spec.forProvider` के नीचे: `monitoring_interval` से `monitoringInterval` बनता है। जिस फ़ील्ड को Terraform `jsonencode()` से लिखता है, वह एक JSON स्ट्रिंग लेता है। `kubectl explain` हर फ़ील्ड का वर्णन वैसे ही करता है जैसे Terraform प्रदाता करता है, और [Terraform संपूर्ण गाइड](/docs/terraform/complete-guide) दिखाती है कि उनका इस्तेमाल कैसे होता है:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` रिकॉर्ड को वैसा दिखाता है जैसा वह OneUptime में है, उसकी `id` के साथ। जिस फ़ील्ड को आप छोड़ देते हैं और OneUptime भर देता है, जैसे कोई डिफ़ॉल्ट मान, उसे रिकॉर्ड बनने के बाद `spec.forProvider` में कॉपी कर दिया जाता है, ताकि अगली जाँच में बदलने को कुछ न मिले।

## दूसरे संसाधनों का संदर्भ दें

जो भी फ़ील्ड किसी दूसरे रिकॉर्ड की ID रखता है, वह उस रिकॉर्ड का प्रतिनिधित्व करने वाले संसाधन का संदर्भ भी लेता है। `<field>Ref` उसी नेमस्पेस के किसी संसाधन का नाम देता है, और `<field>Selector` Kubernetes लेबल के आधार पर एक संसाधन चुनता है। `labels` जैसी ID की सूची के लिए `labelsRefs` और `labelsSelector` होते हैं। प्रदाता तब तक इंतज़ार करता है जब तक संदर्भित संसाधन OneUptime में मौजूद न हो जाए, फिर उसकी ID भर देता है।

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

संदर्भ किसी मॉनिटर के चरणों के भीतर तक भी पहुँचते हैं: किसी मानदंड की स्थिति (`monitorStatusIdRef`), और वह जो घटनाएँ और अलर्ट बनाता है, उनकी गंभीरता, मालिक टीमें, ऑन-कॉल नीतियाँ और लेबल (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`)। किसी व्यक्ति के लिए कोई काइंड नहीं है: फ़ील्ड किसी व्यक्ति को उसकी यूज़र ID से पहचानता है, जैसे `ownerUserIds` करता है, और कई काइंड उसके बगल में उसका ईमेल पता भी लेते हैं, जैसे `TeamMember` उसे `userEmail` में लेता है ([लोग और टीमें](/docs/terraform/people-and-teams))।

## जो आपके पास पहले से है, उसे आयात करें

जो संसाधन किसी रिकॉर्ड को ऑब्ज़र्व करता है, वह उसे उसकी ID से पढ़ता है और उसे कभी बदलता या हटाता नहीं। ID को संसाधन के बाहरी नाम के रूप में सेट करें, और `Observe` को उसकी एकमात्र प्रबंधन नीति के रूप में:

```yaml title="team.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Team
metadata:
  name: sre
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the team's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

रिकॉर्ड की ID उस `import` ब्लॉक में है जो डैशबोर्ड में उसका **डेवलपर → Terraform** पेज लिखता है, और [OneUptime CLI](/docs/cli/resource-operations#रिकॉर्ड-सूचीबद्ध-करें) के साथ `oneuptime <resource> list` किसी एक तरह के रिकॉर्ड की ID सूचीबद्ध करता है। संसाधन तैयार होने पर `status.atProvider` रिकॉर्ड दिखाता है। उसके बाद से उसे प्रबंधित करने के लिए, उसके फ़ील्ड `spec.forProvider` में लिखें और `managementPolicies` को `["*"]` पर सेट करें।

## सीक्रेट

### OneUptime के बनाए सीक्रेट

कुछ रिकॉर्ड के साथ एक सीक्रेट आता है जिसे OneUptime बनाता है, जैसे किसी टेलीमेट्री इंजेशन कुंजी का सीक्रेट। प्रदाता उसे कभी संसाधन में नहीं रखता: वह उसे संसाधन के नेमस्पेस के एक Secret में लिखता है, जिसका नाम `writeConnectionSecretToRef` बताता है, `attribute.` और उसके बाद Terraform एट्रिब्यूट के नाम के तहत:

```yaml title="telemetry-key.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: TelemetryIngestionKey
metadata:
  name: collector
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  writeConnectionSecretToRef:
    name: collector-telemetry-key
  forProvider:
    name: Collector
```

```bash
kubectl -n team-a get secret collector-telemetry-key -o jsonpath='{.data.attribute\.secret_key}' | base64 -d
```

संसाधन हटाने पर Secret भी हट जाता है।

### आपके दिए सीक्रेट

जो फ़ील्ड कोई सीक्रेट रखता है, जैसे किसी मॉनिटर चरण की TLS क्लाइंट कुंजी का पासफ़्रेज़, वह मान के बजाय संसाधन के नेमस्पेस का एक Secret लेता है: `tlsClientKeyPassphraseSecretRef`, Secret के `name` और `key` के साथ।

## Kubernetes के बाहर किए गए बदलाव

प्रदाता हर 10 मिनट में हर संसाधन को उसके रिकॉर्ड से मिलाकर जाँचता है, और OneUptime में किसी ने जो भी बदला हो, उसे वापस पहले जैसा कर देता है। ज़्यादा बार जाँचने के लिए, प्रदाता को `--poll` के साथ एक रनटाइम कॉन्फ़िगरेशन दें:

```yaml title="runtime-config.yaml"
apiVersion: pkg.crossplane.io/v1beta1
kind: DeploymentRuntimeConfig
metadata:
  name: oneuptime
spec:
  deploymentTemplate:
    spec:
      selector: {}
      template:
        spec:
          containers:
            - name: package-runtime
              args:
                - --poll=1m
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
  runtimeConfigRef:
    name: oneuptime
```

रिकॉर्ड बनने के बाद किसी फ़ील्ड का नियंत्रण डैशबोर्ड को देने के लिए, उसे `spec.forProvider` के बजाय `spec.initProvider` में लिखें: उसका इस्तेमाल रिकॉर्ड बनाने में होता है, और उसे कभी वापस पहले जैसा नहीं किया जाता। पूरे रिकॉर्ड का नियंत्रण डैशबोर्ड को देने के लिए, उसकी प्रबंधन नीतियों से `Update` हटा दें: `["Observe", "Create", "Delete", "LateInitialize"]`।

## कोई संसाधन हटाएँ

किसी संसाधन को हटाने से OneUptime में उसका रिकॉर्ड हट जाता है। रिकॉर्ड रखने के लिए, संसाधन हटाने से पहले उसकी प्रबंधन नीतियों से `Delete` हटा दें: `["Observe", "Create", "Update", "LateInitialize"]`। जो संसाधन केवल ऑब्ज़र्व करता है, वह अपना रिकॉर्ड कभी नहीं हटाता।

## किसी संसाधन की समस्या हल करें

`kubectl -n team-a get managed` हर संसाधन का `SYNCED` और `READY` दिखाता है। जब किसी संसाधन का कोई मान `True` न हो, तो उसकी कंडीशन और इवेंट कारण बताते हैं, और अगर API ने कोई अनुरोध अस्वीकार किया हो तो OneUptime का जवाब भी:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| यह क्या कहता है | क्या जाँचें |
| --- | --- |
| `cannot read the API key` | वह Secret, या उसमें रखी कुंजी, जिसका नाम `ProviderConfig` देता है। |
| `cannot get referenced ProviderConfig` | संसाधन ऐसे `ProviderConfig` का नाम देता है जो उसके नेमस्पेस में नहीं है। क्लस्टर-स्तर के कॉन्फ़िगरेशन के लिए `kind: ClusterProviderConfig` इस्तेमाल करें। |
| ऐसा संदर्भ जो हल नहीं हो पाता | वह जिस संसाधन का नाम देता है, वह नेमस्पेस में नहीं है, या अभी तैयार नहीं है। |
| OneUptime API की कोई त्रुटि | API कुंजी की अनुमतियाँ, और उस फ़ील्ड का मान जिसका नाम त्रुटि में है। |

प्रदाता के लॉग ज़्यादा बताते हैं, और उसके `args` में `--debug` जोड़ने पर और भी ज़्यादा, जैसे ऊपर `--poll` जोड़ा गया है:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## पैकेज सत्यापित करें

हर रिलीज़ में पैकेज को Sigstore के cosign से keyless तरीके से साइन किया जाता है, वैसे ही जैसे OneUptime की इमेज साइन की जाती हैं। किसी पैकेज को इंस्टॉल करने से पहले जाँचने के लिए:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
