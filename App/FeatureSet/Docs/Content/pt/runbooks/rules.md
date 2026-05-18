# Regras de runbook

Regras de runbook anexam runbooks automaticamente quando um **incidente**, **alerta** ou **evento de manutenção programada** é criado. São gerenciadas no menu Configurações de cada entidade:

- Incidentes → Configurações → **Regras de runbook**
- Alertas → Configurações → **Regras de runbook**
- Manutenção programada → Configurações → **Regras de runbook**

As três páginas editam o mesmo modelo de regras por baixo — são só filtradas para mostrar regras daquele tipo de entidade.

## Anatomia de uma regra

| Campo | Propósito |
| --- | --- |
| **Nome** | Rótulo curto e legível. Aparece nos logs de auditoria. |
| **Descrição** | Contexto opcional para o time. |
| **Habilitada** | Toggle para suspender uma regra sem apagá-la. |
| **Title Pattern** | Regex case-insensitive testado contra o título da entidade. Vazio = qualquer título. |
| **Description Pattern** | Regex case-insensitive testado contra a descrição da entidade. Vazio = qualquer descrição. |
| **Runbooks a Iniciar** | Um ou mais runbooks a disparar quando a regra casa. |

## Semântica de match

Uma regra casa quando **todos os critérios definidos passam**. Critérios vazios são pulados, então:

- Uma regra sem padrões definidos roda em todo evento do seu tipo (uma regra global "rode sempre").
- Uma regra apenas com padrão de título dispara em eventos cujo título casa com aquela regex.
- Várias regras podem casar com o mesmo evento — toda match dispara, e a união dos seus runbooks roda (cada runbook ganha sua própria execução).

## Exemplo: failover de DB para incidentes de banco

```
Name:           Start DB failover for DB incidents
Trigger:        Incident
Title Pattern:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB failover playbook, Notify DBA team]
```

Isso vai criar duas execuções de runbook toda vez que um incidente com "db", "database", "postgres" etc. no título for criado.

## Exemplo: regra de higiene "rode sempre"

```
Name:                 Always-run pre-flight check
Trigger:              Incident
Title Pattern:        (empty)
Description Pattern:  (empty)
Runbooks:             [Capture pre-incident state]
```

Dispara em todo incidente — útil para capturar snapshots de estado do sistema, métricas de página, etc.

## O que acontece quando uma regra dispara

1. O runbook é carregado.
2. Seus passos são **snapshotados** em uma nova execução de runbook.
3. A execução é enfileirada no worker da fila de Runbook.
4. A execução é vinculada à entidade origem — aparece na página do incidente, alerta ou manutenção programada e na lista de Execuções do runbook.

Você pode ver todas as execuções disparadas por regra em **Runbooks → Execuções**, filtrando por status, runbook ou data.

## Runbooks desabilitados

Se uma regra referencia um runbook com `isEnabled = false`, a regra ainda casa mas a execução é pulada. Reabilite o runbook para retomar.

## Testando uma regra

Antes de confiar em uma regra em produção, crie um incidente (ou alerta) de teste com um título que casa com o padrão e confirme que os runbooks esperados disparam. Regras são avaliadas no momento da criação — editar o título de um incidente depois não dispara as regras de novo.
