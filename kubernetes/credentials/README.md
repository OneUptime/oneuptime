### Fyipe Projects :
### Encrypt:
- tar -cvf encrypted-credentials.tar .
- openssl enc -in encrypted-credentials.tar -out encrypted-credentials.enc -e -aes256 -pbkdf2 -k your_key

### Decrypt:
- openssl enc -in encrypted-credentials.enc -out encrypted-credentials.tar -d -aes256 -pbkdf2 -k your_key
- tar -xvf encrypted-credentials.tar


