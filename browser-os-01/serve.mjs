import { fileURLToPath } from 'node:url';
import { serve } from './tests/serve.mjs';

const port = Number(process.env.PORT || 8080);
const root = fileURLToPath(new URL('.', import.meta.url));
const { url, close } = await serve(root, port);

console.log(`Browser OS is serving ${root}`);
console.log(`Open ${url} in your browser.`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { close(); process.exit(0); });
}
