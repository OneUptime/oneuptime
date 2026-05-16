# Monitor de Perfis

O monitoramento de perfis permite monitorar dados de criação de perfil contínuos dos seus aplicativos e acionar alertas com base em contagens e padrões de perfis. O OneUptime avalia dados de perfil dos seus serviços de telemetria em uma janela de tempo.

## Visão Geral

Os monitores de perfis contam e filtram dados de criação de perfil que correspondem a critérios específicos. Isso permite que você:

- Monitore dados de criação de perfil contínuos dos seus aplicativos
- Filtre perfis por tipo (CPU, memória, goroutines, etc.)
- Rastreie volume e padrões de perfis
- Alerte sobre anomalias de criação de perfil
- Filtre por atributos de perfil personalizados

## Criando um Monitor de Perfis

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Profiles** como o tipo de monitor
4. Selecione os serviços de telemetria para monitorar
5. Configure filtros e critérios de perfil conforme necessário

## Opções de Configuração

### Serviços de Telemetria

Selecione um ou mais serviços para monitorar perfis. Os serviços devem estar enviando dados de criação de perfil contínuos para o OneUptime via OpenTelemetry.

### Filtros de Perfil

| Filtro | Descrição | Obrigatório |
|--------|-------------|----------|
| Profile Types | Filtrar por nomes de tipos de perfil (ex.: CPU, memória, goroutines) | Não |
| Attributes | Pares chave-valor para filtrar em atributos de perfil personalizados | Não |
| Time Window | Quão longe retrospectar para pesquisar perfis (em segundos, padrão: 60) | Não |

## Critérios de Monitoramento

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| Profile Count | O número de perfis que correspondem aos seus filtros na janela de tempo |

### Tipos de Filtro

- **Greater Than** — A contagem de perfis excede um limite
- **Less Than** — A contagem de perfis está abaixo de um limite
- **Greater Than or Equal To** — A contagem de perfis está no limite ou acima
- **Less Than or Equal To** — A contagem de perfis está no limite ou abaixo
- **Equal To** — A contagem de perfis corresponde exatamente
- **Not Equal To** — A contagem de perfis não corresponde

### Critérios de Exemplo

#### Alertar se nenhum perfil recebido em 5 minutos

- **Time Window**: 300 segundos
- **Check On**: Profile Count
- **Filter Type**: Equal To
- **Value**: 0

## Requisitos de Configuração

O monitoramento de perfis requer que seus aplicativos enviem dados de criação de perfil contínuos para o OneUptime via OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry) para instruções de configuração.
