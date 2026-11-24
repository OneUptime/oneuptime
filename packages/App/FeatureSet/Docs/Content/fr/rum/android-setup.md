# Configuration Android

Instrumentez une application Android native avec OpenTelemetry Android afin qu'elle se signale à OneUptime comme application RUM mobile : ses plantages et ses ANR, ses images lentes et figées, ses démarrages, ses écrans, ses sessions et ses requêtes réseau, tracés jusqu'à votre backend.

:::cards
- [Ajouter OpenTelemetry Android](#ajouter-opentelemetry-android): Une dépendance Gradle, et quelques lignes au démarrage de l'application.
- [Ce que l'agent signale](#ce-que-lagent-signale): Plantages, ANR, images figées, démarrages et sessions, et où chacun arrive.
- [Tracer les requêtes jusqu'à votre backend](#tracer-les-requêtes-jusquà-votre-backend): Un span pour chaque appel OkHttp, et un `traceparent` sur chacun.
- [Tracer vos propres flux de travail](#tracer-vos-propres-flux-de-travail): Une commande du menu jusqu'à la cuisine, un terminal de paiement, une imprimante.
- [Bornes et autres appareils qui vous appartiennent](#bornes-et-autres-appareils-qui-vous-appartiennent): Nommer chaque appareil, le configurer depuis votre MDM, garder les données hors ligne.
:::

## Fonctionnement

OpenTelemetry Android s'exécute dans votre application. Il envoie des traces, des journaux et des métriques à OneUptime via OTLP avec une clé d'ingestion **Serveur**, et ajoute un en-tête W3C `traceparent` aux requêtes que fait votre application, pour que les spans de votre backend rejoignent les traces de l'application.

```mermaid title="De l'application à OneUptime, et à travers votre backend"
flowchart TB
    app["Votre application Android<br/>avec OpenTelemetry Android"] -->|"OTLP avec<br/>une clé Serveur"| oneuptime["OneUptime"]
    app -->|"requêtes avec<br/>un en-tête traceparent"| api["Vos API : commandes,<br/>POS, écran de cuisine"]
    api -->|"OTLP"| oneuptime
    oneuptime --> rum["Application RUM mobile"]
    oneuptime --> exceptions["Exceptions"]
```

## Avant de commencer

- Une application Android dont le `minSdk` vaut 23 ou plus, compilée avec `compileSdk` 34 ou plus. Avec un `minSdk` inférieur à 26, activez le [désucrage de la bibliothèque principale](https://developer.android.com/studio/write/java8-support#library-desugaring), avec Android Gradle Plugin 8.3.0 ou ultérieur et `android.useFullClasspathForDexingTransform=true` dans `gradle.properties`.
- Une clé d'ingestion **Serveur**, créée sous **Paramètres du projet → Télémétrie & APM → Clés d'ingestion** avec **Créer une clé d'ingestion**. Une clé **Navigateur** est refusée depuis une application : elle est vérifiée par rapport à l'en-tête `Origin`, qu'une application n'envoie pas.
- Ces paramètres OTLP. Si vous hébergez OneUptime vous-même, remplacez `https://oneuptime.com` par votre propre hôte.

| Paramètre | Valeur |
| --- | --- |
| Point de terminaison OTLP | `https://oneuptime.com/otlp` |
| En-tête | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |

> [!WARNING]
> La clé est livrée dans votre application, et une application peut être décompressée : partez donc du principe que quelqu'un la copiera. Sur la page de la clé, définissez un **Nom du service épinglé**, une **Requests Per Minute Limit** et une date **Expire le**, et renouvelez la clé à chaque version.

## Ajouter OpenTelemetry Android

:::steps
### Ajouter la dépendance

```kotlin title="app/build.gradle.kts"
dependencies {
    implementation("io.opentelemetry.android:android-agent:1.8.1")
}
```

L'agent apporte avec lui l'instrumentation des plantages, des ANR, du rendu lent, des activités, des fragments, du réseau et des sessions. Consultez [ses versions](https://github.com/open-telemetry/opentelemetry-android/releases) pour en trouver une plus récente.

### Démarrer l'agent avec l'application

```kotlin title="KioskApplication.kt"
import android.app.Application
import io.opentelemetry.android.OpenTelemetryRum
import io.opentelemetry.android.agent.OpenTelemetryRumInitializer

class KioskApplication : Application() {
    lateinit var otelRum: OpenTelemetryRum

    override fun onCreate() {
        super.onCreate()

        otelRum = OpenTelemetryRumInitializer.initialize(this) {
            httpExport {
                baseUrl = "https://oneuptime.com/otlp"
                baseHeaders = mapOf("x-oneuptime-token" to BuildConfig.ONEUPTIME_TOKEN)
            }
            resource {
                put("service.name", "kiosk-ordering")
                put("deployment.environment.name", "production")
            }
        }
    }
}
```

`baseUrl` est le point de terminaison sans signal : l'agent y ajoute `/v1/traces`, `/v1/logs` et `/v1/metrics`. Définissez `service.name`, sinon l'application est nommée d'après son libellé dans le lanceur. Ce nom est l'identité de l'application dans OneUptime : gardez-le identique d'une version à l'autre.

Indiquez la classe dans l'attribut `android:name` de l'élément `<application>` de votre manifeste. `BuildConfig.ONEUPTIME_TOKEN` représente l'endroit où votre build conserve la clé ; un parc d'appareils peut plutôt la recevoir de son MDM, comme le montre [Bornes et autres appareils qui vous appartiennent](#bornes-et-autres-appareils-qui-vous-appartiennent).

### Lancer l'application et vérifier que tout arrive

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` avec `"valid": true` signifie que la clé est acceptée. Lancez ensuite l'application et utilisez-la un instant : elle apparaît sous **Produits → Ressources → Surveillance des utilisateurs réels**, nommée d'après son `service.name`. L'agent écrit la télémétrie sur le disque avant de l'envoyer : le premier lot peut donc mettre une minute à arriver.
:::

## Ce que l'agent signale

OpenTelemetry Android enregistre tout cela de lui-même. Les attributs d'appareil qu'il définit, `device.model.identifier`, `device.model.name` et `device.manufacturer`, classent l'application comme application RUM mobile et remplissent sa page **Clients**. Il définit aussi `os.name`, `os.version` et un `app.installation.id` pour chaque installation, et aucun `device.id`.

| Quoi | Comment l'agent l'envoie | Où cela apparaît dans OneUptime |
| --- | --- | --- |
| Plantages | Un événement `app.crash` avec le type, le message et la stack trace de l'exception | **Exceptions**, comme non gérés |
| ANR | Un événement `device.anr` avec la pile du thread principal, dès que l'application cesse de répondre pendant environ 5 secondes | **Exceptions**, comme non gérés, sous le type `ANR` |
| Images lentes et figées | Un événement `app.jank` avec `app.jank.frame_count`, les images plus lentes que 16 ms (`app.jank.threshold` vaut `0.016`) ou 700 ms (`0.7`) | **Journaux**, avec `@event.name:app.jank` |
| Démarrages de l'application | Un span `AppStart`, avec `start.type` défini à `cold`, `warm` ou `hot` | **Traces** |
| Écrans | Un span pour chaque étape du cycle de vie d'une activité ou d'un fragment, et `app.screen.name` sur chaque span et chaque journal | **Traces** |
| Sessions | `session.id` sur chaque span et chaque journal, et les événements `session.start` et `session.end` | **Traces** et **Journaux**, recherchés avec `@session.id:` |
| Changements de réseau | Un événement `network.change`, et `network.connection.type` sur chaque span et chaque journal | **Journaux** |

Les plantages et les ANR arrivent dans **Exceptions** comme non gérés, regroupés par stack trace, avec la session dans laquelle ils se sont produits. L'agent enregistre un plantage sur le disque au moment où l'application meurt et l'envoie à partir de là : un plantage survenu hors ligne arrive donc quand même dès que l'application tourne à nouveau avec un réseau.

La page **Vue d'ensemble** de l'application les lit pour vous : **Sessions**, **Sessions sans plantage**, **Plantages**, **ANR**, **Démarrages de l'application**, **Démarrage à froid (p95)** et **Images figées**, chaque tuile ouvrant les exceptions, les spans ou les événements qu'elle compte. Tant que l'application n'envoie ni démarrages ni images, leurs graphiques indiquent ce qui les active. Sa page **Recommandations** propose des moniteurs pour les plantages, les ANR, les démarrages à froid lents, les images figées, et une application ou l'un de ses appareils qui cesse d'envoyer des données.

Sous **Sessions sans plantage**, la ligne donne la même part pour les installations : l'`app.installation.id` qu'OpenTelemetry Android 1.1 et les versions ultérieures définissent sur chaque span et chaque journal, un identifiant conservé tant que l'application reste installée, qui représente donc ses utilisateurs. Pour une application qui compte des centaines de sessions par heure, où un plantage par jour est normal, **App Crash Rate** et **App ANR Rate** alertent sur la part des sessions d'une heure qui ont planté ou se sont bloquées, au-delà des 1,09 % et 0,47 % d'Android vitals, au lieu d'alerter à chaque fois. **Daily Crash Rate** et **Daily ANR Rate** alertent sur la part des installations d'une journée qui ont planté ou se sont bloquées, au-delà des mêmes 1,09 % et 0,47 % sur au moins 250 installations : les taux perçus par l'utilisateur qu'évalue Android vitals et qu'affiche la Play Console.

Une session se termine après 15 minutes en arrière-plan, ou après 4 heures. Une application qui ne passe jamais en arrière-plan, comme une borne, garde une seule session pendant 4 heures : tracez donc la visite de chaque client comme un span à part entière, comme le montre [Tracer vos propres flux de travail](#tracer-vos-propres-flux-de-travail).

Les propres appels `android.util.Log` de votre application deviennent aussi des journaux quand vous ajoutez `android-log-library` et `android-log-agent` à côté des modules OkHttp ci-dessous : le tag de chaque appel va dans `android.log.tag`, et un appel avec un throwable est une exception dans **Exceptions**. OpenTelemetry Android ne lit pas Logcat.

## Tracer les requêtes jusqu'à votre backend

Ajoutez l'instrumentation OkHttp et le plugin ByteBuddy avec lequel elle se construit :

```kotlin title="app/build.gradle.kts"
plugins {
    // ...the plugins your app already applies, then:
    id("net.bytebuddy.byte-buddy-gradle-plugin") version "1.18.15"
}

dependencies {
    implementation("io.opentelemetry.android:android-agent:1.8.1")
    implementation("io.opentelemetry.android.instrumentation:okhttp3-library:1.8.1-alpha")
    byteBuddy("io.opentelemetry.android.instrumentation:okhttp3-agent:1.8.1-alpha")
}
```

Le plugin instrumente la classe `OkHttpClient` elle-même : chaque client de l'application est donc tracé, y compris ceux que créent les bibliothèques. Chaque requête devient un span client nommé d'après sa méthode, avec son URL, son code de statut et sa durée, et porte un en-tête W3C `traceparent`. Un backend instrumenté avec [OpenTelemetry](/docs/telemetry/open-telemetry) poursuit la trace à partir de cet en-tête : l'API de commande, la passerelle POS et le service d'affichage en cuisine ajoutent ainsi leurs spans à la même trace que l'appui sur la borne.

- `HttpURLConnection` dispose de la même paire de modules : `httpurlconnection-library` et `httpurlconnection-agent`.
- Sans le plugin, enveloppez vous-même un client : `OkHttpTelemetry.builder(otelRum.openTelemetry).build().createCallFactory(client)`, issu de `io.opentelemetry.instrumentation:opentelemetry-okhttp-3.0`.
- Un span ouvert dans votre code, comme dans la section suivante, est le parent des requêtes faites à l'intérieur.

## Tracer vos propres flux de travail

Obtenez un tracer auprès de l'agent, et créez un span pour la commande d'un client, avec un span enfant pour chacune de ses étapes. Chaque étape a alors sa propre durée et ses propres erreurs, et la commande indique comment elle s'est terminée :

```kotlin title="OrderTrace.kt"
import io.opentelemetry.api.trace.Span
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.api.trace.Tracer
import io.opentelemetry.context.Context

class OrderTrace(private val tracer: Tracer) {
    // order.session: from the first tap to the order reaching the kitchen.
    private val order: Span = tracer.spanBuilder("order.session").startSpan()
    private val parent: Context = Context.current().with(order)

    // One step: menu.browse, cart.customize, payment.process, pos.inject.
    fun <T> step(name: String, block: (Span) -> T): T {
        val span = tracer.spanBuilder(name).setParent(parent).startSpan()
        return try {
            span.makeCurrent().use { block(span) }
        } catch (error: Throwable) {
            span.recordException(error)
            span.setStatus(StatusCode.ERROR)
            throw error
        } finally {
            span.end()
        }
    }

    fun complete() = finish("completed")

    fun abandon(reason: String) {
        order.setAttribute("order.abandon_reason", reason)
        finish("abandoned")
    }

    private fun finish(outcome: String) {
        order.setAttribute("order.outcome", outcome)
        order.end()
    }
}
```

```kotlin title="CheckoutFlow.kt"
val order = OrderTrace(otelRum.openTelemetry.getTracer("kiosk.ordering"))

order.step("cart.customize") { span ->
    span.setAttribute("cart.items", cart.size.toLong())
}
order.step("payment.process") { terminal.charge(cart.total) }
order.step("pos.inject") { posApi.submit(cart) } // its OkHttp span is a child
order.complete()
```

Enveloppez de la même façon chaque appel au SDK d'un terminal de paiement, d'une imprimante, d'un scanner ou d'un lecteur NFC, et indiquez de quel appareil il s'agissait, pour qu'un appareil lent ou défaillant soit un span lent ou en échec :

```kotlin title="ReceiptPrinter.kt"
order.step("printer.print") { span ->
    span.setAttribute("peripheral.type", "printer")
    span.setAttribute("peripheral.model", printer.model)
    span.setAttribute("peripheral.connection", "usb")
    printer.print(receipt, timeoutMillis = 10_000)
}
```

Les noms d'attributs sont à votre choix : gardez-les identiques dans chaque application, pour qu'un seul filtre trouve toutes les imprimantes. Donnez un délai d'expiration à chaque appel, car un span ne se termine que lorsque son appel revient. Une étape qui couvre plusieurs écrans, comme la consultation du menu, est un span que vous démarrez à l'ouverture de l'écran et terminez à sa fermeture, avec le même parent. Pour un fait sans durée, comme une imprimante à court de papier, envoyez un événement : `otelRum.emitEvent("printer.paper_low")`.

Dans **Traces**, filtrez sur le nom d'une étape pour voir combien de temps elle prend et à quelle fréquence elle échoue, et sur `@order.outcome:abandoned` pour trouver les commandes qui n'ont jamais été terminées.

## Bornes et autres appareils qui vous appartiennent

### Nommer chaque appareil

OneUptime classe une application mobile par application, jamais par appareil : une application installée sur des milliers de téléphones ne liste donc jamais les téléphones de ses utilisateurs. Pour les appareils qui vous appartiennent, nommez chacun d'eux dans `host.name`. Chaque appareil apparaît alors dans **Inventaire** comme hôte, à côté de vos autres machines, avec la marque, le modèle et la version de l'OS que l'agent signale, ce que vous ajoutez ci-dessous et la date à laquelle il a été vu pour la dernière fois :

```kotlin title="KioskApplication.kt"
resource {
    put("service.name", "kiosk-ordering")
    put("host.name", deviceName)
    put("host.serial_number", serialNumber)
    put("device.type", "kiosk")
    put("device.location", "Store 0412")
}
```

La télémétrie de l'application reste avec son application RUM, et l'appareil ne devient pas un hôte dans **Hôtes** : une application ne signale aucune métrique d'hôte, il n'y aurait donc rien à y montrer. La page de l'appareil dans **Inventaire** montre ses propres journaux, traces et exceptions, et `@resource.host.name:` les retrouve dans **Traces** et **Journaux**. Un appareil qui n'envoie rien pendant 30 jours quitte **Inventaire**. Pour voir l'appareil lui-même, sa mémoire, son stockage et ses redémarrages, ainsi que les plantages de chaque application qui y tourne, ajoutez l'[Agent Android](/docs/telemetry/android-agent) et donnez-lui le même nom dans son `device_name` : l'appareil est alors aussi un hôte dans **Hôtes**, et toujours un seul élément dans **Inventaire**.

### Être prévenu quand un appareil se tait

La page **Recommandations** de l'application propose **Device Stopped Reporting** : une alerte pour chaque appareil qui n'envoie aucun span pendant une heure après en avoir envoyé au cours de la semaine écoulée, les appareils étant distingués par l'`app.installation.id` que définit l'agent. L'alerte de chaque appareil le nomme par le `host.name` que portaient ses derniers spans, comme dans [Nommer chaque appareil](#nommer-chaque-appareil), et par son modèle, avec son installation à côté ; un appareil qui n'envoie aucun `host.name` est nommé par sa seule installation. Renommer un appareil ne change que ce que dit son alerte : c'est toujours un seul appareil, avec une seule alerte, qui se résout dès que l'appareil envoie de nouveau des données. Quand tous les appareils se taisent en même temps, par exemple quand le réseau d'un magasin tombe, aucun appareil n'alerte : **App Stopped Reporting** le signale une seule fois pour toute l'application.

Une borne laissée sur un écran n'envoie rien tant que personne ne l'utilise. Envoyez un span toutes les quelques minutes pendant que l'application tourne, pour qu'une borne inactive ne soit pas prise pour une borne qui s'est tue :

```kotlin title="KioskHeartbeat.kt"
import android.os.Handler
import android.os.Looper
import io.opentelemetry.api.trace.Tracer

class KioskHeartbeat(private val tracer: Tracer) {
    private val handler = Handler(Looper.getMainLooper())

    private val beat = object : Runnable {
        override fun run() {
            tracer.spanBuilder("kiosk.heartbeat").startSpan().end()
            handler.postDelayed(this, 5 * 60 * 1000L)
        }
    }

    fun start() = handler.post(beat)

    fun stop() = handler.removeCallbacks(beat)
}
```

Démarrez-le une fois l'agent démarré, avec `KioskHeartbeat(otelRum.openTelemetry.getTracer("kiosk.heartbeat")).start()`. Avec un span toutes les cinq minutes, une borne qui fonctionne reste largement en deçà de l'heure.

### Configurer le parc depuis votre MDM

Une application peut lire les configurations gérées d'Android, que tout service de gestion d'appareils envoie à ses appareils. Lisez-y la clé et le nom de l'appareil, au lieu de les intégrer à l'application :

```kotlin title="KioskApplication.kt"
import android.content.RestrictionsManager

val restrictions = (getSystemService(RESTRICTIONS_SERVICE) as RestrictionsManager)
    .applicationRestrictions
val token = restrictions.getString("oneuptime_token").orEmpty()
val deviceName = restrictions.getString("device_name") ?: android.os.Build.MODEL
val serialNumber = restrictions.getString("device_serial").orEmpty()
```

Passez ensuite `token` à `baseHeaders` à la place de `BuildConfig.ONEUPTIME_TOKEN`, et `deviceName` et `serialNumber` à la ressource ci-dessus. Dans Esper, collez la configuration ci-dessous sous **Managed Configuration** de l'application, dans un blueprint. Esper remplit les espaces réservés sur chaque appareil, avec Esper Agent 8.00.0764 ou ultérieur :

```json title="Managed configuration"
{
  "oneuptime_token": "YOUR_TELEMETRY_INGESTION_TOKEN",
  "device_name": "${esper.deviceName}",
  "device_serial": "${esper.serialNumber}"
}
```

Après une modification, lancez un Converge des appareils pour qu'ils lisent les nouvelles valeurs. Déclarez les mêmes clés dans un `app_restrictions.xml` si votre MDM demande un schéma. Esper refuse un APK sans signature v1 : signez donc la version avec le schéma v1 en plus de v2 ou v3.

### Importer le parc depuis Esper

Connectez votre tenant Esper à l'inventaire, et chaque appareil qu'enrôle Esper est listé, y compris les appareils dont l'application n'a jamais démarré, avec ce que seul Esper sait : son groupe, sa version d'Android, son niveau de correctif de sécurité, son numéro de série, sa batterie, son stockage, ses applications installées et son dernier contact. Un appareil qui cesse de contacter Esper apparaît hors ligne, avec le temps écoulé depuis son dernier contact. Voir [Importer des appareils depuis Esper](/docs/inventory/overview#importer-des-appareils-depuis-esper).

Un appareil que son application nomme comme ci-dessus ne forme qu'un seul élément avec ce que l'application envoie : `host.name` est son nom dans Esper. OneUptime trouve l'élément d'un appareil par `host.name`, puis par `host.serial_number` : donnez donc à chaque appareil le même nom et le même numéro de série dans chaque application qui envoie des données depuis cet appareil, ainsi que dans les paramètres `device_name` et `device_serial` de l'Agent Android.

### Conserver ce qui est enregistré hors ligne

L'agent écrit chaque span, journal et métrique sur le disque avant de l'envoyer. Tant que le réseau est coupé, il les y garde, et les envoie dès qu'il revient, jusqu'à 18 heures plus tard. Il conserve 10 Mo ; augmentez cette valeur pour un appareil souvent hors ligne :

```kotlin title="KioskApplication.kt"
diskBuffering {
    maxCacheSize = 50 * 1024 * 1024
}
```

## Dépannage

:::details L'application apparaît sous Services au lieu de Surveillance des utilisateurs réels
OpenTelemetry Android définit `device.model.identifier` lui-même : l'application a donc été configurée avec un autre SDK, ou sa ressource a été remplacée par `resource(Resource)`, ce qui supprime les attributs propres à l'agent. Utilisez le bloc `resource { }`, qui s'y ajoute. Le service déjà créé ne devient pas une application RUM : supprimez-le sous **Produits → Services** dès que la télémétrie RUM arrive.
:::

:::details Rien n'arrive, ou la clé est refusée
Lancez la vérification de la clé décrite dans [Ajouter OpenTelemetry Android](#ajouter-opentelemetry-android). Un `401` signifie que la clé est inconnue, révoquée, désactivée ou expirée. Une clé **Navigateur** est refusée depuis une application : utilisez une clé **Serveur**. Vérifiez que `baseUrl` se termine par `/otlp`, sans `/v1/traces` : l'agent ajoute le chemin lui-même.
:::

:::details Un plantage ou un ANR n'apparaît pas dans Exceptions
Un plantage est enregistré au moment où l'application meurt, et un ANR dès que le thread principal est bloqué depuis environ 5 secondes. Les deux attendent sur le disque que l'appareil puisse les envoyer : regardez donc à nouveau une fois que l'application a tourné une minute avec un réseau. Démarrez l'agent tout au début du `onCreate` de votre `Application`, avant tout ce qui peut planter, pour que son gestionnaire de plantages soit en place en premier.
:::

:::details Un appareil manque dans Inventaire
Seul un appareil dont l'application définit `host.name` est listé. Vérifiez la valeur dans les attributs de ressource d'un span : une valeur vide ne nomme aucun appareil, et deux appareils portant le même nom forment une seule ligne.
:::

## Prochaines étapes

:::cards
- [Configuration mobile](/docs/rum/mobile-setup): iOS, React Native et les autres plateformes.
- [Agent Android](/docs/telemetry/android-agent): Surveiller l'appareil lui-même : son état de santé, ses redémarrages, ses applications installées et les plantages de chaque application.
- [Exceptions](/docs/telemetry/exceptions): Trier les plantages et les ANR que signale votre application.
- [Explorateur de traces](/docs/telemetry/traces-explorer): Suivre une commande de la borne jusqu'à la cuisine.
- [Gérer les applications](/docs/rum/applications): Noms, étiquettes, propriétaires et rétention.
:::
