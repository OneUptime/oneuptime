/**
 * Shared esbuild configuration factory for OneUptime frontend services
 * This creates consistent build configurations across all services
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

function createRefractorCompatibilityPlugin() {
  const candidateRoots = [
    path.resolve(__dirname, '../node_modules/refractor'),
    path.resolve(__dirname, '../../node_modules/refractor'),
  ];

  const refractorRoot = candidateRoots.find((packagePath) => fs.existsSync(packagePath));

  if (!refractorRoot) {
    throw new Error('Unable to locate refractor package for esbuild compatibility plugin.');
  }

  return {
    name: 'refractor-compatibility',
    setup(build) {
      build.onResolve({ filter: /^refractor\/lib\// }, (args) => {
        const relativePath = args.path.replace(/^refractor\/lib\//, '');
        const candidatePath = path.join(refractorRoot, 'lib', `${relativePath}.js`);
        return { path: candidatePath };
      });

      build.onResolve({ filter: /^refractor\/lang\// }, (args) => {
        const relativePath = args.path.replace(/^refractor\/lang\//, '');
        const filename = relativePath.endsWith('.js') ? relativePath : `${relativePath}.js`;
        const candidatePath = path.join(refractorRoot, 'lang', filename);
        return { path: candidatePath };
      });
    },
  };
}

// Plugin to force mermaid to use its pre-bundled CJS build (no dynamic imports)
function createMermaidPlugin() {
  const candidateRoots = [
    path.resolve(__dirname, '../node_modules/mermaid'),
    path.resolve(__dirname, '../../node_modules/mermaid'),
  ];
  const mermaidRoot = candidateRoots.find((p) => fs.existsSync(p));

  return {
    name: 'mermaid-prebundled',
    setup(build) {
      if (!mermaidRoot) return;
      const bundlePath = path.join(mermaidRoot, 'dist', 'mermaid.min.js');

      // Intercept bare "mermaid" imports and serve the pre-bundled CJS file
      // with an ESM export appended. The CJS file declares a local var
      // __esbuild_esm_mermaid_nm and assigns .mermaid on it, so we inline
      // the file contents and export from the same scope.
      build.onResolve({ filter: /^mermaid$/ }, () => {
        return { path: 'mermaid-wrapper', namespace: 'mermaid-ns' };
      });

      build.onLoad({ filter: /^mermaid-wrapper$/, namespace: 'mermaid-ns' }, () => {
        let cjsSource = fs.readFileSync(bundlePath, 'utf8');
        // The CJS bundle ends with a line that tries globalThis.__esbuild_esm_mermaid_nm
        // which fails because the var is local-scoped when bundled. Strip it and
        // expose the local var on globalThis ourselves before that line.
        cjsSource = cjsSource.replace(
          /globalThis\["mermaid"\]\s*=\s*globalThis\.__esbuild_esm_mermaid_nm\["mermaid"\]\.default;?\s*$/,
          ''
        );
        const contents = cjsSource + `
;globalThis.__esbuild_esm_mermaid_nm = typeof __esbuild_esm_mermaid_nm !== "undefined" ? __esbuild_esm_mermaid_nm : {};
var _mermaid_export = __esbuild_esm_mermaid_nm.mermaid;
if (_mermaid_export && _mermaid_export.default) { _mermaid_export = _mermaid_export.default; }
export default _mermaid_export;
export { _mermaid_export as mermaid };
`;
        return {
          contents,
          loader: 'js',
          resolveDir: path.dirname(bundlePath),
        };
      });
    },
  };
}

// CSS Plugin to handle CSS/SCSS files
function createCSSPlugin() {
  return {
    name: 'css',
    setup(build) {
      build.onLoad({ filter: /\.s?css$/ }, async (args) => {
        const sass = require('sass');
        const fs = require('fs');
        
        let contents = fs.readFileSync(args.path, 'utf8');
        
        // Compile SCSS to CSS if it's a SCSS file
        if (args.path.endsWith('.scss') || args.path.endsWith('.sass')) {
          try {
            const result = sass.compile(args.path);
            contents = result.css;
          } catch (error) {
            console.error(`SCSS compilation error in ${args.path}:`, error);
            throw error;
          }
        }
        
        // Return CSS as a string that will be injected into the page
        return {
          contents: `
            const style = document.createElement('style');
            style.textContent = ${JSON.stringify(contents)};
            document.head.appendChild(style);
          `,
          loader: 'js',
        };
      });
    },
  };
}

// File loader plugin for assets
function createFileLoaderPlugin() {
  return {
    name: 'file-loader',
    setup(build) {
      build.onLoad({ filter: /\.(png|jpe?g|gif|svg|woff|woff2|eot|ttf|otf)$/ }, async (args) => {
        const fs = require('fs');
        const path = require('path');
        
        const contents = fs.readFileSync(args.path);
        const filename = path.basename(args.path);
        const ext = path.extname(filename);
        
        // For development, we'll use data URLs for simplicity
        // In production, you might want to copy files to the output directory
        const mimeTypes = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.eot': 'application/vnd.ms-fontobject',
          '.ttf': 'font/ttf',
          '.otf': 'font/otf',
        };
        
        const mimeType = mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
        const dataUrl = `data:${mimeType};base64,${contents.toString('base64')}`;
        
        return {
          contents: `export default ${JSON.stringify(dataUrl)};`,
          loader: 'js',
        };
      });
    },
  };
}

// Read environment variables from .env file
function readEnvFile(pathToFile) {
  if (!fs.existsSync(pathToFile)) {
    console.warn(`Environment file not found: ${pathToFile}`);
    return {};
  }
  
  const parsed = dotenv.config({ path: pathToFile }).parsed || {};
  const env = {};

  for (const key in parsed) {
    env[`process.env.${key}`] = JSON.stringify(parsed[key]);
  }

  return env;
}

/**
 * Create esbuild configuration for a service
 * @param {Object} options - Configuration options
 * @param {string} options.serviceName - Name of the service (dashboard, accounts, admin, status-page)
 * @param {string} options.publicPath - Public path for assets
 * @param {string} [options.entryPoint] - Entry point file (defaults to './src/Index.tsx')
 * @param {string} [options.outdir] - Output directory (defaults to './public/dist')
 * @param {Object} [options.additionalDefines] - Additional define variables
 * @param {Array} [options.additionalExternal] - Additional external modules
 * @param {Object} [options.additionalAlias] - Additional aliases
 */
function createConfig(options) {
  const {
    serviceName,
    publicPath,
    entryPoint = './src/Index.tsx',
    outdir = './public/dist',
    additionalDefines = {},
    additionalExternal = [],
    additionalAlias = {}
  } = options;

  const isDev = process.env.NODE_ENV !== 'production';
  const isAnalyze = process.env.analyze === 'true';

  return {
    entryPoints: [entryPoint],
    bundle: true,
    outdir,
    format: 'esm',
    platform: 'browser',
    target: 'es2017',
    sourcemap: isDev ? 'inline' : false,
    minify: false,
    treeShaking: true,
    splitting: true,
    publicPath,
    define: {
      'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
      ...additionalDefines,
    },
    external: ['react-native-sqlite-storage', ...additionalExternal],
    alias: {
      'react': path.resolve('./node_modules/react'),
      ...additionalAlias,
    },
    plugins: [createMermaidPlugin(), createRefractorCompatibilityPlugin(), createCSSPlugin(), createFileLoaderPlugin()],
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.jsx': 'jsx',
      '.js': 'js',
      '.json': 'json',
    },
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json', '.css', '.scss'],
    metafile: isAnalyze,
  };
}

/**
 * Build function that handles the build process
 * @param {Object} config - esbuild configuration
 * @param {string} serviceName - Name of the service for logging
 */
async function build(config, serviceName) {
  const isAnalyze = process.env.analyze === 'true';
  
  try {
    const result = await esbuild.build(config);
    
    if (isAnalyze && result.metafile) {
      const analyzeText = await esbuild.analyzeMetafile(result.metafile);
      console.log(`\n📊 Bundle analysis for ${serviceName}:`);
      console.log(analyzeText);
      
      // Write metafile for external analysis tools
      const metafilePath = path.join(config.outdir, 'metafile.json');
      fs.writeFileSync(metafilePath, JSON.stringify(result.metafile, null, 2));
      console.log(`📝 Metafile written to: ${metafilePath}`);
    }
    
    console.log(`✅ ${serviceName} build completed successfully`);
  } catch (error) {
    console.error(`❌ ${serviceName} build failed:`, error);
    process.exit(1);
  }
}

/**
 * Watch function that handles the watch process
 * @param {Object} config - esbuild configuration
 * @param {string} serviceName - Name of the service for logging
 */
async function watch(config, serviceName) {
  try {
    const context = await esbuild.context(config);
    await context.watch();
    console.log(`👀 Watching ${serviceName} for changes...`);
  } catch (error) {
    console.error(`❌ ${serviceName} watch failed:`, error);
    process.exit(1);
  }
}

module.exports = {
  createConfig,
  build,
  watch,
  createCSSPlugin,
  createFileLoaderPlugin,
  readEnvFile,
};
