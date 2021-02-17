#! /bin/sh
#
# haraka.sh

echo "${TIMEZONE}" >/etc/TZ
cp /usr/share/zoneinfo/${TIMEZONE} /etc/localtime

initDkim() {
  # Create a directory for each DKIM signing domain
  mkdir -p "$DOMAIN"
  cd "$DOMAIN" || exit

  # The selector can be any value that is a valid DNS label
  echo 'fyipe' >selector

  # Generate private and public keys
  #           - Key length considerations -
  # The minimum recommended key length for short duration keys (ones that
  # will be replaced within a few months) is 1024. If you are unlikely to
  # rotate your keys frequently, choose 2048, at the expense of more CPU.
  #
  # grab the generated private key and write it to private file
  # DKIM_PRIVATE_KEY must be in base64 for this to work
  # This is a workaround for issue with passing private key through env
  (echo $DKIM_PRIVATE_KEY | base64 -d) >private

  chmod 0400 private
  openssl rsa -in private -out public -pubout

  DNS_NAME="$(tr -d '\n' <selector)._domainkey"
  DNS_ADDRESS="v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"

  cd ..
}

#run if there is no existing haraka config
if [[ ! -d "${DATADIR}/config" ]]; then
  haraka -i ${DATADIR}

  if [[ -n "$DOMAIN" ]]; then
    echo "$DOMAIN" >${DATADIR}/config/host_list
    echo "$DOMAIN" >${DATADIR}/config/me
  fi

  #enable toobusy plugin
  sed -i 's/^#toobusy$\?/toobusy/g' ${DATADIR}/config/plugins

  sed -i 's/^#relay$\?/relay/g' ${DATADIR}/config/plugins

  #smtp
  sed -i "s/^;listen=\[::0\]:25$\?/listen=\[::0\]:${SMTP_PORT}/g" ${DATADIR}/config/smtp.ini

  echo "true" >${DATADIR}/config/header_hide_version
  echo "$HEADER" >${DATADIR}/config/ehlo_hello_message

  #enable spf
  sed -i 's/^#spf$\?/spf/g' ${DATADIR}/config/plugins
  sed -i '/max_unrecognized_commands/d' ${DATADIR}/config/plugins

  if [[ -n "$TLS_KEY" ]] && [[ -n "$TLS_CERT" ]]; then
    #enable tls
    # grab tls_key and tls_cert values from the env and generate the relevant files
    # TLS_KEY AND TLS_CERT env must be an encoded base64 for this to work
    (echo $TLS_KEY | base64 -d) >${DATADIR}/config/tls_key.pem
    (echo $TLS_CERT | base64 -d) >${DATADIR}/config/tls_cert.pem

    #enable tls
    sed -i "s/^#\s*tls/tls/" ${DATADIR}/config/plugins

    cat <<-EOF >>${DATADIR}/config/tls.ini
	[outbound]
    key=tls_key.pem
    cert=tls_cert.pem
    dhparam=dhparams.pem
	EOF

  fi

  if [[ -n "$DKIM_PRIVATE_KEY" ]] && [[ -n "$DOMAIN" ]]; then
    #enable dkim sign
    sed -i 's/^#dkim_sign$\?/dkim_sign/g' ${DATADIR}/config/plugins

    cd ${DATADIR}/config/dkim/
    initDkim
    cd -

    selector=$(cat ${DATADIR}/config/dkim/${DOMAIN}/selector)
    cat <<-EOF >>${DATADIR}/config/dkim_sign.ini
	disabled = false
	selector = $selector
	domain=$DOMAIN
  headers_to_sign = From, Sender, Reply-To, Subject, Date, Message-ID, To, Cc, MIME-Version
	dkim.private.key=${DATADIR}/config/dkim/${DOMAIN}/private
	EOF

  fi

  #enable outbound
  cat <<-EOF >>${DATADIR}/config/outbound.ini
	relaying = true
	received_header = ${HEADER}
	received_header_disabled=true
	EOF

  #enable log
  cat <<-EOF >>${DATADIR}/config/log.ini
	loglevel=${LOGLEVEL}
	timestamps=false
	format=logfmt
	EOF

  #enable spf
  cat <<-EOF >>${DATADIR}/config/spf.ini
	[relay]
	context=sender
	context=myself
	EOF

  #enable data.header check
  cat <<-EOF >>${DATADIR}/config/data.headers.ini
	[check]
	duplicate_singular=true
	missing_required=true
	invalid_return_path=true
	invalid_date=true
	user_agent=true
	direct_to_mx=true
	from_match=true
	mailing_list=true
	delivered_to=true
	[reject]
	missing_required=true
	invalid_date=true
	EOF

  #enable auth_flat_file
  sed -i "s/^#\s*auth\/flat_file/auth\/flat_file/" ${DATADIR}/config/plugins

  cat <<-EOF >>${DATADIR}/config/auth_flat_file.ini
	[core]
	methods=PLAIN,LOGIN,CRAM-MD5
	[users]
    ${SMTP_USER}=${SMTP_PASSWORD}
	EOF

fi

#start haraka
stat -c "%U" ${DATADIR} | grep -q smtp || chown -R smtp:smtp ${DATADIR}
exec haraka -c ${DATADIR}
