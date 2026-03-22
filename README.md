# Static API JSON Schema

Static API JSON Schema transforms repository-local YAML resources into schema.org-compatible JSON-LD documents and static index documents for deployment to static hosting.

## Commands

- `npm run lint`
  Lints the project files using ESLint.
- `npm run format`
  Formats the project files using Prettier.
- `npm test`
  Runs the test suite.
- `npm run typecheck`
  Runs TypeScript type checking without emitting JavaScript.
- `npm run build`
  Compiles TypeScript source files into `dist/`.
- `npm start`
  Generates the static API from YAML sources into `out/`. Use `npm start -- --mode=production` for minified output.
- `npm run validate`
  Validates sources and generated documents without writing output.
- `npm run dev`
  Starts a development server, watches `src/` and `resources/` for changes, and rebuilds incrementally.
- `npm run clean`
  Removes the `out/` and `dist/` directories.

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
