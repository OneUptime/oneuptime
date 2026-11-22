# Conformidade da Segurança de dados

A Segurança de dados pontua nove estruturas de conformidade a partir do que as varreduras dela encontraram. Cada estrutura cobre os repositórios de que tratam as regras dela - o RGPD, os repositórios que guardam dados pessoais; o PCI DSS, os repositórios em que foram encontrados dados de cartão; o SOC 2, todo repositório - e cada um dos requisitos dela é atendido ou não pelas verificações que servem de evidência para ele. **Segurança de dados → Conformidade** mostra a pontuação de cada estrutura, quantos repositórios ela cobre e cada requisito com quantos problemas abertos o reprovam. Cada recurso que contém repositórios de dados - um cluster do Kubernetes, um host do Docker ou do Podman, um banco de dados, um serviço ou um recurso de nuvem - tem a sua própria página igual a esta, onde você pode desativar o que não se aplica a ele. Uma pontuação é evidência para uma auditoria, não um certificado: ela diz o que o OneUptime consegue ver dos repositórios que lê.

:::cards
- [As estruturas de conformidade](#as-estruturas-de-conformidade): As nove, e quais repositórios cada uma cobre.
- [Como uma estrutura é pontuada](#como-uma-estrutura-é-pontuada): Requisitos aprovados, reprovados e não avaliados.
- [Na página de um recurso](#na-página-de-um-recurso): A conformidade de um cluster, host, banco de dados, serviço ou recurso de nuvem, e o que está desativado para ele.
- [Requisitos e as suas verificações](#requisitos-e-as-suas-verificações): Cada requisito, e as verificações que são evidência para ele.
- [Registro das atividades de tratamento](#registro-das-atividades-de-tratamento): O Artigo 30 do RGPD, escrito a partir dos seus repositórios.
:::

## As estruturas de conformidade

| Estrutura | Nome completo | Repositórios no escopo |
| --- | --- | --- |
| RGPD | Regulamento Geral sobre a Proteção de Dados da UE | Repositórios que guardam dados pessoais. |
| CCPA | California Consumer Privacy Act, com as alterações do CPRA | Repositórios que guardam informações pessoais. |
| HIPAA | HIPAA Security Rule | Repositórios que guardam dados de saúde. |
| PCI DSS | PCI DSS v4.0 | Repositórios em que foram encontrados números de cartão. |
| SOC 2 | SOC 2 Trust Services Criteria | Todo repositório de dados. |
| ISO 27001 | ISO/IEC 27001:2022 | Todo repositório de dados. |
| NIST CSF | NIST Cybersecurity Framework 2.0 | Todo repositório de dados. |
| LGPD | Lei Geral de Proteção de Dados do Brasil | Repositórios que guardam dados pessoais de pessoas no Brasil. |
| DPDP | Digital Personal Data Protection Act da Índia, de 2023 | Repositórios que guardam dados pessoais de pessoas na Índia. |

## Quais repositórios uma estrutura cobre

O escopo de um repositório vem dos dados encontrados nele, então ele muda à medida que as varreduras encontram mais:

- **SOC 2, ISO 27001 e NIST CSF** são estruturas de segurança: cobrem todo repositório, seja o que for que ele guarde.
- **RGPD, CCPA, HIPAA e PCI DSS** cobrem os repositórios que guardam um tipo de dados que elas protegem. Dados pessoais trazem o RGPD e a CCPA, dados de saúde também a HIPAA, e números de cartão, códigos de segurança de cartão e datas de validade de cartão trazem o PCI DSS. Um repositório que guarda só segredos ou documentos da empresa não está em nenhuma delas.
- **LGPD e DPDP** são leis próprias de países: cobrem os repositórios que guardam dados pessoais de pessoas no Brasil ou na Índia, lidos a partir de tipos de dados que pertencem a esse país, como um CPF brasileiro ou um número Aadhaar indiano.

[Tipos de dados sensíveis](/docs/data-security/data-types#tipos-de-dados-integrados) lista cada tipo de dados, com o seu país.

## Como uma estrutura é pontuada

```mermaid title="Como um requisito é decidido"
flowchart TB
    start["Um requisito da<br/>estrutura"] --> evaluated{"Algum repositório no escopo<br/>foi lido ou varrido?"}
    evaluated -->|"Não"| none["Não avaliado"]
    evaluated -->|"Sim"| open{"Há um problema aberto das<br/>verificações dele em um<br/>repositório no escopo?"}
    open -->|"Sim"| failing["Reprovado"]
    open -->|"Não"| passing["Aprovado"]
```

- **Um requisito é aprovado** quando nenhum problema aberto das verificações mapeadas para ele está em um repositório do escopo da estrutura, e **é reprovado** quando algum está.
- **Ele não é avaliado** enquanto nenhum repositório no escopo teve a configuração lida ou o conteúdo varrido.
- **Dois requisitos são atendidos pela própria Segurança de dados**: o Artigo 30 do RGPD, registros das atividades de tratamento, e o A.5.12 da ISO 27001, classificação da informação. Eles são aprovados assim que todo repositório no escopo foi lido ou varrido, e reprovados enquanto algum não foi.
- **Ele está desativado** quando todo repositório no escopo pertence a um recurso que desativou o requisito (veja [Na página de um recurso](#na-página-de-um-recurso)).
- **A pontuação** é a parcela dos requisitos avaliados de uma estrutura que são aprovados, como uma porcentagem inteira: um requisito desativado não conta nem a favor nem contra. Uma estrutura sem nada avaliado não tem pontuação.

Só os problemas abertos contam. Um problema cujo risco foi aceito, ou que não é um problema, não reprova os seus requisitos, então um risco aceito é uma decisão que a sua auditoria pode ver no problema: quem o aceitou, por quê e até quando.

## Na página de um recurso

O menu de um recurso tem uma seção **Segurança**, recolhida até você abri-la, quando o recurso contém um repositório de dados que a Segurança de dados conhece, em um projeto que usa a Segurança de dados e para quem pode ler repositórios de dados:

| Recurso | Os repositórios de dados dele |
| --- | --- |
| Cluster do Kubernetes | Os bancos de dados executados nele |
| Host do Docker ou do Podman | Os bancos de dados executados nele |
| Banco de dados | O próprio banco de dados |
| Serviço | A telemetria dele: os logs, traces e exceções que ele envia |
| Recurso de nuvem | O próprio recurso: um bucket, um banco de dados ou um data warehouse |

- **Segurança de dados** lista esses repositórios, os de maior risco primeiro, e os problemas abertos neles. Cada um abre na Segurança de dados, onde é tratado.
- **Conformidade** pontua as estruturas só para esses repositórios. As estruturas que os dados deles trazem para o escopo vêm primeiro; as desativadas, e aquelas para as quais nenhum desses repositórios guarda dados, ficam recolhidas abaixo.

Cada estrutura tem um interruptor, **Aplica-se aqui**, e cada um dos requisitos dela também. Desativar um deles deixa os repositórios do recurso fora dessa estrutura, ou desse requisito, na página do recurso e em **Segurança de dados → Conformidade**, que diz quantos repositórios foram desativados nos seus recursos. Ativá-lo de novo os traz de volta. Cada interruptor é salvo na hora, e cada mudança fica nos [Registros de auditoria](/docs/configuration/audit-logs) do projeto.

Desativar um deles faz aparecer, logo abaixo, a pergunta **Por que isto não se aplica aqui?** O motivo é opcional: escreva um motivo curto e escolha **Salvar motivo**, ou **Agora não** para deixar para depois. A partir daí, abaixo dele aparecem quem o desativou e quando, além do motivo, com **Adicionar motivo** ou **Editar motivo** para escrevê-lo ou alterá-lo depois. Assim como o interruptor, o motivo fica nos registros de auditoria.

**Segurança de dados → Conformidade** diz o mesmo para cada recurso. Uma estrutura escolhida lista, em **Desativado para a estrutura inteira**, os recursos que a desativaram por completo, e cada requisito mostra, abaixo do seu status, os recursos que desativaram esse requisito: cada um com um link para a própria página de Conformidade, com quem o desativou, quando e por quê. O **Exportar CSV** dela os traz em uma coluna `Turned Off On`, e o **Exportar JSON**, em uma lista `turnedOff`.

Um repositório segue os interruptores de um único recurso. Um banco de dados executado em um cluster do Kubernetes, ou em um host do Docker ou do Podman, segue os desse cluster ou host: desative uma estrutura para o cluster, e ela fica desativada para todo banco de dados nele. A própria página de Conformidade do banco de dados diz isso e leva à do cluster ou do host, com os interruptores dela bloqueados.

As funções Membro de segurança, Administrador de segurança, Administrador do projeto e Proprietário do projeto podem ativar e desativar estruturas e requisitos, como podem ajustar uma verificação. A função Visualizador de segurança vê o que está desativado e por quê.

## Requisitos e as suas verificações

### RGPD

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| Art. 5(1)(c) | Minimização dos dados | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| Art. 5(1)(e) | Limitação da conservação | `stale-sensitive-data` |
| Art. 25 | Proteção de dados desde a concepção e por padrão | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| Art. 28 | Operadores | `sensitive-data-to-ai` |
| Art. 30 | Registros das atividades de tratamento | Atendido pela própria Segurança de dados |
| Art. 32 | Segurança do tratamento | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `not-encrypted-at-rest`, `no-customer-managed-key`, `encryption-in-transit-not-enforced`, `weak-tls`, `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable`, `access-not-logged`, `shared-key-access`, `object-acls-enabled`, `many-readers`, `unused-access`, `secrets-stored`, `plaintext-passwords`, `secrets-in-telemetry` |
| Arts. 44-49 | Transferências para países terceiros | `residency-violation` |

### CCPA

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| 1798.100(c) | Coleta limitada ao necessário | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| 1798.150 | Procedimentos de segurança razoáveis | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `shared-key-access`, `object-acls-enabled`, `many-readers` |

### HIPAA

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| 164.308(a)(4) | Gestão do acesso à informação | `unused-access` |
| 164.308(a)(7) | Plano de contingência | `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable` |
| 164.312(a)(1) | Controle de acesso | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `shared-key-access`, `object-acls-enabled`, `many-readers` |
| 164.312(a)(2)(iv) | Criptografia e descriptografia | `not-encrypted-at-rest`, `no-customer-managed-key` |
| 164.312(b) | Controles de auditoria | `access-not-logged` |
| 164.312(e)(1) | Segurança da transmissão | `encryption-in-transit-not-enforced`, `weak-tls` |

### PCI DSS

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| 3.3.1 | Os dados de autenticação sensíveis não são guardados depois da autorização | `card-security-codes-stored` |
| 3.4.1 | Os números de cartão são mascarados quando exibidos | `card-numbers-readable`, `sensitive-data-in-telemetry` |
| 3.5.1 | Os números de cartão ficam ilegíveis onde quer que sejam armazenados | `not-encrypted-at-rest`, `no-customer-managed-key`, `card-numbers-readable` |
| 4.2.1 | Criptografia forte protege os dados de cartão em trânsito | `encryption-in-transit-not-enforced`, `weak-tls` |
| 7.2 | O acesso é definido e atribuído conforme a necessidade | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `shared-key-access`, `object-acls-enabled`, `many-readers` |
| 7.2.4 | As contas e os acessos delas são revisados | `unused-access` |
| 8.3.2 | Os fatores de autenticação ficam ilegíveis quando armazenados | `plaintext-passwords` |
| 10.2 | Os logs de auditoria registram o acesso aos dados de cartão | `access-not-logged` |

### SOC 2

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| A1.2 | Backup e recuperação | `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable` |
| CC6.1 | Segurança do acesso lógico | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `not-encrypted-at-rest`, `no-customer-managed-key`, `shared-key-access`, `object-acls-enabled`, `many-readers`, `secrets-stored`, `plaintext-passwords`, `secrets-in-telemetry` |
| CC6.2 | O acesso é removido quando não é mais necessário | `unused-access` |
| CC6.7 | Transmissão de informações | `encryption-in-transit-not-enforced`, `weak-tls` |
| CC7.2 | Monitoramento dos componentes do sistema | `access-not-logged` |

### ISO 27001

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| A.5.9 | Inventário de informações e outros ativos associados | `no-owner` |
| A.5.12 | Classificação da informação | Atendido pela própria Segurança de dados |
| A.5.15 | Controle de acesso | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `shared-key-access`, `object-acls-enabled`, `many-readers` |
| A.5.18 | Direitos de acesso | `unused-access` |
| A.5.34 | Privacidade e proteção de PII | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| A.8.11 | Mascaramento de dados | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| A.8.12 | Prevenção de vazamento de dados | `secrets-stored`, `secrets-in-telemetry` |
| A.8.13 | Backup das informações | `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable` |
| A.8.15 | Registro em logs | `access-not-logged` |
| A.8.24 | Uso de criptografia | `not-encrypted-at-rest`, `no-customer-managed-key`, `encryption-in-transit-not-enforced`, `weak-tls`, `plaintext-passwords` |

### NIST CSF

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| ID.AM-07 | Inventários de dados e metadados são mantidos | `no-owner` |
| PR.AA-05 | As permissões de acesso são gerenciadas | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `shared-key-access`, `object-acls-enabled`, `many-readers`, `unused-access` |
| PR.DS-01 | Os dados em repouso são protegidos | `not-encrypted-at-rest`, `no-customer-managed-key`, `secrets-stored`, `secrets-in-telemetry` |
| PR.DS-02 | Os dados em trânsito são protegidos | `encryption-in-transit-not-enforced`, `weak-tls` |
| PR.DS-11 | Backups dos dados são mantidos e testados | `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable` |
| DE.CM-09 | Os dados e o seu uso são monitorados | `access-not-logged` |

### LGPD

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| Art. 6 | Necessidade e limitação da finalidade | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| Art. 33 | Transferência internacional de dados | `residency-violation` |
| Art. 46 | Medidas de segurança | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `not-encrypted-at-rest`, `no-customer-managed-key`, `shared-key-access`, `object-acls-enabled`, `many-readers` |

### DPDP

| Requisito | O que exige | Verificações |
| --- | --- | --- |
| Sec. 8(5) | Salvaguardas de segurança razoáveis | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `not-encrypted-at-rest`, `no-customer-managed-key`, `shared-key-access`, `object-acls-enabled`, `many-readers` |
| Sec. 8(7) | Eliminação quando a finalidade é cumprida | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| Sec. 16 | Transferência para fora da Índia | `residency-violation` |

## Registro das atividades de tratamento

O Artigo 30 do RGPD pede que você mantenha um registro das suas atividades de tratamento. A Segurança de dados escreve a parte dele que trata de onde os dados pessoais são guardados: uma linha para cada repositório que guarda dados pessoais. Ele é o cartão **Registro das atividades de tratamento** no fim de **Segurança de dados → Conformidade**, com **Exportar CSV** e **Exportar JSON**.

| Coluna | De onde vem |
| --- | --- |
| Repositório, tipo, provedor e região | Discovery |
| Ambiente | As tags ou o nome do repositório, ou o que você definiu |
| Sensibilidade, categorias e tipos de dados | O que as varreduras encontraram, ou a sensibilidade que você definiu |
| Proprietários | Os proprietários do repositório, pessoas e os membros das equipes dele |
| Finalidade | O que você escreve em **Finalidade** no repositório: por que ele guarda dados pessoais. O OneUptime a preenche nos repositórios que guarda para a sua segurança |
| Retenção | O que você escreve em **Retenção** no repositório: por quanto tempo os dados ficam nele. O OneUptime a preenche nos repositórios que guarda para a sua segurança |
| Quem pode ler | Quem pode ler um repositório que o OneUptime guarda para a sua segurança |
| Estruturas de conformidade | As estruturas que os tipos de dados dele trazem para o escopo |
| Declarado por | OneUptime, nos repositórios que guarda para a sua segurança |

Em um repositório que a Segurança de dados encontrou, preencha **Finalidade** e **Retenção** nas **Configurações** dele: nenhuma varredura consegue saber isso. O registro e as pontuações também são fornecidos pela API da Segurança de dados, em `/data-security/record-of-processing`, `/data-security/compliance` e, para um único recurso, `/data-security/resource-compliance`, para quem pode ler repositórios de dados (veja [Integrações da Segurança de dados](/docs/data-security/integrations#api-terraform-e-mcp)).

### Repositórios que o OneUptime guarda para a sua segurança

Três repositórios guardam endereços IP de propósito, para proteger a sua rede: **Eventos de segurança**, **Network Flows** e **Cofre de endereços de segurança**. O registro lista cada um que o seu projeto tem. O OneUptime os declara em vez de encontrá-los: o que eles guardam é conhecido por projeto, então nenhuma varredura os lê, nenhuma verificação se aplica a eles e guardar esses endereços nunca é um problema, pois é para isso que existem. Eles mostram **Declarado pelo OneUptime** em **Repositórios de dados**, e a **Visão geral** e as pontuações das estruturas os deixam de fora.

| Repositório | O que guarda | Retenção | Quem pode lê-lo |
| --- | --- | --- | --- |
| Eventos de segurança | Os endereços IP, nomes de usuário e endereços de e-mail de quem agiu e do que foi tocado | A [retenção de telemetria](/docs/telemetry/data-retention) do seu projeto, lida sempre que o registro é lido, então uma mudança vale na hora | Proprietários do projeto, Administradores do projeto, Administradores de segurança, Membros de segurança, Visualizadores de segurança e quem tiver Read Security Event |
| Network Flows | Os endereços IP de quem se comunicou com quem | 30 dias depois de um fluxo chegar | Quem pode ler dispositivos de rede |
| Cofre de endereços de segurança | O endereço IP por trás de cada token deixado por uma regra de endereço IP que aplica hash nos logs e traces que os [Eventos de segurança](/docs/telemetry/security-events) leem | 30 dias depois da última vez em que um endereço foi visto | Somente as varreduras de Eventos de segurança, dentro do OneUptime: nenhuma pessoa, página, exportação, API ou ferramenta de IA |

A finalidade de cada um é "Segurança das redes e da informação (considerando 49 do RGPD)". Para escrever a sua própria finalidade ou retenção, use **Editar registro** nas **Configurações** do repositório: um campo deixado em branco mantém a do OneUptime.

Um repositório é listado enquanto o seu projeto guarda os dados dele: o cofre, enquanto uma regra de endereço IP ativada aplica hash aos logs ou traces que os Eventos de segurança leem, e por mais 31 dias (veja [Mascarar dados sensíveis](/docs/telemetry/drop-filters-and-scrub-rules#mascarar-dados-sensíveis)). Quando os dados dele acabam, o repositório é arquivado e volta com a sua finalidade e a sua retenção se os dados voltarem.

## Próximos passos

:::cards
- [Verificações e problemas da Segurança de dados](/docs/data-security/checks-and-issues): As verificações por trás de cada requisito, e como corrigi-las.
- [Fluxos de dados, acesso e residência](/docs/data-security/flows-access-residency): Regras de residência, para as transferências do RGPD, da LGPD e da DPDP.
- [Tipos de dados sensíveis](/docs/data-security/data-types): Os tipos de dados que trazem um repositório para o escopo de uma estrutura.
:::
