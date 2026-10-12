# Lista branca de números de telefone

No OneUptime Cloud, os SMS e as chamadas de plantão vêm dos números abaixo. Adicione-os à lista de permitidos do seu telefone para que um acionamento nunca seja bloqueado, silenciado ou marcado como spam.

## Números do OneUptime Cloud

| Número | País |
| --- | --- |
| +13022917020 | Estados Unidos (US) |
| +447427817020 | Reino Unido (UK) |

## Permita os números no seu telefone

:::steps
1. Salve os dois números nos contatos do telefone como um único contato, por exemplo "OneUptime".
2. Se você usa Não Perturbe, Foco ou outro modo silencioso, permita chamadas e mensagens desse contato.
3. Se um app de triagem de chamadas ou filtro de spam, ou a proteção contra spam da sua operadora, estiver ativo, marque os dois números como confiáveis lá também.
:::

> [!TIP]
> Adicionar ou verificar seu número de telefone em **Configurações do usuário** > **Métodos de notificação** envia um código a partir desses números, então é um jeito rápido de conferir se eles chegam.

## Quando os acionamentos vêm de outros números

Seus acionamentos vêm de números diferentes dos acima quando:

- **Seu projeto usa a própria conta do Twilio.** Quando um projeto tem uma configuração do Twilio definida como padrão do projeto (**Configurações do projeto** > **Notificações** > **Configurações de notificação** > **Configuração do Twilio**), os SMS e as chamadas para os membros do projeto passam por essa conta, a partir dos números de telefone dela. Coloque esses números na lista branca em vez dos acima.
- **Você usa uma instalação auto-hospedada.** Os SMS e as chamadas vêm dos números do Twilio que o seu administrador configurou: a configuração do Twilio padrão do projeto, ou a da instalação inteira em **Admin Dashboard** > **Configurações** > **Chamadas e SMS**. Pergunte ao seu administrador quais números colocar na lista branca.

## Próximos passos

:::cards
- [Regras de escalonamento](/docs/on-call/escalation-rules): Como cada pessoa que um nível aciona é contatada, e em que ordem.
- [Agendamentos de plantão](/docs/on-call/schedules): Decida quem está de plantão, e quando.
- [Integração de SMS e voz do Twilio](/docs/self-hosted/twilio-integration): Use sua própria conta e seus próprios números do Twilio em uma instalação auto-hospedada.
:::
