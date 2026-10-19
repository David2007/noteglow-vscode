import {png} from '../tests/fixtures/image-fixtures.mjs';
import {runTests} from '@vscode/test-electron';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const profile=await mkdtemp(join(tmpdir(),'noteglow-host-profile-'));
const workspace=await mkdtemp(join(tmpdir(),'noteglow-host-'));
await writeFile(join(workspace,'demo.md'),'1. **重要** 正文。\n\n```js\nconst a = 1;\n```\n');
await writeFile(join(workspace,'bom.md'),'\ufeffBOM 正文');
// 仅使用合成代码，验证已着色 HTML 的后续选区，不读取私人笔记。
await writeFile(join(workspace,'code-colors.md'),'```go\nupdate(a)\nupdatePtr(&a) // &amp; 😀\n\n```\n');
await writeFile(join(workspace,'image.png'),png());
await runTests({extensionTestsEnv:{NOTEGLOW_TEST_PROFILE:profile},extensionDevelopmentPath:fileURLToPath(new URL('..',import.meta.url)),extensionTestsPath:fileURLToPath(new URL('../tests/integration/index.cjs',import.meta.url)),launchArgs:[workspace,'--user-data-dir',profile,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-extensions']});
