// app.config.ts
import { defineConfig } from "@tanstack/start/config";
import viteTsConfigPaths from "vite-tsconfig-paths";
var app_config_default = defineConfig({
  tsr: {
    routesDirectory: "./src/routes",
    appDirectory: "./src"
  },
  server: {
    preset: "bun"
  },
  vite: {
    plugins: [
      viteTsConfigPaths({
        projects: ["./tsconfig.json"]
      })
    ],
    server: {
      host: "127.0.0.1",
      strictPort: true,
      hmr: {
        host: "127.0.0.1",
        port: 24678
      }
    }
  }
});
export {
  app_config_default as default
};
