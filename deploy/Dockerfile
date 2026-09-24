# 单阶段镜像: 构建产物在本地/CI 打好(见 tools/build-web.mjs 与 npm run build:server),
# 镜像里只放"能跑的东西"——没有工具链、没有 node_modules、没有源码,启动毫秒级。
# 密钥不进镜像:DEEPSEEK_KEY 由 .env / docker compose 在运行时注入。
FROM node:22-alpine

WORKDIR /app
# 目录结构与本地仓库保持一致: server.mjs 在 dist/ 下, 它用 ../web/dist 解析静态目录
COPY dist/server.mjs ./dist/server.mjs
COPY web/dist ./web/dist

ENV PORT=8787 NODE_ENV=production
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.mjs"]
