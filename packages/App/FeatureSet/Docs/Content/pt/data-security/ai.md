# OneUptime AI na Segurança de dados

O OneUptime AI trabalha com o que a Segurança de dados encontrou sem ver os seus dados. Ele recebe nomes, formas, contagens e configuração, nunca um valor dos seus dados, uma amostra mascarada, uma entrada ou uma string de conexão. Cada recurso roda no modelo do próprio projeto, inclusive um auto-hospedado, e cada página, verificação, varredura e integração da Segurança de dados funciona com a IA desligada.

:::cards
- [Por conta própria](#por-conta-própria): O que ele faz com cada novo problema, o que aguarda você e as regras de IA.
- [O que o OneUptime AI vê](#o-que-o-oneuptime-ai-vê): O que cada recurso envia, e o que nunca envia.
- [Veja você mesmo](#veja-você-mesmo): A entrada exata que um dos seus problemas enviaria.
- [O seu próprio modelo](#o-seu-próprio-modelo): Cada recurso no provedor do seu projeto, Ollama, vLLM ou qualquer endpoint compatível com OpenAI.
- [Como é medido](#como-é-medido): Cada recurso em casos fixos, antes de cada versão.
:::

## Por conta própria

Com **Trabalhar em problemas novos** ligado em **Segurança de dados → IA**, como nos projetos novos, o OneUptime AI trabalha por conta própria em cada novo problema crítico ou alto. Ele escreve a análise de cada um desses problemas, e de cada um que for reaberto, como faz **Analisar problema** e a partir do que isso envia, antes que alguém o abra, e só a escreve de novo quando muda aquilo em que se baseia. Para um problema de telemetria, ele oculta um segredo na telemetria nova por conta própria, quando a regra está comprovada nos registros em que o segredo foi visto e nada lê o que ela oculta, e propõe as regras de limpeza para o resto (veja [Contido por conta própria](/docs/data-security/telemetry#contido-por-conta-própria)). Uma proposta aguarda nessa página em **Aguardando você**, as mais arriscadas primeiro, com o que vai mudar, por quê, como será comprovado e como desfazer. **Aprovar** faz a mudança com as suas próprias permissões: uma regra de limpeza exige permissão para criar regras de limpeza de logs, regras de limpeza de traces ou regras de pipeline de métricas. **Dispensar proposta** diz não, com um motivo que vai para a linha do tempo do problema. A própria verificação do problema decide se uma mudança funcionou: o repositório é verificado de novo, e o problema é resolvido quando não resta nenhum dos dados dele.

O OneUptime AI também propõe proprietários para repositórios de dados que não têm nenhum, a partir do que já aponta para eles: as tags de nuvem do repositório, os serviços que o usam e os proprietários deles, os proprietários do código do arquivo que o declara, quem o alterou segundo o registro de alterações da nuvem e quem o adicionou ao OneUptime. Ele cita só equipes e pessoas do seu próprio projeto, diz o quanto está seguro e diz onde as evidências não concordam. A proposta para um repositório sensível vem com o problema **Este repositório sensível não tem proprietário**, e os outros repositórios novos recebem a deles uma vez por dia e quando uma conexão de nuvem é lida pela primeira vez. Quando os proprietários de três ou mais repositórios se apoiam na mesma tag ou no mesmo começo de nome, ele também propõe a regra de proprietário que mantém com proprietário o próximo repositório como esses, e diz com quantos repositórios a regra corresponderia. Essas propostas aguardam em **Proprietários para revisar**, nesta página e em **Repositórios de dados**: **Aprovar** adiciona os proprietários com as suas próprias permissões, e eles são avisados como qualquer proprietário; **Alterar e aprovar** escolhe outros proprietários antes; **Desfazer** remove exatamente os proprietários adicionados, e a regra com eles. Adicionar um proprietário muda quem é avisado, então isso sempre espera por você, diga o que disser uma regra de IA.

Por padrão, o OneUptime AI pergunta antes de cada mudança, exceto uma que só oculta dados, pode ser desfeita e está comprovadamente segura, e nunca apaga dados nem aciona ninguém sem perguntar. Uma mudança que ele fez sem perguntar aparece em **Feito pela IA**, com **Desfazer**. **Por que a IA não agiu** lista os problemas que ele analisou e deixou como estavam, e por quê. Cada proposta, aprovação, dispensa e reversão está na **Linha do tempo** do problema e do repositório. Com o interruptor desativado, a Segurança de dados funciona como sempre, e **Analisar problema** e **Corrigir com IA** continuam funcionando quando você os aciona; com a IA desativada para o projeto, nenhum dos dois.

Na página de um problema, o cartão **OneUptime AI** acima de **Como corrigir** mostra a análise e o que foi proposto para aquele problema, com os mesmos botões. A **Visão geral** da segurança de dados diz quantos vazamentos o OneUptime AI conteve esta semana e quantas propostas aguardam você. **Notas para o OneUptime AI** conta, semana a semana, o resultado das alterações dele: veja [Como a OneUptime AI está se saindo](/docs/ai/ai-sre#como-a-oneuptime-ai-está-se-saindo).

### Regras de IA

Em **Regras de IA** de **Segurança de dados → IA**, uma regra diz em quais problemas o OneUptime AI trabalha - pela verificação ou grupo de verificações, gravidade, e sensibilidade, tipo, provedor, ambiente, rótulos, categorias de dados e serviço do repositório - e, para cada tipo de trabalho, **Analisar**, **Conter**, **Correção** e **Julgar**, se está em **Desativado**, **Sugerir** (ele propõe e aguarda você) ou **Automaticamente**. Quando várias regras correspondem a um problema, um tipo de trabalho é executado se alguma delas o liga, e **Sugerir** prevalece sobre **Automaticamente**. Cada proposta diz qual regra a decidiu. **Conter** definido como **Automaticamente** permite que uma regra de limpeza comprovada para dados pessoais também seja feita por conta própria, não só a de um segredo; uma regra que não está comprovadamente segura sempre aguarda você, diga o que disser uma regra. Sem regra, valem os padrões do projeto: analisar problemas críticos e altos, e sugerir todo o resto.

As regras de IA pertencem ao projeto todo, como as de incidentes e alertas: Proprietários do projeto e Administradores do projeto as alteram, assim como qualquer pessoa com as permissões de regras de IA. Os papéis de segurança veem o que o OneUptime AI propôs e fez, mas não as regras.

## O que o OneUptime AI vê

Nenhum recurso jamais envia a um modelo:

- um valor dos seus dados;
- uma amostra mascarada, como `j***@e******.com`: um e-mail mascarado ainda traz um domínio, e um cartão mascarado os seus últimos quatro dígitos;
- uma entrada da sua telemetria: uma linha de log, um span ou uma sessão;
- uma string de conexão, uma chave ou qualquer outro segredo.

A Segurança de dados lê os seus dados ela mesma, dentro das suas varreduras, e não guarda nada deles. O que ela envia ao OneUptime AI é montado em um só lugar, a partir de uma lista do que pode ser enviado, e um teste falha quando algum recurso envia a um modelo qualquer outra coisa.

| Recurso | O que envia | Roda sozinho |
| --- | --- | --- |
| **Análise sob demanda** | O título, a gravidade e a evidência do problema, por que sua verificação importa e os passos que o corrigem; o nome, o tipo, a região, as tags e a configuração do repositório, sua sensibilidade, os nomes dos seus tipos de dados e cerca de quantos registros ele contém; quem consegue alcançar o repositório: a identidade, o nível e a forma de concessão de cada permissão, e aproximadamente quando foi usada pela última vez, e os serviços vistos usando-o; as cópias dos seus dados em outros repositórios, seus casos de segurança, a ação de resposta que corrige o problema, e o repositório de código e os arquivos que o declaram; quantos proprietários o repositório tem, nunca quem são; para um problema de telemetria, onde cada tipo de dado foi encontrado: o atributo, o corpo do log ou o prompt em que está | Não: uma pessoa pede, na página de um problema, ou com Explicar com IA pela API ou pelo servidor MCP |
| **Análise de problemas novos** | O título, a gravidade e a evidência do problema, por que sua verificação importa e os passos que o corrigem; o nome, o tipo, a região, as tags e a configuração do repositório, sua sensibilidade, os nomes dos seus tipos de dados e cerca de quantos registros ele contém; quem consegue alcançar o repositório: a identidade, o nível e a forma de concessão de cada permissão, e aproximadamente quando foi usada pela última vez, e os serviços vistos usando-o; as cópias dos seus dados em outros repositórios, seus casos de segurança, a ação de resposta que corrige o problema, e o repositório de código e os arquivos que o declaram; quantos proprietários o repositório tem, nunca quem são; para um problema de telemetria, onde cada tipo de dado foi encontrado: o atributo, o corpo do log ou o prompt em que está | Sim: um problema novo ou reaberto de gravidade Crítica ou Alta a inicia, enquanto **Trabalhar em problemas novos** estiver ativado |
| **Corrigir com IA** | O problema como sua verificação o viu, o nome, o tipo, a região e o ID de nuvem do repositório, e para um problema de telemetria onde seus dados foram encontrados, como uma solicitação ao agente de código, que então lê o próprio código do repositório para fazer a mudança | Não: uma pessoa pede, em um repositório que pode alterar em **Code** |
| **Sugestões para campos que nenhum detector identificou** | O tipo de repositório de dados e os tipos de dados que a IA pode nomear; o nome de cada campo, os nomes dos campos ao lado e as formas dos seus valores, cada letra como `a` ou `A` e cada dígito como `9`; quantos valores foram lidos e qual o tamanho deles | Sim: a varredura de conteúdo de um repositório de dados as inicia |
| **Pergunte à IA** | Os repositórios de dados, problemas e acessos que a pessoa pode ler na Segurança de dados; o que foi encontrado e onde, cada tipo de dado por local, com contagens e confiança | Não: uma pessoa faz uma pergunta |
| **Proprietários de repositórios de dados** | O nome, o tipo, o provedor, o ambiente e a sensibilidade do repositório de dados, e os nomes dos seus tipos de dados; o que aponta para um proprietário: as tags de nuvem dele, os serviços que o usam, os proprietários do código do arquivo que o declara e as mudanças feitas nele; as equipes que as evidências citam, pelo nome, e as pessoas que elas citam, só como candidatos numerados, nunca pelo nome ou pelo e-mail | Sim: um repositório sem proprietários o inicia, uma vez por dia para repositórios novos e quando uma conexão de nuvem é lida pela primeira vez, enquanto **Trabalhar em problemas novos** está ligado |
| **Nomes para problemas com uma só causa** | O que os repositórios de dados do grupo compartilham: o módulo, a stack ou a tag que os criou, a identidade que os criou ou o seu padrão de nome; a verificação em que falham, quantos problemas o grupo tem, o tipo de repositório de dados e o código que os declara. Nunca o nome de nenhum repositório do grupo | Sim: um grupo de problemas que um mesmo erro causou o inicia, quando se forma ou muda o que seus repositórios compartilham, enquanto **Trabalhar em problemas novos** estiver ativado |
| **Corrigir a causa** | A verificação em que os problemas do grupo falham, o que seus repositórios de dados compartilham e o módulo ou os arquivos que os declaram, como uma solicitação ao agente de código; cada repositório de dados que o pull request corrige: nome, tipo, região e ID na nuvem, e seu problema; o agente de código então lê o próprio código do repositório para fazer a mudança | Não: uma pessoa pede, a partir de um grupo em **Problemas** ou aprovando a proposta do OneUptime AI, em um repositório que pode alterar em **Código**; ou a etapa **Fix the code with AI** de um playbook de segurança. Uma regra cuja **Correção** é **Sem perguntar** o abre sozinha |
| **Regras de limpeza para o que o Limpar não consegue cobrir** | O tipo de dado de cada descoberta, sua categoria e se ele é encontrado pelos valores ou pelo nome de um campo; onde fica, o atributo ou o corpo do log, e os nomes dos atributos ao lado; as formas dos seus valores, como `AA-9999` para o valor `AB-1234`, e quantos valores foram lidos | Sim: um problema de telemetria que o OneUptime AI contém o inicia, para os dados que nenhuma regra do Limpar consegue ocultar, enquanto **Trabalhar em problemas novos** está ligado |
| **Dados sensíveis em pull requests** | O que as regras encontraram no diff do pull request: o arquivo e a linha, o nome gravado, o tipo de dado que ele nomeia e a verificação em que falharia; o diff desses arquivos e o título do pull request, sem o que parece um segredo, um endereço de e-mail ou um endereço IP; nunca o que a produção contém: onde a sua telemetria conteve os dados, o nome de um repositório de dados ou o que ele contém, nem uma amostra do que foi encontrado, nem mesmo mascarada | Sim: a [revisão de produção](/docs/ai/ai-agent#revisão-de-produção-de-pull-requests) de um pull request a inicia, quando as regras dela encontram dados sensíveis na alteração |

**Explicar com IA** e **Pergunte à IA** também leem primeiro o [contexto de IA](/docs/ai/ai-context) da sua equipe, quando ela tem um: as notas que a sua equipe escreveu para o OneUptime AI sobre os seus sistemas. **Análise de problemas novos** também o lê.

### O texto que os seus sistemas escreveram é dado

O nome de um repositório de dados, o ID de nuvem dele, as tags dele, as evidências que uma nuvem respondeu e a chave de um atributo vêm das suas nuvens e do seu código, então qualquer pessoa que pode dar nome a um bucket ou pôr uma tag em um recurso escreve o que o OneUptime AI lê. O OneUptime AI recebe cada instrução em uma mensagem própria, e esse texto em uma segunda mensagem, como dados:

- cada texto é limitado a um tamanho e posto em uma só linha, e o que parece um segredo, um endereço de e-mail ou um endereço IP é retirado;
- um texto que soa como instruções para uma IA, como "ignore previous instructions", é marcado, e o OneUptime AI é instruído a nunca segui-lo;
- uma resposta estruturada, como a das sugestões de campos, é lida de forma estrita: o objeto pedido, ou nenhuma resposta.

### O que fica guardado

A linha de cada chamada em **Configurações do projeto → IA → Registros de IA** diz qual recurso chamou qual modelo, os tokens dela e o custo dela. Ela nunca guarda o que foi enviado ou respondido: Membros do projeto e Visualizadores leem os Registros de IA, e os dados da Segurança de dados são para os proprietários deles e as funções de segurança. A telemetria do próprio OneUptime também nunca registra o que Explicar com IA ou as sugestões de campos enviaram, mesmo onde o operador do servidor registra o que outras chamadas de IA enviam. A análise em si fica guardada no seu problema, para quem puder ler o problema, e uma linha que se baseia em algo que um leitor não pode ler fica oculta para ele.

Quando uma chamada falha, Explicar com IA e as sugestões de campos não guardam nenhuma palavra do erro do provedor, que pode citar o que foi enviado. O agente de código por trás de Corrigir com IA e Corrigir a causa, e o chat de Pergunte à IA, ainda guardam o erro do provedor de uma chamada que falhou na linha dela.

As propostas de proprietários guardam o mesmo que Explicar com IA: as linhas das chamadas delas citam o recurso, o modelo, os tokens e o custo, nunca o que foi enviado ou respondido, e nenhuma palavra do erro de uma chamada que falhou. O mesmo vale para as regras de limpeza que o OneUptime AI escreve, e cada regra que ele escreveu é executada nos registros em que os dados foram vistos antes de ser proposta ou criada. O mesmo vale para as leituras dos dados sensíveis de um pull request, cujos pontos ficam guardados na revisão de produção dele, no Código e no comentário dele.

## Veja você mesmo

**Segurança de dados → Configurações → OneUptime AI** mostra tudo isso para o seu projeto:

- **O que o OneUptime AI vê**: cada recurso, o que ele envia e nunca envia, o que o inicia, o modelo em que roda e o que fica guardado dele. O modelo é nomeado para quem pode ler os provedores de LLM do projeto.
- **Mostrar um exemplo**: a entrada exata que **Explicar com IA** enviaria para o seu problema aberto mais arriscado, do jeito que enviaria, com o que **Corrigir com IA** pediria. O contexto de IA do seu projeto, que vem primeiro, é mostrado pelo tamanho dele. Ele mostra só um problema que você pode ler.

**Configurações do projeto → IA → Provedores LLM** leva até ela, para quem escolhe o modelo.

## O seu próprio modelo

Cada recurso de IA da Segurança de dados roda no modelo que o seu projeto escolheu:

- **Explicar com IA** e as sugestões de campos rodam no provedor que uma regra de IA escolhe para o trabalho; senão, no provedor de LLM padrão do seu projeto; senão, no próprio do servidor.
- O agente de código de **Corrigir com IA** roda no provedor que uma regra de IA escolhe; senão, em um dos provedores do seu projeto; senão, no próprio do servidor.
- **Pergunte à IA** roda no provedor escolhido no chat; senão, no padrão do seu projeto.
- A leitura dos dados sensíveis de um pull request roda no provedor que o repositório escolhe para as revisões de produção dele; senão, no provedor de LLM padrão do seu projeto; senão, no próprio do servidor.

Um modelo auto-hospedado roda todos eles: Ollama, vLLM ou qualquer endpoint compatível com OpenAI que você adicionar em **Configurações do projeto → IA → Provedores LLM**. Em um servidor isolado da rede, o vLLM que vem com o chart Helm é o provedor próprio do servidor, então nada sai do servidor.

### Com a IA desligada

Com **Habilitar IA** desligado em **Configurações do projeto → IA → Recursos de IA**, o OneUptime AI não envia nada, e a Segurança de dados continua funcionando como antes: cada página, verificação, varredura e integração. Nenhum botão de IA aparece em um problema, e nada é perguntado sobre nenhum campo depois de uma varredura.

## Como é medido

Cada recurso de IA da Segurança de dados é medido em um conjunto fixo de casos inventados, montados do jeito que o recurso monta a sua entrada e pontuados pelo que uma resposta certa diz: uma explicação que nomeia a correção e não repete nada que o nome de um repositório de dados mandou dizer, o tipo de dado certo para cada campo, uma correção que muda o que a verificação precisa e mais nada, e uma resposta a partir do que Pergunte à IA leu. Os casos rodam contra um modelo fixado toda noite, a cada mudança em um prompt de IA da Segurança de dados e antes de cada versão, que exige que cada recurso atinja o seu limite mínimo.

As propostas de proprietários são pontuadas por citar o proprietário para o qual as evidências apontam, por não escolher ninguém quando elas não apontam para ninguém e por não ter certeza onde as evidências não concordam. As regras de limpeza são executadas em valores inventados de cada lugar, que o modelo nunca vê, e pontuadas por ocultar cada valor que contém os dados e nenhum dos outros, e por não escrever nenhuma regra para um lugar para o qual nenhuma regra é a certa. As leituras de pull requests são avaliadas por manter cada ponto que é um vazamento, deixar de fora o que não é, e uma correção que diga o que mudar.

Para medir o seu próprio modelo nos mesmos casos, rode a avaliação a partir de um checkout do OneUptime, com a chave do seu modelo, se ele precisar de uma, em `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

No seu projeto, **Vereditos confirmados** em **Configurações do projeto → IA → Resultados de IA** conta quantas vezes o que as pessoas decidiram sobre um problema analisado pelo OneUptime AI seguiu o veredito dele: corrigido ou aceito quando ele disse **Real**, aceito ou marcado como público por design quando disse **Provavelmente intencional**, e marcado como não sendo um problema quando disse **Provavelmente uma detecção errada**.

## Próximos passos

:::cards
- [Integrações da Segurança de dados](/docs/data-security/integrations): O que Explicar com IA e Corrigir com IA fazem em um problema.
- [Provedores de LLM](/docs/ai/llm-provider): Adicione o seu próprio modelo, inclusive um auto-hospedado.
- [Tipos de dados sensíveis](/docs/data-security/data-types): Como são sugeridos os campos que nenhum detector conseguiu classificar.
- [Verificações e problemas da Segurança de dados](/docs/data-security/checks-and-issues): O que cada problema significa, e como corrigi-lo.
:::
