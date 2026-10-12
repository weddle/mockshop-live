# Onyx fixture and state architecture

Mockshop serves Onyx's native frontend against a local fixture backend. The authoritative implementation is [handlers.mjs](handlers.mjs), its composed `handlers-*.mjs` modules, [chat.mjs](chat.mjs), the YAML files under `fixtures/` and the pinned upstream frontend. This document describes the architecture; it is not a complete upstream API or backend compatibility specification.

## Request flow

The plugin manifest selects `handlers.mjs`, fixture directories and `/api` prefix stripping. The mock server loads base fixtures and declared overlay layers, then serves matching routes and dynamic handlers. The frontend's local Next server forwards its API requests to the mock backend using the runtime environment in `plugin.yaml`.

Keep responses shaped for the actual pinned component that consumes them. Editable demo text and records belong in fixtures. Add only the endpoint or in-run state needed to stage the intended screen or interaction; do not build a production service.

## Main data families

| Family | Demo behavior |
|---|---|
| Current user and settings | Fictional identity, preferences, theme, default model and supported saved settings. |
| Chat and history | Scripted streaming packets, saved conversations, message branches, model attribution and configured follow-up content. |
| Citations and sources | Fixture-backed source metadata and local preview content. |
| Agents and models | Editable seeded configuration, selections and supported in-run changes. |
| Files and projects | Fictional metadata, previews, associations and the limited writes required by native controls. |
| Sharing and feedback | Local state for supported dialogs and visible outcomes, not internet publication or real authorization. |
| Admin and Craft | Fixture-backed lists, forms and supported controls; no production integration, indexing or scheduling engine. |
| Authentication interfaces | Local fictional states and responses for supported screens; no real identity provider or email delivery. |

## Composition and reset

The root plugin composes focused handler modules around shared state. Reuse the existing owner of a record or collection rather than creating a second store for another screen. Related list, detail and edit responses must observe the same in-run changes.

Scenario overlays select the seed content. Fresh runs reset handler state to those seeds. Live state switching can preserve supported state when requested; it is not a database, and behavior is defined by the existing handlers and [scenario specification](../../docs/scenario-spec.md).

## Streaming and scripted answers

Onyx's native chat UI consumes the packet shapes produced by `chat.mjs` and the shared streaming helpers. Fixture scripts supply answer text, source documents, citations, reasoning/search presentation and configured later turns. Exact model variants can supply different fictional content. Unscripted input does not acquire real reasoning or retrieval capabilities.

## Errors and external services

Use the current scenario's report and mock miss log to identify a missing response or an unexpected UI failure. Strict behavior and explicit error classifications are documented in the scenario reference. Do not hide a required failed interaction behind an empty success response.

Connectors, OAuth, provider credentials, permissions and billing examples remain local simulations. Native connector labels may name third-party services; that does not connect to those services. Never add real account identifiers or credentials to fixtures. Generated upstream frontend code and runtime assets remain outside Git and retain their upstream licensing obligations.
