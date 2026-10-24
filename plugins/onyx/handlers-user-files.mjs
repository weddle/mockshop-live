// #28: fictional catalog metadata and synthetic previews only. Never retain caller bytes/secrets.
// Root handlers compose this module with the sole chat engine; it does not create or stream chats.
import { Readable } from "node:stream";

// The platform multipart reader is request-local. Return metadata only, then release all File objects.
async function uploadMetadata(req) {
  const request = new Request("http://localhost/user/projects/file/upload", {
    method: "POST", headers: { "content-type": req.headers["content-type"] || "" },
    body: Readable.toWeb(req), duplex: "half",
  });
  const form = await request.formData();
  let tempIds = {};
  try { tempIds = JSON.parse(String(form.get("temp_id_map") || "{}")); } catch { /* no optimistic mapping */ }
  const project = form.get("project_id");
  return {
    projectId: project == null ? null : Number(project),
    files: form.getAll("files").filter((f) => typeof f !== "string").map((f) => ({
      name: f.name, tempId: tempIds[`${f.size}|${f.name.slice(0, 50)}`] ?? null,
    })),
  };
}

export default function createUserFilesHandlers(core, companions = {}) {
  let records = null;
  let sessionRefs = new Map();
  const demo = () => core.fixture("GET", "/mockshop/user-files");
  const catalog = () => demo().catalog;
  const now = () => new Date(core.demoNow()).toISOString();
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const init = () => {
    if (records) return;
    records = new Map(catalog().filter((f) => demo().seed_ids.includes(f.key)).map((f) => [f.id, {
      key: f.key, created: now(), accessed: now(), readyAt: 0, projectId: null, tempId: null,
    }]));
  };
  const entryForRecord = (record) => catalog().find((f) => f.key === record.key);
  const snapshot = (id, includeDeleted = false) => {
    init();
    const record = records.get(id);
    if (!record || (record.deleted && !includeDeleted)) return null;
    const entry = entryForRecord(record);
    if (!entry) return null;
    const status = record.deleting ? "DELETING" : Date.now() < record.readyAt ? "PROCESSING" : entry.final_status || "COMPLETED";
    return {
      id: entry.id, name: entry.name, file_id: entry.file_id, project_id: record.projectId,
      user_id: core.fixture("GET", "/me")?.id ?? null, created_at: record.created,
      last_accessed_at: record.accessed, status, file_type: entry.file_type,
      chat_file_type: entry.chat_file_type, token_count: status === "COMPLETED" ? entry.token_count : null,
      chunk_count: status === "COMPLETED" ? entry.chunk_count : null, temp_id: record.tempId,
    };
  };
  const getFile = (id) => snapshot(id);
  const listFiles = () => {
    init();
    return [...records.keys()].reverse().map(getFile).filter(Boolean);
  };
  const sessionFiles = (id) => [...(sessionRefs.get(id) || [])].map(getFile).filter(Boolean);
  const descriptor = (file) => ({ id: file.file_id, type: file.chat_file_type, name: file.name, user_file_id: file.id });
  // Only this module's known, ready files enter its attachment index. Other engines remain untouched.
  const attachMessage = (sessionId, descriptors = []) => {
    const files = descriptors.map((d) => getFile(d.user_file_id) || listFiles().find((f) => f.file_id === d.id))
      .filter((f) => f?.status === "COMPLETED");
    const unique = [...new Map(files.map((f) => [f.id, f])).values()];
    if (unique.length) {
      const refs = sessionRefs.get(sessionId) || new Set();
      for (const file of unique) { refs.add(file.id); records.get(file.id).accessed = now(); }
      sessionRefs.set(sessionId, refs);
    }
    return unique.map(descriptor);
  };
  // Save the returned script on the existing assistant node; replay uses the existing chat.mjs unchanged.
  // On regenerate pass the saved user node's files, not a cleared composer request.
  const scriptForFiles = (descriptors = []) => {
    const entries = descriptors.map((d) => catalog().find((f) => f.id === d.user_file_id && f.file_id === d.id))
      .filter((f) => f && !f.reject && f.final_status !== "FAILED");
    if (!entries.length) return null;
    return {
      title: demo().answer_title, chunk_delay_ms: 12,
      answer: `${demo().answer_intro}\n\n${entries.map((f, i) => `- **${f.name}**: ${f.answer} [${i + 1}]`).join("\n")}`,
      documents: entries.map((f) => ({ id: `project_file__${f.file_id}`, title: f.name, source: "user_file",
        blurb: f.answer, updated: now(), metadata: { demo: "synthetic fixture; uploaded bytes discarded" } })),
    };
  };
  // The same catalog bytes serve Craft outputs without creating a library upload record.
  const serveFile = async (ctx) => {
    const entry = catalog().find((f) => f.file_id === ctx.params.id);
    if (!entry) return false;
    await pause(demo().preview_delay_ms);
    if (entry.preview_error) return ctx.send(404, { detail: "Intentional fictional preview-unavailable state." });
    const headers = { "content-type": entry.file_type,
      "content-disposition": `inline; filename="${entry.name.replace(/["\r\n]/g, "")}"` };
    if (ctx.query.parsed === "true" && entry.parsed_preview) {
      return ctx.send(200, entry.parsed_preview, { ...headers, "content-type": "application/json" });
    }
    if (entry.preview_base64) {
      ctx.res.writeHead(200, headers);
      return ctx.res.end(Buffer.from(entry.preview_base64, "base64"));
    }
    ctx.send(200, entry.preview, headers);
  };

  return {
    getFile, listFiles, sessionFiles, attachMessage, scriptForFiles, serveFile,
    reset(body = {}) {
      if (!body.keep) { records = null; sessionRefs = new Map(); }
    },
    transform: {
      "GET /user/files/recent": (value) => {
        const ownIds = new Set(catalog().map((f) => f.id));
        return [...listFiles(), ...(value || []).filter((f) => !ownIds.has(f.id))];
      },
    },
    routes: [
      { method: "POST", path: "/user/projects/file/upload", async handle(ctx) {
        const metadata = await uploadMetadata(ctx.req);
        init();
        const accepted = [], rejected = [];
        for (const input of metadata.files) {
          const entry = catalog().find((f) => f.name === input.name);
          if (!entry || entry.reject) {
            // Ephemeral filename is required for native optimistic-row rollback, never saved in state.
            rejected.push({ file_name: input.name, reason: demo().rejection_reason });
            continue;
          }
          records.set(entry.id, { key: entry.key, created: now(), accessed: now(),
            readyAt: Date.now() + demo().upload_delay_ms + demo().processing_delay_ms,
            projectId: metadata.projectId, tempId: input.tempId });
          accepted.push(entry.id);
        }
        if (metadata.projectId != null && accepted.length) companions.onProjectUpload?.(metadata.projectId, accepted);
        await pause(demo().upload_delay_ms);
        ctx.send(200, { user_files: accepted.map(getFile), rejected_files: rejected });
      } },
      { method: "POST", path: "/user/projects/file/statuses", async handle(ctx) {
        const body = await ctx.body();
        ctx.send(200, (body.file_ids || []).map(getFile).filter(Boolean));
      } },
      { method: "GET", path: "/user/projects/session/:id/files", handle(ctx) {
        const own = sessionFiles(ctx.params.id);
        const project = companions.projectFilesForSession?.(ctx.params.id) || [];
        const seeded = core.fixture("GET", ctx.path) || [];
        ctx.send(200, [...new Map([...seeded, ...project, ...own].map((f) => [f.id, f])).values()]);
      } },
      { method: "DELETE", path: "/user/projects/file/:id", async handle(ctx) {
        const file = getFile(ctx.params.id);
        if (!file) return ctx.send(404, { detail: "Fictional user file not found." });
        const entry = entryForRecord(records.get(file.id));
        const projectNames = companions.projectNamesForFile?.(file.id) || [];
        const assistantNames = entry.assistant_names || [];
        const blocked = projectNames.length > 0 || assistantNames.length > 0;
        if (!blocked) {
          records.get(file.id).deleting = true;
          await pause(demo().delete_delay_ms);
          records.get(file.id).deleted = true;
          records.get(file.id).deleting = false;
          for (const refs of sessionRefs.values()) refs.delete(file.id);
          companions.onFileRemoved?.(file.id);
        }
        ctx.send(200, { has_associations: blocked, project_names: projectNames, assistant_names: assistantNames });
      } },
      // Prepend before the existing generic /chat/file/:id source handler. Unknown IDs fall through.
      { method: "GET", path: "/chat/file/:id", async handle(ctx) {
        init();
        const entry = catalog().find((f) => f.file_id === ctx.params.id && records.has(f.id));
        if (!entry) return false;
        records.get(entry.id).accessed = now();
        // Tombstoned synthetic previews remain available to already-saved historic citation snapshots.
        return serveFile(ctx);
      } },
    ],
  };
}
