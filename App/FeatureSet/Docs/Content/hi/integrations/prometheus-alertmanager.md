# Prometheus Alertmanager Integration

[Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) notifications को OneUptime incidents में बदलें। Prometheus आपके alerting rules evaluate करता है, Alertmanager उन्हें route करता है, और OneUptime उन्हें record और escalate करता है।

यह इंटीग्रेशन **इनबाउंड** है: Alertmanager एक OneUptime **[वर्कफ़्लो](/docs/workflows/index)** में POST करता है जो **Webhook trigger** से शुरू होता है।

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## पूर्वापेक्षाएँ

- एक Prometheus + Alertmanager setup जहाँ आप `alertmanager.yml` edit कर सकते हैं।
- Alertmanager HTTPS के माध्यम से आपके OneUptime instance तक पहुँचने में सक्षम होना चाहिए।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## चरण 1 — OneUptime वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Alertmanager → Incidents` नाम दें, और **Builder** खोलें।
2. एक **Webhook** trigger जोड़ें और **उसका URL कॉपी करें**। ब्लॉक का नाम `Alertmanager` रखें।
3. trigger से connected एक **Conditions** ब्लॉक जोड़ें:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **Yes** से, एक **Create Incident** ब्लॉक जोड़ें:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: कोई एक चुनें (या पहले `{{Alertmanager.Request Body.commonLabels.severity}}` पर branch करें)।
5. **सहेजें** (test होने तक disabled छोड़ें)।

> **Grouped alerts के बारे में।** Alertmanager alerts को group करता है और एक `alerts` **array** भेजता है। ऊपर `commonLabels` और `commonAnnotations` वे fields हैं जो group में सभी में share हैं — एक notification के लिए एक incident के लिए perfect। यदि आप **प्रत्येक alert के लिए एक incident** चाहते हैं, तो एक [Custom Code](/docs/workflows/components#custom-code) ब्लॉक जोड़ें जो `Request Body.alerts` पर loop करे और हर के लिए एक incident बनाए। अपने route में `group_by` से grouping tune करें।

## चरण 2 — Alertmanager कॉन्फ़िगर करें

Workflow URL पर point करने वाला एक webhook receiver जोड़ें, और उसे alerts route करें। `alertmanager.yml` में:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Alertmanager reload करें (`curl -X POST http://localhost:9093/-/reload` या restart करें)।

## चरण 3 — परीक्षण करें

1. वर्कफ़्लो enable करें।
2. एक test alert fire करें — उदाहरण के लिए, `amtool` के साथ:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. वर्कफ़्लो का **Logs** tab और अपना **Incidents** list जाँचें।

## Recovery पर resolve करना (वैकल्पिक)

`send_resolved: true` के साथ, Alertmanager तब भी POST करता है जब कोई alert clear होता है, इस बार `status: resolved` के साथ। एक दूसरा **Conditions** branch जोड़ें (`status == resolved`), matching incident खोजें (`commonLabels.alertname` पर match करें), और इसे **Update Incident** के साथ आपके resolved state में ले जाएँ।

## समस्या निवारण

- **कोई run नहीं दिखता** — पुष्टि करें कि Alertmanager URL तक पहुँच सकता है (delivery errors के लिए उसके logs जाँचें) और वर्कफ़्लो **Enabled** है।
- **Incident fields खाली हैं** — अलग-अलग rules अलग-अलग annotations set करते हैं। **Logs** tab में trigger output inspect करें और उन fields को reference करें जो actually exist करते हैं (`commonAnnotations` vs per-alert `annotations`)।
- **बहुत सारे incidents** — `group_by`/`group_interval` बढ़ाएँ ताकि Alertmanager related alerts batch करे।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — inbound pattern।
- [Grafana](/docs/integrations/grafana) — वही विचार, Grafana alerting।
- [Webhook trigger](/docs/workflows/triggers#webhook) — receiving URL कैसे काम करता है।
