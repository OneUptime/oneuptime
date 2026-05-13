# Monitor Manual

O monitoramento manual permite criar monitores cujo status é gerenciado inteiramente à mão ou por meio da API. O OneUptime não realiza nenhuma verificação automatizada — você controla o status do monitor diretamente.

## Visão Geral

Os monitores manuais são espaços reservados que você atualiza você mesmo. Isso é útil para:

- Integração com ferramentas de monitoramento externas que atualizam o status via API do OneUptime
- Rastreamento de serviços ou sistemas que não podem ser monitorados automaticamente
- Gerenciamento de incidentes para componentes sem verificações de saúde automatizadas
- Representação de dependências de terceiros cujo status você rastreia manualmente

## Criando um Monitor Manual

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Manual** como o tipo de monitor
4. Insira um nome e uma descrição para o monitor

## Como Funciona

Os monitores manuais não têm intervalos de monitoramento, probes ou avaliação automática de critérios. O status do monitor permanece como você o definiu até você alterá-lo.

### Atualizando o Status

Você pode atualizar o status de um monitor manual de duas formas:

- **Painel** — Altere o status do monitor diretamente no Painel do OneUptime
- **API** — Atualize o status do monitor programaticamente usando a API do OneUptime

### Incidentes e Alertas

Você pode criar incidentes e alertas em monitores manuais assim como qualquer outro tipo de monitor. Isso permite que você:

- Rastreie tempo de inatividade para serviços monitorados externamente
- Crie incidentes manualmente quando problemas são relatados
- Use monitores manuais em páginas de status para comunicar o status aos usuários

## Quando Usar Monitores Manuais

| Caso de Uso | Descrição |
|----------|-------------|
| Serviços de terceiros | Rastreie o status de serviços externos dos quais você depende, mas não pode monitorar diretamente |
| Infraestrutura física | Represente hardware ou sistemas físicos sem monitoramento de rede |
| Processos de negócios | Rastreie processos não técnicos que afetam o status do serviço |
| Status orientado por API | Permita que ferramentas externas atualizem o status do monitor via API do OneUptime |
| Espaços reservados da página de status | Mostre componentes na sua página de status que são gerenciados fora do OneUptime |
