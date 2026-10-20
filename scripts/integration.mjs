import {png} from '../tests/fixtures/image-fixtures.mjs';
import {build} from 'esbuild';
import {runTests} from '@vscode/test-electron';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const profile=await mkdtemp(join(tmpdir(),'noteglow-host-profile-'));
const workspace=await mkdtemp(join(tmpdir(),'noteglow-host-'));
await writeFile(join(workspace,'demo.md'),'1. **重要** 正文。\n\n```js\nconst a = 1;\n```\n');
await writeFile(join(workspace,'bom.md'),'\ufeffBOM 正文');
// 仅使用合成代码，验证原生代码的连续选区，不读取私人笔记。
await writeFile(join(workspace,'code-colors.md'),'```go\nupdate(a)\nupdatePtr(&a) // &amp; 😀\n\n```\n');
await writeFile(join(workspace,'legacy.md'),'<span data-codex-color="1" style="background-color:#fff88f">重要</span> 正文。\n');
await writeFile(join(workspace,'image.png'),png());
const replyAdapter=join(profile,'reply-adapter.cjs');
await build({entryPoints:[fileURLToPath(new URL('../tests/integration/reply-adapter.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',external:['vscode'],outfile:replyAdapter});
await runTests({extensionTestsEnv:{NOTEGLOW_TEST_PROFILE:profile,NOTEGLOW_REPLY_ADAPTER:replyAdapter},extensionDevelopmentPath:fileURLToPath(new URL('..',import.meta.url)),extensionTestsPath:fileURLToPath(new URL('../tests/integration/index.cjs',import.meta.url)),launchArgs:[workspace,'--user-data-dir',profile,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-extensions']});
