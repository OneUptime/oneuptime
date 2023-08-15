# Build haraka container. 

```
sudo docker build . -t haraka:latest
```


# To update a stack

```
cd haraka
sudo docker stack deploy haraka -c docker-compose.yml
```

# To restart a service

```
sudo docker service update haraka_haraka --force
```


# Send Test Outbound Email

```
swaks --to hello@nawazdhandala.com --from hello@genosyn.com --server 192.168.1.100 --port 2525 --auth-user homelab --auth-password password
```

# Set a domain to send email


Generate a DKIM key: 

```
cd dkim

bash generate.sh

cd ..
```

`public` and `private` files should have been generated inside of `dkim` folder. Please also add DNS and env vars to docker-compose files. Values of that should be shown on the console.



Add an A record: 

```
mailer.company.com <IP address or haraka server>
```

Set SPF record: 

```
# Any MX or A servers can send emails. 
v=spf1 mx a -all
```

Example: 

```
v=spf1 mx a ip4:37.26.74.9 include:_spf.google.com include:mail.genosyn.com ~all
```

Set DMARC record: 

```
Type: TXT
Key: _dmarc   
Value: "v=DMARC1; p=reject; adkim=s; aspf=r; rua=mailto:dmarc-feedback@<DOMAIN>; ruf=mailto:dmarc-feedback@<DOMAIN>; pct=100"
```

Example: 


```
_dmarc  TXT "v=DMARC1; p=reject; adkim=s; aspf=r; rua=mailto:dmarc-feedback@genosyn.com; ruf=mailto:dmarc-feedback@genosyn.com; pct=100"
```


# Test, Test, Test. 

Use https://www.mail-tester.com/ to test emails. 