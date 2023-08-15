cd keys

cat private | base64 -w0 > private_base64.txt
cat public | base64 -w0 > public_base64.txt

echo ""
echo ""
echo ""


echo "Add this to docker compose file - DKIM private key for env var is:" 
cat private_base64.txt

echo ""
echo ""
echo ""

echo "Add this to docker compose file - DKIM public key for env var is:" 
cat public_base64.txt

echo ""
echo ""
echo ""

echo "You need to add this to DNS" 
echo "Type: TXT" 
echo "Key: haraka._domainkey"
echo "v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"

cd ..