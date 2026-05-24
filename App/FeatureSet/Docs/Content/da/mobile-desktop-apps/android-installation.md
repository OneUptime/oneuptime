# Android-installationsvejledning

Installer den native Android-app **OneUptime On-Call** fra Google Play Store, eller sideload APK'en direkte på enheder uden Google Play.

## Krav

- Android-telefon eller -tablet med **Android 8.0 (Oreo) eller nyere**
- En aktiv OneUptime-konto (eller URL'en til din selvhostede OneUptime-instans)
- Internetforbindelse til log ind og for at modtage push-notifikationer

## Mulighed 1: Installer fra Google Play (anbefalet)

1. Åbn **Google Play Store** på din enhed.
2. Søg efter **"OneUptime On-Call"**, eller åbn dette link på din enhed:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. Tryk på **Installer**.
4. Når den er installeret, skal du trykke på **Åbn** eller starte **OneUptime On-Call** fra din app-skuffe.

## Mulighed 2: Installer APK'en direkte

For enheder uden Google Play (for eksempel GrapheneOS, /e/OS eller Huawei-enheder), installer den officielle APK fra GitHub Releases:

1. Åbn dette link på din Android-enhed:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. Når du bliver bedt om det, skal du tillade din browser at installere ukendte apps:
   **Indstillinger → Apps → \[Din browser\] → Installer ukendte apps → Tillad fra denne kilde**.
3. Åbn den downloadede APK, og tryk på **Installer**.
4. Start **OneUptime On-Call** fra din app-skuffe.

APK'en er bygget og signeret af OneUptime fra den samme kildekode som Play Store-udgivelsen. App-opdateringer er ikke automatiske ved sideloading — download den nyeste APK fra linket ovenfor, når en ny version udgives.

## Første start og log ind

1. **Server-URL**
   - Hvis du bruger OneUptime Cloud, så lad standarden `https://oneuptime.com` stå.
   - Hvis du selvhoster, skal du indtaste URL'en til din OneUptime-instans (f.eks. `https://oneuptime.example.com`).
   - Appen verificerer, at serveren kan nås, før du kan fortsætte.
2. **Log ind**
   - Indtast e-mail og adgangskode til din OneUptime-konto.
   - Aktivér eventuelt **biometrisk oplåsning** (fingeraftryk) for hurtigere oplåsning ved senere starter.
3. **Tillad notifikationer**
   - Når du bliver bedt om det, skal du trykke på **Tillad**, så appen kan levere on-call-tilkald, hændelsesalarmer og kvitteringer.

## Push-notifikationer

Push-notifikationer leveres via Firebase Cloud Messaging (FCM) gennem Expo Push. For at sikre, at tilkald når sikkert frem til dig, mens du har on-call-vagt:

1. Åbn **Indstillinger → Apps → OneUptime On-Call → Notifikationer**, og bekræft, at alle kategorier er aktiveret.
2. Åbn **Indstillinger → Apps → OneUptime On-Call → Batteri**, og vælg **Ubegrænset** (eller deaktiver batterioptimering), så operativsystemet ikke forsinker push-meddelelser i baggrunden.
3. Tillad appen at køre i baggrunden, og deaktiver eventuelle "Datasparer"-begrænsninger for den.
4. Hvis du bruger Samsung-enheder, skal du også slå **Indstillinger → Enhedspleje → Batteri → Grænser for baggrundsforbrug** fra for OneUptime On-Call.
5. Føj OneUptime On-Call til alle undtagelseslister for **Do Not Disturb**, så tilkald stadig ringer under din on-call-vagt.

## Opdateringer

**Google Play:**
- Opdateringer installeres automatisk. For at udløse en manuelt skal du åbne **Play Store → Profil → Administrer apps og enhed → Opdateringer tilgængelige → OneUptime On-Call → Opdater**.

**APK-sideload:**
- Download den nyeste APK igen fra GitHub Releases-linket ovenfor, og installer oven på den eksisterende app — dine data, server-URL og log ind bevares.

## Afinstaller

1. **Tryk længe** på **OneUptime On-Call**-ikonet, og tryk derefter på **Afinstaller**.
2. Eller åbn **Indstillinger → Apps → OneUptime On-Call → Afinstaller**.
3. Bekræft for at fjerne appen.

Din OneUptime-konto og dine on-call-planer er lagret på serversiden og fjernes ikke, når du afinstallerer appen.

## Fejlfinding

**"Netværksfejl" ved log ind:**
- Bekræft, at **Server-URL** er korrekt og kan nås fra din enhed.
- Hvis du er på et virksomhedsnetværk eller en VPN, så sørg for, at OneUptime-instansen er tilgængelig.
- Bekræft, at serveren serveres over HTTPS med et gyldigt certifikat.

**Modtager ikke push-notifikationer:**
- Bekræft, at notifikationer er aktiveret under **Indstillinger → Apps → OneUptime On-Call → Notifikationer**.
- Deaktiver batterioptimering for OneUptime On-Call (se Push-notifikationer ovenfor).
- Sørg for, at Do Not Disturb er slået fra, eller at OneUptime On-Call er på undtagelseslisten.
- Log ud, og log ind igen for at opdatere det push-token, der er registreret hos serveren.
- Selvhostede brugere: bekræft, at push-notifikationer er konfigureret på din OneUptime-instans (se vejledningen [Push-notifikationer](/docs/self-hosted/push-notifications) for selvhostning).

**Biometrisk oplåsning virker ikke:**
- Registrer et fingeraftryk under **Indstillinger → Sikkerhed → Fingeraftryk**.
- Genaktivér biometrisk oplåsning fra **Indstillinger**-skærmen i OneUptime On-Call-appen.

**APK-installation blokeret:**
- Du skal give browseren tilladelse til at installere ukendte apps (se Mulighed 2 ovenfor).
- Visse teleudbydere eller virksomhedsenhedsprofiler blokerer sideloading fuldstændigt; brug i så fald Google Play-versionen i stedet.

**Appen går ned ved start:**
- Opdater til den nyeste version fra Google Play eller den nyeste APK.
- Genstart din enhed.
- Hvis problemet fortsætter, så afinstaller og geninstaller, og log ind igen.

## Support

Hvis du stadig har brug for hjælp, kan du kontakte os via dit OneUptime-dashboard eller åbne et issue på vores [GitHub-repository](https://github.com/OneUptime/oneuptime).
