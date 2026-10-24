// Onyx is the boundary between shared content and the pinned frontend's DTOs.
// Entry point required by core/script.mjs; the work is split per entity under adapter/ (see adapter/materialize.mjs).
export { compile } from "./adapter/compile.mjs";
