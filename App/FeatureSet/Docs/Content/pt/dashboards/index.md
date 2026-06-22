# Visão geral dos painéis

Painéis transformam os dados que o OneUptime já está coletando — métricas, logs, traces, incidentes, monitores, recursos do Kubernetes, hosts — em uma única página que alguém pode olhar e entender o que está acontecendo.

Coloque um gráfico de latência de requisição ao lado de uma lista de incidentes abertos, ao lado de um indicador de CPU, ao lado de um parágrafo de contexto. Salve. Compartilhe o link.

## Para que servem os painéis

- **Uma página "está tudo OK?"** — para o plantão, uma reunião diária da equipe ou uma TV na parede.
- **Identificar conexões** — um pico de CPU ao mesmo tempo que um aumento de latência e um incidente aberto fica muito mais fácil de notar em uma única página do que em três abas.
- **Investigar** — quando você está depurando, um painel que você monta na hora vale mais do que executar dez consultas uma de cada vez.
- **Compartilhar externamente** — uma página de desempenho voltada ao cliente, uma página de status para parceiros, um painel público para um projeto de código aberto.

## O que você pode colocar em um painel

- **Gráficos** para tendências ao longo do tempo — latência, erros, vazão.
- **Indicadores de valor único** — taxa de erro atual, CPU, incidentes abertos.
- **Tabelas** para detalhamentos — top 10 hosts mais barulhentos, contagem de erros por serviço.
- **Blocos de texto** para títulos, contexto e links para runbooks.
- **Listas ao vivo** de incidentes, alertas, monitores, logs, traces, recursos do Kubernetes, recursos do Docker e hosts.

Veja [Widgets](/docs/dashboards/widgets) para a lista completa e o que cada um mostra.

## Termos-chave

| Termo                  | Significado                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Painel**             | A página inteira — um nome, uma grade de widgets, controles de intervalo de tempo e uma lista de variáveis.        |
| **Widget**             | Um bloco na página — um gráfico, um número, uma lista, um parágrafo.                                               |
| **Variável**           | Um dropdown no topo que filtra todos os widgets de uma vez (cluster, serviço, cliente, ambiente).                  |
| **Intervalo de tempo** | A janela de tempo usada por todos os gráficos e números. Defina uma vez no topo da página.                         |
| **Atualização**        | Com que frequência os widgets reconsultam os dados. Desligado, a cada poucos segundos, a cada poucos minutos.      |
| **Modo**               | Pode ser **Edição** (arrastar widgets pela página) ou **Visualização** (somente leitura, como os visitantes veem). |

## Onde encontrar os painéis

Abra **Dashboards** na navegação à esquerda.

| Página                     | O que você faz nela                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------- |
| **Dashboards**             | Sua lista de painéis. Crie um novo, busque ou filtre por etiqueta.                      |
| **Painel → Visualizar**    | O canvas. Alterne entre **Edição** e **Visualização** no cabeçalho.                     |
| **Painel → Visão Geral**   | Descrição, donos e etiquetas.                                                           |
| **Painel → Configurações** | Compartilhamento público, senha, lista de IPs permitidos, domínio personalizado, marca. |
| **Painel → Donos**         | Usuários e equipes com acesso explícito.                                                |
| **Painel → Excluir**       | Remove o painel.                                                                        |

## Construindo um painel

1. **Crie** — escolha um nome. O canvas abre vazio.
2. **Adicione widgets** — escolha um tipo de widget, configure seus dados, arraste para onde quiser.
3. **(Opcional) Adicione variáveis** — por exemplo, um dropdown `service` para que o mesmo painel funcione para todos os serviços.
4. **Defina o intervalo de tempo** — os padrões já servem; ajuste depois.
5. **(Opcional) Compartilhe publicamente** — vire o interruptor em Configurações, adicione uma senha ou lista de IPs se necessário.
6. **(Opcional) Domínio personalizado** — hospede o painel em `status.seu-dominio.com`.

## Um exemplo rápido

Objetivo: uma página de plantão para o serviço de checkout com latência, taxa de erro, incidentes abertos e uma lista ao vivo de logs.

1. Crie um painel chamado "Checkout on-call."
2. Adicione uma variável `service`. Defina o padrão como `checkout`.
3. Adicione um widget de **Gráfico** com a latência P95, filtrado pela variável `service`.
4. Ao lado, adicione um widget de **Valor** para taxa de erro, com aviso em 1% e crítico em 5%.
5. Abaixo, adicione um widget de **Lista de Incidentes** para incidentes com a etiqueta `checkout`.
6. Embaixo, um widget de **Fluxo de Logs** mostrando logs do mesmo serviço.
7. Salve. Mude o dropdown para `payments` — o mesmo painel agora mostra o serviço de pagamentos.

## Como os painéis se encaixam no restante do OneUptime

- **Monitores e telemetria** são as fontes de dados. Toda métrica, log e trace que você coleta pode ser consultada em um widget.
- **Incidentes e alertas** aparecem nos widgets **Lista de Incidentes** e **Lista de Alertas**. Os painéis são somente leitura para esses — crie e atualize-os em outros lugares.
- **Páginas de status** são para comunicação voltada ao cliente ("o sistema está no ar?"). Os painéis são para olhar como o sistema está se comportando em detalhes. Os dois funcionam juntos, não se substituem.
- **Workflows** são como o OneUptime age. Painéis são como você lê o que está acontecendo.

## O que ler em seguida

- [Criando um Painel](/docs/dashboards/authoring) — usando o canvas, editando widgets.
- [Widgets](/docs/dashboards/widgets) — a lista completa de widgets.
- [Variáveis e Filtros](/docs/dashboards/variables) — fazendo um painel funcionar para muitos serviços ou clientes.
- [Compartilhamento e Painéis Públicos](/docs/dashboards/sharing) — URLs públicas, senhas, lista de IPs, domínios personalizados.
- [Configuração e Permissões](/docs/dashboards/configuration) — donos, etiquetas, controle de acesso.
