

# Setup auth
echo "domain = $DOMAIN" >> /harakaapp/config/dkim_sign.ini
echo "$DOMAIN" > /harakaapp/config/host_list
echo "$DOMAIN" > /harakaapp/config/me
echo "$SMTP_USERNAME=$SMTP_PASSWORD" >> /harakaapp/config/auth_flat_file.ini

openssl req -x509 -nodes -days 2190 -newkey rsa:2048 -keyout /harakaapp/config/tls_key.pem -out /harakaapp/config/tls_cert.pem -subj "/C=US/ST=Massachusetts/L=Boston/O=Hackerbay/CN=$DOMAIN"

# DKIM
mkdir -p /harakaapp/config/dkim/$DOMAIN
touch /harakaapp/config/dkim/$DOMAIN/selector
echo "$DKIM_SELECTOR" > /harakaapp/config/dkim/$DOMAIN/selector

# Decode keys from base64
echo "$DKIM_PUBLIC_KEY" | base64 -d > /harakaapp/config/dkim/$DOMAIN/public
echo "$DKIM_PRIVATE_KEY" | base64 -d > /harakaapp/config/dkim/$DOMAIN/private

echo "IMPORTANT: Add this to your DNS"
echo "You need to add this to DNS" 
echo "Type: TXT" 
echo "Key: $DKIM_SELECTOR._domainkey"
echo "v=DKIM1;p=$(grep -v '^-' /harakaapp/config/dkim/$DOMAIN/public | tr -d '\n')"

# Run haraka
haraka -c /harakaapp