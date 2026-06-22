# Logs Monitor

Logs monitoring आपको अपने application logs monitor करने और log patterns, counts और severity levels के आधार पर alerts trigger करने की अनुमति देता है। OneUptime आपकी telemetry services से logs evaluate करता है और उन्हें आपके configured criteria के विरुद्ध जांचता है।

## Overview

Logs monitors एक time window पर specific filters से match करने वाले logs को search और count करते हैं। यह आपको सक्षम बनाता है:

- error log spikes पर alert करें
- specific log patterns या messages monitor करें
- severity level के अनुसार log volume track करें
- service, attributes और content से logs filter करें
- log patterns से application issues detect करें

## Logs Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Logs** चुनें
4. monitor करने के लिए telemetry services चुनें
5. आवश्यकतानुसार log filters और criteria configure करें

## Configuration Options

### Telemetry Services

logs monitor करने के लिए एक या अधिक services चुनें। Services को OpenTelemetry के माध्यम से OneUptime को logs भेजने चाहिए।

### Log Filters

| Filter          | विवरण                                                         | आवश्यक |
| --------------- | ------------------------------------------------------------- | ------ |
| Severity Levels | log severity (ERROR, WARN, INFO, DEBUG, आदि) से filter करें   | नहीं   |
| Body            | log message body में text search                              | नहीं   |
| Attributes      | custom log attributes पर filter के लिए Key-value pairs        | नहीं   |
| Time Window     | logs के लिए कितना पीछे search करें (seconds में, default: 60) | नहीं   |

### Severity Levels

एक या अधिक severity levels से logs filter करें:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Monitoring Criteria

### उपलब्ध Check Types

| Check Type | विवरण                                                          |
| ---------- | -------------------------------------------------------------- |
| Log Count  | time window में आपके filters से match करने वाले logs की संख्या |

### Filter Types

- **Greater Than** — Log count एक threshold से अधिक है
- **Less Than** — Log count एक threshold से कम है
- **Greater Than or Equal To** — Log count एक threshold पर या उससे ऊपर है
- **Less Than or Equal To** — Log count एक threshold पर या उससे नीचे है
- **Equal To** — Log count बिल्कुल match करती है
- **Not Equal To** — Log count match नहीं करती

### उदाहरण Criteria

#### 60 seconds में 100 से अधिक error logs पर Alert करें

- **Severity Levels**: ERROR
- **Time Window**: 60 seconds
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 100

#### कोई भी fatal logs दिखने पर Alert करें

- **Severity Levels**: FATAL
- **Time Window**: 60 seconds
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 0

#### एक specific error message वाले logs monitor करें

- **Body**: `database connection timeout`
- **Time Window**: 300 seconds
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 5

## Setup Requirements

Logs monitoring के लिए आपके applications को OpenTelemetry के माध्यम से OneUptime को logs भेजने की आवश्यकता है। Setup निर्देशों के लिए [OpenTelemetry](/docs/telemetry/open-telemetry) documentation देखें।
