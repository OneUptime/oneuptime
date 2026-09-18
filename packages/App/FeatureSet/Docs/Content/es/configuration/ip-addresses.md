# Lista de IPs permitidas para OneUptime.com

Si utilizas OneUptime.com y deseas incluir nuestras IPs en la lista de permitidas por razones de seguridad, puedes hacerlo siguiendo las instrucciones a continuación.

Por favor, incluye las siguientes IPs en la lista de permitidas de tu firewall para que oneuptime.com pueda alcanzar tus recursos.

{{IP_WHITELIST}}

Estas IPs pueden cambiar; te avisaremos con antelación si esto ocurre.

## Obtener las direcciones IP de forma programática

También puedes obtener la lista de direcciones IP de salida de las sondas de forma programática a través del siguiente punto de conexión de la API:

```
GET https://oneuptime.com/ip-whitelist
```

Esto devuelve una respuesta JSON:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

Puedes usar este punto de conexión para mantener actualizada tu lista de IPs permitidas en el firewall automáticamente.
