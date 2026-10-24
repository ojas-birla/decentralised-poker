import path from "node:path";
import { defineConfig } from "vitest/config";

// @poker/shared is TypeScript source in the workspace, so vitest must transform it.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: path.resolve(__dirname) + "/" }],
  },
  test: {
    include: ["lib/**/*.test.ts"],
    server: { deps: { inline: [/@poker\/shared/] } },
  },
});