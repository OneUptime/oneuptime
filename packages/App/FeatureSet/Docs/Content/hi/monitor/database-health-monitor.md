# डेटाबेस हेल्थ मॉनिटर

Database Health मॉनिटर तय समय पर PostgreSQL, MySQL या Microsoft SQL Server से जुड़ता है और सर्वर के अपने हेल्थ संकेत बताता है — कनेक्शन की गुंजाइश, ब्लॉक हुए सेशन, रेप्लिकेशन लैग, कैश हिट अनुपात, डेटाबेस का आकार, ट्रांज़ैक्शन ID रैपअराउंड और लगभग तीस और — ताकि आप इन पर उसी तरह अलर्ट कर सकें जैसे किसी वेबसाइट के डाउन होने पर करते हैं।

आपको कोई SQL नहीं लिखना होता। प्रोब हर इंजन के हिसाब से चुनी गई केवल-पढ़ने वाली कैटलॉग क्वेरी का एक तय सेट चलाता है और नाम वाले कुछ गिने-चुने आँकड़े बताता है।

:::cards
- [मॉनिटरिंग उपयोगकर्ता बनाएं](#मॉनिटरिंग-उपयोगकर्ता-बनाएं): हर इंजन को जिन अनुमतियों की ज़रूरत है। यही सबसे अहम चरण है।
- [मॉनिटर बनाएं](#database-health-मॉनिटर-बनाएं): प्रोब को डेटाबेस की ओर करें और चुनें कि क्या इकट्ठा करना है।
- [इकट्ठा किए गए मेट्रिक्स](#इकट्ठा-किए-गए-मेट्रिक्स): हर सीरीज़, उसे रिपोर्ट करने वाले इंजनों के साथ।
- [मानदंड सेट करें](#मानदंड-सेट-करें): कनेक्शन, ब्लॉकिंग, लैग और रैपअराउंड पर अलर्ट करें।
:::

## Database Health या SQL Query?

डेटाबेस मॉनिटर के ये दो प्रकार अलग-अलग सवालों के जवाब देते हैं और इन्हें साथ-साथ इस्तेमाल करने के लिए बनाया गया है।

| | Database Health | [SQL Query](/docs/monitor/sql-monitor) |
|---|---|---|
| किस सवाल का जवाब देता है | "क्या डेटाबेस खुद ठीक है?" | "क्या मेरा डेटा वैसा है जैसा मैं उम्मीद करता हूँ?" |
| क्वेरी | बिल्ट-इन, हर इंजन के लिए अलग, केवल पढ़ने के लिए | आपकी अपनी |
| क्या बताता है | नाम वाले संख्यात्मक मेट्रिक्स ([इकट्ठा किए गए मेट्रिक्स](#इकट्ठा-किए-गए-मेट्रिक्स) देखें) | पंक्तियों की संख्या, स्केलर मान, पहली पंक्ति, निष्पादन समय |
| आम अलर्ट | इस्तेमाल हो रहे कनेक्शन 90% से ऊपर | पिछले पाँच मिनट में 50 से ज़्यादा रद्द ऑर्डर |
| ज़रूरी अनुमतियाँ | आँकड़ों/DMV को पढ़ने की पहुँच — [मॉनिटरिंग उपयोगकर्ता बनाएं](#मॉनिटरिंग-उपयोगकर्ता-बनाएं) देखें | आपकी क्वेरी जिन टेबल को छूती है, उन पर `SELECT` |

अगर आप किसी बिज़नेस स्थिति पर अलर्ट करना चाहते हैं, तो SQL Query मॉनिटर का उपयोग करें। अगर आप यह जानना चाहते हैं कि सर्वर के कनेक्शन खत्म होने वाले हैं, उससे पहले कि बिज़नेस स्थिति के बिगड़ने की नौबत भी आए, तो इसका उपयोग करें।

## समर्थित डेटाबेस

| डेटाबेस | डिफ़ॉल्ट पोर्ट |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database और Azure SQL Managed Instance **Microsoft SQL Server** के रूप में जुड़ते हैं। उन्हें अलग अनुमतियाँ चाहिए — [मॉनिटरिंग उपयोगकर्ता बनाएं](#मॉनिटरिंग-उपयोगकर्ता-बनाएं) देखें।

PostgreSQL- और MySQL-संगत इंजन जो वही वायर प्रोटोकॉल बोलते हैं, आम तौर पर काम करते हैं, लेकिन उनमें आँकड़ों के व्यू कम हो सकते हैं; ऐसे में प्रभावित मेट्रिक्स इकट्ठा होने के बजाय उपलब्ध नहीं के रूप में रिपोर्ट होते हैं। आधिकारिक रूप से केवल ऊपर के तीन इंजनों का परीक्षण किया जाता है।

आपके ऐप्लिकेशन, क्लस्टर और होस्ट जिस भी डेटाबेस का उपयोग करते हैं — ये तीन इंजन और कई अन्य — उसका अपना पेज भी होता है, जिसमें उसके इंजन मेट्रिक्स, लॉग और उसे कॉल करने वाली सेवाएँ होती हैं: [डेटाबेस](/docs/telemetry/databases) देखें। जब कोई Database Health मॉनिटर जिस होस्ट और पोर्ट से जुड़ता है, वह किसी डेटाबेस के एंडपॉइंट में से एक हो, तो मॉनिटर के अलर्ट और घटनाएं उस डेटाबेस के पेज पर भी दिखती हैं ([किसी डेटाबेस पर अलर्ट](/docs/telemetry/databases#alerts-on-a-database) देखें)।

## यह कैसे काम करता है

हर जाँच पर प्रोब यह करता है:

1. आपके सेट किए क्रेडेंशियल से डेटाबेस से जुड़ता है।
2. एक हल्की प्रोब क्वेरी चलाता है। **यही एकमात्र स्टेटमेंट है जिसके विफल होने पर मॉनिटर ऑफ़लाइन हो सकता है।**
3. हर चालू [मेट्रिक ग्रुप](#मेट्रिक-ग्रुप) की कैटलॉग क्वेरी एक-एक करके चलाता है, हर एक पर स्टेटमेंट टाइमआउट के साथ।
4. इकट्ठा किए गए आँकड़े बताता है, और हर उस ग्रुप के लिए एक नोट जोड़ता है जिसे वह इकट्ठा नहीं कर सका, कारण के साथ।

```mermaid title="एक जाँच, और वह इकलौता चरण जो मॉनिटर को ऑफ़लाइन कर सकता है"
flowchart TB
    connect["डेटाबेस से जुड़ें"] --> probe{"प्रोब क्वेरी ठीक?"}
    probe -->|"नहीं"| offline["मॉनिटर ऑफ़लाइन"]
    probe -->|"हाँ"| groups["हर मेट्रिक ग्रुप चलाएं"]
    groups --> group{"ग्रुप इकट्ठा हुआ?"}
    group -->|"हाँ"| metrics["मेट्रिक्स रिपोर्ट हुए"]
    group -->|"नहीं"| issue["मेट्रिक्स गायब, समस्या दर्ज"]
    metrics --> criteria["मानदंडों का मूल्यांकन"]
    issue --> criteria
```

OneUptime को केवल नाम वाले संख्यात्मक एग्रीगेट भेजे जाते हैं। कोई क्वेरी टेक्स्ट, आपकी टेबल की कोई पंक्ति और कोई स्कीमा नाम आपके नेटवर्क से बाहर नहीं जाता — क्वेरी इंजन के अपने आँकड़ों के व्यू (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` और इसी तरह के) पढ़ती हैं, आपका डेटा कभी नहीं।

क्योंकि जाँच एक प्रोब से चलती है, डेटाबेस का केवल प्रोब से पहुँच में होना ज़रूरी है। अपने नेटवर्क के अंदर एक [कस्टम प्रोब](/docs/probe/custom-probe) रखें, तो OneUptime को डेटाबेस तक किसी रूट की ज़रूरत ही नहीं पड़ती।

## शुरू करने से पहले

- एक **प्रोब** जिसकी डेटाबेस के होस्ट और पोर्ट तक नेटवर्क पहुँच हो। अगर डेटाबेस इंटरनेट से पहुँच में है तो OneUptime द्वारा होस्ट किया गया प्रोब इस्तेमाल करें, वरना अपने नेटवर्क के अंदर [कस्टम प्रोब](/docs/probe/custom-probe)।
- एक **मॉनिटरिंग उपयोगकर्ता**, जिसे अगले सेक्शन में बताए तरीके से बनाया गया हो, और उसके कनेक्शन विवरण।

## मॉनिटरिंग उपयोगकर्ता बनाएं

**यह सबसे अहम चरण है।** मॉनिटर ऐसे आँकड़ों के व्यू पढ़ता है जिन्हें सामान्य लॉगिन देख नहीं सकते, और कम अनुमतियों वाला लॉगिन हमेशा त्रुटि के साथ विफल नहीं होता — PostgreSQL पर वह गलत जवाब देता है। ठीक इन्हीं अनुमतियों वाला एक अलग लॉगिन बनाएं, और कुछ नहीं।

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` एक बिल्ट-इन रोल है (PostgreSQL 10 और बाद के संस्करण) जो आँकड़ों और मॉनिटरिंग के व्यू पढ़ने की पहुँच देता है। यह आपकी टेबल तक कोई पहुँच नहीं देता।

> [!IMPORTANT]
> **PostgreSQL पर `pg_monitor` वैकल्पिक क्यों नहीं है।** इसके बिना `pg_stat_activity` विफल नहीं होता — क्वेरी सफल होती है और केवल मॉनिटरिंग सेशन की अपनी पंक्ति लौटाती है। तब कनेक्शन की गिनती हमेशा `1`, ब्लॉक हुए सेशन `0` और रेप्लिकेशन लैग `0` दिखेगा, ऐसे सर्वर पर भी जो असल में जल रहा हो। इसलिए प्रोब उन क्वेरी को चलाने से **पहले** जाँचता है कि लॉगिन `pg_monitor` (या `pg_read_all_stats`) का सदस्य है या सुपरयूज़र है। अगर इनमें से कुछ भी नहीं है, तो प्रोब Connections, Activity और Locks ग्रुप को उपलब्ध नहीं के रूप में रिपोर्ट करता है, साथ में वह `GRANT` भी जो आपको चाहिए। कुछ न बताना ईमानदार जवाब है; `1` बताना नहीं।

जिस मैनेज्ड सेवा पर `pg_monitor` उपलब्ध नहीं है, वहाँ `pg_read_all_stats` वही व्यू कवर करता है। Amazon RDS पर `GRANT rds_superuser` की ज़रूरत नहीं — `GRANT pg_monitor TO oneuptime_health;` `rds_superuser` के सदस्य के रूप में काम करता है।

### MySQL

```sql
CREATE USER 'oneuptime_health'@'%' IDENTIFIED BY 'a-strong-password';
-- INNODB_TRX (open transactions, longest query) and replication status.
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_health'@'%';
-- Status counters, server variables, and lock waits.
GRANT SELECT ON performance_schema.* TO 'oneuptime_health'@'%';
-- Database size: information_schema.TABLES only shows tables the login can see.
GRANT SELECT ON mydb.* TO 'oneuptime_health'@'%';
FLUSH PRIVILEGES;
```

MySQL का `performance_schema` चालू होना चाहिए (`performance_schema = ON`, 5.6 से डिफ़ॉल्ट)। अगर यह बंद है, तो Connections, Throughput और Locks ग्रुप उपलब्ध नहीं के रूप में रिपोर्ट होते हैं, और इसका समाधान सर्वर को रीस्टार्ट करना है, कोई अनुमति नहीं।

### Microsoft SQL Server और Azure SQL Managed Instance

```sql
-- A server-level grant only runs while the current database is master.
USE master;
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';
-- Every DMV the monitor reads. On SQL Server 2022 and later,
-- VIEW SERVER PERFORMANCE STATE alone is also enough.
GRANT VIEW SERVER STATE TO oneuptime_health;

USE mydb;
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
```

किसी भी दूसरे डेटाबेस से चलाने पर `GRANT VIEW SERVER STATE` Msg 4621 के साथ विफल होता है: "Permissions at the server scope can only be granted when the current database is master"।

> [!WARNING]
> **आपकी टेबल पढ़ने की पहुँच काफ़ी नहीं है।** जो लॉगिन केवल डेटा पढ़ सकता है — `db_datareader` या कोई भी दूसरा "पढ़ने की पहुँच" वाला रोल — वह जुड़ सकता है और डेटाबेस का आकार पाता है, इसके अलावा कुछ नहीं। SQL Server मॉनिटर जिन व्यू को पढ़ता है, उन्हें `The user does not have permission to perform this action.` (Msg 297) के साथ मना कर देता है। उससे पहले का संदेश बताता है कि क्या मना किया गया: सर्वर व्यू के लिए Msg 300 `VIEW SERVER STATE` (2022 पर `VIEW SERVER PERFORMANCE STATE`), जिनमें ट्रांज़ैक्शन लॉग की जगह और tempdb की खाली जगह शामिल हैं, या रेप्लिकेशन व्यू के लिए Msg 262 `VIEW DATABASE STATE` (2022 पर `VIEW DATABASE PERFORMANCE STATE`)। मॉनिटर ऑनलाइन रहता है, Connections, Activity, Throughput, Locks, Storage और Replication ग्रुप में अनुमति की कमी रिपोर्ट करता है, और उनके बगल में ऊपर वाला `GRANT` दिखाता है। `VIEW SERVER STATE` इन सबको कवर करता है।
>
> दो व्यू मना नहीं करते: अनुमति के बिना `sys.dm_exec_sessions` और `sys.dm_exec_requests` चुपचाप केवल मॉनिटर का अपना सेशन दिखाते हैं। मॉनिटर इन्हें कभी अकेले नहीं पढ़ता — हमेशा किसी ऐसे व्यू के साथ जो मना करता है — इसलिए अनुमति की कमी कभी "1 कनेक्शन" के रूप में दर्ज नहीं हो सकती।

### Azure SQL Database

Azure SQL Database में सर्वर-स्तर की अनुमतियाँ नहीं होतीं — वहाँ `GRANT VIEW SERVER STATE` विफल होता है — इसलिए वही व्यू डेटाबेस-स्तर की अनुमति से खुलते हैं। `master` में एक लॉगिन बनाएं, जिस डेटाबेस की आप निगरानी कर रहे हैं उसमें उसके लिए एक उपयोगकर्ता बनाएं, और अनुमति वहीं दें, `master` में नहीं:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

vCore डेटाबेस और S2 या उससे ऊपर के DTU डेटाबेस के लिए इतना काफ़ी है। **Basic, S0 और S1** पर, और किसी **इलास्टिक पूल** के हर डेटाबेस के लिए, Azure इन व्यू को केवल सर्वर एडमिन, Microsoft Entra एडमिन या `##MS_ServerStateReader##` सर्वर रोल के सदस्यों को पढ़ने देता है, चाहे डेटाबेस की अनुमतियाँ कुछ भी कहें। वहाँ सर्वर एडमिन लॉगिन को उस रोल में भी जोड़ता है:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` हर टियर पर काम करता है, इसलिए अगर `VIEW DATABASE STATE` काफ़ी न निकले तो यही विकल्प है। नई रोल सदस्यता लागू होने में कुछ मिनट लग सकते हैं, और यह केवल नए कनेक्शन पर लागू होती है; प्रोब हर जाँच पर नया कनेक्शन खोलता है।

एक कंटेन्ड डेटाबेस उपयोगकर्ता (निगरानी वाले डेटाबेस में `CREATE USER oneuptime_health WITH PASSWORD = '...'` से बना, बिना लॉगिन वाला उपयोगकर्ता) S2 और उससे ऊपर `VIEW DATABASE STATE` के साथ काम करता है, लेकिन `##MS_ServerStateReader##` में शामिल नहीं हो सकता: सर्वर रोल केवल लॉगिन लेते हैं। किसी कंटेन्ड उपयोगकर्ता को इस रोल में लाने के लिए उसे हटाएँ (`DROP USER oneuptime_health;`) और ऊपर के स्टेटमेंट अपनाएँ।

प्रोब Azure SQL Database को उसके संस्करण से नहीं, बल्कि `SERVERPROPERTY('EngineEdition')` से पहचानता है — Azure SQL Database असल में चाहे जो चला रहा हो, `12.0.2000.8` ही बताता है, जो SQL Server 2014 जैसा पढ़ा जाता है। इसलिए मॉनिटर का **Engine** `Azure SQL Database 12.0.2000.8` दिखाता है, और अनुमति की कमी ऊपर वाले Azure स्टेटमेंट के रूप में दिखती है, कभी `VIEW SERVER STATE` के रूप में नहीं।

- **Azure SQL Database पर रेप्लिकेशन इकट्ठा नहीं होता।** Azure SQL Database में `sys.dm_hadr_database_replica_states` नहीं है, इसलिए वहाँ Replication ग्रुप को हर जाँच पर विफल बताने के बजाय छोड़ दिया जाता है। Azure के अपने रेप्लिका व्यू (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) अभी नहीं पढ़े जाते।
- **कनेक्शन हर डेटाबेस के हिसाब से होते हैं।** `VIEW DATABASE STATE` के साथ Azure SQL Database केवल निगरानी वाले डेटाबेस के सेशन दिखाता है, इसलिए Connections लॉजिकल सर्वर के बजाय उसी डेटाबेस को गिनता है। जिन डेटाबेस की आपको परवाह है, हर एक की अलग से निगरानी करें।
- **इलास्टिक पूल में TempDB Free Space पूरे पूल का होता है।** पूल के डेटाबेस एक ही tempdb साझा करते हैं।

## Database Health मॉनिटर बनाएं

:::steps
### नया मॉनिटर शुरू करें

**मॉनिटर** पर जाएं और **मॉनिटर बनाएं** पर क्लिक करें। **मॉनिटर प्रकार** में **और मॉनिटर प्रकार** पर क्लिक करें और **Database Monitoring** के अंतर्गत **Database Health** चुनें, या खोज बॉक्स में `health` टाइप करें। एक **नाम** दर्ज करें, फिर **अगला** पर क्लिक करें।

### कनेक्शन विवरण दर्ज करें

**Database Type** चुनें, फिर होस्ट, पोर्ट, डेटाबेस नाम और मॉनिटरिंग उपयोगकर्ता के क्रेडेंशियल भरें। पासवर्ड टाइप करने के बजाय उसे [मॉनिटर सीक्रेट](#पासवर्ड-के-लिए-मॉनिटर-सीक्रेट-का-उपयोग) के रूप में संदर्भित करें। हर फ़ील्ड [कॉन्फ़िगरेशन](#कॉन्फ़िगरेशन) में बताई गई है।

### चुनें कि क्या इकट्ठा करना है

जब तक किसी ग्रुप को बंद करने की वजह न हो, **Metric Groups** के सभी ग्रुप चालू रहने दें — [मेट्रिक ग्रुप](#मेट्रिक-ग्रुप) देखें।

### कनेक्शन का परीक्षण करें

सेव करने से पहले एक जाँच चलाने के लिए **मॉनिटर का परीक्षण करें** पर क्लिक करें, और देखें कि उसने क्या इकट्ठा किया।

### मानदंड तय करें

मॉनिटर जिन मानदंडों के साथ शुरू होता है उनकी समीक्षा करें और अपने जोड़ें — [मानदंड सेट करें](#मानदंड-सेट-करें) देखें। फिर **अगला** पर क्लिक करें।

### प्रोब चुनें और बनाएं

वे **प्रोब** चुनें जो डेटाबेस तक पहुँच सकते हैं, और एक **निगरानी अंतराल** चुनें, फिर **मॉनिटर बनाएं** पर क्लिक करें।
:::

## कॉन्फ़िगरेशन

| फ़ील्ड | क्या दर्ज करें |
|---|---|
| **Database Type** | PostgreSQL, MySQL या Microsoft SQL Server। प्रकार चुनने से डिफ़ॉल्ट पोर्ट सेट होता है और तय होता है कि कौन-सी क्वेरी चलेंगी। |
| **होस्ट** | प्रोब से पहुँचने योग्य डेटाबेस होस्ट (उदाहरण के लिए `db.internal`)। |
| **पोर्ट** | डेटाबेस पोर्ट। |
| **डेटाबेस नाम** | जिस डेटाबेस से जुड़ना है। डेटाबेस-स्तर के मेट्रिक्स (आकार, कैश हिट अनुपात, अस्थायी फ़ाइलों में जाना) इसी डेटाबेस के लिए बताए जाते हैं; सर्वर-स्तर के मेट्रिक्स (कनेक्शन, अपटाइम, रेप्लिकेशन) पूरे सर्वर के लिए — सिवाय Azure SQL Database के, जहाँ कनेक्शन केवल निगरानी वाले डेटाबेस के लिए गिने जाते हैं। |
| **Use Windows Integrated Authentication** | केवल Microsoft SQL Server। उपयोगकर्ता नाम और पासवर्ड के बजाय प्रोब प्रोसेस की पहचान से प्रमाणीकरण करें। SQL Query मॉनिटर पेज पर [Windows एकीकृत प्रमाणीकरण](/docs/monitor/sql-monitor) देखें — सेटअप बिल्कुल एक जैसा है। |
| **उपयोगकर्ता नाम** | मॉनिटरिंग उपयोगकर्ता। ज़रूरी है, जब तक आप Windows एकीकृत प्रमाणीकरण का उपयोग नहीं करते। |
| **पासवर्ड** | पासवर्ड। इसे सादे टेक्स्ट में टाइप करने के बजाय `{{monitorSecrets.name}}` से किसी [मॉनिटर सीक्रेट](/docs/monitor/monitor-secrets) को संदर्भित करें ([मॉनिटर सीक्रेट का उपयोग](#पासवर्ड-के-लिए-मॉनिटर-सीक्रेट-का-उपयोग) देखें)। |
| **Use SSL/TLS** | TLS पर जुड़ें। चालू होने पर आप सेल्फ़-साइन्ड सर्टिफ़िकेट के लिए **Verify server certificate** बंद कर सकते हैं। |
| **Metric Groups** | कौन-से ग्रुप चलें: Connections, गतिविधि, Throughput, Locks and Blocking, स्टोरेज, Replication और रखरखाव। डिफ़ॉल्ट रूप से सभी चालू हैं; [मेट्रिक ग्रुप](#मेट्रिक-ग्रुप) देखें। मॉनिटर के विवरण में ये **Collected Metric Groups** के रूप में दिखते हैं। |

### और फ़ील्ड

| फ़ील्ड | डिफ़ॉल्ट | अधिकतम | किसे सीमित करता है |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | कनेक्शन बनने के लिए कितनी देर इंतज़ार करना है। |
| **Statement Timeout (ms)** | `10000` | `60000` | किसी एक कैटलॉग क्वेरी की ऊपरी सीमा। |

स्टेटमेंट टाइमआउट का डिफ़ॉल्ट जानबूझकर SQL Query मॉनिटर से कम रखा गया है: स्वस्थ सर्वर पर ये क्वेरी मिलीसेकंड में जवाब देती हैं, इसलिए अगर `pg_stat_activity` को दस सेकंड लगते हैं, तो काम का संकेत "यह सर्वर मुश्किल में है" है, लंबा इंतज़ार नहीं। अधिकतम से बड़ा मान घटाकर अधिकतम कर दिया जाता है।

## पासवर्ड के लिए मॉनिटर सीक्रेट का उपयोग

ताकि पासवर्ड कभी भी मॉनिटर पर सादे टेक्स्ट में सेव न हो:

:::steps
1. **मॉनिटर → सेटिंग्स → सीक्रेट** पर जाएं और एक [मॉनिटर सीक्रेट](/docs/monitor/monitor-secrets) बनाएं।
2. उसे एक नाम दें (उदाहरण के लिए `dbPassword`) और इस मॉनिटर को उसकी पहुँच दें।
3. मॉनिटर के **पासवर्ड** फ़ील्ड में `{{monitorSecrets.dbPassword}}` दर्ज करें।
:::

कॉन्फ़िगरेशन किसी प्रोब को सौंपे जाने से पहले सीक्रेट सर्वर पर हल किया जाता है। होस्ट, उपयोगकर्ता नाम और डेटाबेस नाम फ़ील्ड भी यही संदर्भ स्वीकार करते हैं। क्रेडेंशियल कभी भी लॉग, मॉनिटर फ़ीड या अलर्ट टेम्पलेट में नहीं लिखे जाते।

## मेट्रिक ग्रुप

ग्रुप वह इकाई है जिसे आप चालू या बंद करते हैं, और वह इकाई जिसके लिए अनुमति की कमी रिपोर्ट होती है। ग्रुप इसलिए हैं ताकि एक अनुमति की कमी से पूरा मॉनिटर नहीं, बल्कि केवल एक ग्रुप जाए। किसी ग्रुप के स्टेटमेंट एक-एक करके चलते हैं, इसलिए कोई ग्रुप आंशिक रूप से इकट्ठा हो सकता है: तब वह `collectedGroups` और `unavailableGroups` दोनों में दिखता है। आम मामला `VIEW SERVER STATE` के बिना वाले लॉगिन के लिए SQL Server का Storage ग्रुप है — डेटाबेस का आकार इकट्ठा होता है, लॉग की जगह और tempdb की खाली जगह नहीं।

| ग्रुप | क्या इकट्ठा करता है | क्या चाहिए |
|---|---|---|
| Connections | कनेक्शन की गिनती, सेट की गई सीमा, रद्द हुए कनेक्शन प्रयास, सर्वर का अपटाइम | PostgreSQL: `pg_monitor`। MySQL: `performance_schema`। SQL Server: `VIEW SERVER STATE` |
| Activity | सबसे लंबी चल रही क्वेरी, सबसे लंबा खुला ट्रांज़ैक्शन, खुले ट्रांज़ैक्शन | PostgreSQL: `pg_monitor`। MySQL: `PROCESS`। SQL Server: `VIEW SERVER STATE` |
| Throughput | ट्रांज़ैक्शन, क्वेरी, कैश हिट अनुपात, डिस्क रीड और राइट, I/O समय | PostgreSQL: `CONNECT` के अलावा कुछ नहीं। MySQL: `performance_schema`। SQL Server: `VIEW SERVER STATE` |
| Locks | ब्लॉक हुए सेशन, लॉक प्रतीक्षा, डेडलॉक, टेबल लॉक प्रतीक्षा | PostgreSQL: `pg_monitor`। MySQL: `performance_schema`। SQL Server: `VIEW SERVER STATE` |
| Storage | डेटाबेस का आकार, अस्थायी फ़ाइलों में जाना, लॉग की जगह, tempdb की खाली जगह | PostgreSQL: `CONNECT` के अलावा कुछ नहीं। MySQL: डेटाबेस पर `SELECT`। SQL Server: डेटाबेस के आकार के लिए कुछ नहीं; लॉग की जगह और tempdb की खाली जगह के लिए `VIEW SERVER STATE` |
| Replication | जुड़ी हुई रेप्लिका, सेकंड और बाइट में रेप्लिकेशन लैग, निष्क्रिय स्लॉट, रिकवरी स्थिति | PostgreSQL: `pg_monitor`। MySQL: `REPLICATION CLIENT`। SQL Server: `VIEW SERVER STATE`; Azure SQL Database पर इकट्ठा नहीं होता |
| Maintenance | ट्रांज़ैक्शन ID रैपअराउंड तक की गुंजाइश, डेड ट्यूपल, ऐसी टेबल जिन्हें autovacuum ने कभी नहीं छुआ, चेकपॉइंट | PostgreSQL: `pg_monitor` |

Azure SQL Database पर, जहाँ भी यह तालिका `VIEW SERVER STATE` कहती है, वहाँ `VIEW DATABASE STATE` पढ़ें — या Basic, S0, S1 और इलास्टिक पूल पर `##MS_ServerStateReader##`। [Azure SQL Database](#azure-sql-database) देखें।

किसी ग्रुप को बंद करना चुपचाप होता है: कोई मेट्रिक नहीं, कोई संग्रह समस्या नहीं, कोई अलर्ट नहीं। दो स्थितियों में यही सही कदम है:

- **आपको अनुमति नहीं मिल सकती।** ग्रुप बंद करने से संग्रह समस्या हर जाँच पर दोहराई नहीं जाती।
- **क्वेरी बहुत महंगी हैं।** MySQL पर **स्टोरेज** आम उम्मीदवार है: डेटाबेस का आकार `information_schema.TABLES` का योग करके निकलता है, जो दसियों हज़ार टेबल वाले स्कीमा पर मुफ़्त नहीं है और हर जाँच पर चलता है। इसे बंद करें, या उस मॉनिटर को पाँच मिनट के अंतराल पर कर दें।

सभी ग्रुप से चुनाव हटाना कुछ भी इकट्ठा न करने का तरीका नहीं है — खाली सूची फिर से सभी ग्रुप में बदल दी जाती है, इसलिए कोई मॉनिटर कभी ऐसी स्थिति में सेव नहीं हो सकता जिसमें वह चुपचाप कुछ भी इकट्ठा न करे।

## जब कोई मेट्रिक इकट्ठा नहीं हो पाता तब क्या होता है

**अनुमति की कमी कभी मॉनिटर को ऑफ़लाइन नहीं करती।** यह इस मॉनिटर प्रकार का सबसे अहम व्यवहार है, और इसे सटीक रूप से बताना ज़रूरी है।

| क्या विफल होता है | मॉनिटर की स्थिति | आपको क्या दिखता है |
|---|---|---|
| **कनेक्शन**, या प्रोब क्वेरी — गलत क्रेडेंशियल, कनेक्शन अस्वीकार, TLS विफलता, कनेक्शन टाइमआउट | **ऑफ़लाइन** | `Database Is Online` false होता है, और आपने इससे जो भी घटना और ऑन-कॉल नीति जोड़ी है, वह ट्रिगर होती है। |
| **कोई ग्रुप** — अनुमति की कमी, बंद `performance_schema`, स्टेटमेंट टाइमआउट | **ऑनलाइन रहता है** | जिन मेट्रिक्स को वह ग्रुप नहीं पढ़ सका, वे शून्य नहीं, बल्कि **गायब** होते हैं। कोई चार्ट लाइन नहीं बनती, उन सीरीज़ पर कोई थ्रेशोल्ड मेल नहीं खा सकता, और उनसे कोई घटना नहीं बन सकती। जाँच एक संग्रह समस्या दर्ज करती है, जिसमें ग्रुप, कारण और — जहाँ हो — चलाने के लिए सटीक `GRANT` होता है; यह मॉनिटर के सारांश में दिखती है और **Metric Groups Failed** में गिनी जाती है। |
| **इंजन कोई मेट्रिक बना ही नहीं सकता** — मानक MySQL में कोई डेडलॉक काउंटर नहीं है; SQL Server डिफ़ॉल्ट रूप से अपनी कनेक्शन सीमा असीमित रखता है, इसलिए "इस्तेमाल का प्रतिशत" बेमानी होगा | **ऑनलाइन रहता है** | मेट्रिक बस मौजूद नहीं होता। यह संग्रह समस्या **नहीं** है, Metric Groups Failed में नहीं गिना जाता, और इसमें ठीक करने को कुछ नहीं है। [इकट्ठा किए गए मेट्रिक्स](#इकट्ठा-किए-गए-मेट्रिक्स) में Engines कॉलम देखें। |

गायब का मतलब हमेशा गायब होता है। जो मान मापा नहीं गया, उसे कभी `0` नहीं बताया जाता, क्योंकि गढ़े हुए शून्यों वाला चार्ट खाली जगह से बदतर है — खाली जगह आप देख सकते हैं।

> [!TIP]
> दृश्यता खोने पर अलर्ट के लिए `Database Collection Error` या **Metric Groups Failed** पर थ्रेशोल्ड का उपयोग करें। दोनों को घटना नहीं, अलर्ट बनाएं: रद्द की गई अनुमति एक टिकट है, ऑन-कॉल कॉल नहीं।

### "The user does not have permission to perform this action"

यह SQL Server का संदेश (Msg 297) है ऐसे लॉगिन के लिए जो जुड़ तो सकता है, लेकिन सर्वर की स्थिति वाले व्यू नहीं पढ़ सकता। इसका मतलब हमेशा अनुमति की कमी होता है, कभी डेटाबेस में खराबी नहीं। SQL Server इसे दूसरे नंबर पर भेजता है, उस संदेश के बाद जो मना की गई अनुमति का नाम बताता है, और मॉनिटर दोनों दिखाता है: उदाहरण के लिए `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` इसके बगल में वह स्टेटमेंट होता है जो प्रोब जिस प्लेटफ़ॉर्म से जुड़ा उसके लिए इसे ठीक करता है:

- **SQL Server या Azure SQL Managed Instance** — `GRANT VIEW SERVER STATE TO oneuptime_health;`, `master` में चलाया गया (मॉनिटर इसे `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master` के रूप में दिखाता है)।
- **Azure SQL Database** — `GRANT VIEW DATABASE STATE TO oneuptime_health;`, निगरानी वाले डेटाबेस में चलाया गया; Basic, S0, S1 और इलास्टिक पूल पर इसके बजाय `##MS_ServerStateReader##` की सदस्यता। [Azure SQL Database](#azure-sql-database) देखें।

इस बीच डेटाबेस का आकार इकट्ठा होता रहता है, क्योंकि Storage ग्रुप में यही एकमात्र मेट्रिक है जिसे कोई भी लॉगिन पढ़ सकता है।

## इकट्ठा किए गए मेट्रिक्स

आठ श्रेणियों में इकतालीस सीरीज़। Engines उन इंजनों की सूची है जो सच में वह सीरीज़ बना सकते हैं; किसी भी दूसरे इंजन पर वह बस मौजूद नहीं होती। Group वह संग्रह ग्रुप है जिससे सीरीज़ जुड़ी है — जिसे आप चालू-बंद करते हैं और जो एक साथ प्रभावित होता है।

### उपलब्धता

| मेट्रिक | सीरीज़ | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### कनेक्शन

| मेट्रिक | सीरीज़ | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### थ्रूपुट

| मेट्रिक | सीरीज़ | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### लॉक और ब्लॉकिंग

| मेट्रिक | सीरीज़ | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

मानक MySQL किसी भी तरह का डेडलॉक काउंटर नहीं देता, इसीलिए Deadlocks केवल PostgreSQL और SQL Server पर है।

### कैश और I/O

| मेट्रिक | सीरीज़ | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL I/O के पढ़ने और लिखने का समय केवल तब मापता है जब `track_io_timing` चालू हो। यह डिफ़ॉल्ट रूप से बंद होता है, और तब PostgreSQL दोनों को `0` बताता है — इसलिए PostgreSQL पर इन दो सीरीज़ में सपाट शून्य का मतलब आम तौर पर "मापा नहीं गया" होता है, "तेज़" नहीं। यह सर्वर की सेटिंग है, अनुमति की समस्या नहीं।

### भंडारण

| मेट्रिक | सीरीज़ | Group | Engines |
|---|---|---|---|
| **Database Size** (बाइट) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (बाइट) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (बाइट) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### रेप्लिकेशन

| मेट्रिक | सीरीज़ | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (बाइट) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

रेप्लिकेशन मेट्रिक्स लिंक के उस तरफ़ से बताए जाते हैं जिससे मॉनिटर जुड़ा है। जुड़ी हुई रेप्लिका और भेजने की कतार देखने के लिए मॉनिटर को प्राइमरी की ओर करें; हर स्टैंडबाय असल में कितना पीछे है, यह देखने के लिए हर स्टैंडबाय की ओर एक मॉनिटर करें।

सेकंड में लैग किसी निष्क्रिय प्राइमरी पर शून्य दिखता है, भले ही कोई रेप्लिका बहुत पीछे हो, क्योंकि कुछ नया लिखा ही नहीं गया। **Replication Lag (Bytes)** में यह अंधा कोना नहीं है, इसलिए दोनों पर अलर्ट करें।

### रखरखाव

| मेट्रिक | सीरीज़ | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> आप जो भी PostgreSQL मॉनिटर बनाएं, हर एक पर **Transaction ID Used** के लिए एक मानदंड रखना ज़रूरी है। जब यह 100% पर पहुँचता है तो PostgreSQL सभी राइट मना कर देता है, रिकवरी के लिए डेटाबेस बंद करके सिंगल-यूज़र मोड में vacuum चलाना पड़ता है, और लगभग कोई इस पर नज़र नहीं रखता। चट्टान से काफ़ी पहले अलर्ट करें — ज़्यादातर वर्कलोड पर 80% से कई दिनों की गुंजाइश मिलती है।

`total` पर खत्म होने वाले काउंटर सर्वर शुरू होने के बाद से संचयी होते हैं। दर पाने के लिए समय के दो बिंदुओं की तुलना करें; अकेला मान केवल अपने इतिहास के मुकाबले ही मायने रखता है, और सर्वर रीस्टार्ट होने पर शून्य हो जाता है (जो **Uptime** आपको दिखाएगा)।

## मानदंड सेट करें

| फ़िल्टर प्रकार | यह क्या जाँचता है |
|---|---|
| **Database Is Online** | क्या डेटाबेस पहुँच में था और प्रोब क्वेरी सफल रही। यह वही ऑफ़लाइन मानदंड है जिसके साथ मॉनिटर बनता है, और पहुँच दिखाने वाली इकलौती जाँच है। |
| **Database Metric** | कोई मेट्रिक चुनें, फिर उसकी तुलना करें: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To या Not Equal To। मेट्रिक पिकर केवल वही मेट्रिक्स देता है जो आपका चुना हुआ इंजन बना सकता है, इसलिए आप ऐसा मानदंड नहीं बना सकते जो हमेशा अधूरा रहे (एक अपवाद: Microsoft SQL Server के लिए दिए गए Replication मेट्रिक्स Azure SQL Database पर कभी इकट्ठा नहीं होते)। अगर किसी जाँच पर मेट्रिक इकट्ठा नहीं हुआ — ग्रुप विफल हुआ, या इंजन उसे रिपोर्ट नहीं करता — तो फ़िल्टर मेल नहीं खाता, और "false" के रूप में भी मेल नहीं खाता: उसे छोड़ दिया जाता है। अनुमति की कोई समस्या किसी को कॉल नहीं कर सकती। |
| **Database Collection Error** | जाँच की संग्रह समस्याओं का सारांश, हर उपलब्ध न होने वाले ग्रुप के लिए एक "ग्रुप: संदेश"। दृश्यता खोने को पकड़ने के लिए इसके खाली न होने पर अलर्ट करें, या किसी एक खास ग्रुप पर नज़र रखने के लिए Contains का उपयोग करें। |
| **JavaScript Expression** | पूरा नियंत्रण। [JavaScript एक्सप्रेशन](/docs/monitor/javascript-expression) देखें। |

थ्रेशोल्ड पूर्ण संख्याएँ होते हैं। `90.5` नहीं, `90` लिखें — प्रतिशत और सेकंड पूर्णांक के रूप में तुलना किए जाते हैं।

**Database Is Online** और **Database Metric** को समय के साथ जाँचा जा सकता है: **इस मानदंड का एक समयावधि के दौरान मूल्यांकन करें** पर टिक करें, फिर **मूल्यांकन करें** में चुनें कि मानों को कैसे आँकना है (उदाहरण के लिए **All Values**), और **पिछले (मिनटों में) के लिए** भरें। समय के साथ जाँच में फ़िल्टर की **यदि कोई डेटा नहीं** सेटिंग तय करती है कि गायब मान का क्या मतलब है; इसे **Ignore** पर रखें ताकि अनुमति की कमी तब भी किसी को कॉल न कर सके।

### JavaScript एक्सप्रेशन वेरिएबल

Database Health मॉनिटर के लिए एक्सप्रेशन को इनकी पहुँच होती है:

| वेरिएबल | प्रकार | विवरण |
|---|---|---|
| `isOnline` | boolean | क्या कनेक्शन और प्रोब क्वेरी दोनों सफल रहे |
| `engineVersion` | string | सर्वर ने जो संस्करण स्ट्रिंग बताई (SQL Server पर सादा `ProductVersion`; मॉनिटर का सारांश उसके बगल में प्लेटफ़ॉर्म का नाम बताता है) |
| `connectionError` | string | साफ़ की गई कनेक्शन त्रुटि, कोई त्रुटि न होने पर खाली |
| `collectedGroups` | array | वे ग्रुप जिन्होंने इस जाँच पर मान दिए |
| `unavailableGroups` | array | ऐसे स्टेटमेंट वाले ग्रुप जिन्हें इकट्ठा नहीं किया जा सका, हर एक के साथ कारण और समाधान। आंशिक रूप से इकट्ठा हुआ ग्रुप दोनों सूचियों में होता है |
| `metrics` | object | सीरीज़ के नाम से कुंजीबद्ध इकट्ठा किए गए मान; जो सीरीज़ इकट्ठा नहीं हुई, वह मौजूद नहीं होती |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

किसी एक्सप्रेशन में एक मेट्रिक पढ़ने के लिए पूरे `metrics` ऑब्जेक्ट को इंडेक्स करें — सीरीज़ के नामों में बिंदु होते हैं, इसलिए वे कर्ली ब्रैकेट के अंदर नहीं आ सकते:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

किसी एक मेट्रिक पर थ्रेशोल्ड के लिए एक्सप्रेशन के बजाय **Database Metric** चुनें: यह आपके लिए सीरीज़ खोज लेता है, केवल वही देता है जो आपका इंजन बना सकता है, और मान इकट्ठा न होने पर खाली से तुलना करने के बजाय जाँच छोड़ देता है।

### उदाहरण: एक PostgreSQL प्राइमरी

| क्रम | मानदंड | फ़िल्टर |
|---|---|---|
| 1 | **ऑफ़लाइन** | `Database Is Online` का मान `false` है। |
| 2 | **प्रदर्शन में गिरावट** | `Database Metric` → Connections Used, `90` से ज़्यादा, 5 मिनट तक All Values के साथ आँका गया, ताकि एक अकेला उछाल किसी को कॉल न करे। |
| 3 | **प्रदर्शन में गिरावट** | `Database Metric` → Transaction ID Used, `80` से ज़्यादा। |
| 4 | **प्रदर्शन में गिरावट** | `Database Metric` → Blocked Sessions, 5 मिनट तक `0` से ज़्यादा। |
| 5 | **Online** | `Database Is Online` का मान `true` है। |

मानदंड ऊपर से नीचे आँके जाते हैं और पहला मेल जीतता है, इसलिए अलर्ट वाले मानदंड पहले और स्वस्थ स्थिति वाला सबसे आखिर में रखें।

ऑफ़लाइन मानदंड से एक ऑन-कॉल नीति जोड़ें, और **Metric Groups Failed** या `Database Collection Error` से निकलने वाली हर चीज़ को बिना ऑन-कॉल नीति वाला अलर्ट ही रहने दें।

## ध्यान देने योग्य बातें

- **क्वेरी हर जाँच पर चलती हैं।** ये डिज़ाइन से सस्ती हैं, लेकिन "सस्ता" अंतराल के सापेक्ष होता है। हज़ारों सेशन वाले सर्वर पर एक मिनट का अंतराल शायद आपकी चाह से ज़्यादा `pg_stat_activity` स्कैन करेगा; क्षमता वाले मेट्रिक्स के लिए पाँच मिनट काफ़ी हैं।
- **मॉनिटर को उस डेटाबेस की ओर करें जिसकी आपको परवाह है।** आकार, कैश हिट अनुपात और अस्थायी फ़ाइलों में जाना हर डेटाबेस के लिए होते हैं। कनेक्शन, अपटाइम और रेप्लिकेशन पूरे सर्वर के लिए होते हैं और उस इंस्टेंस के किसी भी डेटाबेस से एक जैसे दिखते हैं।
- **हर इंस्टेंस पर एक मॉनिटर, हर डेटाबेस पर नहीं**, जब तक कि आपको खास तौर पर हर डेटाबेस के आकार और कैश मेट्रिक्स न चाहिए हों — वरना आप बिना नई जानकारी के सर्वर-स्तर की क्वेरी कई गुना कर देते हैं। Azure SQL Database अपवाद है: वह कनेक्शन हर डेटाबेस के हिसाब से बताता है, इसलिए वहाँ हर डेटाबेस की निगरानी करें।
- **काउंटर पर नहीं, दरों पर अलर्ट करें।** `total` पर खत्म होने वाली हर चीज़ केवल बढ़ती है, इसलिए उस पर "से ज़्यादा" थ्रेशोल्ड एक बार फ़ायर होता है और कभी रिकवर नहीं होता। इसे चार्ट करें, या किसी विंडो में इसकी तुलना करें।
- **सादे टेक्स्ट वाले पासवर्ड के बजाय मॉनिटर सीक्रेट को प्राथमिकता दें।** तब क्रेडेंशियल स्टोर होने पर एन्क्रिप्टेड रहता है और मॉनिटर पर कभी नहीं दिखता।
- **मॉनिटर कभी कुछ नहीं लिखता।** हर क्वेरी आँकड़ों के व्यू को पढ़ना है — PostgreSQL पर केवल-पढ़ने वाले ट्रांज़ैक्शन के अंदर, MySQL पर केवल-पढ़ने वाले सेशन में। जो वह पढ़ नहीं सकता, उसे गायब मेट्रिक के रूप में बताया जाता है, कभी आउटेज के रूप में नहीं।

## समस्या निवारण

:::details मॉनिटर ऑफ़लाइन है, लेकिन डेटाबेस चल रहा है
ऑफ़लाइन का मतलब है कि प्रोब जुड़ नहीं सका या प्रोब क्वेरी विफल हुई: होस्ट या पोर्ट प्रोब से पहुँच में नहीं है, लॉगिन अस्वीकार हुआ, TLS विफल हुआ, या कनेक्शन का समय खत्म हो गया। मॉनिटर का सारांश त्रुटि दिखाता है। जाँचें कि प्रोब डेटाबेस तक पहुँच सकता है (OneUptime द्वारा होस्ट किए गए प्रोब को सार्वजनिक पते की ज़रूरत होती है; वरना [कस्टम प्रोब](/docs/probe/custom-probe) का उपयोग करें), उपयोगकर्ता नाम और पासवर्ड या उसका मॉनिटर सीक्रेट जाँचें, और सेल्फ़-साइन्ड सर्टिफ़िकेट के लिए **Verify server certificate** बंद करें। फिर दोबारा जाँचने के लिए **मॉनिटर का परीक्षण करें** पर क्लिक करें।
:::

:::details PostgreSQL पर Connections, Activity और Locks गायब हैं
लॉगिन न तो `pg_monitor` या `pg_read_all_stats` का सदस्य है, न सुपरयूज़र, इसलिए प्रोब गलत आँकड़े दर्ज करने के बजाय उन ग्रुप को छोड़ देता है। [PostgreSQL](#postgresql) में बताए अनुसार `GRANT pg_monitor TO oneuptime_health;` चलाएँ।
:::

:::details MySQL पर Connections, Throughput और Locks गायब हैं
या तो लॉगिन के पास `performance_schema` पर `SELECT` नहीं है, या सर्वर पर `performance_schema` बंद है; मॉनिटर का सारांश MySQL का संदेश दिखाता है। अनुमति की कमी के लिए [MySQL](#mysql) के स्टेटमेंट चलाएँ। बंद `performance_schema` के लिए सर्वर के कॉन्फ़िगरेशन में `performance_schema = ON` और एक रीस्टार्ट चाहिए।
:::

:::details PostgreSQL पर I/O Read Time और I/O Write Time हमेशा 0 हैं
PostgreSQL इन्हें केवल तब मापता है जब `track_io_timing` चालू हो, और यह डिफ़ॉल्ट रूप से बंद होता है। असली मान देखने के लिए इसे सर्वर के कॉन्फ़िगरेशन में, या अपनी मैनेज्ड सेवा के पैरामीटर ग्रुप में चालू करें। यह अनुमति की कमी नहीं है।
:::

:::details हर जाँच पर Metric Groups Failed 0 से ऊपर है
कोई ग्रुप किसी भी जाँच पर इकट्ठा नहीं हो पा रहा, इसलिए वही संग्रह समस्या बार-बार दोहराई जाती है। मॉनिटर का सारांश ग्रुप, कारण और इसे ठीक करने वाला `GRANT` बताता है। अनुमति दें, या अगर वह नहीं मिल सकती, तो **Metric Groups** में उस ग्रुप को बंद करें ताकि समस्या दोहराना बंद हो जाए।
:::

## अगले कदम

:::cards
- [SQL क्वेरी मॉनिटर](/docs/monitor/sql-monitor): सर्वर की हेल्थ के साथ-साथ अपनी क्वेरी के नतीजे पर अलर्ट करें।
- [डेटाबेस](/docs/telemetry/databases): हर डेटाबेस के मेट्रिक्स, लॉग और कॉल करने वाले एक ही पेज पर देखें।
- [मॉनिटर रहस्य](/docs/monitor/monitor-secrets): मॉनिटरिंग उपयोगकर्ता का पासवर्ड एन्क्रिप्टेड रखें।
- [कस्टम प्रोब](/docs/probe/custom-probe): अपने नेटवर्क के अंदर के डेटाबेस तक पहुँचें।
:::
