// Pinned runtimes live outside repositories, with immutable SHA-256 blobs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { customizationDigest, verify } from './build.mjs';

// Pin cache root: MOCKSHOP_PIN_CACHE if set, else the per-user cache dir ($XDG_CACHE_HOME/mockshop/pins, falling back to
// ~/.cache/mockshop/pins). A relative XDG_CACHE_HOME is ignored, as the XDG spec requires.
export function cacheRoot(env = process.env) {
  if (env.MOCKSHOP_PIN_CACHE) return path.resolve(env.MOCKSHOP_PIN_CACHE);
  const xdg = env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(env.HOME || os.homedir(), '.cache');
  return path.join(xdg, 'mockshop', 'pins');
}
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const safe = s => /^[a-zA-Z0-9_.-]+$/.test(s) && s !== '.' && s !== '..';
const safePath = s => s && !path.isAbsolute(s) && !s.split(/[\\/]/).some(x => x === '..' || x === '.') && !s.includes('\\');
export function pinId(m) {
  const p = m.pin || m.synora;
  if (m.kind === 'captured-frontend') return `${p.version || p.portal || p.shell}-${p.manifest_sha256}`;
  const variant = hash(JSON.stringify({ customization: customizationDigest(m), edition: m.edition, toolchain: m.toolchain, build: m.build, runtime: m.runtime }));
  return `${m.upstream.commit}-${m.edition || 'default'}-${variant.slice(0,16)}`;
}
function location(m) {
  const id = pinId(m);
  if (!safe(m.name) || !safe(id)) throw new Error('invalid cache plugin or pin ID');
  return path.join(cacheRoot(), m.name, id);
}
function walk(dir, prefix = '') {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => {
    const rel = prefix + e.name;
    return e.isDirectory() ? walk(path.join(dir,e.name),rel + '/') : [rel];
  });
}
const contentType = file => ({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream';
function atomic(file, bytes) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp,bytes); fs.renameSync(tmp,file);
}
export function seedPin(m) {
  const check = verify(m);
  if (!check.ok) throw new Error(`${m.name}: refusing to cache an invalid runtime: ${check.problems.join('; ')}`);
  const dir = location(m), capturedAt = new Date().toISOString();
  const urls = Object.fromEntries(Object.entries(check.runtime?.assets || {}).map(([url,a])=>[a.file,url]));
  const files = {};
  for (const file of walk(m.runtimeDir)) {
    if (!safePath(file)) throw new Error(`unsafe runtime path: ${file}`);
    if ((m.runtime.runtime_written || []).some(p=>file === p.replace(/\/$/,'') || file.startsWith(p))) continue;
    const src = path.join(m.runtimeDir,file), st = fs.lstatSync(src);
    const symlink = st.isSymbolicLink() ? fs.readlinkSync(src) : undefined;
    const bytes = symlink === undefined ? fs.readFileSync(src) : Buffer.from(symlink);
    const sha256 = hash(bytes), blob = path.join(dir,'blobs',sha256);
    if (!fs.existsSync(blob) || hash(fs.readFileSync(blob)) !== sha256) atomic(blob,bytes);
    files[file] = {sha256,size:bytes.length,content_type:contentType(file),captured_at:capturedAt,mode:st.mode & 0o777,...(urls[file]?{url:urls[file]}:{}),...(symlink===undefined?{}:{symlink})};
  }
  const manifest = {schema:1,plugin:m.name,pin:pinId(m),captured_at:capturedAt,files};
  const dest = path.join(dir,'manifest.json');
  if (fs.existsSync(dest)) {
    const old = json(dest);
    if (JSON.stringify(Object.entries(old.files).map(([p,v])=>[p,v.sha256]).sort()) !== JSON.stringify(Object.entries(files).map(([p,v])=>[p,v.sha256]).sort())) throw new Error(`${m.name}: cached pin is immutable; runtime files differ`);
  } else atomic(dest,JSON.stringify(manifest,null,2)+'\n');
  return {plugin:m.name,pin:pinId(m),files:Object.keys(files).length,size:Object.values(files).reduce((n,f)=>n+f.size,0),path:dir};
}
function inspect(dir, manifest) {
  const problems = [];
  for (const [file,a] of Object.entries(manifest.files || {})) {
    if (!safePath(file) || !/^[a-f0-9]{64}$/.test(a.sha256)) { problems.push(`invalid entry ${file}`); continue; }
    const blob = path.join(dir,'blobs',a.sha256);
    if (!fs.existsSync(blob)) problems.push(`missing blob for ${file}`);
    else { const bytes = fs.readFileSync(blob); if (hash(bytes)!==a.sha256 || bytes.length!==a.size) problems.push(`corrupt blob for ${file}`); }
  }
  return problems;
}
export function listCache(plugin) {
  const root = cacheRoot(); if (!fs.existsSync(root)) return [];
  const pins = [];
  for (const p of fs.readdirSync(root).filter(safe)) {
    if (plugin && p!==plugin || !fs.statSync(path.join(root,p)).isDirectory()) continue;
    for (const id of fs.readdirSync(path.join(root,p)).filter(safe)) {
      const dir=path.join(root,p,id),file=path.join(dir,'manifest.json'); if (!fs.existsSync(file)) continue;
      const manifest=json(file),files=Object.values(manifest.files || {});
      pins.push({plugin:p,pin:id,files:files.length,size:files.reduce((n,f)=>n+f.size,0),path:dir});
    }
  }
  return pins;
}
export function verifyCache(plugin) {
  return listCache(plugin).map(pin=>({...pin,problems:inspect(pin.path,json(path.join(pin.path,'manifest.json')))}));
}
export function restorePin(m) {
  const dir=location(m),file=path.join(dir,'manifest.json'); if (!fs.existsSync(file)) return false;
  const manifest=json(file),problems=inspect(dir,manifest);
  if (problems.length) { console.warn(`[mockshop] ${m.name}: cache corrupt (${problems[0]}); falling back to build/capture`); return false; }
  const tmp=`${m.runtimeDir}.cache-${process.pid}`;
  fs.mkdirSync(tmp,{recursive:true});
  try {
    // Write regular files before links so a cached link cannot redirect a write.
    for (const [rel,a] of Object.entries(manifest.files)) if (a.symlink===undefined) {
      const dest=path.join(tmp,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.copyFileSync(path.join(dir,'blobs',a.sha256),dest);fs.chmodSync(dest,a.mode || 0o644);
    }
    for (const [rel,a] of Object.entries(manifest.files)) if (a.symlink!==undefined) {
      if (path.isAbsolute(a.symlink) || !path.resolve(path.dirname(path.join(tmp,rel)),a.symlink).startsWith(tmp + path.sep)) throw new Error(`unsafe cached symlink: ${rel}`);
      fs.mkdirSync(path.dirname(path.join(tmp,rel)),{recursive:true});fs.symlinkSync(a.symlink,path.join(tmp,rel));
    }
    const check=verify({...m,runtimeDir:tmp});if (!check.ok) throw new Error(`restored pin fails verification: ${check.problems.join('; ')}`);
    fs.rmSync(m.runtimeDir,{recursive:true,force:true});fs.renameSync(tmp,m.runtimeDir);
  } catch(e) {fs.rmSync(tmp,{recursive:true,force:true});throw e;}
  console.log(`[mockshop] ${m.name}: restored ${Object.keys(manifest.files).length} files from ${dir}`);
  return true;
}
