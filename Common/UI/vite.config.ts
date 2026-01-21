/**
 * Shared Vite configuration factory for OneUptime frontend services
 * This creates consistent build configurations across all services with controlled code splitting
 */

import { defineConfig, UserConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

interface ServiceConfig {
  serviceName: string;
  publicPath: string;
  outDir?: string;
  entryPoint?: string;
}

/**
 * Create a Vite plugin for refractor compatibility
 * Handles resolving refractor/lib/* and refractor/lang/* imports
 */
function createRefractorCompatibilityPlugin(): Plugin {
  const candidateRoots = [
    path.resolve(__dirname, '../node_modules/refractor'),
    path.resolve(__dirname, '../../node_modules/refractor'),
  ];

  const refractorRoot = candidateRoots.find((packagePath) => fs.existsSync(packagePath));

  return {
    name: 'refractor-compatibility',
    resolveId(source: string) {
      if (!refractorRoot) {
        return null;
      }

      if (source.startsWith('refractor/lib/')) {
        const relativePath = source.replace(/^refractor\/lib\//, '');
        const candidatePath = path.join(refractorRoot, 'lib', `${relativePath}.js`);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }

      if (source.startsWith('refractor/lang/')) {
        const relativePath = source.replace(/^refractor\/lang\//, '');
        const filename = relativePath.endsWith('.js') ? relativePath : `${relativePath}.js`;
        const candidatePath = path.join(refractorRoot, 'lang', filename);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }

      return null;
    },
  };
}

/**
 * Create Vite configuration for a service
 */
export function createViteConfig(config: ServiceConfig): UserConfig {
  const {
    serviceName,
    publicPath,
    outDir = './public/dist',
    entryPoint = './src/Index.tsx'
  } = config;

  const isDev = process.env.NODE_ENV !== 'production';
  const isAnalyze = process.env.analyze === 'true';

  return defineConfig({
    plugins: [
      react(),
      createRefractorCompatibilityPlugin(),
    ],
    base: publicPath,
    build: {
      target: 'es2017',
      outDir,
      emptyOutDir: true,
      sourcemap: isDev ? 'inline' : false,
      minify: !isDev,
      rollupOptions: {
        input: entryPoint,
        output: {
          entryFileNames: 'Index.js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name][extname]',
          manualChunks: (id: string) => {
            // Vendor chunk: React ecosystem
            if (id.includes('node_modules/react/') ||
                id.includes('node_modules/react-dom/') ||
                id.includes('node_modules/react-router-dom/') ||
                id.includes('node_modules/react-router/') ||
                id.includes('node_modules/@remix-run/router/')) {
              return 'vendor';
            }

            // UI Components chunk: Common UI library
            if (id.includes('Common/UI/Components/') ||
                id.includes('Common/UI/Utils/')) {
              return 'ui';
            }

            // Charting libraries chunk
            if (id.includes('node_modules/recharts/') ||
                id.includes('node_modules/d3-') ||
                id.includes('node_modules/victory-')) {
              return 'charts';
            }

            // Monaco editor chunk (large)
            if (id.includes('node_modules/@monaco-editor/') ||
                id.includes('node_modules/monaco-editor/')) {
              return 'monaco';
            }

            // Flow/diagram libraries
            if (id.includes('node_modules/reactflow/') ||
                id.includes('node_modules/@reactflow/') ||
                id.includes('node_modules/elkjs/')) {
              return 'flow';
            }

            // Syntax highlighting chunk
            if (id.includes('node_modules/react-syntax-highlighter/') ||
                id.includes('node_modules/refractor/') ||
                id.includes('node_modules/prismjs/') ||
                id.includes('node_modules/highlight.js/')) {
              return 'syntax';
            }

            // Date/time utilities
            if (id.includes('node_modules/moment/') ||
                id.includes('node_modules/moment-timezone/')) {
              return 'datetime';
            }

            // Markdown processing
            if (id.includes('node_modules/react-markdown/') ||
                id.includes('node_modules/remark-') ||
                id.includes('node_modules/rehype-') ||
                id.includes('node_modules/unified/') ||
                id.includes('node_modules/marked/')) {
              return 'markdown';
            }

            // Other large vendor libraries get grouped together
            if (id.includes('node_modules/')) {
              return 'vendor-misc';
            }

            // Let Vite handle code splitting for dynamic imports (lazy routes)
            return undefined;
          },
        },
        external: ['react-native-sqlite-storage'],
      },
      // Report compressed sizes in analyze mode
      reportCompressedSize: isAnalyze,
    },
    resolve: {
      alias: {
        'react': path.resolve('./node_modules/react'),
        'Common': path.resolve('../Common'),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {},
      },
    },
    // Define environment variables
    define: {
      'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
    },
    // Log level for build output
    logLevel: isAnalyze ? 'info' : 'warn',
  });
}

export default createViteConfig;
