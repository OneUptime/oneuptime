#! /bin/sh
#
# run.sh

echo "${TIMEZONE}" > /etc/TZ 
cp /usr/share/zoneinfo/${TIMEZONE} /etc/localtime 
#init config when first running
if [[ ! -d  "${DATADIR}/config" ]];then
  haraka -i ${DATADIR}
 
  
  echo "listen=[::0]:${SMTP_PORT}" > ${DATADIR}/config/smtp.ini
  echo "nodes=cpus" >> ${DATADIR}/config/smtp.ini

  #enable spf,dkim and auth_flat_file
  echo "auth/flat_file" > ${DATADIR}/config/plugins
  touch ${DATADIR}/config/auth_flat_file.ini

  cat <<-EOF >> ${DATADIR}/config/auth_flat_file.ini
[core] 
methods=PLAIN,LOGIN,CRAM-MD5 
[users] 
${SMTP_USER}=${SMTP_PASSWORD} 
	EOF
fi

#start haraka
stat -c "%U" ${DATADIR}|grep -q smtp || chown -R smtp:smtp ${DATADIR}
exec haraka -c ${DATADIR}