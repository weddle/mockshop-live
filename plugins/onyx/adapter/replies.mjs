// Replies: prepared chat replies (apps.onyx.replies) and the reply() builder used by conversations and prepared turns.
import fs from "node:fs";
import path from "node:path";
import { entries, plain, fileKey, fail, writeYaml, digest, uuid } from "./shared.mjs";
import { chatFileExtensions, chatFileMime, writeChatFile } from "../chat-files.mjs";

// backend/onyx/tools/tool_implementations/web_search/models.py WEB_SEARCH_PREFIX: web search and open_url
// documents are keyed by the page URL.
const WEB_PREFIX = "WEB_SEARCH_DOC_";
const isUrl = (v) => typeof v === "string" && /^https?:\/\/[^\s/]+\.[^\s]+$/.test(v);
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function derive(ctx) {
  const { app, script, outputDir, docMap, project, inputs } = ctx;
  const strings = (value, field) => {
    if (value != null && (!Array.isArray(value) || value.some((q) => typeof q !== "string"))) fail(field, "expected a string list", script);
    return value;
  };
  const onlyKeys = (value, keys, field) => {
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${field}.${key}`, `unsupported field; expected ${keys.join(", ")}`, script);
  };
  // web_search: {queries, results:[{title,url,snippet,published?}]} -> internet SearchDocs (inference_section_from_internet_search_result).
  const webSearch = (value, field) => {
    if (value == null || typeof value === "boolean") return value;
    if (!plain(value)) fail(field, "expected true/false or {queries, results}", script);
    onlyKeys(value, ["queries", "results"], field);
    const queries = strings(value.queries, `${field}.queries`) || [];
    const results = value.results || [];
    if (!Array.isArray(results)) fail(`${field}.results`, "expected a list of {title, url, snippet}", script);
    const documents = results.map((r, i) => {
      const at = `${field}.results.${i}`;
      if (!plain(r) || typeof r.title !== "string" || !isUrl(r.url)) fail(at, "expected {title, url, snippet?, published?} with an http(s) URL", script);
      onlyKeys(r, ["title", "url", "snippet", "published"], at);
      const snippet = r.snippet ?? "";
      return { id: WEB_PREFIX + r.url, title: r.title, source: "web", link: r.url, external: true, is_internet: true,
        blurb: snippet, highlights: [snippet], score: Number((1 / (i + 1)).toFixed(4)), updated: r.published ?? null, metadata: {} };
    });
    return { queries, documents };
  };
  // open_url: [url | {url, title?}] -> crawled-page SearchDocs (inference_section_from_internet_page_scrape: blurb is the title).
  const openUrl = (value, field) => {
    if (value == null) return null;
    if (!Array.isArray(value) || !value.length) fail(field, "expected a non-empty list of URLs or {url, title}", script);
    const pages = value.map((p, i) => {
      const at = `${field}.${i}`;
      const page = typeof p === "string" ? { url: p } : p;
      if (!plain(page) || !isUrl(page.url) || (page.title != null && typeof page.title !== "string")) fail(at, "expected an http(s) URL or {url, title}", script);
      onlyKeys(page, ["url", "title"], at);
      return page;
    });
    return { urls: pages.map((p) => p.url), documents: pages.map((p, i) => ({ id: WEB_PREFIX + p.url, title: p.title || p.url,
      source: "web", link: p.url, external: true, is_internet: false, blurb: p.title || p.url, score: Number((1 / (i + 1)).toFixed(4)), metadata: {} })) };
  };
  // A relative `path` resolves from the YAML file that declares it: the world file for world replies, the script for sends.
  const declaringFile = (at) => script._resolved?.contentOrigins?.[at]?.file || script._resolved?.source;
  const fileBytes = (f, at) => {
    const sources = ["body", "rows", "path"].filter((k) => f[k] !== undefined);
    if (sources.length !== 1) fail(at, "declare exactly one of body (or body_file), rows or path", script);
    if (f.body !== undefined) {
      if (typeof f.body !== "string") fail(`${at}.body`, "expected text", script);
      return Buffer.from(f.body, "utf8");
    }
    if (f.rows !== undefined) {
      if (!Array.isArray(f.rows) || f.rows.some((r) => !Array.isArray(r) || r.some((c) => c !== null && typeof c === "object"))) fail(`${at}.rows`, "expected a list of rows (lists of scalars)", script);
      const sep = f.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
      return Buffer.from(f.rows.map((r) => r.map(sep === "," ? csvCell : (c) => String(c ?? "")).join(sep)).join("\n") + "\n", "utf8");
    }
    const value = f.path;
    if (typeof value !== "string" || !value || path.isAbsolute(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.includes("\\") || value.includes("\0") || value.startsWith("~"))
      fail(`${at}.path`, "expected an explicit relative local file path", script);
    const from = declaringFile(`${at}.path`);
    if (!from || from.startsWith("<")) fail(`${at}.path`, "a declaring file is required for relative file paths", script);
    const file = path.resolve(path.dirname(from), value);
    let bytes;
    try { bytes = fs.readFileSync(fs.realpathSync(file)); } catch (error) { fail(`${at}.path`, `cannot read ${value}: ${error.message}`, script); }
    inputs.push({ file: fs.realpathSync(file), hash: digest(bytes) });
    return bytes;
  };
  // xlsx only: {sheets:[{name, csv, truncated?}]}, normalised to what the preview expects (truncated is always a boolean).
  const parsedPreview = (f, at) => {
    if (f.parsed_preview === undefined) return undefined;
    const field = `${at}.parsed_preview`;
    if (!f.name.toLowerCase().endsWith(".xlsx")) fail(field, "parsed_preview applies to .xlsx files only", script);
    if (!plain(f.parsed_preview)) fail(field, "expected {sheets: [{name, csv, truncated?}]}", script);
    onlyKeys(f.parsed_preview, ["sheets"], field);
    const sheets = f.parsed_preview.sheets;
    if (!Array.isArray(sheets) || !sheets.length) fail(`${field}.sheets`, "expected a non-empty list of sheets", script);
    return { sheets: sheets.map((sheet, i) => {
      const where = `${field}.sheets.${i}`;
      if (!plain(sheet) || typeof sheet.name !== "string" || !sheet.name || typeof sheet.csv !== "string") fail(where, "expected {name, csv, truncated?} with text name and csv", script);
      onlyKeys(sheet, ["name", "csv", "truncated"], where);
      if (sheet.truncated != null && typeof sheet.truncated !== "boolean") fail(`${where}.truncated`, "expected true or false", script);
      return { name: sheet.name, csv: sheet.csv, truncated: sheet.truncated === true };
    }) };
  };
  // code: {source, output?, error?, files?} -> python_tool_start/python_tool_delta; files get stable file-store ids.
  const codeStep = (value, field) => {
    if (value == null) return null;
    if (!plain(value) || typeof value.source !== "string" || !value.source.trim()) fail(field, "expected {source, output?, error?, files?}", script);
    onlyKeys(value, ["source", "output", "error", "files"], field);
    for (const key of ["output", "error"]) if (value[key] != null && typeof value[key] !== "string") fail(`${field}.${key}`, "expected text", script);
    if (value.files != null && !Array.isArray(value.files)) fail(`${field}.files`, "expected a list of files", script);
    const names = new Set();
    const files = (value.files || []).map((f, i) => {
      const at = `${field}.files.${i}`;
      if (!plain(f) || typeof f.name !== "string" || !fileKey(f.name)) fail(`${at}.name`, "expected a safe file name such as chart.png", script);
      onlyKeys(f, ["name", "body", "rows", "path", "parsed_preview"], at);
      if (!chatFileMime(f.name)) fail(`${at}.name`, `unsupported file type; use one of .${chatFileExtensions.join(", .")}`, script);
      if (names.has(f.name)) fail(`${at}.name`, `duplicate generated file ${f.name}`, script);
      names.add(f.name);
      const bytes = fileBytes(f, at);
      const file = { id: uuid("chat-file", `${f.name}:${digest(bytes)}`), name: f.name };
      writeChatFile(outputDir, { ...file, parsed_preview: parsedPreview(f, at) }, bytes);
      return file;
    });
    return { source: value.source, stdout: value.output ?? "", stderr: value.error ?? "", files };
  };
  // The answer links a generated file by its name, as the model does with the execution result's file_link:
  // "[chart.png](chart.png)" becomes "[chart.png](/api/chat/file/<id>)" (an image name renders inline).
  const linkFiles = (text, files) => files.reduce((t, f) => t.split(`](${f.name})`).join(`](/api/chat/file/${f.id})`), text);

  const reply = (value, field) => {
    if (!plain(value) || typeof value.text !== "string") fail(field, "reply requires text", script);
    strings(value.queries, `${field}.queries`);
    const web = webSearch(value.web_search, `${field}.web_search`);
    const opened = openUrl(value.open_url, `${field}.open_url`);
    const code = codeStep(value.code, `${field}.code`);
    const cites = value.cites || [];
    if (!Array.isArray(cites)) fail(`${field}.cites`, "expected document keys or cited web page URLs", script);
    // A cite is a world document key, or the URL of a page in this reply's web_search results or open_url list.
    const webPages = new Map([...(web?.documents || []), ...(opened?.documents || [])].map((d) => [d.link, d]));
    const cited = cites.map((key) => {
      if (docMap[key]) return docMap[key];
      if (isUrl(key)) {
        if (!webPages.has(key)) fail(`${field}.cites`, `${key} is not a web_search result or open_url page of this reply`, script);
        return webPages.get(key);
      }
      fail(`${field}.cites`, `unknown document or unsupported source for ${key}`, script);
    });
    for (const match of value.text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g)) for (const n of match[1].split(/\s*,\s*/).map(Number)) if (n < 1 || n > cited.length) fail(`${field}.text`, `citation [${n}] has no entry in cites`, script);
    const { text, cites: ignored, web_search: ignoredWeb, open_url: ignoredOpen, code: ignoredCode, ...rest } = value;
    return project({ ...rest, answer: code ? linkFiles(text, code.files) : text,
      documents: cited.filter((d) => !d.id.startsWith(WEB_PREFIX)),
      citations: Object.fromEntries(cited.map((d, i) => [i + 1, d.id])),
      ...(web != null ? { web_search: web } : {}), ...(opened ? { open_url: opened } : {}), ...(code ? { code } : {}) });
  };
  for (const [key, value] of entries(app.replies)) {
    if (!fileKey(key)) fail(`apps.onyx.replies.${key}`, "reply key must be a safe filename", script);
    writeYaml(path.join(outputDir, "chat", `${key}.yaml`), reply(value, `apps.onyx.replies.${key}`));
  }
  Object.assign(ctx, { reply });
}
