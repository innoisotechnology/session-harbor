import * as cliAdapter from '../../../tooling/tool-spec/adapters/cli.ts';
import * as toolsetModule from './toolset.ts';

const runToolsetCli = (cliAdapter as any).runToolsetCli || (cliAdapter as any).default?.runToolsetCli;
const createSessionHarborToolset = (toolsetModule as any).createSessionHarborToolset || (toolsetModule as any).default?.createSessionHarborToolset;

if (!runToolsetCli || !createSessionHarborToolset) {
  throw new Error('Session Harbor CLI dependencies are unavailable');
}

runToolsetCli(createSessionHarborToolset()).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
