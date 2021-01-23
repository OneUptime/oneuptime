#!/bin/sh

DOMAIN="$1"
SMTPD="$2"

usage()
{
    echo "   usage: ${0} <example.com> [haraka username]" 2>&1
    echo 2>&1
    exit 1
}

if [ -z "$DOMAIN" ]; then
    usage
fi

if [ -z "$SMTPD" ]; then
    SMTPD="www"
fi

# Create a directory for each DKIM signing domain
mkdir -p "$DOMAIN"
cd "$DOMAIN" || exit

# The selector can be any value that is a valid DNS label
# Create in the common format: mmmYYYY (apr2014)
date '+%h%Y' | tr '[:upper:]' '[:lower:]' > selector

# Generate private and public keys
#           - Key length considerations -
# The minimum recommended key length for short duration keys (ones that
# will be replaced within a few months) is 1024. If you are unlikely to
# rotate your keys frequently, choose 2048, at the expense of more CPU.
openssl genrsa -out private 2048
chmod 0400 private
openssl rsa -in private -out public -pubout

DNS_NAME="$(tr -d '\n' < selector)._domainkey"
DNS_ADDRESS="v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"

# Fold width is arbitrary, any value between 80 and 255 is reasonable
BIND_SPLIT_ADDRESS="$(echo "$DNS_ADDRESS" | fold -w 110 | sed -e 's/^/	"/g; s/$/"/g')"

# Make it really easy to publish the public key in DNS
# by creating a file named 'dns', with instructions
cat > dns <<EO_DKIM_DNS

Add this TXT record to the ${DOMAIN} DNS zone.

${DNS_NAME}    IN   TXT   ${DNS_ADDRESS}


BIND zone file formatted:

${DNS_NAME}    IN   TXT (
${BIND_SPLIT_ADDRESS}
        )

Tell the world that the ONLY mail servers that send mail from this domain are DKIM signed and/or bear our MX and A records.

With SPF:

        SPF "v=spf1 mx a -all"
        TXT "v=spf1 mx a -all"

With DMARC:

_dmarc  TXT "v=DMARC1; p=reject; adkim=s; aspf=r; rua=mailto:dmarc-feedback@${DOMAIN}; ruf=mailto:dmarc-feedback@${DOMAIN}; pct=100"

For more information about DKIM and SPF policy,
the documentation within each plugin contains a longer discussion and links to more detailed information:

   haraka -h dkim_sign
   haraka -h spf

EO_DKIM_DNS

cd ..
