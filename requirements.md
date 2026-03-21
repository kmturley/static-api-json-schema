# Requirements Document: Static API JSON Schema

## Introduction

Static API JSON Schema transforms committed YAML source files into schema.org-compatible JSON-LD documents and static index documents suitable for deployment to a static file hosting service. The core build is deterministic: it reads only local repository inputs, validates them, resolves internal links, and writes JSON output.

Technical design choices, library/tool selections, remote asset enrichment workflows, and repository licensing guidance are intentionally documented in `design.md`, not in this specification.

## Glossary

- **Resource**: A single logical entity represented by YAML source files and compiled to JSON-LD.
- **Resource Type**: A category of resources such as `games` or `publishers`.
- **Resource Root**: The directory containing a resource's primary YAML file and optional nested files.
- **Primary Resource YAML**: The main YAML file for a resource.
- **Version YAML**: An optional YAML file nested under a resource root representing a specific release or version of that resource.
- **Resources Root**: The configured top-level directory containing all resource types.
- **Canonical URL**: The absolute URL of a generated JSON-LD document.
- **Reference Object**: A JSON-LD object containing at minimum `@id` and `@type`.
- **Collection Index**: A generated document listing resources of a single type.
- **Search Index**: A generated document listing resources matching a configured attribute value.
- **Production Build**: A build intended for deployment, producing minified JSON output.
- **Development Build**: A local or preview build intended for debugging, producing formatted JSON output.

## Non-Goals

- Fetching remote URLs during the core build.
- Downloading or snapshotting remote assets during the core build.
- Mandating specific implementation libraries, test frameworks, linters, or formatters.
- Defining the full set of supported schema.org classes in this specification.

## Requirements

### Requirement 1: Resource Layout and Type Determination

**User Story:** As a developer, I want resource type and identity derived from directory structure, so that resource organization is predictable and does not require duplication in YAML.

#### Acceptance Criteria

1. The system SHALL support resource roots organized as `{resources_root}/{resource_type}/{resource_id}/index.yaml`.
2. The system SHALL determine `resource_type` from the immediate child directory under `{resources_root}`.
3. The system SHALL determine `resource_id` from the resource root directory name.
4. The system SHALL support optional version YAML files at `{resources_root}/{resource_type}/{resource_id}/versions/{version}.yaml`.
5. If a YAML file is outside a recognized resource layout, the system SHALL report an error with the file path.

### Requirement 2: YAML Source Validation

**User Story:** As a developer, I want YAML sources validated against resource-type-specific schemas, so that invalid data is caught before compilation.

#### Acceptance Criteria

1. The system SHALL validate every primary resource YAML against a resource-type-specific schema definition implemented in code and evaluated at runtime.
2. The system SHALL validate every version YAML against a resource-type-specific version schema definition implemented in code and evaluated at runtime.
3. If validation fails, the system SHALL report the source file path, field path, and error description.
4. The system SHALL stop validation and report the first error discovered in a run before returning failure.
5. The system SHALL stop before writing output when validation fails.
6. If a source document declares a schema.org type or equivalent type metadata that is incompatible with its containing resource type directory, the system SHALL fail validation until the source is moved to the correct resource type directory or corrected to match that directory.

### Requirement 3: Resource and Version Identity

**User Story:** As a developer, I want resource and version identity derived from the file layout, so that URLs remain stable and predictable.

#### Acceptance Criteria

1. The system SHALL derive the resource identifier from the resource root directory name.
2. The system SHALL support numeric and slug-based resource identifiers.
3. The system SHALL derive the version identifier from the version YAML filename without extension.
4. Version YAML documents SHALL use the source path pattern `{resources_root}/{resource_type}/{resource_id}/versions/{version}.yaml`.
5. The system SHALL validate that version identifiers used in version YAML paths follow semantic versioning.
6. Resource types, resource identifiers, and version identifiers SHALL already be lowercase and path-safe in source paths.
7. Resource types and resource identifiers SHALL contain only ASCII lowercase letters `a-z`, digits `0-9`, and hyphens `-`.
8. Version identifiers SHALL contain only ASCII lowercase letters `a-z`, digits `0-9`, periods `.`, and hyphens `-`.
9. The build SHALL fail if any source-derived path segment does not exactly match its normalized lowercase path-safe form.
10. The system SHALL reject identifiers that collide with reserved generated path segments.

### Requirement 4: Canonical URL Generation

**User Story:** As a developer, I want canonical absolute URLs generated from the output structure, so that resources and versions have unique, predictable identifiers.

#### Acceptance Criteria

1. The system SHALL generate a canonical URL for each resource using `{root_domain}/{resource_type}/{resource_id}`.
2. The system SHALL generate a canonical URL for each version document using `{root_domain}/{resource_type}/{resource_id}/versions/{version}`.
3. The system SHALL include the canonical URL as `@id` in the generated JSON-LD output.
4. The system SHALL generate canonical URLs without trailing slashes.

### Requirement 5: JSON-LD Output Validation

**User Story:** As a developer, I want generated JSON-LD validated against the project's supported schema contracts, so that output documents are structurally valid.

#### Acceptance Criteria

1. The system SHALL validate every generated JSON document before writing it to disk.
2. Validation SHALL cover root indexes, collection indexes, search indexes, resource documents, version indexes, version documents, and any other generated JSON-LD API documents.
3. Every generated JSON-LD document SHALL include `@context` and `@type`.
4. If generated output fails validation, the system SHALL report the resource identifier or version identifier when applicable, field path when applicable, and error description.

### Requirement 6: Internal Reference Resolution

**User Story:** As a developer, I want internal references in YAML automatically resolved to canonical JSON-LD links, so that relationships are explicit and consistent.

#### Acceptance Criteria

1. The system SHALL support internal references expressed as paths rooted at the resources root, for example `"/publishers/acme"` or `"/games/example/versions/1.2.0"`.
2. Internal references SHALL resolve only to other resource or version source files within the recognized source layout.
3. The system SHALL resolve valid internal references to canonical absolute URLs.
4. The system SHALL generate JSON-LD reference objects containing at minimum `@id` and `@type`.
5. The system SHALL support one-to-one and one-to-many internal references.
6. If a referenced internal resource or version does not exist, the system SHALL report an error with source file path and field path.
7. Circular references between resources or versions MAY be represented in generated JSON-LD references.
8. The implementation SHALL compile each source document at most once per build step and SHALL avoid recursive expansion loops during reference resolution.
9. The system SHALL reject any internal path that escapes the resources root after normalization.

### Requirement 7: Path Normalization and Collision Safety

**User Story:** As a developer, I want path normalization rules and collision detection, so that generated URLs and files are stable and unambiguous.

#### Acceptance Criteria

1. The system SHALL normalize generated path segments deterministically.
2. The system SHALL require all source-derived folder and file path segments used in generated URLs to be lowercase and path-safe.
3. Resource type and resource identifier path segments used in generated URLs SHALL contain only ASCII lowercase letters `a-z`, digits `0-9`, and hyphens `-`.
4. Version identifier path segments used in generated URLs SHALL contain only ASCII lowercase letters `a-z`, digits `0-9`, periods `.`, and hyphens `-`.
5. The system SHALL validate source-derived path segments against the implementation's normalization rules and fail the build when a segment does not match its expected normalized form.
6. The system SHALL detect a collision when a normalized generated output path is already claimed by another source file or generated document.
7. The system SHALL reject any reserved path segment used as a resource type, resource identifier, version identifier, or generated search value segment.
8. Reserved path segments SHALL include `search`, `versions`, `latest`, `docs`, and `assets`.
9. Collision detection SHALL occur when resolving each file or generated document to its normalized output path, without requiring pairwise comparison of every source against every other source.
10. The system SHALL report collisions with the original source values, the generated conflicting path, and the expected normalized value when relevant.

### Requirement 8: Root Index Generation

**User Story:** As a client, I want a root index document listing available resource collections and metadata, so that the API is discoverable.

#### Acceptance Criteria

1. On successful build, the system SHALL generate a root index at the output root.
2. The root index SHALL include API name and version metadata.
3. The root index SHALL list all resource types with links to their collection indexes.
4. The root index SHALL include links to search index manifests when search indexes are configured.
5. The root index SHALL be a valid JSON-LD document.

### Requirement 9: Collection Index Generation

**User Story:** As a client, I want per-type collection indexes, so that I can discover all resources of a given type.

#### Acceptance Criteria

1. The system SHALL generate a collection index for each resource type.
2. The collection index SHALL be written to `{output_root}/{resource_type}/index.json`.
3. The collection index SHALL list all resources of that type with links to their resource documents.
4. The collection index SHALL include links to configured search index manifests for that resource type.
5. The collection index SHALL be a valid JSON-LD document.

### Requirement 10: Search Index Generation

**User Story:** As a client, I want precomputed search indexes for selected attributes, so that I can fetch filtered subsets without scanning full collections.

#### Acceptance Criteria

1. The system SHALL support configuration of indexed attributes per resource type.
2. The system SHALL generate a search manifest at `{output_root}/{resource_type}/search/index.json`.
3. The system SHALL generate an attribute index at `{output_root}/{resource_type}/search/{attribute}/index.json`.
4. The system SHALL generate a value-specific index at `{output_root}/{resource_type}/search/{attribute}/{value}/index.json`.
5. Each search index SHALL contain only resources matching that attribute value.
6. The system SHALL support scalar and multi-value attributes.
7. The system SHALL preserve the original attribute value in index metadata while using a normalized path segment for the generated URL.
8. Search indexes SHALL be organized by indexed dimension or attribute.
9. The system SHALL rebuild affected search indexes when relevant source files change.
10. For incremental rebuild purposes, affected search indexes SHALL mean the search manifest, attribute indexes, and value-specific indexes under the same resource type whose membership or metadata changes because of the changed source file.
11. The system SHALL reject normalization collisions between distinct indexed values.
12. Collection entries within each generated search index SHALL be sorted by resource identifier using regular character order in ascending order.
13. Custom sorting and pagination for search indexes are out of scope for this specification.
14. If a generated search index has no matching resources, it SHALL contain an empty list of matches.
15. Search indexes SHALL index only simple primitive values supported by the implementation, such as strings, numbers, or booleans.
16. Missing optional indexed attributes, `null` values, empty strings, mixed scalar and array values, and object values MAY be ignored for indexing.

### Requirement 11: Output Directory Structure

**User Story:** As a developer, I want all output organized in a single predictable directory, so that deployment and hosting are straightforward.

#### Acceptance Criteria

1. The system SHALL write all generated output to a single output directory named `out`.
2. The output directory SHALL contain a root index at the root level.
3. The output directory SHALL contain resource-type subdirectories.
4. Resource documents SHALL be written to `{output_root}/{resource_type}/{resource_id}/index.json`.
5. Version documents SHALL be written to `{output_root}/{resource_type}/{resource_id}/versions/{version}/index.json`.
6. Search indexes SHALL be written under `{output_root}/{resource_type}/search/`.
7. Copied resource-level assets SHALL be written under `{output_root}/{resource_type}/{resource_id}/assets/`.
8. Copied version-level assets SHALL be written under `{output_root}/{resource_type}/{resource_id}/versions/{version}/assets/`.
9. The system SHALL use `index.json` for generated API documents.

### Requirement 12: Descriptive Error Reporting

**User Story:** As a developer, I want detailed error reporting, so that I can quickly identify and fix invalid inputs.

#### Acceptance Criteria

1. Errors SHALL include the source file path.
2. Validation and reference errors SHALL include the field path.
3. Parse errors SHALL include the line number when available.
4. Errors SHALL include the affected resource identifier and version identifier when applicable.
5. The system SHALL return a non-zero exit code when build or validation fails.

### Requirement 13: Consumer Type Definitions

**User Story:** As a developer, I want generated type definitions for the supported JSON-LD document shapes, so that downstream consumers can type-check integrations.

#### Acceptance Criteria

1. The project SHALL publish machine-readable type definitions for generated document shapes.
2. The published type definitions SHALL cover resource documents, version documents, collection indexes, search indexes, and root indexes.
3. The type definitions SHALL align with runtime validation rules used by the build.
4. The specification SHALL not enumerate supported schema.org classes; they SHALL be sourced from the implementation's schema package as documented in `design.md`.

### Requirement 14: Build Reflects Current Source Content

**User Story:** As a developer, I want generated output to reflect the intended source baseline for the build mode, so that stale data is not served.

#### Acceptance Criteria

1. After a successful build, the output directory SHALL contain only resources, versions, indexes, and assets derived from the source inputs used for that build.
2. If a resource or version source is removed, the system SHALL remove its corresponding output.
3. If a resource or version source is modified, the system SHALL update its corresponding output.
4. The system SHALL update affected indexes to reflect current content.
5. A non-watch build SHALL remove and recreate the `out` directory before writing fresh generated output.
6. Production and release builds SHALL reflect the current committed repository content as built and deployed by GitHub Actions workflows from the repository state under test.
7. Local development builds SHALL reflect the current repository working tree content.

### Requirement 15: Development Mode and Production Mode

**User Story:** As a developer, I want distinct development and production output modes, so that local debugging is readable while deployment artifacts stay compact.

#### Acceptance Criteria

1. The system SHALL support a development mode and a production mode.
2. Development mode and production mode MAY differ in formatting and diagnostics behavior.
3. Production mode SHALL write minified JSON output.
4. Development mode SHALL write formatted JSON output using two-space indentation.
5. When configured, development mode SHALL watch the resources root for file changes.
6. In watch mode, the system SHALL perform one full build before processing incremental updates.
7. In watch mode, the system SHALL validate changed files and rebuild affected resources and indexes incrementally.
8. In watch mode, add, modify, and delete operations SHALL update generated output accordingly.
9. In watch mode, the implementation SHALL watch files, run a rebuild after file writes have settled, and reload the local development server when needed.
10. The system MAY provide a standalone validation command that validates sources without writing output.

### Requirement 16: YAML Parsing and Formatting

**User Story:** As a developer, I want YAML parsed and formatted consistently, so that committed source files remain readable and structurally valid.

#### Acceptance Criteria

1. The system SHALL parse YAML source files into structured data.
2. If YAML is invalid, the system SHALL report a parse error with file path and line number when available.
3. If a source file is unreadable, the build SHALL fail and report the file path.
4. If a source YAML file exceeds 1 MB, the build SHALL fail and report the file path.
5. Symlink handling is out of scope for this specification.
6. Duplicate YAML keys SHALL be treated as a parse error.
7. YAML anchors and aliases are out of scope for this specification and SHALL be rejected if encountered.
8. Each resource source file and each version source file SHALL contain exactly one YAML document.
9. Empty directories under the resources root MAY be ignored by the implementation.
10. If a required source directory cannot be read, the build SHALL fail and report the path.
11. Project tooling MAY format YAML source files, but YAML formatting behavior is not part of the core build contract.
12. If YAML formatting tooling is provided, parsing then formatting then parsing SHALL preserve semantic equivalence of the YAML data model.

### Requirement 17: JSON Formatting

**User Story:** As a developer, I want generated JSON output formatted consistently within each output mode, so that output is predictable and easy to inspect.

#### Acceptance Criteria

1. Generated JSON SHALL be valid and parseable.
2. Development mode SHALL emit stable key ordering where configured by the implementation.
3. Production mode SHALL emit semantically equivalent minified JSON.
4. Parsing generated JSON, writing it, and parsing it again SHALL preserve semantic equivalence.

### Requirement 18: Local Static Asset Handling

**User Story:** As a developer, I want local static assets referenced from YAML and copied into the output, so that generated JSON-LD documents can point to hosted files.

#### Acceptance Criteria

1. The core build SHALL support local asset references only.
2. Local asset references SHALL resolve within the resources root after path normalization.
3. The system SHALL reject any local asset path that escapes the resources root.
4. If a referenced local asset exists, the system SHALL copy it into the output directory under a reserved `assets` path segment.
5. Resource-level assets SHALL be written under `{output_root}/{resource_type}/{resource_id}/assets/{asset_filename}`.
6. Version-level assets referenced from a version YAML SHALL be written under `{output_root}/{resource_type}/{resource_id}/versions/{version}/assets/{asset_filename}`.
7. These resource-level and version-level asset paths SHALL be the deterministic output paths for copied assets.
8. Asset output filenames SHALL preserve the source filename unless the build must reject the asset due to a path collision.
9. The system SHALL reject asset output path collisions.
10. Assets with the same filename under different resource types, resource identifiers, or version identifiers SHALL NOT be treated as collisions when their generated output paths are distinct.
11. If a referenced local asset does not exist, the system SHALL report an error with source file path and field path.
12. The system SHALL convert copied local asset paths to canonical absolute URLs in generated JSON-LD output.
13. The system SHALL preserve asset metadata required by the resource schema, including `encodingFormat` and other available local metadata.
14. Example JSON-LD documents in project documentation SHALL demonstrate use of schema.org `license` metadata for downloadable files where applicable.

### Requirement 19: API Documentation

**User Story:** As a client developer, I want generated API documentation, so that I can understand the available document types and paths.

#### Acceptance Criteria

1. The system SHALL generate API documentation suitable for deployment to a static file hosting service.
2. The documentation SHALL describe the root index, collection indexes, resource documents, version documents, and search indexes.
3. The documentation SHALL include example requests expressed as document URLs and example responses.
4. The documentation SHALL be updated when the build completes successfully.
5. The documentation SHALL be generated at `/docs/`.

### Requirement 20: Deterministic Build Inputs

**User Story:** As a developer, I want the build to depend only on local repository inputs, so that builds are reproducible and suitable for CI.

#### Acceptance Criteria

1. The core build SHALL read only local repository inputs and local configuration.
2. Production and release builds SHALL use committed repository inputs, typically through GitHub Actions workflows.
3. Local development builds MAY use uncommitted working tree inputs.
4. The core build SHALL NOT fetch remote URLs during validation or output generation.
5. The core build SHALL NOT calculate remote asset size or checksum data.
6. Any remote URL enrichment workflow SHALL be treated as a separate development tool outside the core build specification.

### Requirement 21: Contributor Guidance Generation

**User Story:** As a maintainer, I want generated contributor guidance that reflects current resource schemas and workflows, so that contributors can add resources consistently.

#### Acceptance Criteria

1. The system MAY generate an `AGENTS.md` file or equivalent contributor guidance file.
2. If generated, the guidance SHALL describe how to add new resources using current schema and project structure.
3. If generated, the guidance SHALL describe how to validate changes and verify generated output.
4. If generated, the guidance SHALL be updated when the build completes successfully.

### Requirement 22: Development Commands and Quality Gates

**User Story:** As a developer, I want standard development commands and quality gates, so that validation, testing, and generation can be run consistently.

#### Acceptance Criteria

1. The project SHALL provide commands for `build`, `validate`, `test`, `dev`, and `clean`.
2. The project MAY provide commands for `lint`, `format`, and `format:check`.
3. Validation, build, and test commands SHALL return non-zero exit codes on failure.
4. The project SHALL document all available commands in repository documentation or CLI help output.
5. Machine-readable output for CI MAY be provided by the implementation.

### Requirement 23: Downloadable File License Metadata

**User Story:** As a client developer, I want downloadable files represented with explicit license metadata in example documents, so that file licensing is machine-readable and consistent with schema.org JSON-LD conventions.

#### Acceptance Criteria

1. Project examples SHALL demonstrate use of schema.org `license` for downloadable files where licensing metadata is known.
2. Example documents SHALL show `license` in JSON-LD form compatible with schema.org conventions.
3. The specification SHALL treat file license metadata as resource data, not repository code licensing.

### Requirement 24: Package-Driven Schema Support

**User Story:** As a maintainer, I want supported schema.org classes sourced from an implementation package rather than hard-coded in this specification, so that support can evolve as schema packages change over time.

#### Acceptance Criteria

1. The specification SHALL not enumerate all supported schema.org classes.
2. The implementation SHALL source supported schema.org classes from a package or library documented in `design.md`.
3. The package or library providing supported schema.org classes and generated type definitions SHALL be pinned to an explicit dependency version or committed repository code.
4. Changes in supported classes caused by schema package updates SHALL be treated as implementation changes, not specification changes, unless the output contract changes.
5. Updating pinned schema packages or generated type definitions MAY require corresponding refactoring of YAML schemas, validation rules, or resource values.

### Requirement 25: Automated Integration Testing

**User Story:** As a maintainer, I want integration tests that verify the generated API contract, so that valid YAML changes do not silently break discoverability or document structure.

#### Acceptance Criteria

1. The project SHALL include automated integration tests for generated output.
2. Integration tests SHALL verify that expected resource documents, collection indexes, root indexes, version documents, and configured search indexes exist at their contract paths.
3. Integration tests SHALL verify document shape and required fields rather than relying on collection length or full-output snapshots.
4. If resource data changes validly, integration tests MAY be updated to reflect the new valid contract.
5. The project MAY include additional unit tests and formatter or linter checks as implementation choices documented in `design.md`.

### Requirement 26: CLI Diagnostics

**User Story:** As a developer, I want clear CLI diagnostics, so that build and validation failures are easy to understand.

#### Acceptance Criteria

1. CLI output SHALL clearly distinguish errors, warnings, and informational messages.
2. Error output SHALL include enough context to identify the failing source and cause.
3. Validation output SHALL report the first error encountered before returning failure.
4. Optional color, symbols, progress indicators, and terminal-specific formatting are implementation choices documented in `design.md`.

### Requirement 27: Resource Versioning and Release Metadata

**User Story:** As a developer, I want resource versions represented as additional YAML files nested under a resource root and linked through JSON-LD, so that clients can discover specific releases without overloading the primary resource document.

#### Acceptance Criteria

1. The system SHALL support additional version YAML files nested under `{resource_type}/{resource_id}/versions/`.
2. The primary resource document SHALL link to version documents using JSON-LD references.
3. Each version document SHALL have its own canonical URL and generated output document.
4. Version metadata SHALL support semantic version identifier, release date, modification date, and release notes.
5. The system SHALL generate a version index document at `/{resource_type}/{resource_id}/versions/`.
6. The system SHALL generate a single duplicate latest-version document at `/{resource_type}/{resource_id}/versions/latest/` using the metadata of the highest available semantic version.
7. The primary resource document SHALL expose a discoverability field linking to the latest semantic version document.
8. The system SHALL preserve prior versions in generated output unless they are removed from source.
9. Version-specific file assets SHALL be supported through local asset references in the corresponding version YAML files.
10. If the highest available semantic version is removed from source, the `latest` document and latest discoverability field SHALL revert to the next-highest valid semantic version that remains in source.

### Requirement 28: Platform Targeting Metadata

**User Story:** As a developer, I want resources and versions to describe platform targeting metadata, so that clients can identify compatible files for their environment.

#### Acceptance Criteria

1. The system SHALL support operating system metadata using schema.org-compatible properties.
2. The system SHALL support processor architecture metadata using schema.org-compatible properties.
3. The system SHALL support multiple platform entries for a single version where needed.
4. The system SHALL allow a single file to target multiple operating systems or architectures when explicitly declared.
5. If platform-specific search indexes are configured, they SHALL follow the same search index contract as other indexed attributes.
