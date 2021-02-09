# This script will run the saml server with the following configurations
# domain: 'tests.hackerbay.io'
# samlSsoUrl: 'http://localhost:9876/simplesaml/saml2/idp/SSOService.php'
# remoteLogoutUrl: 'http://localhost:9876/logout'

# The saml database will have the following records (from users.php)
# email                       | id    | password
# user1@tests.hackerbay.io    | user1 | user1pass
# user2@tests.hackerbay.io    | user2 | user2pass
docker run \
  --name=samlIdp \
  -p 9876:8080 \
  -p 8443:8443 \
  -e SIMPLESAMLPHP_SP_ENTITY_ID=hackerbay.io \
  -e SIMPLESAMLPHP_SP_ASSERTION_CONSUMER_SERVICE=http://localhost:3002/api/user/sso/callback \
  -e SIMPLESAMLPHP_SP_SINGLE_LOGOUT_SERVICE=http://localhost/simplesaml/module.php/saml/sp/saml2-logout.php/test-sp \
  -v $PWD/users.php:/var/www/simplesamlphp/config/authsources.php \
  -d kristophjunge/test-saml-idp
