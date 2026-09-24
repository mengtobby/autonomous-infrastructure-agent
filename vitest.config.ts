import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Expected-failure tests would otherwise flood the output with error logs.
    env: { LOG_LEVEL: "silent" },
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/server.ts"],
    },
  },
});
