import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["lib/index.ts", "lib/serializer.ts"],
  format: "esm",
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  /** The tsconfig only type checks, so declarations are turned on here. */
  dts: {
    sourcemap: true,
    compilerOptions: { declaration: true, declarationMap: true },
  },
  deps: {
    neverBundle: true,
  },
  /** Code shared by the entries, kept out of `exports` below. */
  outputOptions: { chunkFileNames: "chunks/[name]-[hash].js" },
  exports: {
    devExports: true,
    packageJson: true,
    all: true,
    exclude: ["chunks/**"],
  },
})
