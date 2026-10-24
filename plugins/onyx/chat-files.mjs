// Files a scripted code interpreter step "generated" (reply.code.files): the adapter writes their bytes and
// serving headers to <overlay>/chat-files/, and GET /chat/file/:id serves them like the pinned backend's
// fetch_chat_file (backend/onyx/file_store/serving.py resolve_inline_disposition).
import fs from "node:fs";
import path from "node:path";

export const CHAT_FILES_DIR = "chat-files";

// Extension -> stored MIME type (the backend guesses it from the file name the sandbox wrote).
const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", log: "text/plain",
  csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", md: "text/markdown",
  html: "text/html", svg: "image/svg+xml", py: "text/x-python",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
// INLINE_SAFE_MIME_TYPES keep their type and an inline disposition; anything else is downgraded to an
// application/octet-stream attachment (the preview modal then resolves the type from the file name).
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"]);

export const chatFileExtensions = Object.keys(MIME);
export function chatFileMime(name) {
  const ext = /\.([^./\\\s]+)$/.exec(name)?.[1]?.toLowerCase();
  return ext ? MIME[ext] ?? null : null;
}

export function chatFileHeaders(name) {
  const stored = chatFileMime(name) || "application/octet-stream";
  const cleaned = name.replace(/[\x00-\x1f\x7f"\\/]/g, "_").trim() || "download";
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_");
  const inline = INLINE.has(stored);
  return {
    "content-type": inline ? stored : "application/octet-stream",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
  };
}

// Adapter side: one bytes file plus one JSON metadata file per generated file id. `file.parsed_preview` ({sheets:[{name, csv, truncated}]})
// is what GET /chat/file/<id>?parsed=true returns for a spreadsheet, so the in-app preview renders its values.
export function writeChatFile(outputDir, file, bytes) {
  const dir = path.join(outputDir, CHAT_FILES_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file.id), bytes);
  fs.writeFileSync(path.join(dir, `${file.id}.json`), JSON.stringify({ name: file.name, headers: chatFileHeaders(file.name), ...(file.parsed_preview ? { parsed_preview: file.parsed_preview } : {}) }));
}

// Server side: the highest active layer that has the id wins; ids are generated UUIDs, never paths.
export function findChatFile(layerDirs, id) {
  if (!/^[\w-]+$/.test(id)) return null;
  for (const dir of layerDirs) {
    const meta = path.join(dir, `${id}.json`);
    if (fs.existsSync(meta)) return { ...JSON.parse(fs.readFileSync(meta, "utf8")), bytes: fs.readFileSync(path.join(dir, id)) };
  }
  return null;
}
