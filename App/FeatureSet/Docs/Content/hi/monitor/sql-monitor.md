# SQL Query Monitor

SQL Query Monitor एक probe से निर्धारित schedule पर एक read-only SQL query चलाता है और result पर alert करता है — लौटाई गई rows की संख्या, एक scalar value, query में कितना समय लगा, या एक query error। यह "एक query चलाएँ और एक incident खोलें" वाले use case के लिए बनाया गया है, उदाहरण के लिए जब पिछले पाँच minutes में cancelled orders की संख्या अचानक बढ़ जाए, जब एक queue table बहुत बड़ी हो जाए, या जब कोई critical row गायब हो जाए, तब alert करने के लिए।

चूँकि query आपके network के अंदर एक probe से चलती है, इसलिए OneUptime को कभी भी आपके database से सीधे connection की आवश्यकता नहीं होती, और पूरा result set कभी probe से बाहर नहीं जाता — result का केवल एक छोटा, सीमित projection ही वापस report किया जाता है।

## समर्थित databases

SQL Query Monitor निम्नलिखित database engines का समर्थन करता है:

- **PostgreSQL** (default port `5432`)
- **MySQL** (default port `3306`)
- **Microsoft SQL Server** (default port `1433`)

MySQL-compatible और PostgreSQL-compatible engines जो समान wire protocol और SQL dialect बोलते हैं, वे आम तौर पर काम करते हैं, लेकिन केवल ऊपर दिए गए तीन engines ही आधिकारिक रूप से tested हैं।

## यह कैसे काम करता है

प्रत्येक check पर, probe आपके database से connect होता है, आपकी query को एक read-only context में चलाता है, अधिकतम एक सीमित संख्या में rows वापस पढ़ता है, और OneUptime को एक compact projection report करता है। फिर आपके monitor के criteria का मूल्यांकन उस projection के विरुद्ध किया जाता है।

probe केवल इतना report करता है:

- **Row Count** — query द्वारा लौटाई गई rows की संख्या (Max Rows सीमा से bounded)।
- **Scalar Value** — पहली row का पहला column। यह एक `SELECT COUNT(*)` शैली की query के लिए स्वाभाविक value है।
- **First Row** — पहली row को column/value pairs के एक set के रूप में, context के लिए check summary में दिखाया गया।
- **Execution Time** — query में कितना समय लगा, milliseconds में।
- **Query Error** — यदि query विफल हुई तो एक sanitized error message।

पूरा result set कभी OneUptime को नहीं भेजा जाता, इसलिए customer data OneUptime storage में replicate नहीं होता।

## Security model

एक production database के विरुद्ध customer द्वारा दी गई query चलाना संवेदनशील है, इसलिए SQL Query Monitor design के अनुसार read-only है और कई controls की परतें लगाता है:

- **न्यूनतम-विशेषाधिकार database user (प्राथमिक control)।** आपको हमेशा एक dedicated, read-only database user के साथ connect करना चाहिए जिसके पास केवल उन tables तक पहुँच हो जिनकी query को आवश्यकता है। यह सबसे महत्वपूर्ण control है — नीचे एक read-only user बनाएँ देखें।
- **Read-only execution।** PostgreSQL और MySQL पर probe एक `READ ONLY` transaction खोलता है, जो query text की परवाह किए बिना किसी भी write (writable CTEs सहित) को अस्वीकार कर देता है। Microsoft SQL Server पर, जिसमें कोई read-only transaction नहीं होता, probe एक ऐसे transaction के अंदर चलता है जिसे हमेशा roll back किया जाता है।
- **Single-statement, allow-listed queries।** query एक single statement होनी चाहिए जो `SELECT`, `WITH`, `VALUES`, या `TABLE` से शुरू होती है। Stacked statements (`SELECT 1; DROP TABLE …`) और writes/DDL को probe के connect होने से पहले ही अस्वीकार कर दिया जाता है। यह check comment- और string-literal-aware है, इसलिए किसी comment या string में छिपा हुआ keyword बच नहीं पाता।
- **Statement timeout।** प्रत्येक query की एक कठोर समय सीमा होती है। बहुत देर तक चलने वाली query रद्द कर दी जाती है।
- **Bounded rows।** केवल अधिकतम Max Rows (plus one, truncation का पता लगाने के लिए) तक ही rows वापस पढ़ी जाती हैं, जो probe की memory और payload के आकार को सीमित करता है।
- **Credential redaction।** Database errors को store करने से पहले sanitize किया जाता है — password और कोई भी connection string redact कर दी जाती है, इसलिए credentials कभी error messages में leak नहीं होते।

## पूर्वापेक्षाएँ

- आपके database host और port तक network access वाला एक **probe**। यह एक OneUptime-hosted probe हो सकता है (यदि आपका database internet से पहुँचने योग्य है) या आपके network के अंदर चलने वाला एक self-hosted probe। एक custom probe कैसे install करें, इसके लिए probe documentation देखें।
- एक **read-only database user** और connection विवरण (host, port, database name, username, password)।

## Configuration

एक नया monitor बनाएँ और monitor type के रूप में **SQL Query** चुनें, फिर connection विवरण भरें:

- **Database Type** — PostgreSQL, MySQL, या Microsoft SQL Server। एक type चुनने से default port सेट हो जाता है।
- **Host** — probe से पहुँचने योग्य database host (उदाहरण के लिए `db.internal`)।
- **Port** — database port।
- **Database Name** — जिस database के विरुद्ध query चलानी है।
- **Username** — एक read-only, न्यूनतम-विशेषाधिकार database user।
- **Password** — database password। हम दृढ़ता से अनुशंसा करते हैं कि plain text में password टाइप करने के बजाय `{{monitorSecrets.name}}` के साथ एक [Monitor Secret](/docs/monitor/monitor-secrets) का reference दें (नीचे देखें)।
- **SQL Query** — चलाने के लिए read-only query (देखें query लिखना)।
- **Use SSL/TLS** — TLS पर connect करने के लिए सक्षम करें। सक्षम होने पर, यदि database एक self-signed certificate का उपयोग करता है तो आप **Verify server certificate** को बंद कर सकते हैं।

### उन्नत विकल्प

- **Connection Timeout (ms)** — एक connection स्थापित करने के लिए कितनी देर प्रतीक्षा करनी है। Default `10000`, अधिकतम `30000`।
- **Statement Timeout (ms)** — query कितनी देर चल सकती है, इस पर कठोर सीमा। Default `15000`, अधिकतम `60000`।
- **Max Rows** — database से वापस पढ़ी जाने वाली rows की ऊपरी सीमा। Default `100`, अधिकतम `1000`।

## query लिखना

query एक **single read-only statement** होनी चाहिए। यह `SELECT`, `WITH`, `VALUES`, या `TABLE` में से किसी एक से शुरू होनी चाहिए। एक trailing semicolon की अनुमति है; कई statements की नहीं।

queries को सस्ता और अच्छी तरह से scoped रखें — ये हर check पर चलती हैं, इसलिए indexed columns और संकीर्ण time windows को प्राथमिकता दें।

```sql
-- हाल की cancellations गिनें (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- MySQL पर वही विचार
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- Microsoft SQL Server पर वही विचार
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

एक `COUNT(*)` शैली की query के लिए, गिनती **Row Count** के रूप में (जो `1` है, क्योंकि एक row लौटाई जाती है) और **Scalar Value** के रूप में (गिनती स्वयं, पहले column से) दोनों में उपलब्ध होती है। "कितने" पर alert करने के लिए, **Scalar Value** से तुलना करें।

## password के लिए Monitor Secret का उपयोग

ताकि database password कभी monitor पर plain text में store न हो, एक [Monitor Secret](/docs/monitor/monitor-secrets) बनाएँ और Password field से इसका reference दें:

1. OneUptime Dashboard → Project Settings → Monitor Secrets → Create Monitor Secret पर जाएँ।
2. एक secret बनाएँ (उदाहरण के लिए `dbPassword`) और इस monitor को इस तक पहुँच प्रदान करें।
3. monitor के Password field में `{{monitorSecrets.dbPassword}}` दर्ज करें।

OneUptime config को probe को सौंपने से पहले server-side पर secret को resolve करता है। OneUptime कभी आपके लिए ये secrets नहीं बनाता — किसी एक का reference देना आपकी पसंद है।

## criteria सेट करना

यह तय करने के लिए criteria जोड़ें कि monitor को कब online, degraded, या offline माना जाए। एक SQL Query Monitor के लिए निम्नलिखित checks उपलब्ध हैं:

- **SQL Is Online** — क्या database पहुँचने योग्य था और query सफल हुई।
- **SQL Query Row Count** — लौटाई गई rows की संख्या। greater than, less than, या equal to जैसे operators से तुलना करें।
- **SQL Query Scalar Value** — पहली row का पहला column। जब दोनों पक्ष numeric दिखते हैं तो numerically तुलना की जाती है, अन्यथा strings के रूप में। यह `COUNT(*)` शैली की queries के लिए उपयोग करने वाला check है।
- **SQL Query Execution Time (in ms)** — query में कितना समय लगा। एक धीमे database को पकड़ने के लिए उपयोगी।
- **SQL Query Error** — query error message। जब यह खाली हो (या न हो), या किसी विशिष्ट string से मेल खाए, तब alert करें।
- **JavaScript Expression** — पूर्ण नियंत्रण के लिए एक custom JavaScript expression का मूल्यांकन करें। देखें [JavaScript Expressions](/docs/monitor/javascript-expression)।

### उदाहरण: जब cancellations अचानक बढ़ें तब alert करें

ऊपर दी गई query का उपयोग करते हुए:

- **Criteria: Degraded** — `SQL Query Scalar Value` `10` से greater than है।
- **Criteria: Offline** — `SQL Query Scalar Value` `50` से greater than है, या `SQL Is Online` `false` है।

criteria से एक on-call policy attach करें ताकि सही लोगों को page किया जाए।

## एक read-only user बनाएँ

हमेशा एक dedicated read-only user के साथ connect करें। उदाहरण:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- भविष्य में बनाई गई tables को शामिल करें:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## ध्यान देने योग्य बातें

- query हर check पर चलती है, इसलिए इसे सस्ता रखें। indexes और संकीर्ण time windows का उपयोग करें, और backstop के रूप में Statement Timeout पर भरोसा करें।
- केवल row count, पहला cell (scalar), और पहली row report की जाती है — अपनी query को इस तरह design करें कि जिस value पर आप alert करना चाहते हैं वह पहला column हो।
- यदि result Max Rows से अधिक होने के कारण truncate हो जाता है, तो check summary इसे capped के रूप में flag करती है। Max Rows केवल तभी बढ़ाएँ जब आपको इसकी आवश्यकता हो; बड़े result sets probe पर अधिक memory खर्च करते हैं।
- Writes और DDL हमेशा अस्वीकार किए जाते हैं। यदि आपको किसी write path का परीक्षण करने की आवश्यकता है, तो यह monitor उसके लिए नहीं है।
- credential को rest पर encrypted रखने के लिए plain-text password की तुलना में एक Monitor Secret को प्राथमिकता दें।
