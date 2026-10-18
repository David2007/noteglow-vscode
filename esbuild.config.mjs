import { build } from 'esbuild';
await build({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',target:'node20',external:['vscode'],outfile:'dist/extension.cjs',sourcemap:false});
