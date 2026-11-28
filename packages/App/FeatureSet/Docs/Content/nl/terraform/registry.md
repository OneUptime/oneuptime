# Registergebruik

De OneUptime-provider wordt gepubliceerd in het [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) en het [OpenTofu Registry](https://search.opentofu.org/provider/oneuptime/oneuptime/latest). `terraform init` en `tofu init` downloaden hem daarvandaan: er is niets met de hand te installeren. Deze pagina behandelt wat er wordt gepubliceerd, hoe versies worden genummerd, en hoe je naar een nieuwere overstapt.

:::cards
- [Wat er wordt gepubliceerd](#wat-er-wordt-gepubliceerd): De provider voor elk platform, zijn referentie en zijn versies.
- [Hoe versies worden genummerd](#hoe-versies-worden-genummerd): De versie van een provider is de OneUptime-release die hem publiceerde.
- [Het lockbestand](#het-lockbestand): De versie en checksums die elke machine installeert.
- [Naar een nieuwere versie overstappen](#naar-een-nieuwere-versie-overstappen): Lees wat er veranderde, download haar en plan.
- [De checksums van een versie controleren](#de-checksums-van-een-versie-controleren): Controleer een versie met de hand, zoals `init` haar controleert.
:::

## Wat er wordt gepubliceerd

Elke OneUptime-release genereert de provider uit de eigen API van OneUptime. Wanneer de provider veranderde, publiceert de release hem, onder de versie van de release, zodra hij zijn end-to-endtests onder Terraform en onder OpenTofu heeft doorstaan:

```mermaid title="Van een OneUptime-release naar je terraform init"
flowchart TB
    R["Een OneUptime-release"] --> G["De provider wordt gegenereerd<br/>uit de API van OneUptime"]
    G --> C{"Is de provider<br/>veranderd?"}
    C -->|"ja"| P["Getest onder Terraform<br/>en OpenTofu, daarna<br/>gepubliceerd met de<br/>versie van de release"]
    C -->|"nee"| N["Geen providerversie<br/>voor deze release"]
    P --> I["terraform init<br/>en tofu init<br/>downloaden hem"]
```

| Wat | Waar |
| --- | --- |
| De provider, voor Linux, macOS, Windows, FreeBSD, OpenBSD en Solaris | Gedownload door `terraform init` en `tofu init`, met checksums die OneUptime ondertekent |
| De referentie van elke resource en data source, met elk van hun attributen | De documentatie van het register, gegroepeerd per product: monitoren, statuspagina's, incidenten, on-call en de andere |
| Een handleiding voor het gebruik van de provider met OpenTofu | De handleidingen van het register |
| Elke versie, de nieuwste eerst | De versielijst van het register |

De referentie zegt wat elk attribuut is. Deze documentatie laat zien hoe je ze samen gebruikt: begin bij [Terraform – Overzicht](/docs/terraform/index).

## Hoe versies worden genummerd

De versie van een provider is de versie van de OneUptime-release die hem publiceerde: provider {{TERRAFORM_PROVIDER_MAJOR}}.0.20 kwam met OneUptime {{TERRAFORM_PROVIDER_MAJOR}}.0.20. Een release waarvan de provider niet veranderde, publiceert er geen, dus de versies hebben gaten, en een beperking die één exacte versie noemt, kan een versie noemen die niet bestaat. Schrijf in plaats daarvan een bereik:

| Je gebruikt | Beperking | Terraform installeert |
| --- | --- | --- |
| OneUptime Cloud | `{{TERRAFORM_PROVIDER_VERSION}}` | De nieuwste {{TERRAFORM_PROVIDER_MAJOR}}.x-provider |
| Een zelf gehoste OneUptime | Een bereik dat eindigt bij de versie van je OneUptime, zoals `>= {{TERRAFORM_PROVIDER_MAJOR}}.0, <= {{TERRAFORM_PROVIDER_MAJOR}}.0.40` | De nieuwste provider die niet nieuwer is dan je OneUptime |

Op een zelf gehoste OneUptime kan een provider die nieuwer is dan je OneUptime instellingen sturen die je OneUptime nog niet heeft: [Zelf gehoste installatie](/docs/terraform/self-hosted#de-providerversie-kiezen) laat zien hoe je het bereik ervan schrijft.

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

Het bronadres noemt geen register: Terraform leest het uit het Terraform Registry, en OpenTofu uit het OpenTofu Registry, die dezelfde versies publiceren.

Een gepubliceerde versie verandert nooit: de registers bewaren de checksums van wat ze het eerst downloadden, en `init` controleert elke download daartegen. Een versie die hersteld moet worden, wordt opnieuw gepubliceerd als de volgende patchversie, die een bereik meeneemt, en de notities van die release zeggen welke versie ze vervangt.

Na elke publicatie van een versie, en daarna elke dag, vergelijkt OneUptime de checksums die beide registers bewaren met de bestanden die de release levert, voor elk platform.

## Het lockbestand

`terraform init` legt de versie die het koos, en de checksums van zijn downloads, vast in `.terraform.lock.hcl`. Commit dat bestand: elke machine en elke CI-run installeert dan precies die versie, tot je een andere kiest. De checksums dekken elk platform dat het register publiceert, dus één lockbestand werkt voor Linux-, macOS- en Windows-machines tegelijk.

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

Het lockbestand noemt het register. OpenTofu schrijft `registry.opentofu.org/oneuptime/oneuptime` waar Terraform `registry.terraform.io/oneuptime/oneuptime` schrijft, dus van engine wisselen wijzigt het lockbestand: `init` vervangt de vermelding, en vraagt je de wijziging te committen.

## Naar een nieuwere versie overstappen

:::steps
### Lezen wat er veranderde

[De releases van OneUptime](https://github.com/OneUptime/oneuptime/releases) zeggen wat elke release veranderde, de provider inbegrepen. [De releases van de provider](https://github.com/OneUptime/terraform-provider-oneuptime/releases) zeggen wat elke release aan de provider veranderde: eerst wat een configuratie breekt, dan de nieuwe resources en data sources, en de attributen die veranderden.

### Haar downloaden

```bash
terraform init -upgrade
```

`init -upgrade` neemt de nieuwste versie die je beperking toestaat, toont die en werkt `.terraform.lock.hcl` bij. De beperking `{{TERRAFORM_PROVIDER_VERSION}}` neemt elke {{TERRAFORM_PROVIDER_MAJOR}}.x-release; een nieuwe hoofdversie vraagt een nieuwe beperking.

### Plannen voordat je toepast

Voer `terraform plan` uit, en pas alleen toe wanneer het leeg is of de wijzigingen toont die je verwacht. Commit het bijgewerkte lockbestand.
:::

Upgrade op een zelf gehoste OneUptime eerst OneUptime, en verhoog daarna het einde van het bereik van de provider.

## De checksums van een versie controleren

`init` installeert een versie alleen als drie SHA-256-checksums voor je platform overeenkomen: die het register bewaarde toen de versie werd gepubliceerd, de regel van de zip in de `SHA256SUMS` van de release, en de zip zelf. Het controleert ook dat `SHA256SUMS` is ondertekend met de sleutel van OneUptime, waarvan de vingerafdruk eindigt op `9D87 E494 AC01 6697`. Om een versie zelf te controleren, zet je op de eerste regel haar versie, je systeem en je architectuur:

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

De drie checksums die het toont, moeten gelijk zijn, en `gpg` moet `Good signature from "OneUptime <key@oneuptime.com>"` zeggen. Schrijf op macOS `shasum -a 256` in plaats van `sha256sum`. Als de checksum van het register afwijkt van de andere twee, weigert `init` de versie: zie [Een versie waarvan de checksums niet kloppen](/docs/terraform/troubleshooting#een-versie-waarvan-de-checksums-niet-kloppen).

Het register van OpenTofu bewaart dezelfde checksums: lees zijn eigen checksum af bij `https://registry.opentofu.org/v1/providers/oneuptime/oneuptime/$VERSION/download/$OS/$ARCH`. Het heeft geen sleutel voor de provider, dus `tofu init` controleert de checksums en slaat de handtekening over.

## Waar de code staat

De provider wordt gegenereerd uit de OneUptime-API in de [hoofdrepository van OneUptime](https://github.com/OneUptime/oneuptime), en elke versie wordt gebouwd vanuit de release die hem publiceerde. Zijn eigen repository, [OneUptime/terraform-provider-oneuptime](https://github.com/OneUptime/terraform-provider-oneuptime), bevat wat de generator schreef, dus wijzigingen gebeuren in de hoofdrepository: meld problemen, ook die in de documentatie, op [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues).

## Volgende stappen

:::cards
- [Zelf gehoste installatie](/docs/terraform/self-hosted): Het versiebereik voor je eigen OneUptime, en een mirror voor offline machines.
- [OpenTofu](/docs/terraform/opentofu): Dezelfde provider en configuratie, met `tofu`.
- [Volledige handleiding](/docs/terraform/complete-guide): Authenticatie, projectindeling, data sources, state en upgrades.
- [Probleemoplossing](/docs/terraform/troubleshooting): Veelvoorkomende fouten en hoe je ze oplost.
:::
