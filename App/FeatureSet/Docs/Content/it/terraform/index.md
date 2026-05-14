# Documentazione Provider Terraform

Il Provider Terraform OneUptime consente la gestione tramite Infrastructure as Code (IaC) del proprio monitoraggio, avvisi e risorse di osservabilità OneUptime.

## Sezioni della Documentazione

### [Per Iniziare](./quick-start.md)
Guida rapida di configurazione per iniziare con il Provider Terraform OneUptime in pochi minuti.

### [Guida Completa al Provider](./README.md)
Documentazione completa che copre installazione, configurazione, risorse e buone pratiche.

### [Configurazione Self-Hosted](./self-hosted.md)
**Critica per i clienti self-hosted**: Blocco della versione, compatibilità e strategie di distribuzione.

### [Esempi](./examples.md)
Esempi reali e pattern per le configurazioni Terraform OneUptime più comuni.

## Link Rapidi

### Per i Clienti OneUptime Cloud
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

### Per i Clienti Self-Hosted
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Deve corrispondere alla versione OneUptime
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.vostracompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Importante per gli Utenti Self-Hosted

**La Compatibilità delle Versioni è Critica**: Bloccare sempre la versione del provider Terraform per corrispondere esattamente alla versione dell'installazione OneUptime. Le versioni non corrispondenti possono causare problemi di compatibilità API.

## Risorse Esterne

- **Registro Terraform**: [Provider OneUptime](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **Repository GitHub**: [Codice Sorgente OneUptime](https://github.com/OneUptime/oneuptime)
- **Supporto Community**: [Community OneUptime](https://community.oneuptime.com)

## Risorse Disponibili

Il provider supporta la gestione completa delle risorse OneUptime:

- **Progetti e Team**: Organizzare la propria struttura di monitoraggio
- **Monitor**: Monitor sito web, API, porta, heartbeat e personalizzati
- **Gestione Incidenti**: Policy avvisi, pianificazioni on-call, escalation
- **Pagine di Stato**: Pagine di stato pubbliche e private con branding personalizzato
- **Catalogo Servizi**: Definizioni dei servizi e mappatura delle dipendenze
- **Workflow**: Risposta automatizzata e workflow di rimedio

## Supporto

Per problemi, domande o contributi:

1. **Problemi di Documentazione**: Creare un issue nel [repository OneUptime](https://github.com/OneUptime/oneuptime/issues)
2. **Bug del Provider**: Segnalare nel repository principale di OneUptime
3. **Richieste di Funzionalità**: Discutere nella community di OneUptime
4. **Domande Generali**: Usare i forum della community

## Prossimi Passi

1. **Nuovi Utenti**: Iniziare con la [Guida Rapida](./quick-start.md)
2. **Self-Hosted**: Esaminare la [Configurazione Self-Hosted](./self-hosted.md)
3. **Utenti Avanzati**: Esplorare gli [Esempi](./examples.md) per configurazioni complesse
4. **Riferimento Completo**: Consultare la [Guida Completa](./README.md) per tutte le funzionalità
