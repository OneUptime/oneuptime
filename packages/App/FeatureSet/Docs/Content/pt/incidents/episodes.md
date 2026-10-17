# Episódios

Um episódio agrupa incidentes relacionados, ou alertas relacionados, para que sua equipe trabalhe neles como um só: um só lugar para vê-los, um só grupo de proprietários, um só estado a reconhecer e resolver. As regras de agrupamento abrem episódios e adicionam a eles incidentes e alertas à medida que chegam (veja [Regras de agrupamento de incidentes](/docs/incidents/settings#regras-de-agrupamento-de-incidentes)). Você também pode colocar incidentes em um episódio por conta própria, vários de uma vez: a partir do episódio ou das listas de incidentes.

Tudo nesta página funciona do mesmo jeito para episódios de alertas: leia "alerta" onde está escrito "incidente". Os episódios de incidentes ficam em **Incidentes → Episódios**, e os de alertas em **Alertas → Episódios**.

## Adicionar incidentes a partir de um episódio

Abra o episódio, escolha **Incidentes de membros** no menu lateral (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`) e clique em **Adicionar incidentes**. A caixa de diálogo lista os 50 incidentes mais recentes que você pode ver e que ainda não estão no episódio, cada um com número, título, estado e gravidade. Para encontrar um mais antigo, pesquise por título ou número: `INC-42`, `42` e `#42` encontram o incidente 42.

- Marque quantos precisar, até 100 de uma vez. O botão conta todos: **Adicionar 3 itens (Incidentes)**.
- Um incidente que já está em outro episódio avisa abaixo do título, com o número desse episódio. Adicioná-lo aqui o mantém lá também: um incidente pode estar em mais de um episódio. Em um projeto que permite um incidente em um só episódio, ele não pode ser escolhido: veja [Um só episódio por incidente](#um-só-episódio-por-incidente).
- Se alguns não puderem ser adicionados, a caixa de diálogo continua aberta e os lista com o motivo; os demais são adicionados.

## Adicionar incidentes a partir das listas de incidentes

Selecione incidentes na lista **Incidentes**, ou em qualquer outra lista de incidentes, como a de um monitor, e abra **Ações em massa**:

| Ação | O que faz |
| --- | --- |
| **Adicionar a um episódio existente** | Escolha um episódio. Os episódios em andamento vêm primeiro, do mais recente para o mais antigo, depois os resolvidos recentemente; pesquise por título ou número para encontrar qualquer outro. Antes de adicionar, a caixa de diálogo informa quantos dos incidentes selecionados já estão nesse episódio, que ficam como estão, e quantos estão em outro episódio, onde permanecem. |
| **Adicionar a um novo episódio** | Cria um episódio com os incidentes selecionados. Pede apenas um título e uma gravidade, ambos preenchidos a partir do incidente selecionado mais grave; o título de um incidente privado nunca é copiado. Adicione proprietários, políticas de plantão e notas na página do episódio. |

As duas aceitam até 100 incidentes selecionados. O resultado informa quantos foram adicionados, quantos já estavam no episódio e quais não foram adicionados e por quê, com um link que abre o episódio.

## O que a adição faz

- **Uma única entrada no feed do episódio** nomeia cada incidente adicionado: os 20 primeiros por número e título, depois quantos mais. Ela é publicada uma só vez no canal do Slack ou do Microsoft Teams do episódio, não uma vez por incidente. Um incidente privado é nomeado apenas pelo número.
- **O feed de cada incidente** informa a qual episódio ele foi adicionado.
- **A gravidade do episódio** sobe para a do incidente mais grave adicionado a um episódio existente e nunca desce. Um episódio novo começa com a gravidade que você escolher.
- **Um episódio resolvido continua resolvido.** Adicionar a ele não o reabre, e adicionar nunca muda o estado de um incidente.
- **Os proprietários do episódio são avisados** de que incidentes foram adicionados, como quando um é adicionado sozinho. Quando o episódio é criado com eles, a própria notificação de criação do episódio os cobre.

## Tirar um incidente

Em **Incidentes de membros**, **Remover** em uma linha, ou nas linhas selecionadas em **Ações em massa**, tira o incidente apenas deste episódio. O incidente em si não é excluído e continua em qualquer outro episódio em que esteja.

## Um só episódio por incidente

Um incidente pode estar em vários episódios ao mesmo tempo. Para manter cada incidente em no máximo um episódio, ative **Um incidente só pode estar em um episódio** em **Incidentes → Configurações → Participação em episódios**. Para alertas, o interruptor é **Um alerta só pode estar em um episódio**, em **Alertas → Configurações → Participação em episódios**. Os dois ficam desativados até você ativá-los, e só Project Owners e Project Admins podem alterá-los.

Enquanto ele está ativado, um incidente que está em um episódio não é adicionado a nenhum outro:

- **Adicionar incidentes** lista só os incidentes que não estão em nenhum episódio. Uma busca também encontra os outros, mas um que está em outro episódio não pode ser marcado, e avisa isso.
- **Adicionar a um episódio existente** informa quantos dos incidentes selecionados estão em outro episódio e adiciona só o restante. Quando todos já estão em um episódio, a caixa de diálogo informa que não há nada para adicionar.
- **Adicionar a um novo episódio** deixa de fora os incidentes selecionados que já estão em um episódio e informa quantos. Quando todos estão, informa que não há nada para adicionar.
- As **Regras de agrupamento** deixam onde está um incidente que já está em um episódio.
- **A API, os fluxos de trabalho e o Terraform** seguem a mesma regra: adicionar um incidente que está em outro episódio é recusado, com o motivo.

Ativá-lo não tira nenhum incidente de um episódio: um incidente que já está em vários continua neles. Para mover um incidente, tire-o com **Remover** na página **Incidentes de membros** do episódio dele e depois adicione-o ao outro episódio.

## Quem pode adicionar

Adicionar exige permissão para adicionar incidentes a um episódio, que os papéis Project Owner, Project Admin, Project Member, Incident Admin e Incident Member têm, assim como um papel personalizado com Create Incident Episode Member. Você só pode adicionar incidentes que consegue ver: um incidente privado só pode ser adicionado por seus proprietários e pelos proprietários e administradores do projeto. Adicionar a um novo episódio também exige permissão para criar um episódio. Quando você não pode usar uma ação, ela fica bloqueada, e a dica dela nomeia a permissão que falta.

## Com a API

Adicione vários incidentes a um episódio em uma só requisição:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

A resposta nomeia cada incidente enviado, uma única vez: adicionado, já no episódio, ou não adicionado e por quê. Uma requisição com mais de 100 IDs é recusada.

```json
{
  "added": ["<incident id>"],
  "alreadyInEpisode": ["<incident id>"],
  "notAdded": [
    {
      "id": "<incident id>",
      "reason": "This incident does not exist in this project, or you do not have access to it."
    }
  ]
}
```

Em um projeto que permite um incidente em um só episódio, um incidente que está em outro episódio volta em `notAdded`, com `Already in another episode. An incident can be in only one episode in this project.` como motivo.

Para alertas, envie `alertEpisodeId` e `alertIds` para `/api/alert-episode-member/add-alerts`. Para criar um episódio com incidentes dentro, envie os IDs deles com a requisição que cria o episódio, `POST /api/incident-episode`, como `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; para um episódio de alertas, `POST /api/alert-episode` com `alertIdsToAdd`. Se algum deles não puder ser adicionado, nenhum episódio é criado.
