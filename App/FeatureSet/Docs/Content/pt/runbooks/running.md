# Executar um runbook

Há três formas de uma execução de runbook ser criada:

1. **Automaticamente via regra** — veja [Regras de runbook](/docs/runbooks/rules).
2. **Manualmente na página do runbook** — clique **Executar agora** na visão geral do runbook. Sem vínculo a qualquer incidente, alerta ou manutenção.
3. **Manualmente no feed de uma entidade** — clique **Executar runbook** em um incidente, alerta ou evento de manutenção programada. A execução fica vinculada a essa entidade.

## A vista de execução

Abra qualquer execução para ver sua UI de checklist. Cada passo mostra:

- **Status** — Pendente, Em execução, Aguardando você, Feito, Pulado, Falhou.
- **Título e descrição** — copiados do runbook no momento da execução.
- **Saída** (recolhível) — stdout, valores de retorno, respostas HTTP.
- **Mensagem de erro** se o passo falhou.
- Para passos manuais em `WaitingForUser`: botões **Marcar como concluído** e **Pular**.

Enquanto a execução não está em estado terminal, a página atualiza a cada 3 segundos; você verá os passos automatizados terminando quase em tempo real.

## Intercalar passos manuais e automatizados

O fluxo clássico:

1. **Passo de script**: capturar estado do sistema, escrever no S3.
2. **Passo manual**: "Avisar clientes pelo banner da status page." Quem responde marca.
3. **Passo HTTP**: chamar o DBA via PagerDuty.
4. **Passo manual**: "Confirmar que o DB secundário virou primário." Quem responde marca.
5. **Passo de script**: enviar a mensagem "tudo certo" no Slack.

Os passos 2 e 4 pausam a execução até a marcação. Os passos 1, 3, 5 rodam automaticamente. Todo o percurso é uma só execução, uma só timeline, uma só fonte de verdade.

## Cancelar uma execução

Clique **Cancelar execução** na página. O passo atual (se houver) termina; os seguintes não começam. O status vira `Cancelled`.

## Retenção de saída

A saída por passo é limitada a **50 KB** para evitar que scripts desgovernados inflem o banco. Se você precisar de artefatos maiores, escreva-os do script para S3 ou para um logger e guarde a URL no valor de retorno.

## Reexecutar um runbook

Uma execução é um registro único e imutável. Para repetir, clique **Executar agora** de novo — isso cria uma execução nova com um snapshot fresco dos passos atuais do runbook. A execução original fica intacta para a trilha de auditoria.

## Encontrar execuções passadas

Todo runbook tem uma aba **Execuções** listando todas as suas corridas, com filtros por status, intervalo de datas e entidade de origem. Em um incidente, alerta ou manutenção, a aba **Runbooks** mostra as execuções vinculadas a essa entidade.
