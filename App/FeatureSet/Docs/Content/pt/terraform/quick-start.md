# Guia de Início Rápido do Provedor Terraform

Este guia ajudará você a começar a usar o Provedor Terraform do OneUptime em apenas alguns minutos.

## Pré-requisitos

- Terraform >= 1.0 instalado
- Conta do OneUptime (Cloud ou Auto-Hospedado)
- Chave de API do OneUptime

## Passo 1: Criar Chave de API

### Para o OneUptime Cloud

1. Vá para [OneUptime Cloud](https://oneuptime.com) e faça login
2. Navegue para **Settings** → **API Keys**
3. Clique em **Create API Key**
4. Nomeie como "Provedor Terraform"
5. Selecione as permissões necessárias
6. Copie a chave de API gerada

### Para o OneUptime Auto-Hospedado

1. Acesse sua instância do OneUptime
2. Navegue para **Settings** → **API Keys**
3. Clique em **Create API Key**
4. Nomeie como "Provedor Terraform"
5. Selecione as permissões necessárias
6. Copie a chave de API gerada

## Passo 2: Criar Configuração Terraform

Crie um novo diretório e arquivo `main.tf`:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Para clientes Cloud
      version = "~> 7.0"

      # Para clientes Auto-Hospedados - fixe na sua versão exata
      # version = "= 7.0.123"  # Substitua pela sua versão do OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Para clientes Cloud
  oneuptime_url = "https://oneuptime.com"

  # Para clientes Auto-Hospedados - use a URL da sua instância
  # oneuptime_url = "https://oneuptime.suaempresa.com"

  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "Chave de API do OneUptime"
  type        = string
  sensitive   = true
}

# Nota: Projetos devem ser criados manualmente no painel do OneUptime
# Use o ID do projeto existente aqui
variable "project_id" {
  description = "ID do projeto OneUptime"
  type        = string
}

# Criar um monitor de site simples
resource "oneuptime_monitor" "website" {
  name        = "Monitor de Site"
  description = "Monitor para uptime do site"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Exibir o ID do monitor
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Passo 3: Criar Arquivo de Variáveis

Crie `terraform.tfvars`:

```hcl
# terraform.tfvars
oneuptime_api_key = "sua-chave-de-api-aqui"
project_id        = "seu-id-de-projeto-aqui"  # Obtenha isso do painel do OneUptime
```

**Importante**: Adicione `terraform.tfvars` ao seu `.gitignore` para manter as chaves de API seguras!

## Passo 4: Inicializar e Aplicar

```bash
# Inicializar o Terraform
terraform init

# Planejar a implantação
terraform plan

# Aplicar a configuração
terraform apply
```

## Passo 5: Verificar Recursos

1. Verifique seu painel do OneUptime
2. Vá para o projeto existente
3. Verifique se o "Monitor de Site" foi criado e está em execução

## Próximas Etapas

1. **Explore Mais Recursos**: Verifique a [documentação completa](./README.md) para todos os recursos disponíveis
2. **Configure Alertas**: Adicione políticas de alerta e canais de notificação
3. **Crie Páginas de Status**: Configure páginas de status públicas para seus serviços
4. **Organize com Equipes**: Crie equipes e atribua permissões

## Exemplos Específicos de Versão

### Clientes Cloud (Versão Mais Recente)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Sempre obtém a versão 7.x compatível mais recente
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Clientes Auto-Hospedados (Versão Fixada)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Deve corresponder à sua versão do OneUptime exatamente
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.suaempresa.com"  # Sua URL auto-hospedada
  api_key       = var.oneuptime_api_key
}
```

## Solução de Problemas do Início Rápido

### Problema: Provedor não encontrado

```
Error: Failed to query available provider packages
```

**Solução**: Execute `terraform init` para baixar o provedor

### Problema: Autenticação falhou

```
Error: Invalid API key
```

**Solução**:

1. Verifique sua chave de API no painel do OneUptime
2. Verifique se a chave de API tem permissões suficientes
3. Certifique-se de que `oneuptime_url` está correto para sua instância

### Problema: Incompatibilidade de versão (Auto-Hospedado)

```
Error: API version incompatible
```

**Solução**:

1. Verifique sua versão do OneUptime no painel
2. Atualize a versão do provedor para corresponder exatamente
3. Execute `terraform init -upgrade`

## Limpeza

Para remover todos os recursos criados neste início rápido:

```bash
terraform destroy
```

Isso excluirá o monitor e o projeto criados durante o início rápido.
