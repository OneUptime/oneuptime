# Profiles Monitor

Profiles monitoring आपको अपने applications से continuous profiling data monitor करने और profile counts और patterns के आधार पर alerts trigger करने की अनुमति देता है। OneUptime एक time window पर आपकी telemetry services से profile data evaluate करता है।

## Overview

Profiles monitors specific criteria से match करने वाले profiling data को count और filter करते हैं। यह आपको सक्षम बनाता है:

- अपने applications से continuous profiling data monitor करें
- type (CPU, memory, goroutines, आदि) से profiles filter करें
- profile volume और patterns track करें
- profiling anomalies पर alert करें
- custom profile attributes से filter करें

## Profiles Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Profiles** चुनें
4. monitor करने के लिए telemetry services चुनें
5. आवश्यकतानुसार profile filters और criteria configure करें

## Configuration Options

### Telemetry Services

profiles monitor करने के लिए एक या अधिक services चुनें। Services को OpenTelemetry के माध्यम से OneUptime को continuous profiling data भेजना चाहिए।

### Profile Filters

| Filter        | विवरण                                                             | आवश्यक |
| ------------- | ----------------------------------------------------------------- | ------ |
| Profile Types | profile type names (जैसे CPU, memory, goroutines) से filter करें  | नहीं   |
| Attributes    | custom profile attributes पर filter के लिए Key-value pairs        | नहीं   |
| Time Window   | profiles के लिए कितना पीछे search करें (seconds में, default: 60) | नहीं   |

## Monitoring Criteria

### उपलब्ध Check Types

| Check Type    | विवरण                                                              |
| ------------- | ------------------------------------------------------------------ |
| Profile Count | time window में आपके filters से match करने वाले profiles की संख्या |

### Filter Types

- **Greater Than** — Profile count एक threshold से अधिक है
- **Less Than** — Profile count एक threshold से कम है
- **Greater Than or Equal To** — Profile count एक threshold पर या उससे ऊपर है
- **Less Than or Equal To** — Profile count एक threshold पर या उससे नीचे है
- **Equal To** — Profile count बिल्कुल match करती है
- **Not Equal To** — Profile count match नहीं करती

### उदाहरण Criteria

#### 5 minutes में कोई profiles receive नहीं होने पर Alert करें

- **Time Window**: 300 seconds
- **Check On**: Profile Count
- **Filter Type**: Equal To
- **Value**: 0

## Setup Requirements

Profiles monitoring के लिए आपके applications को OpenTelemetry के माध्यम से OneUptime को continuous profiling data भेजने की आवश्यकता है। Setup निर्देशों के लिए [OpenTelemetry](/docs/telemetry/open-telemetry) documentation देखें।
