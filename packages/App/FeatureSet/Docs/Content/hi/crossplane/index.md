# Crossplane अवलोकन

OneUptime Crossplane प्रदाता आपके OneUptime प्रोजेक्ट को Kubernetes से प्रबंधित करता है। मॉनिटर, स्थिति पृष्ठ, ऑन-कॉल नीतियाँ, टीमें, लेबल और अपने प्रोजेक्ट के बाकी रिकॉर्ड Kubernetes संसाधनों के रूप में घोषित करें, और Crossplane आपके प्रोजेक्ट को वैसा ही रखता है जैसा वे कहते हैं: जो नया है उसे बनाता है, जो आप संपादित करते हैं उसे बदलता है, किसी ने कहीं और जो बदला उसे वापस पहले जैसा कर देता है, और जो आप हटाते हैं उसे हटा देता है। Argo CD, Flux और मैनिफेस्ट लागू करने वाले बाकी सभी टूल भी इन्हें लागू करते हैं। यह OneUptime Cloud और स्व-होस्टेड OneUptime दोनों के साथ काम करता है।

:::cards
- [प्रदाता कैसे काम करता है](#प्रदाता-कैसे-काम-करता-है): काइंड, नेमस्पेस, और उनके पीछे की API कुंजी।
- [प्रदाता इंस्टॉल करें](#प्रदाता-इंस्टॉल-करें): पैकेज, और कौन-सा संस्करण चुनें।
- [प्रदाता को अपनी API कुंजी दें](#प्रदाता-को-अपनी-api-कुंजी-दें): आपके नेमस्पेस में एक Secret और एक ProviderConfig।
- [अपने पहले संसाधन बनाएँ](#अपने-पहले-संसाधन-बनाएँ): एक मॉनिटर, उस पर लगा लेबल और वे स्थितियाँ जो वह सेट करता है।
:::

## प्रदाता कैसे काम करता है

प्रदाता एक Crossplane पैकेज है। इंस्टॉल होने पर यह OneUptime API के हर तरह के रिकॉर्ड के लिए `crossplane.oneuptime.com` API समूह में एक काइंड जोड़ता है: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` और 400 से ज़्यादा दूसरे। इन काइंड का हर संसाधन किसी नेमस्पेस में रहता है और आपके प्रोजेक्ट के एक रिकॉर्ड का प्रतिनिधित्व करता है। प्रदाता आपके प्रोजेक्ट की एक API कुंजी से, OneUptime REST API के ज़रिए रिकॉर्ड को पढ़ता और बदलता है, और जो पाता है उसे संसाधन के status में लिखता है।

प्रदाता हर रिलीज़ में [Terraform प्रदाता](/docs/terraform/index) से बनाया जाता है: इसके काइंड Terraform प्रदाता के ही संसाधन हैं, उन्हीं फ़ील्ड और उनके पीछे उन्हीं API अनुरोधों के साथ।

## शुरू करने से पहले

- **Crossplane 2.0 या उसके बाद का।** प्रदाता के संसाधन नेमस्पेस में रहते हैं, और यह सुविधा Crossplane 2 में आई। Crossplane के अपने दस्तावेज़ बताते हैं कि इसे अपने क्लस्टर में कैसे इंस्टॉल करें।
- **आपके प्रोजेक्ट की एक API कुंजी।** Terraform का [त्वरित प्रारंभ](/docs/terraform/quick-start#प्रोजेक्ट-की-api-कुंजी-बनाएँ) दिखाता है कि **प्रोजेक्ट सेटिंग्स → उन्नत → API कुंजियाँ** में इसे कैसे बनाएँ। कुंजी तय करती है कि संसाधन किस प्रोजेक्ट के हैं और प्रदाता उसमें क्या बदल सकता है।
- **OneUptime Cloud पर, Growth प्लान या उससे ऊपर।** प्रोजेक्ट की API कुंजियाँ केवल उसी पर काम करती हैं।

## प्रदाता इंस्टॉल करें

पैकेज को एक `Provider` से इंस्टॉल करें:

```yaml title="provider.yaml"
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
```

```bash
kubectl apply -f provider.yaml
kubectl get providers.pkg.crossplane.io provider-oneuptime
```

जब `INSTALLED` और `HEALTHY` दोनों `True` दिखाएँ, तो प्रदाता चल रहा है। यही पैकेज Docker Hub पर भी है, `docker.io/oneuptime/provider-oneuptime` के रूप में।

### संस्करण चुनें

पैकेज के संस्करण OneUptime के ही संस्करण हैं: `{{CROSSPLANE_PROVIDER_VERSION}}` OneUptime की उसी रिलीज़ से बना है जो यह पेज दिखा रही है। OneUptime Cloud पर, सबसे नया संस्करण इस्तेमाल करें। स्व-होस्टेड OneUptime पर, अपने OneUptime का संस्करण इस्तेमाल करें, ताकि प्रदाता वही फ़ील्ड जाने जो आपके OneUptime का API जानता है।

### केवल वे काइंड सक्रिय करें जिनका आप इस्तेमाल करते हैं

Crossplane का Helm चार्ट डिफ़ॉल्ट रूप से हर प्रदाता का हर काइंड सक्रिय करता है (उसका `provider.defaultActivations` मान), और इस प्रदाता के लिए इसका मतलब है 400 से ज़्यादा कस्टम संसाधन परिभाषाएँ (CRD)। केवल वे काइंड सक्रिय करने के लिए जिनका आप इस्तेमाल करते हैं, Crossplane को `--set provider.defaultActivations={}` के साथ इंस्टॉल करें और काइंड के नाम एक नीति में लिखें:

```yaml title="activation-policy.yaml"
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: ManagedResourceActivationPolicy
metadata:
  name: oneuptime
spec:
  activate:
    - monitors.crossplane.oneuptime.com
    - monitorstatusdefinitions.crossplane.oneuptime.com
    - labels.crossplane.oneuptime.com
    - statuspages.crossplane.oneuptime.com
```

## प्रदाता को अपनी API कुंजी दें

कुंजी को उस नेमस्पेस के एक Secret में रखें जिसमें आपके संसाधन रहेंगे, और उसी नेमस्पेस के एक `ProviderConfig` को उसकी ओर इंगित करें। Secret को `kubectl` से बनाने पर कुंजी आपकी फ़ाइलों से बाहर रहती है:

```bash
kubectl create namespace team-a
kubectl -n team-a create secret generic oneuptime --from-literal=api-key="<your-api-key>"
```

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

`ProviderConfig` केवल अपने नेमस्पेस के Secret पढ़ता है, इसलिए एक नेमस्पेस की कुंजी किसी दूसरे नेमस्पेस से इस्तेमाल नहीं की जा सकती। हर संसाधन अपने `ProviderConfig` का नाम `spec.providerConfigRef` में देता है।

### स्व-होस्टेड OneUptime इस्तेमाल करें

`ProviderConfig` को अपने OneUptime का पता `url` के रूप में दें, `/api` के बिना:

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  url: https://oneuptime.example.com
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

### एक कुंजी कई नेमस्पेस में साझा करें

`ClusterProviderConfig` किसी भी नेमस्पेस का Secret पढ़ता है, और हर नेमस्पेस के संसाधन उसका नाम दे सकते हैं। इसे तब इस्तेमाल करें जब पूरे क्लस्टर की कुंजी की देखभाल एक ही टीम करती हो:

```yaml title="cluster-provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ClusterProviderConfig
metadata:
  name: oneuptime
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: oneuptime
      key: credentials
```

कोई संसाधन अपने `providerConfigRef` में `kind: ClusterProviderConfig` लिखकर उसका नाम देता है। Secret में या तो केवल कुंजी होती है, या ऐसा JSON जो पता भी बताता है: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`। `ClusterProviderConfig` में दिए गए `url` को JSON वाले पते पर प्राथमिकता मिलती है। `ClusterProviderConfig` प्रदाता के पॉड के किसी एनवायरनमेंट वेरिएबल या फ़ाइल से भी कुंजी पढ़ सकता है, `source: Environment` या `source: Filesystem` के साथ।

## अपने पहले संसाधन बनाएँ

आपके होमपेज का एक मॉनिटर, एक लेबल के साथ, जो आपके प्रोजेक्ट की **ऑफ़लाइन** और **कार्यरत** स्थितियाँ सेट करता है।

:::steps
### जो स्थितियाँ यह सेट करता है, उन्हें ऑब्ज़र्व करें

OneUptime ने आपके प्रोजेक्ट की स्थितियाँ प्रोजेक्ट के साथ ही बनाई थीं, इसलिए उन्हें बनाया नहीं जाता, बल्कि ऑब्ज़र्व किया जाता है: प्रदाता उन्हें उनकी ID से पढ़ता है और उन्हें कभी बदलता या हटाता नहीं। [OneUptime CLI](/docs/cli/resource-operations#रिकॉर्ड-सूचीबद्ध-करें) के साथ, `oneuptime monitor-status list --fields _id,name` ये ID सूचीबद्ध करता है।

```yaml title="statuses.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: offline
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Offline status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: operational
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Operational status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

### लेबल और मॉनिटर बनाएँ

मॉनिटर लेबल और स्थितियों का संदर्भ उनके Kubernetes नामों से देता है, और प्रदाता उनकी ID भर देता है:

```yaml title="homepage.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Label
metadata:
  name: production
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Production
    color: "#16a34a"
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Monitor
metadata:
  name: homepage
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Homepage
    description: Checks that the homepage responds
    monitorType: Website
    monitoringInterval: "*/5 * * * *"
    labelsRefs:
      - name: production
    monitorSteps:
      - monitorDestination: https://example.com
        monitorDestinationType: URL
        requestType: GET
        criteria:
          - name: Offline
            description: The homepage does not respond
            filterCondition: Any
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: offline
            filters:
              - checkOn: Is Online
                filterType: "False"
          - name: Online
            description: The homepage responds
            filterCondition: All
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: operational
            filters:
              - checkOn: Is Online
                filterType: "True"
```

### उन्हें OneUptime में देखें

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

जब `SYNCED` और `READY` दोनों `True` दिखाएँ, तो रिकॉर्ड आपके प्रोजेक्ट में है। `EXTERNAL-NAME` OneUptime में उसकी ID है।
:::

## अगले कदम

- [संसाधनों का प्रबंधन](/docs/crossplane/managing-resources) काइंड और उनके फ़ील्ड, संदर्भ, पहले से मौजूद चीज़ों का आयात, OneUptime के बनाए सीक्रेट, और किसी संसाधन के तैयार न होने पर क्या देखें, यह सब समझाता है।
- [Terraform संपूर्ण गाइड](/docs/terraform/complete-guide) संसाधनों और उनके फ़ील्ड का वर्णन करती है, जो प्रदाता के काइंड में भी वही हैं।
