# Traces Monitor

Traces monitoring आपको अपने applications से distributed traces monitor करने और span patterns, counts और statuses के आधार पर alerts trigger करने की अनुमति देता है। OneUptime एक time window पर आपकी telemetry services से trace data evaluate करता है।

## Overview

Traces monitors specific filters से match करने वाले spans को search और count करते हैं। यह आपको सक्षम बनाता है:

- आपकी services में error span spikes पर alert करें
- specific operations और endpoints monitor करें
- span volume और patterns track करें
- span status, name और custom attributes से filter करें
- trace data से performance और reliability issues detect करें

## Traces Monitor बनाना

1. OneUptime Dashboard में **मॉनिटर** पर जाएं
2. **मॉनिटर बनाएं** पर क्लिक करें
3. monitor type के रूप में **ट्रेस** चुनें
4. monitor करने के लिए telemetry services चुनें
5. आवश्यकतानुसार span filters और criteria configure करें

## Configuration Options

### Telemetry Services

traces monitor करने के लिए एक या अधिक services चुनें। Services को OpenTelemetry के माध्यम से OneUptime को traces भेजनी चाहिए।

### Span Filters

| Filter        | विवरण                                                                     | आवश्यक |
| ------------- | ------------------------------------------------------------------------- | ------ |
| Span Statuses | span status code (OK, ERROR, UNSET) से filter करें                        | नहीं   |
| Span Name     | specific span names (जैसे operation या endpoint names) के लिए text search | नहीं   |
| Attributes    | custom span attributes पर filter के लिए Key-value pairs                   | नहीं   |
| Time Window   | spans के लिए कितना पीछे search करें (seconds में, default: 60)            | नहीं   |

### Span Status Codes

- **OK** — operation को application code या किसी trace pipeline द्वारा explicitly successful mark किया गया
- **ERROR** — operation में error आई
- **UNSET** — कोई error record नहीं हुई। यह OpenTelemetry का default status है

UNSET का मतलब यह नहीं है कि data missing है। OpenTelemetry instrumentation किसी operation के fail होने पर ERROR set करता है और successful spans को UNSET ही रहने देता है, इसलिए एक healthy service पर अधिकांश spans UNSET होते हैं। OneUptime उन्हें हरे रंग में "Unset (no error)" के रूप में दिखाता है। Failures पर alert करने के लिए ERROR से filter करें। हर उस span को count करने के लिए जो fail नहीं हुआ, OK और UNSET दोनों चुनें।

यदि आप चाहते हैं कि successful requests OK के रूप में दिखें, तो **ट्रेस > सेटिंग्स > पाइपलाइन** के अंतर्गत एक trace pipeline जोड़ें, जिसकी filter condition **स्थिति = अनसेट** हो और जिसमें एक **स्थिति रीमैपर** हो, जो `http.response.status_code` की `200` जैसी values को Ok पर map करे।

## Monitoring Criteria

### उपलब्ध Check Types

| Check Type | विवरण                                                           |
| ---------- | --------------------------------------------------------------- |
| Span Count | time window में आपके filters से match करने वाले spans की संख्या |

### Filter Types

- **Greater Than** — Span count एक threshold से अधिक है
- **Less Than** — Span count एक threshold से कम है
- **Greater Than or Equal To** — Span count एक threshold पर या उससे ऊपर है
- **Less Than or Equal To** — Span count एक threshold पर या उससे नीचे है
- **Equal To** — Span count बिल्कुल match करती है

### उदाहरण Criteria

#### 60 seconds में 50 से अधिक error spans पर Alert करें

- **Span Statuses**: ERROR
- **समय विंडो**: 60 seconds
- **Check On**: Span Count
- **फ़िल्टर प्रकार**: Greater Than
- **मान**: 50

#### एक specific endpoint में errors पर Alert करें

- **स्पैन नाम**: `POST /api/checkout`
- **Span Statuses**: ERROR
- **समय विंडो**: 120 seconds
- **Check On**: Span Count
- **फ़िल्टर प्रकार**: Greater Than
- **मान**: 0

## Setup Requirements

Traces monitoring के लिए आपके applications को OpenTelemetry के माध्यम से OneUptime को distributed traces भेजने की आवश्यकता है। Setup निर्देशों के लिए [OpenTelemetry](/docs/telemetry/open-telemetry) documentation देखें।
