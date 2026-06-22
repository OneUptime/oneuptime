# Manual Monitor

Manual monitoring आपको ऐसे monitors बनाने की अनुमति देता है जिनकी status पूरी तरह हाथ से या API के माध्यम से प्रबंधित होती है। OneUptime कोई automated checks नहीं करता — आप सीधे monitor status नियंत्रित करते हैं।

## Overview

Manual monitors placeholder हैं जिन्हें आप स्वयं update करते हैं। यह निम्नलिखित के लिए उपयोगी है:

- external monitoring tools के साथ integrate करना जो OneUptime API के माध्यम से status update करते हैं
- ऐसी services या systems को track करना जिन्हें automatically monitor नहीं किया जा सकता
- automated health checks के बिना components के लिए incidents प्रबंधित करना
- third-party dependencies represent करना जिनकी status आप manually track करते हैं

## Manual Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Manual** चुनें
4. monitor के लिए एक नाम और description दर्ज करें

## यह कैसे काम करता है

Manual monitors में monitoring intervals, probes, या automated criteria evaluation नहीं होते। monitor status वैसी ही रहती है जैसी आपने सेट की है जब तक आप इसे बदल न दें।

### Status Update करना

आप manual monitor की status दो तरीकों से update कर सकते हैं:

- **Dashboard** — OneUptime Dashboard से सीधे monitor status बदलें
- **API** — OneUptime API का उपयोग करके programmatically monitor status update करें

### Incidents और Alerts

आप किसी भी अन्य monitor type की तरह manual monitors के विरुद्ध incidents और alerts बना सकते हैं। यह आपको सक्षम बनाता है:

- externally monitored services के लिए downtime track करें
- issues report होने पर manually incidents बनाएं
- status page पर users को status communicate करने के लिए manual monitors उपयोग करें

## Manual Monitors कब उपयोग करें

| Use Case                 | विवरण                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Third-party services     | external services की status track करें जिन पर आप depend करते हैं लेकिन directly monitor नहीं कर सकते |
| Physical infrastructure  | network monitoring के बिना hardware या physical systems represent करें                               |
| Business processes       | service status को affect करने वाले non-technical processes track करें                                |
| API-driven status        | external tools को OneUptime API के माध्यम से monitor status update करने दें                          |
| Status page placeholders | अपने status page पर ऐसे components दिखाएं जो OneUptime के बाहर प्रबंधित हैं                          |
