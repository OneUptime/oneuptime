# Exceptions Monitor

Exceptions monitoring आपको application exceptions और errors monitor करने की अनुमति देता है, जब exception counts आपके configured thresholds से अधिक हो जाते हैं तो alerts trigger होते हैं। OneUptime एक time window पर आपकी telemetry services से exception data का मूल्यांकन करता है।

## Overview

Exceptions monitors specific criteria से match करने वाले exceptions count और filter करते हैं। यह आपको सक्षम बनाता है:

- आपके applications में exception spikes पर alert करें
- specific exception types monitor करें
- alerts को `production` जैसे किसी deployment environment तक सीमित करें
- error message से exceptions खोजें
- resolved और active exceptions को अलग track करें
- error patterns से application stability issues detect करें

## Exceptions Monitor बनाना

1. OneUptime Dashboard में **मॉनिटर** पर जाएं
2. **मॉनिटर बनाएं** पर क्लिक करें
3. monitor type के रूप में **अपवाद** चुनें
4. monitor करने के लिए telemetry services चुनें
5. आवश्यकतानुसार exception filters और criteria configure करें

## Configuration Options

### Telemetry Services

exceptions monitor करने के लिए एक या अधिक services चुनें। Services को OpenTelemetry के माध्यम से OneUptime को exception data भेजना चाहिए।

### Exception Filters

| Filter           | विवरण                                                                          | आवश्यक |
| ---------------- | ------------------------------------------------------------------------------ | ------ |
| Exception Types  | exception type names से filter करें (जैसे `NullPointerException`, `TypeError`) | नहीं   |
| Environments     | deployment environment से filter करें (जैसे `production`, `staging`)           | नहीं   |
| Message          | exception messages में text search                                             | नहीं   |
| Include Resolved | resolved marked exceptions शामिल करें (default: false)                         | नहीं   |
| Include Archived | archived exceptions शामिल करें (default: false)                                | नहीं   |
| Time Window      | exceptions के लिए कितना पीछे search करें (seconds में, default: 60)            | नहीं   |

### Environments

Environments हर exception पर मौजूद `deployment.environment` OpenTelemetry resource attribute से आते हैं, यह वही value है जिससे Exceptions explorer `env:production` के साथ filter करता है। एक environment दर्ज करें, या commas से अलग किए गए कई environments; कोई exception तब count होता है जब उसका environment इनमें से किसी से भी match करता है।

Matching exact और case-sensitive है: `production`, `Production` या `prod` से match नहीं करता। जब यह filter set होता है, तो बिना environment वाले exceptions count नहीं होते। हर environment के exceptions count करने के लिए, जिनमें बिना environment वाले exceptions भी शामिल हैं, इसे खाली छोड़ दें।

Environment filter बाकी सभी filters के साथ combine होता है, इसलिए एक telemetry service और `production` तक सीमित monitor केवल उस service के production exceptions count करता है।

API के माध्यम से monitor बनाते समय, step के `exceptionMonitor` पर `environments` को environment names की list पर set करें:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Monitoring Criteria

### उपलब्ध Check Types

| Check Type      | विवरण                                                                |
| --------------- | -------------------------------------------------------------------- |
| Exception Count | time window में आपके filters से match करने वाले exceptions की संख्या |

### Filter Types

- **Greater Than** — Exception count एक threshold से अधिक है
- **Less Than** — Exception count एक threshold से कम है
- **Greater Than or Equal To** — Exception count एक threshold पर या उससे ऊपर है
- **Less Than or Equal To** — Exception count एक threshold पर या उससे नीचे है
- **Equal To** — Exception count बिल्कुल match करती है
- **Not Equal To** — Exception count match नहीं करती

### उदाहरण Criteria

#### 60 seconds में 10 से अधिक exceptions पर Alert करें

- **समय विंडो**: 60 seconds
- **Check On**: Exception Count
- **फ़िल्टर प्रकार**: Greater Than
- **मान**: 10

#### किसी भी NullPointerException पर Alert करें

- **अपवाद प्रकार**: `NullPointerException`
- **समय विंडो**: 60 seconds
- **Check On**: Exception Count
- **फ़िल्टर प्रकार**: Greater Than
- **मान**: 0

#### केवल production exceptions पर Alert करें

- **परिवेश**: `production`
- **समय विंडो**: 300 seconds
- **Check On**: Exception Count
- **फ़िल्टर प्रकार**: Greater Than
- **मान**: 5

#### एक specific message वाले exceptions monitor करें

- **संदेश**: `out of memory`
- **समय विंडो**: 300 seconds
- **Check On**: Exception Count
- **फ़िल्टर प्रकार**: Greater Than
- **मान**: 0

## Setup Requirements

Exceptions monitoring के लिए आपके applications को OpenTelemetry के माध्यम से OneUptime को exception data भेजना आवश्यक है। Setup निर्देशों के लिए [OpenTelemetry](/docs/telemetry/open-telemetry) documentation देखें।
