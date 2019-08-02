curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache" \
        -H "X-Auth-Email: ${CF_EMAIL}" \
        -H "X-Auth-Key: ${CF_API_KEY}" \
        -H "Content-Type: application/json" \
        --data '{"purge_everything":true}'