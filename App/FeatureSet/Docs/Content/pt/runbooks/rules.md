# Regras de runbook

Regras de runbook anexam runbooks automaticamente quando um **incidente**, **alerta** ou **evento de manutenção programada** é criado. São gerenciadas no menu Configurações de cada entidade:

- Incidentes → Configurações → **Regras de runbook**
- Alertas → Configurações → **Regras de runbook**
- Manutenção programada → Configurações → **Regras de runbook**

As três páginas editam o mesmo modelo de regra subjacente — só estão filtradas para mostrar somente as regras do tipo de entidade correspondente.

## Anatomia de uma regra

| Campo | Função |
| --- | --- |
| **Nome** | Rótulo curto e legível. Aparece em logs de auditoria. |
| **Descrição** | Contexto opcional para colegas. |
| **Habilitada** | Botão para suspender uma regra sem apagá-la. |
| **Padrão de título** | Regex sem distinção de maiúsculas contra o título da entidade. Vazio = qualquer título casa. |
| **Padrão de descrição** | Regex sem distinção de maiúsculas contra a descrição da entidade. Vazio = qualquer descrição casa. |
| **Runbooks a iniciar** | Um ou mais runbooks para lançar quando a regra dispara. |

## Semântica de correspondência

Uma regra casa quando **todos os critérios especificados passam**. Critérios vazios são ignorados:

- Uma regra sem padrões roda em todo evento do seu tipo (regra global "sempre executar").
- Uma regra só com padrão de título dispara em eventos cujo título casa com a regex.
- Várias regras podem casar com o mesmo evento — cada coincidência dispara, e a união dos runbooks roda (cada runbook tem sua própria execução).

## Exemplo: failover de DB para incidentes de banco

```
Nome:               Iniciar failover de DB para incidentes de DB
Disparador:         Incidente
Padrão de título:   (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:           [Playbook de failover de DB, Notificar time DBA]
```

Cria duas execuções de runbook toda vez que um incidente com "db", "database", "postgres" etc. no título é criado.

## Exemplo: regra de higiene sempre-ligada

```
Nome:                    Checagem pré-voo em todo incidente
Disparador:              Incidente
Padrão de título:        (vazio)
Padrão de descrição:     (vazio)
Runbooks:                [Capturar estado pré-incidente]
```

Dispara em todo incidente — útil para capturar snapshots de estado do sistema, métricas de página etc.

## O que acontece quando uma regra dispara

1. O runbook é carregado.
2. Seus passos são copiados como **snapshot** em uma nova execução de runbook.
3. A execução é colocada na fila do worker de Runbook.
4. A execução fica ligada à entidade de origem — aparece na página do incidente, alerta ou manutenção, e na lista de execuções do runbook.

Você vê todas as execuções disparadas por regra em **Runbooks → Execuções**, com filtros por status, runbook ou data.

## Runbooks desabilitados

Se uma regra referencia um runbook com `isEnabled = false`, a regra ainda casa mas a execução é pulada. Reabilite o runbook para retomar.

## Testar uma regra

Antes de confiar em uma regra em produção, crie um incidente (ou alerta) de teste com título que case com o padrão e confirme que os runbooks esperados disparam. Regras são avaliadas no momento da criação — editar o título de um incidente depois não redispara regras.
