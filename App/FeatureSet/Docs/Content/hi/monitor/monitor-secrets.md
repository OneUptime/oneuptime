# Monitor Secrets

आप sensitive information जो आप अपने monitoring checks में उपयोग करना चाहते हैं उसे store करने के लिए secrets उपयोग कर सकते हैं। Secrets encrypted और सुरक्षित रूप से stored होते हैं। 

### एक secret जोड़ना

secret जोड़ने के लिए, कृपया OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret पर जाएं।

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

आप चुन सकते हैं कि कौन से monitors को secret तक पहुंच हो। इस मामले में हमने `ApiKey` secret जोड़ा और monitors को उस तक पहुंच देने के लिए चुना।

**कृपया ध्यान दें**: Secrets encrypted और सुरक्षित रूप से stored होते हैं। यदि आप secret खो देते हैं, तो आपको एक नया secret बनाना होगा। Save होने के बाद आप secret देख या update नहीं कर सकते। 

### एक secret का उपयोग

आप निम्नलिखित monitoring types में secrets उपयोग कर सकते हैं:

- API (request headers, request body और URL में)
- Website, IP, Port, Ping, SSL Certificate (URL में)
- Synthetic Monitor, Custom Code Monitor (code में)
- SNMP Monitor (community string, SNMPv3 auth key और priv key में)


![Using Secret](/docs/static/images/UsingMonitorSecret.png)

secret उपयोग करने के लिए, उस field में `{{monitorSecrets.SECRET_NAME}}` जोड़ें जहाँ आप secret उपयोग करना चाहते हैं। उदाहरण के लिए, इस मामले में हमने Request Header field में `{{monitorSecrets.ApiKey}}` जोड़ा।

Synthetic या Custom Code monitor scripts execute होने से पहले probe पर Secrets inject किए जाते हैं, इसलिए `{{monitorSecrets.ApiKey}}` जैसे references चलने वाले script के अंदर decrypted value में resolve होते हैं।


### Monitor Secret Permissions

आप चुन सकते हैं कि कौन से monitors को secret तक पहुंच हो। आप किसी भी समय permissions update भी कर सकते हैं। इसलिए, यदि आप एक नए monitor को secret तक पहुंच देना चाहते हैं, तो आप permissions update करके ऐसा कर सकते हैं।


