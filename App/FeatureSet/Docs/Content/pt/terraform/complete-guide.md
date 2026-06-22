# Provedor Terraform do OneUptime

O Provedor Terraform do OneUptime permite gerenciar recursos do OneUptime usando Infraestrutura como Código (IaC). Este provedor permite configurar monitoramento, gerenciamento de incidentes, páginas de status e outros recursos do OneUptime através do Terraform.

## Índice

- [Instalação](#instalação)
- [Configuração do Provedor](#configuração-do-provedor)
- [Início Rápido](#início-rápido)
- [Compatibilidade de Versões](#compatibilidade-de-versões)
- [Recursos Disponíveis](#recursos-disponíveis)
- [Exemplos](#exemplos)
- [Melhores Práticas](#melhores-práticas)
- [Guia de Migração](#guia-de-migração)

## Instalação

### Do Registro do Terraform (Recomendado)

O provedor Terraform do OneUptime está disponível no [Registro do Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use a versão 7.x mais recente
    }
  }
  required_version = ">= 1.0"
}
```

### Fixação de Versão para Instalações Auto-Hospedadas

⚠️ **Importante para Clientes Auto-Hospedados**: Sempre fixe a versão do provedor Terraform para corresponder à versão de instalação do OneUptime para garantir compatibilidade de API.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Fixe na versão exata que corresponde à sua instalação do OneUptime
    }
  }
  required_version = ">= 1.0"
}
```

#### Encontrando Sua Versão do OneUptime

Você pode encontrar sua versão do OneUptime de várias formas:

1. **Painel**: Vá para Settings → About no seu painel do OneUptime
2. **API**: Chame o endpoint `GET /api/status`
3. **Docker**: Verifique a tag da imagem que você está usando
4. **Helm**: Verifique a versão do seu Helm chart

```bash
# Exemplo: Se executando o OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Configuração do Provedor

### Configuração Básica

```hcl
provider "oneuptime" {
  oneuptime_url = "https://sua-instancia-oneuptime.com"  # Ou https://oneuptime.com para nuvem
  api_key       = var.oneuptime_api_key
}
```

### Variáveis de Ambiente

Você pode configurar o provedor usando variáveis de ambiente:

```bash
export ONEUPTIME_URL="https://sua-instancia-oneuptime.com"
export ONEUPTIME_API_KEY="sua-chave-de-api-aqui"
```

Em seguida, use o provedor sem configuração explícita:

```hcl
provider "oneuptime" {
  # A configuração será lida das variáveis de ambiente
}
```

### Opções de Configuração

| Argumento       | Variável de Ambiente | Descrição                 | Obrigatório |
| --------------- | -------------------- | ------------------------- | ----------- |
| `oneuptime_url` | `ONEUPTIME_URL`      | URL do OneUptime          | Sim         |
| `api_key`       | `ONEUPTIME_API_KEY`  | Chave de API do OneUptime | Sim         |

## Início Rápido

### 1. Criar Chave de API

Primeiro, crie uma chave de API no seu painel do OneUptime:

1. Vá para **Settings** → **API Keys**
2. Clique em **Create API Key**
3. Dê um nome descritivo (ex.: "Automação Terraform")
4. Selecione as permissões apropriadas
5. Copie a chave de API gerada

### 2. Configuração Básica do Terraform

Crie um arquivo `main.tf`:

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
  oneuptime_url = "https://oneuptime.com"  # Use a URL da sua instância
  api_key       = var.oneuptime_api_key
}

# Nota: Projetos devem ser criados manualmente no painel do OneUptime
variable "project_id" {
  description = "ID do projeto OneUptime"
  type        = string
}

# Criar um monitor
resource "oneuptime_monitor" "website" {
  name        = "Monitor de Site"
  description = "Monitor para uptime do site"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Criar uma equipe
resource "oneuptime_team" "platform" {
  name        = "Equipe de Plataforma"
  description = "Equipe de engenharia de plataforma"
}
```

### 3. Inicializar e Aplicar

```bash
# Inicializar o Terraform
terraform init

# Planejar as mudanças
terraform plan

# Aplicar a configuração
terraform apply
```

## Compatibilidade de Versões

### Clientes de Nuvem

Para clientes do OneUptime Cloud, use a versão mais recente do provedor:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Sempre use a versão compatível mais recente
    }
  }
}
```

### Clientes Auto-Hospedados

**Crítico**: Os clientes auto-hospedados devem fixar a versão do provedor para corresponder à instalação do OneUptime:

| Versão do OneUptime | Versão do Provedor | Configuração           |
| ------------------- | ------------------ | ---------------------- |
| 7.0.x               | 7.0.x              | `version = "~> 7.0.0"` |
| 7.1.x               | 7.1.x              | `version = "~> 7.1.0"` |
| 7.2.x               | 7.2.x              | `version = "~> 7.2.0"` |

Exemplo para OneUptime 7.0.123:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Correspondência de versão exata
    }
  }
}
```

## Recursos Disponíveis

O provedor Terraform do OneUptime suporta os seguintes recursos:

### Recursos Principais

- `oneuptime_team` - Gerenciar equipes

### Monitoramento

- `oneuptime_monitor` - Criar e gerenciar monitores
- `oneuptime_probe` - Gerenciar probes de monitoramento

### Gerenciamento de Plantão

- `oneuptime_on_call_duty_policy` - Configurar escalas de plantão

### Páginas de Status

- `oneuptime_status_page` - Criar páginas de status

### Catálogo de Serviços

- `oneuptime_service_catalog` - Gerenciar entradas do catálogo de serviços
- `oneuptime_service` - Definir serviços
- `oneuptime_service_dependency` - Mapear dependências de serviços

### Fontes de Dados

Nota: As fontes de dados não estão disponíveis atualmente no provedor, pois nenhuma fonte de dados está definida no esquema do provedor.

## Melhores Práticas

### 1. Gerenciamento de Versões

**Para Clientes de Nuvem:**

- Use versionamento semântico com `~>` para obter atualizações compatíveis
- Revise o changelog antes de atualizações de versão principal

**Para Clientes Auto-Hospedados:**

- Sempre fixe na versão exata correspondente à sua instalação
- Atualize a versão do provedor ao atualizar o OneUptime
- Teste em ambiente não produtivo primeiro

### 2. Gerenciamento de Estado

```hcl
terraform {
  backend "s3" {
    bucket = "meu-estado-terraform"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Separação de Ambientes

Use workspaces ou arquivos de estado separados para diferentes ambientes:

```bash
# Usando workspaces
terraform workspace new production
terraform workspace new staging

# Usando diretórios separados
mkdir -p environments/{staging,production}
```

### 4. Gerenciamento de Variáveis

```hcl
# variables.tf
variable "environment" {
  description = "Nome do ambiente"
  type        = string
}

variable "monitors" {
  description = "Lista de monitores a criar"
  type = list(object({
    name = string
    url  = string
    type = string
  }))
}

# terraform.tfvars
environment = "production"
monitors = [
  {
    name = "Site"
    url  = "https://example.com"
    type = "website"
  },
  {
    name = "API"
    url  = "https://api.example.com/health"
    type = "api"
  }
]
```

### 5. Nomenclatura de Recursos

Use convenções de nomenclatura consistentes:

```hcl
resource "oneuptime_monitor" "website_production" {
  name = "${var.environment}-website-monitor"
  # ...
}

resource "oneuptime_alert_policy" "critical_production" {
  name = "${var.environment}-critical-alerts"
  # ...
}
```

## Guia de Migração

### Da Configuração Manual

1. **Audite os recursos existentes** no painel do OneUptime
2. **Crie a configuração Terraform** para recursos existentes
3. **Importe os recursos existentes** para o estado do Terraform
4. **Valide a configuração** corresponde ao estado atual
5. **Aplique as mudanças** incrementalmente

Exemplo de importação:

```bash
# Importar monitor existente
terraform import oneuptime_monitor.website monitor-id-here

# Importar projeto existente
terraform import oneuptime_project.main project-id-here
```

### Atualizações de Versão

Ao atualizar o OneUptime (auto-hospedado):

1. **Faça backup do seu estado atual**
2. **Verifique a compatibilidade do provedor**
3. **Atualize a versão do provedor** na configuração
4. **Teste no ambiente de staging**
5. **Aplique na produção**

```bash
# Backup do estado
terraform state pull > backup.tfstate

# Atualize a versão do provedor
# Edite o bloco terraform na sua configuração

# Planeje e aplique
terraform init -upgrade
terraform plan
terraform apply
```

## Suporte e Recursos

- **Documentação**: [Docs do OneUptime](https://docs.oneuptime.com)
- **Registro Terraform**: [Provedor OneUptime](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **Problemas GitHub**: [OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **Comunidade**: [Comunidade OneUptime](https://community.oneuptime.com)

## Solução de Problemas

### Problemas Comuns

1. **Incompatibilidade de Versão (Auto-Hospedado)**

   ```
   Error: API version incompatible
   ```

   **Solução**: Certifique-se de que a versão do provedor corresponde à instalação do OneUptime

2. **Problemas de Autenticação**

   ```
   Error: Invalid API key
   ```

   **Solução**: Verifique a chave de API e as permissões

3. **Recurso Não Encontrado**
   ```
   Error: Resource not found
   ```
   **Solução**: Verifique os IDs de recursos e certifique-se de que o recurso existe

### Modo Debug

Habilite o log detalhado:

```bash
export TF_LOG=DEBUG
terraform apply
```

### Verificação de Versão

Verifique sua configuração:

```bash
# Verificar versão do Terraform
terraform version

# Verificar versão do provedor
terraform providers

# Validar configuração
terraform validate
```
