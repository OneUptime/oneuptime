# Registerbrug

OneUptime-provideren udgives i [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) og [OpenTofu Registry](https://search.opentofu.org/provider/oneuptime/oneuptime/latest). `terraform init` og `tofu init` henter den derfra: der er intet at installere i hånden. Denne side dækker, hvad der udgives, hvordan versioner nummereres, og hvordan du skifter til en nyere.

:::cards
- [Hvad der udgives](#hvad-der-udgives): Provideren til hver platform, dens reference og dens versioner.
- [Hvordan versioner nummereres](#hvordan-versioner-nummereres): En providers version er den OneUptime-release, der udgav den.
- [Låsefilen](#låsefilen): Den version og de checksums, hver maskine installerer.
- [Skift til en nyere version](#skift-til-en-nyere-version): Læs, hvad der ændrede sig, hent den, og planlæg.
- [Kontrollér en versions checksums](#kontrollér-en-versions-checksums): Tjek en version i hånden, som `init` tjekker den.
:::

## Hvad der udgives

Hver OneUptime-release genererer provideren ud fra OneUptimes eget API. Når provideren har ændret sig, udgiver releasen den, under releasens version, når den har bestået sine end-to-end-test under Terraform og under OpenTofu:

```mermaid title="Fra en OneUptime-release til din terraform init"
flowchart TB
    R["En OneUptime-release"] --> G["Provideren genereres<br/>ud fra OneUptimes API"]
    G --> C{"Har provideren<br/>ændret sig?"}
    C -->|"ja"| P["Testet under Terraform<br/>og OpenTofu, derefter<br/>udgivet med<br/>releasens version"]
    C -->|"nej"| N["Ingen providerversion<br/>for denne release"]
    P --> I["terraform init<br/>og tofu init<br/>henter den"]
```

| Hvad | Hvor |
| --- | --- |
| Provideren, til Linux, macOS, Windows, FreeBSD, OpenBSD og Solaris | Hentes af `terraform init` og `tofu init`, med checksums, som OneUptime signerer |
| Referencen for hver ressource og datakilde, med hver af dens attributter | Registrets dokumentation, grupperet efter produkt: monitorer, statussider, hændelser, vagter og de andre |
| En vejledning i at bruge provideren med OpenTofu | Registrets vejledninger |
| Hver version, nyeste først | Registrets versionsliste |

Referencen fortæller, hvad hver attribut er. Denne dokumentation viser, hvordan du bruger dem sammen: start fra [Terraform – Oversigt](/docs/terraform/index).

## Hvordan versioner nummereres

En providers version er versionen af den OneUptime-release, der udgav den: provider {{TERRAFORM_PROVIDER_MAJOR}}.0.20 kom med OneUptime {{TERRAFORM_PROVIDER_MAJOR}}.0.20. En release, hvis provider ikke ændrede sig, udgiver ingen, så versionerne har huller, og en begrænsning, der nævner én præcis version, kan nævne en version, der ikke findes. Skriv i stedet et interval:

| Du bruger | Begrænsning | Terraform installerer |
| --- | --- | --- |
| OneUptime Cloud | `{{TERRAFORM_PROVIDER_VERSION}}` | Den nyeste {{TERRAFORM_PROVIDER_MAJOR}}.x-provider |
| En selv-hostet OneUptime | Et interval, der slutter ved din OneUptimes version, som `>= {{TERRAFORM_PROVIDER_MAJOR}}.0, <= {{TERRAFORM_PROVIDER_MAJOR}}.0.40` | Den nyeste provider, der ikke er nyere end din OneUptime |

På en selv-hostet OneUptime kan en provider, der er nyere end din OneUptime, sende indstillinger, som din OneUptime endnu ikke har: [Selv-hostet opsætning](/docs/terraform/self-hosted#vælg-providerversionen) viser, hvordan du skriver dens interval.

```hcl title="main.tf"
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "{{TERRAFORM_PROVIDER_VERSION}}"
    }
  }
}
```

Kildeadressen nævner intet register: Terraform læser den fra Terraform Registry, og OpenTofu fra OpenTofu Registry, som udgiver de samme versioner.

En udgivet version ændres aldrig: registrene gemmer checksums for det, de først hentede, og `init` tjekker hver download mod dem. En version, der skal rettes, udgives igen som den næste patchversion, som et interval tager med, og den releases noter siger, hvilken version den erstatter.

Efter hver version er udgivet, og igen hver dag, sammenligner OneUptime de checksums, som begge registre gemmer, med de filer, releasen leverer, for hver platform.

## Låsefilen

`terraform init` registrerer den version, den valgte, og checksums for dens downloads i `.terraform.lock.hcl`. Commit den fil: hver maskine og hver CI-kørsel installerer så præcis den version, indtil du vælger en anden. Checksums dækker hver platform, registret udgiver, så én låsefil fungerer lige godt for Linux-, macOS- og Windows-maskiner.

```hcl title=".terraform.lock.hcl"
provider "registry.terraform.io/oneuptime/oneuptime" {
  version     = "{{TERRAFORM_PROVIDER_MAJOR}}.0.20"
  constraints = "{{TERRAFORM_PROVIDER_VERSION}}"
  hashes = [
    "h1:...",
    "zh:...",
  ]
}
```

Låsefilen nævner registret. OpenTofu skriver `registry.opentofu.org/oneuptime/oneuptime`, hvor Terraform skriver `registry.terraform.io/oneuptime/oneuptime`, så et skift af værktøj ændrer låsefilen: `init` erstatter posten og beder dig committe ændringen.

## Skift til en nyere version

:::steps
### Læs, hvad der ændrede sig

[OneUptimes releases](https://github.com/OneUptime/oneuptime/releases) siger, hvad hver release ændrede, provideren inklusive. [Providerens releases](https://github.com/OneUptime/terraform-provider-oneuptime/releases) siger, hvad hver enkelt ændrede i provideren: først hvad der bryder en konfiguration, derefter de nye ressourcer og datakilder og de attributter, der ændrede sig.

### Hent den

```bash
terraform init -upgrade
```

`init -upgrade` tager den nyeste version, din begrænsning tillader, viser den og opdaterer `.terraform.lock.hcl`. Begrænsningen `{{TERRAFORM_PROVIDER_VERSION}}` tager hver {{TERRAFORM_PROVIDER_MAJOR}}.x-release; en ny hovedversion kræver en ny begrænsning.

### Planlæg, før du anvender

Kør `terraform plan`, og anvend kun, når den er tom eller viser de ændringer, du forventer. Commit den opdaterede låsefil.
:::

På en selv-hostet OneUptime skal du opgradere OneUptime først og derefter hæve slutningen af providerens interval.

## Kontrollér en versions checksums

`init` installerer kun en version, når tre SHA-256-checksums stemmer overens for din platform: den, registret gemte, da versionen blev udgivet, zip-filens linje i releasens `SHA256SUMS` og selve zip-filen. Den tjekker også, at `SHA256SUMS` er signeret med OneUptimes nøgle, hvis fingeraftryk ender på `9D87 E494 AC01 6697`. For at tjekke en version selv skal du sætte dens version, dit system og din arkitektur på første linje:

```bash
VERSION=17.3.0 OS=linux ARCH=amd64
ZIP=terraform-provider-oneuptime_${VERSION}_${OS}_${ARCH}.zip
SUMS=terraform-provider-oneuptime_${VERSION}_SHA256SUMS
curl -s https://registry.terraform.io/v1/providers/oneuptime/oneuptime/$VERSION/download/$OS/$ARCH > registry.json
jq -r .shasum registry.json
curl -sLO "https://github.com/OneUptime/terraform-provider-oneuptime/releases/download/v$VERSION/$ZIP"
curl -sLO "https://github.com/OneUptime/terraform-provider-oneuptime/releases/download/v$VERSION/$SUMS"
curl -sLO "https://github.com/OneUptime/terraform-provider-oneuptime/releases/download/v$VERSION/$SUMS.sig"
grep "$ZIP" "$SUMS"
sha256sum "$ZIP"
jq -r '.signing_keys.gpg_public_keys[0].ascii_armor' registry.json | gpg --import
gpg --verify "$SUMS.sig" "$SUMS"
```

De tre checksums, den udskriver, skal være ens, og `gpg` skal sige `Good signature from "OneUptime <key@oneuptime.com>"`. På macOS skriver du `shasum -a 256` i stedet for `sha256sum`. Når registrets checksum afviger fra de to andre, afviser `init` versionen: se [En version, hvis checksums ikke passer](/docs/terraform/troubleshooting#en-version-hvis-checksums-ikke-passer).

OpenTofus register gemmer de samme checksums: læs dets eget på `https://registry.opentofu.org/v1/providers/oneuptime/oneuptime/$VERSION/download/$OS/$ARCH`. Det har ingen nøgle til provideren, så `tofu init` tjekker checksums og springer signaturen over.

## Hvor koden bor

Provideren genereres ud fra OneUptime-API'et i [OneUptimes hovedrepositorie](https://github.com/OneUptime/oneuptime), og hver version bygges fra den release, der udgav den. Dens eget repositorie, [OneUptime/terraform-provider-oneuptime](https://github.com/OneUptime/terraform-provider-oneuptime), indeholder det, generatoren skrev, så ændringer laves i hovedrepositoriet: rapportér problemer, også dem i dokumentationen, på [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues).

## Næste skridt

:::cards
- [Selv-hostet opsætning](/docs/terraform/self-hosted): Versionsintervallet for din egen OneUptime, og et spejl til offline-maskiner.
- [OpenTofu](/docs/terraform/opentofu): Den samme provider og konfiguration, med `tofu`.
- [Komplet vejledning](/docs/terraform/complete-guide): Godkendelse, projektopbygning, datakilder, state og opgraderinger.
- [Fejlfinding](/docs/terraform/troubleshooting): Almindelige fejl, og hvordan du retter dem.
:::
