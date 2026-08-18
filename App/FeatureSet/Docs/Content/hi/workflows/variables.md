# वेरिएबल

वर्कफ़्लो का पूरा खेल data को इधर से उधर पहुँचाने का है — trigger से पहले block तक, एक block से अगले तक, और साझा मानों से वहाँ तक जहाँ आपको उनकी ज़रूरत हो। यह data जिनके सहारे चलता है, वे वेरिएबल हैं।

वेरिएबल के दो दायरे हैं, और इनके अलावा run के दौरान बने घटक outputs।

## ग्लोबल वेरिएबल

पूरे प्रोजेक्ट के मान, जिन्हें एक बार सहेजकर आप कहीं भी दोबारा इस्तेमाल करते हैं। जैसे API keys, URLs, चैनल के नाम — वह सब जिसे आप दस अलग-अलग वर्कफ़्लो में copy नहीं करना चाहते।

ये **वर्कफ़्लो → ग्लोबल वेरिएबल** के नीचे मिलते हैं। हर एक में होता है:

- **नाम** — जिससे आप उसे बुलाएँगे। कम से कम दो अक्षर, कोई space नहीं, और सिर्फ़ अक्षर, अंक, hyphen और underscore। `UPPER_SNAKE_CASE` अच्छी आदत है, क्योंकि तब वह आपके blocks में अलग से दिख जाता है।
- **विवरण** — वैकल्पिक, खुला text, ताकि आपको याद रहे कि यह किस काम का है।
- **रहस्य** — चालू हो, तो मान run लॉग और चरणों के ब्यौरे से पोंछ दिया जाता है।
- **सामग्री** — असली मान। यह लंबा-text फ़ील्ड है, इसलिए कई पंक्तियों वाले मान भी चलते हैं।

किसी भी वर्कफ़्लो में ग्लोबल वेरिएबल इस तरह इस्तेमाल कीजिए:

```
{{global.variables.NAME}}
```

मसलन, आपने अपनी PagerDuty key `PAGERDUTY_KEY` के नाम से सहेजी हो, तो कोई भी block उसे `{{global.variables.PAGERDUTY_KEY}}` कहकर इस्तेमाल कर सकता है — editor सिर्फ़ reference सहेजता है, और workflow logging हल हुए रहस्य को पोंछ देती है।

वेरिएबल बनाए और हटाए जाते हैं, संपादित नहीं। तालिका पर संपादन का कोई बटन नहीं है, इसलिए UI में मान बदलने के लिए आप वेरिएबल हटाकर उसे फिर बनाते हैं — या API से उसे अपडेट करते हैं, जिसकी बात इस पेज के आख़िर में है। ग्लोबल और वर्कफ़्लो वेरिएबल, दोनों Growth योजना की सुविधा हैं।

## स्थानीय वर्कफ़्लो वेरिएबल

ये वेरिएबल सिर्फ़ एक वर्कफ़्लो तक सीमित रहते हैं और उस वर्कफ़्लो के बाएँ मेनू में **वर्कफ़्लो वेरिएबल** के नीचे सँभाले जाते हैं। इन्हें ऐसे बुलाइए:

```
{{local.variables.NAME}}
```

## घटक outputs (पिछले blocks से आया data)

हर trigger और हर घटक execution के दौरान output पैदा कर सकता है। reference हाथ से लिखने के बजाय editor के घटक-मान picker से बनाइए — वह ठीक वही ids डालता है जिनकी runner को उम्मीद है।

पिछले किसी block का output ऐसे बुलाइए:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` block का **Identifier** है — block पर दिखने वाला छोटा id, उस पर लिखा नाम नहीं। नए blocks को `api-get-1` जैसा कोई id मिलता है, जिसे आप block के **ID** हिस्से में बदल सकते हैं। नाम बदलते ही उस पर आती हर reference टूट जाती है, ठीक वैसे ही जैसे वेरिएबल का नाम बदलने पर होता है। `FIELD_ID` वह return-value id है जिसे आपने चुना।

उदाहरण:

- `lookup-user` ID वाला कोई **API** घटक चलने के बाद उसका status code `{{local.components.lookup-user.returnValues.response-status}}` है और उसकी body `{{local.components.lookup-user.returnValues.response-body}}`।
- `transform` ID वाला कोई **Run Custom JavaScript** घटक चलने के बाद उसका लौटाया मान `{{local.components.transform.returnValues.returnValue}}` है।
- किसी रिकॉर्ड क़िस्म के triggers — **On Create Incident** और उसके जैसे — ठीक एक मान लौटाते हैं, `model`, और आप उसी के भीतर उतरते हैं। `incident-on-create-1` ID वाले trigger के लिए घटना का शीर्षक `{{local.components.incident-on-create-1.returnValues.model.title}}` है।

स्थानीय वेरिएबल सिर्फ़ मौजूदा run के दौरान रहते हैं। हर नया run नए सिरे से शुरू होता है।

## वेरिएबल कहाँ-कहाँ चलते हैं

लगभग हर text फ़ील्ड वेरिएबल लेता है:

- किसी API block का URL।
- Slack, Teams, Discord, Telegram, ईमेल का संदेश।
- ईमेल का विषय और उसकी body।
- Headers और body के फ़ील्ड (string मानों के भीतर)।
- किसी **If / Else** block के दोनों पक्ष (यह शर्तें श्रेणी के नीचे मिलता है)।

JSON फ़ील्ड में आप वेरिएबल को किसी string मान के भीतर इस्तेमाल कर सकते हैं, पर key के रूप में नहीं। जो reference अकेले ही पूरा मान घेरती है, वह ज्यों की त्यों बैठा दी जाती है, इसलिए इस तरह आप पूरा object किसी JSON फ़ील्ड में उतार सकते हैं। कोई ढाँचा चलते-चलते बनाना हो, तो उसे **Run Custom JavaScript** block से बनाइए और उसका output अगले block को दे दीजिए।

**Run Custom JavaScript** block को वेरिएबल अपने-आप नहीं मिलते — sandbox में कुछ भी डाला नहीं जाता। `{{global.variables.NAME}}` (या कोई भी घटक reference) block के **Arguments** JSON फ़ील्ड में रखिए; वे मान script चलने से पहले बैठा दिए जाते हैं और `args` के रूप में पहुँचते हैं।

## Arrays पर चक्कर लगाना

किसी text फ़ील्ड के भीतर आप `{{#each path}}…{{/each}}` से किसी array पर चक्कर लगा सकते हैं। इस block के भीतर `{{property}}` मौजूदा तत्व से पढ़ता है, `{{@index}}` 0 से शुरू होने वाली स्थिति है, और सादे मानों की arrays के लिए `{{this}}` खुद वह तत्व है। `{{#each}}` block के भीतर नामों के आगे-पीछे की जगह छाँट दी जाती है, इसलिए वहाँ भटकी हुई spaces नुक़सान नहीं करतीं — बाकी हर जगह के उलट।

## उदाहरण

### किसी वेबहुक से payload बनाना

कोई वेबहुक `{ "service": "checkout", "status": "failed" }` जैसी body लेकर आता है। इसे OneUptime घटना में बदलने के लिए:

1. `ci-webhook` id वाला **Webhook** trigger।
2. **If / Else** block: वेबहुक का Request Body output चुनिए और उसकी `status` property लीजिए, operator `==`, दायाँ पक्ष `failed`।
3. **हाँ** शाखा से निकलकर एक **Create One Incident** block, जिसमें:
   - शीर्षक: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - विवरण: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### किसी API call में रहस्य इस्तेमाल करना

PagerDuty को बुलाने वाला वर्कफ़्लो:

1. `PAGERDUTY_KEY` को रहस्य ग्लोबल वेरिएबल के रूप में सहेजिए।
2. **API** block पर `Authorization` header को `Token token={{global.variables.PAGERDUTY_KEY}}` कर दीजिए।

key न वर्कफ़्लो में दिखती है, न लॉग में।

### दो API calls को एक कड़ी में बाँधना

पहली call आपको वह ID देती है जो दूसरी को चाहिए:

1. **API** घटक `lookup-order`: picker से manual trigger का JSON email फ़ील्ड `GET /orders?email=...` में डालिए।
2. **API** घटक `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`।

`lookup-order` नाकाम रहा, तो **सफलता** की जगह उसका **त्रुटि** output चलता है। उसे किसी Email या Slack block से जोड़ दीजिए, ताकि नाकामी अनदेखी न रह जाए।

## किसी वर्कफ़्लो से वेरिएबल अपडेट करना

एक आम तरीका यह है कि किसी credential को schedule पर बदला जाए: किसी तीसरे पक्ष से ताज़ा token लाइए, फिर उसे वेरिएबल में वापस रख दीजिए, ताकि अगला run वही उठाए। यह काम OneUptime API को बुलाने वाले किसी **API** block से कीजिए।

`ApiKey` header के साथ `PUT /api/workflow-variable/<variable-id>` भेजिए, और — यही वह हिस्सा है जहाँ लोग अटकते हैं — जो फ़ील्ड बदलनी हैं उन्हें **एक `data` object के भीतर लपेटकर** भेजिए:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

`data` की लपेट के बिना भेजी गई सपाट body 400 कहकर लौटा दी जाती है। सिर्फ़ वही फ़ील्ड भेजिए जो आप सचमुच बदलना चाहते हैं; `name` और `description` payload से बाहर रह सकते हैं।

API key को **Edit Workflow Variables** चाहिए। पढ़ने की अनुमति ज़रूरी नहीं — अपडेट उस row को वापस पढ़ता ही नहीं।

दो बातों का ध्यान रखिए:

- **जिस वेरिएबल की reference दी है, उसका नाम मत बदलिए।** `name` `{{local.variables.NAME}}` का हिस्सा है। इसे बदलते ही हर मौजूदा reference अनसुलझी रह जाती है, और अनसुलझी reference सादे text के रूप में आगे बढ़ा दी जाती है — नीचे वाली चेतावनी देखिए।
- **इस तरह वेरिएबल लिखा तो जा सकता है, पर वापस पढ़ा नहीं जा सकता।** हर वेरिएबल के लिए `content` API पर सिर्फ़-लिखने वाला है, चाहे वह रहस्य हो या न हो। इसीलिए बदलते रहने वाले token को टिकाने के लिए वेरिएबल सुरक्षित जगह है। उसे रहस्य के रूप में चिह्नित करने से मान run लॉग और चरणों के ब्यौरे से भी बाहर रहता है।

## फँसाने वाली बातें

- **Pickers इस्तेमाल कीजिए।** वे ठीक वही घटक, return-value और वेरिएबल ids डालते हैं जिनकी runner को उम्मीद है, और references को दिखने वाले लेबलों से अलग रखते हैं।
- **वेरिएबल के नामों में छोटे-बड़े अक्षर मायने रखते हैं।** `{{global.variables.MyKey}}` और `{{global.variables.mykey}}` अलग-अलग हैं।
- **जो reference हल न हो, वह ज्यों की त्यों रह जाती है, खाली नहीं होती।** किसी न मौजूद चीज़ की reference देना त्रुटि नहीं है, और इससे खाली string भी नहीं मिलती: braces सीधे आगे बढ़ा दिए जाते हैं, इसलिए ग़लत चरण id वाला `{{local.components.api-get-1.returnValues.body}}` हूबहू आपके Slack संदेश, URL या request body में जा बैठता है, और run फिर भी **Executed** बताता है। run log में एक चेतावनी पंक्ति हर उस reference का नाम लेती है जो यूँ ही निकल गई।
- **बिल्डर वेरिएबल के नाम जाँच नहीं सकता।** सहेजने से पहले वह उन घटक references पर निशान लगा देता है जिन्हें मिला नहीं पाता — अनजाना चरण id, अनजाना return value, बिगड़ा हुआ root। पर वह यह नहीं बता सकता कि कोई वेरिएबल मौजूद है या नहीं, इसलिए नाम बदला हुआ वेरिएबल सिर्फ़ run log में पकड़ा जाता है।
- **Braces के भीतर की spaces नहीं छाँटी जातीं।** `{{ local.variables.NAME }}` `{{local.variables.NAME}}` से अलग lookup है और कभी हल नहीं होता। इसका इकलौता अपवाद किसी `{{#each}}` block के भीतर है, जहाँ नाम छाँट दिए जाते हैं।

## आगे क्या पढ़ें

- [वर्कफ़्लो घटक](/docs/workflows/components) — हर block जो outputs पैदा करता है, उनकी पूरी सूची।
- [वर्कफ़्लो रन और लॉग](/docs/workflows/runs-and-logs) — किसी run के बाद हर वेरिएबल का असली मान देखिए।
- [वर्कफ़्लो कॉन्फ़िगरेशन और सुरक्षा](/docs/workflows/configuration) — किसी ग्लोबल वेरिएबल में क्या रखना सुरक्षित है।
