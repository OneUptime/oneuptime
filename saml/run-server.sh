docker run \
  --name=samlIdp \
  -p 9876:8080 \
  -p 8443:8443 \
  -e SIMPLESAMLPHP_SP_ENTITY_ID=hackerbay.io \
  -e SIMPLESAMLPHP_SP_ASSERTION_CONSUMER_SERVICE=http://localhost:3002/api/user/sso/callback \
  -e SIMPLESAMLPHP_SP_SINGLE_LOGOUT_SERVICE=http://localhost/simplesaml/module.php/saml/sp/saml2-logout.php/test-sp \
  -v $PWD/users.php:/var/www/simplesamlphp/config/authsources.php \
  -d kristophjunge/test-saml-idp
