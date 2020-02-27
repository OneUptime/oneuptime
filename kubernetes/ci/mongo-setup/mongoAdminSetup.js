/* eslint-disable no-undef */
print('Create DB Admin User');

db.createUser({
    user: 'admin',
    pwd: '372b60f4-704c-4205-8e5c-45cdbf44b1fc',
    roles: [{ role: 'root', db: 'admin' }],
});

print('Authenticating DB Admin User');

db.auth('admin', '372b60f4-704c-4205-8e5c-45cdbf44b1fc');

print('Mongo Admin Setup Complete');
