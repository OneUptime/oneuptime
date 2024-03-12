# This is taken from: https://nodejs.org/api/single-executable-applications.html

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
node --experimental-sea-config $SCRIPT_DIR/../../sea-config.json 
cp $(command -v node) InfrastructureAgent
codesign --remove-signature InfrastructureAgent 
npm i postject -g
npx postject InfrastructureAgent NODE_SEA_BLOB sea-prep.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
    --macho-segment-name NODE_SEA
codesign --sign - InfrastructureAgent 