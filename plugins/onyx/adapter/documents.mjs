// Documents: shared documents -> source documents, source bodies and the user-search seed.
import fs from "node:fs";
import path from "node:path";
import { own, entries, digest, fileKey, fail, urlFor, checkUrl } from "./shared.mjs";

export function derive(ctx) {
  const { content, app, script, outputDir, routes, personDto, sourceMap, docMap } = ctx;
  for (const [key, doc] of entries(content.documents)) {
    const source = content.sources?.[doc.source];
    if (!source || !sourceMap[doc.source]) fail(`documents.${key}.source`, `missing source ${doc.source}`, script);
    if (sourceMap[doc.source].unsupported) continue;
    const mapping = app.documents?.[key] || {};
    const id = mapping.id || `DOC-${digest(`onyx:documents:${key}`).slice(0, 20)}`;
    if (!fileKey(id)) fail(`apps.onyx.documents.${key}.id`, "document ID must be a safe filename", script);
    if (Object.values(docMap).some((d) => d.id === id)) fail(`apps.onyx.documents.${key}.id`, `duplicate document ID ${id}`, script);
    checkUrl(doc.url, source.vendor, `documents.${key}.url`, script, mapping.url_vendor);
    docMap[key] = { ...mapping, id, title: doc.title, source: source.vendor, link: doc.url || urlFor(source.vendor, key, content.company?.domain), blurb: mapping.blurb ?? doc.body?.slice(0, 240) ?? "", owners: (doc.owners || (doc.author ? [doc.author] : [])).map((p) => personDto(p).email), content: doc.body || "" };
    delete docMap[key].url_vendor;
    fs.mkdirSync(path.join(outputDir, "sources"), { recursive: true });
    fs.writeFileSync(path.join(outputDir, "sources", `${id}.md`), doc.body || docMap[key].blurb);
  }
  if (!own(app.fixtures || {}, "GET /mockshop/user-search-seed")) routes["GET /mockshop/user-search-seed"].documents = Object.values(docMap).map((doc) => ({ ...doc, tags: [], document_sets: [], updated: doc.updated || "{{ago:1d}}" }));
}
