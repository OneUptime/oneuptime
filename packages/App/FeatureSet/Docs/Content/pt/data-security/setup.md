# Configurar a Segurança de dados

A Segurança de dados lê só o que você permite. Cada conexão de nuvem é lida em um de três níveis, um banco de dados que você executa é lido com uma string de conexão que você fornece, e a telemetria não precisa de nada. Esta página diz o que cada escolha permite que o OneUptime leia, as permissões exatas que ela concede e o que o OneUptime guarda do que lê.

:::cards
- [Escolha um nível](#escolha-um-nível-para-cada-conexão): Desativado, Somente configuração, ou Configuração e amostras de conteúdo.
- [O que cada nível concede](#o-que-cada-nível-concede): As ações da AWS, e as funções do Azure e do Google Cloud.
- [Varrer um banco de dados que você executa](#varrer-um-banco-de-dados-que-você-executa): Uma string de conexão somente leitura, ou uma sonda na sua rede.
- [O que o OneUptime guarda](#o-que-o-oneuptime-guarda): Contagens, locais e amostras mascaradas, nunca um valor.
- [Deixe a Segurança de dados fechar uma exposição](#deixe-a-segurança-de-dados-fechar-uma-exposição): A única gravação que uma conexão pode receber, desativada até você ativá-la.
:::

## Escolha um nível para cada conexão

| Nível | No formulário | O que o OneUptime lê |
| --- | --- | --- |
| Desativado | **Desativado** | Nenhuma configuração nem conteúdo de repositório. A Segurança de dados ainda lista os repositórios que o seu inventário de nuvem conhece, com o que o inventário diz sobre eles: se um banco de dados RDS está criptografado, é público, está protegido contra exclusão e tem backup, e se uma tabela do DynamoDB pode ser restaurada para um ponto no tempo. |
| Configuração | **Somente configuração** | Como cada repositório de dados está configurado: quem pode acessá-lo, e como ele é criptografado, copiado em backup, versionado, registrado em logs, replicado e marcado com tags. Nunca dados, e nunca um segredo. |
| Conteúdo | **Configuração e amostras de conteúdo** | Isso, e amostras do que buckets do S3, contas de armazenamento do Azure, buckets do Cloud Storage e datasets do BigQuery contêm. |

Toda conexão começa em **Desativado**. [Conectar uma conta de nuvem](/docs/telemetry/cloud-accounts#segurança-de-dados) mostra o comando que cada nível executa em cada nuvem, palavra por palavra. Para mudar o nível de uma conexão:

:::steps
### Abra a conexão

Acesse **Nuvem → Conectar**. Escolha **Editar** na conexão, ou conecte uma conta nova.

### Escolha o nível

Em **Mais campos**, defina **Segurança de dados** como o nível que você quer.

### Execute o comando de novo

O comando que o formulário mostra muda com o nível. Execute-o no shell da sua nuvem, como fez ao conectar: ele concede o que o novo nível precisa, e nada mais. Depois selecione **Salvar alterações**, ou **Conectar** para uma conexão nova.
:::

As leituras no novo nível começam em até uma hora, e **Verificar agora** ou **Varrer agora** em um repositório inicia uma na hora. O OneUptime lê só o que o nível da conexão diz, seja o que for que a função ainda permita: baixe o nível, e as leituras param na hora. Para retirar também o acesso, execute o novo comando: na AWS ele substitui a política pela do nível mais baixo. **Desativado** não adiciona nada, então mantém o que um comando anterior concedeu. Remova isso você mesmo: na AWS com `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, e no Azure e no Google Cloud removendo as funções que o nível de conteúdo adicionou.

## O que cada nível concede

### Amazon Web Services

O nível de configuração coloca uma segunda política inline, `OneUptimeDataSecurity`, na função, ao lado da política somente leitura. Ela contém exatamente as ações de leitura que o leitor da segurança de dados chama. Cada uma lê uma configuração; nenhuma lê dados ou grava qualquer coisa:

| Para que o OneUptime as usa | Ações |
| --- | --- |
| Listar os buckets, e ler quem pode acessar cada um e como ele é criptografado, versionado, registrado em logs, copiado e marcado com tags | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Ler como os bancos de dados são acessados, criptografados e copiados em backup, e com quem os snapshots manuais deles são compartilhados | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Ler como os domínios de pesquisa, os caches e os sistemas de arquivos estão configurados | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Distinguir as chaves da própria AWS (alias/aws/...) das chaves que você gerencia | `kms:ListAliases` |

O nível de conteúdo adiciona três ações à mesma política, cada uma nos seus próprios recursos:

| Ação | Permitida em | Para que serve |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Listar os nomes dos objetos de um bucket |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Ler os primeiros bytes de um objeto amostrado |
| `kms:Decrypt` | `*`, só quando `kms:ViaService` é `s3.*.amazonaws.com` | Ler um objeto criptografado com uma chave do KMS, só por meio do S3: nunca uma descriptografia direta de qualquer outra coisa que a chave protege |

Com uma **Chave de acesso** em vez de uma função, a política vai para um grupo, `OneUptimeDataSecurity`, ao qual o usuário da chave é adicionado: o IAM limita as políticas inline do próprio usuário a 2.048 caracteres no total, e a política somente leitura ocupa a maior parte deles. Uma conexão que lê uma AWS Organization inteira coloca a mesma política na função de cada conta.

:::details A política completa no nível de conteúdo
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```
:::

### Microsoft Azure

O nível de configuração não adiciona nada: a função **Monitoring Reader** da conexão já lê a configuração de cada recurso pelo Azure Resource Manager. O nível de conteúdo adiciona a função integrada **Storage Blob Data Reader**, no mesmo escopo da conexão: a assinatura, ou o grupo de gerenciamento raiz do locatário.

### Google Cloud

O nível de configuração não adiciona nada: a função **Cloud Asset Viewer** da conexão já lê a configuração e a política do IAM de cada recurso. O nível de conteúdo adiciona duas funções, `roles/storage.objectViewer` e `roles/bigquery.dataViewer`, no projeto ou na organização, e ativa a API do BigQuery, `bigquery.googleapis.com`.

## Deixe a Segurança de dados fechar uma exposição

Ler é tudo o que uma conexão faz até você decidir o contrário. **Resposta de segurança de dados**, em **Mais campos** ao lado de **Segurança de dados**, também permite que a Segurança de dados bloqueie o acesso público de um repositório e pare de compartilhar os snapshots dele: a partir do problema do repositório, com **Corrigir daqui** (veja [Verificações e problemas da Segurança de dados](/docs/data-security/checks-and-issues#corrigir-daqui)), e a partir de playbooks do Security Operations. Ela fica em **Desativado** até você escolher **Bloquear acesso público e compartilhamento**, e o comando que o formulário mostra então concede uma única gravação restrita, separada das outras:

| Nuvem | O que o comando adiciona | O que ele pode fazer |
| --- | --- | --- |
| AWS | Uma terceira política inline, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` e `rds:ModifyDBClusterSnapshotAttribute`: o Block Public Access de um bucket, e com quem um snapshot manual é compartilhado |
| Azure | Uma função personalizada, `OneUptime Data Security Response`, no escopo da conexão | `Microsoft.Storage/storageAccounts/read` e `Microsoft.Storage/storageAccounts/write`: as configurações de uma conta de armazenamento, como o acesso anônimo a blobs, nunca as chaves dela |
| Google Cloud | Uma função personalizada, `oneuptimeDataSecurityResponse` | `storage.buckets.get` e `storage.buckets.update`: as configurações de um bucket, como a prevenção de acesso público |

Nada do que ela concede lê dados, exclui qualquer coisa ou muda quem pode entrar. Volte para **Desativado** e a Segurança de dados para de usá-la na hora. Para retirar também o acesso na AWS, exclua a política com `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Por que as amostras de conteúdo são opcionais

O nível de configuração encontra o que está exposto: um bucket público, um banco de dados aberto à internet, a falta de criptografia, de backups ou de logs de acesso. Ele não consegue dizer o que um repositório contém, então um repositório em que nada foi encontrado conta como Público, a sensibilidade mais baixa, e os problemas dele são tão graves quanto seriam para dados públicos. Um bucket público de imagens do site não é uma emergência; um bucket público de números de cartão é.

As amostras de conteúdo distinguem os dois. Elas definem a sensibilidade de cada repositório a partir do que ele contém, então o mesmo problema é Crítico com números de cartão e Baixo com imagens. Elas também encontram o que só o conteúdo mostra: segredos, códigos de segurança de cartão, senhas guardadas como foram digitadas e cópias de dados de produção em um repositório de teste.

Então a ordem que a maioria das equipes segue é: o nível de configuração em todo lugar, depois amostras de conteúdo onde você precisa saber o que um repositório contém. A varredura de conteúdo também pode ser desativada para um único repositório, com **Varrer conteúdo** nas **Configurações** do repositório, ou para o projeto inteiro.

## O que uma varredura de conteúdo lê

Uma varredura lê um pouco de um repositório, dentro dos limites do projeto, e para depois de 8 minutos, seja o que for que falte. A próxima continua dali: ela pula um objeto que não mudou desde que foi lido, a menos que isso tenha sido há 7 dias ou mais.

- **Buckets e contêineres** são amostrados por tipo, não por quantidade. Os nomes dos objetos são listados primeiro, no máximo dez vezes mais do que a varredura pode ler e nunca mais de 200.000. Cada nome vira o seu padrão, com datas, UUIDs, sequências hexadecimais longas e números transformados em `*`, então `exports/2026-10-27/users-0001.csv` vira `exports/*/users-*.csv`. Os objetos mais recentes de cada padrão são lidos, um de cada antes de um segundo de qualquer um, e no máximo 5 de um mesmo padrão. Cada objeto é lido desde o início: no máximo **Bytes por objeto** dele, e **Bytes por varredura** no total. Uma varredura amostra no máximo 10 contêineres de uma conta de armazenamento do Azure.
- **Os arquivos são lidos pelo que são.** CSV e TSV por coluna, JSON e JSON lines por caminho, `.env`, `.ini`, `.properties`, TOML e YAML por chave, XML e HTML pelo texto, arquivos do Word, Excel e PowerPoint pelo texto e pelas células, e qualquer outra coisa como texto livre. Um arquivo gzip é descompactado primeiro. Imagens, Parquet, Avro, PDF e outros formatos binários não são lidos, e a varredura diz isso.
- **Datasets e bancos de dados** são lidos tabela por tabela: no máximo **Tabelas por varredura** tabelas, e **Linhas por tabela** linhas de cada uma.

Cada varredura guarda um registro do que leu, por nome: os objetos, tabelas ou serviços, nunca o conteúdo deles. O que ela não conseguiu ler - uma requisição que a nuvem recusou, o prazo, o limite de bytes - vira um aviso na varredura, e a varredura é marcada como **Concluído parcialmente**.

## Varrer um banco de dados que você executa

A Segurança de dados amostra bancos de dados PostgreSQL e MySQL, de uma de duas formas. Um banco de dados que o produto Database monitora, ou um com que os seus serviços se comunicam no mapa de serviços, já é um repositório. Um banco de dados que nenhuma varredura encontra, adicione você mesmo como repositório.

- **A partir dos workers do OneUptime.** Nas **Configurações** do repositório, defina **String de conexão** como uma que só possa ler, como `postgresql://reader:password@db.internal:5432/app`. Ela é criptografada em repouso e nunca é retornada pela API. Use para ela um usuário de banco de dados que possa ler e não faça mais nada.
- **A partir de uma sonda na sua rede.** Escolha a sonda em **Varrer a partir da sonda**, e informe em **Variável de conexão da sonda** o nome da variável de ambiente, nessa sonda, que contém a string de conexão. A sonda lê o banco de dados de dentro da sua rede e envia de volta só o que encontrou: a string de conexão nunca chega ao OneUptime. Veja [Sondas personalizadas](/docs/probe/custom-probe) para executar uma sonda.

## O que o OneUptime guarda

Para cada tipo de dados encontrado em cada local - uma coluna, um campo, um padrão de objeto, um atributo de telemetria - uma descoberta guarda:

- quantos valores amostrados o continham, de quantos, e quantos deles eram valores de teste conhecidos;
- quantos valores diferentes corresponderam, estimado a partir de hashes que ficam na memória do scanner e são descartados com a varredura;
- a confiança, e se o nome do local apontava para o tipo de dados;
- no máximo três amostras mascaradas, mascaradas dentro do scanner antes que qualquer coisa saia dele.

Ela nunca guarda um valor bruto. Cada tipo de valor é mascarado para que uma pessoa possa reconhecê-lo, nunca usá-lo:

| Valor | Amostra mascarada |
| --- | --- |
| Um endereço de e-mail | `j***@e******.com`: a primeira letra do nome e do domínio, e o rótulo de nível superior |
| Um número de cartão | `**** **** **** 4242`: os últimos quatro dígitos, como o PCI DSS permite que um cartão seja exibido |
| Um segredo | Os quatro primeiros e os quatro últimos caracteres quando é longo, os dois primeiros quando é curto, e só o cabeçalho de uma chave privada |
| Uma URL ou string de conexão | Tudo, exceto a senha |
| Um endereço IP | A primeira parte, a rede, com o resto oculto |
| Um valor encontrado pelo nome | O primeiro caractere, seguido de `****` |
| Uma marcação de documento | A marcação como está escrita, como "Confidential": ela diz o que o documento é |
| Qualquer outra coisa | Os dois a quatro últimos caracteres, com os separadores mantidos, como `***-**-6789` |

Desative **Manter amostras mascaradas** nas configurações do projeto para guardar só contagens: a partir da próxima varredura de cada repositório, as descobertas que ela grava não guardam amostras.

As cópias de dados entre repositórios são encontradas por impressões digitais, não por valores: 128 números de 16 bits para cada tipo de dados, com hash feito com uma chave do próprio projeto (veja [Como as impressões digitais permanecem privadas](/docs/data-security/flows-access-residency#como-as-impressões-digitais-continuam-privadas)).

Uma descoberta conta para o seu repositório por 30 dias depois que uma varredura a viu pela última vez, já que uma amostra pode deixar passar o que ainda está lá. Uma descoberta não vista por 90 dias é excluída. Um repositório guarda no máximo 2.000 descobertas.

## Configurações

As configurações da Segurança de dados são um único conjunto por projeto, na seção **Configurações** do menu da Segurança de dados. Elas começam com estes padrões:

| Configuração | Padrão | O que faz |
| --- | --- | --- |
| **Verificar configuração** | Ativado | Executa as verificações em cada repositório. Desativada, nenhum problema abre, muda ou fecha. |
| **Varrer conteúdo** | Ativado | Amostra o conteúdo dos repositórios onde a permissão de conteúdo foi concedida. |
| **Varrer telemetria** | Ativado | Amostra os logs, traces, exceções, replays e conversas de IA do projeto. |
| **Manter amostras mascaradas** | Ativado | Guarda até três amostras mascaradas com cada descoberta. Desativada, guarda só contagens. |
| **Abrir casos de segurança** | Ativado | Abre um caso de segurança, agrupado por repositório, quando um problema Crítico abre. |
| **Gerar alertas** | Desativado | Gera um alerta, que aciona quem estiver de plantão, quando um problema Crítico abre. |
| **Severidade do alerta** | Vazio | A severidade desses alertas. Vazio é a mais grave do projeto. |
| **Notificar proprietários** | Ativado | Envia e-mail aos proprietários de um repositório quando um problema abre nele. |
| **Objetos por varredura** | 2.000 | O máximo de objetos que uma varredura de um bucket lê, de 10 a 50.000. |
| **Bytes por objeto** | 65.536 (64 KB) | O máximo de bytes lidos de um objeto, de 1.024 a 4.194.304. |
| **Bytes por varredura** | 52.428.800 (50 MB) | O máximo de bytes que uma varredura de conteúdo lê no total, de 65.536 a 1.073.741.824. |
| **Linhas por tabela** | 1.000 | O máximo de linhas lidas de uma tabela, de 10 a 100.000. |
| **Tabelas por varredura** | 200 | O máximo de tabelas que uma varredura lê, de 1 a 5.000. |
| **Tamanho da amostra de telemetria** | 500 | Quantos registros recentes de cada serviço e sinal uma varredura de telemetria lê, de 10 a 10.000. |
| **Varrer a cada (horas)** | 24 | Com que frequência o conteúdo de um repositório é amostrado de novo, de 1 a 720. |
| **Nunca sensível** | Vazio | Valores que nunca são descobertas, como o seu próprio endereço de suporte. |
| **Tipos de dados desativados** | Vazio | Tipos de dados integrados que as varreduras do projeto não procuram: os interruptores em **Tipos de dados integrados**. |

## Solução de problemas

:::details Um repositório diz que o conteúdo dele não foi varrido
A varredura diz por quê: "A varredura de conteúdo precisa da permissão de conteúdo da conexão, ou de uma string de conexão para um banco de dados." Defina a conexão do repositório como **Configuração e amostras de conteúdo** e execute o comando dela de novo, ou dê ao banco de dados uma string de conexão. Confira também se **Varrer conteúdo** está ativado para o repositório e nas configurações do projeto.
:::

:::details Uma verificação diz que não consegue determinar
Um fato que o leitor não conseguiu ler - uma permissão que a função não tem, uma API que não está ativada - é desconhecido, nunca presumido. A verificação dele informa que não consegue determinar, e um problema que ela abriu continua aberto: ninguém pode concluir que um problema foi corrigido porque o OneUptime não conseguiu olhar. Os avisos da leitura da configuração dizem o que ela não conseguiu ler. Execute o comando da conexão de novo para conceder o que falta.
:::

:::details Nenhum bucket do S3 nem dataset do BigQuery aparece
Eles vêm da leitura da configuração, não do inventário de nuvem. Defina a conexão como **Somente configuração** ou acima, e execute o comando dela de novo.
:::

:::details Uma varredura está marcada como Concluído parcialmente
Ela atingiu um limite antes de ler tudo: os 8 minutos, **Bytes por varredura** ou **Objetos por varredura**, ou uma requisição que a nuvem recusou. Os avisos dela dizem qual. A próxima varredura continua, pulando o que não mudou, ou aumente o limite.
:::

## Próximos passos

:::cards
- [Tipos de dados sensíveis](/docs/data-security/data-types): O que o scanner procura no que lê.
- [Verificações e problemas da Segurança de dados](/docs/data-security/checks-and-issues): O que é verificado na leitura da configuração.
- [Dados sensíveis na telemetria](/docs/data-security/telemetry): Os seus logs, traces e conversas de IA, que não precisam de configuração.
- [Conectar uma conta de nuvem](/docs/telemetry/cloud-accounts): Conecte a AWS, o Azure ou o Google Cloud, antes de tudo.
:::
