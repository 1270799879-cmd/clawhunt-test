import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 将前端 API 请求代理到 Frappe 后端，并强制设置 Host 头
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        headers: {
          Host: "agent.localhost",
        },
      },
    },
  },
});