import type { SnapshotSerializer } from "vitest"

import type { Terminal } from "#lib/terminal.js"

import { isTerminal } from "#lib/terminal.js"

/**
 * Snapshots a terminal as its screen, verbatim: `expect(terminal)` gives an
 * unquoted, unescaped picture, where `expect(terminal.screen())` would be a
 * quoted string.
 *
 * Not added by `withClack`. Register it in the Vitest config, which loads the
 * default export of this module:
 *
 * @example
 *   export default defineConfig({
 *     test: { snapshotSerializers: ["vitest-clack/serializer"] },
 *   })
 */
const terminalSerializer: SnapshotSerializer = {
  test: isTerminal,
  serialize: (value: Terminal, _config, indentation) =>
    value.screen().replaceAll("\n", `\n${indentation}`),
}

/** Vitest loads a serializer file's default export. */
// oxlint-disable-next-line import/no-default-export -- See above.
export default terminalSerializer
export { terminalSerializer }
