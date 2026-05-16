# SSO (Single Sign-On)

OneUptime enterprise authentication के लिए SAML 2.0 आधारित Single Sign-On (SSO) का समर्थन करता है। SSO आपके team members को OneUptime में आपके organization के identity provider (IdP) का उपयोग करके login करने की अनुमति देता है, जिससे centralized access management और बेहतर सुरक्षा मिलती है।

## Overview

SSO integration निम्नलिखित लाभ प्रदान करता है:

- **Centralized Authentication**: Users अपने मौजूदा corporate credentials से login करते हैं
- **बेहतर सुरक्षा**: अपने IdP के multi-factor authentication और security policies का लाभ उठाएं
- **सरलीकृत User Management**: अपने मौजूदा identity management system से access प्रबंधित करें
- **कम Password Fatigue**: Users को एक अलग OneUptime password याद नहीं रखना होता

## SSO सेट अप करना

1. **Project Settings पर जाएं**
   - अपने OneUptime project पर जाएं
   - **Project Settings** > **Authentication** > **SSO** पर जाएं

2. **SSO Configuration बनाएं**
   - **Create SSO** पर क्लिक करें
   - SSO configuration के लिए एक **Name** दर्ज करें (जैसे "Keycloak SAML" या "Okta SAML")
   - अपने identity provider से **Sign On URL** दर्ज करें
   - अपने identity provider से **Issuer** (Entity ID) दर्ज करें
   - अपने identity provider से **Public Certificate** paste करें
   - **Signature Algorithm** चुनें (जैसे `RSA-SHA-256`)
   - **Digest Algorithm** चुनें (जैसे `SHA256`)

3. **OneUptime SSO Metadata प्राप्त करें**
   - सहेजने के बाद, **View SSO Config** button पर क्लिक करें
   - **Identifier (Entity ID)** copy करें — यह आपकी IdP configuration में आवश्यक है
   - **Reply URL (Assertion Consumer Service URL)** copy करें — यह आपकी IdP configuration में आवश्यक है

## Keycloak SAML Configuration

Keycloak एक लोकप्रिय open-source identity और access management solution है। OneUptime के लिए SAML identity provider के रूप में Keycloak configure करने के लिए इन steps का पालन करें।

### पूर्व आवश्यकताएं

- एक configured realm के साथ एक चलता हुआ Keycloak instance
- Keycloak और OneUptime दोनों तक Admin access
- SSO support के साथ OneUptime account

### चरण 1: OneUptime SSO Configure करें

1. अपने OneUptime dashboard में लॉग इन करें
2. **Project Settings** > **Authentication** > **SSO** पर जाएं
3. **Create SSO** पर क्लिक करें और निम्नलिखित भरें:
   - **Name**: एक वर्णनात्मक नाम (जैसे `my-project-oneuptime`)
   - **Sign On URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Issuer**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificate**: नीचे [चरण 2](#step-2-get-the-keycloak-certificate) देखें
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. configuration सहेजें

### चरण 2: Keycloak Certificate प्राप्त करें

1. Keycloak में, अपनी client configuration पर जाएं
2. **Export** पर क्लिक करें (या अपने Keycloak version के आधार पर **Keys** tab पर जाएं)
3. exported JSON फ़ाइल में, नाम में `certificate` वाली key खोजें
4. certificate value copy करें और OneUptime में निम्नलिखित format में paste करें:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### चरण 3: Keycloak Client Configure करें

1. Keycloak में, अपने realm में **Clients** पर जाएं
2. एक नया client बनाएं या किसी मौजूदा को संपादित करें
3. **Client Protocol** को `saml` पर सेट करें
4. **Client ID** को OneUptime के **View SSO Config** से **Identifier (Entity ID)** value पर सेट करें
5. **Valid Redirect URIs** को अपने OneUptime URL पर सेट करें
6. **Root URL** को अपने OneUptime base URL पर सेट करें
7. OneUptime से **Reply URL (Assertion Consumer Service URL)** को **Assertion Consumer Service POST Binding URL** field में paste करें

### चरण 4: Keycloak Client Settings Configure करें

1. **Signing keys config** अक्षम करें (Keys tab के अंतर्गत)
2. **Name ID Format** को `email` पर सेट करें
3. सुनिश्चित करें कि **Force Name ID Format** option सक्षम है ताकि Keycloak हमेशा email को Name ID के रूप में भेजे

### चरण 5: Configuration सत्यापित करें

1. Keycloak और OneUptime दोनों में सभी settings सहेजें
2. SSO का उपयोग करके OneUptime में login करने की कोशिश करें
3. आपको अपने Keycloak login page पर redirect होना चाहिए और सफल authentication के बाद OneUptime पर वापस

### Keycloak के लिए समस्या निवारण

- **Signature Error के साथ Login Fails**: सुनिश्चित करें कि certificate सही तरीके से copy की गई है, `BEGIN CERTIFICATE` और `END CERTIFICATE` lines सहित
- **Name ID Error**: सत्यापित करें कि Keycloak में **Name ID Format** `email` पर सेट है
- **Redirect Loop**: जांचें कि **Valid Redirect URIs** और **Assertion Consumer Service POST Binding URL** सही तरीके से configured हैं
- **Certificate Not Found**: सुनिश्चित करें कि आप सही realm में सही client से export कर रहे हैं

---

## Microsoft Entra ID (पूर्व में Azure AD / Active Directory) SAML Configuration

Microsoft Entra ID, Microsoft की cloud-based identity और access management service है। OneUptime के लिए SAML identity provider के रूप में Entra ID configure करने के लिए इन steps का पालन करें।

### पूर्व आवश्यकताएं

- Microsoft Entra ID tenant (enterprise applications के साथ SAML SSO का समर्थन करने वाला कोई भी tier)
- Microsoft Entra ID और OneUptime दोनों तक Admin access
- SSO support के साथ OneUptime account

### चरण 1: OneUptime SSO Configure करें

1. अपने OneUptime dashboard में लॉग इन करें
2. **Project Settings** > **Authentication** > **SSO** पर जाएं
3. **Create SSO** पर क्लिक करें और निम्नलिखित भरें:
   - **Name**: एक वर्णनात्मक नाम (जैसे `Azure AD SAML`)
   - **Sign On URL**: आपको यह Entra ID से [चरण 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime) में मिलेगा
   - **Issuer**: आपको यह Entra ID से [चरण 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime) में मिलेगा
   - **Certificate**: आपको यह Entra ID से [चरण 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime) में मिलेगा
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. **View SSO Config** पर क्लिक करें और **Identifier (Entity ID)** और **Reply URL (Assertion Consumer Service URL)** copy करें — आपको Entra ID के लिए इनकी आवश्यकता होगी

### चरण 2: Microsoft Entra ID में Enterprise Application बनाएं

1. [Microsoft Entra admin center](https://entra.microsoft.com) में sign in करें
2. **Identity** > **Applications** > **Enterprise applications** पर जाएं
3. **+ New application** पर क्लिक करें
4. **+ Create your own application** पर क्लिक करें
5. एक नाम दर्ज करें (जैसे "OneUptime")
6. **Integrate any other application you don't find in the gallery (Non-gallery)** चुनें
7. **Create** पर क्लिक करें

### चरण 3: Entra ID में SAML SSO Configure करें

1. अपने नए enterprise application में, **Single sign-on** पर जाएं
2. single sign-on method के रूप में **SAML** चुनें
3. **Basic SAML Configuration** में, **Edit** पर क्लिक करें और सेट करें:
   - **Identifier (Entity ID)**: OneUptime के **View SSO Config** से **Identifier (Entity ID)** paste करें
   - **Reply URL (Assertion Consumer Service URL)**: OneUptime के **View SSO Config** से **Reply URL** paste करें
4. **Save** पर क्लिक करें
5. **SAML Certificates** section में:
   - **Certificate (Base64)** download करें
   - downloaded certificate फ़ाइल को text editor में खोलें और contents copy करें
6. **Set up OneUptime** section में, copy करें:
   - **Login URL** — इसे OneUptime में **Sign On URL** के रूप में paste करें
   - **Azure AD Identifier** — इसे OneUptime में **Issuer** के रूप में paste करें
7. OneUptime पर वापस जाएं और certificate और URLs paste करें, फिर सहेजें

### चरण 4: User Attributes और Claims Configure करें

1. SAML configuration page में, **Attributes & Claims** पर **Edit** पर क्लिक करें
2. सुनिश्चित करें कि निम्नलिखित claims configured हैं:

| Claim Name | Value |
|-----------|-------|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` या `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. **Name identifier format** को `Email address` पर सेट करें
4. **Save** पर क्लिक करें

### चरण 5: Users और Groups Assign करें

1. अपने enterprise application में, **Users and groups** पर जाएं
2. **+ Add user/group** पर क्लिक करें
3. वे users और/या groups चुनें जिन्हें आप SSO access देना चाहते हैं
4. **Assign** पर क्लिक करें

### चरण 6: Configuration सत्यापित करें

1. Entra ID और OneUptime दोनों में सभी settings सहेजें
2. SSO का उपयोग करके OneUptime में login करने की कोशिश करें
3. आपको Microsoft login page पर redirect होना चाहिए और सफल authentication के बाद OneUptime पर वापस

### Microsoft Entra ID के लिए समस्या निवारण

- **AADSTS700016 Error**: Entra ID में Identifier (Entity ID) OneUptime से मेल नहीं खाती — दोनों values समान हैं इसे सत्यापित करें
- **Certificate Error**: सुनिश्चित करें कि आपने **Base64** certificate download किया (raw/binary format नहीं) और `BEGIN CERTIFICATE` / `END CERTIFICATE` lines शामिल हैं
- **User Not Assigned**: SSO के माध्यम से login करने से पहले users को enterprise application में explicitly assign होना चाहिए
- **Name ID Mismatch**: सुनिश्चित करें कि Name ID claim एक email address पर सेट है जो OneUptime में user के email से मेल खाती है

---

## Okta SAML Configuration

Okta एक व्यापक रूप से उपयोग किया जाने वाला identity platform है जो robust SAML SSO capabilities प्रदान करता है। OneUptime के लिए SAML identity provider के रूप में Okta configure करने के लिए इन steps का पालन करें।

### पूर्व आवश्यकताएं

- admin access के साथ Okta organization
- SSO support के साथ OneUptime account

### चरण 1: OneUptime SSO Configure करें

1. अपने OneUptime dashboard में लॉग इन करें
2. **Project Settings** > **Authentication** > **SSO** पर जाएं
3. **Create SSO** पर क्लिक करें और निम्नलिखित भरें:
   - **Name**: एक वर्णनात्मक नाम (जैसे `Okta SAML`)
   - **Sign On URL**: आपको यह Okta से [चरण 3](#step-3-copy-okta-saml-metadata-to-oneuptime) में मिलेगा
   - **Issuer**: आपको यह Okta से [चरण 3](#step-3-copy-okta-saml-metadata-to-oneuptime) में मिलेगा
   - **Certificate**: आपको यह Okta से [चरण 3](#step-3-copy-okta-saml-metadata-to-oneuptime) में मिलेगा
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. **View SSO Config** पर क्लिक करें और **Identifier (Entity ID)** और **Reply URL (Assertion Consumer Service URL)** copy करें — आपको Okta के लिए इनकी आवश्यकता होगी

### चरण 2: Okta में SAML Application बनाएं

1. अपने Okta Admin Console में sign in करें
2. **Applications** > **Applications** पर जाएं
3. **Create App Integration** पर क्लिक करें
4. **SAML 2.0** चुनें और **Next** पर क्लिक करें
5. **App name** के रूप में "OneUptime" दर्ज करें और **Next** पर क्लिक करें
6. **SAML Settings** section में, configure करें:
   - **Single sign-on URL**: OneUptime के **View SSO Config** से **Reply URL (Assertion Consumer Service URL)** paste करें
   - **Audience URI (SP Entity ID)**: OneUptime के **View SSO Config** से **Identifier (Entity ID)** paste करें
   - **Name ID format**: `EmailAddress` चुनें
   - **Application username**: `Email` चुनें
7. **Next** पर क्लिक करें, फिर **I'm an Okta customer adding an internal app** चुनें और **Finish** पर क्लिक करें

### चरण 3: Okta SAML Metadata OneUptime में Copy करें

1. अपने Okta application में, **Sign On** tab पर जाएं
2. **SAML Signing Certificates** section में, active certificate खोजें और **Actions** > **View IdP metadata** पर क्लिक करें
3. metadata XML से, या **Sign On** tab details से:
   - **Sign On URL** copy करें (जिसे **Identity Provider Single Sign-On URL** भी कहते हैं) — इसे OneUptime में **Sign On URL** के रूप में paste करें
   - **Issuer** copy करें (जिसे **Identity Provider Issuer** भी कहते हैं) — इसे OneUptime में **Issuer** के रूप में paste करें
4. signing certificate download करें:
   - **SAML Signing Certificates** section में, active certificate के लिए **Actions** > **Download certificate** पर क्लिक करें
   - downloaded `.cert` फ़ाइल को text editor में खोलें और contents copy करें
   - OneUptime में certificate paste करें (`BEGIN CERTIFICATE` और `END CERTIFICATE` lines सहित)
5. OneUptime SSO configuration सहेजें

### चरण 4: Attribute Statements Configure करें (वैकल्पिक)

1. Okta application में, **General** tab पर जाएं
2. **SAML Settings** section में **Edit** पर क्लिक करें और SAML settings पर जाने के लिए **Next** पर क्लिक करें
3. **Attribute Statements** section में, जोड़ें:

| Name | Value |
|------|-------|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. **Next** और फिर **Finish** पर क्लिक करें

### चरण 5: Users और Groups Assign करें

1. अपने Okta application में, **Assignments** tab पर जाएं
2. **Assign** > **Assign to People** या **Assign to Groups** पर क्लिक करें
3. वे users या groups चुनें जिन्हें आप SSO access देना चाहते हैं
4. प्रत्येक selection के लिए **Assign** पर क्लिक करें, फिर **Done** पर क्लिक करें

### चरण 6: Configuration सत्यापित करें

1. Okta और OneUptime दोनों में सभी settings सहेजें
2. SSO का उपयोग करके OneUptime में login करने की कोशिश करें
3. आपको Okta login page पर redirect होना चाहिए और सफल authentication के बाद OneUptime पर वापस

### Okta के लिए समस्या निवारण

- **404 या Invalid SSO URL**: सत्यापित करें कि Okta में **Single sign-on URL**, OneUptime के **Reply URL** से बिल्कुल मेल खाती है
- **Audience Mismatch**: सुनिश्चित करें कि Okta में **Audience URI**, OneUptime के **Identifier (Entity ID)** से बिल्कुल मेल खाती है
- **Certificate Error**: सुनिश्चित करें कि आपने **active** signing certificate के लिए certificate download किया, inactive नहीं
- **User Not Assigned**: SSO के माध्यम से login करने से पहले users को Okta application को assigned होना चाहिए
- **Name ID Error**: सत्यापित करें कि **Name ID format** `EmailAddress` पर और **Application username** `Email` पर सेट है

---

## अन्य Identity Providers

OneUptime का SSO implementation SAML 2.0 protocol उपयोग करता है और किसी भी compliant identity provider के साथ काम करना चाहिए। सामान्य configuration steps हैं:

1. OneUptime में, एक SSO configuration बनाएं और **View SSO Config** button से **Identifier (Entity ID)** और **Reply URL (Assertion Consumer Service URL)** नोट करें
2. अपने identity provider में, इन्हें उपयोग करके एक SAML application बनाएं:
   - **Assertion Consumer Service URL / Reply URL**: OneUptime SSO config से
   - **Entity ID / Audience URI**: OneUptime SSO config से
   - **Name ID Format**: Email address
3. अपने identity provider से निम्नलिखित OneUptime में copy करें:
   - **Sign On URL** (SSO endpoint)
   - **Issuer** (IdP का Entity ID)
   - **Public Certificate** (X.509 signing certificate)
4. **Signature Algorithm** को `RSA-SHA-256` और **Digest Algorithm** को `SHA256` पर सेट करें

## SSO और Roles पर नोट्स

OneUptime वर्तमान में अपने identity provider से SAML roles mapping का समर्थन नहीं करता। Role-based access को OneUptime के **Project Settings** > **SSO** settings के भीतर अलग से configure किया जाना चाहिए, जहाँ आप SSO users के लिए default roles assign कर सकते हैं।
