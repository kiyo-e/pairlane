import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import ssrPlugin from "vite-ssr-components/plugin";

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({
      config: () => {
        if (command !== "serve") return {};
        return {
          assets: {
            directory: "./public",
          },
        };
      },
    }),
    ssrPlugin(),
  ],
  publicDir: "public",
}));
