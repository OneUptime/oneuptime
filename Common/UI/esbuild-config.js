/**
 * Shared esbuild configuration factory for OneUptime frontend services
 * This creates consistent build configurations across all services
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

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
    format: 'esm', // Changed from 'iife' to 'esm' to support splitting
    platform: 'browser',
    target: 'es2017',
    sourcemap: isDev ? 'inline' : false,
    minify: !isDev, // Enable minification in production
    splitting: true, // Now supported with ESM format
    chunkNames: isDev ? 'chunk-[name]' : 'chunk-[name]-[hash]', // Add hash in production
    entryNames: isDev ? '[name]' : '[name]-[hash]', // Add hash in production
    assetNames: isDev ? 'assets/[name]' : 'assets/[name]-[hash]', // Add hash in production
    publicPath,
    define: {
      'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
      'process.env.BUILD_TIME': JSON.stringify(new Date().toISOString()),
      'process.env.BUILD_VERSION': JSON.stringify(generateBuildVersion()),
      ...additionalDefines,
    },
    external: ['react-native-sqlite-storage', ...additionalExternal],
    alias: {
      'react': path.resolve('./node_modules/react'),
      ...additionalAlias,
    },
    plugins: [createCSSPlugin(), createFileLoaderPlugin()],
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

// Generate a build version based on timestamp and git info (if available)
function generateBuildVersion() {
  const timestamp = Date.now();
  
  try {
    const { execSync } = require('child_process');
    const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return `${timestamp}-${gitHash}`;
  } catch (error) {
    // Fallback if git is not available
    return timestamp.toString();
  }
}

/**
 * Build function that handles the build process
 * @param {Object} config - esbuild configuration
 * @param {string} serviceName - Name of the service for logging
 */
async function build(config, serviceName) {
  const isAnalyze = process.env.analyze === 'true';
  const isDev = process.env.NODE_ENV !== 'production';
  
  try {
    const result = await esbuild.build(config);
    
    // Update service worker cache version after successful build
    if (!isDev && serviceName.toLowerCase() === 'dashboard') {
      updateServiceWorkerCacheVersion(config.outdir);
    }
    
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

// Update service worker cache version
function updateServiceWorkerCacheVersion(outdir) {
  try {
    const swPath = path.resolve(outdir, '../sw.js');
    
    if (!fs.existsSync(swPath)) {
      console.log('⚠️  Service worker not found, skipping cache version update');
      return;
    }
    
    const buildVersion = generateBuildVersion();
    const newCacheVersion = `oneuptime-v${buildVersion}`;
    
    let swContent = fs.readFileSync(swPath, 'utf8');
    
    // Update cache version
    swContent = swContent.replace(
      /const CACHE_VERSION = '[^']+';/,
      `const CACHE_VERSION = '${newCacheVersion}';`
    );
    
    fs.writeFileSync(swPath, swContent);
    console.log(`🔄 Updated service worker cache version to: ${newCacheVersion}`);
    
  } catch (error) {
    console.warn('⚠️  Failed to update service worker cache version:', error.message);
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
  generateBuildVersion,
};
