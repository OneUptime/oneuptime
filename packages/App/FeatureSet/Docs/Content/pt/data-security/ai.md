# OneUptime AI na Segurança de dados

O OneUptime AI trabalha com o que a Segurança de dados encontrou sem ver os seus dados. Ele recebe nomes, formas, contagens e configuração, nunca um valor dos seus dados, uma amostra mascarada, uma entrada ou uma string de conexão. Cada recurso roda no modelo do próprio projeto, inclusive um auto-hospedado, e cada página, verificação, varredura e integração da Segurança de dados funciona com a IA desligada.

:::cards
- [O que o OneUptime AI vê](#o-que-o-oneuptime-ai-vê): O que cada recurso envia, e o que nunca envia.
- [Veja você mesmo](#veja-você-mesmo): A entrada exata que um dos seus problemas enviaria.
- [O seu próprio modelo](#o-seu-próprio-modelo): Cada recurso no provedor do seu projeto, Ollama, vLLM ou qualquer endpoint compatível com OpenAI.
- [Como é medido](#como-é-medido): Cada recurso em casos fixos, antes de cada versão.
:::

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

**Explicar com IA** e **Pergunte à IA** também leem primeiro o [contexto de IA](/docs/ai/ai-context) da sua equipe, quando ela tem um: as notas que a sua equipe escreveu para o OneUptime AI sobre os seus sistemas. **Análise de problemas novos** também o lê.

### O texto que os seus sistemas escreveram é dado

O nome de um repositório de dados, o ID de nuvem dele, as tags dele, as evidências que uma nuvem respondeu e a chave de um atributo vêm das suas nuvens e do seu código, então qualquer pessoa que pode dar nome a um bucket ou pôr uma tag em um recurso escreve o que o OneUptime AI lê. O OneUptime AI recebe cada instrução em uma mensagem própria, e esse texto em uma segunda mensagem, como dados:

- cada texto é limitado a um tamanho e posto em uma só linha, e o que parece um segredo, um endereço de e-mail ou um endereço IP é retirado;
- um texto que soa como instruções para uma IA, como "ignore previous instructions", é marcado, e o OneUptime AI é instruído a nunca segui-lo;
- uma resposta estruturada, como a das sugestões de campos, é lida de forma estrita: o objeto pedido, ou nenhuma resposta.

### O que fica guardado

A linha de cada chamada em **Configurações do projeto → IA → Registros de IA** diz qual recurso chamou qual modelo, os tokens dela e o custo dela. Ela nunca guarda o que foi enviado ou respondido: Membros do projeto e Visualizadores leem os Registros de IA, e os dados da Segurança de dados são para os proprietários deles e as funções de segurança. A telemetria do próprio OneUptime também nunca registra o que Explicar com IA ou as sugestões de campos enviaram, mesmo onde o operador do servidor registra o que outras chamadas de IA enviam. A análise em si fica guardada no seu problema, para quem puder ler o problema, e uma linha que se baseia em algo que um leitor não pode ler fica oculta para ele.

Quando uma chamada falha, Explicar com IA e as sugestões de campos não guardam nenhuma palavra do erro do provedor, que pode citar o que foi enviado. O agente de código por trás de Corrigir com IA e o chat de Pergunte à IA ainda guardam o erro do provedor de uma chamada que falhou na linha dela.

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

Um modelo auto-hospedado roda todos eles: Ollama, vLLM ou qualquer endpoint compatível com OpenAI que você adicionar em **Configurações do projeto → IA → Provedores LLM**. Em um servidor isolado da rede, o vLLM que vem com o chart Helm é o provedor próprio do servidor, então nada sai do servidor.

### Com a IA desligada

Com **Habilitar IA** desligado em **Configurações do projeto → IA → Recursos de IA**, o OneUptime AI não envia nada, e a Segurança de dados continua funcionando como antes: cada página, verificação, varredura e integração. Nenhum botão de IA aparece em um problema, e nada é perguntado sobre nenhum campo depois de uma varredura.

## Como é medido

Cada recurso de IA da Segurança de dados é medido em um conjunto fixo de casos inventados, montados do jeito que o recurso monta a sua entrada e pontuados pelo que uma resposta certa diz: uma explicação que nomeia a correção e não repete nada que o nome de um repositório de dados mandou dizer, o tipo de dado certo para cada campo, uma correção que muda o que a verificação precisa e mais nada, e uma resposta a partir do que Pergunte à IA leu. Os casos rodam contra um modelo fixado toda noite, a cada mudança em um prompt de IA da Segurança de dados e antes de cada versão, que exige que cada recurso atinja o seu limite mínimo.

No seu projeto, **Vereditos confirmados** em **Configurações do projeto → IA → Resultados de IA** conta quantas vezes o que as pessoas decidiram sobre um problema analisado pelo OneUptime AI seguiu o veredito dele: corrigido ou aceito quando ele disse **Real**, aceito ou marcado como público por design quando disse **Provavelmente intencional**, e marcado como não sendo um problema quando disse **Provavelmente uma detecção errada**.

Para medir o seu próprio modelo nos mesmos casos, rode a avaliação a partir de um checkout do OneUptime, com a chave do seu modelo, se ele precisar de uma, em `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Próximos passos

:::cards
- [Integrações da Segurança de dados](/docs/data-security/integrations): O que Explicar com IA e Corrigir com IA fazem em um problema.
- [Provedores de LLM](/docs/ai/llm-provider): Adicione o seu próprio modelo, inclusive um auto-hospedado.
- [Tipos de dados sensíveis](/docs/data-security/data-types): Como são sugeridos os campos que nenhum detector conseguiu classificar.
- [Verificações e problemas da Segurança de dados](/docs/data-security/checks-and-issues): O que cada problema significa, e como corrigi-lo.
:::
