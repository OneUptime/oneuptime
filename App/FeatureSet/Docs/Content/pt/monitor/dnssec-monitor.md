# Monitor de DNSSEC

O monitoramento DNSSEC permite validar a integridade criptográfica das respostas DNS para suas zonas. O OneUptime executa periodicamente uma validação DNSSEC completa: verifica registros DNSKEY, a delegação DS na zona pai, a validade das assinaturas RRSIG, o consenso dos resolvers sobre o flag AD e a consistência entre os nameservers autoritativos.

## Visão Geral

Os monitores DNSSEC validam toda a cadeia de confiança desde a zona raiz até o seu domínio. Isso permite que você:

- Detecte cadeias DNSSEC quebradas antes que os resolvers comecem a retornar SERVFAIL para seus usuários
- Receba avisos antes que as chaves de assinatura de zona expirem
- Verifique se seus registros DS estão publicados corretamente na zona pai
- Capture divergências entre nameservers autoritativos (primário/secundário fora de sincronia)
- Confirme se os resolvers validadores realmente definem o flag AD para sua zona

## Criando um Monitor DNSSEC

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **DNSSEC** como o tipo de monitor
4. Insira a zona (domínio) que deseja validar
5. Configure os resolvers e os critérios de monitoramento conforme necessário

## Opções de Configuração

### Configurações Básicas

| Campo                        | Descrição                                                                                                   | Obrigatório |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| Zone (Domain Name)           | A zona a ser validada via DNSSEC (ex.: `example.com`)                                                       | Sim         |
| Resolvers                    | Lista separada por vírgulas de resolvers validadores a consultar (ex.: `1.1.1.1, 8.8.8.8, 9.9.9.9`)         | Sim         |
| Check Nameserver Consistency | Consultar cada nameserver autoritativo diretamente e verificar se eles retornam o mesmo número de série SOA | Não         |

### Configurações Avançadas

| Campo                           | Descrição                                          | Padrão |
| ------------------------------- | -------------------------------------------------- | ------ |
| Signature Expiry Warning (days) | Limite padrão para o filtro de expiração RRSIG     | 7      |
| Timeout (ms)                    | Tempo de espera para cada consulta DNS             | 10000  |
| Retries                         | Número de tentativas de repetição em caso de falha | 3      |

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando sua zona é considerada online, degradada ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação                 | Descrição                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------- |
| DNSSEC Chain Is Valid               | Toda a cadeia de validação (raiz → TLD → zona) é resolvida corretamente     |
| DNSSEC DNSKEY Record Exists         | A zona publica pelo menos um registro DNSKEY                                |
| DNSSEC DS Record Exists At Parent   | A zona pai publica um registro DS correspondente à KSK da zona              |
| DNSSEC Signature Expires In Days    | Dias até que a próxima assinatura RRSIG expire                              |
| DNSSEC Resolver Consensus (AD Flag) | Cada resolver consultado retorna o flag AD (Authenticated Data)             |
| DNSSEC Nameservers Are Consistent   | Todos os nameservers autoritativos retornam o mesmo número de série SOA     |
| DNSSEC Is Valid                     | Resultado agregado de aprovação/falha em todas as verificações de validação |

### Tipos de Filtro

Para **DNSSEC Chain Is Valid**, **DNSSEC DNSKEY Record Exists**, **DNSSEC DS Record Exists At Parent**, **DNSSEC Resolver Consensus (AD Flag)**, **DNSSEC Nameservers Are Consistent** e **DNSSEC Is Valid**:

- **True** — Condição é verdadeira
- **False** — Condição é falsa

Para **DNSSEC Signature Expires In Days**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

### Critérios de Exemplo

#### Alertar se a cadeia DNSSEC estiver quebrada

- **Check On**: DNSSEC Chain Is Valid
- **Filter Type**: False

#### Avisar antes que as assinaturas expirem

- **Check On**: DNSSEC Signature Expires In Days
- **Filter Type**: Less Than
- **Value**: 7

#### Detectar DS ausente na zona pai (delegação quebrada)

- **Check On**: DNSSEC DS Record Exists At Parent
- **Filter Type**: False

#### Detectar desacordo entre resolvers

- **Check On**: DNSSEC Resolver Consensus (AD Flag)
- **Filter Type**: False

#### Detectar inconsistência entre nameservers

- **Check On**: DNSSEC Nameservers Are Consistent
- **Filter Type**: False

## Melhores Práticas

1. **Use múltiplos resolvers públicos** — Por padrão `1.1.1.1`, `8.8.8.8` e `9.9.9.9`, para que a indisponibilidade de um único resolver não cause falsos positivos
2. **Avise com bastante antecedência da expiração** — Configure alertas degradados com 7 dias e alertas offline com 2 dias antes da expiração da assinatura; rotações de chaves podem falhar silenciosamente
3. **Monitore cada zona assinada** — Inclua domínios apex, subdomínios assinados e qualquer zona delegada a um operador diferente
4. **Habilite verificações de consistência de nameservers** — Captura problemas de sincronização primário/secundário que a validação DNSSEC sozinha não detectaria, a menos que sua rede bloqueie o tráfego DNS de saída para IPs arbitrários
