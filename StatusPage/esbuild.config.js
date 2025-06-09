const { createConfig, build, watch } = require('../Scripts/esbuild-config');

const config = createConfig({
  serviceName: 'StatusPage',
  publicPath: '/status-page/dist/',
});

if (process.argv.includes('--watch')) {
  watch(config, 'StatusPage');
} else {
  build(config, 'StatusPage');
}
