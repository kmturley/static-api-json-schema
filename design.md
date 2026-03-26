# Design Notes: Static API JSON Schema

## Purpose

This document captures technical design choices, implementation options, and repository policy decisions that are intentionally excluded from `requirements.md`.

`requirements.md` defines the product contract.
`design.md` defines how the implementation may satisfy that contract.

## Core Architectural Decisions

### Deterministic Core Build

The core build should be deterministic and repository-local:

- Input: committed YAML, local assets, and local configuration
- Output: generated JSON-LD documents, indexes, and copied local assets
- No network access during `build`
- No remote asset probing during `build`

This keeps CI stable and makes production output reproducible.

### Remote Asset Enrichment Is a Development Tool

Remote URL fetching, size detection, checksum generation, and related enrichment should happen before commit time, not during the core build.

Recommended workflow:

1. A developer runs a dedicated dev tool against a remote URL.
2. The tool fetches metadata such as `contentSize`, `encodingFormat`, redirect-resolved URL, and optionally `sha256`.
3. The tool writes or updates YAML.
4. The resulting YAML is reviewed and committed.
5. The core build consumes only the committed YAML and local assets.

This separates unstable remote I/O from the build contract.

### Version Modeling

Versions are modeled as additional YAML files nested under a resource root:

- Primary resource: `resources/{resource_type}/{resource_id}/index.yaml`
- Version document: `resources/{resource_type}/{resource_id}/versions/{version}.yaml`

Recommended JSON-LD model:

- The primary resource represents the logical thing, for example a software application or publisher entry.
- Each version file represents a release-specific document.
- The primary resource links to versions using JSON-LD references.
- The primary resource also exposes a discoverability field for the latest version.
- The build also emits a duplicate latest-version document at `/versions/latest/` using the metadata of the highest available semantic version.

### Path Semantics

All local paths must remain within the `resources/` tree after normalization.

Recommended rules:

- Internal resource references use resources-root-relative paths such as `"/games/foo"` or `"/games/foo/versions/1.2.0"`.
- Local asset references may use resources-root-relative paths for consistency.
- Any normalized path containing escape attempts such as `../` outside the resources root must be rejected.
- Symlink handling is out of scope for this specification.

### Slugification Contract

All folder and file path segments that participate in generated URLs should be lowercase and URL-safe.

Recommended implementation:

```ts
import slugify from "slugify";

const URLSAFE_REGEX: RegExp = /[^a-z0-9-]+/g;

export function toSlug(val: string): string {
  return slugify(val, { lower: true, strict: true, remove: URLSAFE_REGEX });
}
```

Recommended enforcement:

- The normative specification should limit resource types and resource identifiers to ASCII lowercase letters `a-z`, digits `0-9`, and hyphens `-`.
- Version identifiers may additionally contain periods `.` so semantic versions such as `1.2.0` remain valid path segments.
- Resource types must already match `toSlug(resource_type)`.
- Resource identifiers must already match `toSlug(resource_id)`.
- Version identifiers used in paths must already match the semantic-versioning convention adopted by the implementation.
- Generated search value segments should be derived from `toSlug(value)`.
- The build should fail if any source-derived path segment does not exactly match the slugified form expected by the implementation.

Recommended collision handling:

- Resolve each source file or generated document to its normalized output path once.
- Treat the path as colliding only if another source file or generated document has already claimed that generated path.
- Do not require pairwise collision comparison across every source file when path resolution alone establishes uniqueness.

This makes URL generation predictable and prevents silent path rewriting during build.

### Reserved Path Segments

The following path segments are reserved and must not be used in generated API paths as resource types, resource identifiers, version identifiers, or generated search value segments:

- `search`
- `versions`
- `latest`
- `docs`
- `assets`

These are reserved because they are part of the generated API and documentation namespace.

## Collision Examples

The specification now requires collision detection. Concrete cases include:

- Case-insensitive collision:
  - `resources/games/Halo/index.yaml`
  - `resources/games/halo/index.yaml`
  - These are distinct on some filesystems and identical on others.

- Reserved segment collision:
  - `resources/games/search/index.yaml`
  - This conflicts with generated search indexes under `/games/search/...`.

- Resource type collision:
  - `resources/docs/example/index.yaml`
  - This conflicts with generated documentation paths under `/docs`.

- Version alias collision:
  - `resources/games/foo/versions/latest.yaml`
  - This conflicts with the generated `/games/foo/versions/latest/` alias.

- Normalized search collision:
  - `genre: "C++"`
  - `genre: "c"`
  - Poor normalization rules can collapse both into the same URL segment depending on implementation.

- Punctuation collision:
  - `genre: "Action RPG"`
  - `genre: "Action-RPG"`
  - Both may normalize to `action-rpg`.

- Unicode normalization collision:
  - `Pokémon`
  - `Pokemon`
  - or composed vs decomposed Unicode spellings that normalize to the same segment.

- Resource path collision:
  - Resource ID `docs`
  - If documentation is generated at `/docs`, that resource path conflicts with a generated system path.

## Standards Clarification

### JSON-LD

The implementation should emit valid JSON-LD documents:

- `@context` must be present.
- `@type` must be present.
- `@id` should be the canonical absolute URL for the document.
- References should be represented using JSON-LD objects containing at least `@id` and `@type`.

This is the main interoperability standard for the generated output.

### schema.org

The specification does not freeze a hard-coded list of supported schema.org classes.

Instead:

- Supported classes and properties should come from the implementation's schema package or library.
- That package may be auto-generated from schema.org and may evolve over time, but it should be pinned to an explicit dependency version or committed repository code.
- Changes in that package do not automatically imply specification changes unless the published output contract changes.

### Common Validation Conventions

The specification intentionally does not freeze every field constraint because they depend on the schema.org class and properties used by each resource type.

Recommended defaults for implementation schemas:

- Each resource type should provide a runtime schema definition in code for primary resource YAML files.
- Each resource type that supports versions should provide a runtime schema definition in code for version YAML files.
- URL fields should usually require `https://`.
- Generic string fields should usually default to a minimum length of `1` and a maximum length of `256` unless a schema needs different limits.
- Enumerated values should come from explicit project enums or schema-derived controlled values where appropriate.
- File count, tag count, and similar collection limits should be defined by the resource schema for that type.
- Source YAML file size should be capped at 1 MB.
- Duplicate YAML keys should be rejected during parsing.
- YAML anchors, aliases, and multi-document YAML should be rejected.

These are baseline conventions, not immutable contract values for every field.

### Search Indexing Conventions

Recommended indexing behavior:

- Search indexes should be limited to simple primitive values supported by the implementation.
- Missing optional fields, `null` values, empty strings, mixed scalar and array values, and object values may be ignored for indexing.
- Sorting should use regular character order.

### License Metadata for Files

For downloadable files, the recommended schema.org-compatible field is `license`.

Example JSON-LD pattern:

```json
{
  "@context": "https://schema.org",
  "@type": "DataDownload",
  "@id": "https://example.com/games/foo/versions/1.2.0/downloads/macos",
  "name": "Foo 1.2.0 macOS",
  "contentUrl": "https://example.com/assets/foo-1.2.0-macos.zip",
  "encodingFormat": "application/zip",
  "license": "https://spdx.org/licenses/MIT.html"
}
```

If richer license metadata is needed, a linked CreativeWork or URL can also be used so long as the emitted structure remains schema.org-compatible.

## Output Formatting

Recommended output behavior:

- Production mode: minified JSON
- Development mode: formatted JSON with two-space indentation

Stable property ordering is helpful for diffs in development mode, but exact ordering beyond required JSON-LD keys should remain an implementation detail unless tests rely on it.

## Testing Strategy

Recommended testing layers:

- Unit tests for path normalization, validation, reference resolution, search indexing, and collision detection
- Integration tests for generated contract paths and document shape
- Watch-mode tests for add/modify/delete workflows where practical

Integration tests should prefer contract assertions over snapshot assertions:

- Assert that required endpoints exist
- Assert that required fields and shapes are present
- Avoid assertions on total collection length unless the fixture is intentionally fixed
- Update integration expectations when valid source changes intentionally alter the contract

## GitHub Actions Workflows

Recommended repository automation:

- Every pull request should trigger GitHub Actions workflows that validate the repository, run tests, and fail the PR if the generated contract is invalid.
- Merges to `main` should trigger build and publish workflows for the static API output and documentation.
- Version tags should trigger release workflows that build the project, publish release artifacts, and publish the generated site to `gh-pages` when applicable.
- Production publishing should be performed by GitHub Actions from committed repository content rather than from local manual builds.

This keeps the contract continuously validated in review and makes production publishing consistent with the repository history.

## Implementation Choices

The following are valid topics for implementation selection and belong here rather than in `requirements.md`:

- Programming language and runtime choices
- Module system
- Specific schema packages
- Validation libraries
- CLI formatting libraries
- Test frameworks
- Linting and formatting tools
- CI output adapters

These may change over time without requiring a specification change unless they alter the product contract.

## Output Location

The generated output directory should be fixed to `out/`.

Recommended repository setup:

- Add `out/` to `.gitignore`.
- Treat `out/` as disposable build output recreated by non-watch builds.

## Repository Licensing

Repository code licensing is a repository policy decision, not a resource-data requirement.

Recommended approach:

- Document the repository code license in repository metadata and top-level documentation.
- Do not assume that contributed resource data or downloaded third-party files inherit the repository code license.
- Treat file-level `license` metadata in JSON-LD as resource data, independent of the repository's code license.
