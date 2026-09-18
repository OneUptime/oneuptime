# OneUptime.com के लिए IP Address Whitelist

यदि आप OneUptime.com का उपयोग कर रहे हैं और सुरक्षा कारणों से हमारे IPs को whitelist करना चाहते हैं, तो आप नीचे दिए गए निर्देशों का पालन करके ऐसा कर सकते हैं।

OneUptime.com को आपके resources तक पहुंचने की अनुमति देने के लिए कृपया निम्नलिखित IPs को अपने firewall में whitelist करें।

{{IP_WHITELIST}}

ये IPs बदल सकते हैं, ऐसा होने पर हम आपको पहले से सूचित करेंगे।

## IPs को Programmatically प्राप्त करें

आप निम्नलिखित API endpoint के माध्यम से probe egress IP addresses की सूची programmatically भी प्राप्त कर सकते हैं:

```
GET https://oneuptime.com/ip-whitelist
```

यह एक JSON response लौटाता है:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

आप इस endpoint का उपयोग अपनी firewall whitelist को स्वचालित रूप से अपडेट रखने के लिए कर सकते हैं।
