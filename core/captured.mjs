import fs from 'node:fs';
import path from 'node:path';
import {parseYaml, setAnchor} from './fixtures.mjs';

export async function routeCaptured(context, manifest, {anchor, clockOffset = anchor - Date.now(), mockUrl, strict = false}) {
  const origins = manifest.runner?.origins || [];
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const rule = origins.find((r) => request.url().startsWith(r.prefix));
    if (!rule) return route.abort('blockedbyclient');
    if (rule.target === 'mock') {
      const headers = {...request.headers(), 'x-mockshop-host': url.host};
      if (strict) headers['x-mockshop-strict'] = 'true';
      delete headers.host; delete headers['content-length'];
      const response = await context.request.fetch(`${mockUrl}/${url.host}${url.pathname}${url.search}`, {
        method: request.method(), headers, data: request.postDataBuffer() ?? undefined, maxRedirects: 0,
      });
      return route.fulfill({response});
    }
    if (!rule.target.startsWith('runtime:')) return route.abort('blockedbyclient');
    const root = path.resolve(manifest.runtimeDir, rule.target.slice(8));
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + path.sep)) return route.abort('blockedbyclient');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && rule.spa && request.resourceType() === 'document') file = path.join(root, 'index.html');
    if (!fs.existsSync(file)) return route.fulfill({status:404, body:`Uncaptured asset: ${url.pathname}`});
    const types = {'.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon'};
    return route.fulfill({path:file, contentType:types[path.extname(file)] || 'application/octet-stream'});
  });
  setAnchor(anchor);
  const ctx = {manifest, anchor, mockUrl, fixturesDir:manifest.fixturesDir};
  const core = {...ctx, demoNow:() => Date.now() + clockOffset, readFixture:(relative) => parseYaml(path.join(manifest.fixturesDir, relative))};
  const hooks = manifest.mock?.ws ? [].concat(await (await import(path.resolve(manifest.dir, manifest.mock.ws))).default(core)) : [];
  await context.routeWebSocket('**/*', async (ws) => {
    const hook = hooks.find((h) => new RegExp('^' + h.match.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(ws.url()));
    if (hook) await hook.onConnect(ws, ctx); else ws.close({code:1008, reason:'Unmocked endpoint'});
  });
  // Playwright's WebSocket mock uses an empty subclass. noVNC reflects only the
  // immediate prototype, so expose the same inherited API without changing it.
  await context.addInitScript(() => {
    const prototype = WebSocket.prototype;
    const inherited = Object.getPrototypeOf(prototype);
    for (const key of ["send", "close", "binaryType", "onerror", "onmessage", "onopen", "onclose"]) {
      if (Object.hasOwn(prototype, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(inherited, key);
      if (descriptor) Object.defineProperty(prototype, key, descriptor);
    }
  });
}
