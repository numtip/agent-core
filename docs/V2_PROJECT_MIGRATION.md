# Agent Core v2 Project Migration

## Contract

Existing projects migrate by declaring `schema_version: 2`, preferring API `v2`, and enabling only the capabilities appropriate to that project. v1 remains compatible during transition.

## Projects

- **52clips** — unified routing, gateway, context governor, supervisor; browser disabled.
- **attendance-report-generator** — deterministic-first document automation; browser disabled.
- **handbook** — v2 control plane with browser planning enabled; production publishing remains human-approved.
- **goffice2026** — full v2 routing/gateway/context/supervisor plus browser planning; production deploy remains human-approved.
- **dbplant** — read-only-first migration; gateway execution and browser remain disabled; writes require approval and destructive operations remain denied.

## Migration rule

Project adapters describe permissions and preferred control-plane features. They do not grant execution rights. Agent Core hard policy, machine identity scopes, environment gates, and human approval remain authoritative.

## Client sequence

1. call health and confirm v2 support;
2. route through `/v2/route`;
3. use capability search/progressive disclosure as needed;
4. govern long context before expensive reasoning;
5. request gateway or browser handoff only when enabled by the adapter and identity scope;
6. use supervisor decisions for multi-step workflows;
7. preserve v1 fallback until live v2 activation is verified.
