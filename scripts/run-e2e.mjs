import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const host = "127.0.0.1";
const port = "3100";
const baseUrl = `http://${host}:${port}`;
const nextCli = "node_modules/next/dist/bin/next";
const playwrightCli = "node_modules/@playwright/test/cli.js";

async function isReady() {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`next start terminó antes de estar listo (código ${server.exitCode}).`);
    }
    if (await isReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`next start no respondió en ${baseUrl} dentro de 180 segundos.`);
}

function stopProcessTree(server) {
  if (!server.pid || server.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
}

if (await isReady()) {
  throw new Error(`El puerto ${port} ya está ocupado. Las pruebas E2E no tocaron ese proceso.`);
}

const server = spawn(process.execPath, [nextCli, "start", "-H", host, "-p", port], {
  stdio: "ignore",
});

let testExitCode = 1;
try {
  await waitForServer(server);
  const tests = spawnSync(process.execPath, [playwrightCli, "test"], {
    stdio: "ignore",
    timeout: 120_000,
  });
  if (tests.error) throw tests.error;
  testExitCode = tests.status ?? 1;
  console.log(tests.status === 0 ? "Pruebas E2E aprobadas en Chromium (puerto 3100)." : "Las pruebas E2E fallaron.");
} finally {
  stopProcessTree(server);
}

// Windows can retain a closed child-process handle after taskkill even though
// neither Next nor Playwright remains running. Exit with Playwright's real code.
process.exit(testExitCode);
