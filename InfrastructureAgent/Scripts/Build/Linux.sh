# This is taken from: https://nodejs.org/api/single-executable-applications.html
npm run compile 
npm run build
node --experimental-sea-config sea-config.json
cp $(command -v node) InfrastructureAgent
npm i postject -g
npx postject InfrastructureAgent NODE_SEA_BLOB sea-prep.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
