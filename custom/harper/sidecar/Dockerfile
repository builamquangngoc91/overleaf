FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=dev
COPY server.mjs latex-masker.mjs ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
