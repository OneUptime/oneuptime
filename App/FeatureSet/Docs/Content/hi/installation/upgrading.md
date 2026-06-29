# OneUptime को Upgrade करना

यह मार्गदर्शिका आपके self-hosted OneUptime installation को सुरक्षित रूप से upgrade करने का तरीका बताती है।

## सामान्य मार्गदर्शन

- major versions में step-by-step upgrade करें (उदाहरण के लिए, 6 → 7 → 8)। major versions skip न करें।
- आप minor/patch versions को leapfrog कर सकते हैं (उदाहरण के लिए, 8.1 → 8.4) जब तक आप release notes का पालन करते हैं।
- Upgrade से पहले हमेशा backups लें और सत्यापित करें कि आप उन्हें restore कर सकते हैं।

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
