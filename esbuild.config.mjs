import { build } from 'esbuild';
await build({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',target:'node20',external:['vscode'],outfile:'dist/extension.cjs',sourcemap:false});

await build({entryPoints:['src/outline-preview-entry.ts'],bundle:true,platform:'browser',format:'iife',target:'es2022',outfile:'dist/outline-preview.js',sourcemap:false});
