# Metrics Monitor

Metrics monitoring आपको OpenTelemetry के माध्यम से एकत्र किए गए custom application और infrastructure metrics monitor करने की अनुमति देता है। OneUptime एक time window पर metric values evaluate करता है और आपके configured criteria के आधार पर alerts trigger करता है।

## Overview

Metrics monitors आपकी telemetry services से numeric metrics query और evaluate करते हैं। यह आपको सक्षम बनाता है:

- custom application metrics (request rates, queue depths, error rates, आदि) monitor करें
- infrastructure metrics (CPU, memory, disk, network) track करें
- filters और aggregations के साथ complex metric queries बनाएं
- mathematical formulas का उपयोग करके कई metrics combine करें
- metric thresholds के आधार पर alerts सेट करें

## Metrics Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Metrics** चुनें
4. metric queries और वैकल्पिक formulas configure करें
5. aggregation strategy चुनें
6. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Metric Queries

एक या अधिक metric queries define करें। प्रत्येक query में शामिल है:

| Field            | विवरण                                                                | आवश्यक |
| ---------------- | -------------------------------------------------------------------- | ------ |
| Metric Name      | query करने के लिए metric का नाम                                      | हाँ    |
| Aggregation Type | raw metric values को कैसे aggregate करें (sum, avg, min, max, count) | हाँ    |
| Attributes       | metric data narrow करने के लिए Key-value filters                     | नहीं   |
| Aggregate By     | metric को group करने के लिए Dimensions                               | नहीं   |

प्रत्येक query को formulas में उपयोग के लिए एक alias assign किया जाता है (जैसे `a`, `b`, `c`)।

### Formulas

mathematical expressions का उपयोग करके कई metric queries combine करें। उदाहरण के लिए:

- `a / b * 100` — दो queries से percentage calculate करें
- `a + b` — दो metrics का sum
- `a - b` — metrics के बीच अंतर

### Rolling Time Window

metric evaluation के लिए time window चुनें:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

### Aggregation Strategy

evaluation के लिए metric values को कैसे aggregate करें चुनें:

| Strategy      | विवरण                                   |
| ------------- | --------------------------------------- |
| Average       | time window पर average value            |
| Sum           | सभी values का sum                       |
| Maximum Value | time window में highest value           |
| Minimum Value | time window में lowest value            |
| All Values    | सभी values criteria से match होनी चाहिए |
| Any Value     | कम से कम एक value match होनी चाहिए      |

## Monitoring Criteria

### उपलब्ध Check Types

| Check Type   | विवरण                                                  |
| ------------ | ------------------------------------------------------ |
| Metric Value | configured metric query या formula का aggregated value |

### Filter Types

- **Greater Than** — Metric value एक threshold से अधिक है
- **Less Than** — Metric value एक threshold से कम है
- **Greater Than or Equal To** — Metric value एक threshold पर या उससे ऊपर है
- **Less Than or Equal To** — Metric value एक threshold पर या उससे नीचे है
- **Equal To** — Metric value बिल्कुल match करती है
- **Not Equal To** — Metric value match नहीं करती

### उदाहरण Criteria

#### Error rate 5% से अधिक होने पर Alert करें

- **Query a**: `http_requests_total` filtered by `status=5xx`
- **Query b**: `http_requests_total`
- **Formula**: `a / b * 100`
- **Check On**: Metric Value
- **Filter Type**: Greater Than
- **Value**: 5

#### Request queue depth अधिक होने पर Alert करें

- **Query**: `request_queue_size`, aggregation: Maximum Value
- **Check On**: Metric Value
- **Filter Type**: Greater Than
- **Value**: 1000

## Setup Requirements

Metrics monitoring के लिए आपके applications या infrastructure को OpenTelemetry के माध्यम से OneUptime को metrics भेजने की आवश्यकता है। Setup निर्देशों के लिए [OpenTelemetry](/docs/telemetry/open-telemetry) documentation देखें।
