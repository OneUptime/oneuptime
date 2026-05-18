# Executar um runbook

Existem três formas de criar uma execução de runbook:

1. **Automaticamente via regra** — veja [Regras de runbook](/docs/runbooks/rules).
2. **Manualmente na página do runbook** — clique **Executar agora** na visão geral do runbook. Sem vínculo a qualquer incidente, alerta ou manutenção.
3. **Manualmente no feed de uma entidade** — clique **Executar runbook** em um incidente, alerta ou evento de manutenção programada. A execução fica vinculada a essa entidade.

## A visão de execução

Abra qualquer execução para ver sua UI de checklist. Cada passo mostra:

- **Pílula de status** — Pendente, Em execução, Aguardando você, Concluído, Pulado, Falhou.
- **Título e descrição** — copiados do runbook no momento da execução.
- **Saída** (recolhível) — stdout, valores de retorno, respostas HTTP.
- **Mensagem de erro** se o passo falhou.
- Para passos manuais em `WaitingForUser`: botões **Marcar como concluído** e **Pular**.

A página faz polling a cada 3 segundos enquanto a execução não é terminal, então você vê passos automatizados completando em quase tempo real.

## Intercalando passos manuais e automatizados

O fluxo clássico:

1. **Passo de script**: capturar estado do sistema, escrever no S3.
2. **Passo manual**: "Notificar clientes pelo banner da página de status." Quem responde marca.
3. **Passo HTTP**: chamar o DBA via PagerDuty.
4. **Passo manual**: "Confirmar que a DB secundária agora é primary." Quem responde marca.
5. **Passo de script**: enviar mensagem de "tudo certo" no Slack.

Passos 2 e 4 pausam a execução até serem marcados. Passos 1, 3, 5 rodam automaticamente. A execução inteira é uma só execução, uma só linha do tempo, uma só fonte de verdade.

## Cancelar uma execução

Clique **Cancelar execução** na página. O passo atual (se houver) termina; os seguintes não começam. O status vira `Cancelled`.

## Retenção de saída

A saída por passo é limitada a **50KB** para evitar que scripts descontrolados inchem o banco. Se precisar de artefatos maiores, escreva no S3 ou em um logger a partir do script e guarde a URL no valor de retorno.

## Re-executar um runbook

Uma execução é um registro único e imutável. Para repetir, clique **Executar agora** de novo — isso cria uma execução nova com um snapshot fresco dos passos atuais do runbook. A execução original fica intacta para a trilha de auditoria.

## Encontrar execuções passadas

Todo runbook tem uma aba **Execuções** listando todas as suas corridas, com filtros por status, intervalo de datas e entidade origem. A partir de um incidente, alerta ou evento de manutenção programada, a aba **Runbooks** mostra as execuções vinculadas àquela entidade.
