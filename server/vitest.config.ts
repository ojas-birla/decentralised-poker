import { defineConfig } from "vitest/config";

// @poker/shared is TypeScript source in the workspace, so vitest must transform it instead of treating it as a dependency.
export default defineConfig({
  test: { server: { deps: { inline: [/@poker\/shared/] } } },
});