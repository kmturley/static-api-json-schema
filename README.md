# Static API JSON Schema

Static API JSON Schema transforms repository-local YAML resources into schema.org-compatible JSON-LD documents and static index documents for deployment to static hosting.

## Commands

- `npm run build`
  Builds output into `out/`.
- `npm run build -- --mode=production`
  Builds output into `out/` using minified JSON.
- `npm run validate`
  Validates sources and generated documents without writing output.
- `npm run dev`
  Builds in development mode, watches `resources/`, and serves `out/` locally.
- `npm run clean`
  Removes `out/`.
- `npm test`
  Runs the test suite.
- `npm run typecheck`
  Runs TypeScript type checking without emitting JavaScript.

## Project Layout

- `src/project.ts`
  Project definition containing config and the schema registry.
- `src/resources/*.ts`
  Resource-type-specific schemas and compilers.
- `src/core/*`
  Reusable build engine, CLI, validation, and utility code.
- `resources/`
  YAML source content and local static assets.
- `out/`
  Generated static API output.

## Workflows

- Pull requests run CI for typecheck, validate, test, and build.
- Pushes to `main` build and publish `out/` to `gh-pages`.
