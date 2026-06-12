# OneUptime को Upgrade करना

यह मार्गदर्शिका आपके self-hosted OneUptime installation को सुरक्षित रूप से upgrade करने का तरीका बताती है।

## सामान्य मार्गदर्शन

- major versions में step-by-step upgrade करें (उदाहरण के लिए, 6 → 7 → 8)। major versions skip न करें।
- आप minor/patch versions को leapfrog कर सकते हैं (उदाहरण के लिए, 8.1 → 8.4) जब तक आप release notes का पालन करते हैं।
- Upgrade से पहले हमेशा backups लें और सत्यापित करें कि आप उन्हें restore कर सकते हैं।

## OneUptime 10 → 11 से Upgrade करना

OneUptime 11 ClickHouse telemetry storage को फिर से बनाता है। यह पृष्ठ
बताता है कि क्या बदलता है, किसे कार्रवाई करने की आवश्यकता है, और — उन
installations के लिए जो historical telemetry को आगे ले जाना चाहते हैं —
इसके लिए आवश्यक हर query।

### v11 में क्या बदलता है

Telemetry (logs, traces, metrics, exceptions, profiles, monitor logs,
audit logs) नई ClickHouse tables में move होती है, जिनमें time-based
partitioning, per-column compression codecs, और नए entity-model columns
हैं:

| पुरानी table          | नई table              |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

हर telemetry table पर दो columns rename किए गए हैं: `serviceId` →
`primaryEntityId` और `serviceType` → `primaryEntityType`। यह एक hard
rename है — **यदि आप `serviceId`/`serviceType` filters के साथ OneUptime
analytics API को सीधे query करते हैं, तो उन्हें नए नामों में update करें।**
OneUptime के अंदर के dashboards, monitors और alerts अपने आप migrate हो
जाते हैं।

यह cut **forward-only** है: नई tables खाली शुरू होती हैं, upgrade के बाद
ingest होने वाली सारी telemetry तुरंत उनमें जाती है, और समय बीतने के साथ
history स्वाभाविक रूप से वापस भर जाती है। पुरानी tables upgrade के दौरान
उनकी disk reclaim करने के लिए **अपने आप drop कर दी जाती हैं** — यदि आप
history को आगे ले जाने का विकल्प चाहते हैं, तो upgrade करने **से पहले**
उन्हें rename करें (नीचे Step 0)।

> **पहले से 11.0.0 या 11.0.1 पर हैं?** उन releases में पुरानी tables रखी
> जाती थीं (वे TTL के माध्यम से drain होती थीं, और copy "upgrade के बाद
> किसी भी समय" चलाई जा सकती थी)। उसके बाद का कोई भी update उन्हें **boot
> पर drop कर देता है**। यदि आप अभी भी history copy चाहते हैं और अभी तक
> नहीं की है, तो update apply करने से पहले नीचे दिया गया Step 0 चलाएं।

### किसे कुछ करने की आवश्यकता है

- **Fresh installations:** कुछ करने की आवश्यकता नहीं।
- **ऐसे upgrades जिन्हें UI में pre-upgrade telemetry की आवश्यकता नहीं:**
  कुछ करने की आवश्यकता नहीं। Telemetry pages बस upgrade के क्षण से आगे का
  डेटा दिखाते हैं; पुराना डेटा बिना दिखे पुरानी tables से age out हो जाता
  है।
- **ऐसे upgrades जो pre-upgrade telemetry दिखाना चाहते हैं:** upgrade के
  बाद किसी भी समय, नीचे दी गई manual copy चलाएं।

हमेशा की तरह: major versions को step-by-step upgrade करें (10 → 11, skip
न करें), और upgrade से पहले Postgres और ClickHouse के backups लें।

### वैकल्पिक: telemetry history को आगे ले जाना

इन्हें **upgrade के पूरी तरह boot हो जाने के बाद** चलाएं (नई tables और
उनके materialized views मौजूद होने चाहिए)। अपने ClickHouse host पर सीधे
connect करें — native protocol में कोई HTTP timeouts नहीं होते, इसलिए कई
घंटों तक चलने वाले statements ठीक हैं:

```bash
clickhouse-client --database oneuptime
```

शुरू करने से पहले जानने योग्य बातें:

- OneUptime के live रहते copy चलाना सुरक्षित है। नई telemetry स्वतंत्र रूप
  से नई tables में लिखी जाती है; copy की गई history उसके पीछे भरती जाती
  है।
- बड़े पैमाने पर (सैकड़ों GB) घंटों की अपेक्षा करें।
- नीचे दिए गए हर statement में एक `insert_deduplication_token` है, और नई
  tables एक deduplication window के साथ आती हैं — इसलिए **बीच में fail हुए
  statement को फिर से चलाना सुरक्षित है** (पहले से insert हो चुके blocks
  skip हो जाते हैं, metric rollups सहित), बशर्ते आप उसे उचित समय के भीतर
  फिर से चलाएं। भारी live ingest के दौरान window (प्रति table अंतिम
  10,000 insert blocks) अंततः पुराने tokens को evict कर देती है।
- Metrics copy करने से pre-aggregated dashboard rollups भी अपने आप फिर से
  बन जाते हैं (हर copy की गई row rollup materialized views को फिर से feed
  करती है) — इससे metric copy बाकियों की तुलना में धीमी हो जाती है; इसे
  सबसे अंत में चलाएं।

#### Step 1 — source partitions की सूची बनाएं

हर पुरानी table में अधिकतम 16 partitions होते हैं। हर source table के
लिए:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Step 2 — copy statement generate करें

Installations के बीच column sets थोड़े अलग हो सकते हैं (पुराने deployments
में हाल ही में जोड़े गए columns नहीं हो सकते), इसलिए किसी fixed statement
को copy-paste करने की बजाय अपने live schema से statement generate करें।
`WITH` clause में `src` और `dst` को ऊपर दी गई table के किसी एक table pair
पर set करें, और चलाएं:

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
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

Generate किया गया statement केवल वही columns copy करता है जो दोनों tables
में साझा हैं (नए columns अपने defaults लेते हैं), `serviceId`/`serviceType`
को on the fly rename करता है, rows को deterministic क्रम में रखता है ताकि
retry करने पर समान, deduplicate होने योग्य blocks बनें, और execution-time
तथा partition-count की वे सीमाएं हटाता है जिनकी इस आकार के statement को
आवश्यकता होती है।

#### Step 3 — इसे चलाएं, एक बार में एक partition

Generate किए गए statement में `{PARTITION}` (यह दो बार आता है — `WHERE`
में और token में) को Step 1 के हर partition id से substitute करें।
Statements को एक-एक करके चलाएं, फिर हर table pair के लिए Steps 1–3
दोहराएं।

यदि कोई statement बीच में fail हो जाए, तो तुरंत **वही** statement फिर से
चलाएं — पहले से commit हो चुके blocks deduplicate हो जाते हैं। यदि बहुत
बाद में फिर से चला रहे हों, तो पहले row counts की तुलना करें (Step 5)।

#### Step 4 (वैकल्पिक) — per-host metric rollup history

Copy की गई raw metric rows service-level rollups को अपने आप फिर से बना
देती हैं, लेकिन **per-host** rollup को नहीं (पुरानी rows में host entity
key नहीं होती)। Upgrade जानबूझकर पुरानी per-host rollup table को अपनी जगह
छोड़ देता है ताकि आप hostname से नई key compute करते हुए उसे आगे ले जा
सकें:

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
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### Step 5 — सत्यापित करें

हर table pair के totals की तुलना करें (नई table में post-upgrade rows भी
होती हैं, इसलिए वह पुरानी table से अधिक या उसके बराबर होनी चाहिए):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 (वैकल्पिक) — disk जल्दी reclaim करें

पुरानी tables TTL के माध्यम से अपने आप खाली हो जाती हैं, लेकिन एक बार जब
आप copy से संतुष्ट हो जाएं तो आप उन्हें तुरंत drop कर सकते हैं:

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> सुझाव: हर major upgrade की तरह, पहले staging environment में test करें
> और production में copy पर निर्भर होने से पहले confirm करें कि telemetry
> नई tables में flow कर रही है।



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
