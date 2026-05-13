# Exceptions Monitor

Exceptions monitoring आपको application exceptions और errors monitor करने की अनुमति देता है, जब exception counts आपके configured thresholds से अधिक हो जाते हैं तो alerts trigger होते हैं। OneUptime एक time window पर आपकी telemetry services से exception data का मूल्यांकन करता है।

## Overview

Exceptions monitors specific criteria से match करने वाले exceptions count और filter करते हैं। यह आपको सक्षम बनाता है:

- आपके applications में exception spikes पर alert करें
- specific exception types monitor करें
- error message से exceptions खोजें
- resolved और active exceptions को अलग track करें
- error patterns से application stability issues detect करें

## Exceptions Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Exceptions** चुनें
4. monitor करने के लिए telemetry services चुनें
5. आवश्यकतानुसार exception filters और criteria configure करें

## Configuration Options

### Telemetry Services

exceptions monitor करने के लिए एक या अधिक services चुनें। Services को OpenTelemetry के माध्यम से OneUptime को exception data भेजना चाहिए।

### Exception Filters

| Filter | विवरण | आवश्यक |
|--------|-------|--------|
| Exception Types | exception type names से filter करें (जैसे `NullPointerException`, `TypeError`) | नहीं |
| Message | exception messages में text search | नहीं |
| Include Resolved | resolved marked exceptions शामिल करें (default: false) | नहीं |
| Include Archived | archived exceptions शामिल करें (default: false) | नहीं |
| Time Window | exceptions के लिए कितना पीछे search करें (seconds में, default: 60) | नहीं |

## Monitoring Criteria

### उपलब्ध Check Types

| Check Type | विवरण |
|------------|-------|
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

- **Time Window**: 60 seconds
- **Check On**: Exception Count
- **Filter Type**: Greater Than
- **Value**: 10

#### किसी भी NullPointerException पर Alert करें

- **Exception Types**: `NullPointerException`
- **Time Window**: 60 seconds
- **Check On**: Exception Count
- **Filter Type**: Greater Than
- **Value**: 0

#### एक specific message वाले exceptions monitor करें

- **Message**: `out of memory`
- **Time Window**: 300 seconds
- **Check On**: Exception Count
- **Filter Type**: Greater Than
- **Value**: 0

## Setup Requirements

Exceptions monitoring के लिए आपके applications को OpenTelemetry के माध्यम से OneUptime को exception data भेजना आवश्यक है। Setup निर्देशों के लिए [OpenTelemetry](/docs/telemetry/open-telemetry) documentation देखें।
