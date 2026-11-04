# डेटाबेस कनेक्ट करें

डेटा ऑब्ज़र्वेबिलिटी हर डेटाबेस को ऐसे लॉगिन से पढ़ता है जो सिर्फ़ उसका कैटलॉग पढ़ता है: उसमें कौन-सी टेबल और व्यू हैं, उनके कॉलम, पंक्तियां और आकार, और वे कब बदले। यह पेज बताता है कि हर इंजन को कम से कम क्या चाहिए, और प्रोब की मदद से कनेक्शन स्ट्रिंग को अपने नेटवर्क के अंदर कैसे रखें।

## शुरू करने से पहले

- **ऐसी भूमिका जो डेटाबेस कनेक्ट कर सके**: प्रोजेक्ट स्वामी, प्रोजेक्ट एडमिन या टेलीमेट्री एडमिन।
- **केवल पढ़ने वाला लॉगिन**, जो नीचे दिए स्टेटमेंट से बनाया जाता है। बाद में जोड़ी गई जांचें उन टेबल की पंक्तियां पढ़ती हैं जिनकी वे जांच करती हैं, इसलिए लॉगिन को उन टेबल पर `SELECT` तभी दें जब आप कोई जांच जोड़ें।

## चुनें कि कौन कनेक्ट करे

**डेटा अवलोकनीयता > डेटाबेस** पर, **Connect a Database** चुनें, फिर:

- **OneUptime connects**: कनेक्शन स्ट्रिंग पेस्ट करें। इसे एन्क्रिप्ट करके सहेजा जाता है, सिर्फ़ OneUptime के वर्कर इसका उपयोग करते हैं, और यह फिर कभी नहीं दिखाई जाती।
- **A probe in my network connects**: अपने किसी प्रोब को चुनें और प्रोब पर उस एनवायरनमेंट वेरिएबल का नाम दें जिसमें कनेक्शन स्ट्रिंग है, जैसे `ORDERS_DB_URL`। कनेक्शन स्ट्रिंग कभी आपके नेटवर्क से बाहर नहीं जाती। देखें [कस्टम प्रोब](/docs/probe/custom-probe)।

डेटा सुरक्षा के लिए पहले से कनेक्ट किए गए डेटाबेस पर भी बिना कुछ कनेक्ट किए नज़र रखी जाती है, और आपके [क्लाउड कनेक्शन](/docs/telemetry/cloud-accounts) को मिले हर BigQuery डेटासेट पर भी।

## जो डेटाबेस आप कनेक्ट कर सकते हैं

**डेटाबेस** के अंतर्गत **जो डेटाबेस आप कनेक्ट कर सकते हैं** वह सूची है जिसे आपका प्रोजेक्ट पहले से जानता है और जिसे किसी ने कनेक्ट नहीं किया: वे डेटाबेस जिनसे आपके ट्रेस बात करते हैं, आपके क्लाउड खातों के डेटाबेस, और वे जिन पर डेटाबेस मॉनिटरिंग नज़र रखती है। **कनेक्ट करें** हर एक के बारे में जो पता है उसी से फ़ॉर्म शुरू करता है, भरने के लिए एक कनेक्शन स्ट्रिंग के साथ। **छिपाएं** किसी को वापस आने से रोकता है। जब तक आप कनेक्ट नहीं करते, कुछ नहीं पढ़ा जाता।

## हर इंजन के लिए केवल पढ़ने वाला लॉगिन

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

कनेक्शन स्ट्रिंग: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`। OneUptime `pg_class`, `pg_stat_user_tables` और `pg_attribute` पढ़ता है: कोई टेबल तब बदली मानी जाती है जब उसके insert, update या delete काउंटर आगे बढ़ें, और तब पढ़ी गई मानी जाती है जब उसके scan काउंटर आगे बढ़ें।
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` से OneUptime संग्रहों के बीच हुए राइट और रीड देख पाता है; इसके बिना भी `information_schema.TABLES` बताता है कि हर टेबल आख़िरी बार कब बदली।
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` से OneUptime आकार, आख़िरी अपडेट और आख़िरी रीड पढ़ पाता है।
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

क्लस्टर या वर्कग्रुप के एंडपॉइंट से PostgreSQL कनेक्शन स्ट्रिंग के साथ कनेक्ट करें, जैसे `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`। `SYSLOG ACCESS UNRESTRICTED` से OneUptime पंक्तियों की गिनती और आकार, हर उपयोगकर्ता के आख़िरी राइट और रीड, और क्वेरी लॉग से लाइनेज पढ़ पाता है। इसके बिना भी, किसी टेबल की पंक्तियों का बदलना बता देता है कि वह कब बदली।
@tab Snowflake
```sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
```

Snowflake को उसके SQL API से key-pair ऑथेंटिकेशन के साथ पढ़ा जाता है। JSON के साथ कनेक्ट करें:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

कैटलॉग `SHOW` से पढ़ा जाता है, जिसे किसी warehouse की ज़रूरत नहीं होती, इसलिए संग्रह में कोई क्रेडिट खर्च नहीं होता। सिर्फ़ जांचें warehouse पर चलती हैं, उस शेड्यूल पर जो आप उन्हें देते हैं।
@tab Google BigQuery
आपके क्लाउड कनेक्शन को मिले हर डेटासेट पर उस कनेक्शन के सर्विस अकाउंट से नज़र रखी जाती है। कैटलॉग पढ़ने के लिए उसे प्रोजेक्ट पर **BigQuery Metadata Viewer** और **BigQuery Job User** दें, आपकी जांचें जिन टेबल को पढ़ती हैं उन पर **BigQuery Data Viewer**, और उसके jobs से लाइनेज के लिए **BigQuery Resource Viewer**।

हर संग्रह डेटासेट की `__TABLES__` (पंक्तियां, बाइट और आख़िरी बदलाव, बिना किसी लागत के) और उसकी `INFORMATION_SCHEMA.COLUMNS` (BigQuery के 10 MB न्यूनतम पर बिल की जाती है) पढ़ता है। क्लाउड कनेक्शन के बिना डेटासेट कनेक्ट करने के लिए, सर्विस अकाउंट कुंजी के साथ JSON दें:

```json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
```
@tab ClickHouse
```sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
```

ClickHouse को उसके HTTP इंटरफ़ेस से पढ़ा जाता है, TLS के साथ पोर्ट 8443 (ClickHouse Cloud) पर या उसके बिना 8123 पर: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`। सिर्फ़ किसी एक डेटाबेस पर नज़र रखने के लिए उसका नाम दें, या सर्वर के अपने डेटाबेस छोड़कर हर डेटाबेस पर नज़र रखने के लिए उसे छोड़ दें। `system.parts` से OneUptime हर insert देख पाता है (merge नहीं गिना जाता), `system.part_log`, जहां सर्वर उसे रखता है, हर insert का समय देता है, और `system.query_log` घंटे में एक बार आख़िरी रीड और लाइनेज देता है। हर स्टेटमेंट केवल पढ़ने के मोड में चलता है, इसलिए लिखने में सक्षम लॉगिन भी कुछ नहीं लिख सकता।
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

एक Unity Catalog कैटलॉग एक डेटाबेस है। सर्विस प्रिंसिपल के साथ कनेक्ट करें, या `clientId` और `clientSecret` की जगह `"token"` के रूप में पर्सनल एक्सेस टोकन के साथ:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

कैटलॉग, उसके कॉलम और हर Delta टेबल का आख़िरी commit बिना किसी SQL warehouse के Unity Catalog के REST API से आते हैं, इसलिए संग्रह में कोई कंप्यूट खर्च नहीं होता। जांचें, और `system.access.table_lineage` से घंटे में एक बार लाइनेज और आख़िरी रीड, उस SQL warehouse पर चलते हैं जिसका आप नाम देते हैं; सर्विस प्रिंसिपल को उस पर **Can use** दें।
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle अपने ही प्रोटोकॉल से पढ़ा जाता है, कोई Oracle क्लाइंट इंस्टॉल किए बिना: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`। लॉगिन वे टेबल देखता है जिन्हें वह पढ़ सकता है: निगरानी वाली हर टेबल पर `READ` दें, जिससे वह उन्हें क्वेरी कर सके पर कभी लॉक या बदल न सके। `SELECT_CATALOG_ROLE` से OneUptime हर टेबल का आकार पढ़ता है, और `ALL_TAB_MODIFICATIONS` हर टेबल के पिछले आँकड़ों के बाद के inserts, updates और deletes, और वह आख़िरी बार कब बदली, बताता है।
@tab Amazon Athena
एक Glue डेटाबेस एक डेटाबेस है। इसकी टेबल और व्यू, उनके कॉलम और आँकड़े, और हर Iceberg टेबल का आख़िरी commit Glue Data Catalog के API से आते हैं, जो कोई डेटा नहीं पढ़ता और कुछ खर्च नहीं होता। जांचें आपके बताए workgroup में Athena क्वेरी के रूप में चलती हैं। ऐसे IAM उपयोगकर्ता या भूमिका की कुंजियों से कनेक्ट करें जो `glue:GetDatabase` और `glue:GetTables` कॉल कर सके, और जांचों के लिए टेबल के डेटा तक पढ़ने की पहुँच के साथ workgroup में Athena क्वेरी चला सके:

```json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
```
@tab MongoDB
```javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
```

MongoDB उसके अपने ड्राइवर से पढ़ा जाता है: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/`, या replica set के होस्ट के साथ `mongodb://`। पाथ में दिया गया डेटाबेस ही अकेला निगरानी में रहता है; उसके बिना, लॉगिन जिन डेटाबेस को पढ़ सकता है वे सब निगरानी में रहते हैं, और `readAnyDatabase` की जगह `{ role: "read", db: "orders" }` उसे एक तक सीमित करता है। हर कलेक्शन के दस्तावेज़, आकार और राइट `$collStats` से आते हैं, और उसे आखिरी दस्तावेज़ कब मिला, यह उसकी सबसे नई `_id` से। उसके फ़ील्ड उसके वैलिडेटर की JSON स्कीमा से आते हैं, नहीं तो उसके 100 सबसे नए दस्तावेज़ों के फ़ील्ड के नाम और प्रकार से, जो डेटाबेस के अंदर ही निकाले जाते हैं ताकि कोई मान बाहर न जाए। जहाँ secondary हो, दस्तावेज़ वहीं पढ़े जाते हैं, और कस्टम जांच JSON में एक एग्रीगेशन पाइपलाइन है।
:::

## क्या पढ़ा जाता है, और कितनी बार

| क्या | कब |
| --- | --- |
| टेबल, व्यू, कॉलम, पंक्तियां, आकार और आख़िरी बदलाव | हर पांच मिनट में |
| जांचें | हर 15 मिनट, घंटे, 6 घंटे या दिन में, जैसा हर जांच में तय हो |
| क्वेरी इतिहास से लाइनेज और आख़िरी रीड | घंटे में एक बार, पिछली रीड से आगे |

हर स्टेटमेंट केवल पढ़ने के मोड में चलता है, और जहां इंजन में ये हों, वहां स्टेटमेंट और लॉक टाइमआउट के साथ। कनेक्शन स्ट्रिंग कभी लॉग नहीं होती और हर त्रुटि से हटा दी जाती है। जो आंकड़ा लॉगिन नहीं पढ़ सकता, उसे डेटाबेस पर एक चेतावनी के साथ छोड़ दिया जाता है, लेकिन इससे संग्रह कभी विफल नहीं होता। OneUptime Cloud पर निजी पतों से कनेक्शन अस्वीकार किए जाते हैं: प्रोब का उपयोग करें।

## रीड रेप्लिका

PostgreSQL या SQL Server की रीड रेप्लिका अपने राइट काउंटर नहीं बढ़ाती, इसलिए वहां की कोई टेबल बदलते हुए भी बिना बदली दिख सकती है। OneUptime देख लेता है कि यह रेप्लिका है, काउंटर छोड़ देता है, डेटाबेस पर यह बताता है, और टेबल के आकार और पंक्तियों पर लौट आता है। जहां हो सके प्राइमरी को कनेक्ट करें, या जो टेबल मायने रखती हैं उनके लिए [freshness कॉलम](/docs/data-observability/table-health) का नाम दें।

## स्टोरेज पाथ

जिन पर आप निर्भर हैं वे सब डेटाबेस में नहीं होते। हर रात किसी बकेट में आने वाला एक्सपोर्ट किसी भी टेबल जितना देर से, या छोटा, हो सकता है। **स्टोरेज पाथ** के अंतर्गत, Amazon S3, Google Cloud Storage या किसी Azure स्टोरेज खाते पर, अपने [क्लाउड कनेक्शन](/docs/telemetry/cloud-accounts) को मिले किसी बकेट के लिए **पाथ संपादित करें** चुनें, और जो पाथ मायने रखते हैं उनके नाम दें, हर पंक्ति में एक। Azure पर, हर पाथ की शुरुआत उसके कंटेनर के नाम से करें।

फिर हर पाथ **टेबल** के अंतर्गत दिखता है: उसका सबसे नया ऑब्जेक्ट उसका आख़िरी बदलाव है, उसके ऑब्जेक्ट उसकी पंक्तियां हैं, और उनका आकार उसका आकार, और वही अलर्ट लागू होते हैं। केवल नाम, आकार और समय पढ़े जाते हैं, कोई ऑब्जेक्ट कभी नहीं। 10000 से ज़्यादा ऑब्जेक्ट वाले पाथ का सटीक गिनती, आकार या सबसे नया ऑब्जेक्ट नहीं होता, और वह यह बताता है: ज़्यादा संकरा पाथ चुनें।

## समस्या निवारण

- **डेटाबेस का संग्रह विफल दिखता है।** उसका संदेश बताता है क्यों: कोई होस्ट जिस तक OneUptime नहीं पहुंच सकता, अस्वीकार किया गया लॉगिन, या कोई TLS मोड जिसे सर्वर स्वीकार नहीं करता। अपने नेटवर्क के अंदर के डेटाबेस को प्रोब से कनेक्ट करें।
- **टेबल पर कोई आख़िरी बदलाव नहीं दिखता।** लॉगिन इंजन के आंकड़े नहीं पढ़ सकता: आपके इंजन के टैब में जो दिया है वह अनुमति दें, या किसी टेबल की पंक्तियों के दो बार बदलने तक इंतज़ार करें।
- **कोई टेबल गायब है।** वह ऐसे स्कीमा में है जिसका लॉगिन उपयोग नहीं कर सकता, या डेटाबेस पर उसे बाहर रखा गया है। उसके स्कीमा पर `USAGE` दें, या उसे बाहर रखने का नियम हटाएं।
- **MySQL टेबल में कॉलम नहीं हैं।** लॉगिन को ऊपर बताए अनुसार `REFERENCES` चाहिए: यह किसी टेबल के कॉलम दिखाता है, उसकी पंक्तियां पढ़ने की अनुमति दिए बिना।

## अगले कदम

:::cards
- [टेबल का स्वास्थ्य](/docs/data-observability/table-health): हर संग्रह हर टेबल के बारे में क्या सीखता है, और कौन-से अलर्ट सुझाता है।
- [जांचें और मिलान](/docs/data-observability/checks): टेबल में रखी चीज़ों पर नियम।
:::
