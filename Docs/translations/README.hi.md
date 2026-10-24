<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a>&nbsp;·
  <a href="/Docs/translations/README.zh-CN.md">简&#8288;体&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.zh-TW.md">繁&#8288;體&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.ja.md">日&#8288;本&#8288;語</a>&nbsp;·
  <a href="/Docs/translations/README.ko.md">한&#8288;국&#8288;어</a>&nbsp;·
  <a href="/Docs/translations/README.es.md">Español</a>&nbsp;·
  <a href="/Docs/translations/README.fr.md">Français</a>&nbsp;·
  <a href="/Docs/translations/README.de.md">Deutsch</a>&nbsp;·
  <a href="/Docs/translations/README.pt.md">Português</a>&nbsp;·
  <a href="/Docs/translations/README.it.md">Italiano</a>&nbsp;·
  <a href="/Docs/translations/README.ru.md">Русский</a>&nbsp;·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a>&nbsp;·
  <a href="/Docs/translations/README.fa.md">فارسی</a>&nbsp;·
  <a href="/Docs/translations/README.nl.md">Nederlands</a>&nbsp;·
  <a href="/Docs/translations/README.da.md">Dansk</a>&nbsp;·
  <a href="/Docs/translations/README.sv.md">Svenska</a>&nbsp;·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><picture><source media="(prefers-color-scheme: dark)" srcset="/packages/App/FeatureSet/Docs/Static/images/logo-dark.svg"><img alt="OneUptime" width="42%" src="/packages/App/FeatureSet/Docs/Static/images/logo-light.svg"></picture></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime एक ओपन-सोर्स ऑब्ज़र्वेबिलिटी प्लेटफ़ॉर्म है। यह जाँचता है कि आपकी वेबसाइटें, API और सर्वर काम कर रहे हैं, आपके ऐप्स जो लॉग, मेट्रिक्स और ट्रेस भेजते हैं उन्हें इकट्ठा करता है, कुछ टूटने पर जो भी ऑन-कॉल हो उसे पेज करता है, और स्थिति पृष्ठ पर आपके ग्राहकों को बताता है। यह सब एक ही उत्पाद में होता है, इसलिए जो टूल समस्या को पकड़ता है, वही आपकी टीम को पेज करता है।

इसे [OneUptime Cloud](https://oneuptime.com) पर इस्तेमाल करें, या अपने सर्वरों पर चलाएँ।

<p align="center">
  <img alt="किसी घटना के दौरान OneUptime: उसकी टाइमलाइन, कौन ऑन-कॉल है, स्थिति पृष्ठ और OneUptime AI की जाँच" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## यह क्या करता है

- **[मॉनिटरिंग](https://oneuptime.com/docs/hi/monitor/create-monitor)**: दुनिया भर के प्रोब से या अपने नेटवर्क के अंदर से वेबसाइटें, API, पोर्ट, DNS और प्रमाणपत्र जाँचें। OneUptime सर्वर, Kubernetes, Docker, VMware, डेटाबेस और नेटवर्क डिवाइस पर भी नज़र रखता है।
- **[घटनाएँ और ऑन-कॉल](https://oneuptime.com/docs/hi/incidents/index)**: हर घटना को एक ही टाइमलाइन पर संभालें। जो भी ऑन-कॉल हो उसे फ़ोन, SMS, ईमेल, पुश, Slack या Microsoft Teams से पेज करें, और किसी के जवाब देने तक एस्केलेट करें।
- **[स्थिति पृष्ठ](https://oneuptime.com/docs/hi/status-pages/index)**: सार्वजनिक या निजी स्थिति पृष्ठों पर ग्राहकों को जानकारी देते रहें, और वहीं अनुसूचित रखरखाव की घोषणा करें।
- **[लॉग, मेट्रिक्स और ट्रेस](https://oneuptime.com/docs/hi/telemetry/open-telemetry)**: इन्हें OpenTelemetry से भेजें, खोजें और डैशबोर्ड बनाएँ। एक्सेप्शन, प्रोफ़ाइल, रियल यूज़र मॉनिटरिंग और सुरक्षा इवेंट भी इसी जगह मिलते हैं।
- **[वर्कफ़्लो और रनबुक](https://oneuptime.com/docs/hi/workflows/index)**: रोज़ के काम स्वचालित करें, और Jira, ServiceNow और वे दूसरे टूल जोड़ें जिन्हें आपकी टीम पहले से इस्तेमाल करती है।
- **[OneUptime AI](https://oneuptime.com/docs/hi/ai/ai-sre)**: नई घटनाओं और अलर्ट की जाँच करता है और स्रोतों सहित मूल कारण विश्लेषण पोस्ट करता है। सुधार चालू करने पर यह सुधार के साथ एक पुल रिक्वेस्ट खोल सकता है, जिसे आपकी टीम जाँचती है।
- **[API, CLI और Terraform](https://oneuptime.com/docs/hi/api-reference/api-reference)**: अपनी स्क्रिप्ट और CI से OneUptime को स्वचालित करें, और मॉनिटर, स्थिति पृष्ठ और ऑन-कॉल को कोड के रूप में प्रबंधित करें।

बाक़ी सब कुछ [दस्तावेज़](https://oneuptime.com/docs/hi/introduction/getting-started) में है।

## शुरू करें

### OneUptime Cloud

[साइन अप करें](https://oneuptime.com/accounts/register) और एक प्रोजेक्ट बनाएँ। मुफ़्त प्लान के लिए क्रेडिट कार्ड की ज़रूरत नहीं है।

### Docker Compose से ख़ुद होस्ट करें

आपको कम से कम 8 GB मेमोरी वाला एक Linux सर्वर चाहिए, और उस पर Docker, Docker Compose, Git और Node.js।

चरण 3 से पहले `config.env` में `HOST` को उस डोमेन नाम या IP पते पर सेट करें जिससे लोग OneUptime तक पहुँचेंगे, `http://` के बिना। `localhost` सिर्फ़ तब रखें जब आप OneUptime को अपने कंप्यूटर पर आज़मा रहे हों।

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config, with a random value for every secret
cp config.example.env config.env
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done

# 3. Start everything
npm start
```

जब `npm start` **OneUptime is up!** दिखाए, तो `http://localhost` या अपने सर्वर का पता खोलें और साइन अप करें। पहला खाता इंस्टेंस का एडमिन बनता है।

[Docker Compose गाइड](https://oneuptime.com/docs/hi/installation/docker-compose) में सर्वर का आकार, HTTPS, बैकअप और अपडेट शामिल हैं।

### Helm के साथ Kubernetes

बड़े पैमाने के प्रोडक्शन या हाई अवेलेबिलिटी के लिए Helm चार्ट इंस्टॉल करें। `host` को उस डोमेन नाम या IP पते पर सेट करें जिससे लोग OneUptime तक पहुँचेंगे:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

[चार्ट के README](/HelmChart/Public/oneuptime/README.md) में स्टोरेज, HTTPS, डेटाबेस और अपग्रेड शामिल हैं।

## Community और Enterprise

- **Community Edition**: मुफ़्त और ओपन सोर्स, ऊपर की हर चीज़ के साथ, जिसमें SAML और OIDC सिंगल साइन-ऑन भी शामिल है।
- **Enterprise Edition**: SCIM प्रोविज़निंग, ऑडिट लॉग, टीम कंप्लायंस और इंस्टेंस हेल्थ डैशबोर्ड जोड़ता है, साथ में प्राथमिकता समर्थन। प्रोडक्शन में इस्तेमाल के लिए लाइसेंस चाहिए: [सेल्स से संपर्क करें](mailto:sales@oneuptime.com)।

दस्तावेज़ [दोनों संस्करणों की तुलना करते हैं](https://oneuptime.com/docs/hi/self-hosted/enterprise)।

## मदद पाएँ

- [Slack पर OneUptime समुदाय](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA) में सवाल पूछें।
- बग की रिपोर्ट और फ़ीचर के अनुरोध [GitHub issues](https://github.com/OneUptime/oneuptime/issues) में करें।
- सुरक्षा कमज़ोरी की रिपोर्ट निजी तौर पर करें, जैसा [SECURITY.md](/.github/SECURITY.md) बताता है।
- बाक़ी किसी भी बात के लिए [support@oneuptime.com](mailto:support@oneuptime.com) पर ईमेल करें।

## योगदान

बग सुधार, फ़ीचर, दस्तावेज़ और टेस्ट, सबका स्वागत है। [लोकल डेवलपमेंट गाइड](https://oneuptime.com/docs/hi/installation/local-development) बताती है कि OneUptime को सोर्स से कैसे चलाएँ, और [योगदान दिशानिर्देश](/.github/CONTRIBUTING.md) बताते हैं कि पुल रिक्वेस्ट और लाइसेंसिंग कैसे काम करते हैं। [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) लेबल वाले issues शुरुआत के लिए अच्छे हैं।

अगर OneUptime आपके काम आता है, तो इस रिपॉज़िटरी को स्टार दें या [प्रोजेक्ट को स्पॉन्सर करें](https://github.com/sponsors/OneUptime)।

## लाइसेंस

OneUptime [Apache License 2.0](/LICENSE) के तहत ओपन सोर्स है, सिवाय [`ee/`](/ee) डायरेक्टरी के। उस डायरेक्टरी में Enterprise Edition है और वह [OneUptime Enterprise License](/ee/LICENSE) के तहत लाइसेंस प्राप्त है। Community Edition इमेज में `ee/` का कोई कोड नहीं है। रिपॉज़िटरी के रूट में मौजूद [`LICENSE`](/LICENSE) फ़ाइल यह बँटवारा तय करती है।
