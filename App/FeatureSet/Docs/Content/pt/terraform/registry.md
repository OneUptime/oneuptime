# Guia de Instalação e Uso do Provedor Terraform

## Instalação do Registro Terraform

O Provedor Terraform do OneUptime está disponível no [Registro Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime) oficial.

### Para Usuários do OneUptime Cloud

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use a versão compatível mais recente
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Para Usuários do OneUptime Auto-Hospedado

⚠️ **Crítico**: Os clientes auto-hospedados devem fixar a versão do provedor para corresponder exatamente à instalação do OneUptime.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Substitua pela sua versão exata do OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.suaempresa.com"  # Sua URL auto-hospedada
  api_key       = var.oneuptime_api_key
}
```

## Por que Fixar Versão para Auto-Hospedado?

O provedor Terraform do OneUptime é gerado automaticamente a partir da especificação de API do OneUptime. Cada versão do OneUptime pode ter:

- Endpoints de API diferentes
- Esquemas de recursos atualizados
- Recursos novos ou removidos
- Regras de validação alteradas

Usar uma versão do provedor que não corresponde à instalação do OneUptime pode resultar em:
- Erros de compatibilidade de API
- Falhas na criação/atualização de recursos
- Comportamento inesperado
- Desvio de estado dos recursos

## Encontrando Sua Versão do OneUptime

### Método 1: Painel
1. Faça login no seu painel do OneUptime
2. Vá para **Settings** → **About**
3. Anote o número da versão (ex.: "7.0.123")

### Método 2: API
```bash
curl https://sua-instancia-oneuptime.com/api/version | jq '.version'
```

### Método 3: Docker
```bash
docker images | grep oneuptime
# Procure pela tag, ex.: oneuptime/dashboard:7.0.123
```

## Informações do Registro do Provedor

- **URL do Registro**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Repositório de Origem**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Documentação**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Releases**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Matriz de Compatibilidade de Versões

| Versão do OneUptime | Versão do Provedor | Configuração Terraform |
|-------------------|------------------|------------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| Cloud mais recente | Provedor mais recente | `version = "~> 7.0"` |

## Exemplo de Início Rápido

```hcl
# Configure o provedor
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Ajuste para auto-hospedado
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Ajuste para auto-hospedado
  api_key       = var.oneuptime_api_key
}

# Criar um projeto
resource "oneuptime_project" "example" {
  name        = "Exemplo Terraform"
  description = "Criado com Terraform"
}

# Criar um monitor de site
resource "oneuptime_monitor" "website" {
  name       = "Monitor de Site"
  project_id = oneuptime_project.example.id
  
  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"
  
  tags = {
    managed_by = "terraform"
  }
}
```

## Etapas de Instalação

1. **Crie sua configuração Terraform** com o bloco do provedor
2. **Inicialize o Terraform**: `terraform init`
3. **Defina sua chave de API**: Crie `terraform.tfvars` com sua chave de API
4. **Planeje sua implantação**: `terraform plan`
5. **Aplique sua configuração**: `terraform apply`

## Obtendo Ajuda

- **Documentação Completa**: Consulte a [documentação completa do Terraform](./README.md)
- **Guia Auto-Hospedado**: Verifique o [guia de configuração auto-hospedada](./self-hosted.md)
- **Exemplos**: Navegue pelos [exemplos de configuração](./examples.md)
- **Início Rápido**: Siga o [guia de início rápido](./quick-start.md)

## Atualizações do Registro

O provedor é publicado automaticamente no Registro Terraform quando novas versões do OneUptime são lançadas. Os usuários de nuvem podem usar versionamento semântico (`~> 7.0`) para obter automaticamente atualizações compatíveis, enquanto os usuários auto-hospedados devem fixar em versões exatas.
