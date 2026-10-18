import {runTests} from '@vscode/test-electron';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const workspace=await mkdtemp(join(tmpdir(),'noteglow-host-'));
await writeFile(join(workspace,'demo.md'),'1. **重要** 正文。\n\n```js\nconst a = 1;\n```\n');
await writeFile(join(workspace,'bom.md'),'\ufeffBOM 正文');
await runTests({extensionDevelopmentPath:fileURLToPath(new URL('..',import.meta.url)),extensionTestsPath:fileURLToPath(new URL('../tests/integration/index.cjs',import.meta.url)),launchArgs:[workspace,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-extensions']});
