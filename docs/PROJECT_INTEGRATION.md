# Project Integration Standard

Every project connects to the shared Agent Core service instead of calling Jev/OpenRouter directly.

## Project files

Recommended project-local structure:

```text
.ai/
├── jev.yaml
├── policies.yaml
├── state/
├── tasks/
├── decisions/
└── qa/
```

## Runtime environment

```text
AGENT_PLATFORM_URL=https://agent.<domain>
AGENT_PROJECT=<project-id>
AGENT_PROJECT_TOKEN=<project-secret>
```

The OpenRouter API key is never stored in project repositories.

## CLI

```text
npm run cli -- health
npm run cli -- doctor
npm run cli -- decision '<json>'
npm run cli -- route '<json>'
npm run cli -- qa '<json>'
```

## Migration

Adapters in `adapters/` define the initial policy profile for current projects. Projects may copy or generate their own `.ai/jev.yaml` while the platform remains the shared runtime.

## Security rule

Project identity from request headers must match the `project` field in the request body. Cross-project spoofing is rejected.