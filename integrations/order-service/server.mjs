import { pathToFileURL } from "node:url";
import { createOrderService } from "./app.mjs";
import { loadConfig } from "./config.mjs";

export { createOrderService } from "./app.mjs";
export { loadConfig } from "./config.mjs";

function start() {
  const config = loadConfig();
  const server = createOrderService({ config });
  server.listen(config.port, config.host, () => {
    console.info(`order-service listening on ${config.host}:${config.port}`);
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close((error) => {
      if (error) process.exitCode = 1;
    });
    setTimeout(() => {
      process.exitCode = 1;
      server.closeAllConnections();
    }, 10_000).unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    start();
  } catch {
    // Не печатаем конфигурацию или исходную ошибку: она может включать секрет env.
    console.error("order-service failed to start: invalid configuration");
    process.exitCode = 1;
  }
}
