# Kubernetes और Helm

Helm चार्ट से अपने Kubernetes क्लस्टर पर OneUptime चलाएँ। यह पेज आपका OneUptime सर्वर खुद देता है, इसलिए यह इंटरनेट से जुड़े बिना भी खुलता है और आपके चलाए संस्करण के चार्ट के बारे में बताता है। चार्ट जो भी मान लेता है, वह सब [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime) पर चार्ट के अपने दस्तावेज़ों में है।

:::cards
- [चार्ट इंस्टॉल करें](#चार्ट-इंस्टॉल-करें): एक वैल्यूज़ फ़ाइल और दो कमांड।
- [अपने डेटा का बैकअप लें](#अपने-डेटा-का-बैकअप-लें): PostgreSQL और ClickHouse, क्लस्टर के बाहर के स्टोरेज में।
- [अपनी कुंजियाँ सँभालकर रखें](#अपनी-कुंजियाँ-सँभालकर-रखें): जिनके बिना आपके बैकअप पढ़े नहीं जा सकते।
:::

## चार्ट इंस्टॉल करें

उस डोमेन नाम या IP पते के साथ एक `values.yaml` बनाएँ जिसे लोग इस्तेमाल करेंगे, `http://` के बिना:

```yaml title="values.yaml"
host: oneuptime.example.com
```

फिर चार्ट इंस्टॉल करें:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**काम कर गया जब** `kubectl get pods` हर पॉड को `Running` दिखाए और वह पता OneUptime खोले। वहाँ से आगे [स्व-होस्टिंग गाइड](/docs/installation/self-hosting-guide) बताती है: HTTPS, एडमिन खाता, और ईमेल, SMS और कॉल।

## अपने डेटा का बैकअप लें

OneUptime अपना डेटा क्लस्टर के परसिस्टेंट वॉल्यूम पर रखता है: PostgreSQL में आपके प्रोजेक्ट, मॉनिटर, घटनाएँ, स्थिति पृष्ठ और उपयोगकर्ता रहते हैं, और ClickHouse में आपके लॉग, ट्रेस और मेट्रिक्स। इनमें से किसी एक तरीके से दोनों का बैकअप क्लस्टर के बाहर के स्टोरेज में लें:

- **एंटरप्राइज़ संस्करण के शेड्यूल किए गए बैकअप।** इन्हें Admin Dashboard में **सेटिंग्स > बैकअप** के तहत सेट करें। [बैकअप](/docs/installation/backups) देखें।
- **आपके क्लाउड प्रदाता के परसिस्टेंट वॉल्यूम के बैकअप**, जैसे PostgreSQL और ClickHouse की डिस्क के शेड्यूल किए गए स्नैपशॉट।
- **CloudNativePG के वॉल्यूम स्नैपशॉट बैकअप**, जब PostgreSQL CloudNativePG ऑपरेटर पर चलता हो। इन्हें `values.yaml` में चालू करें, फिर बदलाव लागू करें:

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

ऊपर का शेड्यूल हर दिन 03:00 बजे PostgreSQL का बैकअप लेता है। CloudNativePG पुराने वॉल्यूम स्नैपशॉट नहीं हटाता, इसलिए जिनकी अब ज़रूरत नहीं, उन्हें खुद हटाएँ।

OneUptime अपने बाहर बने बैकअप नहीं देख सकता। जब आपके बैकअप चलने लगें, तो Admin Dashboard के **सर्वर सेटअप** पेज पर बैकअप वाले आइटम में **इस सर्वर का बैकअप होता है** पर क्लिक करें।

## अपनी कुंजियाँ सँभालकर रखें

OneUptime जो एन्क्रिप्ट करता है, उसे केवल उसी `encryptionSecret` से पढ़ा जा सकता है जिससे वह एन्क्रिप्ट हुआ था। `oneuptimeSecret` और `encryptionSecret` को `values.yaml` में खुद सेट करें, ताकि कोई अपग्रेड उन्हें न बदले, और उनकी एक कॉपी अपने बैकअप के साथ, क्लस्टर के बाहर रखें:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## अगले कदम

:::cards
- [स्व-होस्टिंग गाइड](/docs/installation/self-hosting-guide): खाली क्लस्टर से ऐसे सर्वर तक जो आपको पेज करे।
- [अपग्रेड करना](/docs/installation/upgrading): हर अपग्रेड से पहले बैकअप लें।
- [बैकअप](/docs/installation/backups): एंटरप्राइज़ संस्करण के शेड्यूल किए गए बैकअप।
:::
