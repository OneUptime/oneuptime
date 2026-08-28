# Microsoft Dynamics 365 Integration

जब भी कोई OneUptime incident घोषित हो तो [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) में एक **Case** खोलें, incident के आगे बढ़ने के साथ उस case को भी साथ रखें, और Dynamics को case के बदलाव वापस OneUptime में भेजने दें — यह सब एक [वर्कफ़्लो](/docs/workflows/index) से। इंस्टॉल करने के लिए कोई Dynamics-विशिष्ट ब्लॉक नहीं है: OneUptime [API component](/docs/workflows/components#api) से **Dataverse Web API** से बात करता है, और Dynamics एक [Webhook trigger](/docs/workflows/triggers#webhook) के ज़रिए वापस बात करता है।

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

यह पेज दोनों दिशाएँ कवर करता है। पहले outbound हिस्सा बनाएँ — उसी में Microsoft Entra ID का सेटअप लगता है, और वह काम करने लगे तो inbound हिस्सा बस एक ही flow है।

## पूर्वापेक्षाएँ

- एक **Dynamics 365** environment जिसमें **Case** table हो। Cases Dynamics 365 Customer Service से आते हैं; उसके बिना किसी Dataverse environment में लिखने के लिए कोई `incident` table ही नहीं होता।
- environment का **Web API endpoint**। इसे [Power Platform admin center](https://admin.powerplatform.microsoft.com/) में अपने environment के **Settings → Developer resources** के नीचे, या **make.powerapps.com → Settings → Developer resources** में ढूँढें। यह `https://yourorg.crm.dynamics.com/api/data/v9.2/` जैसा दिखता है — region वाला हिस्सा बदलता रहता है (उत्तरी अमेरिका के लिए `crm`, दक्षिण अमेरिका के लिए `crm2`, जापान के लिए `crm7`, और इसी तरह)।
- **Microsoft Entra ID** में एक application register करने और Dynamics environment में एक **application user** बनाने के अधिकार। ये आमतौर पर दो अलग-अलग administrators होते हैं।
- एक OneUptime project जहाँ आप वर्कफ़्लो और ग्लोबल वेरिएबल बना सकें।

> नीचे सब कुछ Dataverse के table नामों का इस्तेमाल करता है, Dynamics forms पर दिखने वाले labels का नहीं। एक case यानी **`incident`** table, URL में उसका collection **`incidents`**, उसकी primary key **`incidentid`**, और उसका title column **`title`** है। UI में आपको जो case number दिखता है वह **`ticketnumber`** है।

## चरण 1 — Microsoft Entra ID में एक application register करें

OneUptime किसी व्यक्ति के रूप में नहीं, बल्कि एक application के रूप में authenticate करता है, इसलिए यह OAuth 2.0 **client credentials** flow इस्तेमाल करता है।

1. अपने Dynamics environment वाले tenant के administrator के रूप में [Azure portal](https://portal.azure.com) में sign in करें, और **Microsoft Entra ID** खोलें।
2. **App registrations → New registration** पर जाएँ। इसे `OneUptime Integration` जैसा कोई नाम दें, **Supported account types** को **Accounts in this organizational directory only** पर ही रहने दें, और **Register** चुनें।
3. app के **Overview** पेज से **Application (client) ID** और **Directory (tenant) ID** कॉपी करें।
4. **Certificates & secrets → Client secrets → New client secret** पर जाएँ। पेज छोड़ने से पहले secret का **Value** कॉपी कर लें — उसकी ID नहीं। यह दोबारा कभी नहीं दिखाया जाता। कोई client secret ज़्यादा से ज़्यादा 24 महीने जी सकता है, इसलिए expiry कहीं ऐसी जगह नोट कर लें जहाँ आपकी नज़र पड़े।

यहाँ दो चीज़ें लोग जोड़ते हैं जिनकी आपको ज़रूरत नहीं है:

- **कोई API permissions नहीं।** client credentials flow में कोई signed-in user होता ही नहीं, इसलिए delegated permissions कुछ नहीं करतीं। **Dataverse** के नीचे मौजूद `user_impersonation` एक delegated permission है और सिर्फ़ interactive apps के लिए है। Microsoft Entra ID बिना कोई permissions कॉन्फ़िगर किए भी खुशी-खुशी Dataverse के लिए token जारी कर देता है — access का फ़ैसला Dynamics की तरफ़, चरण 2 में होता है।
- **कोई admin consent चरण नहीं।** वजह वही है।

production applications के लिए Microsoft client secret की जगह certificate को प्राथमिकता देता है। उस विकल्प में caller को खुद एक JWT assertion बनाना और sign करना पड़ता है, जो कोई वर्कफ़्लो नहीं कर सकता, इसलिए यहाँ व्यावहारिक विकल्प client secret ही है — उसके साथ उसी हिसाब से बर्ताव करें: उसे एक secret variable में रखें, और expire होने से पहले बदल दें।

## चरण 2 — Dynamics में application user बनाएँ

यही वह चरण है जो छूट जाता है, और इसके छूटने से पूरे इंटीग्रेशन की सबसे भ्रमित करने वाली विफलता पैदा होती है: token request सफल हो जाती है, और उसके बाद हर Dataverse कॉल `403 Forbidden` और error code `0x80072560` के साथ विफल होती है — *"The user isn't a member of the organization."* Entra ID Dynamics के बारे में कुछ जाने बिना ही token जारी कर देता है; फिर Dynamics application से मेल खाती कोई user row ढूँढता है, और वहाँ कोई होती ही नहीं।

1. [Power Platform admin center](https://admin.powerplatform.microsoft.com/) खोलें और **Manage → Environments** चुनें, फिर अपना environment।
2. **Settings → Users + permissions → Application users** चुनें।
3. **+ New app user** चुनें, फिर **+ Add an app**, चरण 1 वाली registration चुनें, और **Add** चुनें।
4. एक **Business unit** चुनें, एक **Email address** डालें, फिर **Security roles** के बगल वाले edit आइकन का इस्तेमाल करें।
5. **Case** table पर create, read और write privileges वाली एक **custom** security role असाइन करें। किसी application user को built-in roles में से कोई नहीं दी जा सकती — Microsoft custom role ही माँगता है। यदि आपके पास उपयुक्त role नहीं है, तो किसी मौजूदा की कॉपी बनाकर उसे छाँट लें।
6. **Save** चुनें, फिर **Create**।

किसी environment में हर register की गई application के लिए सिर्फ़ एक ही application user हो सकता है। Application users licensed नहीं होते और environment के security-group membership नियमों से मुक्त रहते हैं।

## चरण 3 — credentials को OneUptime में स्टोर करें

**वर्कफ़्लो → ग्लोबल वेरिएबल → बनाएँ** पर जाएँ और ये जोड़ें, जिन पर निशान है उनके लिए **Secret** चालू करते हुए:

| नाम                      | मान                                                         | Secret |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | चरण 1 वाली Directory (tenant) ID                            | नहीं   |
| `DYNAMICS_CLIENT_ID`     | चरण 1 वाली Application (client) ID                          | नहीं   |
| `DYNAMICS_CLIENT_SECRET` | चरण 1 वाला client secret **Value**                          | हाँ    |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — अंत में कोई slash नहीं | नहीं   |

client secret को ठीक वैसे ही पेस्ट करें जैसे Entra ID ने आपको दिया था। OneUptime form body को आपके लिए encode कर देता है, इसलिए उसे हाथ से URL-encode न करें।

इनमें से किसी को भी किसी ब्लॉक से `{{global.variables.DYNAMICS_CLIENT_ID}}` के रूप में संदर्भित करें। secrets को run logs से कैसे हटाया जाता है, यह जानने के लिए [वेरिएबल](/docs/workflows/variables) देखें।

## चरण 4 — एक access token लें

हर run अपना token खुद लाता है। Tokens 60–90 मिनट चलते हैं और client credentials flow कभी refresh token जारी नहीं करता, इसलिए न कुछ cache करना है और न कुछ नवीनीकृत — प्रति run एक अतिरिक्त HTTP कॉल ही पूरी लागत है।

1. **वर्कफ़्लो → वर्कफ़्लो बनाएं** खोलें, इसे `Incidents → Dynamics 365` नाम दें, और **बिल्डर** खोलें।
2. डैश वाले placeholder पर क्लिक करें, **On Create Incident** trigger जोड़ें, और उसके **Select Fields** में वे columns माँगें जो आप भेजना चाहते हैं:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   इसका **Identifier** `incident-on-create-1` ही रहने दें।

3. **घटक जोड़ें (Add Component)** पर क्लिक करें, एक **API Post (JSON)** ब्लॉक जोड़ें, trigger के **सफलता** डॉट को उससे जोड़ें, और उसकी सेटिंग्स खोलें। इसका **Identifier** `get-token` सेट करें, फिर:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**header का नाम ठीक उसी capitalization के साथ `Content-Type` लिखें।** यही OneUptime को बताता है कि body को JSON की बजाय form post के रूप में भेजना है, और Microsoft का token endpoint सिर्फ़ यही आकार स्वीकार करता है। छोटे अक्षरों वाला `content-type` मेल नहीं खाता, request JSON के रूप में जाती है और `400` लेकर लौटती है।

`scope` आपका environment URL होना चाहिए जिसके बाद `/.default` लगा हो — यही confidential-client रूप है। यहाँ गलत environment URL ही `AADSTS70011: The provided value for the input parameter 'scope' is not valid` का आम कारण है।

अब token आगे के ब्लॉक्स को इस रूप में उपलब्ध है:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## चरण 5 — case बनाएँ

एक दूसरा **API Post (JSON)** ब्लॉक जोड़ें, `get-token` के **सफलता** डॉट को उससे जोड़ें, और उसका **Identifier** `create-case` सेट करें।

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

account GUID को उस account से बदलें जिससे ये cases संबंधित हैं। **किसी case पर `customerid` वाक़ई ज़रूरी है** — यह उन columns में से एक है जिन्हें Dataverse हर programmatic write पर लागू करता है, इसलिए उसके बिना किया गया create reject हो जाता है। चूँकि यह account या contact, दोनों में से किसी की ओर इशारा कर सकता है, आप कभी `customerid@odata.bind` नहीं लिखते; आप `customerid_account@odata.bind` या `customerid_contact@odata.bind` लिखते हैं, और ये नाम case-sensitive हैं। `title` एक अलग तरह से ज़रूरी है: Dynamics के forms इस पर अड़ते हैं, API नहीं, इसलिए इसे फिर भी भेजें।

`Prefer: return=representation` ही इसे वर्कफ़्लो से इस्तेमाल करने लायक बनाता है। उसके बिना सफल create `204 No Content` लौटाता है और नए record का URI एक `OData-EntityId` response हेडर में रख देता है, जिसमें से फिर आपको GUID निकालना पड़ता। उसके साथ, response `201 Created` होता है और record खुद साथ लाता है, इसलिए अगला ब्लॉक यह पढ़ सकता है:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

अब वर्कफ़्लो चालू करें — **अवलोकन → Edit Workflow → सक्षम** — एक test incident घोषित करें, और **रन और लॉग** के नीचे उस run को पढ़ें। `create-case` ब्लॉक को `201` और ऐसा body दिखाना चाहिए जिसमें नई `incidentid` हो। कैनवास पर किए गए बदलाव अपने-आप सहेजे जाते हैं; कोई Save बटन नहीं है।

### severity और status को map करना

Dynamics `severitycode` को सिर्फ़ एक विकल्प, "Default Value", के साथ भेजता है, इसलिए map करने के लिए कोई तैयार severity स्केल है ही नहीं। इसकी जगह **`prioritycode`** इस्तेमाल करें, और यदि आप हर severity के लिए अलग priority चाहते हैं तो `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` पर एक **If / Else** ब्लॉक से branch करें।

| Column           | मान                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` अनुकूलन-योग्य है, इसलिए हो सकता है किसी tenant ने अपने मान जोड़ लिए हों। labels नहीं, integers भेजें।

## चरण 6 — incident और case को एक-दूसरे से खोजने लायक रखें

आगे आप जो भी करें — comment करना, resolve करना, वापस sync करना — उसके लिए ज़रूरी है कि दोनों में से कोई एक सिस्टम दूसरे का identifier रखे। उसे Dynamics की तरफ़ रखें।

Case table में एक **single line of text** column जोड़ें, उदाहरण के लिए `new_oneuptimeincidentid`, और case बनाते समय उसे सेट करें:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

फिर बाद का कोई भी वर्कफ़्लो एक filter से वह case ढूँढ सकता है:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

यदि आप उस column को Case table पर एक **alternate key** के रूप में परिभाषित करते हैं, तो lookup पूरी तरह छोड़कर सीधे `incidents(new_oneuptimeincidentid='<id>')` पर `PATCH` कर सकते हैं — एक upsert जो case न होने पर उसे बनाता है और होने पर अपडेट कर देता है। इस्तेमाल से पहले key का बनना पूरा होना चाहिए (उसकी state **Active** हो जाती है), और alternate key के मानों में `/ < > * % & : \ ? + #` नहीं हो सकते। OneUptime id एक सादा UUID है, इसलिए वह सुरक्षित है।

उल्टी दिशा — Dynamics case id को OneUptime incident पर स्टोर करना — भी काम करती है, `customFields` में लिखने वाले एक **Update One Incident** ब्लॉक से। इसमें सावधानी बरतें: `customFields` एक ही JSON column है, इसलिए उसमें लिखने पर उस incident के हर custom field का मान बदल जाता है, सिर्फ़ आपका नहीं। link को Dynamics की तरफ़ रखने से यह पूरी तरह टल जाता है।

## चरण 7 — incident resolve होने पर case resolve करें

इसे एक **दूसरे** वर्कफ़्लो के रूप में बनाएँ ताकि यहाँ की कोई विफलता cases खुलने को न रोक सके।

1. **वर्कफ़्लो बनाएं**, इसे `Incident resolved → Close Dynamics case` नाम दें, और **On Update Incident** trigger जोड़ें।
2. trigger के **Listen on** में `{"currentIncidentStateId": true}` डालें ताकि वर्कफ़्लो हर edit की बजाय सिर्फ़ state बदलने पर जागे। **Select Fields** में `{"_id": true, "currentIncidentState": {"name": true}}` माँगें।
3. एक **If / Else** ब्लॉक जोड़ें। **Input 1** है `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** है `==`, **Input 2** है `Resolved` — या आपके project में resolved state का जो भी नाम हो। [घटना स्थितियाँ और गंभीरता](/docs/incidents/states-and-severities) देखें।
4. **Yes** शाखा से, चरण 4 वाला `get-token` ब्लॉक दोहराएँ।
5. एक **API Get (JSON)** ब्लॉक जोड़ें, उसका **Identifier** `find-case` सेट करें, और उसे चरण 6 वाला `$filter` URL दें। Dataverse query एक `value` array के साथ जवाब देती है, और वर्कफ़्लो reference brackets से array में index कर सकता है, इसलिए case id `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}` है।
6. एक **API Post (JSON)** ब्लॉक जोड़ें जो case बंद कर देता है:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: चरण 5 जैसे ही, बस `Prefer` के बिना।
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` Resolved state में एक `statuscode` मान है — `5` यानी *Problem Solved*।

     **इस body पर भरोसा करने से पहले इसे अपने environment पर जाँच लें।** `CloseIncident` दो parameters लेता है, `IncidentResolution` और `Status`, लेकिन Microsoft इसके लिए कोई HTTP उदाहरण प्रकाशित नहीं करता — हर आधिकारिक sample C# में है। ऊपर दिया आकार उसका पारंपरिक अनुवाद है। यदि आपका environment इसे reject करे, तो `@odata.bind` वाले रूप की बजाय एक सादे `"incidentid": "<the case id>"` property से case की पहचान कराकर देखें — Microsoft के दूसरे action उदाहरण किसी मौजूदा record को इसी तरह संदर्भित करते हैं।

**case को सीधे `statecode: 1` पर `PATCH` क्यों न करें?** कर सकते हैं — Microsoft `statecode` और `statuscode` के `PATCH` को पुराने SetState message के Web API समकक्ष के रूप में दस्तावेज़ित करता है, और किसी case को active statuses के बीच ले जाने के लिए यही सही औज़ार है। जो यह नहीं करता, वह है **Case Resolution** activity बनाना, जो Dynamics 365 Customer Service में resolve हुए case के साथ होनी चाहिए; और जिस environment में किसी administrator ने custom status transitions कॉन्फ़िगर किए हों वहाँ यह सिरे से अस्वीकार कर दिया जाएगा। resolve करने के लिए `CloseIncident` इस्तेमाल करें; बाकी हर चीज़ के लिए `PATCH`। और जब भी आप `statecode` लिखें, उसी request में `statuscode` भी सेट करें — वरना Dynamics चुपचाप उस state की डिफ़ॉल्ट status लगा देता है।

`CloseIncident` बुनियादी Dataverse से नहीं, बल्कि Dynamics 365 Customer Service से आता है, और यह Dataverse action reference में सूचीबद्ध नहीं है। यदि यह `404` लौटाए, तो `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` fetch करके और उसमें `CloseIncident` खोजकर पुष्टि करें कि यह आपके environment में मौजूद है।

case बंद करने से कम किसी भी काम के लिए — कोई note, priority बढ़ाना, title बदलना — `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` पर एक **API Patch (JSON)** ब्लॉक इस्तेमाल करें, `If-Match: *` हेडर के साथ, जो किसी अनजाने upsert को नया case बनाने से रोकता है। सिर्फ़ वही columns भेजें जिन्हें आप बदल रहे हैं।

## इनबाउंड — Dynamics 365 से OneUptime तक

अब दूसरी दिशा: कोई Dynamics में case बंद करता है, या कोई agent एक note जोड़ता है, और OneUptime को इसका पता चलना चाहिए।

### पहले receiving वर्कफ़्लो बनाएँ

1. **वर्कफ़्लो बनाएं**, इसे `Dynamics 365 → OneUptime` नाम दें, और **Webhook** trigger जोड़ें।
2. उस वर्कफ़्लो पर **सेटिंग्स** खोलें और **Webhook Secret Key** कॉपी करें। आपका URL है:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   किसी self-hosted install पर, अपना खुद का host डाल दें। इस URL को password की तरह समझें — जिसके पास यह है वह वर्कफ़्लो शुरू कर सकता है। आप उसी पेज से key रीसेट कर सकते हैं।

3. एक **If / Else** ब्लॉक जोड़ें जो बाकी कुछ भी होने से पहले एक shared secret जाँचे। **Input 1** है `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — एक मान जो आप खुद तय करते हैं और एक secret ग्लोबल वेरिएबल के रूप में सहेजते हैं।
4. **Yes** शाखा से, एक **Update One Incident** ब्लॉक जोड़ें:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: case के बदलाव का OneUptime में जो भी मतलब होना चाहिए — एक state बदलाव, एक note, एक label।

   incident को किसी state पर ले जाने के लिए आपको उस state की id चाहिए होगी: `{"name": "Resolved"}` query वाला एक **Find One Incident State** ब्लॉक आपको `{{local.components.incident-state-find-one-1.returnValues.model._id}}` देता है, जिसे `currentIncidentStateId` में लिखना है।

इसे सक्षम और तैयार रहने दें। अब Dynamics को कॉल करने के लिए कुछ दें।

### विकल्प A — एक Power Automate flow (अनुशंसित)

यही रास्ता ज़्यादातर टीमों को अपनाना चाहिए: payload आपके नियंत्रण में रहता है, और इंस्टॉल करने को कुछ नहीं है।

1. [Power Automate](https://make.powerautomate.com) में, एक **Automated cloud flow** बनाएँ।
2. Trigger: **Microsoft Dataverse → When a row is added, modified or deleted**।

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — इससे संकीर्ण कुछ भी सिर्फ़ उन्हीं rows पर चलता है जिनके मालिक आप या आपकी business unit हैं।
   - **Select columns**: `statecode,statuscode`। यह सिर्फ़ Update पर लगने वाला filter है और इसे ठीक से सेट करना ज़रूरी है। यहाँ lookup columns समर्थित नहीं हैं, और ऐसा कोई column कभी सूचीबद्ध न करें जो हर update पर मौजूद रहता हो (जैसे primary key), वरना flow हर save पर चल पड़ेगा।

3. **Microsoft Dataverse → Get a row by ID** जोड़ें, table `Cases`, row id trigger से, और **Select columns** में `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`।

   यह दूसरा कॉल अपनी लागत के लायक है। किसी update पर trigger सिर्फ़ वही columns साथ लाता है जो बदले हैं, इसलिए जिन identifiers पर आपको मिलान करना है वे शायद वहाँ हों ही नहीं।

4. बिल्ट-इन **HTTP** action जोड़ें:

   - **Method**: `POST`
   - **URI**: ऊपर दिया OneUptime webhook URL
   - **Headers**: `Content-Type: application/json` और `X-OneUptime-Secret: <the same secret>`
   - **Body**: इसे *Get a row by ID* के outputs से बनाएँ, उदाहरण के लिए

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. सहेजें और flow चालू करें।

इस रास्ते पर चलने से पहले जानने लायक:

- **Microsoft Dataverse connector premium है।** किसी automated flow के लिए licence सिर्फ़ flow के मालिक को चाहिए, हर उस व्यक्ति को नहीं जिस तक case पहुँचता है — लेकिन मालिक का licence चुपचाप खत्म हो जाए तो flow रुक जाता है।
- Dataverse triggers **push हैं, polling नहीं** — Dynamics एक callback register करता है और उसे चलाता है। delivery आम तौर पर सेकंडों में होती है; पाँच मिनट से ज़्यादा का मतलब है कि asynchronous service पर भार जमा हो गया है, जिसे आप admin center में **Settings → System Jobs** के नीचे देख सकते हैं।
- Custom headers बच जाते हैं। Power Automate HTTP actions से कई मानक header परिवार हटा देता है (ज़्यादातर `Accept-*` और `Content-*` headers, `Host`, `Origin`, `Cookie`), लेकिन `X-OneUptime-Secret` जैसा आपका अपना header आगे भेज दिया जाता है।
- flow को उसी environment में रहना चाहिए जिसमें वह table है जिस पर वह नज़र रखता है।
- Requests आपके tenant के Power Platform request आवंटन में गिनी जाती हैं, और connector throttling flow run के अंदर `429` के रूप में सामने आती है।

### विकल्प B — एक native Dataverse webhook

यदि Power Automate उपलब्ध नहीं है, तो Dataverse सीधे OneUptime को कॉल कर सकता है। endpoint को [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook) से register करें: **Register New WebHook**, उसे OneUptime URL दें, **HttpHeader** authentication चुनें, और अपने secret के साथ `X-OneUptime-Secret` जोड़ें। फिर **incident** table पर **Update** message के लिए एक step register करें, जिसमें **Filtering Attributes** सिर्फ़ उन columns तक सीमित हों जिनकी आपको परवाह है, stage **PostOperation**, execution mode **Asynchronous**।

इस रास्ते पर आँखें खोलकर चलें:

- **सिर्फ़ ports 80 और 443।** किसी और port पर चल रहे self-hosted OneUptime को register नहीं किया जा सकता।
- **Dataverse आपके secret की जाँच नहीं करता।** वह header भेज देता है; जिस request में वह न हो उसे reject करना पूरी तरह आपके वर्कफ़्लो का काम है — receiving वर्कफ़्लो वाला **If / Else** ब्लॉक इसी के लिए है।
- **payload कोई सहज JSON object नहीं है।** यह एक serialized `RemoteExecutionContext` है, जिसमें `InputParameters` `{key, value}` जोड़ों की एक *array* है और बदली हुई row `Target` key के नीचे रहती है, उसके columns एक और `Attributes` array में। मान कर चलें कि बाकी कुछ भी उसे पढ़ सके, इससे पहले उसे सपाट करने के लिए आपको एक **Run Custom JavaScript** ब्लॉक जोड़ना पड़ेगा।
- update पर **सिर्फ़ बदले हुए columns शामिल होते हैं**, इसलिए यदि आपको `ticketnumber` या अपना OneUptime id column चाहिए तो एक **Post Image** register करें।
- **256 KB से ऊपर काम के हिस्से हटा दिए जाते हैं** — `InputParameters`, `PreEntityImages` और `PostEntityImages` सब चले जाते हैं, और request में एक `x-ms-dynamics-msg-size-exceeded` हेडर आता है। `PrimaryEntityId` और `PrimaryEntityName` बचे रहते हैं, इसलिए विकल्प यही है कि row को Web API से दोबारा पढ़ लिया जाए।
- **delivery लगभग निर्मम है।** Dataverse `2xx` के लिए 60 सेकंड इंतज़ार करता है और ठीक एक बार दोबारा कोशिश करता है, वह भी सिर्फ़ `502`, `503` और `504` के लिए। बाकी कुछ भी — आपकी तरफ़ से आया `500` भी — दोबारा नहीं आज़माया जाता; वह एक विफल System Job के रूप में दर्ज हो जाता है।
- **Asynchronous** चुनें। synchronous step agent के save को आपके endpoint पर रोक देता है, और यदि बाद में transaction rollback हो जाए तो request तब तक जा चुकी होती है और उसे वापस नहीं बुलाया जा सकता।

क्लासिक Dynamics background workflows में HTTP या webhook step है ही नहीं, इसलिए वे यहाँ तीसरा विकल्प नहीं हैं।

## alerts के लिए भी वही करना

ऊपर सब कुछ incidents के इर्द-गिर्द लिखा गया है क्योंकि वही आम स्थिति है, लेकिन alerts भी बिल्कुल वैसे ही काम करते हैं — record type बदल दें, और कुछ नहीं बदलता:

| Incident                                                     | Alert                                               |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

किसी वर्कफ़्लो में ठीक एक trigger होता है, इसलिए incidents और alerts के लिए एक-एक अलग वर्कफ़्लो चाहिए। यदि दोनों को एक ही काम करना है, तो Dynamics वाला हिस्सा एक बार बनाएँ और दोनों से **Execute Workflow** कंपोनेंट के ज़रिए उसे बुलाएँ।

## समस्या निवारण

पहले **रन और लॉग** में विफल ब्लॉक पढ़ें — दोनों Microsoft endpoints व्याख्या करने वाला JSON body लौटाते हैं, और API कंपोनेंट उसे `response-body` में रखता है।

**token request `400` और `invalid_request` या किसी असमर्थित grant type के साथ विफल होती है।** `Content-Type` हेडर ठीक-ठीक `Content-Type: application/x-www-form-urlencoded` नहीं है, इसलिए body JSON के रूप में चली गई। capitalization जाँचें।

**`400` के साथ `AADSTS70011: The provided value for the input parameter 'scope' is not valid`।** `scope` आपका environment URL और `/.default` नहीं है। URL को **Developer resources** से कॉपी करें और अंत का slash तथा कोई भी `/api/data/...` path हटा दें।

**Dynamics से `401 Unauthorized`।** `Authorization` हेडर गायब है, खराब बना है, या run के बीच में token expire हो गया है। इसे एक ही space के साथ `Bearer <token>` पढ़ना चाहिए।

**`403 Forbidden`, `0x80072560` और "The user isn't a member of the organization" के साथ।** चरण 2 छूट गया था, या application user किसी दूसरी app registration से बँधा है। token ठीक है; Dynamics की तरफ़ वाला user वहाँ नहीं है।

**privilege त्रुटि के साथ `403 Forbidden`।** application user मौजूद है लेकिन उसकी custom security role में **Case** पर Create, Read या Write नहीं है।

**customer का ज़िक्र करता `400 Bad Request`।** `customerid` ज़रूरी है। `customerid_account@odata.bind` या `customerid_contact@odata.bind` को ठीक उसी वर्तनी में सेट करें, `/accounts(<guid>)` जैसे शुरुआती slash वाले URI के साथ।

**`/CloseIncident` पर `404 Not Found`।** यह action Dynamics 365 Customer Service का है। इसे उपलब्ध मान लेने से पहले अपने environment के `$metadata` में इसे खोजें।

**`DuplicateRecord` के साथ `412 Precondition Failed`।** कोई duplicate detection rule मेल खा गया। या तो rule को संकीर्ण करें, या जिस field पर वह मेल खाता है उसे भेजना बंद करें।

**`429 Too Many Requests`।** Dataverse की service protection सीमाएँ — किसी भी पाँच-मिनट की खिड़की में, प्रति web server, प्रति user मोटे तौर पर 6,000 requests और 20 मिनट का execution time। response सेकंडों में एक `Retry-After` लाता है। यदि कोई वर्कफ़्लो झोंके में चल रहा है, तो उसमें एक **Delay** ब्लॉक रखें या काम को किसी scheduled वर्कफ़्लो में ले जाएँ जो उसे बैचों में करे।

**OneUptime की तरफ़ कुछ नहीं पहुँचता।** खुद `curl` से webhook URL पर एक request भेजें और वर्कफ़्लो के **रन और लॉग** जाँचें। यदि आपकी अपनी request दिखती है और Dynamics की नहीं, तो समस्या ऊपर की तरफ़ है: Power Automate के लिए, flow का अपना run history देखें; native webhook के लिए, विफलताओं पर filter करके **Settings → System Jobs** देखें।

**वर्कफ़्लो चलता है लेकिन incident बदलता नहीं।** जब **Update One Incident** ब्लॉक की query से कुछ मेल नहीं खाता तो वह `Items Updated: 0` रिपोर्ट करता है — यह सफलता है, त्रुटि नहीं। जाँचें कि payload में दी गई id OneUptime incident id है और आप `_id` पर query कर रहे हैं।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — inbound और outbound पैटर्न, और auth चीट शीट।
- [Jira](/docs/integrations/jira) — Jira के विरुद्ध वही दो-दिशा वाला निर्माण।
- [वर्कफ़्लो अवलोकन](/docs/workflows/index) और [वर्कफ़्लो बनाना](/docs/workflows/authoring) — कैनवास, identifiers, और वर्कफ़्लो चालू करना।
- [कंपोनेंट](/docs/workflows/components) — API ब्लॉक, If / Else, और OneUptime data components।
- [वेरिएबल](/docs/workflows/variables) — सीक्रेट, और एक ब्लॉक का output अगले ब्लॉक में पढ़ना।
- [कॉन्फ़िगरेशन और सुरक्षा](/docs/workflows/configuration) — webhook सुरक्षा और आउटबाउंड network access।
- [IP पते](/docs/configuration/ip-addresses) — OneUptime की आउटबाउंड ranges, यदि Dynamics किसी allow list के पीछे है।
