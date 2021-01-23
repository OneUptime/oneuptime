# Haraka Plugins

To create your own plugin, see:

-   the [plugin template][template] that includes all the boilerplate
-   the [Write a Plugin][write-plugin] tutorial
-   the [Plugins](plugins-doc) section of [the manual](https://haraka.github.io)

## Installing NPM packaged plugins

NPM packaged plugins can be installed in the `npm` directory where Haraka was installed (where depends on your OS platform and whether you specified `-g`) or the Haraka install directory (haraka -i this*path). This example installs \_my-great-plugin* in the Haraka install directory:

```
cd /etc/haraka
npm install haraka-plugin-my-great-plugin
```

NPM then installs the plugin and its dependencies in a `node_modules` directory within the Haraka install directory.

## Plugin Registry

A mostly comprehensive list of plugins known to be working and maintained.
Create a PR adding yours to this list.

| Plugin                                     | Description                                                        |
| ------------------------------------------ | ------------------------------------------------------------------ |
| [access][url-access]                       | ACLs based on IPs, domains, email addrs, etc.                      |
| [accounting_files][url-acc-files]          | Retrieve, Store and Archive custom information of outbound traffic |
| [aliases][url-aliases]                     | Email aliases                                                      |
| [ASN][url-asn]                             | Get ASN info for remote senders                                    |
| [attachment][url-attach]                   | Restrict attachment types                                          |
| [auth-enc-file][url-authencflat]           | Auth against user/pass in an encrypted file                        |
| auth/[flat_file][url-authflat]             | Auth against user/pass in a file                                   |
| auth/[auth_bridge][url-authbridge]         | Auth against remote MTA                                            |
| [auth-imap][url-auth-imap]                 | Auth against IMAP server                                           |
| auth/[auth_ldap][url-auth-ldap]            | Auth against LDAP                                                  |
| auth/[auth_proxy][url-authproxy]           | Auth against remote MTA                                            |
| auth/[auth_vpopmaild][url-authvpop]        | Auth against vpopmaild                                             |
| [avg][url-avg]                             | AVG antivirus scanner                                              |
| [backscatterer][url-scatter]               | Check remote IP against ips.backscatterer.org                      |
| [block_me][url-blockme]                    | Populate block list via forwarded emails                           |
| [bounce][url-bounce]                       | Many options for bounce processing                                 |
| [clamd][url-clamd]                         | Anti-Virus scanning with ClamAV                                    |
| [connect.p0f][url-p0f]                     | TCP Fingerprinting                                                 |
| [data.signatures][url-sigs]                | Block emails whose bodies match signatures                         |
| [data.uribl][url-uribl]                    | Block based on URI blacklists                                      |
| [dcc][url-dcc]                             | Distributed Checksum Clearinghouse                                 |
| [delay_deny][url-delay]                    | Delays all pre-DATA 'deny' results                                 |
| [dkim_sign][url-sign]                      | DKIM sign outbound messages                                        |
| [dkim_verify][url-dkimv]                   | Verify DKIM signatures on incoming messages                        |
| [opendkim][url-opendkim]                   | DKIM sign and verify email messages                                |
| [dnsbl][url-dnsbl]                         | Check remote MTAs against DNS blacklists                           |
| [dnswl][url-dnswl]                         | Check remote MTAs against DNS whitelists                           |
| [dovecot][url-dovecot]                     | Recipient validation & SMTP AUTH against dovecot                   |
| [early_talker][url-early]                  | Reject remotes that talk early                                     |
| [esets][url-esets]                         | Virus scanning with ESET Mail Security                             |
| [fcrdns][url-fcrdns]                       | Forward Confirmed reverse DNS                                      |
| [geoip][url-geoip]                         | get geographic information about mail senders                      |
| [greylist][url-greylist]                   | Greylisting                                                        |
| [headers][url-headers]                     | Inspect and verify various email headers                           |
| [helo.checks][url-helo]                    | Validaty checks of the HELO string                                 |
| [karma][url-karma]                         | Dynamic scoring of incoming connections                            |
| [known-senders][url-known-senders]         | Reward emails from those you send mail to                          |
| [LDAP][url-ldap]                           | Aliases, Auth, and Recipient validation from LDAP                  |
| [Limit][url-limit]                         | Apply many types of limits to SMTP connections                     |
| [log.elasticsearch][url-elastic]           | Store message metadata in Elasticsearch                            |
| [log reader][url-logreader]                | extract log entries from the haraka log file                       |
| [syslog][url-syslog]                       | Log to syslog                                                      |
| [mail_from.is_resolvable][url-mfres]       | Verifies the MAIL FROM domain resolves to a MX                     |
| [messagesniffer][url-msgsniff]             | Anti-spam via [MessageSniffer][url-ms]                             |
| [milter][url-milter]                       | milter support                                                     |
| [mongodb][mongo-url]                       | Queue emails to MongoDB                                            |
| [prevent_credential_leaks][url-creds]      | Prevent users from emailing their credentials                      |
| [process_title][url-proctitle]             | Populate `ps` output with activity counters                        |
| queue/[discard][url-qdisc]                 | queues messages to /dev/null                                       |
| queue/[lmtp][url-qlmtp]                    | deliver queued messages via LMTP                                   |
| queue/[qmail-queue][url-qmail]             | queue to qmail                                                     |
| queue/[quarantine][url-qquart]             | queue to a quarantine directory                                    |
| queue/[rabbitmq][url-qrabbit]              | queue to RabbitMQ                                                  |
| queue/[rabbitmq_amqplib][url-qrabbita]     | queue to RabbitMQ using amqplib                                    |
| queue/[smtp_bridge][url-qbridge]           | Bridge SMTP sessions to another MTA                                |
| queue/[smtp_forward][url-qforward]         | Forward emails to another MTA                                      |
| queue/[smtp_proxy][url-qproxy]             | Proxy SMTP connections to another MTA                              |
| [recipient-routes][url-rroutes]            | Route emails based on their recipient(s)                           |
| [redis][url-redis]                         | multi-purpose Redis db connection(s)                               |
| [rcpt_to.in_host_list][url-rhost]          | Define local email domains in a file                               |
| [rcpt_to.ldap][url-rcpt-ldap]              | Validate recipients against LDAP                                   |
| [rcpt-postgresql][url-postgres]            | validate recipients against PostgreSQL                             |
| [rcpt_to.qmail_deliverable][url-rqmd]      | Validate recipients against Qmail-Deliverable                      |
| [record_envelope_addresses][url-recordenv] | Adds message headers with ENV recips                               |
| [relay][url-relay]                         | Manage relay permissions                                           |
| [reseed_rng][url-rng]                      | Reseed the RNG                                                     |
| [rspamd][url-rspamd]                       | Scan emails with rspamd                                            |
| [spamassassin][url-spamass]                | Scan emails with SpamAssassin                                      |
| [spf][url-spf]                             | Perform SPF checks                                                 |
| [srs][url-srs]                             | Sender Rewriting Scheme                                            |
| [tarpit][url-tarpit]                       | Slow down connections                                              |
| [tls][url-tls]                             | Implements TLS                                                     |
| [toobusy][url-toobusy]                     | Defers connections when too busy                                   |
| [vmta][url-vmta]                           | Virtual MTA management                                             |
| [watch][url-watch]                         | Watch live SMTP traffic in a web interface                         |
| [wildduck][url-wildduck]                   | provides recipient checks against Wild Duck                        |
| [xclient][url-xclient]                     | Implements XCLIENT                                                 |

<!-- URLs tucked safely out of the way -->

[template]: https://github.com/haraka/haraka-plugin-template
[write-plugin]: https://github.com/haraka/Haraka/wiki/Write-a-Plugin
[plugins-doc]: https://haraka.github.io/manual/Plugins.html
[url-access]: https://github.com/haraka/haraka-plugin-access
[url-acc-files]: https://github.com/acharkizakaria/haraka-plugin-accounting-files/blob/master/README.md
[url-aliases]: https://github.com/haraka/Haraka/blob/master/docs/plugins/aliases.md
[url-asn]: https://github.com/haraka/haraka-plugin-asn
[url-attach]: https://github.com/haraka/Haraka/blob/master/docs/plugins/attachment.md
[url-authencflat]: https://github.com/AuspeXeu/haraka-plugin-auth-enc-file
[url-authflat]: https://github.com/haraka/Haraka/blob/master/docs/plugins/auth/flat_file.md
[url-authbridge]: https://github.com/haraka/Haraka/blob/master/docs/plugins/auth/auth_bridge.md
[url-auth-imap]: https://github.com/haraka/haraka-plugin-auth-imap
[url-auth-ldap]: https://github.com/haraka/haraka-plugin-auth-ldap
[url-authproxy]: https://github.com/haraka/Haraka/blob/master/docs/plugins/auth/auth_proxy.md
[url-authvpop]: https://github.com/haraka/Haraka/blob/master/docs/plugins/auth/auth_vpopmaild.md
[url-avg]: https://github.com/haraka/Haraka/blob/master/docs/plugins/avg.md
[url-scatter]: https://github.com/haraka/Haraka/blob/master/docs/plugins/backscatterer.md
[url-blockme]: https://github.com/haraka/Haraka/blob/master/docs/plugins/block_me.md
[url-bounce]: https://github.com/haraka/Haraka/blob/master/docs/plugins/bounce.md
[url-clamd]: https://github.com/haraka/Haraka/blob/master/docs/plugins/clamd.md
[url-dovecot]: https://github.com/haraka/haraka-plugin-dovecot
[url-fcrdns]: https://github.com/haraka/haraka-plugin-fcrdns
[url-p0f]: https://github.com/haraka/haraka-plugin-p0f
[url-headers]: https://github.com/haraka/haraka-plugin-headers
[url-sigs]: https://github.com/haraka/Haraka/blob/master/docs/plugins/data.signatures.md
[url-uribl]: https://github.com/haraka/Haraka/blob/master/docs/plugins/data.uribl.md
[url-dcc]: https://github.com/haraka/haraka-plugin-dcc
[url-delay]: https://github.com/haraka/Haraka/blob/master/docs/plugins/delay_deny.md
[url-sign]: https://github.com/haraka/Haraka/blob/master/docs/plugins/dkim_sign.md
[url-dkimv]: https://github.com/haraka/Haraka/blob/master/docs/plugins/dkim_verify.md
[url-opendkim]: https://www.npmjs.com/package/haraka-plugin-opendkim
[url-dnsbl]: https://github.com/haraka/Haraka/blob/master/docs/plugins/dnsbl.md
[url-dnswl]: https://github.com/haraka/Haraka/blob/master/docs/plugins/dnswl.md
[url-early]: https://github.com/haraka/Haraka/blob/master/docs/plugins/early_talker.md
[url-esets]: https://github.com/haraka/Haraka/blob/master/docs/plugins/esets.md
[url-geoip]: https://github.com/haraka/haraka-plugin-geoip
[url-graph]: https://github.com/haraka/haraka-plugin-graph
[url-greylist]: https://github.com/haraka/Haraka/blob/master/docs/plugins/greylist.md
[url-helo]: https://github.com/haraka/Haraka/blob/master/docs/plugins/helo.checks.md
[url-karma]: https://github.com/haraka/haraka-plugin-karma
[url-known-senders]: https://github.com/haraka/haraka-plugin-known-senders
[url-elastic]: https://github.com/haraka/haraka-plugin-elasticsearch/
[url-syslog]: https://github.com/haraka/haraka-plugin-syslog
[url-ldap]: https://github.com/haraka/haraka-plugin-ldap
[url-limit]: https://github.com/haraka/haraka-plugin-limit
[url-logreader]: https://github.com/haraka/haraka-plugin-log-reader
[url-milter]: https://github.com/haraka/haraka-plugin-milter
[url-mfres]: https://github.com/haraka/Haraka/blob/master/docs/plugins/mail_from.is_resolvable.md
[url-msgsniff]: https://github.com/haraka/Haraka/blob/master/docs/plugins/messagesniffer.md
[url-ms]: http://www.armresearch.com/Products/
[url-creds]: https://github.com/haraka/Haraka/blob/master/docs/plugins/prevent_credential_leaks.md
[url-postgres]: https://github.com/haraka/haraka-plugin-rcpt-postgresql
[url-proctitle]: https://github.com/haraka/Haraka/blob/master/docs/plugins/process_title.md
[url-qdisc]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/discard.md
[url-qlmtp]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/lmtp.md
[url-qmail]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/qmail-queue.md
[url-qquart]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/quarantine.md
[url-qrabbit]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/rabbitmq.md
[url-qrabbita]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/rabbitmq_amqplib.md
[url-qbridge]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/smtp_bridge.md
[url-qforward]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/smtp_forward.md
[url-qproxy]: https://github.com/haraka/Haraka/blob/master/docs/plugins/queue/smtp_proxy.md
[url-redis]: https://github.com/haraka/haraka-plugin-redis
[url-rhost]: https://github.com/haraka/Haraka/blob/master/docs/plugins/rcpt_to.in_host_list.md
[url-rcpt-ldap]: https://github.com/haraka/haraka-plugin-rcpt-ldap
[url-rqmd]: https://github.com/haraka/haraka-plugin-qmail-deliverable
[url-rroutes]: https://github.com/haraka/haraka-plugin-recipient-routes
[url-recordenv]: https://github.com/haraka/Haraka/blob/master/docs/plugins/record_envelope_addresses.md
[url-relay]: https://github.com/haraka/Haraka/blob/master/docs/plugins/relay.md
[url-rng]: https://github.com/haraka/Haraka/blob/master/docs/plugins/reseed_rng.md
[url-rspamd]: https://github.com/haraka/haraka-plugin-rspamd
[url-spamass]: https://github.com/haraka/Haraka/blob/master/docs/plugins/spamassassin.md
[url-spf]: https://github.com/haraka/Haraka/blob/master/docs/plugins/spf.md
[url-srs]: https://github.com/swerter/haraka-plugins/blob/master/plugins/srs.js
[url-tarpit]: https://github.com/haraka/Haraka/blob/master/docs/plugins/tarpit.md
[url-tls]: https://github.com/haraka/Haraka/blob/master/docs/plugins/tls.md
[url-toobusy]: https://github.com/haraka/Haraka/blob/master/docs/plugins/toobusy.md
[url-vmta]: https://github.com/haraka/haraka-plugin-vmta/blob/master/README.md
[url-watch]: https://github.com/haraka/haraka-plugin-watch
[url-wildduck]: https://github.com/nodemailer/haraka-plugin-wildduck
[url-xclient]: https://github.com/haraka/Haraka/blob/master/docs/plugins/xclient.md
[mongo-url]: https://github.com/Helpmonks/haraka-plugin-mongodb
