# OneUptime को Upgrade करना

यह मार्गदर्शिका आपके self-hosted OneUptime installation को सुरक्षित रूप से upgrade करने का तरीका बताती है।

## सामान्य मार्गदर्शन

- major versions में step-by-step upgrade करें (उदाहरण के लिए, 6 → 7 → 8)। major versions skip न करें।
- आप minor/patch versions को leapfrog कर सकते हैं (उदाहरण के लिए, 8.1 → 8.4) जब तक आप release notes का पालन करते हैं।
- Upgrade से पहले हमेशा backups लें और सत्यापित करें कि आप उन्हें restore कर सकते हैं।

## OneUptime 8 → 9 से Upgrade करना

Helm chart अब Kubernetes Ingress resource provision नहीं करता। OneUptime एक ingress gateway container ship करता है जो TLS terminate करता है, status page domains प्रबंधित करता है, और platform के लिए traffic route करता है, इसलिए cluster ingress controller अब आवश्यक नहीं है।

- Upgrade से पहले अपनी custom `values.yaml` फ़ाइलों से कोई भी `oneuptimeIngress` overrides हटाएं। वे keys अब ignored हैं और जगह छोड़े जाने पर validation errors उत्पन्न करेंगे।
- सुनिश्चित करें कि `nginx.service.type` इस बात को reflect करती है कि आप bundled ingress gateway को कैसे expose करना चाहते हैं (उदाहरण के लिए `LoadBalancer`, `NodePort`, या external load balancer के साथ `ClusterIP`)।
- status pages या primary hosts के लिए किसी भी DNS records को verify करें कि वे अभी भी OneUptime ingress gateway के सामने वाले Service या load balancer की ओर point करते हैं।
- Upgrade के बाद, confirm करें कि TLS certificates embedded gateway के माध्यम से renew होते रहते हैं और status page domains सही तरीके से resolve होते हैं।


## OneUptime 7 → 8 से Upgrade करना

यदि आप Kubernetes पर चला रहे हैं, तो महत्वपूर्ण breaking changes हैं:

- हम [Bitnami License Changes](https://github.com/bitnami/charts/issues/35164) के कारण Postgres, Redis और ClickHouse के लिए Bitnami charts का उपयोग नहीं करते
- ये changes backward compatible नहीं हैं। आपको Helm chart `values.yaml` में नई संरचना का पालन करना होगा।
- Upgrade से पहले अपना डेटा (Postgres, ClickHouse और कोई भी persistent volumes) backup करें।


> सुझाव: पहले staging environment में upgrade test करें। Production upgrade करने से पहले confirm करें कि आपके workloads healthy हैं और डेटा intact है।
