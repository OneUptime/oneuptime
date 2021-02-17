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

    # setup bounce message template
  cat <<-EOF >>${DATADIR}/config/outbound.bounce_message
Received: (Haraka {pid} invoked for bounce); {date}
Date: {date}
From: mailer-daemon@${DOMAIN}
To: {to}
Auto-Submitted: auto-replied
Subject: failure notice
Message-Id: {msgid}

Hi. This is the Haraka Mailer program at {me}.
I'm afraid I wasn't able to deliver your message
    "{subject}"
to the following addresses.
This is a permanent error; I've given up. Sorry it didn't work out.

Intended Recipients: {recipients}
Failure Reason: {reason}

{extended_reason}
EOF

  cat <<-EOF >>${DATADIR}/config/outbound.bounce_message_html
    <html>
      <head>
        <style>
        * {
        font-family:Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
        }
        </style>
      </head>
      <body>
        <table cellpadding="0" cellspacing="0" class="email-wrapper" style="padding-top:32px;background-color:#ffffff;"><tbody>
        <tr><td>
        <table cellpadding=0 cellspacing=0><tbody>
        <tr><td style="max-width:560px;padding:24px 24px 32px;background-color:#fafafa;border:1px solid #e0e0e0;border-radius:2px">
        <img style="padding:0 24px 16px 0;float:left" width=72 height=72 alt="Foutpictogram" src="cid:icon.png">
        <table style="min-width:272px;padding-top:8px"><tbody>
        <tr><td><h2 style="font-size:20px;color:#212121;font-weight:bold;margin:0">
        Message not delivered
        </h2></td></tr>
        <tr><td style="padding-top:20px;color:#757575;font-size:16px;font-weight:normal;text-align:left">
        A problem has occurred when trying to deliver your mail to <a style='color:#212121;text-decoration:none'><b>{recipients}</b></a> . Look below for the technical details.
        </td></tr>
        </tbody></table>
        </td></tr>
        </tbody></table>
        </td></tr>
        <tr style="border:none;background-color:#fff;font-size:12.8px;width:90%">
        <td align="left" style="padding:48px 10px">
        Reaction of the server: <br/>
        <p style="font-family:monospace">
        {reason}
        </p>
        </td>
        </tr>
        </tbody></table>
      </body>
    </html>
EOF

  cat <<-EOF >>${DATADIR}/config/outbound.bounce_message_image
Content-Type: image/png; name="icon.png"
Content-Disposition: attachment; filename="icon.png"
Content-Transfer-Encoding: base64
Content-ID: <icon.png>

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
EOF

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
  cat <<-EOF >${DATADIR}/config/log.ini
	level=${LOGLEVEL}
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
