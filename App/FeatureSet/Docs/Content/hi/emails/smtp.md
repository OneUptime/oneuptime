# SMTP Configuration

OneUptime तीन authentication methods के साथ custom SMTP servers के माध्यम से emails भेजने का समर्थन करता है:

- **Username और Password** - पारंपरिक SMTP authentication
- **OAuth 2.0** - Microsoft 365 और Google Workspace के लिए आधुनिक authentication
- **None** - उन relay servers के लिए जिन्हें authentication की आवश्यकता नहीं है

यह मार्गदर्शिका Microsoft 365 और Google Workspace के लिए OAuth 2.0 authentication configure करने का तरीका बताती है।

## OAuth 2.0 Authentication

OAuth 2.0 email servers के साथ authenticate करने का एक अधिक सुरक्षित तरीका प्रदान करता है, विशेष रूप से enterprise environments के लिए जिन्होंने basic authentication अक्षम कर दी है। OneUptime दो OAuth grant types का समर्थन करता है:

- **Client Credentials** - Microsoft 365 और अधिकांश OAuth providers द्वारा उपयोग किया जाता है
- **JWT Bearer** - Google Workspace service accounts द्वारा उपयोग किया जाता है

### OAuth के लिए आवश्यक Fields

OneUptime में OAuth authentication के साथ SMTP configure करते समय, आपको निम्नलिखित की आवश्यकता होगी:

| Field                   | विवरण                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| **Hostname**            | SMTP server address                                                                      |
| **Port**                | SMTP port (आमतौर पर STARTTLS के लिए 587 या implicit TLS के लिए 465)                      |
| **Username**            | भेजने के लिए email address                                                               |
| **Authentication Type** | "OAuth" चुनें                                                                            |
| **OAuth Provider Type** | Microsoft 365 के लिए "Client Credentials", या Google Workspace के लिए "JWT Bearer" चुनें |
| **Client ID**           | आपके OAuth provider से Application/Client ID (Google के लिए: service account email)      |
| **Client Secret**       | आपके OAuth provider से Client secret (Google के लिए: private key)                        |
| **Token URL**           | OAuth token endpoint URL                                                                 |
| **Scope**               | SMTP access के लिए आवश्यक OAuth scope(s)                                                 |

---

## Microsoft 365 Configuration

Microsoft 365/Exchange Online के साथ OAuth उपयोग करने के लिए, आपको Microsoft Entra (Azure AD) में एक application register करने और उचित permissions configure करने की आवश्यकता है।

### चरण 1: Microsoft Entra में एक Application Register करें

1. [Microsoft Entra admin center](https://entra.microsoft.com) में sign in करें
2. **Identity** > **Applications** > **App registrations** पर जाएं
3. **New registration** पर क्लिक करें
4. अपने application के लिए एक नाम दर्ज करें (जैसे "OneUptime SMTP")
5. **Supported account types** के लिए "Accounts in this organizational directory only" चुनें
6. **Redirect URI** खाली छोड़ें (client credentials flow के लिए आवश्यक नहीं)
7. **Register** पर क्लिक करें

Registration के बाद, **Overview** page से निम्नलिखित values नोट करें:

- **Application (client) ID** - यह आपकी Client ID है
- **Directory (tenant) ID** - आपको Token URL के लिए इसकी आवश्यकता होगी

### चरण 2: एक Client Secret बनाएं

1. अपने app registration में, **Certificates & secrets** पर जाएं
2. **New client secret** पर क्लिक करें
3. एक विवरण जोड़ें और एक expiration period चुनें
4. **Add** पर क्लिक करें
5. **secret value तुरंत copy करें** - यह फिर नहीं दिखाई देगा

### चरण 3: SMTP API Permissions जोड़ें

1. **API permissions** पर जाएं
2. **Add a permission** पर क्लिक करें
3. **APIs my organization uses** चुनें
4. **Office 365 Exchange Online** खोजें और चुनें
5. **Application permissions** चुनें
6. **SMTP.SendAsApp** खोजें और चेक करें
7. **Add permissions** पर क्लिक करें
8. **Grant admin consent for [your organization]** पर क्लिक करें (admin privileges आवश्यक)

### चरण 4: Exchange Online में Service Principal Register करें

आपका application emails भेज सके, इससे पहले आपको Exchange Online में service principal register करना होगा और mailbox permissions grant करनी होंगी।

1. Exchange Online PowerShell module इंस्टॉल करें:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Exchange Online से connect करें:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. service principal register करें (App Registrations से नहीं, **Enterprise Applications** से Object ID उपयोग करें):

```powershell
# Microsoft Entra > Enterprise Applications > Your App > Object ID में Object ID खोजें
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. service principal को एक specific mailbox से send करने की permission दें:

```powershell
# service principal को full mailbox access grant करें
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **नोट:** `Add-RecipientPermission` नहीं, `Add-MailboxPermission` उपयोग करें। `Add-RecipientPermission` केवल recipient पर `SendAs` grant करती है और service principal के लिए OAuth के साथ SMTP के माध्यम से mail भेजने के लिए पर्याप्त नहीं है — आपको send time पर authentication/permission त्रुटि मिलेगी। `FullAccess` के साथ `Add-MailboxPermission` वह command है जो वास्तव में काम करती है।

### चरण 5: OneUptime में Configure करें

OneUptime में, इन settings के साथ एक SMTP configuration बनाएं या संपादित करें:

| Field               | Value                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Hostname            | `smtp.office365.com`                                                         |
| Port                | `587`                                                                        |
| Username            | वह email address जिसे आपने permissions दी हैं (जैसे `sender@yourdomain.com`) |
| Authentication Type | `OAuth`                                                                      |
| OAuth Provider Type | `Client Credentials`                                                         |
| Client ID           | चरण 1 से आपका Application (client) ID                                        |
| Client Secret       | चरण 2 से secret value                                                        |
| Token URL           | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`            |
| Scope               | `https://outlook.office365.com/.default`                                     |
| From Email          | Username के समान                                                             |
| Secure (TLS)        | सक्षम                                                                        |

`<tenant-id>` को चरण 1 से अपने Directory (tenant) ID से बदलें।

---

## Google Workspace Configuration

Google Workspace के लिए users की ओर से emails भेजने के लिए domain-wide delegation के साथ एक **service account** की आवश्यकता है। यह आवश्यक है क्योंकि Google के SMTP servers Gmail के लिए direct OAuth client credentials flow का समर्थन नहीं करते।

### पूर्व आवश्यकताएं

- Google Workspace account (नियमित Gmail नहीं - consumer Gmail accounts इसका समर्थन नहीं करते)
- Google Workspace Admin Console तक Super Admin पहुंच
- Google Cloud Console तक पहुंच

### चरण 1: एक Google Cloud Project बनाएं

1. [Google Cloud Console](https://console.cloud.google.com) पर जाएं
2. project dropdown पर क्लिक करें और **New Project** चुनें
3. एक project नाम दर्ज करें और **Create** पर क्लिक करें
4. अपना नया project चुनें

### चरण 2: Gmail API सक्षम करें

1. **APIs & Services** > **Library** पर जाएं
2. "Gmail API" खोजें
3. **Gmail API** पर क्लिक करें और फिर **Enable** करें

### चरण 3: एक Service Account बनाएं

1. **APIs & Services** > **Credentials** पर जाएं
2. **Create Credentials** > **Service account** पर क्लिक करें
3. service account के लिए एक नाम और विवरण दर्ज करें
4. **Create and Continue** पर क्लिक करें
5. वैकल्पिक steps छोड़ें और **Done** पर क्लिक करें

### चरण 4: Service Account Keys बनाएं

1. अभी बनाए गए service account पर क्लिक करें
2. **Keys** tab पर जाएं
3. **Add Key** > **Create new key** पर क्लिक करें
4. **JSON** चुनें और **Create** पर क्लिक करें
5. downloaded JSON फ़ाइल को सुरक्षित रूप से सहेजें - इसमें शामिल हैं:
   - `client_id` - आपकी Client ID
   - `private_key` - आपका Client Secret (private key)

### चरण 5: Domain-Wide Delegation सक्षम करें

1. service account details में, **Show Advanced Settings** पर क्लिक करें
2. **Client ID** (numerical ID) नोट करें
3. **Enable Google Workspace Domain-wide Delegation** चेक करें
4. **Save** पर क्लिक करें

### चरण 6: Google Workspace Admin में Service Account Authorize करें

1. [Google Workspace Admin Console](https://admin.google.com) में sign in करें
2. **Security** > **Access and data control** > **API Controls** पर जाएं
3. **Manage Domain Wide Delegation** पर क्लिक करें
4. **Add new** पर क्लिक करें
5. चरण 5 से **Client ID** दर्ज करें
6. **OAuth Scopes** के लिए, दर्ज करें: `https://mail.google.com/`
7. **Authorize** पर क्लिक करें

नोट: delegation propagate होने में कुछ मिनटों से 24 घंटे तक लग सकते हैं।

### चरण 7: OneUptime में Configure करें

OneUptime में, इन settings के साथ एक SMTP configuration बनाएं या संपादित करें:

| Field               | Value                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostname            | `smtp.gmail.com`                                                                                                                             |
| Port                | `587`                                                                                                                                        |
| Username            | भेजने के लिए Google Workspace email address (जैसे `notifications@yourdomain.com`)। इस user को service account द्वारा impersonate किया जाएगा। |
| Authentication Type | `OAuth`                                                                                                                                      |
| OAuth Provider Type | `JWT Bearer`                                                                                                                                 |
| Client ID           | आपके service account JSON से `client_email` (जैसे `your-service@your-project.iam.gserviceaccount.com`)                                       |
| Client Secret       | आपके service account JSON से `private_key` (`-----BEGIN PRIVATE KEY-----` और `-----END PRIVATE KEY-----` सहित संपूर्ण key)                   |
| Token URL           | `https://oauth2.googleapis.com/token`                                                                                                        |
| Scope               | `https://mail.google.com/`                                                                                                                   |
| From Email          | Username के समान                                                                                                                             |
| Secure (TLS)        | सक्षम                                                                                                                                        |

**महत्वपूर्ण:** Google (JWT Bearer) के लिए, Client ID **service account email** (`client_email`) है, numerical `client_id` नहीं। service account emails भेजने के लिए Username field में निर्दिष्ट user को impersonate करेगा।

---

## समस्या निवारण

### Microsoft 365

| समस्या                                          | समाधान                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| "Authentication unsuccessful"                   | सत्यापित करें कि service principal Exchange में registered है और mailbox permissions हैं |
| "AADSTS700016: Application not found"           | जांचें कि Client ID सही है और app आपके tenant में मौजूद है                               |
| "AADSTS7000215: Invalid client secret"          | client secret regenerate करें - यह expired हो सकती है                                    |
| "The mailbox is not enabled for this operation" | mailbox तक पहुंच grant करने के लिए `Add-MailboxPermission` चलाएं                         |

### Google Workspace

| समस्या                                              | समाधान                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| "invalid_grant"                                     | सुनिश्चित करें कि domain-wide delegation ठीक से configured और propagated है |
| "unauthorized_client"                               | सत्यापित करें कि Client ID Google Workspace Admin Console में authorized है |
| "access_denied"                                     | जांचें कि scope `https://mail.google.com/` authorized है                    |
| "Domain policy has disabled third-party Drive apps" | Google Workspace Admin > Security > API Controls में API access सक्षम करें  |

### सामान्य

- **अपनी configuration परीक्षण करें**: अपना setup सत्यापित करने के लिए OneUptime में "Send Test Email" button उपयोग करें
- **logs जांचें**: विस्तृत त्रुटि संदेशों के लिए OneUptime logs समीक्षा करें
- **Token caching**: OneUptime OAuth tokens cache करता है और expiry से पहले उन्हें स्वचालित रूप से refresh करता है

---

## सुरक्षा सर्वोत्तम प्रथाएं

1. **secrets नियमित रूप से rotate करें**: expired होने से पहले client secrets rotate करने के लिए calendar reminders सेट करें
2. **समर्पित service accounts उपयोग करें**: अन्य applications के साथ share करने के बजाय OneUptime के लिए अलग credentials बनाएं
3. **न्यूनतम privilege का सिद्धांत**: केवल आवश्यक न्यूनतम permissions grant करें (Microsoft के लिए SMTP.SendAsApp, Google के लिए mail.google.com scope)
4. **उपयोग Monitor करें**: असामान्य गतिविधि के लिए email logs और OAuth application sign-ins समीक्षा करें
5. **सुरक्षित storage**: client secrets को कभी version control में commit न करें

---

## अतिरिक्त Resources

### Microsoft 365

- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace

- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
