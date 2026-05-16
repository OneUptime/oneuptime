# Guida all'Installazione e Utilizzo dal Registro Terraform

## Installazione dal Registro Terraform

Il Provider Terraform OneUptime è disponibile nel [Registro Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime) ufficiale.

### Per gli Utenti OneUptime Cloud

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Usa la versione compatibile più recente
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Per gli Utenti OneUptime Self-Hosted

⚠️ **Critico**: I clienti self-hosted devono bloccare la versione del provider per corrispondere esattamente alla propria installazione OneUptime.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Sostituire con la propria versione esatta OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.vostracompany.com"  # Il proprio URL self-hosted
  api_key       = var.oneuptime_api_key
}
```

## Perché il Blocco della Versione per Self-Hosted?

Il provider Terraform OneUptime viene generato automaticamente dalla specifica API di OneUptime. Ogni versione di OneUptime può avere:

- Endpoint API diversi
- Schemi delle risorse aggiornati
- Funzionalità nuove o rimosse
- Regole di validazione modificate

L'uso di una versione del provider che non corrisponde all'installazione OneUptime può causare:
- Errori di compatibilità API
- Fallimenti nella creazione/aggiornamento delle risorse
- Comportamento imprevisto
- Deriva dello stato delle risorse

## Trovare la Propria Versione OneUptime

### Metodo 1: Dashboard
1. Effettuare il login nel proprio dashboard OneUptime
2. Accedere a **Impostazioni** → **Informazioni**
3. Annotare il numero di versione (ad es. "7.0.123")

### Metodo 2: API
```bash
curl https://vostra-istanza-oneuptime.com/api/version | jq '.version'
```

### Metodo 3: Docker
```bash
docker images | grep oneuptime
# Cercare il tag, ad es. oneuptime/dashboard:7.0.123
```

## Informazioni sul Registro Provider

- **URL Registro**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Repository Sorgente**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Documentazione**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Versioni**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Matrice di Compatibilità Versioni

| Versione OneUptime | Versione Provider | Configurazione Terraform |
|-------------------|------------------|------------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| Cloud Più Recente | Provider Più Recente | `version = "~> 7.0"` |

## Esempio Avvio Rapido

```hcl
# Configurare il provider
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Aggiustare per self-hosted
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Aggiustare per self-hosted
  api_key       = var.oneuptime_api_key
}

# Creare un progetto
resource "oneuptime_project" "example" {
  name        = "Esempio Terraform"
  description = "Creato con Terraform"
}

# Creare un monitor sito web
resource "oneuptime_monitor" "website" {
  name       = "Monitor Sito Web"
  project_id = oneuptime_project.example.id
  
  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"
  
  tags = {
    managed_by = "terraform"
  }
}
```

## Passi di Installazione

1. **Creare la propria configurazione Terraform** con il blocco provider
2. **Inizializzare Terraform**: `terraform init`
3. **Impostare la propria chiave API**: Creare `terraform.tfvars` con la chiave API
4. **Pianificare la distribuzione**: `terraform plan`
5. **Applicare la configurazione**: `terraform apply`

## Ottenere Aiuto

- **Documentazione Completa**: Vedere la [documentazione terraform completa](./README.md)
- **Guida Self-Hosted**: Consultare la [guida alla configurazione self-hosted](./self-hosted.md)
- **Esempi**: Sfogliare gli [esempi di configurazione](./examples.md)
- **Avvio Rapido**: Seguire la [guida rapida](./quick-start.md)

## Aggiornamenti del Registro

Il provider viene pubblicato automaticamente nel Registro Terraform quando vengono rilasciate nuove versioni di OneUptime. I clienti Cloud possono usare il versioning semantico (`~> 7.0`) per ricevere automaticamente aggiornamenti compatibili, mentre i clienti self-hosted dovrebbero bloccare alle versioni esatte.
