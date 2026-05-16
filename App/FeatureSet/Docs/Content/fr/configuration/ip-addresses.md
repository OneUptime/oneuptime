# Liste d'autorisation des adresses IP pour OneUptime.com

Si vous utilisez OneUptime.com et souhaitez autoriser nos adresses IP pour des raisons de sécurité, vous pouvez le faire en suivant les instructions ci-dessous.

Veuillez autoriser les adresses IP suivantes dans votre pare-feu pour permettre à oneuptime.com d'accéder à vos ressources.

{{IP_WHITELIST}}

Ces adresses IP peuvent changer ; nous vous en informerons à l'avance si cela se produit.

## Récupération des adresses IP de manière programmatique

Vous pouvez également récupérer la liste des adresses IP de sortie des sondes de manière programmatique via le point de terminaison API suivant :

```
GET https://oneuptime.com/ip-whitelist
```

Cela retourne une réponse JSON :

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

Vous pouvez utiliser ce point de terminaison pour maintenir automatiquement votre liste d'autorisation de pare-feu à jour.
