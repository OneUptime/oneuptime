
cd ..
cd Common && npm install && cd ..
cd Model && npm install && cd ..
cd CommonServer && npm install && cd ..
cd CommonUI && npm install --force && cd ..
cd InfrastructureAgent 
npm install
npm run compile 
npm run build
npm i postject -g