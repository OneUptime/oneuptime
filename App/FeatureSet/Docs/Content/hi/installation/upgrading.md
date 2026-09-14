# OneUptime को Upgrade करना

यह मार्गदर्शिका आपके self-hosted OneUptime installation को सुरक्षित रूप से upgrade करने का तरीका बताती है।

## सामान्य मार्गदर्शन

- major versions में step-by-step upgrade करें (उदाहरण के लिए, 6 → 7 → 8)। major versions skip न करें।
- आप minor/patch versions को leapfrog कर सकते हैं (उदाहरण के लिए, 8.1 → 8.4) जब तक आप release notes का पालन करते हैं।
- Upgrade से पहले हमेशा backups लें और सत्यापित करें कि आप उन्हें restore कर सकते हैं।

## OneUptime 12 → 13 अपग्रेड

OneUptime 13 में साथ आने वाले कैश और क्यू इंजन के रूप में Redis की जगह [Valkey](https://valkey.io) आ गया है। Redis 7.4 ने BSD लाइसेंस छोड़ दिया और Redis के अधिकतर मूल योगदानकर्ता अब Valkey पर काम करते हैं, जो Redis 7.2 का एक फ़ोर्क है और वही प्रोटोकॉल बोलता है। सॉकेट के ऊपर कुछ भी नहीं बदला, और आप चाहें तो OneUptime को अब भी असली Redis या किसी प्रबंधित Redis-संगत सेवा पर लगा सकते हैं।

आप जो कुछ कॉन्फ़िगर करते हैं, उसका नाम अब उसी के अनुरूप है: सेटिंग्स `VALKEY_*` हैं, Helm मान `valkey:` / `externalValkey:` हैं, और Kubernetes ऑब्जेक्ट `<release>-valkey*` हैं। **सभी पुराने नाम अब भी काम करते हैं**, इसलिए बिना छेड़ी हुई `config.env` या `values.yaml` भी अपग्रेड होकर चलती रहती है। कोई भी कॉन्फ़िगरेशन बदलना अनिवार्य नहीं है और माइग्रेट करने के लिए कोई डेटा नहीं है — कैश सत्य का स्रोत नहीं है, और Postgres तथा ClickHouse अछूते रहते हैं।

आपको क्या करना है, यह इस पर निर्भर करता है कि आपने कैसे तैनात किया है:

- **Docker Compose:** हमेशा की तरह अपडेट करें, बस एक फ़्लैग मायने रखता है — देखें [Docker Compose से अपग्रेड](#docker-compose-से-अपग्रेड)।
- **Helm:** मानों में बदलाव की ज़रूरत नहीं, लेकिन कैश पॉड दोबारा बनता है और खाली लौटता है — देखें [Helm से अपग्रेड](#helm-से-अपग्रेड)।
- **आप OneUptime को अपने ही चलाए हुए कैश पर लगाते हैं** (प्रबंधित Redis, ElastiCache, Memorystore, आपका अपना Valkey): पढ़ें [यदि आप अपना कैश स्वयं चलाते हैं](#यदि-आप-अपना-कैश-स्वयं-चलाते-हैं)। यही एकमात्र व्यवस्था है जो चुपचाप आपके सर्वर तक पहुँचना बंद कर सकती है।
- **आपके पास Kubernetes ऑब्जेक्ट नामों पर टिके डैशबोर्ड, अलर्ट, नेटवर्क नीतियाँ या स्क्रिप्ट हैं:** वे नाम बदल रहे हैं — देखें [Helm से अपग्रेड](#helm-से-अपग्रेड)।

### क्या बदला और क्या नहीं

| | 12 तक | 13 से |
| --- | --- | --- |
| इंजन | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| सेटिंग्स | `REDIS_*` | `VALKEY_*` — `REDIS_*` अब भी पढ़ा जाता है |
| Compose सेवा | `redis` | `valkey` — होस्टनाम `redis` पर अब भी उत्तर देती है |
| Helm मान | `redis:`, `externalRedis:` | `valkey:`, `externalValkey:` — पुरानी कुंजियाँ अब भी लागू होती हैं |
| Kubernetes ऑब्जेक्ट | `<release>-redis`, `<release>-redis-master` | `<release>-valkey`, `<release>-valkey-master` |
| उत्पन्न Secret | `<release>-redis` में `redis-password` | `<release>-valkey` में `valkey-password` |
| बाहरी कैश का Secret | `<release>-external-redis` | `<release>-external-valkey` |

नाम बदली गई दस सेटिंग्स हैं `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_DB`, `VALKEY_USERNAME`, `VALKEY_PASSWORD`, `VALKEY_IP_FAMILY`, `VALKEY_TLS_CA`, `VALKEY_TLS_CERT`, `VALKEY_TLS_KEY` और `VALKEY_TLS_SENTINEL_MODE`। जब कोई सेटिंग दोनों वर्तनियों में मौजूद हो, तो ऐप्लिकेशन `VALKEY_*` वाली को प्राथमिकता देता है। Helm चार्ट इसका उलटा करता है: पुरानी `redis:` कुंजी नए डिफ़ॉल्ट मान पर भारी पड़ती है, इसलिए जिस मान-फ़ाइल को आपने कभी नहीं छुआ, वह ठीक पहले जैसी ही चलती है।

**कैश एक बार पुनः आरंभ होता है**, दोनों तैनाती तरीकों में, क्योंकि कंटेनर बदला जाता है। यह डिस्क पर कुछ नहीं रखता (`appendonly no`, `save ""`), इसलिए ठंडा लौटता है: कैश किए गए मान चले जाते हैं, और जो BullMQ जॉब प्रतीक्षा में, विलंबित या बैकऑफ़ में थे, वे खो जाते हैं। दोहराए जाने वाले और cron जॉब दोबारा जुड़ते ही स्वयं पंजीकृत हो जाते हैं। यदि चल रही टेलीमेट्री या वर्कफ़्लो के पुनःप्रयास आपके लिए महत्वपूर्ण हैं, तो किसी शांत समय पर अपग्रेड करें।

### Docker Compose से अपग्रेड

सामान्य अपडेट ही पर्याप्त है:

```
git checkout release # सुनिश्चित करें कि आप release ब्रांच पर हैं।
git pull
npm run update
```

- **यदि आप Compose हाथ से चलाते हैं तो `--remove-orphans` का उपयोग करें।** `npm run update` और `npm run start` इसे पहले ही भेजते हैं, और यही पुराने `redis` कंटेनर को हटाता है। उसे चलता छोड़ देने पर दो कंटेनर होस्टनाम `redis` का उत्तर देंगे और कनेक्शन बेतरतीब ढंग से पुराने पर पहुँचेंगे।
- **आपकी `config.env` दोबारा नहीं लिखी जाती।** `npm run update` आम तौर पर हर वह सेटिंग जोड़ देता है जो उसे `config.example.env` में मिले और आपकी फ़ाइल में न हो, लेकिन वह इन दस को नाम-परिवर्तन के रूप में पहचानता है और आपके मान — आपके `REDIS_PASSWORD` समेत — ठीक वहीं छोड़ देता है। यह भी बताता है कि उसने कौन-से रखे।
- अपनी कुंजियों को `VALKEY_*` में बदलना वैकल्पिक है और बाद में भी सुरक्षित रूप से किया जा सकता है। प्रति सेटिंग केवल एक ही वर्तनी रखें।
- **यदि आप कैश वेरिएबल किसी `docker-compose.override.yml` में सेट करते हैं, तो उन्हें `VALKEY_*` कर दें।** आधार फ़ाइल अब आपके `REDIS_HOST` से `VALKEY_HOST` सेट करती है, और ऐप्लिकेशन पहले `VALKEY_HOST` पढ़ता है, इसलिए केवल `REDIS_HOST` सेट करने वाला ओवरराइड अब भारी नहीं पड़ता।

### Helm से अपग्रेड

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **मानों में कोई बदलाव आवश्यक नहीं है।** `redis:` और `externalRedis:` अब भी काम करती हैं — उनके नीचे आप जो सेट करते हैं वह `valkey:` / `externalValkey:` के नए डिफ़ॉल्ट के ऊपर लगाया जाता है — और `helm upgrade` मिली हुई पुरानी कुंजियों की सूची के साथ एक `DEPRECATED VALUES` सूचना छापता है। सुविधा हो तब नाम बदल लें।
- **कुछ भी घुमाया नहीं जाता।** चार्ट आपके मौजूदा `<release>-redis` Secret से पासवर्ड पढ़कर उसे `<release>-valkey` में ले जाता है, नया बनाने के बजाय।
- **दोनों पुराने Secret बने रहते हैं।** `<release>-redis` और, यदि आप अपना कैश लाते हैं तो `<release>-external-redis`, दोनों पर `helm.sh/resource-policy: keep` एनोटेशन है, इसलिए वे अब अनुपयोगी प्रतियों के साथ पड़े रहते हैं। अपग्रेड जम जाने पर उन्हें हटा दें — पर पहले [12 पर वापसी](#12-पर-वापसी) पढ़ लें।
- **ऑब्जेक्ट नाम बदल जाते हैं।** `<release>-redis` या `<release>-redis-master` पर टिकी हर चीज़ अपडेट करें: Grafana डैशबोर्ड, अलर्ट नियम, NetworkPolicies, ServiceMonitors, बैकअप जॉब।
- Service अपने पुराने नाम `<release>-redis-master` से भी प्रकाशित होती है, ताकि जो पॉड अभी बदले नहीं हैं वे पूरे रोलआउट के दौरान कुछ भी हल न कर पाने के बजाय स्वयं दोबारा जुड़ सकें। सभी वर्कलोड बदल जाने के बाद उसे हटाने के लिए `valkey.legacyServiceAlias: false` सेट करें।
- **यदि आपने `persistence.enabled: true` रखा था**, तो नया StatefulSet एक नया वॉल्यूम `data-<release>-valkey-0` माँगता है। पुराने `data-<release>-redis-0` में कभी कुछ था ही नहीं — उसका खर्च रोकने के लिए उसे हटा दें।

### यदि आप अपना कैश स्वयं चलाते हैं

OneUptime को ऐसे कैश पर लगाना जिसे वह स्वयं नहीं चलाता, पूरी तरह समर्थित है, और दूसरी ओर का सर्वर Valkey, Redis या कोई प्रबंधित Redis-संगत सेवा हो सकता है। बदला केवल उस ब्लॉक का नाम है जो उसे कॉन्फ़िगर करता है।

- अपनी मान-फ़ाइल में `externalRedis:` का नाम बदलकर `externalValkey:` कर दें। यह वैकल्पिक है — पुरानी कुंजी अब भी लागू होती है — पर चार्ट अब यही दर्ज करता है।
- चार्ट उस Secret को नए नाम `<release>-external-valkey` से दोबारा बनाता है। पुराना `<release>-external-redis` बना रहता है पर अब अपडेट नहीं होता, इसलिए यदि आपके अपने मैनिफ़ेस्ट उसे नाम से संदर्भित करते हैं, तो उन्हें नए पर लगा दें।
- **`extraEnv` ओवरराइड अब कैश तक नहीं पहुँचते — और यह चुपचाप विफल होता है।** यदि आप `externalValkey:` ब्लॉक के बजाय `extraEnv: [{name: REDIS_HOST, ...}]` से किसी प्रबंधित कैश पर लगाते हैं, तो आपकी प्रविष्टि `REDIS_HOST` की जगह अब भी जीतती है, पर ऐप्लिकेशन पहले `VALKEY_HOST` पढ़ता है — और चार्ट उसे अपने ही क्लस्टर-भीतरी कैश पर सेट करता है। यानी आपका ओवरराइड पॉड स्पेक में मौजूद रहकर अनदेखा हो जाता है। उन प्रविष्टियों को `VALKEY_*` कर दें, या सेटिंग्स को समर्थित रास्ते `externalValkey:` में ले जाएँ। `helm upgrade` चार्ट-स्तर की `extraEnv` प्रविष्टियों पर चेतावनी देता है; प्रति-सेवा `<service>.extraEnv` सूचियाँ उसे दिखती नहीं, इसलिए उन्हें स्वयं जाँचें। Compose में इसका समकक्ष केवल `REDIS_HOST` सेट करने वाली ओवरराइड फ़ाइल है।

### अपग्रेड की जाँच करें

- **एडमिन डैशबोर्ड → Health → Valkey** पर «Connected» और एक मेमोरी आँकड़ा दिखना चाहिए। यह वही पहुँच-जाँच है जिसका उपयोग हेल्थ चेतावनी ईमेल करते हैं।
- **Compose:** `docker compose ps` में एक `valkey` सेवा दिखती है और कोई `redis` कंटेनर नहीं।
- **Helm:** `kubectl get pods,svc -n <namespace>` में `<release>-valkey-0` Running दिखता है और Service `<release>-valkey-master` भी। `helm get notes my-oneuptime` से अपग्रेड की छापी हुई सूचनाएँ दोबारा देखी जा सकती हैं।
- और गहराई से देखने के लिए, `HelmChart/Public/diagnose.sh` कैश मेमोरी, एविक्शन और कनेक्टिविटी बताता है, और पुराने तथा नए दोनों ऑब्जेक्ट नाम समझता है।

### 12 पर वापसी

- **Helm:** `helm rollback` काम करता है, क्योंकि 12 का चार्ट अपने ही बनाए `<release>-redis` Secret को यथावत पाता है और उसी पासवर्ड का पुनः उपयोग करता है। पुराने Secret इसी कारण रखे जाते हैं — जब तक यह तय न हो कि आप 13 पर ही रहेंगे, उन्हें न हटाएँ।
- **Docker Compose:** जब तक निश्चय न हो, `config.env` में `REDIS_*` वर्तनी बनाए रखें। OneUptime 12 केवल `REDIS_*` पढ़ता है, इसलिए जिस `config.env` की कुंजियाँ आपने बदल दी हैं उसी के साथ वापस जाने पर कैश बिना कॉन्फ़िगर किए पासवर्ड के शुरू होता है, Compose नेटवर्क पर खुला रह जाता है, और ऐप्लिकेशन प्रमाणित नहीं हो पाता। दोनों वर्तनियाँ समान मानों के साथ रखना भी चलता है।
- वापसी कैश को फिर से पुनः आरंभ करती है, उसी ठंडी शुरुआत की कीमत के साथ।

### जो नाम जानबूझकर Redis ही रहे

ये चूक नहीं हैं, और इनमें से किसी पर कार्रवाई की आवश्यकता नहीं:

- **API का स्वरूप वही रहता है।** इंस्टेंस हेल्थ उत्तर में `components.redis` और `summary.redis`, रूट `/api/admin/health/redis`, तथा एडमिन क्वेरी कंसोल में इंजन मान `redis` — ये प्रदर्शित पाठ नहीं, प्रोटोकॉल कुंजियाँ हैं। इन पर बनाई गई आपकी स्क्रिप्ट यथावत चलती रहेंगी।
- **Redis प्रोटोकॉल की शब्दावली:** `redis-cli`, `INFO` का `redis_version` फ़ील्ड, और वह संग्रहीत मेमोरी आधार-मान जिससे हेल्थ सूचनाएँ तुलना करती हैं। उस कुंजी का नाम बदलने पर हर इंस्टेंस का इतिहास मिट जाता।
- **डिफ़ॉल्ट होस्टनाम अब भी `redis` है**, हाथ से लिखे मैनिफ़ेस्ट और सादे `docker run` सेटअप के लिए। इसका उपयोग तभी होता है जब न `VALKEY_HOST` सेट हो और न `REDIS_HOST`, जो हमारे अपने Compose या Helm में कभी नहीं होता।
- आंतरिक क्लास नाम और Postgres कॉलम नाम, जो किसी को दिखते नहीं और जिनका नाम बदलने पर केवल एक माइग्रेशन का खर्च आता।

## OneUptime 11 → 12 अपग्रेड

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Runbook चलाता है** (on by default),
**AI कोड सुधार चलाता है** (off by default), and **AI उपचार कमांड चलाता है** (off by
default). Capability changes are adopted on the Runner's next heartbeat —
no restart needed. See [Runners](/docs/runbooks/agents) for how the
component works day to day.

What you need to do depends on how you deployed:

- **Everyone:** read [What happens automatically](#what-happens-automatically)
  and [Dashboard pages moved](#dashboard-pages-moved).
- **You installed Runbook Agents on your hosts:** redeploy them onto the new
  image — see [Redeploy your Runbook Agents](#redeploy-your-runbook-agents).
- **Docker Compose:** environment variable renames plus **one
  security-relevant step** — see [Docker Compose deployments](#docker-compose-deployments).
- **Helm:** a values-file rename that fails validation if skipped — see
  [Helm deployments](#helm-deployments).
- **API keys that were granted agent permissions directly:** re-grant them —
  see [Permissions: teams migrate, API keys do not](#permissions-teams-migrate-api-keys-do-not).

### What happens automatically

No manual database work. On first boot, v12 runs a migration that:

- Renames the Postgres tables and columns (`RunbookAgent` → `Runner`,
  `RunbookAgentJob` → `RunnerJob`, plus the owner, label, and join tables to
  match). Runner ids, keys, and job history are untouched — this is a
  rename, not a re-registration.
- Migrates every **team** permission grant from the old `…RunbookAgent…`
  permission names to the new `…Runner…` names, so team roles keep working
  without reassignment. (Direct API-key grants are the exception — see below.)

The API stays compatible too:

- Requests to `/api/runbook-agent`, `/api/runbook-agent-job`,
  `/api/runbook-agent-owner-team`, and `/api/runbook-agent-owner-user` are
  rewritten server-side onto their `/runner…` equivalents, so existing
  scripts keep working.
- The agent-facing ingest path `/runbook-agent-ingest` is still served
  alongside the new `/runner-ingest`, so **Runbook Agent containers you have
  not redeployed yet keep heartbeating and executing Bash and JavaScript
  steps** against a v12 server. Each one logs a deprecation warning on the
  server naming the agent that should be redeployed.

### Redeploy your Runbook Agents

Your existing agents keep running Bash and JavaScript steps unchanged, so
this does not block the upgrade — but do it soon after:

- **SSH and Kubernetes steps (new in v12) fail on old agents.** The server
  does not exclude old agents from claiming them: an agent still on the
  `runbook-agent` image will claim an SSH or Kubernetes job and fail it with
  `Unsupported step type` — typically mid-incident, when the runbook runs.
  Redeploy the agent **before** authoring SSH or Kubernetes steps that
  target it.
- The old image receives no further updates of any kind.

Redeploying means re-running the install command with the new image and
variable names. The agent's id and key are **unchanged** (same database
row) — swap the names, keep the values:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(Or open the Runner in **सेटिंग्स → Runbook एजेंट** and use **सेटअप निर्देश
दिखाएं** for a pre-filled command.)

If you tuned the agent with environment variables, rename them — the old
names are **silently ignored** by the new image:

| Old (Runbook Agent)                     | New (Runner)                              |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### If you ran the standalone AI Agent

The **सेटिंग्स → एआई → AI एजेंट** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **सेटिंग्स → Runbook एजेंट** and install it with the
   command from **सेटअप निर्देश दिखाएं**.
2. Enable **AI कोड सुधार चलाता है** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `update.sh` flow, the new variables are appended to your
`config.env` automatically and the stack boots — but read the key warning
below. The renames, if you manage `config.env` or overrides by hand:

| Old                              | New                                |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

The old `AI_AGENT_*` lines can stay in `config.env`; nothing reads them
anymore.

**Important — set `ONEUPTIME_RUNNER_KEY` to a random value.** The template
merge appends it with the literal placeholder
`please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is
**not** carried over. This key registers the instance-wide Runner and
authenticates the AI code-fix protocol — including minting repository
access tokens — so leaving the publicly known placeholder in place is a
security hole. Before starting v12, set it to a long random value (reusing
your old `AI_AGENT_KEY` value is fine).

**Remove the orphaned `ai-agent` container.** `npm start` runs compose with
`--remove-orphans` and cleans it up. If you run `docker compose up -d` by
hand, add `--remove-orphans` (or `docker rm -f` the old container) —
otherwise the old AI Agent keeps running and keeps claiming code-fix work
alongside the new Runner.

### Helm deployments

- Rename the `aiAgent:` block in your values overrides to `runner:`. All
  subkeys (`enabled`, `replicaCount`, `resources`, `keda`, and so on) are
  unchanged. This is a hard break: the chart schema rejects unknown keys,
  so `helm upgrade` **fails validation** while an `aiAgent:` block remains.
- Workload names change from `<release>-ai-agent` to `<release>-runner` —
  update anything keyed on the old names (dashboards, alerts, network
  policies).
- The release secret key changes from `ai-agent-key` to `runner-key`. A
  fresh key is generated on upgrade and the in-cluster Runner re-registers
  itself automatically, so there is nothing to do unless something external
  referenced the old secret value.
- Deliberately unchanged: the KEDA scaling metric is still named
  `oneuptime_ai_agent_queue_size` — do not rename it in custom scalers.

### Permissions: teams migrate, API keys do not

Twelve permissions were renamed (`CreateRunbookAgent` → `CreateRunner`,
`EditRunbookAgent` → `EditRunner`, `DeleteRunbookAgent` → `DeleteRunner`,
`ReadRunbookAgent` → `ReadRunner`, and the same four verbs for
`…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` and
`…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). Grants held through
**teams** are migrated automatically. Grants attached **directly to an API
key** are not — a key that held one of these twelve permissions loses that
access after the upgrade. Re-grant the new `…Runner…` permissions on those
keys in the dashboard. The `RunbookSecret`, `RunbookCredential`, and
`RunbookExecution` permission families kept their names.

Separately, v12 closes a hole: starting a runbook execution now requires
an authenticated caller with `ProjectOwner`, `ProjectAdmin`,
`ProjectMember`, `CreateRunbookExecution`, `RunbookAdmin`, or
`RunbookMember` — advancing or cancelling one also accepts
`EditRunbookExecution`. Unauthenticated triggering no longer works, and
read-only roles (for example `RunbookViewer`) can no longer start runs —
API automation that triggers runbooks needs `CreateRunbookExecution`.

### Dashboard pages moved

There are no redirects from the old URLs — update bookmarks and internal
wiki links:

| Page                    | Old location                             | New location                              |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (was "Agents")  | रनबुक → सेटिंग्स → एजेंट (`…/runbooks/settings/agents`)     | सेटिंग्स → Runbook एजेंट (`…/settings/runners`) |
| Runner Credentials      | रनबुक → सेटिंग्स → क्रेडेंशियल (`…/runbooks/settings/credentials`)    | सेटिंग्स → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | सेटिंग्स → एआई → AI एजेंट (`…/settings/ai-agents`) | Removed — Runners with the **AI कोड सुधार चलाता है** capability replace it |

Runbook Secrets stays where it was, under रनबुक → सेटिंग्स → सीक्रेट.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **AI उपचार कमांड चलाता है**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## OneUptime 10 → 11 अपग्रेड

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, sign-in through them is disabled after the upgrade,
and the settings pages show an upgrade prompt instead of the configuration
form. Your existing provider records are **preserved in the database** —
nothing is deleted — they simply become inactive until the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 ClickHouse टेलीमेट्री स्टोरेज को नए सिरे से बनाता है। यह पेज बताता है कि क्या बदलता है, किसे कुछ करना है, और — उन इंस्टॉलेशन के लिए जो ऐतिहासिक टेलीमेट्री आगे ले जाना चाहते हैं — इसके लिए ज़रूरी हर क्वेरी।

### v11 में क्या बदलता है

टेलीमेट्री (logs, traces, metrics, exceptions, profiles, monitor logs, audit logs) समय-आधारित पार्टिशनिंग, प्रति-कॉलम कम्प्रेशन कोडेक और नए entity-model कॉलम वाली नई ClickHouse टेबलों में स्थानांतरित होती है:

| पुरानी टेबल           | नई टेबल               |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

हर टेलीमेट्री टेबल में दो कॉलम का नाम बदला गया है: `serviceId` → `primaryEntityId` और `serviceType` → `primaryEntityType`। यह एक सख्त नाम-परिवर्तन है — **यदि आप OneUptime analytics API को सीधे `serviceId`/`serviceType` फ़िल्टर के साथ क्वेरी करते हैं, तो उन्हें नए नामों पर अपडेट करें।** OneUptime के अंदर के डैशबोर्ड, मॉनिटर और अलर्ट अपने आप माइग्रेट हो जाते हैं।

यह बदलाव **केवल आगे की ओर** है: नई टेबलें खाली शुरू होती हैं, अपग्रेड के बाद आने वाली सारी टेलीमेट्री तुरंत उनमें जाती है, और इतिहास समय के साथ स्वाभाविक रूप से भरता जाता है। पुरानी टेबलें अपग्रेड के दौरान डिस्क खाली करने के लिए **अपने आप हटा दी जाती हैं** — यदि आप इतिहास आगे ले जाने का विकल्प खुला रखना चाहते हैं, तो अपग्रेड से **पहले** उनका नाम बदल दें (नीचे Step 0)।

> **पहले से 11.0.0 या 11.0.1 पर हैं?** उन रिलीज़ों में पुरानी टेबलें रखी जाती थीं (वे TTL के ज़रिए खाली होती थीं, और कॉपी "अपग्रेड के बाद कभी भी" चलाई जा सकती थी)। कोई भी बाद का अपडेट **स्टार्टअप पर उन्हें हटा देता है**। यदि आप अब भी इतिहास की कॉपी करना चाहते हैं और अभी तक नहीं की है, तो अपडेट लगाने से पहले नीचे दिया Step 0 करें।

### किसे कुछ करना है

- **नए इंस्टॉलेशन:** कुछ नहीं करना।
- **ऐसे अपग्रेड जिन्हें UI में अपग्रेड-पूर्व टेलीमेट्री नहीं चाहिए:** कुछ नहीं करना। टेलीमेट्री पेज बस अपग्रेड के क्षण से आगे का डेटा दिखाते हैं; पुरानी टेबलें अपग्रेड के दौरान हटा दी जाती हैं।
- **ऐसे अपग्रेड जिन्हें अपग्रेड-पूर्व टेलीमेट्री दिखनी चाहिए:** अपग्रेड से **पहले** पुरानी टेबलों का नाम बदलें (नीचे Step 0), फिर उसके बाद कभी भी मैनुअल कॉपी चलाएँ।

हमेशा की तरह: मेजर वर्शन एक-एक करके अपग्रेड करें (10 → 11, छोड़ें नहीं), और अपग्रेड से पहले Postgres और ClickHouse का बैकअप लें।

### वैकल्पिक: टेलीमेट्री इतिहास आगे ले जाएँ

Step 0 **अपग्रेड से पहले** चलता है; Step 1 से आगे का सब कुछ **अपग्रेड के पूरी तरह बूट होने के बाद** चलता है (नई टेबलें और उनके materialized views मौजूद होने चाहिए)। अपने ClickHouse होस्ट पर सीधे कनेक्ट करें — native प्रोटोकॉल में HTTP timeout नहीं होते, इसलिए कई घंटों के स्टेटमेंट कोई समस्या नहीं हैं:

```bash
clickhouse-client --database oneuptime
```

शुरू करने से पहले जानने योग्य बातें:

- OneUptime के लाइव रहते हुए कॉपी चलाना सुरक्षित है। नई टेलीमेट्री स्वतंत्र रूप से नई टेबलों में लिखी जाती है; कॉपी किया इतिहास उसके पीछे भरता जाता है।
- बड़े पैमाने (सैकड़ों GB) पर घंटों की उम्मीद रखें।
- नीचे का हर स्टेटमेंट एक `insert_deduplication_token` रखता है, और नई टेबलों में एक deduplication विंडो होती है — इसलिए **बीच में विफल हुए स्टेटमेंट को फिर से चलाना सुरक्षित है** (पहले से डाले गए ब्लॉक छोड़ दिए जाते हैं, मेट्रिक रोलअप में भी), बशर्ते आप उसे उचित समय में फिर से चलाएँ। भारी लाइव इन्जेस्ट के दौरान विंडो (प्रति टेबल अंतिम 10,000 insert ब्लॉक) आख़िरकार पुराने टोकन हटा देती है।
- मेट्रिक्स कॉपी करने से पहले से एग्रीगेट किए गए डैशबोर्ड रोलअप भी अपने आप फिर से बन जाते हैं (हर कॉपी की गई पंक्ति रोलअप materialized views को फिर से भरती है) — इसलिए मेट्रिक कॉपी बाकियों से धीमी है; इसे सबसे अंत में चलाएँ।

#### Step 0 — अपग्रेड से पहले, पुरानी टेबलों का नाम बदलें

अपग्रेड स्टार्टअप पर पुरानी टेबलें हटा देता है, इसलिए जिनसे आप कॉपी करना चाहते हैं उन्हें पहले उसकी पहुँच से बाहर कर दें। OneUptime रोकें (deployment को शून्य पर स्केल करें) ताकि कोई उनमें न लिखे और न ही उन्हें दोबारा बना सके, फिर नाम बदलें — `RENAME TABLE` एक त्वरित metadata ऑपरेशन है, और `IF EXISTS` से ब्लॉक उन टेबलों को छोड़ देता है जो आपके इंस्टॉलेशन में कभी थीं ही नहीं (10.0.x के मध्य से पुराने deployment में `AuditLogV1` या कुछ `…V2` टेबलें नहीं हो सकतीं — तब उस प्रकार का कोई इतिहास कॉपी करने को नहीं है):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

फिर अपग्रेड करें और आगे बढ़ने से पहले OneUptime को पूरी तरह बूट होने दें।

> यदि नाम बदलने के बाद आप v10 पर वापस लौटते हैं (v10 स्टार्टअप पर पुराने नामों वाली खाली टेबलें फिर से बना देता है), तो v10 को दोबारा शुरू करने से पहले `_backup` टेबलों के नाम वापस मूल नामों पर कर दें — वरना रोलबैक के दौरान आई टेलीमेट्री दोबारा बनी टेबलों में जाएगी और बाद के अपग्रेड में हटा दी जाएगी।

#### Step 1 — सोर्स पार्टिशन सूचीबद्ध करें

हर पुरानी टेबल में अधिकतम 16 पार्टिशन होते हैं। हर सोर्स टेबल के लिए:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Step 2 — कॉपी स्टेटमेंट जनरेट करें

कॉलम सेट इंस्टॉलेशन के बीच थोड़े भिन्न हो सकते हैं (पुराने deployment में हाल में जोड़े गए कॉलम नहीं हो सकते), इसलिए कोई बना-बनाया स्टेटमेंट चिपकाने के बजाय अपने लाइव स्कीमा से स्टेटमेंट जनरेट करें। `WITH` क्लॉज़ में `src` और `dst` को ऊपर दी गई तालिका के किसी टेबल-जोड़े पर सेट करें (सोर्स पर Step 0 का `_backup` प्रत्यय लगा है) और चलाएँ:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

जनरेट हुआ स्टेटमेंट केवल वही कॉलम कॉपी करता है जो दोनों टेबलों में साझा हैं (नए कॉलम अपने डिफ़ॉल्ट मान लेते हैं), `serviceId`/`serviceType` का नाम चलते-चलते बदलता है, पंक्तियों को निर्धारक रूप से क्रमबद्ध करता है ताकि दोबारा चलाने पर एक जैसे, deduplicate होने योग्य ब्लॉक बनें, और execution-time तथा partition-count की वे सीमाएँ हटाता है जो इतने बड़े स्टेटमेंट को चाहिए।

#### Step 3 — चलाएँ, एक बार में एक पार्टिशन

जनरेट हुआ स्टेटमेंट लें और `{PARTITION}` (यह दो बार आता है — `WHERE` में और टोकन में) की जगह Step 1 की हर partition id रखें। स्टेटमेंट एक-एक करके चलाएँ, फिर हर टेबल-जोड़े के लिए Step 1–3 दोहराएँ।

> नोट: यदि कोई सोर्स टेबल Step 0 में इसलिए छोड़ी गई क्योंकि वह आपके इंस्टॉलेशन में मौजूद नहीं थी, तो उस जोड़े के लिए Step 1 `UNKNOWN_TABLE` के साथ विफल होगा — बस उस जोड़े को छोड़ दें; उस प्रकार का कोई इतिहास कॉपी करने को नहीं है।

यदि कोई स्टेटमेंट बीच में विफल हो जाए, तो जल्द ही **वही** स्टेटमेंट फिर से चलाएँ — पहले से commit हुए ब्लॉक deduplicate हो जाते हैं। बहुत बाद में दोबारा चला रहे हों, तो पहले पंक्ति-गणना की तुलना करें (Step 5)।

#### Step 4 (वैकल्पिक) — प्रति-होस्ट मेट्रिक रोलअप इतिहास

कॉपी की गई कच्ची मेट्रिक पंक्तियाँ सेवा-स्तर के रोलअप अपने आप फिर से बना देती हैं, लेकिन **प्रति-होस्ट** रोलअप नहीं (पुरानी पंक्तियों में host entity key नहीं होती)। Step 0 में नाम बदली गई पुरानी रोलअप टेबल ही इस इतिहास का एकमात्र स्रोत है; होस्टनेम से नई key निकालकर इसे आगे ले जाएँ:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

`ORDER BY` महत्वपूर्ण है: इससे दोबारा चलाने पर एक जैसे insert ब्लॉक बनते हैं जिन्हें deduplication टोकन पहचान सकता है। इसके बिना दोबारा चलाना चुपचाप छूट सकता है या दो बार गिना जा सकता है। (किनारे का मामला: `\`, `|` या `=` वाले होस्टनेम — जो वैध RFC-1123 होस्टनेम वर्ण नहीं हैं — एप्लिकेशन से अलग key निकालेंगे; जब तक आपको पता न हो कि ऐसे होस्ट हैं, इसे अनदेखा करें।)

#### Step 5 — सत्यापित करें

हर टेबल-जोड़े के योग की तुलना करें (नई टेबल में अपग्रेड के बाद की पंक्तियाँ भी हैं, इसलिए वह पुरानी से बड़ी या बराबर होनी चाहिए):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 — बैकअप हटाएँ

नाम बदली गई टेबलें अपनी retention TTL बनाए रखती हैं, इसलिए वे अपने आप खाली होकर सिकुड़ती जाती हैं — लेकिन कॉपी से संतुष्ट होते ही उन्हें हटा दें ताकि डिस्क तुरंत खाली हो जाए:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` केवल उसी स्टेटमेंट के लिए सर्वर की 50 GB ड्रॉप-सुरक्षा हटाता है।)

> सुझाव: हर मेजर अपग्रेड की तरह, पहले staging परिवेश में परीक्षण करें और प्रोडक्शन में कॉपी पर भरोसा करने से पहले पुष्टि करें कि टेलीमेट्री नई टेबलों में आ रही है।

## OneUptime 9 → 10 से Upgrade करना

ऐसा कोई change नहीं जिसके लिए manual कार्रवाई आवश्यक हो। बस standard upgrade process का पालन करें।

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
