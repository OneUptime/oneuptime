# CLI अवलोकन

OneUptime CLI, यानी `oneuptime`, टर्मिनल या स्क्रिप्ट से आपके OneUptime प्रोजेक्ट का प्रबंधन करता है। अपने प्रोजेक्ट की API कुंजी से मॉनिटर, घटनाएँ, अलर्ट, स्थिति पृष्ठ और OneUptime API के दिए बाकी रिकॉर्ड सूचीबद्ध करें, पढ़ें, बनाएँ, बदलें, हटाएँ और गिनें।

:::cards
- [CLI कैसे काम करता है](#cli-कैसे-काम-करता-है): एक कमांड, उसके भेजे API अनुरोध और उसका जवाब।
- [CLI इंस्टॉल करें](#cli-इंस्टॉल-करें): आपके OneUptime का दिया इंस्टॉलर, या npm।
- [अपनी पहली कमांड चलाएँ](#अपनी-पहली-कमांड-चलाएँ): अपनी API कुंजी सहेजें, उसे जाँचें, फिर अपनी घटनाएँ सूचीबद्ध करें।
- [सभी कमांड एक नज़र में](#सभी-कमांड-एक-नज़र-में): हर कमांड, और वह पेज जो उसे समझाता है।
:::

## CLI कैसे काम करता है

ज़्यादातर कमांड OneUptime REST API को एक अनुरोध भेजती हैं और जवाब प्रिंट करती हैं; `acknowledge` जैसी कोई कार्रवाई वे कुछ अनुरोध भेजती है जो डैशबोर्ड का बटन भेजता है। CLI API कुंजी और आपके OneUptime का पता फ़्लैग, एनवायरनमेंट वेरिएबल या `oneuptime login` के सहेजे कॉन्टेक्स्ट से लेता है। कोई कमांड क्या पढ़ और बदल सकती है, यह कुंजी तय करती है, ठीक वैसे ही जैसे API के लिए।

```mermaid title="एक कमांड, एक अनुरोध"
flowchart TB
    T["आपका टर्मिनल<br/>या कोई CI जॉब"] -->|"oneuptime incident list"| C["oneuptime CLI"]
    K["API कुंजी और URL:<br/>फ़्लैग, एनवायरनमेंट<br/>या सहेजा कॉन्टेक्स्ट"] --> C
    C -->|"POST /api/incident/get-list"| A["OneUptime REST API"]
    A -->|"कुंजी जिन्हें पढ़ सकती है<br/>वे रिकॉर्ड, JSON में"| C
    C -->|"टर्मिनल में टेबल,<br/>पाइप में JSON"| T
```

OneUptime API का हर संसाधन एक कमांड है, 450 से भी ज़्यादा, `incident` और `monitor` से लेकर `status-page-subscriber` और `telemetry-ingestion-key` तक, और हर कमांड के पास वे संचालन हैं जो API उसके लिए लेता है। CLI, OneUptime के साथ रिलीज़ होता है, इसलिए आपके OneUptime के संस्करण वाले CLI में आपके सर्वर के हर संसाधन की एक कमांड होती है। उन्हें सूचीबद्ध करने के लिए `oneuptime resources` चलाएँ।

## शुरू करने से पहले

- **Node.js और npm**, कोई मौजूदा LTS रिलीज़, CLI इंस्टॉल करने के लिए।
- **आपके प्रोजेक्ट की एक API कुंजी।** इसे **प्रोजेक्ट सेटिंग्स → उन्नत → API कुंजियाँ** में **API कुंजी बनाएँ** से बनाएँ: [एक API कुंजी बनाएँ](/docs/api-reference/api-reference#एक-api-कुंजी-बनाएँ) देखें।
- **OneUptime Cloud पर, Growth प्लान या उससे ऊपर।** प्रोजेक्ट की API कुंजियाँ केवल उसी पर काम करती हैं: [अपने प्लान से नीचे API कुंजियाँ और SCIM](/docs/api-reference/api-reference#अपने-प्लान-से-नीचे-api-कुंजियाँ-और-scim) देखें।

## CLI इंस्टॉल करें

हर OneUptime अपनी रिलीज़ के लिए CLI की इंस्टॉल स्क्रिप्ट देता है: नीचे की कमांड इसे `https://oneuptime.com` से डाउनलोड करती हैं, इसलिए सेल्फ़-होस्टेड OneUptime पर इसकी जगह अपना URL डालें। स्क्रिप्ट पहले `install.sh` के रूप में सहेजी जाती है, ताकि आप उसे चलाने से पहले पढ़ सकें। यह आपके OneUptime से उसका संस्करण पूछती है, और उसी संस्करण का CLI npm से इंस्टॉल करती है:

```bash
curl -fsSL https://oneuptime.com/install/cli -o install.sh
ONEUPTIME_URL=https://oneuptime.com bash install.sh
```

या npm से `@oneuptime/cli` पैकेज खुद इंस्टॉल करें। यह `oneuptime` कमांड जोड़ता है, और `--version` आपका इंस्टॉल किया संस्करण प्रिंट करता है:

```bash
npm install -g @oneuptime/cli
oneuptime --version
```

CLI, OneUptime के साथ रिलीज़ होता है और उसका संस्करण नंबर भी वही होता है। सेल्फ़-होस्टेड OneUptime पर, अपने OneUptime के संस्करण वाला CLI इंस्टॉल करें, ताकि उसकी कमांड आपके सर्वर के रिकॉर्ड से मेल खाएँ:

```bash
npm install -g @oneuptime/cli@<your-oneuptime-version>
```

> [!WARNING]
> 14.0.64 से पहले के CLI संस्करण शुरू होते ही `Cannot find module 'Common/Models/DatabaseModels/Index'` जैसी त्रुटि के साथ रुक जाते हैं। `npm install -g @oneuptime/cli@latest` से 14.0.64 या उसके बाद का संस्करण इंस्टॉल करें। 14.0.64 से पुराने सेल्फ़-होस्टेड OneUptime पर पहले [OneUptime को अपग्रेड करें](/docs/installation/upgrading#अपग्रेड-कैसे-करें), फिर उसी संस्करण का CLI इंस्टॉल करें जिस पर आपने अपग्रेड किया है।

## अपनी पहली कमांड चलाएँ

:::steps
### अपनी API कुंजी सहेजें

कुंजी और अपने OneUptime के पते से लॉग इन करें। CLI उन्हें `default` नाम के कॉन्टेक्स्ट के रूप में सहेजता है और अब से उसी का उपयोग करता है:

```bash
oneuptime login <your-api-key> https://oneuptime.com
```

यह `Logged in successfully. Context "default" is now active.` जवाब देता है। सेल्फ़-होस्टेड OneUptime पर, `https://oneuptime.com` की जगह उसका पता लिखें।

### कुंजी जाँचें

```bash
oneuptime whoami --check
```

`login` कुंजी को OneUptime से पूछे बिना सहेजता है। `--check` पूछता है: यह कुंजी का प्रोजेक्ट, आपके OneUptime का संस्करण और CLI का संस्करण दिखाता है, और दोनों अलग हों तो क्या इंस्टॉल करना है। अगर OneUptime कुंजी अस्वीकार करता है, तो [समस्या निवारण](/docs/cli/authentication#समस्या-निवारण) देखें।

### अपनी घटनाएँ सूचीबद्ध करें

```bash
oneuptime incident list
```

दस सबसे नई घटनाएँ टेबल के रूप में दिखती हैं।

### देखें कि आप और क्या प्रबंधित कर सकते हैं

```bash
oneuptime resources
```

सूची हर उस तरह का रिकॉर्ड दिखाती है जिसके साथ आप काम कर सकते हैं, और उसकी कमांड, जैसे `monitor`, `status-page` या `on-call-policy`। `oneuptime monitor fields` किसी मॉनिटर के फ़ील्ड और उन्हें सेट करने वाले फ़्लैग सूचीबद्ध करती है।
:::

## सभी कमांड एक नज़र में

| कमांड | यह क्या करती है | और पढ़ें |
| --- | --- | --- |
| `oneuptime login <api-key> <instance-url>` | API कुंजी और पते को कॉन्टेक्स्ट के रूप में सहेजती है | [प्रमाणीकरण](/docs/cli/authentication#लॉग-इन-करें) |
| `oneuptime context list`, `use`, `current`, `delete` | सहेजे कॉन्टेक्स्ट सूचीबद्ध करती है, बदलती है, दिखाती है और हटाती है | [प्रमाणीकरण](/docs/cli/authentication#कॉन्टेक्स्ट) |
| `oneuptime whoami` | वह URL और API कुंजी दिखाती है जिनका अगली कमांड उपयोग करेगी, और `--check` के साथ यह भी कि OneUptime कुंजी स्वीकार करता है या नहीं | [प्रमाणीकरण](/docs/cli/authentication#देखें-कि-cli-क्या-उपयोग-करेगा) |
| `oneuptime deploy` | चार्ट और OneUptime AI के लिए एक डिप्लॉय, या कोई दूसरा बदलाव, रिकॉर्ड करती है | [डिप्लॉय और बदलाव](/docs/telemetry/change-events) |
| `oneuptime data-checks apply` | प्रोजेक्ट की डेटा जाँचों को आपकी रिपॉज़िटरी की एक फ़ाइल से मिला देती है | [कमांड संदर्भ](/docs/cli/command-reference) |
| `oneuptime dbt upload` | किसी बिल्ड के बाद किसी dbt प्रोजेक्ट के आर्टिफ़ैक्ट डेटा अवलोकनीयता को भेजती है | [कमांड संदर्भ](/docs/cli/command-reference#oneuptime-dbt-upload) |
| `oneuptime <resource> list`, `get`, `create`, `update`, `delete`, `count` | एक तरह के रिकॉर्ड के साथ काम करती है | [संसाधन संचालन](/docs/cli/resource-operations) |
| `oneuptime <resource> fields` | किसी संसाधन के फ़ील्ड और उन्हें सेट करने वाले फ़्लैग सूचीबद्ध करती है | [संसाधन संचालन](/docs/cli/resource-operations#किसी-संसाधन-के-फ़ील्ड-देखें) |
| `oneuptime <resource> acknowledge`, `resolve`, `start`, `end`, `add-note` | घटनाओं, अलर्ट और अनुसूचित रखरखाव पर वही करती है जो डैशबोर्ड के बटन करते हैं | [संसाधन संचालन](/docs/cli/resource-operations#स्वीकार-करें-सुलझाएँ-और-नोट-जोड़ें) |
| `oneuptime resources` | रिकॉर्ड के प्रकार उनकी कमांड के साथ सूचीबद्ध करती है | [कमांड संदर्भ](/docs/cli/command-reference#oneuptime-resources) |
| `oneuptime version` | CLI का संस्करण प्रिंट करती है | [कमांड संदर्भ](/docs/cli/command-reference#oneuptime-version) |
| `oneuptime help [command]` | किसी कमांड की सहायता दिखाती है | [सहायता पाएँ](#सहायता-पाएँ) |

## ग्लोबल विकल्प

ये विकल्प हर कमांड के साथ काम करते हैं, उसके पहले या बाद में:

| विकल्प | यह क्या करता है |
| --- | --- |
| `--api-key <key>` | इस कमांड के लिए API कुंजी, सहेजी गई कुंजी की जगह |
| `--url <url>` | इस कमांड के लिए आपके OneUptime का पता |
| `--context <name>` | इस कमांड के लिए कोई सहेजा कॉन्टेक्स्ट, मौजूदा कॉन्टेक्स्ट की जगह |
| `-o, --output <format>` | `table`, `json` या `wide`: [आउटपुट प्रारूप](/docs/cli/output-formats) देखें |
| `--json` | `-o json` के समान |
| `--no-color` | बिना रंगों के प्रिंट करता है |
| `-V, --version` | CLI का संस्करण प्रिंट करता है |
| `-h, --help` | कमांड की सहायता दिखाता है |

## सहायता पाएँ

हर कमांड की अपनी सहायता है, जिसमें उसके आर्ग्युमेंट, विकल्प और डिफ़ॉल्ट होते हैं:

```bash
oneuptime --help
oneuptime help incident
oneuptime incident list --help
```

## अगले कदम

:::cards
- [प्रमाणीकरण](/docs/cli/authentication): हर एनवायरनमेंट के लिए कॉन्टेक्स्ट, और कोई कमांड कौन-सी कुंजी उपयोग करती है।
- [संसाधन संचालन](/docs/cli/resource-operations): रिकॉर्ड सूचीबद्ध करें, पढ़ें, बनाएँ, बदलें, हटाएँ और गिनें।
- [आउटपुट प्रारूप](/docs/cli/output-formats): लोगों के लिए टेबल, स्क्रिप्ट के लिए JSON।
- [स्क्रिप्टिंग और CI/CD](/docs/cli/scripting): एग्ज़िट कोड, jq और पाइपलाइन।
- [AI एजेंट के लिए CLI](/docs/cli/ai-agents): कोई एजेंट कब CLI चलाए, और कब MCP सर्वर उपयोग करे।
- [कमांड संदर्भ](/docs/cli/command-reference): हर कमांड, विकल्प और डिफ़ॉल्ट।
:::
