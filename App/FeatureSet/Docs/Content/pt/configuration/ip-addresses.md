# Lista de Permissões de Endereços IP para OneUptime.com

Se você estiver usando o OneUptime.com e quiser adicionar nossos IPs à lista de permissões por razões de segurança, pode fazê-lo seguindo as instruções abaixo.

Por favor, adicione os seguintes IPs à lista de permissões do seu firewall para permitir que o oneuptime.com acesse seus recursos.

{{IP_WHITELIST}}

Esses IPs podem mudar; informaremos com antecedência se isso acontecer.

## Obter Endereços IP Programaticamente

Você também pode buscar a lista de endereços IP de saída dos probes programaticamente via o seguinte endpoint de API:

```
GET https://oneuptime.com/ip-whitelist
```

Isso retorna uma resposta JSON:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

Você pode usar este endpoint para manter sua lista de permissões do firewall atualizada automaticamente.
