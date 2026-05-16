# Terraform-leverandørdokumentasjon

OneUptime Terraform-leverandøren muliggjør Infrastructure as Code (IaC)-administrasjon av OneUptime-overvåkings-, varslings- og observerbarhetressurser.

## Dokumentasjonsseksjoner

### [Kom i gang](./quick-start.md)
Rask oppsettguide for å komme i gang med OneUptime Terraform-leverandøren på noen minutter.

### [Komplett leverandørguide](./README.md)
Omfattende dokumentasjon som dekker installasjon, konfigurasjon, ressurser og beste praksis.

### [Selvhostet konfigurasjon](./self-hosted.md)
**Kritisk for selvhostede kunder**: Versjonsfesting, kompatibilitet og distribusjonsstrategier.

### [Eksempler](./examples.md)
Eksempler og mønstre fra den virkelige verden for vanlige OneUptime Terraform-konfigurasjoner.

## Hurtiglenker

### For OneUptime Cloud-kunder
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### For selvhostede kunder
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Må samsvare med din OneUptime-versjon
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Viktig for selvhostede brukere

**Versjonskompatibilitet er kritisk**: Fest alltid Terraform-leverandørversjonen til å samsvare nøyaktig med din OneUptime-installasjonsversjon. Uoverensstemmende versjoner kan forårsake API-kompatibilitetsproblemer.

## Eksterne ressurser

- **Terraform Registry**: [OneUptime-leverandør](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Repository**: [OneUptime kildekode](https://github.com/OneUptime/oneuptime)
- **Community Support**: [OneUptime Community](https://community.oneuptime.com)

## Tilgjengelige ressurser

Leverandøren støtter omfattende OneUptime-ressursadministrasjon:

- **Prosjekter og team**: Organiser overvåkingsstrukturen din
- **Monitorer**: Nettsted-, API-, port-, hjerteslag- og egendefinerte monitorer
- **Hendelseshåndtering**: Varselspolicyer, vaktplaner, eskaleringer
- **Statussider**: Offentlige og private statussider med egendefinert merkevarebygging
- **Tjenestekatalog**: Tjenestedefinisjoner og avhengighetskartlegging
- **Arbeidsflyter**: Automatiserte respons- og utbedringsarbeidsflyter

## Støtte

For problemer, spørsmål eller bidrag:

1. **Dokumentasjonsproblemer**: Opprett en sak i [OneUptime-repositoriet](https://github.com/OneUptime/oneuptime/issues)
2. **Leverandørfeil**: Rapporter i det sentrale OneUptime-repositoriet
3. **Funksjonsforespørsler**: Diskuter i OneUptime-community
4. **Generelle spørsmål**: Bruk community-forumene

## Neste trinn

1. **Nye brukere**: Start med [hurtigstartguiden](./quick-start.md)
2. **Selvhostet**: Se gjennom [selvhostet konfigurasjon](./self-hosted.md)
3. **Avanserte brukere**: Utforsk [eksempler](./examples.md) for komplekse oppsett
4. **Fullstendig referanse**: Sjekk den [fullstendige guiden](./README.md) for alle funksjoner
