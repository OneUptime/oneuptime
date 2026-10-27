# Regras de rótulos e proprietários

As regras de rótulos e as regras de proprietários organizam seus recursos por você. Uma **regra de rótulos** adiciona rótulos a cada recurso novo que corresponde a ela, e uma **regra de proprietários** adiciona usuários e equipes como proprietários: assim, um novo incidente de banco de dados recebe o rótulo _Banco de dados_ e pertence à equipe de banco de dados sem que ninguém precise se lembrar disso.

:::cards
- [Criar uma regra](#criar-uma-regra): Duas etapas: com o que a regra corresponde e, depois, o que ela adiciona.
- [Herdar rótulos e proprietários](#herdar-rótulos-e-proprietários): Repassar o que os monitores, hosts e serviços de um evento carregam.
- [Quando as regras são executadas](#quando-as-regras-são-executadas): Recursos novos, e **Executar agora** para os que você já tem.
:::

## Como funciona

As regras são executadas quando um recurso é criado. Cada regra habilitada verifica suas condições no recurso novo, e cada regra que corresponde adiciona o que adiciona.

```mermaid title="O que acontece quando um recurso é criado"
flowchart TB
    C["Um recurso é criado"] --> R["Cada regra habilitada<br/>para esse tipo de recurso"]
    R --> M{"As condições correspondem?"}
    M -->|"Não"| X["Nada é adicionado"]
    M -->|"Sim"| A["Rótulos ou proprietários<br/>adicionados"]
    A --> N["Proprietários notificados se<br/>Notificar proprietários estiver ligado"]
```

Os rótulos e os proprietários servem para filtrar e agrupar recursos, definem quem o OneUptime avisa sobre eles e o que alcançam as [permissões restritas por rótulos ou aos próprios recursos](/docs/permissions/index). As regras os mantêm consistentes sem que ninguém precise se lembrar.

## Onde encontrar as regras

Todo produto com rótulos e proprietários tem as duas regras em suas **Configurações** (em incidentes, alertas e manutenção programada, em **Regras**): monitores, incidentes e episódios de incidente, alertas e episódios de alerta, eventos de manutenção programada, páginas de status, serviços, hosts, clusters Kubernetes, hosts Docker, clusters Docker Swarm, hosts Podman, clusters Proxmox, vCenters VMware, clusters Ceph, storage arrays, bancos de dados, filas, frotas de IoT, funções serverless, recursos de nuvem, aplicações RUM, dashboards, políticas de plantão, escalas de plantão, políticas de chamadas recebidas, workflows, runbooks, dispositivos de rede e SLOs.

Por exemplo, as regras de rótulos de monitores ficam em **Monitores → Configurações → Regras de Rótulos**, e as de incidentes em **Incidentes → Regras → Regras de Rótulos**. **Configurações** e **Regras** começam recolhidas no menu lateral: clique no título da seção para abri-la. As páginas de incidentes e de alertas têm uma aba **Incident Rules** (ou **Alert Rules**) e uma aba **Episode Rules**.

## Criar uma regra

Todas as regras de rótulos e de proprietários são criadas do mesmo jeito, em duas etapas.

:::steps
### Abrir a lista de regras

Abra a página **Regras de Rótulos** ou **Regras de proprietário** do produto e clique no botão de criação, que leva o nome da regra, por exemplo **Criar: Monitor Label Rule**.

### Escolher com o que a regra corresponde

Na etapa **Corresponder**, **Aplica-se a** começa em qualquer recurso novo, por exemplo **Todos os hosts** numa regra de hosts. Para restringi-la, escolha **Somente os hosts que atendem às condições** e preencha a condição que se abre; clique em **Adicionar condição** para cada outra condição que o recurso precisa cumprir. Com duas ou mais, escolha **Corresponder a todas** ou **Corresponder a qualquer**.

### Escolher o que a regra adiciona

Na etapa **Rótulos**, escolha os **Rótulos a Adicionar**. Numa regra de proprietários, a etapa é **Proprietários**: **Adicionar proprietário** abre uma única lista de pessoas e equipes.

O **Nome** é preenchido a partir do que você escolhe (_Adicionar Production_, _Adicionar Platform como proprietários_) e acompanha suas escolhas até você digitar um nome próprio. Uma regra que só herda recebe, em vez disso, o nome daquilo de que herda (veja abaixo).

### Conferir os campos recolhidos

**Mais campos** contém a **Descrição** opcional e, numa regra de proprietários, **Notificar proprietários**, que vem ligado por padrão: os proprietários que uma regra adiciona recebem a mesma notificação "você foi adicionado como proprietário" que um proprietário adicionado à mão. Desligue para adicionar proprietários sem avisá-los.

### Salvar a regra

Na última etapa, clique de novo no botão com o nome da regra, por exemplo **Criar: Monitor Label Rule**. A regra começa habilitada, e a lista a mostra com uma etiqueta verde **Habilitado**.
:::

Uma regra nova precisa adicionar algo: pelo menos um rótulo (ou proprietário) ou, numa regra de incidente, alerta ou manutenção programada, algo que ela herde (veja abaixo). Para pausar uma regra sem excluí-la, desligue **Habilitado** no formulário de edição; a lista passa a mostrar uma etiqueta vermelha **Desabilitado**. Numa regra de proprietários de incidente ou alerta, uma equipe em **Equipe do criador** também basta.

### Seja qual for a forma de criar a regra

O mesmo vale para uma regra criada pela API, pelo Terraform, por um workflow ou por uma [importação de regras de rótulos](/docs/configuration/label-rule-import-export): o OneUptime recusa uma regra nova que não adiciona nada, com uma mensagem que indica os campos a preencher. Essas mensagens estão em inglês em todos os idiomas.

| Regra | Mensagem |
| --- | --- |
| Regra de rótulos | This label rule adds nothing. Choose at least one label in Labels to Add. |
| Regra de rótulos de incidente, alerta ou manutenção programada | This label rule adds nothing. Choose at least one label in Labels to Add, or turn on an Inherit Labels switch. |
| Regra de proprietários | This owner rule adds nothing. Choose at least one user or team in Owner Users or Owner Teams. |
| Regra de proprietários de incidente ou alerta | This owner rule adds nothing. Choose at least one user or team in Owner Users or Owner Teams, a team in Creator's Teams, or turn on an Inherit Owners switch. |
| Regra de proprietários de manutenção programada | This owner rule adds nothing. Choose at least one user or team in Owner Users or Owner Teams, or turn on an Inherit Owners switch. |

- **API**: defina `labelsToAdd` (ou `ownerUsers` / `ownerTeams`) com pelo menos um registro do projeto, ou um dos interruptores `inheritLabelsFrom…` (`inheritOwnersFrom…`) da regra como `true`, um booleano JSON. Numa regra de proprietários de incidente ou alerta, uma equipe em `creatorTeams` também basta.
- **Terraform**: um recurso de regra de rótulos ou de proprietários que não adiciona nada falha no `terraform apply` com a mensagem acima. Dê a ele `labels_to_add` (ou `owner_users` / `owner_teams`) ou ligue um dos seus interruptores de herança.

As regras que você já tem não são alteradas: veja [Editar uma regra](#editar-uma-regra).

## Herdar rótulos e proprietários

As regras de incidentes, alertas e manutenção programada também podem repassar o que carregam os recursos afetados por um evento. Em **Rótulos a Adicionar** (ou **Proprietários**), a seção recolhida **Herdar Rótulos** (ou **Herdar Proprietários**) contém seis interruptores:

- **Herdar Rótulos dos Monitores**: cada rótulo dos monitores do incidente também é adicionado ao incidente. Um alerta tem um único monitor, então numa regra de alertas o interruptor é **Herdar Rótulos do Monitor** (e numa regra de proprietários de alertas, **Herdar Proprietários do Monitor**).
- **Herdar Rótulos dos Hosts**, **Herdar Rótulos dos Clusters Kubernetes**, **Herdar Rótulos dos Hosts Docker**, **Inherit Labels From Podman Hosts** e **Herdar Rótulos dos Serviços** fazem o mesmo com esses recursos.

As regras de proprietários têm os mesmos seis interruptores para proprietários (**Herdar Proprietários dos Monitores** e assim por diante). Enquanto nenhum interruptor estiver ligado, a seção recolhida explica para que serve; numa regra que herda, ela se abre sozinha. As regras de episódios não têm interruptores de herança.

Uma regra que herda pode deixar **Rótulos a Adicionar** (ou **Proprietários**) vazio: ela adiciona o que herda. Uma regra assim recebe o nome daquilo de que herda:

| Interruptores ligados | Nome |
| --- | --- |
| **Herdar Rótulos dos Monitores** | _Herdar rótulos de: monitores_ |
| **Herdar Rótulos dos Monitores** e **Herdar Rótulos dos Hosts** | _Herdar rótulos de: monitores, hosts_ |
| **Herdar Rótulos do Monitor**, numa regra de alertas | _Herdar rótulos de: monitor_ |

O nome acompanha os interruptores até você escolher um rótulo (aí a regra passa a ter o nome dos seus rótulos) ou digitar um nome próprio.

### A equipe do criador

Uma regra de proprietários de incidente ou alerta tem mais uma entrada, a última da sua seção **Herdar Proprietários**: **Equipe do criador**, uma lista de equipes. Quando a pessoa que declara um incidente correspondente, ou cria um alerta correspondente, é membro de uma equipe da lista, essa equipe também vira proprietária. É uma lista, e não todas as equipes da pessoa, porque as pessoas entram por padrão na equipe **Membros** do projeto, e tornar todos proprietários não ajuda ninguém. Um incidente ou alerta que um monitor, um fluxo de trabalho, um formulário ou uma chave de API cria não tem criador, então não recebe nenhuma dessas equipes. Elas são notificadas conforme diz **Notificar proprietários** da regra, e uma regra que adiciona só elas se chama _Adicionar a equipe do criador como proprietária_. Pela API, a lista é `creatorTeams`.

A pessoa que declara um incidente ou cria um alerta passa a ser um dos proprietários dele, digam as regras o que disserem, e os formulários de criação listam no resumo cada regra de proprietário que será executada, e quem ela vai adicionar: veja [Quem será o proprietário](/docs/incidents/declaring-incidents#quem-será-o-proprietário).

## Editar uma regra

O formulário de edição de uma regra tem as mesmas duas etapas e acrescenta o interruptor **Habilitado**. Ele não exige o que a regra adiciona: uma regra salva antes de o OneUptime pedir isso (pela API, pelo Terraform, por uma importação ou pelo formulário antigo) pode não adicionar nada, e uma edição pode retirar tudo o que uma regra adiciona.

Uma regra assim ainda pode ser renomeada, desligada ou excluída, também pela API e pelo Terraform. A lista marca uma regra que não adiciona nada com **Não adiciona nada** ao lado do status, e a página da própria regra faz o mesmo. Edite-a para escolher o que ela adiciona, ou exclua-a.

## Quando as regras são executadas

Toda regra habilitada é executada quando um recurso é criado, pelo dashboard ou pela API, e cada regra que corresponde adiciona o que adiciona:

- Se várias regras corresponderem, todas adicionam seus rótulos e proprietários.
- Uma regra nunca remove nada: nem rótulos ou proprietários que alguém adicionou à mão, nem os que ela mesma adicionou.
- Uma regra desabilitada não faz nada.

Uma regra escrita hoje vale para os recursos criados depois dela. Para aplicá-la aos que você já tem, use **Executar agora**: veja [Executar regras em recursos existentes](/docs/configuration/run-rules-now). As regras de rótulos também podem ser copiadas entre projetos: veja [Importar e exportar regras de rótulos](/docs/configuration/label-rule-import-export).

## Padrões

Um padrão nas condições de uma regra é uma expressão regular na sintaxe do JavaScript, como `^checkout-.*`, e não diferencia maiúsculas de minúsculas. O OneUptime o executa em um tempo que só cresce com o texto que ele lê, seja qual for a forma como o padrão foi escrito. Lookaheads e lookbehinds funcionam, como `^prod-(?!test)` e `(?<=db-)\d+`.

Dois tipos de padrão não podem ser executados assim. Uma regra com um deles é recusada ao salvar, pelo painel, pela API, pelo Terraform ou por uma importação, com uma mensagem que diz o que mudar:

- Uma referência retroativa, como `\1` ou `\k<name>`, que corresponde de novo ao que um grupo anterior encontrou.
- Um padrão grande demais para ser executado, como um que repete uma parte milhares de vezes.

Uma regra salva antes com um deles não corresponde a nada até que você mude o padrão dela. Isso vale para todo tipo de regra que tem padrões, não só para as regras de rótulos e de proprietários.

As regras de um mesmo tipo de um projeto também dividem uma cota de trabalho para cada recurso que verificam. Ela é muito maior do que regras reais precisam: cabem dez mil padrões simples, e cada texto que as regras leem, como uma descrição longa, a aumenta na proporção do seu tamanho. Uma regra cujos padrões precisem de mais do que resta não corresponde a esse recurso, nem quando sua condição é que um texto não corresponda. Uma regra de privacidade que não pode ser verificada por inteiro conta, em vez disso, como correspondente: o incidente, o alerta ou o episódio fica privado, e o feed dele nomeia as regras que não puderam ser verificadas.

## Próximos passos

:::cards
- [Executar regras em recursos existentes](/docs/configuration/run-rules-now): Aplicar uma regra aos recursos que você já tem.
- [Importar e exportar regras de rótulos](/docs/configuration/label-rule-import-export): Copiar regras de rótulos entre projetos em JSON.
- [Configurações e automação de incidentes](/docs/incidents/settings): As outras regras que um incidente pode executar.
- [Regras de rótulos e proprietários de SLOs](/docs/slo/label-and-owner-rules): Com o que correspondem as regras de SLOs.
:::
