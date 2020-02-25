### Encrypt:
- tar -cvf encrypted-credentials.tar .
- openssl enc -in encrypted-credentials.tar -out encrypted-credentials.enc -e -aes-256-cbc -k your_key

### Decrypt:
- openssl enc -in encrypted-credentials.enc -out encrypted-credentials.tar -d -aes-256-cbc -k your_key
- tar -xvf encrypted-credentials.tar