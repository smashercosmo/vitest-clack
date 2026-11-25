import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/*.spec.ts"],
    /** The tests snapshot `expect(terminal)` as the screen, like users do. */
    snapshotSerializers: ["./lib/serializer.ts"],
  },
})
