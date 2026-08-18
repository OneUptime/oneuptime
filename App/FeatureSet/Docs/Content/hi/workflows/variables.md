# Variables

Workflows का मतलब है data को move करना — trigger से पहले block तक, एक block से अगले तक, और shared values से आपको जहाँ भी उनकी ज़रूरत हो वहाँ तक। Variables इसी data को move करने का तरीका हैं।

Variable के दो scopes हैं, साथ ही एक run के दौरान produce होने वाले component outputs।

## Global variables

Project-wide values जिन्हें आप एक बार save करते हैं और कहीं भी reuse करते हैं। API keys, URLs, channel names — कोई भी ऐसी चीज़ जिसे आप दस अलग-अलग workflows में copy नहीं करना चाहते।

इन्हें **Workflows → Global Variables** के तहत खोजें। हर एक के पास होता है:

- **Name** — आप इसे कैसे reference करेंगे। कम से कम दो characters, कोई space नहीं, और सिर्फ letters, numbers, hyphens और underscores। `UPPER_SNAKE_CASE` एक अच्छी आदत है क्योंकि यह आपके blocks में अलग दिखता है।
- **Description** — optional, free text जो आपको याद दिलाए कि यह किसलिए है।
- **Secret** — on होने पर, value run logs और step traces से scrub कर दी जाती है।
- **Content** — असली value। यह एक long-text field है, इसलिए multi-line values काम करती हैं।

किसी भी workflow में global variable इस्तेमाल करें:

```
{{global.variables.NAME}}
```

उदाहरण के लिए, अगर आपने अपनी PagerDuty key `PAGERDUTY_KEY` के रूप में save की है, तो कोई भी block इसे `{{global.variables.PAGERDUTY_KEY}}` के रूप में इस्तेमाल कर सकता है — editor reference को store करता है, और workflow logging resolved secret value को scrub करती है।

Variables create और delete होते हैं, edit नहीं। table पर कोई edit button नहीं है, इसलिए UI में कोई value बदलने के लिए आप variable को delete करके फिर से create करते हैं — या इसे API के ज़रिए update करते हैं, जो इस page के अंत में cover किया गया है। Global और workflow variables एक Growth plan feature हैं।

## Local workflow variables

Variables जो सिर्फ एक workflow तक scoped हैं, उस workflow के left menu में **Workflow Variables** के तहत manage होते हैं। इन्हें reference करें:

```
{{local.variables.NAME}}
```

## Component outputs (पहले वाले blocks से data)

हर trigger और component किसी execution के दौरान output produce कर सकता है। reference को टाइप करने की बजाय editor में मौजूद component-value picker का इस्तेमाल करें — यह वही exact ids insert करता है जिनकी runner को उम्मीद है।

किसी पहले वाले block के output को इस तरह reference करें:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` block का **Identifier** है — block पर दिखाया गया छोटा id, वह नाम नहीं जो display होता है। नए blocks को `api-get-1` जैसा एक id मिलता है, और आप इसे block के **ID** section में rename कर सकते हैं। इसे rename करना उस पर मौजूद हर reference को तोड़ देता है, बिल्कुल वैसे ही जैसे किसी variable को rename करना करता है। `FIELD_ID` selected return-value id है।

उदाहरण:

- किसी **API** component, जिसका ID `lookup-user` है, के चलने के बाद, इसका status code `{{local.components.lookup-user.returnValues.response-status}}` है और इसका body `{{local.components.lookup-user.returnValues.response-body}}` है।
- किसी **Run Custom JavaScript** component, जिसका ID `transform` है, के बाद, इसकी returned value `{{local.components.transform.returnValues.returnValue}}` है।
- किसी record type के triggers — **On Create Incident** और उनके जैसे अन्य — ठीक एक value, `model`, return करते हैं, और आप उसके अंदर drill करते हैं। जिस trigger का ID `incident-on-create-1` है, उसके लिए incident का title `{{local.components.incident-on-create-1.returnValues.model.title}}` है।

Local variables सिर्फ मौजूदा run के दौरान ही exist करते हैं। हर नया run fresh शुरू होता है।

## Variables कहाँ काम करते हैं

लगभग हर text field variables accept करता है:

- किसी API block पर URL।
- Slack, Teams, Discord, Telegram, Email पर message text।
- किसी email का subject और body।
- Headers और body fields (string values के अंदर)।
- किसी **If / Else** block के दोनों sides (Conditions category के तहत listed)।

JSON fields में आप किसी string value के अंदर variable इस्तेमाल कर सकते हैं, लेकिन key के रूप में नहीं। कोई reference जो पूरी की पूरी value अकेले occupy करता है वह bare substitute हो जाता है, इसलिए आप इस तरह किसी JSON field में एक पूरा object drop कर सकते हैं। अगर आपको कोई structure dynamically बनाना है, तो इसे बनाने के लिए एक **Run Custom JavaScript** block इस्तेमाल करें, फिर इसके output को अगले block को pass करें।

**Run Custom JavaScript** block को variables अपने-आप नहीं मिलते — sandbox में कुछ भी inject नहीं होता। `{{global.variables.NAME}}` (या कोई भी component reference) को block के **Arguments** JSON field में डालें; वे values script चलने से पहले substitute हो जाती हैं और `args` के रूप में पहुँचती हैं।

## Arrays पर loop करना

किसी text field के अंदर आप `{{#each path}}…{{/each}}` से किसी array को iterate कर सकते हैं। block के अंदर, `{{property}}` current element से पढ़ता है, `{{@index}}` 0-based position है, और `{{this}}` plain values के arrays के लिए element खुद है। किसी `{{#each}}` block के अंदर names trim होते हैं, इसलिए वहाँ stray spaces harmless हैं — बाकी हर जगह के उलट।

## उदाहरण

### किसी webhook से payload बनाना

एक webhook `{ "service": "checkout", "status": "failed" }` जैसे body के साथ आता है। इसे OneUptime incident में बदलने के लिए:

1. id `ci-webhook` वाला **Webhook** trigger।
2. **If / Else** block: webhook के Request Body output की `status` property चुनें, operator `==`, right `failed`।
3. **Yes** branch से, एक **Create One Incident** block, इसके साथ:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### किसी API call में secret इस्तेमाल करना

एक workflow जो PagerDuty को call करता है:

1. `PAGERDUTY_KEY` को एक secret global variable के रूप में save करें।
2. **API** block पर, `Authorization` header को `Token token={{global.variables.PAGERDUTY_KEY}}` सेट करें।

key workflow और logs दोनों से बाहर रहती है।

### दो API calls को chain करना

पहला call आपको एक ID देता है जिसकी दूसरे को ज़रूरत है:

1. **API** component `lookup-order`: `GET /orders?email=...` में manual trigger के JSON email field को insert करने के लिए picker इस्तेमाल करें।
2. **API** component `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`।

अगर `lookup-order` fail होता है, तो इसका **Success** की बजाय **Error** output fire होता है। उसे किसी Email या Slack block से connect करें ताकि failures unnoticed न जाएँ।

## किसी workflow से variable को update करना

एक common pattern schedule पर credential rotate करना है: किसी third party से fresh token fetch करें, फिर उसे variable में वापस store करें ताकि अगला run उसे उठा ले। इसे OneUptime API को call करने वाले एक **API** block से करें।

`PUT /api/workflow-variable/<variable-id>` एक `ApiKey` header के साथ, और — यही वह हिस्सा है जहाँ लोग अटकते हैं — जो fields आप बदलना चाहते हैं वे एक `data` object में **wrap** होने चाहिए:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

`data` wrapper के बिना कोई flat body 400 के साथ reject हो जाता है। सिर्फ वे fields भेजें जो आप वाकई बदलना चाहते हैं; `name` और `description` payload से बाहर रह सकते हैं।

API key को **Edit Workflow Variables** चाहिए। कोई read permission ज़रूरी नहीं है — update row को वापस पढ़ता नहीं है।

दो बातें ध्यान रखने लायक:

- **जिस variable को आप reference करते हैं उसे rename न करें।** `name` `{{local.variables.NAME}}` का हिस्सा है। इसे बदलना हर मौजूदा reference को unresolved छोड़ देता है, और कोई unresolved reference literal text के रूप में pass through होता है — नीचे gotcha देखें।
- **कोई variable इस तरीके से लिखा तो जा सकता है लेकिन कभी वापस पढ़ा नहीं जा सकता।** `content` हर variable के लिए API पर write-only है, चाहे वह secret हो या नहीं। यही चीज़ किसी variable को किसी rotating token को रखने के लिए एक safe जगह बनाती है। इसे secret मार्क करना इसके ऊपर value को run logs और step traces से भी बाहर रखता है।

## Gotchas

- **Pickers इस्तेमाल करें।** ये वही exact component, return-value, और variable ids insert करते हैं जिनकी runner को उम्मीद है, और references को display labels से independent रखते हैं।
- **Variable names case-sensitive हैं।** `{{global.variables.MyKey}}` और `{{global.variables.mykey}}` अलग हैं।
- **कोई reference जो resolve नहीं होता उसे as-is छोड़ दिया जाता है, blank नहीं किया जाता।** किसी ऐसी चीज़ को refer करना जो exist नहीं करती कोई error नहीं है, और यह आपको empty string भी नहीं देता: braces वैसे ही pass through हो जाते हैं, इसलिए `{{local.components.api-get-1.returnValues.body}}` किसी mistyped step id के साथ आपके Slack message, URL या request body में verbatim पहुँच जाता है, और run फिर भी **Executed** report करता है। run log में एक warning line होती है जो किसी भी छूटे हुए reference का नाम बताती है।
- **Builder variable names check नहीं कर सकता।** यह उन component references को flag करता है जिन्हें यह match नहीं कर पाता — कोई unknown step id, कोई unknown return value, कोई malformed root — save करने से पहले। यह नहीं बता सकता कि कोई variable exist करता है या नहीं, इसलिए किसी rename हुए variable को सिर्फ run log ही पकड़ता है।
- **Braces के अंदर spaces trim नहीं होते।** `{{ local.variables.NAME }}` `{{local.variables.NAME}}` से अलग lookup है और कभी resolve नहीं होता। इसका इकलौता अपवाद किसी `{{#each}}` block के अंदर है, जहाँ names trim होते हैं।

## आगे क्या पढ़ें

- [Components](/docs/workflows/components) — हर block produce करने वाले outputs की पूरी list।
- [Runs & Logs](/docs/workflows/runs-and-logs) — किसी run के बाद हर variable की असली value देखें।
- [Configuration & Safety](/docs/workflows/configuration) — किसी global variable में क्या डालना safe है।
