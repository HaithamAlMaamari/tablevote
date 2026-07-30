import { pathToFileURL } from 'node:url';
import { buildApp } from './app';
import { resolveServerStartupConfig } from './deployment';

export { buildApp } from './app';

export function startServer(env: NodeJS.ProcessEnv = process.env) {
  const config = resolveServerStartupConfig(env);
  const built = buildApp({ deployment: config.deployment });
  const { http, io } = built;
  let stopping: Promise<void> | null = null;
  const stop = () => {
    if (stopping) return stopping;
    stopping = new Promise<void>((resolve) => {
      io.close(() => {
        if (!http.listening) return resolve();
        http.close(() => resolve());
      });
    });
    return stopping;
  };

  http.listen(config.port, config.host, () => {
    const address = http.address();
    const port = address && typeof address !== 'string' ? address.port : config.port;
    console.log(`TableVote server on http://${config.host}:${port}`);
  });
  return { ...built, config, stop };
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const server = startServer();
  const shutdown = () => {
    void server.stop().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
