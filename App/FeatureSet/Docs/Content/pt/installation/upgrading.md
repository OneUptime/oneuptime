# Atualizando o OneUptime

Este guia aborda como atualizar com segurança a sua instalação auto-hospedada do OneUptime.

## Orientação Geral

- Atualize passo a passo entre versões principais (por exemplo, 6 → 7 → 8). Não pule versões principais.
- Você pode pular versões menores/de patch (por exemplo, 8.1 → 8.4), desde que siga as notas de lançamento.
- Sempre faça backups antes de atualizar e valide se você consegue restaurá-los.

## Atualizando do OneUptime 8 → 9

O Helm chart não provisiona mais um recurso Kubernetes Ingress. O OneUptime fornece um contêiner de gateway de ingress que já encerra TLS, gerencia domínios de páginas de status e roteia tráfego para a plataforma, portanto, um controlador de ingress de cluster não é mais necessário.

- Remova quaisquer substituições `oneuptimeIngress` dos seus arquivos `values.yaml` personalizados antes de atualizar. Essas chaves agora são ignoradas e causarão erros de validação se mantidas.
- Certifique-se de que `nginx.service.type` reflita como você deseja expor o gateway de ingress integrado (por exemplo, `LoadBalancer`, `NodePort` ou `ClusterIP` com um balanceador de carga externo).
- Verifique se quaisquer registros DNS para páginas de status ou hosts primários ainda apontam para o Service ou balanceador de carga que está à frente do gateway de ingress do OneUptime.
- Após a atualização, confirme que os certificados TLS continuam a ser renovados via gateway integrado e que os domínios de páginas de status resolvem corretamente.


## Atualizando do OneUptime 7 → 8

Se você estiver executando no Kubernetes, há mudanças importantes:

- Não usamos mais charts do Bitnami para Postgres, Redis e ClickHouse por causa das [Mudanças de Licença do Bitnami](https://github.com/bitnami/charts/issues/35164)
- Essas mudanças não são retrocompatíveis. Você deve seguir a nova estrutura no `values.yaml` do Helm chart.
- Faça backup dos seus dados (Postgres, ClickHouse e quaisquer volumes persistentes) antes de atualizar.


> Dica: Teste a atualização em um ambiente de staging primeiro. Confirme que suas cargas de trabalho estão saudáveis e os dados estão intactos antes de atualizar a produção.
