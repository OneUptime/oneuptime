# SMTP

OneUptime का मेल अपने खुद के मेल सर्वर से भेजें। कोई प्रोजेक्ट SMTP कॉन्फ़िगरेशन जोड़ता है, जिसे उसके स्थिति पृष्ठ मेल भेजते समय इस्तेमाल करते हैं, और स्व-होस्टेड इंस्टॉलेशन वह सर्वर सेट करता है जिससे OneUptime बाकी सारा मेल भेजता है। दोनों साइन इन करने के तीन तरीकों का समर्थन करते हैं:

- **उपयोगकर्ता नाम और पासवर्ड**: पारंपरिक SMTP प्रमाणीकरण।
- **OAuth 2.0**: Microsoft 365 और Google Workspace के लिए, जहाँ बेसिक प्रमाणीकरण अक्सर बंद रहता है।
- **कोई नहीं**: उन रिले सर्वरों के लिए जिन्हें प्रमाणीकरण की ज़रूरत नहीं होती।

```mermaid title="कौन सा मेल सर्वर क्या भेजता है"
flowchart TB
    SP["स्थिति पृष्ठ का मेल"] --> Q{"पेज ने कस्टम SMTP<br/>कॉन्फ़िगरेशन चुना है?"}
    Q -->|"हाँ"| P["प्रोजेक्ट का SMTP कॉन्फ़िगरेशन"]
    Q -->|"नहीं"| D["OneUptime का अपना मेल सर्वर"]
    E["OneUptime का बाकी सारा मेल"] --> D
```

स्व-होस्टेड इंस्टॉलेशन पर, OneUptime का अपना मेल सर्वर वह सर्वर है जिसे आप Admin Dashboard में सेट करते हैं। स्थिति पृष्ठ अपने **सब्सक्राइबर सेटिंग्स** पेज के **कस्टम SMTP** कार्ड में SMTP कॉन्फ़िगरेशन चुनता है।

:::cards
- [मेल सर्वर जोड़ें](#smtp-सर्वर-जोड़ना): दो चरण, बाकी सब फ़ोल्ड किया हुआ।
- [Microsoft 365](#microsoft-365-कॉन्फ़िगरेशन): Entra ऐप रजिस्ट्रेशन के साथ OAuth।
- [Google Workspace](#google-workspace-कॉन्फ़िगरेशन): सर्विस अकाउंट के साथ OAuth।
- [समस्या निवारण](#समस्या-निवारण): आम त्रुटियाँ और उनका मतलब।
:::

## SMTP सर्वर जोड़ना

प्रोजेक्ट का मेल सर्वर **प्रोजेक्ट सेटिंग्स > सूचनाएं > सूचना सेटिंग्स** पर **कस्टम SMTP कॉन्फ़िग्स** कार्ड में जोड़ा जाता है। स्व-होस्टेड इंस्टॉलेशन पर, जिस सर्वर से OneUptime खुद मेल भेजता है, वह **Admin Dashboard > सेटिंग्स > सूचनाएँ > ईमेल** पर **कस्टम ईमेल और SMTP सेटिंग्स** कार्ड में सेट किया जाता है। दोनों फ़ॉर्म दो चरणों में एक ही चीज़ें पूछते हैं।

:::steps
### फ़ॉर्म खोलें

:::tabs
@tab प्रोजेक्ट
**प्रोजेक्ट सेटिंग्स > सूचनाएं > सूचना सेटिंग्स** पर **कस्टम SMTP कॉन्फ़िग्स** कार्ड में **SMTP कॉन्फ़िगरेशन बनाएँ** क्लिक करें।
@tab स्व-होस्टेड इंस्टेंस
Admin Dashboard में **सेटिंग्स** खोलें, फिर साइड मेनू में **सूचनाएँ > ईमेल** (**सूचनाएँ** शुरू में फ़ोल्ड रहता है)। **ईमेल सर्वर सेटिंग्स** कार्ड में **सर्वर संपादित करें** क्लिक करें और **ईमेल सर्वर प्रकार** को `Custom SMTP` पर सेट करें। फिर उसके नीचे दिखने वाले **कस्टम ईमेल और SMTP सेटिंग्स** कार्ड में **SMTP कॉन्फ़िगरेशन संपादित करें** क्लिक करें।
:::

### सर्वर चरण भरें

**सर्वर** चरण पर **नाम** (केवल प्रोजेक्ट कॉन्फ़िगरेशन), **होस्टनाम**, **पोर्ट** (नए प्रोजेक्ट कॉन्फ़िगरेशन `587` से शुरू होते हैं), **उपयोगकर्ता नाम** और **पासवर्ड** डालें।

### और फ़ील्ड जाँचें

बाकी सब कुछ **सर्वर** चरण के अंत में **और फ़ील्ड** के नीचे फ़ोल्ड रहता है। फ़ोल्ड रहते हुए इसका शीर्षक बताता है कि मेल कैसे भेजा जाता है, उदाहरण के लिए: "मेल SMTP से भेजा जाता है, उपयोगकर्ता नाम और पासवर्ड से साइन इन करके। TLS आवश्यक है।" इसे तभी खोलें जब आपको नीचे दी गई तालिका की कोई सेटिंग बदलनी हो।

### प्रेषक चरण भरें

**प्रेषक** चरण पर वह **प्रेषक ईमेल** और **प्रेषक नाम** डालें जिनसे आपका मेल आता है। आपके सर्वर को उस पते से भेजने की अनुमति देनी चाहिए।

### सहेजें और परीक्षण ईमेल भेजें

कॉन्फ़िगरेशन सहेजें। प्रोजेक्ट कॉन्फ़िगरेशन सहेजने के बाद, उसकी पंक्ति पर **परीक्षण ईमेल भेजें** से जाँचें कि वह काम करता है। इसके लिए SMTP कॉन्फ़िगरेशन जोड़ने की अनुमति चाहिए: **Project Owner**, **Project Admin**, या किसी कस्टम भूमिका में **Create SMTP Config** और **Read SMTP Config**। OneUptime Cloud पर इसके लिए, कॉन्फ़िगरेशन जोड़ने की तरह, **Growth** प्लान भी चाहिए। बाकी सभी के लिए बटन लॉक रहता है, और उसका टूलटिप बताता है कि क्या चाहिए।

परीक्षण पूछता है कि किस **ईमेल** पते पर भेजना है, जो शुरू में आपका अपना पता होता है। देखें कि संदेश पहुँचता है या नहीं।
:::

**और फ़ील्ड** के नीचे की सेटिंग्स ये हैं:

| फ़ील्ड | यह क्या करता है |
| --- | --- |
| **ट्रांसपोर्ट** | `SMTP` (डिफ़ॉल्ट), या उन Microsoft 365 टेनेंट के लिए `Microsoft Graph` जिनमें SMTP AUTH बंद है। Microsoft Graph चुनने पर होस्टनाम, पोर्ट, उपयोगकर्ता नाम और पासवर्ड छिप जाते हैं और OAuth फ़ील्ड दिखते हैं। |
| **TLS आवश्यक करें** | नए प्रोजेक्ट कॉन्फ़िगरेशन पर चालू। मेल केवल मान्य प्रमाणपत्र वाले एन्क्रिप्टेड कनेक्शन पर भेजा जाता है। इसे बंद करने पर, मेल केवल तभी एन्क्रिप्ट होता है जब सर्वर इसकी पेशकश करे, और प्रमाणपत्र की जाँच नहीं होती। पोर्ट 465 हमेशा एन्क्रिप्टेड होता है। |
| **प्रमाणीकरण प्रकार** | `Username and Password` (डिफ़ॉल्ट), `OAuth`, या साइन इन के बिना रिले के लिए `None`। |
| **OAuth फ़ील्ड** | **OAuth प्रदाता प्रकार**, **OAuth क्लाइंट ID**, **OAuth क्लाइंट सीक्रेट**, **OAuth Token URL** और **OAuth स्कोप**, जो OAuth या Microsoft Graph चुनने पर दिखते हैं। |
| **विवरण** | आपकी टीम के लिए एक नोट (केवल प्रोजेक्ट कॉन्फ़िगरेशन)। |

**Microsoft Graph.** **और फ़ील्ड** खोलें, **ट्रांसपोर्ट** को `Microsoft Graph` पर सेट करें, और **Mail.Send** एप्लिकेशन अनुमति वाले Azure ऐप की जानकारी भरें: उसका क्लाइंट ID और क्लाइंट सीक्रेट, टोकन URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` और स्कोप `https://graph.microsoft.com/.default`। मेल **प्रेषक ईमेल** मेलबॉक्स से भेजा जाता है, जो आपके टेनेंट में लाइसेंस वाला मेलबॉक्स होना चाहिए।

> [!NOTE]
> OneUptime Cloud पर, प्रोजेक्ट का मेल सर्वर इंटरनेट से पहुँचने योग्य होना चाहिए: निजी या आंतरिक पते पर रिज़ॉल्व होने वाला होस्ट अस्वीकार किया जाता है। स्व-होस्टेड इंस्टॉलेशन पर निजी पते तब तक अनुमत हैं जब तक `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` का मान `true` न हो, लेकिन लूपबैक और लिंक-लोकल पते हमेशा अस्वीकार किए जाते हैं। इंस्टेंस के अपने मेल सर्वर की इस तरह जाँच नहीं होती।

## OAuth 2.0 प्रमाणीकरण

OAuth 2.0 से OneUptime बिना पासवर्ड के आपके मेल सर्वर में साइन इन करता है, और एंटरप्राइज़ मेल सेवाएँ इसे तेज़ी से अनिवार्य कर रही हैं। OneUptime दो OAuth ग्रांट प्रकारों का समर्थन करता है:

- **Client Credentials**: Microsoft 365 और ज़्यादातर OAuth प्रदाता इसका इस्तेमाल करते हैं।
- **JWT Bearer**: Google Workspace सर्विस अकाउंट इसका इस्तेमाल करते हैं।

```mermaid title="OneUptime OAuth से कैसे साइन इन करता है"
sequenceDiagram
    participant O as OneUptime
    participant T as टोकन URL
    participant M as मेल सर्वर
    O->>T: एक्सेस टोकन का अनुरोध
    T-->>O: एक्सेस टोकन
    Note over O: कैश किया जाता है और<br/>समय समाप्त होने से पहले रीफ़्रेश
    O->>M: टोकन से साइन इन
    O->>M: ईमेल भेजें
```

**प्रमाणीकरण प्रकार** और OAuth फ़ील्ड फ़ॉर्म के सर्वर चरण पर **और फ़ील्ड** के नीचे हैं। OAuth से साइन इन करने के लिए ये भरें:

| फ़ील्ड | विवरण |
| --- | --- |
| **होस्टनाम** | SMTP सर्वर का पता |
| **पोर्ट** | SMTP पोर्ट (आम तौर पर STARTTLS के लिए 587, इम्प्लिसिट TLS के लिए 465) |
| **उपयोगकर्ता नाम** | भेजने वाले मेलबॉक्स का ईमेल पता |
| **प्रमाणीकरण प्रकार** | `OAuth` |
| **OAuth प्रदाता प्रकार** | Microsoft 365 के लिए `Client Credentials`, Google Workspace के लिए `JWT Bearer` |
| **OAuth क्लाइंट ID** | आपके OAuth प्रदाता का एप्लिकेशन (क्लाइंट) ID (Google के लिए सर्विस अकाउंट ईमेल) |
| **OAuth क्लाइंट सीक्रेट** | आपके OAuth प्रदाता का क्लाइंट सीक्रेट (Google के लिए प्राइवेट की) |
| **OAuth Token URL** | प्रदाता का OAuth टोकन एंडपॉइंट |
| **OAuth स्कोप** | वह OAuth स्कोप जो SMTP एक्सेस देता है |

OneUptime OAuth टोकन कैश करता है और उनका समय समाप्त होने से पहले उन्हें अपने आप रीफ़्रेश करता है।

## Microsoft 365 कॉन्फ़िगरेशन

Microsoft 365 (Exchange Online) के साथ OAuth इस्तेमाल करने के लिए, Microsoft Entra में एक एप्लिकेशन रजिस्टर करें, उसे SMTP से मेल भेजने की अनुमति दें, और उसे भेजने वाले मेलबॉक्स का इस्तेमाल करने दें।

:::steps
### Microsoft Entra में एप्लिकेशन रजिस्टर करें

1. [Microsoft Entra एडमिन सेंटर](https://entra.microsoft.com) में साइन इन करें।
2. **Identity** > **Applications** > **App registrations** पर जाएँ और **New registration** क्लिक करें।
3. एक नाम डालें (उदाहरण के लिए "OneUptime SMTP"), "Accounts in this organizational directory only" चुनें, और **Redirect URI** खाली छोड़ दें।
4. **Register** क्लिक करें।

**Overview** पेज पर **Application (client) ID** (आपका क्लाइंट ID) और **Directory (tenant) ID** (टोकन URL के लिए) नोट करें।

### क्लाइंट सीक्रेट बनाएँ

1. ऐप रजिस्ट्रेशन में **Certificates & secrets** पर जाएँ और **New client secret** क्लिक करें।
2. एक विवरण जोड़ें, समाप्ति अवधि चुनें और **Add** क्लिक करें।
3. **सीक्रेट मान तुरंत कॉपी करें**: यह दोबारा नहीं दिखाया जाएगा।

### SMTP अनुमति जोड़ें

1. **API permissions** पर जाएँ और **Add a permission** क्लिक करें।
2. **APIs my organization uses** चुनें, फिर **Office 365 Exchange Online** खोजें और चुनें।
3. **Application permissions** चुनें, **SMTP.SendAsApp** पर टिक करें और **Add permissions** क्लिक करें।
4. **Grant admin consent for [your organization]** क्लिक करें (एडमिन अधिकार चाहिए)।

### Exchange Online में सर्विस प्रिंसिपल रजिस्टर करें

एप्लिकेशन मेल भेज सके, इससे पहले Exchange Online में उसका सर्विस प्रिंसिपल रजिस्टर करें और उसे भेजने वाले मेलबॉक्स तक पहुँच दें:

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> `Add-RecipientPermission` नहीं, `Add-MailboxPermission` इस्तेमाल करें। `Add-RecipientPermission` प्राप्तकर्ता पर केवल `SendAs` देता है, जो सर्विस प्रिंसिपल के लिए OAuth के साथ SMTP से मेल भेजने को काफ़ी नहीं है, और भेजना प्रमाणीकरण या अनुमति त्रुटियों के साथ विफल होता है।

### OneUptime में SMTP कॉन्फ़िगरेशन बनाएँ

इन सेटिंग्स के साथ SMTP कॉन्फ़िगरेशन बनाएँ या संपादित करें, और `<tenant-id>` की जगह अपना **Directory (tenant) ID** डालें:

| फ़ील्ड | मान |
| --- | --- |
| होस्टनाम | `smtp.office365.com` |
| पोर्ट | `587` |
| उपयोगकर्ता नाम | वह ईमेल पता जिसे आपने अनुमति दी है (उदाहरण के लिए `sender@yourdomain.com`) |
| प्रमाणीकरण प्रकार | `OAuth` |
| OAuth प्रदाता प्रकार | `Client Credentials` |
| OAuth क्लाइंट ID | आपका **Application (client) ID** |
| OAuth क्लाइंट सीक्रेट | आपके क्लाइंट सीक्रेट का मान |
| OAuth Token URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth स्कोप | `https://outlook.office365.com/.default` |
| प्रेषक ईमेल | उपयोगकर्ता नाम के समान |
| TLS आवश्यक करें | चालू |

फिर **परीक्षण ईमेल भेजें** से जाँचें।
:::

## Google Workspace कॉन्फ़िगरेशन

Google Workspace के लिए डोमेन-व्यापी डेलिगेशन वाला एक **सर्विस अकाउंट** चाहिए, जो आपके डोमेन के किसी उपयोगकर्ता की ओर से मेल भेजता है। Google के SMTP सर्वर Gmail के लिए साधारण client credentials फ़्लो का समर्थन नहीं करते।

### Google Workspace से पहले

- Google Workspace खाता। व्यक्तिगत Gmail खाते इसका समर्थन नहीं करते।
- Google Workspace एडमिन कंसोल तक सुपर एडमिन पहुँच।
- Google Cloud Console तक पहुँच।

:::steps
### Google Cloud प्रोजेक्ट बनाएँ

1. [Google Cloud Console](https://console.cloud.google.com) पर जाएँ।
2. प्रोजेक्ट ड्रॉपडाउन क्लिक करें और **New Project** चुनें।
3. प्रोजेक्ट का नाम डालें, **Create** क्लिक करें और नया प्रोजेक्ट चुनें।

### Gmail API सक्षम करें

1. **APIs & Services** > **Library** पर जाएँ।
2. "Gmail API" खोजें, **Gmail API** क्लिक करें, फिर **Enable** क्लिक करें।

### सर्विस अकाउंट बनाएँ

1. **APIs & Services** > **Credentials** पर जाएँ।
2. **Create Credentials** > **Service account** क्लिक करें।
3. नाम और विवरण डालें, **Create and Continue** क्लिक करें, वैकल्पिक चरण छोड़ दें और **Done** क्लिक करें।

### सर्विस अकाउंट की बनाएँ

1. अभी बनाया गया सर्विस अकाउंट क्लिक करें और **Keys** टैब पर जाएँ।
2. **Add Key** > **Create new key** क्लिक करें, **JSON** चुनें और **Create** क्लिक करें।
3. डाउनलोड की गई JSON फ़ाइल को सुरक्षित रखें। उसका `client_email` आपका OAuth क्लाइंट ID है और `private_key` आपका OAuth क्लाइंट सीक्रेट।

### डोमेन-व्यापी डेलिगेशन सक्षम करें

1. सर्विस अकाउंट के विवरण में **Show Advanced Settings** क्लिक करें।
2. संख्यात्मक **Client ID** नोट करें।
3. **Enable Google Workspace Domain-wide Delegation** पर टिक करें और **Save** क्लिक करें।

### Google Workspace एडमिन में सर्विस अकाउंट को अधिकृत करें

1. [Google Workspace एडमिन कंसोल](https://admin.google.com) में साइन इन करें।
2. **Security** > **Access and data control** > **API Controls** पर जाएँ और **Manage Domain Wide Delegation** क्लिक करें।
3. **Add new** क्लिक करें, पिछले चरण का संख्यात्मक **Client ID** डालें, और **OAuth Scopes** में `https://mail.google.com/` डालें।
4. **Authorize** क्लिक करें।

डेलिगेशन लागू होने में कुछ मिनट से लेकर 24 घंटे तक लग सकते हैं।

### Google Workspace के लिए SMTP कॉन्फ़िगरेशन बनाएँ

इन सेटिंग्स के साथ SMTP कॉन्फ़िगरेशन बनाएँ या संपादित करें:

| फ़ील्ड | मान |
| --- | --- |
| होस्टनाम | `smtp.gmail.com` |
| पोर्ट | `587` |
| उपयोगकर्ता नाम | वह Google Workspace ईमेल पता जिससे मेल भेजना है (उदाहरण के लिए `notifications@yourdomain.com`)। सर्विस अकाउंट इस उपयोगकर्ता का रूप लेता है। |
| प्रमाणीकरण प्रकार | `OAuth` |
| OAuth प्रदाता प्रकार | `JWT Bearer` |
| OAuth क्लाइंट ID | सर्विस अकाउंट JSON का `client_email` (उदाहरण के लिए `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth क्लाइंट सीक्रेट | सर्विस अकाउंट JSON का `private_key` (`-----BEGIN PRIVATE KEY-----` और `-----END PRIVATE KEY-----` सहित पूरी की) |
| OAuth Token URL | `https://oauth2.googleapis.com/token` |
| OAuth स्कोप | `https://mail.google.com/` |
| प्रेषक ईमेल | उपयोगकर्ता नाम के समान |
| TLS आवश्यक करें | चालू |

फिर **परीक्षण ईमेल भेजें** से जाँचें।
:::

> [!IMPORTANT]
> Google (JWT Bearer) के लिए **OAuth क्लाइंट ID** **सर्विस अकाउंट ईमेल** (`client_email`) है, संख्यात्मक `client_id` नहीं। सर्विस अकाउंट **उपयोगकर्ता नाम** वाले उपयोगकर्ता का रूप लेकर मेल भेजता है।

## समस्या निवारण

### Microsoft 365 त्रुटियाँ

| समस्या | समाधान |
| --- | --- |
| "Authentication unsuccessful" | जाँचें कि सर्विस प्रिंसिपल Exchange में रजिस्टर है और उसके पास मेलबॉक्स अनुमतियाँ हैं |
| "AADSTS700016: Application not found" | जाँचें कि क्लाइंट ID सही है और ऐप आपके टेनेंट में मौजूद है |
| "AADSTS7000215: Invalid client secret" | नया क्लाइंट सीक्रेट बनाएँ; पुराने का समय समाप्त हो गया हो सकता है |
| "The mailbox is not enabled for this operation" | मेलबॉक्स तक पहुँच देने के लिए `Add-MailboxPermission` चलाएँ |

### Google Workspace त्रुटियाँ

| समस्या | समाधान |
| --- | --- |
| "invalid_grant" | पक्का करें कि डोमेन-व्यापी डेलिगेशन ठीक से कॉन्फ़िगर है और लागू हो चुका है |
| "unauthorized_client" | जाँचें कि क्लाइंट ID Google Workspace एडमिन कंसोल में अधिकृत है |
| "access_denied" | जाँचें कि स्कोप `https://mail.google.com/` अधिकृत है |
| "Domain policy has disabled third-party Drive apps" | Google Workspace एडमिन में Security > API Controls के तहत API पहुँच सक्षम करें |

### अन्य समस्याएँ

:::details "Cannot send email. Please check your SMTP config."
जब उपयोगकर्ता नाम और पासवर्ड से साइन इन करने वाला, या बिना साइन इन वाला, सर्वर ईमेल स्वीकार नहीं करता, तो **परीक्षण ईमेल भेजें** यह कहता है। **होस्टनाम**, **पोर्ट**, **उपयोगकर्ता नाम** और **पासवर्ड** जाँचें। अगर आपका सर्वर TLS नहीं देता, या उसका प्रमाणपत्र उसके होस्टनाम के लिए मान्य नहीं है, तो **और फ़ील्ड** के नीचे **TLS आवश्यक करें** बंद करें और फिर से कोशिश करें। सर्वर का अपना जवाब परीक्षण के साथ रखा जाता है: **प्रोजेक्ट सेटिंग्स > सूचनाएं > सूचना लॉग** का **ईमेल** टैब खोलें और उसकी पंक्ति पर **स्थिति संदेश देखें** चुनें।
:::

:::details "Cannot send email with OAuth authentication"
OAuth साइन-इन विफल हुआ, और संदेश के अंत में वह त्रुटि है जो आपके प्रदाता ने लौटाई। **OAuth क्लाइंट ID**, **OAuth क्लाइंट सीक्रेट**, **OAuth Token URL** और **OAuth स्कोप** जाँचें, यह भी कि एप्लिकेशन के पास ऊपर दी गई अनुमतियाँ हैं, और एडमिन सहमति दी गई है। अगर आपके Microsoft 365 टेनेंट में SMTP AUTH बंद है, तो इसके बजाय **ट्रांसपोर्ट** को `Microsoft Graph` पर सेट करें।
:::

:::details "Microsoft Graph send failed"
जिस कॉन्फ़िगरेशन का **ट्रांसपोर्ट** `Microsoft Graph` है, वह यह तब कहता है जब Graph ईमेल स्वीकार नहीं करता, और उसके बाद Microsoft की अपनी त्रुटि आती है। जाँचें कि ऐप के पास एडमिन सहमति के साथ **Mail.Send** एप्लिकेशन अनुमति है, कि **OAuth स्कोप** `https://graph.microsoft.com/.default` है, और कि **प्रेषक ईमेल** आपके टेनेंट में लाइसेंस वाला मेलबॉक्स है।
:::

:::details "SMTP server host … could not be reached"
OneUptime ने प्रोजेक्ट के मेल सर्वर से कनेक्ट करने से इनकार किया। OneUptime Cloud पर, जो होस्टनाम रिज़ॉल्व नहीं होता, या निजी, लूपबैक या लिंक-लोकल पते पर रिज़ॉल्व होता है, उसे इस संदेश के साथ अस्वीकार किया जाता है, जो कभी नहीं बताता कि कौन सा मामला था: मेल सर्वर का सार्वजनिक होस्टनाम इस्तेमाल करें। स्व-होस्टेड इंस्टॉलेशन पर, और IP पते के रूप में दिए गए मेल सर्वर के लिए, संदेश इसके बजाय कारण बताता है। **परीक्षण ईमेल भेजें** इसे केवल OAuth कॉन्फ़िगरेशन के लिए दिखाता है; बाकी के लिए, इसे सूचना लॉग के **ईमेल** टैब पर **स्थिति संदेश देखें** में देखें।
:::

:::details परीक्षण ईमेल नहीं पहुँचता
**प्रेषक ईमेल** जाँचें: आपके सर्वर को उस पते से भेजने की अनुमति देनी चाहिए। फिर प्राप्तकर्ता का स्पैम फ़ोल्डर देखें, और अपने मेल सर्वर के लॉग में भेजने की कोशिश खोजें।
:::

## सुरक्षा के सर्वोत्तम तरीके

- **सीक्रेट नियमित रूप से बदलें।** क्लाइंट सीक्रेट की समय-सीमा खत्म होने से पहले उन्हें बदलने के लिए रिमाइंडर सेट करें।
- **अलग क्रेडेंशियल इस्तेमाल करें।** दूसरे एप्लिकेशन के साथ साझा करने के बजाय OneUptime के लिए अलग क्रेडेंशियल बनाएँ।
- **न्यूनतम अधिकार दें।** केवल वही दें जो भेजने के लिए ज़रूरी है: Microsoft के लिए **SMTP.SendAsApp**, Google के लिए स्कोप `https://mail.google.com/`।
- **उपयोग पर नज़र रखें।** असामान्य गतिविधि के लिए ईमेल लॉग और OAuth एप्लिकेशन साइन-इन की समीक्षा करें।
- **सीक्रेट सुरक्षित रखें।** क्लाइंट सीक्रेट को कभी वर्ज़न कंट्रोल में कमिट न करें।

## आगे पढ़ें

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## अगले कदम

:::cards
- [सूचना सारांश](/docs/emails/notification-rollup): OneUptime स्वामियों को जाने वाले ईमेल की बौछार को कैसे इकट्ठा करता है।
- [सब्सक्राइबर और घोषणाएँ](/docs/status-pages/subscribers): प्रोजेक्ट के SMTP कॉन्फ़िगरेशन से स्थिति पृष्ठ के सब्सक्राइबरों को मेल भेजें।
:::
