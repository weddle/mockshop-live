// Indexes and projection: keeps compact document/connector/credential/person/agent snapshots inside seed DTOs in sync with the canonical entities.
import { own, entries, plain } from "./shared.mjs";

export function derive(ctx) {
  const { content, personMap, personIds, sourceMap, docMap } = ctx;
  const docsById = new Map(Object.values(docMap).map((doc) => [doc.id, doc]));
  const pairsById = new Map(Object.values(sourceMap).filter((s) => !s.unsupported).map((s) => [s.id, s]));
  const connectorsById = new Map(Object.values(sourceMap).filter((s) => !s.unsupported).map((s) => [s.connector.id, s]));
  const credentialsById = new Map(Object.values(sourceMap).filter((s) => !s.unsupported).map((s) => [s.credential.id, s]));
  const agentsById = new Map();
  // Feature seed DTOs may embed compact document/connector snapshots. Project those
  // from the same canonical entities rather than leaving stale vendor/name copies.
  const project = (value) => {
    if (Array.isArray(value)) return value.map(project);
    if (!plain(value)) return value;
    const out = Object.fromEntries(entries(value).map(([key, v]) => [key, project(v)]));
    const doc = docsById.get(value.id || value.document_id);
    if (doc && (own(value, "source") || own(value, "source_type"))) {
      for (const field of ["title", "link", "owners", "content"]) if (own(out, field)) out[field] = doc[field] ?? out[field];
      if (own(out, "source")) out.source = doc.source;
      if (own(out, "source_type")) out.source_type = doc.source;
      if (own(out, "semantic_identifier")) out.semantic_identifier = doc.title;
    }
    const pair = pairsById.get(value.cc_pair_id);
    if (pair) {
      if (own(out, "name")) out.name = pair.row.name;
      if (own(out, "source")) out.source = pair.row.source;
      if (out.connector) out.connector = { ...out.connector, ...pair.connector };
      if (out.credential) out.credential = { ...out.credential, ...pair.credential };
    }
    const connector = connectorsById.get(value.id);
    if (connector && (own(value, "connector_specific_config") || own(value, "credential_ids"))) Object.assign(out, connector.connector);
    const credential = credentialsById.get(value.id);
    if (credential && own(value, "credential_json")) Object.assign(out, credential.credential);
    const personKey = personIds.get(value.id), person = personKey && personMap.get(personKey);
    if (person && own(out, "email")) {
      out.email = person.email;
      for (const field of ["name", "personal_name"]) if (own(out, field)) out[field] = person.name;
    }
    const agent = agentsById.get(value.id);
    if (agent && (own(value, "builtin_persona") || own(value, "knowledge_sources"))) {
      for (const field of ["name", "description", "knowledge_sources"]) if (own(out, field)) out[field] = agent[field];
    }
    return out;
  };
  Object.assign(ctx, { docsById, pairsById, connectorsById, credentialsById, agentsById, project });
}
